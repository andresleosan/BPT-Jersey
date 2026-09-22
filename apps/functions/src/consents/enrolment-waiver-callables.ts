import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  enrolmentWaiverTermsContentHash,
  enrolmentWaiverTermsVersion,
} from "@bpt-jersey/domain/consents/enrolment-waiver";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";

/**
 * Members who joined before the online enrolment never accepted its waiver. Each student accepts
 * the current version once, by the adult themselves or by their guardian; the record names the
 * version and the hash of the text on screen. A teen account sees nothing: their guardian accepts.
 */
const acceptanceCollection = "enrolmentWaiverAcceptances";
// One document per student and version, so a later rewording never overwrites earlier evidence.
const acceptancePath = (base: string, studentId: string) =>
  `${base}/${acceptanceCollection}/${studentId}__${enrolmentWaiverTermsVersion}`;
const acceptSchema = z.strictObject({
  version: z.literal(enrolmentWaiverTermsVersion),
  studentIds: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u)).min(1).max(20),
});

async function pendingStudents(academyId: string, userId: string, role: string) {
  if (role === "teenStudent") return [];
  const db = getFirestore();
  const base = `academies/${academyId}`;
  const [profiles, requests] = await Promise.all([
    createFirestoreMemberAccessService().listProfiles(academyId, userId),
    // Students approved from an online enrolment this account sent already accepted this version.
    db.collection(`${base}/enrolmentRequests`).where("submittedBy", "==", userId).limit(20).get(),
  ]);
  const enrolled = new Set(
    requests.docs
      .filter(
        (doc) =>
          doc.get("status") === "approved" &&
          doc.get("waiverAcceptance.version") === enrolmentWaiverTermsVersion,
      )
      .flatMap((doc) => (doc.get("approvedStudentIds") as string[] | undefined) ?? []),
  );
  const candidates = profiles.filter((profile) => !enrolled.has(profile.studentId));
  if (candidates.length === 0) return [];
  const accepted = await db.getAll(
    ...candidates.map((profile) => db.doc(acceptancePath(base, profile.studentId))),
  );
  return candidates.filter((_profile, index) => !accepted[index]?.exists);
}

export const getEnrolmentWaiverStatus = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireMemberAccountActor(request);
  if (request.data !== null) throw new HttpsError("invalid-argument", "Invalid waiver request");
  const pending = await pendingStudents(actor.academyId, actor.userId, actor.role);
  return {
    version: enrolmentWaiverTermsVersion,
    pending: pending.map(({ studentId, fullName }) => ({ studentId, fullName })),
  };
});

export const acceptEnrolmentWaiver = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireMemberAccountActor(request);
  const input = acceptSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Reload the page to read the current waiver");
  const allowed = new Set(
    (await pendingStudents(actor.academyId, actor.userId, actor.role)).map((p) => p.studentId),
  );
  const studentIds = [...new Set(input.data.studentIds)].filter((id) => allowed.has(id));
  const db = getFirestore();
  const acceptedAt = new Date().toISOString();
  const batch = db.batch();
  for (const studentId of studentIds) {
    batch.create(db.doc(acceptancePath(`academies/${actor.academyId}`, studentId)), {
      academyId: actor.academyId,
      studentId,
      version: enrolmentWaiverTermsVersion,
      contentHash: enrolmentWaiverTermsContentHash,
      acceptedBy: actor.userId,
      acceptedAt,
      schemaVersion: "1",
    });
  }
  if (studentIds.length > 0) await batch.commit();
  return { accepted: studentIds };
});
