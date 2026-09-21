import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  introConversionStateSchema,
  memberNotificationSchema,
  membershipApplicationDecisionSchema,
  membershipApplicationSchema,
  type MembershipApplicationDecision,
} from "@bpt-jersey/domain/memberships/intro-conversion";
import { parsePlanRecord } from "@bpt-jersey/domain/memberships";
import { addSubscriptionMonth } from "@bpt-jersey/domain/memberships/admin";
import type { UserActorContext } from "@bpt-jersey/domain";
import type { R2Client } from "../storage/r2-client.js";
import { introProofKey } from "./intro-payment-proof.js";
import { saveManualSubscriptionInTransaction } from "./manual-subscription-service.js";

function office(actor: UserActorContext) {
  if (!["owner", "administrator"].includes(actor.role))
    throw new HttpsError("permission-denied", "Office access is required");
}
export async function listIntroApplications(db: Firestore, actor: UserActorContext) {
  office(actor);
  const page = await db
    .collection(`academies/${actor.academyId}/membershipApplications`)
    .limit(100)
    .get();
  return page.docs
    .map((doc) => membershipApplicationSchema.safeParse(doc.data()))
    .filter((value) => value.success)
    .map((value) => value.data)
    .filter((value) => value.academyId === actor.academyId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function getIntroProofUrl(
  db: Firestore,
  actor: UserActorContext,
  applicationId: string,
  storage: R2Client,
) {
  office(actor);
  const parsed = membershipApplicationSchema.safeParse(
    (
      await db.doc(`academies/${actor.academyId}/membershipApplications/${applicationId}`).get()
    ).data(),
  );
  if (!parsed.success || parsed.data.academyId !== actor.academyId)
    throw new HttpsError("not-found", "Application is unavailable");
  const objectKey = introProofKey(
    actor.academyId,
    parsed.data.applicantUid,
    parsed.data.requestId,
    parsed.data.proofId,
  );
  const bytes = Buffer.from(await storage.readObject(objectKey));
  const contentType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? ("image/png" as const)
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? ("image/jpeg" as const)
      : null;
  if (!contentType || !storage.createPrivateImageUrl)
    throw new HttpsError("failed-precondition", "Payment evidence is unavailable");
  return {
    url: await storage.createPrivateImageUrl({ objectKey, expiresInSeconds: 60, contentType }),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}
export async function reviewIntroApplication(
  db: Firestore,
  actor: UserActorContext,
  raw: MembershipApplicationDecision,
) {
  office(actor);
  const input = membershipApplicationDecisionSchema.parse(raw);
  const ref = db.doc(`academies/${actor.academyId}/membershipApplications/${input.applicationId}`);

  return db.runTransaction(async (tx) => {
    const current = membershipApplicationSchema.safeParse((await tx.get(ref)).data());
    if (
      current.success &&
      current.data.academyId === actor.academyId &&
      current.data.status === "approved" &&
      input.decision === "approve" &&
      current.data.approvedMembershipId
    ) {
      return { status: "approved" as const, membershipId: current.data.approvedMembershipId };
    }
    if (
      !current.success ||
      current.data.academyId !== actor.academyId ||
      current.data.status !== "pending_review" ||
      current.data.revision !== input.expectedRevision
    ) {
      throw new HttpsError("aborted", "Application changed. Refresh and try again");
    }

    const conversionRef = db.doc(
      `academies/${actor.academyId}/introConversions/${current.data.conversionId}`,
    );
    const conversion = introConversionStateSchema.safeParse((await tx.get(conversionRef)).data());
    if (
      !conversion.success ||
      conversion.data.academyId !== actor.academyId ||
      conversion.data.studentId !== current.data.studentId ||
      conversion.data.recipientUid !== current.data.applicantUid
    ) {
      throw new HttpsError("failed-precondition", "Intro conversion is unavailable");
    }

    const now = new Date().toISOString();
    if (input.decision !== "approve") {
      const status = input.decision === "reject" ? "rejected" : "needs_correction";
      tx.update(ref, {
        status,
        decisionReason: input.reason,
        revision: current.data.revision + 1,
        updatedAt: now,
      });
      if (status === "needs_correction") {
        tx.update(conversionRef, { status: "ready", updatedAt: now });
      }
      const noticeId = `intro-${createHash("sha256")
        .update(`${current.data.applicationId}:${status}:${current.data.revision + 1}`)
        .digest("hex")}`;
      tx.create(
        db.doc(`academies/${actor.academyId}/memberNotifications/${noticeId}`),
        memberNotificationSchema.parse({
          notificationId: noticeId,
          academyId: actor.academyId,
          recipientUid: current.data.applicantUid,
          kind: "intro_membership_ready",
          title:
            status === "rejected"
              ? "Membership application update"
              : "Membership application needs changes",
          body: input.reason,
          href: "/account/membership?from=intro",
          readAt: null,
          createdAt: now,
          schemaVersion: "1",
        }),
      );
      return { status };
    }

    const plan = parsePlanRecord(
      (await tx.get(db.doc(`academies/${actor.academyId}/plans/${current.data.planId}`))).data(),
    );
    if (
      !plan.ok ||
      !plan.value.active ||
      plan.value.updatedAt !== current.data.planUpdatedAt ||
      plan.value.priceMinor !== current.data.priceMinor ||
      !plan.value.classSites.includes(current.data.site)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Plan changed. Return the application for correction",
      );
    }

    const startsAt = input.occurredAt;
    const endsAt = current.data.billingPeriod === "monthly" ? addSubscriptionMonth(startsAt) : null;
    const reference = current.data.bankReference
      .trim()
      .replace(/[^A-Za-z0-9._:-]+/gu, "-")
      .slice(0, 120);
    const subscription = await saveManualSubscriptionInTransaction(db, tx, actor, {
      studentId: current.data.studentId,
      membershipId: null,
      expectedUpdatedAt: null,
      requestId: current.data.requestId,
      operation: "assign",
      planId: current.data.planId,
      startsAt,
      endsAt,
      settlement: {
        kind: "paid",
        amountMinor: current.data.priceMinor,
        method: "bank_transfer",
        reference,
        occurredAt: input.occurredAt,
      },
    });

    tx.update(ref, {
      status: "approved",
      approvedMembershipId: subscription.membershipId,
      revision: current.data.revision + 1,
      decisionReason: null,
      updatedAt: now,
    });
    tx.update(conversionRef, { status: "converted", updatedAt: now });
    return { status: "approved" as const, membershipId: subscription.membershipId };
  });
}
