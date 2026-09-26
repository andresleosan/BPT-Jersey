import { afterEach, describe, expect, it, vi } from "vitest";

const callableState = vi.hoisted(() => ({
  call: vi.fn(),
  calls: [] as Array<{ name: string; payload: unknown }>,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async (payload: unknown) => {
    callableState.calls.push({ name, payload });
    return callableState.call(name, payload);
  },
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: () => ({}),
}));

import {
  bookPrivateLesson,
  getPrivateLessonProofUrl,
  cancelPrivateLessonBooking,
  listMyPrivateLessons,
  listPrivateLessonPurchases,
  recordPrivateLessonPurchase,
  reviewPrivateLessonPurchase,
  submitPrivateLessonPurchase,
} from "./private-lesson-client";

const purchaseFixture = {
  purchaseId: "private-lesson-1",
  studentId: "student-1",
  accountUid: "member-uid",
  optionId: "single",
  priceMinor: 6500,
  creditsGranted: 1,
  creditsRemaining: 0,
  status: "pending",
  source: "member",
  method: "bank_transfer",
  proofId: "proof-1",
  bankReference: "BPT 1",
  submittedAt: "2026-09-26T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  decisionReason: null,
  expiresAt: null,
  invoiceId: null,
  schemaVersion: "1",
} as const;

const firebaseError = (code: string, message: string) =>
  Object.assign(new Error(message), { code: `functions/${code}` });

describe("private lesson client", () => {
  afterEach(() => {
    callableState.call.mockReset();
    callableState.calls.length = 0;
  });

  it("submits only the option, proof and reference, never a price", async () => {
    callableState.call.mockResolvedValueOnce({ data: { purchase: purchaseFixture } });
    const input = {
      requestId: "8b0d6f5e-4c1a-4f7e-9a51-7c0f2b9d3e11",
      studentId: "student-1",
      optionId: "single" as const,
      proofId: "proof-1",
      bankReference: "BPT 1",
    };
    await expect(submitPrivateLessonPurchase(input)).resolves.toEqual(purchaseFixture);
    expect(callableState.calls).toEqual([{ name: "submitPrivateLessonPurchase", payload: input }]);
  });

  it("translates a Firebase failure into a safe message", async () => {
    callableState.call.mockRejectedValueOnce(
      firebaseError("internal", "FirebaseError: 13 INTERNAL stack at firestore"),
    );
    await expect(
      submitPrivateLessonPurchase({
        requestId: "8b0d6f5e-4c1a-4f7e-9a51-7c0f2b9d3e11",
        studentId: "student-1",
        optionId: "single",
        proofId: "proof-1",
        bankReference: "BPT 1",
      }),
    ).rejects.toThrow("We could not save the private lesson request. Try again.");
  });

  it("rejects a malformed response", async () => {
    callableState.call.mockResolvedValueOnce({ data: { purchase: { ...purchaseFixture, priceMinor: -1 } } });
    await expect(
      submitPrivateLessonPurchase({
        requestId: "8b0d6f5e-4c1a-4f7e-9a51-7c0f2b9d3e11",
        studentId: "student-1",
        optionId: "single",
        proofId: "proof-1",
        bankReference: "BPT 1",
      }),
    ).rejects.toThrow("We could not save the private lesson request. Try again.");
  });

  it("asks for a purchase's proof by id and accepts only an https URL", async () => {
    callableState.call.mockResolvedValueOnce({
      data: { url: "https://r2.example/signed", expiresAt: "2026-09-26T10:01:00.000Z" },
    });
    await expect(getPrivateLessonProofUrl("private-lesson-1")).resolves.toEqual({
      url: "https://r2.example/signed",
      expiresAt: "2026-09-26T10:01:00.000Z",
    });
    expect(callableState.calls).toEqual([
      { name: "getPrivateLessonProofUrl", payload: { purchaseId: "private-lesson-1" } },
    ]);
    callableState.call.mockResolvedValueOnce({
      data: { url: "http://r2.example/signed", expiresAt: "2026-09-26T10:01:00.000Z" },
    });
    await expect(getPrivateLessonProofUrl("private-lesson-1")).rejects.toThrow(
      "Payment evidence is unavailable. Try again.",
    );
  });

  it("reads the member's credits", async () => {
    callableState.call.mockResolvedValueOnce({
      data: { purchases: [purchaseFixture], creditsAvailable: 3, nextExpiry: "2027-02-28T09:00:00.000Z" },
    });
    await expect(listMyPrivateLessons("student-1")).resolves.toMatchObject({ creditsAvailable: 3 });
    expect(callableState.calls[0]).toEqual({
      name: "listMyPrivateLessons",
      payload: { studentId: "student-1" },
    });
  });

  it("lets the office list, review and record purchases", async () => {
    callableState.call
      .mockResolvedValueOnce({ data: { purchases: [{ ...purchaseFixture, studentName: "Ana" }] } })
      .mockResolvedValueOnce({ data: { purchase: { ...purchaseFixture, status: "rejected" } } })
      .mockResolvedValueOnce({ data: { purchase: { ...purchaseFixture, source: "office" } } });
    await expect(listPrivateLessonPurchases("pending")).resolves.toHaveLength(1);
    await reviewPrivateLessonPurchase({ purchaseId: "private-lesson-1", decision: "reject", reason: "No transfer" });
    await recordPrivateLessonPurchase({ studentId: "student-1", requestId: "3f2a9c7d-1b4e-4d6a-8c0f-5e7b9a1d2c34", optionId: "pack-10", method: "cash", reference: null });
    expect(callableState.calls.map((call) => call.name)).toEqual([
      "listPrivateLessonPurchases",
      "reviewPrivateLessonPurchase",
      "recordPrivateLessonPurchase",
    ]);
  });

  it("shows the office the known booking refusals and hides anything else", async () => {
    callableState.call.mockRejectedValueOnce(
      firebaseError("failed-precondition", "No private lesson credit available."),
    );
    await expect(bookPrivateLesson({ sessionId: "session-1", studentId: "student-1" })).rejects.toThrow(
      "No private lesson credit available.",
    );
    callableState.call.mockRejectedValueOnce(firebaseError("failed-precondition", "raw detail"));
    await expect(
      cancelPrivateLessonBooking({ bookingId: "booking-1", reason: "Coach unavailable" }),
    ).rejects.toThrow("We could not update the private lesson. Try again.");
  });
});
