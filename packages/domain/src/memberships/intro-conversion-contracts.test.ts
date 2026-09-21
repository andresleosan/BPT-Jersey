import { describe, expect, it } from "vitest";

import {
  introConversionStateSchema,
  memberNotificationSchema,
  membershipApplicationDecisionSchema,
  membershipApplicationSchema,
  membershipApplicationSubmitSchema,
} from "./intro-conversion-contracts";

const requestId = "5b720ca4-290b-4ea7-89f1-8f63a8ca685d";
const occurredAt = "2026-09-21T12:00:00.000Z";
const proofId = "a".repeat(64);

const submit = {
  requestId,
  conversionId: "conversion-1",
  studentId: "student-1",
  site: "Town",
  planId: "town-adult",
  proofId,
  bankReference: "BPT-1234",
};

const application = {
  applicationId: "application-1",
  requestId,
  academyId: "bpt",
  applicantUid: "user-1",
  studentId: "student-1",
  conversionId: "conversion-1",
  site: "Town",
  planId: "town-adult",
  planName: "Town Adult",
  priceMinor: 6500,
  currency: "GBP",
  billingPeriod: "monthly",
  planUpdatedAt: occurredAt,
  proofId,
  bankReference: "BPT-1234",
  status: "pending_review",
  revision: 0,
  decisionReason: null,
  approvedMembershipId: null,
  createdAt: occurredAt,
  updatedAt: occurredAt,
  schemaVersion: "1",
};

describe("intro conversion contracts", () => {
  it("accepts only server-priced membership application submissions", () => {
    expect(membershipApplicationSubmitSchema.parse(submit)).toEqual(submit);
    expect(
      membershipApplicationSubmitSchema.safeParse({ ...submit, priceMinor: 1 }).success,
    ).toBe(false);
  });

  it("accepts a pending application snapshot", () => {
    expect(membershipApplicationSchema.parse(application)).toEqual(application);
  });

  it("restricts notifications to internal membership destinations", () => {
    const notice = {
      notificationId: "notice-1",
      academyId: "bpt",
      recipientUid: "user-1",
      kind: "intro_membership_ready",
      title: "Choose your membership",
      body: "Your Intro Class is complete.",
      href: "/account/membership?from=intro",
      readAt: null,
      createdAt: occurredAt,
      schemaVersion: "1",
    };
    expect(memberNotificationSchema.parse(notice)).toEqual(notice);
    expect(memberNotificationSchema.safeParse({ ...notice, href: "https://example.com" }).success).toBe(false);
  });

  it("validates the durable conversion state", () => {
    const conversion = {
      conversionId: "conversion-1",
      academyId: "bpt",
      studentId: "student-1",
      attendanceId: "attendance-1",
      sessionId: "session-1",
      recipientUid: null,
      status: "ready",
      createdAt: occurredAt,
      updatedAt: occurredAt,
      schemaVersion: "1",
    };
    expect(introConversionStateSchema.parse(conversion)).toEqual(conversion);
  });

  it("requires a reason for correction or rejection decisions", () => {
    expect(
      membershipApplicationDecisionSchema.safeParse({
        applicationId: "application-1",
        expectedRevision: 0,
        decision: "needs_correction",
      }).success,
    ).toBe(false);
    expect(
      membershipApplicationDecisionSchema.safeParse({
        applicationId: "application-1",
        expectedRevision: 0,
        decision: "reject",
        reason: "Unreadable receipt",
      }).success,
    ).toBe(true);
    expect(
      membershipApplicationDecisionSchema.safeParse({
        applicationId: "application-1",
        expectedRevision: 0,
        decision: "approve",
        occurredAt,
      }).success,
    ).toBe(true);
  });
});
