import { resolveCanonicalStudentIdInTransaction } from "../members/member-identity-resolution.js";
import { createMemberDirectoryReadTransaction } from "../members/member-directory-firestore.js";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createMemberAccessService, memberAccessDependenciesInTransaction } from "../members/member-access-service.js";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { parseEffectiveStudentProfileAt } from "@bpt-jersey/domain/profiles";
import {
  saveStudentGroupAccessSchema,
  studentGroupAccessQuerySchema,
  studentGroupAccessSchema,
} from "@bpt-jersey/domain/schedule/member-calendar";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { createFirestoreCanonicalClientStudentScopeResolver } from "./canonical-client-student-scope.js";

const resolveScope = createFirestoreCanonicalClientStudentScopeResolver();

function readStudent(data: unknown, academyId: string, studentId: string) {
  const parsed = parseEffectiveStudentProfileAt(data, dateKeyInJersey(new Date()));
  if (!parsed.ok || parsed.value.academyId !== academyId || parsed.value.studentId !== studentId) {
    throw new HttpsError("not-found", "Member record is unavailable.");
  }
  return parsed.value;
}

function readAccess(data: FirebaseFirestore.DocumentData | undefined, academyId: string, studentId: string, dateOfBirth: string | undefined) {
  if (data && (data.academyId !== academyId || data.studentId !== studentId)) {
    throw new HttpsError("failed-precondition", "Group access is unavailable.");
  }
  const result = studentGroupAccessSchema.safeParse({
    studentId,
    programIds: data?.programIds ?? [],
    revision: data?.revision ?? 0,
    dateOfBirth: dateOfBirth ?? null,
  });
  if (!result.success) throw new HttpsError("failed-precondition", "Group access is unavailable.");
  return result.data;
}

export const getStudentGroupAccess = onCall(browserAdminCallableOptions, async (request) => {
  const input = studentGroupAccessQuerySchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Select a member.");
  const actor = requireUserActor(request);
  if (actor.role === "owner" || actor.role === "administrator") {
    await requireActiveOfficeActor(request);
  } else if (
    (actor.role !== "guardian" && actor.role !== "adultStudent" && actor.role !== "teenStudent") ||
    !(await resolveScope({ academyId: actor.academyId, actorUserId: actor.userId,
      actorRole: actor.role, requestedStudentId: input.data.studentId }))
  ) {
    throw new HttpsError("permission-denied", "Access denied for this member.");
  }
  const db = getFirestore();
  const base = `academies/${actor.academyId}`;
  const member = actor.role !== "owner" && actor.role !== "administrator";
  if (member) await requireMemberAccountActor(request);
  return db.runTransaction(async (tx) => {
    if (member && !(await createMemberAccessService(memberAccessDependenciesInTransaction(db, tx))
      .authorise(actor.academyId, actor.userId, input.data.studentId)).allowed) {
      throw new HttpsError("permission-denied", "Member profile is unavailable");
    }
    const studentId = await resolveCanonicalStudentIdInTransaction(createMemberDirectoryReadTransaction(db, tx), actor.academyId, input.data.studentId);
    const [student, access] = await tx.getAll(db.doc(`${base}/students/${studentId}`),
      db.doc(`${base}/studentGroupAccess/${studentId}`));
    const profile = readStudent(student!.data(), actor.academyId, studentId);
    return readAccess(access!.data(), actor.academyId, profile.studentId, profile.dateOfBirth);
  });
});

export const saveStudentGroupAccess = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const parsed = saveStudentGroupAccessSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check the selected groups.");
  const input = parsed.data;
  const db = getFirestore();
  const base = `academies/${actor.academyId}`;
  const accessRef = db.doc(`${base}/studentGroupAccess/${input.studentId}`);
  const eventRef = db.collection(`${base}/studentGroupAccessEvents`).doc();
  return db.runTransaction(async (transaction) => {
    const [studentSnapshot, accessSnapshot] = await transaction.getAll(
      db.doc(`${base}/students/${input.studentId}`), accessRef,
    );
    const student = readStudent(studentSnapshot!.data(), actor.academyId, input.studentId);
    const previous = readAccess(accessSnapshot!.data(), actor.academyId, input.studentId, student.dateOfBirth);
    if (previous.revision !== input.revision) {
      throw new HttpsError("aborted", "Group access changed. Reload before saving.");
    }
    // Retired grants can always be removed. Every newly granted group must exist and be active.
    for (const programId of input.programIds) {
      if (previous.programIds.includes(programId)) continue;
      const program = await transaction.get(db.doc(`${base}/programs/${programId}`));
      const data = program.data();
      if (!program.exists || data?.academyId !== actor.academyId || data?.programId !== programId || data?.active !== true) {
        throw new HttpsError("failed-precondition", "One of the selected groups is no longer available.");
      }
    }
    const next = { ...previous, programIds: [...input.programIds].sort(), revision: previous.revision + 1 };
    const changedAt = new Date().toISOString();
    transaction.set(accessRef, {
      academyId: actor.academyId, studentId: input.studentId,
      programIds: next.programIds, revision: next.revision,
      updatedBy: actor.userId, updatedAt: changedAt,
    });
    transaction.create(eventRef, {
      academyId: actor.academyId, studentId: input.studentId,
      before: previous.programIds, after: next.programIds,
      revision: next.revision, actorId: actor.userId, actorRole: actor.role,
      occurredAt: changedAt, action: "member.group-access.updated",
    });
    return next;
  });
});
