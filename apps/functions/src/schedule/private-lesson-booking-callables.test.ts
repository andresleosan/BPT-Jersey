import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import { BookingTransactionError } from "./booking-transaction-service";
import {
  createBookPrivateLessonHandler,
  createCancelPrivateLessonBookingHandler,
} from "./schedule-callables";

function request(role: string, data: unknown): CallableRequest<unknown> {
  return {
    auth: { uid: `${role}-uid`, token: { academyId: "academy-1", role } },
    app: { appId: "app" },
    data,
    rawRequest: { headers: {}, ip: "127.0.0.1" },
  } as unknown as CallableRequest<unknown>;
}

const office = async () => ({
  academyId: "academy-1",
  userId: "office-uid",
  role: "administrator",
});

describe("private lesson booking callables", () => {
  it("refuse a coach before any booking work", async () => {
    const book = vi.fn();
    const cancel = vi.fn();
    await expect(
      createBookPrivateLessonHandler({ book })(
        request("coach", { sessionId: "session-1", studentId: "student-1" }),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createCancelPrivateLessonBookingHandler({ cancel })(
        request("coach", { bookingId: "booking-1", reason: "Coach unavailable" }),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(book).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("tells the office when no credit is available", async () => {
    const book = vi.fn(async () => {
      throw new BookingTransactionError("ineligible", "No private lesson credit available.");
    });
    await expect(
      createBookPrivateLessonHandler({ requireOffice: office, book })(
        request("administrator", { sessionId: "session-1", studentId: "student-1" }),
      ),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      message: "No private lesson credit available.",
    });
    expect(book).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "office-uid", studentId: "student-1" }),
    );
  });

  it("rejects a malformed request", async () => {
    await expect(
      createCancelPrivateLessonBookingHandler({ requireOffice: office, cancel: vi.fn() })(
        request("administrator", { bookingId: "booking-1" }),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
