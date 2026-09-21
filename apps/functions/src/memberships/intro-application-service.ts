import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  membershipApplicationSchema,
  membershipApplicationSubmitSchema,
  introConversionStateSchema,
  type MembershipApplicationSubmit,
} from "@bpt-jersey/domain/memberships/intro-conversion";
import { parsePaymentInstructionsRecord } from "@bpt-jersey/domain/finance";
import { administrativePlanIds, parsePlanRecord } from "@bpt-jersey/domain/memberships";
import { parseEffectiveStudentProfileAt } from "@bpt-jersey/domain/profiles";
import type { UserActorContext } from "@bpt-jersey/domain";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import { memberAgeOn } from "@bpt-jersey/domain/members/access";
import {
  createMemberAccessService,
  memberAccessDependenciesInTransaction,
} from "../members/member-access-service.js";
import type { R2Client } from "../storage/r2-client.js";
import { assertIntroProof } from "./intro-payment-proof.js";

export async function getIntroMembershipContext(db: Firestore, actor: UserActorContext) {
  const [conversions, applications, plans, instructions] = await Promise.all([
    db
      .collection(`academies/${actor.academyId}/introConversions`)
      .where("recipientUid", "==", actor.userId)
      .limit(20)
      .get(),
    db
      .collection(`academies/${actor.academyId}/membershipApplications`)
      .where("applicantUid", "==", actor.userId)
      .limit(20)
      .get(),
    db.collection(`academies/${actor.academyId}/plans`).where("active", "==", true).limit(20).get(),
    db.doc(`academies/${actor.academyId}/settings/paymentInstructions`).get(),
  ]);
  const conversionValues = conversions.docs
    .map((doc) => introConversionStateSchema.safeParse(doc.data()))
    .filter((value) => value.success)
    .map((value) => value.data)
    .filter((value) => value.academyId === actor.academyId && value.recipientUid === actor.userId);
  const applicationValues = applications.docs
    .map((doc) => membershipApplicationSchema.safeParse(doc.data()))
    .filter((value) => value.success)
    .map((value) => value.data)
    .filter((value) => value.academyId === actor.academyId && value.applicantUid === actor.userId);
  const planValues = plans.docs
    .map((doc) => parsePlanRecord(doc.data()))
    .filter((value) => value.ok)
    .map((value) => value.value)
    .filter(
      (value) =>
        value.academyId === actor.academyId &&
        value.active &&
        value.billingPeriod !== "per-session" &&
        !administrativePlanIds.includes(value.planId),
    );
  const payment = parsePaymentInstructionsRecord(instructions.data());
  return {
    conversions: conversionValues,
    applications: applicationValues.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    plans: planValues.map(
      ({
        planId,
        displayName,
        priceMinor,
        currency,
        billingPeriod,
        eligibleParticipantTypes,
        classSites,
      }) => ({
        planId,
        displayName,
        priceMinor,
        currency,
        billingPeriod,
        eligibleParticipantTypes,
        classSites,
      }),
    ),
    instructions:
      payment.ok && payment.value.academyId === actor.academyId
        ? {
            accountName: payment.value.accountName,
            sortCode: payment.value.sortCode,
            accountNumber: payment.value.accountNumber,
            bankName: payment.value.bankName,
            referenceHint: payment.value.referenceHint,
          }
        : null,
  };
}

export async function submitIntroMembershipApplication(
  db: Firestore,
  actor: UserActorContext,
  raw: MembershipApplicationSubmit,
  storage: R2Client,
) {
  const input = membershipApplicationSubmitSchema.parse(raw);
  await assertIntroProof(storage, {
    academyId: actor.academyId,
    userId: actor.userId,
    requestId: input.requestId,
    proofId: input.proofId,
  });
  const base = `academies/${actor.academyId}`;
  return db.runTransaction(async (tx) => {
    const access = await createMemberAccessService(
      memberAccessDependenciesInTransaction(db, tx),
    ).authorise(actor.academyId, actor.userId, input.studentId);
    if (!access.allowed) throw new HttpsError("permission-denied", "Member profile is unavailable");
    const conversionRef = db.doc(`${base}/introConversions/${input.conversionId}`);
    const applicationRef = db.doc(
      `${base}/membershipApplications/intro-application-${input.requestId}`,
    );
    const [conversionDoc, applicationDoc, studentDoc, planDoc, instructionsDoc] = await Promise.all(
      [
        tx.get(conversionRef),
        tx.get(applicationRef),
        tx.get(db.doc(`${base}/students/${input.studentId}`)),
        tx.get(db.doc(`${base}/plans/${input.planId}`)),
        tx.get(db.doc(`${base}/settings/paymentInstructions`)),
      ],
    );
    const conversion = introConversionStateSchema.safeParse(conversionDoc.data());
    if (
      !conversion.success ||
      conversion.data.academyId !== actor.academyId ||
      conversion.data.studentId !== input.studentId ||
      conversion.data.recipientUid !== actor.userId ||
      conversion.data.status !== "ready"
    )
      throw new HttpsError("failed-precondition", "Intro conversion is unavailable");
    if (applicationDoc.exists) {
      const existing = membershipApplicationSchema.safeParse(applicationDoc.data());
      if (
        existing.success &&
        existing.data.requestId === input.requestId &&
        existing.data.applicantUid === actor.userId
      )
        return existing.data;
      throw new HttpsError("already-exists", "Application request is already used");
    }
    const now = new Date().toISOString();
    const student = parseEffectiveStudentProfileAt(
      studentDoc.data(),
      dateKeyInJersey(new Date(now)),
    );
    const plan = parsePlanRecord(planDoc.data());
    const age = student.ok
      ? memberAgeOn(student.value.dateOfBirth, dateKeyInJersey(new Date(now)))
      : null;
    const participantBand = age === null ? null : age < 13 ? "kids" : age < 18 ? "teens" : "adult";
    const instructions = parsePaymentInstructionsRecord(instructionsDoc.data());
    if (
      !student.ok ||
      student.value.academyId !== actor.academyId ||
      student.value.studentId !== input.studentId ||
      !student.value.active ||
      student.value.status !== "active"
    )
      throw new HttpsError("failed-precondition", "Participant details changed");
    if (
      !plan.ok ||
      plan.value.academyId !== actor.academyId ||
      plan.value.planId !== input.planId ||
      !plan.value.active ||
      administrativePlanIds.includes(plan.value.planId) ||
      plan.value.billingPeriod === "per-session" ||
      !plan.value.classSites.includes(input.site) ||
      participantBand === null ||
      !plan.value.eligibleParticipantTypes.includes(participantBand)
    )
      throw new HttpsError("failed-precondition", "Plan is unavailable");
    if (!instructions.ok || instructions.value.academyId !== actor.academyId)
      throw new HttpsError("failed-precondition", "Payment instructions are unavailable");
    const application = membershipApplicationSchema.parse({
      applicationId: applicationRef.id,
      requestId: input.requestId,
      academyId: actor.academyId,
      applicantUid: actor.userId,
      studentId: input.studentId,
      conversionId: input.conversionId,
      site: input.site,
      planId: input.planId,
      planName: plan.value.displayName,
      priceMinor: plan.value.priceMinor,
      currency: "GBP",
      billingPeriod: plan.value.billingPeriod,
      planUpdatedAt: plan.value.updatedAt,
      proofId: input.proofId,
      bankReference: input.bankReference,
      status: "pending_review",
      revision: 0,
      decisionReason: null,
      approvedMembershipId: null,
      createdAt: now,
      updatedAt: now,
      schemaVersion: "1",
    });
    tx.create(applicationRef, application);
    tx.update(conversionRef, { status: "application_pending", updatedAt: now });
    return application;
  });
}
