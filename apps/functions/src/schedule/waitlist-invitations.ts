import { createHash } from "node:crypto";
import { FieldPath, getFirestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { parseCreateSessionInput, isIntroductionClass, isWithinBookingCutoff, type SessionRecord } from "@bpt-jersey/domain/schedule";
import { parseWaitlistEntryRecord } from "@bpt-jersey/domain/schedule/advanced-booking";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import type { InvitationPage, WaitlistInvitationView, WaitlistClassResult } from "@bpt-jersey/domain/schedule/waitlist-invitations";
import { onCallWithFreshAppCheck } from "../auth/app-check.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createMemberDirectoryReadTransaction } from "../members/member-directory-firestore.js";
import { canonicalMemberIdentityIds, resolveCanonicalStudentIdInTransaction } from "../members/member-identity-resolution.js";
import { getStudentScopeOptions, requireStudentScope } from "./schedule-callables.js";
import { confirmBookingInTransaction, validateBookingOfferInTransaction, BookingTransactionError, type ConfirmBookingInTransactionInput, type BookingFirestore, type BookingTransaction } from "./booking-transaction-service.js";
import { clientIpFromRequest } from "../audit/client-ip.js";
import { scheduleCallableOptions } from "./schedule-callable-options.js";

type Invitation = {
  academyId: string; invitationId: string; operationId: string; sourceSessionId: string;
  sourceWaitlistId: string; sourceTitle: string; sessionId: string; studentId: string;
  membershipId: string; status: "pending" | "accepted" | "declined" | "closed";
  createdAt: string; createdBy: string; respondedAt: string | null; respondedBy: string | null;
};
type Operation = { sourceSessionId: string; sessionId: string; cursor: string | null; invited: number; complete: boolean; fingerprint: string; createdAt: string; createdBy: string };
const id = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,319}$/.test(value)) throw new HttpsError("invalid-argument", "Invalid reference");
  return value;
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 40);
const ordinary = (session: SessionRecord) => !session.courseId && !session.isSeminar && (session.accessMode ?? "membership") === "membership";
const pending = (value: unknown) => value === "waiting" || value === "offered";

async function hasOriginalBooking(tx: Transaction, academyId: string, studentId: string, sourceSessionId: string) {
  const db = getFirestore();
  const ids = await canonicalMemberIdentityIds(createMemberDirectoryReadTransaction(db, tx), academyId, studentId);
  const bookings = await tx.get(db.collection(`academies/${academyId}/bookings`).where("sessionId", "==", sourceSessionId).where("studentId", "in", ids).limit(50));
  if (bookings.size === 50) throw new HttpsError("failed-precondition", "The original class bookings need review");
  return bookings.docs.some((doc) => doc.data().status === "confirmed");
}

export const getWaitlistClassSource = onCallWithFreshAppCheck(scheduleCallableOptions, async (request) => {
  const actor = requireUserActor(request);
  if (actor.role !== "owner") throw new HttpsError("permission-denied", "Owner access required");
  const sessionId = id(request.data?.sessionId), db = getFirestore(), base = `academies/${actor.academyId}`;
  const [doc, queue] = await Promise.all([
    db.doc(`${base}/sessions/${sessionId}`).get(),
    db.collection(`${base}/waitlistEntries`).where("sessionId", "==", sessionId).where("status", "in", ["waiting", "offered"]).count().get(),
  ]);
  const session = doc.data() as SessionRecord | undefined;
  if (!session || !ordinary(session)) throw new HttpsError("failed-precondition", "Select an ordinary class waitlist");
  const program = await db.doc(`${base}/programs/${session.programId}`).get();
  if (isIntroductionClass(session, program.data())) throw new HttpsError("failed-precondition", "Select an ordinary class waitlist");
  return { session, waiting: queue.data().count };
});

/** One stable session, then resumable bounded fan-out. No booking is created here. */
export const createWaitlistClass = onCallWithFreshAppCheck(scheduleCallableOptions, async (request): Promise<WaitlistClassResult> => {
  const actor = requireUserActor(request);
  if (actor.role !== "owner") throw new HttpsError("permission-denied", "Only the owner can create a class from Waitlist");
  const sourceSessionId = id(request.data?.sourceSessionId);
  const operationId = id(request.data?.operationId);
  if (operationId.length > 80) throw new HttpsError("invalid-argument", "Invalid operation reference");
  const db = getFirestore();
  const base = `academies/${actor.academyId}`;
  const opRef = db.doc(`${base}/waitlistClassOperations/${operationId}`);
  const sessionRef = db.doc(`${base}/sessions/waitlist-${operationId}`);
  const parsed = request.data?.session === undefined ? null : parseCreateSessionInput(request.data.session);
  if (parsed && !parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
  const sessionInput = parsed?.ok ? parsed.value : null;
  const fingerprint = sessionInput ? digest(JSON.stringify(sessionInput)) : null;
  await db.runTransaction(async (tx) => {
    const [operation, sourceDoc] = await tx.getAll(opRef, db.doc(`${base}/sessions/${sourceSessionId}`));
    if (operation!.exists) {
      const stored = operation!.data() as Operation;
      if (stored.sourceSessionId !== sourceSessionId || (fingerprint && stored.fingerprint !== fingerprint)) throw new HttpsError("already-exists", "This request already created a different class. Resume it from Waitlist.");
      return;
    }
    const source = sourceDoc!.data() as SessionRecord | undefined;
    if (!source || source.academyId !== actor.academyId || !ordinary(source)) throw new HttpsError("failed-precondition", "Select an ordinary class waitlist");
    const program = await tx.get(db.doc(`${base}/programs/${source.programId}`));
    if (isIntroductionClass(source, program.data())) throw new HttpsError("failed-precondition", "Select an ordinary class waitlist");
    if (!sessionInput) throw new HttpsError("invalid-argument", "The class details are required");
    if (sessionInput.repeatWeekly || sessionInput.isSeminar || (sessionInput.accessMode ?? "membership") !== "membership" ||
      sessionInput.programId !== source.programId || Date.parse(sessionInput.startAt) <= Math.max(Date.now(), Date.parse(source.startAt))) {
      throw new HttpsError("invalid-argument", "Choose a later date for the same class type, without weekly repetition");
    }
    const queue = await tx.get(db.collection(`${base}/waitlistEntries`).where("sessionId", "==", sourceSessionId).where("status", "in", ["waiting", "offered"]).limit(1));
    if (queue.empty) throw new HttpsError("failed-precondition", "There are no pending members in this waitlist");
    const now = new Date().toISOString();
    const session: SessionRecord = { ...sessionInput, sessionId: sessionRef.id, academyId: actor.academyId,
      classId: null, minParticipants: sessionInput.minParticipants ?? 4, status: "scheduled", isSeminar: false,
      cancellationReason: null, schemaVersion: "1", createdAt: now, createdBy: actor.userId,
      updatedAt: now, updatedBy: actor.userId };
    tx.create(sessionRef, session);
    if (session.ageCapacities?.length) tx.create(db.collection(`${base}/ageCapacityHistory`).doc(), { sessionId: session.sessionId, before: [], after: session.ageCapacities, actorId: actor.userId, at: now });
    tx.create(opRef, { sourceSessionId, sessionId: sessionRef.id, fingerprint, cursor: null, invited: 0,
      complete: false, createdAt: now, createdBy: actor.userId });
  });
  const operation = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(opRef);
    const op = snapshot.data() as Operation;
    if (op.complete) return op;
    let query = db.collection(`${base}/waitlistEntries`).where("sessionId", "==", sourceSessionId).orderBy(FieldPath.documentId()).limit(80);
    if (op.cursor) query = query.startAfter(op.cursor);
    const rows = await tx.get(query);
    const sourceDoc = await tx.get(db.doc(`${base}/sessions/${sourceSessionId}`));
    const candidates: Invitation[] = [];
    for (const document of rows.docs) {
      const entry = parseWaitlistEntryRecord(document.data());
      if (!entry.ok || entry.value.academyId !== actor.academyId || !pending(entry.value.status) || entry.value.requestedAt > op.createdAt) continue;
      const studentId = await resolveCanonicalStudentIdInTransaction(createMemberDirectoryReadTransaction(db, tx), actor.academyId, entry.value.studentId);
      if (await hasOriginalBooking(tx, actor.academyId, studentId, sourceSessionId)) continue;
      const invitationId = `${operationId}-${digest(studentId)}`;
      const existing = await tx.get(db.doc(`${base}/waitlistClassInvitations/${invitationId}`));
      if (existing.exists || candidates.some((row) => row.invitationId === invitationId)) continue;
      candidates.push({ academyId: actor.academyId, invitationId, operationId, sourceSessionId,
        sourceWaitlistId: document.id, sourceTitle: String(sourceDoc.data()?.title ?? "Class"), sessionId: op.sessionId,
        studentId, membershipId: entry.value.membershipId, status: "pending", createdAt: op.createdAt,
        createdBy: actor.userId, respondedAt: null, respondedBy: null });
    }
    for (const row of candidates) tx.create(db.doc(`${base}/waitlistClassInvitations/${row.invitationId}`), row);
    const updated: Operation = { ...op, invited: op.invited + candidates.length,
      cursor: rows.docs.at(-1)?.id ?? op.cursor, complete: rows.size < 80 };
    tx.set(opRef, updated);
    return updated;
  });
  return { operationId, session: (await sessionRef.get()).data() as SessionRecord, invited: operation.invited, complete: operation.complete };
});

async function invitationView(tx: Transaction, base: string, invitation: Invitation): Promise<WaitlistInvitationView | null> {
  const db = getFirestore();
  const [sessionDoc, source] = await tx.getAll(db.doc(`${base}/sessions/${invitation.sessionId}`), db.doc(`${base}/waitlistEntries/${invitation.sourceWaitlistId}`));
  const session = sessionDoc!.data() as SessionRecord | undefined;
  if (!session) return null;
  const closed = session.status !== "scheduled" || !isWithinBookingCutoff(session.startAt, new Date().toISOString(), 60) || !pending(source!.data()?.status) ||
    await hasOriginalBooking(tx, invitation.academyId, invitation.studentId, invitation.sourceSessionId);
  return { invitationId: invitation.invitationId, studentId: invitation.studentId, sourceSessionId: invitation.sourceSessionId,
    sourceTitle: invitation.sourceTitle, status: invitation.status === "pending" && closed ? "closed" : invitation.status,
    session: { sessionId: session.sessionId, title: session.title, locationId: session.locationId, startAt: session.startAt, endAt: session.endAt, updatedAt: session.updatedAt },
    createdAt: invitation.createdAt, respondedAt: invitation.respondedAt };
}

export const listWaitlistClassInvitations = onCallWithFreshAppCheck(scheduleCallableOptions, async (request): Promise<InvitationPage> => {
  const actor = requireUserActor(request);
  const studentId = id(request.data?.studentId);
  await requireMemberAccountActor(request);
  await requireStudentScope(request, studentId, getStudentScopeOptions());
  const db = getFirestore(), base = `academies/${actor.academyId}`;
  return db.runTransaction(async (tx) => {
    const canonical = await resolveCanonicalStudentIdInTransaction(createMemberDirectoryReadTransaction(db, tx), actor.academyId, studentId);
    let query = db.collection(`${base}/waitlistClassInvitations`).where("studentId", "==", canonical).where("status", "==", "pending").orderBy(FieldPath.documentId()).limit(31);
    if (request.data?.cursor) query = query.startAfter(id(request.data.cursor));
    const docs = await tx.get(query);
    const views = await Promise.all(docs.docs.slice(0, 30).map((doc) => invitationView(tx, base, doc.data() as Invitation)));
    for (const view of views) if (view?.status === "closed") tx.update(db.doc(`${base}/waitlistClassInvitations/${view.invitationId}`), { status: "closed" });
    return { invitations: views.filter((row): row is WaitlistInvitationView => row !== null), cursor: docs.size > 30 ? docs.docs[29]!.id : null };
  });
});

export const respondWaitlistClassInvitation = onCallWithFreshAppCheck(scheduleCallableOptions, async (request) => {
  const actor = requireUserActor(request);
  await requireMemberAccountActor(request);
  const studentId = id(request.data?.studentId), invitationId = id(request.data?.invitationId);
  await requireStudentScope(request, studentId, getStudentScopeOptions());
  const response = request.data?.response;
  if (response !== "accept" && response !== "decline") throw new HttpsError("invalid-argument", "Choose accept or decline");
  const db = getFirestore(), base = `academies/${actor.academyId}`;
  try {
    return await db.runTransaction(async (tx) => {
      const canonical = await resolveCanonicalStudentIdInTransaction(createMemberDirectoryReadTransaction(db, tx), actor.academyId, studentId);
      const ref = db.doc(`${base}/waitlistClassInvitations/${invitationId}`);
      const snapshot = await tx.get(ref);
      const invitation = snapshot.data() as Invitation | undefined;
      if (!invitation || invitation.academyId !== actor.academyId || invitation.studentId !== canonical) throw new HttpsError("not-found", "Invitation not found");
      if (invitation.status === (response === "accept" ? "accepted" : "declined")) return { status: invitation.status };
      if (invitation.status !== "pending") throw new HttpsError("failed-precondition", "This invitation has already been answered");
      const sourceRef = db.doc(`${base}/waitlistEntries/${invitation.sourceWaitlistId}`);
      const capacityRef = db.doc(`${base}/sessionCapacityStates/${invitation.sourceSessionId}`);
      const [sourceDoc, sessionDoc, capacityDoc] = await tx.getAll(sourceRef, db.doc(`${base}/sessions/${invitation.sessionId}`), capacityRef);
      const source = sourceDoc!.data();
      const session = sessionDoc!.data() as SessionRecord | undefined;
      const now = new Date().toISOString();
      if (!source || source.academyId !== actor.academyId || !pending(source.status) || !session || session.status !== "scheduled" || !isWithinBookingCutoff(session.startAt, now, 60)) throw new HttpsError("failed-precondition", "This invitation is no longer available");
      if (await hasOriginalBooking(tx, actor.academyId, canonical, invitation.sourceSessionId)) throw new HttpsError("failed-precondition", "You already have a place in the original class");
      let bookingId: string | null = null;
      if (response === "accept") {
        if (request.data.sessionRevision !== session.updatedAt) throw new HttpsError("failed-precondition", "The class details changed. Refresh and check the new date and time before confirming.");
        const identityIds = await canonicalMemberIdentityIds(createMemberDirectoryReadTransaction(db, tx), actor.academyId, canonical);
        const [memberships, existingBookings] = await Promise.all([
          tx.get(db.collection(`${base}/memberships`).where("studentId", "in", identityIds).limit(51)),
          tx.get(db.collection(`${base}/bookings`).where("sessionId", "==", invitation.sessionId).where("studentId", "in", identityIds).limit(50)),
        ]);
        if (memberships.size > 50 || existingBookings.size === 50) throw new HttpsError("failed-precondition", "Membership history needs review");
        const existingBooking = existingBookings.docs.find((doc) => doc.data().status === "confirmed");
        const candidates = memberships.docs.flatMap((doc) => {
          const parsed = parseMembershipRecord(doc.data());
          if (!parsed.ok || parsed.value.academyId !== actor.academyId) return [];
          const item = parsed.value;
          return ["active", "trial"].includes(item.status) && Date.parse(item.startsAt) <= Date.parse(session.startAt) && (item.endsAt === null || Date.parse(item.endsAt) > Date.parse(session.startAt)) ? [item.membershipId] : [];
        }).sort((left, right) => Number(right === invitation.membershipId) - Number(left === invitation.membershipId));
        const baseInput = { firestore: db as unknown as BookingFirestore, transaction: tx as unknown as BookingTransaction,
          academyId: actor.academyId, actorId: actor.userId, actorIp: clientIpFromRequest(request), actorRole: actor.role,
          now };
        let chosen: ConfirmBookingInTransactionInput | undefined;
        if (existingBooking && typeof existingBooking.data().membershipId === "string") {
          chosen = { ...baseInput, request: { sessionId: invitation.sessionId, studentId: canonical, membershipId: existingBooking.data().membershipId as string } };
        } else {
          for (const membershipId of candidates) {
            const candidate = { ...baseInput, request: { sessionId: invitation.sessionId, studentId: canonical, membershipId } };
            try { await validateBookingOfferInTransaction(candidate); chosen = candidate; break; }
            catch (error) {
              if (!(error instanceof BookingTransactionError) || !["ineligible", "financial", "weekly-limit"].includes(error.code)) throw error;
            }
          }
        }
        if (!chosen) throw new HttpsError("failed-precondition", "No current membership allows this booking. You remain on the original waitlist.");
        bookingId = (await confirmBookingInTransaction(chosen)).bookingId;
        // Cancel the original queue, not 'accepted': the historical offer replay expects a booking in its own session.
        tx.set(sourceRef, { ...source, status: source.status === "offered" && String(source.offerExpiresAt) <= now ? "expired" : "cancelled", cancelledAt: source.status === "offered" && String(source.offerExpiresAt) <= now ? null : now, updatedAt: now, updatedBy: actor.userId });
        tx.set(capacityRef, { academyId: actor.academyId, sessionId: invitation.sourceSessionId,
          revision: Number(capacityDoc!.data()?.revision ?? 0) + 1, schemaVersion: "1", updatedAt: now, updatedBy: actor.userId });
      }
      const status = response === "accept" ? "accepted" : "declined";
      tx.update(ref, { status, bookingId, respondedAt: now, respondedBy: actor.userId, acceptedRevision: response === "accept" ? session.updatedAt : null });
      tx.create(db.collection(`${base}/waitlistInvitationHistory`).doc(), { invitationId, sourceSessionId: invitation.sourceSessionId,
        sessionId: invitation.sessionId, studentId: canonical, bookingId, status, actorId: actor.userId, at: now });
      return { status };
    });
  } catch (error) {
    if (error instanceof BookingTransactionError) throw new HttpsError("failed-precondition", error.code === "capacity" ? "No places remain for this class or age. You are still on the original waitlist." : "This booking does not meet the current membership or booking rules. You remain on the waitlist.");
    throw error;
  }
});

export const listWaitlistClassHistory = onCallWithFreshAppCheck(scheduleCallableOptions, async (request) => {
  const actor = requireUserActor(request);
  if (actor.role !== "owner") throw new HttpsError("permission-denied", "Owner access required");
  const sourceSessionId = request.data?.sourceSessionId === undefined ? undefined : id(request.data.sourceSessionId);
  const db = getFirestore(), base = `academies/${actor.academyId}`;
  let query = db.collection(`${base}/waitlistClassOperations`).orderBy(FieldPath.documentId()).limit(21);
  if (sourceSessionId) query = query.where("sourceSessionId", "==", sourceSessionId);
  if (request.data?.cursor) query = query.startAfter(id(request.data.cursor));
  const docs = await query.get();
  const operations = await Promise.all(docs.docs.slice(0, 20).map(async (doc) => {
    const op = doc.data() as Operation;
    const [sessionDoc, sourceDoc] = await db.getAll(db.doc(`${base}/sessions/${op.sessionId}`), db.doc(`${base}/sessions/${op.sourceSessionId}`));
    const session = sessionDoc!.data() as SessionRecord;
    const source = sourceDoc!.data() as SessionRecord | undefined;
    const counts = await Promise.all(["pending", "accepted", "declined"].map(async (status) =>
      (await db.collection(`${base}/waitlistClassInvitations`).where("operationId", "==", doc.id).where("status", "==", status).count().get()).data().count));
    return { operationId: doc.id, session, sourceSessionId: op.sourceSessionId, sourceTitle: source?.title ?? "Original class", sourceStartAt: source?.startAt ?? null, invited: op.invited, complete: op.complete,
      responses: { pending: counts[0]!, accepted: counts[1]!, declined: counts[2]! } };
  }));
  return { operations, cursor: docs.size > 20 ? docs.docs[19]!.id : null };
});
