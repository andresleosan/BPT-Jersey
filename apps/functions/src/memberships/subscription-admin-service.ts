import { canonicalMemberIdentityIds } from "../members/member-identity-resolution.js";
import { createMemberDirectoryReadTransaction } from "../members/member-directory-firestore.js";
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { UserActorContext } from "@bpt-jersey/domain";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { parsePlanRecord, type PlanRecord } from "@bpt-jersey/domain/memberships";
import {
  parseMembershipRecord,
  type MembershipRecord,
} from "@bpt-jersey/domain/memberships/lifecycle";
import { parseStudentProfile, type StudentProfile } from "@bpt-jersey/domain/profiles";
import {
  addSubscriptionMonth,
  adminNotificationSchema,
  editableSubscriptionSchema,
  type SubscriptionEdit,
  type MemberSubscriptionContext,
} from "@bpt-jersey/domain/memberships/admin";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { expiryNotificationId } from "../notifications/notification-identifiers.js";

function invalid(message: string): never {
  throw new HttpsError("failed-precondition", message);
}

function studentRecord(data: unknown, academyId: string, studentId: string): StudentProfile {
  const parsed = parseStudentProfile(data);
  if (!parsed.ok || parsed.value.academyId !== academyId || parsed.value.studentId !== studentId) {
    return invalid("Member is unavailable.");
  }
  return parsed.value;
}

function membershipRecord(
  data: unknown,
  academyId: string,
  membershipId: string,
): MembershipRecord {
  const parsed = parseMembershipRecord(data);
  if (
    !parsed.ok ||
    parsed.value.academyId !== academyId ||
    parsed.value.membershipId !== membershipId
  ) {
    return invalid("Subscription is unavailable.");
  }
  return parsed.value;
}

// An office administrator may deliberately assign any active catalogue plan.
// Class booking still applies the plan's participant and site restrictions.
function eligible(plan: PlanRecord, student: StudentProfile): boolean {
  return plan.academyId === student.academyId && plan.active;
}

function project(record: MembershipRecord) {
  return editableSubscriptionSchema.parse({
    membershipId: record.membershipId,
    studentId: record.studentId,
    planId: record.planId,
    status: record.status,
    startsAt: new Date(record.startsAt).toISOString(),
    endsAt: record.endsAt === null ? null : new Date(record.endsAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  });
}

export async function listMemberSubscriptionRecords(
  db: Firestore,
  academyId: string,
  studentId: string,
): Promise<MemberSubscriptionContext> {
  const base = db.doc(`academies/${academyId}`);
  return db.runTransaction(async (tx) => {
    const ids = await canonicalMemberIdentityIds(createMemberDirectoryReadTransaction(db, tx), academyId, studentId);
    const canonicalId = ids[0]!;
    const [studentDoc, membershipPages, plans] = await Promise.all([
      tx.get(base.collection("students").doc(canonicalId)),
      Promise.all(ids.map((id) => tx.get(base.collection("memberships").where("studentId", "==", id).limit(101)))),
      tx.get(base.collection("plans").where("active", "==", true).limit(101)),
    ]);
    const memberships = { docs: membershipPages.flatMap((page) => page.docs), size: membershipPages.reduce((n, page) => n + page.size, 0) };
    if (plans.size > 100) invalid("The plan catalogue requires review.");
    const studentData = studentDoc.data();
    if (studentData === undefined) throw new HttpsError("not-found", "Member record unavailable.");
    const student = studentRecord(studentData, academyId, canonicalId);
    if (memberships.size > 100) invalid("Too many subscriptions for this member. Contact support.");
    return {
      studentId: canonicalId,
      fullName: student.fullName,
      eligiblePlanIds: plans.docs.flatMap((doc) => {
        const plan = parsePlanRecord(doc.data());
        return plan.ok && plan.value.planId === doc.id && eligible(plan.value, student)
          ? [plan.value.planId]
          : [];
      }),
      memberships: memberships.docs
        .filter((doc) => {
          if (doc.get("source") === "legacy-import") return false;
          if (doc.get("source") !== undefined) invalid("Unsupported membership source.");
          return true;
        })
        .map((doc) => {
          const membership = membershipRecord(doc.data(), academyId, doc.id);
          if (!ids.includes(membership.studentId)) invalid("Subscription is unavailable.");
          return project(membership);
        })
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    };
  });
}

export async function editMemberSubscription(
  db: Firestore,
  actor: UserActorContext,
  input: SubscriptionEdit,
) {
  const base = db.doc(`academies/${actor.academyId}`);
  const reference = base.collection("memberships").doc(input.membershipId);
  const receiptRef = base.collection("membershipChanges").doc(input.requestId);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ actorId: actor.userId, input }))
    .digest("hex");
  return db.runTransaction(async (transaction) => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) {
      if (receipt.get("fingerprint") !== fingerprint)
        throw new HttpsError("already-exists", "Request was already used.");
      return editableSubscriptionSchema.parse(receipt.get("result"));
    }
    const current = membershipRecord(
      (await transaction.get(reference)).data(),
      actor.academyId,
      input.membershipId,
    );
    if (new Date(current.updatedAt).toISOString() !== input.expectedUpdatedAt) {
      throw new HttpsError("aborted", "Subscription changed. Refresh before saving.");
    }
    if (current.status === "cancelled") invalid("Cancelled subscriptions cannot be edited.");
    const student = studentRecord(
      (await transaction.get(base.collection("students").doc(current.studentId))).data(),
      actor.academyId,
      current.studentId,
    );
    if (!student.active || student.status !== "active")
      invalid("Member must be active before editing their subscription.");
    const planId = input.operation === "save" ? input.planId : current.planId;
    const plan = parsePlanRecord(
      (await transaction.get(base.collection("plans").doc(planId))).data(),
    );
    const now = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
    if (!plan.ok || plan.value.planId !== planId || !eligible(plan.value, student))
      invalid("Choose an active catalogue plan.");
    const endsAt =
      input.operation === "save"
        ? input.endsAt
        : addSubscriptionMonth(
            new Date(
              Math.max(Date.now(), current.endsAt ? Date.parse(current.endsAt) : 0),
            ).toISOString(),
          );
    if (endsAt !== null && Date.parse(endsAt) <= Date.parse(current.startsAt))
      invalid("End date must be after the subscription start.");
    const oldNoticeRef =
      current.endsAt === null
        ? null
        : base
            .collection("adminNotifications")
            .doc(expiryNotificationId(current.membershipId, current.endsAt));
    const oldNotice = oldNoticeRef === null ? null : await transaction.get(oldNoticeRef);
    if (input.operation === "extend-month" && input.notificationId) {
      const source = await transaction.get(
        base.collection("adminNotifications").doc(input.notificationId),
      );
      const notice = adminNotificationSchema.safeParse(source.data());
      if (
        !notice.success ||
        notice.data.kind !== "subscription-expiring" ||
        notice.data.resolvedAt !== null ||
        notice.data.membershipId !== current.membershipId ||
        notice.data.studentId !== current.studentId ||
        notice.data.endsAt !== (current.endsAt ? new Date(current.endsAt).toISOString() : null)
      ) {
        throw new HttpsError(
          "aborted",
          "This reminder has already been resolved. Refresh before continuing.",
        );
      }
    }
    const updated = { ...current, planId, endsAt, updatedAt: now, updatedBy: actor.userId };
    if (!parseMembershipRecord(updated).ok) invalid("Invalid subscription update.");
    const result = project(updated);
    transaction.set(reference, updated);
    transaction.create(receiptRef, { fingerprint, result, createdAt: now });
    if (oldNoticeRef && oldNotice?.exists && endsAt !== current.endsAt)
      transaction.update(oldNoticeRef, { resolvedAt: now, readAt: now });
    const auditRef = base.collection("auditEvents").doc();
    appendAuditEventInTransaction(transaction, auditRef, {
      academyId: actor.academyId,
      actorId: actor.userId,
      action: "membership.subscription.updated",
      targetRef: reference.path,
      purpose:
        input.operation === "save"
          ? "updated subscription plan and end date"
          : "extended subscription by one month",
      correlationId: input.requestId,
    } as AuditEventDraft);
    return result;
  });
}
