import { createHmac } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { courseAge, courseCandidateInputSchema, participantRefSchema, type CourseCandidate, type CourseEnrolment, type ParticipantRef, type ParticipantScope } from "@bpt-jersey/domain/courses";
import { parseUserProfile } from "@bpt-jersey/domain/profiles";
import { createCanonicalMemberDirectoryService } from "../members/canonical-member-directory-service.js";
import { createMemberDirectoryFirestoreAdapters } from "../members/member-directory-firestore.js";
import { createFamilyStore } from "../families/family-service.js";
import { requireCourseApplicant } from "./course-authorization.js";
import { assertCourseActorLive, assertCourseOffice, assertCourseRevision, courseCollection, courseData, courseFailure, type CourseActor } from "./course-store.js";

const normalizedName = (name: string) => name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-GB");
export type CourseIdentityDependencies = {
  projectId: string; identitySecretMaterial: string; integritySecretMaterial: string;
};

/** Transaction variant keeps relationship revocation and reservation in the same snapshot. */
export async function resolveCourseParticipantInTransaction(db: Firestore, tx: Transaction, actor: CourseActor, input: ParticipantRef): Promise<ParticipantScope> {
  const parsed = participantRefSchema.safeParse(input);
  if (!parsed.success) courseFailure("invalid", "Choose a participant.");
  const ref = parsed.data;
  if (ref.kind === "candidate") {
    const candidate = courseData<CourseCandidate>(await tx.get(courseCollection(db, actor.academyId, "courseCandidates").doc(ref.candidateId)));
    if (candidate.applicantUid !== actor.uid || candidate.academyId !== actor.academyId) courseFailure("forbidden", "This participant is not available to your account.");
    if (candidate.canonicalStudentId) return resolveCourseParticipantInTransaction(db, tx, actor, {kind: "student", studentId: candidate.canonicalStudentId});
    // Reuse an existing canonical identity before allocating a candidate seat.
    const families = candidate.kind === "minor" ? await tx.get(courseCollection(db, actor.academyId, "families").where("primaryContactUserId", "==", actor.uid).where("active", "==", true).limit(2)) : null;
    if (families && families.size > 1) courseFailure("conflict", "Multiple family records require office review.");
    const familyId = families?.docs[0]?.id;
    const existing = candidate.kind === "adult"
      ? await tx.get(courseCollection(db, actor.academyId, "students").where("userId", "==", actor.uid).limit(2))
      : familyId ? await tx.get(courseCollection(db, actor.academyId, "students").where("familyId", "==", familyId).limit(31)) : null;
    if (existing && existing.size > 30) courseFailure("conflict", "This family requires office review.");
    const matches = existing?.docs.filter(d => candidate.kind === "adult" || (normalizedName(String(d.data().fullName)) === normalizedName(candidate.fullName) && d.data().dateOfBirth === candidate.dateOfBirth)) ?? [];
    if (matches.length > 1) courseFailure("conflict", "Participant identity requires office review.");
    if (matches[0]) return resolveCourseParticipantInTransaction(db, tx, actor, {kind: "student", studentId: matches[0].id});
    return {participant: ref, participantKey: candidate.kind === "adult" ? `account:${actor.uid}` : `candidate:${candidate.candidateId}`, fullName: candidate.fullName, dateOfBirth: candidate.dateOfBirth, studentId: null};
  }
  const student = (await tx.get(courseCollection(db, actor.academyId, "students").doc(ref.studentId))).data();
  if (!student || student.academyId !== actor.academyId || student.active !== true || student.status !== "active" || typeof student.dateOfBirth !== "string") courseFailure("forbidden", "An active participant with a date of birth is required.");
  if (student.userId !== actor.uid) {
    const relationships = await tx.get(courseCollection(db, actor.academyId, "relationships").where("adultUserId", "==", actor.uid).where("studentId", "==", ref.studentId).limit(30));
    const now = new Date().toISOString();
    const relation = relationships.docs.map(d => d.data()).find(r => r.academyId === actor.academyId && r.active === true && r.status === "active" && r.validFrom <= now && (!r.validTo || r.validTo >= now));
    if (!relation || relation.familyId !== student.familyId) courseFailure("forbidden", "An active family relationship is required.");
    const family = (await tx.get(courseCollection(db, actor.academyId, "families").doc(relation.familyId))).data();
    if (!family || family.active !== true || family.status !== "active" || family.primaryContactUserId !== actor.uid) courseFailure("forbidden", "This family is not available to your account.");
  }
  // Canonical aliases survive candidate conversion, so neither form can buy a second seat.
  const alias = (await tx.get(courseCollection(db, actor.academyId, "courseStudentAliases").doc(ref.studentId))).data();
  return {participant: ref, participantKey: typeof alias?.participantKey === "string" ? alias.participantKey : student.userId ? `account:${student.userId}` : `student:${ref.studentId}`, fullName: String(student.fullName), dateOfBirth: student.dateOfBirth, studentId: ref.studentId};
}
export function resolveCourseParticipant(db: Firestore, actor: CourseActor, ref: ParticipantRef): Promise<ParticipantScope> {
  return db.runTransaction(tx => resolveCourseParticipantInTransaction(db, tx, actor, ref));
}

export async function saveCourseCandidate(db: Firestore, actor: CourseActor, value: unknown, identitySecret: string): Promise<CourseCandidate> {
  requireCourseApplicant(actor);
  const parsed = courseCandidateInputSchema.safeParse(value);
  if (!parsed.success) courseFailure("invalid", "Complete the participant and contact details.");
  const input = parsed.data;
  const today = new Date().toISOString().slice(0, 10);
  const age = courseAge(input.dateOfBirth, today);
  if (input.dateOfBirth > today || age > 120 || (input.kind === "adult" ? age < 18 : age >= 18 || !input.guardianDeclaration)) courseFailure("invalid", "Check the participant's age and guardian declaration.");
  const identity = input.kind === "adult" ? [actor.academyId, actor.uid, "adult"] : [actor.academyId, actor.uid, normalizedName(input.fullName), input.dateOfBirth];
  const key = createHmac("sha256", identitySecret).update(JSON.stringify(identity)).digest("hex");
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const indexRef = courseCollection(db, actor.academyId, "courseCandidateKeys").doc(key);
    const index = await tx.get(indexRef);
    const id = index.data()?.candidateId ?? input.candidateId;
    const ref = courseCollection(db, actor.academyId, "courseCandidates").doc(id);
    const old = await tx.get(ref);
    if (old.exists) {
      const candidate = courseData<CourseCandidate>(old);
      if (candidate.applicantUid !== actor.uid) courseFailure("forbidden", "This participant is not available.");
      if (candidate.candidateId !== input.candidateId || candidate.frozen) return candidate;
      assertCourseRevision(candidate.revision, input.revision);
      if (candidate.kind !== input.kind || candidate.fullName !== input.fullName || candidate.dateOfBirth !== input.dateOfBirth) courseFailure("conflict", "Contact the office to correct an existing participant's identity.");
    } else if (input.revision !== 0) courseFailure("conflict", "Refresh the participant form.");
    const {guardianDeclaration: _declaration, ...details} = input;
    const candidate: CourseCandidate = {...details, candidateId: id, academyId: actor.academyId, applicantUid: actor.uid, revision: (old.data()?.revision ?? 0) + 1, frozen: false, canonicalStudentId: null};
    tx.set(ref, candidate);
    tx.set(indexRef, {candidateId: id, applicantUid: actor.uid});
    return candidate;
  });
}

type IdentityPlan = {state: "planned" | "complete"; mode: "adult" | "createFamily" | "addStudent" | "existing"; familyId: string | null; studentId: string | null};
/** Provisioning is restartable; the financial transaction alone will grant course access. */
export async function ensureApprovedCourseStudent(db: Firestore, office: CourseActor, enrolmentId: string, dependencies: CourseIdentityDependencies): Promise<{studentId: string; familyId: string | null}> {
  assertCourseOffice(office);
  const enrolment = courseData<CourseEnrolment>(await courseCollection(db, office.academyId, "courseEnrolments").doc(enrolmentId).get());
  if (!enrolment.proofId || !["review", "expired", "rejected", "cancelled"].includes(enrolment.status)) courseFailure("conflict", "This payment is not awaiting an identity decision.");
  const account = await getAuth().getUser(enrolment.applicantUid);
  if (account.disabled || account.customClaims?.academyId !== office.academyId || account.customClaims?.role === "teenStudent") courseFailure("forbidden", "The applicant's account is not available.");
  const applicant: CourseActor = {uid: account.uid, academyId: office.academyId, role: String(account.customClaims?.role)};
  const scope = await resolveCourseParticipant(db, applicant, enrolment.participant);
  if (scope.studentId && enrolment.participant.kind === "student") {
    const student = (await courseCollection(db, office.academyId, "students").doc(scope.studentId).get()).data();
    return {studentId: scope.studentId, familyId: student?.familyId ?? null};
  }
  if (enrolment.participant.kind !== "candidate") courseFailure("conflict", "Participant identity requires office review.");
  const candidateRef = courseCollection(db, office.academyId, "courseCandidates").doc(enrolment.participant.candidateId);
  const candidate = courseData<CourseCandidate>(await candidateRef.get());
  const receiptRef = courseCollection(db, office.academyId, "courseIdentityReceipts").doc(candidate.candidateId);
  const plan = await db.runTransaction(async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) return receipt.data() as IdentityPlan;
    const families = await tx.get(courseCollection(db, office.academyId, "families").where("primaryContactUserId", "==", account.uid).where("active", "==", true).limit(2));
    if (families.size > 1) courseFailure("conflict", "Multiple family records require office review.");
    const familyId = families.docs[0]?.id ?? null;
    const existing = candidate.kind === "adult"
      ? await tx.get(courseCollection(db, office.academyId, "students").where("userId", "==", account.uid).limit(2))
      : familyId ? await tx.get(courseCollection(db, office.academyId, "students").where("familyId", "==", familyId).limit(31)) : null;
    if (existing && existing.size > 30) courseFailure("conflict", "This family requires office review.");
    const matches = existing?.docs.filter(d => candidate.kind === "adult" || (normalizedName(String(d.data().fullName)) === normalizedName(candidate.fullName) && d.data().dateOfBirth === candidate.dateOfBirth)) ?? [];
    if (matches.length > 1) courseFailure("conflict", "Participant identity is ambiguous. Contact the office.");
    const matching = matches[0];
    if (matching && (matching.data().active !== true || matching.data().status !== "active")) courseFailure("conflict", "The existing participant requires office review.");
    const next: IdentityPlan = {state: "planned", mode: matching ? "existing" : candidate.kind === "adult" ? "adult" : familyId ? "addStudent" : "createFamily", studentId: matching?.id ?? null, familyId: matching?.data().familyId ?? familyId};
    tx.create(receiptRef, next);
    return next;
  });
  let result: {studentId: string; familyId: string | null};
  const now = new Date().toISOString();
  const control = {...dependencies, identitySecretVersion: "identity-v1", integritySecretVersion: "integrity-v1"};
  const draft = {fullName: candidate.fullName, dateOfBirth: candidate.dateOfBirth, phoneNumber: candidate.contactPhone, trainingCenter: candidate.trainingCenter, trainingTimePreferences: candidate.trainingTimePreferences};
  if (plan.studentId) result = {studentId: plan.studentId, familyId: plan.familyId};
  else if (plan.mode === "adult") {
    const directory = createCanonicalMemberDirectoryService({...control, firestore: createMemberDirectoryFirestoreAdapters(db).writer});
    const created = await directory.createAdminAdultForAccount({actor: {actorId: office.uid, academyId: office.academyId, role: office.role as "owner" | "administrator", active: true, appCheckVerified: true}, value: {...draft, requestId: candidate.candidateId}, account: {userId: account.uid, displayName: candidate.fullName, email: candidate.contactEmail}, courseEnrolmentId: enrolmentId, now});
    const student = (await courseCollection(db, office.academyId, "students").doc(created.studentId).get()).data();
    result = {studentId: created.studentId, familyId: student?.familyId ?? null};
  } else {
    const contact = parseUserProfile({userId: account.uid, academyId: office.academyId, accountType: "client", displayName: candidate.applicantName, email: candidate.contactEmail, phoneNumber: candidate.contactPhone, active: true, status: "active", schemaVersion: "1", createdAt: now, createdBy: office.uid, updatedAt: now, updatedBy: office.uid});
    if (!contact.ok) courseFailure("invalid", "Complete the guardian's contact details before approval.");
    await courseCollection(db, office.academyId, "courseParticipantAccounts").doc(account.uid).set(contact.value);
    const families = createFamilyStore({firestore: db as unknown as Parameters<typeof createFamilyStore>[0]["firestore"], canonicalControl: control, auth: {getUser: uid => getAuth().getUser(uid)}});
    const common = {academyId: office.academyId, actorId: office.uid, actorRole: office.role as "owner" | "administrator", courseEnrolmentId: enrolmentId, now};
    const created = plan.mode === "addStudent" && plan.familyId
      ? await families.updateFamily({...common, familyId: plan.familyId, operation: {kind: "addStudent", requestId: candidate.candidateId, student: draft}})
      : await families.createFamily({...common, requestId: candidate.candidateId, tutorUserId: account.uid, students: [draft]});
    const matches = created.students.filter(s => normalizedName(s.fullName) === normalizedName(candidate.fullName) && s.dateOfBirth === candidate.dateOfBirth);
    if (matches.length !== 1) courseFailure("conflict", "Participant identity requires office review.");
    result = {studentId: matches[0]!.studentId, familyId: created.family.familyId};
  }
  // Recheck actual canonical authority before persisting an alias or returning an identity.
  await resolveCourseParticipant(db, applicant, {kind: "student", studentId: result.studentId});
  await db.runTransaction(async tx => {
    const live = courseData<CourseCandidate>(await tx.get(candidateRef));
    const aliasRef = courseCollection(db, office.academyId, "courseStudentAliases").doc(result.studentId);
    const alias = await tx.get(aliasRef);
    if (live.canonicalStudentId && live.canonicalStudentId !== result.studentId) courseFailure("conflict", "Participant identity changed.");
    if (alias.exists && alias.data()?.participantKey !== enrolment.participantKey) courseFailure("conflict", "Participant identity already has another course record. Office reconciliation is required.");
    tx.set(receiptRef, {...plan, ...result, state: "complete"});
    tx.update(candidateRef, {canonicalStudentId: result.studentId, frozen: true});
    tx.set(aliasRef, {participantKey: enrolment.participantKey});
  });
  return result;
}
