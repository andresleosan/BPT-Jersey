import type { UserActorContext } from "@bpt-jersey/domain";
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { trialAccessSchema, trialExpiresAt } from "@bpt-jersey/domain/memberships/trial-access";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import {
  enrolmentNeedsPayment,
  enrolmentPaymentTotal,
  enrolmentTrialAllowance,
  trialPlanChoice,
} from "@bpt-jersey/domain/members/enrolment-requests";
import { createLevelCatalogStore } from "../levels/level-service.js";
import { saveManualSubscription } from "../memberships/manual-subscription-service.js";
import {
  EnrolmentApprovalError,
  type EnrolmentApprovalDependencies,
} from "./enrolment-approval-service.js";

function fail(message: string): never {
  throw new EnrolmentApprovalError("precondition", "registration_incomplete", message);
}
function registrationKey(requestId: string, index: number): string {
  const hex = createHash("sha256").update(`${requestId}:subscription:${index}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function createEnrolmentRegistration(
  db: Firestore,
): EnrolmentApprovalDependencies["registration"] {
  const levels = createLevelCatalogStore({ firestore: db as never });
  return {
    async validate(record) {
      const setup = record.approvalSetup;
      const count = record.applicantIsStudent ? 1 : record.minors.length;
      if (!setup || setup.students.length !== count)
        fail("Choose a subscription and level for every student.");
      const catalog = await levels.listPublished(record.academyId);
      for (const [index, selection] of setup.students.entries()) {
        if (!catalog.definitions.some((level) => level.definitionKey === selection.definitionKey))
          fail("Choose a current level from the catalogue.");
        const trial = selection.planId === trialPlanChoice;
        const plan = trial ? undefined : PLAN_CATALOG.find((item) => item.planId === selection.planId);
        if (!trial && !plan) fail("Choose a catalogue plan.");
        const preferred = record.applicantIsStudent
          ? record.planSelections?.applicant
          : record.planSelections?.minors[index];
        // The office may turn any request into a trial; otherwise the applicant's own choice stands.
        if (preferred && preferred !== selection.planId && !trial)
          fail("The subscription must match the applicant's chosen plan.");
        if (
          selection.startsOn > record.approvalStartedAt!.slice(0, 10) ||
          (selection.endsOn && selection.endsOn <= selection.startsOn)
        )
          fail("Check subscription start and end dates.");
        if (!trial && plan!.billingPeriod !== "per-session" && !selection.endsOn)
          fail("Enter the end date of the paid subscription period.");
        if (trial && selection.endsOn) fail("A trial has no paid period.");
      }
      const selections = record.applicantIsStudent
        ? { applicant: setup.students[0]!.planId, minors: [] }
        : { minors: setup.students.map((item) => item.planId) };
      const total = enrolmentPaymentTotal(selections);
      if (total > 0 && (!record.payment || record.payment.amountMinor !== total))
        fail(
          "Payment evidence must match the selected plans. Ask the applicant to submit a complete request.",
        );
    },
    async complete(record, studentIds, actor) {
      for (const [index, selection] of record.approvalSetup!.students.entries()) {
        const studentId = studentIds[index];
        if (!studentId) fail("The student record could not be confirmed.");
        const base = db.doc(`academies/${record.academyId}`);
        const note = `Enrolment ${record.enrolmentRequestId}`;
        const existingLevel = await base.collection("studentLevelProgress").doc(studentId).get();
        if (existingLevel.exists) {
          if (
            existingLevel.get("openedDefinitionKey") !== selection.definitionKey ||
            existingLevel.get("openingNotes") !== note
          )
            fail("The student's level was changed separately. Review their member record.");
        } else {
          await levels.openStudentLevel({
            academyId: record.academyId,
            input: {
              studentId,
              definitionKey: selection.definitionKey,
              startedOn: selection.startsOn,
              decisionNotes: note,
            },
            openedBy: actor.actorId,
            openedByRole: actor.role as "owner" | "administrator",
            openedByStaffId: null,
          });
        }
        if (selection.planId === trialPlanChoice) {
          const declaration = record.applicantIsStudent
            ? record.levelDeclarations?.applicant
            : record.levelDeclarations?.minors[index];
          const experience = declaration?.experience ?? "beginner";
          const student = record.applicantIsStudent ? record.applicant : record.minors[index]!;
          const trialRef = base.collection("trialAccess").doc(studentId);
          const existing = await trialRef.get();
          if (existing.exists) {
            if (existing.get("enrolmentRequestId") !== record.enrolmentRequestId)
              fail("The student already has a trial from another enrolment.");
            continue;
          }
          const startsAt = record.approvalStartedAt!;
          await trialRef.set(
            trialAccessSchema.parse({
              trialId: studentId,
              academyId: record.academyId,
              studentId,
              site: student.trainingCenter,
              experience,
              allowance: enrolmentTrialAllowance(experience),
              countedAttendanceIds: [],
              status: "active",
              startsAt,
              expiresAt: trialExpiresAt(startsAt),
              enrolmentRequestId: record.enrolmentRequestId,
              createdAt: startsAt,
              updatedAt: startsAt,
              schemaVersion: "1",
            }),
          );
          continue;
        }
        const requestId = registrationKey(record.approvalRequestId!, index);
        const receipt = await base.collection("membershipChanges").doc(requestId).get();
        if (receipt.exists) {
          const result = receipt.get("result") as Record<string, unknown> | undefined;
          if (result?.studentId !== studentId || result.planId !== selection.planId)
            fail("Subscription receipt does not match the enrolment.");
          continue;
        }
        const plan = PLAN_CATALOG.find((item) => item.planId === selection.planId)!;
        await saveManualSubscription(
          db,
          {
            userId: actor.actorId,
            academyId: actor.academyId,
            role: actor.role as "owner" | "administrator",
          } as UserActorContext,
          {
            studentId,
            requestId,
            membershipId: null,
            expectedUpdatedAt: null,
            operation: "assign",
            planId: plan.planId,
            startsAt: `${selection.startsOn}T00:00:00.000Z`,
            endsAt: selection.endsOn ? `${selection.endsOn}T00:00:00.000Z` : null,
            settlement: enrolmentNeedsPayment(selection.planId)
              ? {
                  kind: "paid",
                  amountMinor: plan.priceMinor,
                  method: "bank_transfer",
                  reference: `enrolment-${record.requestId}-${index}`,
                  occurredAt: `${record.payment!.paidOn}T00:00:00.000Z`,
                }
              : { kind: "pay-as-you-go" },
          },
        );
      }
    },
  };
}
