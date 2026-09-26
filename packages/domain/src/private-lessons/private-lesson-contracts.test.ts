import { describe, expect, it } from "vitest";
import {
  PRIVATE_LESSON_OPTIONS,
  pickCreditPurchase,
  privateLessonExpiry,
  submitPrivateLessonPurchaseInputSchema,
  type PrivateLessonPurchase,
} from "./private-lesson-contracts";

const base = (over: Partial<PrivateLessonPurchase>): PrivateLessonPurchase => ({
  purchaseId: "p1",
  studentId: "s1",
  accountUid: "u1",
  optionId: "single",
  priceMinor: 6500,
  creditsGranted: 1,
  creditsRemaining: 1,
  status: "approved",
  source: "member",
  method: "bank_transfer",
  proofId: "proof1",
  bankReference: "BPT123",
  submittedAt: "2026-09-01T10:00:00Z",
  decidedAt: "2026-09-01T12:00:00Z",
  decidedBy: "admin1",
  expiresAt: "2026-12-01T12:00:00Z",
  invoiceId: "inv1",
  schemaVersion: "1",
  ...over,
});

describe("private lesson catalogue", () => {
  it("fixes prices in pence and credits on the server side", () => {
    expect(PRIVATE_LESSON_OPTIONS.single).toMatchObject({
      priceMinor: 6500,
      credits: 1,
      validityMonths: 3,
    });
    expect(PRIVATE_LESSON_OPTIONS.monthly).toMatchObject({
      priceMinor: 20000,
      credits: 4,
      validityMonths: 1,
    });
    expect(PRIVATE_LESSON_OPTIONS["pack-10"]).toMatchObject({
      priceMinor: 50000,
      credits: 10,
      validityMonths: 6,
    });
  });

  it("rejects a client-supplied price", () => {
    const parsed = submitPrivateLessonPurchaseInputSchema.safeParse({
      studentId: "s1",
      optionId: "single",
      proofId: "p",
      bankReference: "BPT1",
      priceMinor: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("clamps expiry to the end of short months", () => {
    expect(privateLessonExpiry("monthly", "2026-01-31T09:00:00Z")).toBe("2026-02-28T09:00:00.000Z");
    expect(privateLessonExpiry("pack-10", "2026-08-31T09:00:00Z")).toBe("2027-02-28T09:00:00.000Z");
    // A short month on the way does not drag the final day down.
    expect(privateLessonExpiry("single", "2026-01-31T09:00:00Z")).toBe("2026-04-30T09:00:00.000Z");
  });
});

describe("pickCreditPurchase", () => {
  const now = "2026-10-01T00:00:00Z";
  it("uses the credit that expires first", () => {
    const later = base({ purchaseId: "later", expiresAt: "2027-01-01T00:00:00Z" });
    const sooner = base({ purchaseId: "sooner", expiresAt: "2026-11-01T00:00:00Z" });
    expect(pickCreditPurchase([later, sooner], now)?.purchaseId).toBe("sooner");
  });
  it("ignores pending, empty and expired purchases", () => {
    expect(
      pickCreditPurchase(
        [
          base({ purchaseId: "pending", status: "pending", expiresAt: null }),
          base({ purchaseId: "empty", creditsRemaining: 0 }),
          base({ purchaseId: "expired", expiresAt: "2026-09-30T23:59:59Z" }),
        ],
        now,
      ),
    ).toBeNull();
  });
});
