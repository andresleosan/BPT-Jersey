import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { staffInvitationSchema, type StaffInvitation } from "@bpt-jersey/domain/staff/team-access";
import { parseAuditEventDraft } from "@bpt-jersey/domain/audit";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import type { TeamAccessServices } from "./team-access.js";

export function createTeamInvitationStore(
  db: Firestore,
  actorId: string,
): TeamAccessServices["invitations"] {
  const collection = (academyId: string) =>
    db.collection(`academies/${academyId}/staffAdministrativeInvitations`);
  const index = db.collection("staffInvitationEmailIndex");
  const parse = (data: unknown) => staffInvitationSchema.parse(data);
  function audit(
    tx: Transaction,
    invitation: StaffInvitation,
    action:
      | "staff.invitation.created"
      | "staff.invitation.cancelled"
      | "staff.invitation.accepted"
      | "staff.invitation.failed",
  ) {
    const ref = db.collection(`academies/${invitation.academyId}/auditEvents`).doc();
    const draft = parseAuditEventDraft({
      academyId: invitation.academyId,
      actorId,
      action,
      targetRef: `academies/${invitation.academyId}/staffAdministrativeInvitations/${invitation.id}`,
      purpose: "administrative invitation management",
      correlationId: invitation.version,
    });
    if (!draft.ok) throw new HttpsError("invalid-argument", "Invalid invitation audit event.");
    appendAuditEventInTransaction(tx, ref, draft.value);
  }
  return {
    async list(academyId) {
      const snapshot = await collection(academyId).limit(501).get();
      if (snapshot.size > 500)
        throw new HttpsError("resource-exhausted", "Too many invitations to display.");
      return snapshot.docs
        .map((doc) => parse(doc.data()))
        .filter(
          (invitation) =>
            invitation.academyId === academyId &&
            ["pending", "processing", "failed"].includes(invitation.status),
        );
    },
    async save(invitation) {
      const ref = collection(invitation.academyId).doc(invitation.id);
      await db.runTransaction(async (tx) => {
        const route = await tx.get(index.doc(invitation.id));
        if (route.exists && route.data()?.academyId !== invitation.academyId)
          throw new HttpsError("failed-precondition", "This email cannot be authorised here.");
        const snapshot = await tx.get(ref);
        if (snapshot.exists) {
          const prior = parse(snapshot.data());
          if (prior.academyId !== invitation.academyId || prior.status === "processing")
            throw new HttpsError("failed-precondition", "This invitation cannot be replaced.");
        }
        tx.set(index.doc(invitation.id), { academyId: invitation.academyId });
        tx.set(ref, invitation);
        audit(tx, invitation, "staff.invitation.created");
      });
      return invitation;
    },
    async cancel(academyId, id, version) {
      const ref = collection(academyId).doc(id);
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new HttpsError("not-found", "Invitation not found.");
        const invitation = parse(snapshot.data());
        if (
          invitation.academyId !== academyId ||
          invitation.version !== version ||
          !["pending", "failed"].includes(invitation.status)
        )
          throw new HttpsError(
            "failed-precondition",
            "The invitation has changed. Refresh the list.",
          );
        tx.set(ref, { ...invitation, status: "cancelled" });
        audit(tx, invitation, "staff.invitation.cancelled");
      });
    },
    async claim(email, userId, now) {
      const id = createHash("sha256").update(email).digest("hex");
      return db.runTransaction(async (tx) => {
        const route = await tx.get(index.doc(id));
        if (!route.exists) return null;
        const academyId: unknown = route.data()?.academyId;
        if (
          typeof academyId !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(academyId)
        )
          throw new HttpsError("failed-precondition", "Invitation scope is invalid.");
        const ref = collection(academyId).doc(id);
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return null;
        const invitation = parse(snapshot.data());
        if (
          invitation.academyId !== academyId ||
          invitation.email !== email ||
          invitation.id !== id
        )
          throw new HttpsError("failed-precondition", "Invitation identity mismatch.");
        if (invitation.status === "processing")
          throw new HttpsError("aborted", "This invitation is already being activated.");
        if (invitation.status !== "pending" || Date.parse(invitation.expiresAt) <= Date.parse(now))
          return null;
        tx.set(ref, { ...invitation, status: "processing", claimedBy: userId });
        return invitation;
      });
    },
    async finish(invitation, userId, status) {
      const ref = collection(invitation.academyId).doc(invitation.id);
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const current = snapshot.exists ? parse(snapshot.data()) : null;
        if (
          !current ||
          current.version !== invitation.version ||
          current.status !== "processing" ||
          current.claimedBy !== userId
        )
          throw new HttpsError("aborted", "The invitation activation has changed.");
        tx.set(ref, { ...current, status });
        audit(
          tx,
          invitation,
          status === "accepted" ? "staff.invitation.accepted" : "staff.invitation.failed",
        );
      });
    },
  };
}
