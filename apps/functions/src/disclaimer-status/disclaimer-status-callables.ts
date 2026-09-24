/**
 * Q5 / R14-R15: whether each participant may use the calendar, and the office audit of it.
 *
 * A participant is clear when they accepted the current academy terms (the same rule the booking
 * transaction enforces, `hasAcceptedEnrolmentWaiver`) and no required T117 disclaimer that applies
 * to them is outstanding (the same `deriveOutstandingDisclaimers` the disclaimer service runs).
 * The disclaimers are derived here rather than through `DisclaimerService.getOutstandingDisclaimers`
 * because that call refuses a teen reading their own profile and has no office view; the inputs
 * and the derivation are the same.
 *
 * Operator decision (Luis, 2026-09-24): the office audit lists names per student for the academy
 * terms. That overrides the T117 "counts, never who" rule for this audit only.
 */
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  deriveOutstandingDisclaimers,
  parseDisclaimer,
  parseDisclaimerAcceptance,
  type Disclaimer,
  type DisclaimerAcceptance,
  type ParticipantType,
} from "@bpt-jersey/domain/consents/disclaimers";
import { enrolmentWaiverTermsVersion } from "@bpt-jersey/domain/consents/enrolment-waiver";
import { parseEffectiveStudentProfileAt } from "@bpt-jersey/domain/profiles";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { office as requireDisclaimerOffice } from "../consents/disclaimer-callables.js";
import { hasAcceptedEnrolmentWaiver } from "../consents/enrolment-waiver-acceptance.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";

const statusRequestSchema = z.strictObject({}).nullish();
const acceptancesRequestSchema = z.strictObject({ missingOnly: z.boolean() });

async function readDisclaimers(db: Firestore, academyId: string): Promise<Disclaimer[]> {
  const snapshot = await db.collection(`academies/${academyId}/disclaimers`).get();
  return snapshot.docs.flatMap((doc) => {
    const parsed = parseDisclaimer(doc.data());
    return parsed.ok && parsed.value.academyId === academyId ? [parsed.value] : [];
  });
}

function parseAcceptances(
  docs: readonly { data: () => unknown }[],
  academyId: string,
): DisclaimerAcceptance[] {
  return docs.flatMap((doc) => {
    const parsed = parseDisclaimerAcceptance(doc.data());
    return parsed.ok && parsed.value.academyId === academyId ? [parsed.value] : [];
  });
}

function participantTypeOf(data: unknown, now: string): ParticipantType | null {
  const parsed = parseEffectiveStudentProfileAt(data, dateKeyInJersey(new Date(now)));
  return parsed.ok ? parsed.value.participantType : null;
}

/**
 * True when no required disclaimer is outstanding. A profile whose age cannot be read is checked
 * against both audiences, so an unreadable profile never skips a disclaimer.
 */
function disclaimersClear(
  disclaimers: readonly Disclaimer[],
  acceptances: readonly DisclaimerAcceptance[],
  studentId: string,
  participantType: ParticipantType | null,
  now: string,
): boolean {
  const types: ParticipantType[] = participantType ? [participantType] : ["adult", "minor"];
  return types.every(
    (type) =>
      !deriveOutstandingDisclaimers({
        disclaimers,
        acceptances,
        studentId,
        participantType: type,
        now,
      }).some((entry) => entry.disclaimer.required),
  );
}

export const getMyDisclaimerStatus = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireMemberAccountActor(request);
  if (!statusRequestSchema.safeParse(request.data).success) {
    throw new HttpsError("invalid-argument", "Invalid terms status request");
  }
  const db = getFirestore();
  const base = `academies/${actor.academyId}`;
  const now = new Date().toISOString();
  const [profiles, disclaimers] = await Promise.all([
    createFirestoreMemberAccessService().listProfiles(actor.academyId, actor.userId),
    readDisclaimers(db, actor.academyId),
  ]);
  const participants = await Promise.all(
    profiles.map(async ({ studentId, fullName }) => {
      const [terms, student, acceptances] = await Promise.all([
        db.runTransaction(
          (transaction) =>
            hasAcceptedEnrolmentWaiver({ firestore: db, transaction }, actor.academyId, studentId),
          { readOnly: true },
        ),
        db.doc(`${base}/students/${studentId}`).get(),
        db.collection(`${base}/disclaimerAcceptances`).where("studentId", "==", studentId).get(),
      ]);
      return {
        studentId,
        fullName,
        terms,
        disclaimers: disclaimersClear(
          disclaimers,
          parseAcceptances(acceptances.docs, actor.academyId),
          studentId,
          participantTypeOf(student.data(), now),
          now,
        ),
      };
    }),
  );
  return { participants };
});

export const listDisclaimerAcceptances = onCall(browserAdminCallableOptions, async (request) => {
  // Owner and administrator only; coach and staff are refused (R15).
  const actor = requireDisclaimerOffice(request);
  const input = acceptancesRequestSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid acceptances request");
  const db = getFirestore();
  const base = `academies/${actor.academyId}`;
  const now = new Date().toISOString();
  const [students, termsAccepted, enrolments, disclaimers, acceptances] = await Promise.all([
    db.collection(`${base}/students`).where("status", "==", "active").get(),
    db
      .collection(`${base}/enrolmentWaiverAcceptances`)
      .where("version", "==", enrolmentWaiverTermsVersion)
      .get(),
    db.collection(`${base}/enrolmentRequests`).where("status", "==", "approved").get(),
    readDisclaimers(db, actor.academyId),
    db.collection(`${base}/disclaimerAcceptances`).where("status", "==", "accepted").get(),
  ]);

  // Same two sources as hasAcceptedEnrolmentWaiver: an acceptance from /account, or an approved
  // online enrolment that carried the current version. The direct acceptance wins for the date.
  const termsAt = new Map<string, string | null>();
  for (const doc of enrolments.docs) {
    const waiver = doc.get("waiverAcceptance") as
      Readonly<{ version?: unknown; acceptedAt?: unknown }> | undefined;
    if (waiver?.version !== enrolmentWaiverTermsVersion) continue;
    const at = typeof waiver.acceptedAt === "string" ? waiver.acceptedAt : null;
    for (const id of (doc.get("approvedStudentIds") as unknown[] | undefined) ?? []) {
      if (typeof id === "string") termsAt.set(id, at);
    }
  }
  for (const doc of termsAccepted.docs) {
    const studentId: unknown = doc.get("studentId");
    const at: unknown = doc.get("acceptedAt");
    if (doc.get("academyId") !== actor.academyId || typeof studentId !== "string") continue;
    termsAt.set(studentId, typeof at === "string" ? at : null);
  }

  const acceptancesByStudent = new Map<string, DisclaimerAcceptance[]>();
  for (const acceptance of parseAcceptances(acceptances.docs, actor.academyId)) {
    const list = acceptancesByStudent.get(acceptance.studentId) ?? [];
    list.push(acceptance);
    acceptancesByStudent.set(acceptance.studentId, list);
  }

  const rows = students.docs
    .filter((doc) => doc.get("academyId") === actor.academyId && doc.get("active") !== false)
    .map((doc) => {
      const studentId = doc.id;
      const fullName: unknown = doc.get("fullName");
      const terms = termsAt.has(studentId);
      return {
        studentId,
        fullName: typeof fullName === "string" && fullName.trim() ? fullName.trim() : studentId,
        termsVersion: terms ? enrolmentWaiverTermsVersion : null,
        termsAcceptedAt: termsAt.get(studentId) ?? null,
        disclaimers: disclaimersClear(
          disclaimers,
          acceptancesByStudent.get(studentId) ?? [],
          studentId,
          participantTypeOf(doc.data(), now),
          now,
        ),
      };
    })
    .filter((row) => !input.data.missingOnly || row.termsVersion === null || !row.disclaimers)
    .sort((left, right) => left.fullName.localeCompare(right.fullName, "en-GB"));
  return { rows };
});
