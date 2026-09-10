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
  issueNextAdminWaitlistOffer,
  listAdminSessionWaitlist,
} from "./admin-waitlist-client";

const waitingEntry = {
  sessionId: "session-1",
  studentReference: "student-private-1",
  position: 1,
  status: "waiting",
  requestedAt: "2026-09-01T09:00:00.000Z",
  offeredAt: null,
  offerExpiresAt: null,
  acceptedAt: null,
  cancelledAt: null,
} as const;

describe("admin waitlist client", () => {
  afterEach(() => {
    callableState.call.mockReset();
    callableState.calls.length = 0;
  });

  it("lists a strict staff projection and issues only the next FIFO offer", async () => {
    const offeredEntry = {
      ...waitingEntry,
      status: "offered",
      offeredAt: "2026-09-01T09:10:00.000Z",
      offerExpiresAt: "2026-09-01T09:40:00.000Z",
    } as const;
    callableState.call
      .mockResolvedValueOnce({ data: { entries: [waitingEntry] } })
      .mockResolvedValueOnce({ data: { entry: offeredEntry } });

    await expect(listAdminSessionWaitlist("session-1")).resolves.toEqual([waitingEntry]);
    await expect(issueNextAdminWaitlistOffer("session-1")).resolves.toEqual(offeredEntry);
    expect(callableState.calls).toEqual([
      { name: "listSessionWaitlist", payload: { sessionId: "session-1" } },
      { name: "issueNextWaitlistOffer", payload: { sessionId: "session-1" } },
    ]);
  });

  it("rejects extra fields and incoherent offer timestamps", async () => {
    callableState.call.mockResolvedValueOnce({
      data: { entries: [{ ...waitingEntry, academyId: "private-academy" }] },
    });
    await expect(listAdminSessionWaitlist("session-1")).rejects.toThrow(
      "Unable to load this class waitlist. Please try again.",
    );

    callableState.call.mockResolvedValueOnce({
      data: {
        entry: {
          ...waitingEntry,
          status: "offered",
          offeredAt: "2026-09-01T09:10:00.000Z",
          offerExpiresAt: null,
        },
      },
    });
    await expect(issueNextAdminWaitlistOffer("session-1")).rejects.toThrow(
      "Unable to offer the next place. Please try again.",
    );
  });

  it("rejects accessor payloads without evaluating them", async () => {
    let accessorReads = 0;
    const hostileEntry = { ...waitingEntry } as Record<string, unknown>;
    Object.defineProperty(hostileEntry, "studentReference", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return "student-private-1";
      },
    });
    callableState.call.mockResolvedValueOnce({ data: { entries: [hostileEntry] } });

    await expect(listAdminSessionWaitlist("session-1")).rejects.toThrow(
      "Unable to load this class waitlist. Please try again.",
    );
    expect(accessorReads).toBe(0);
  });

  it("maps eligibility failures to a safe administrative message", async () => {
    callableState.call.mockRejectedValueOnce({ code: "functions/failed-precondition" });
    await expect(issueNextAdminWaitlistOffer("session-1")).rejects.toThrow(
      "No eligible participant can be offered this place right now.",
    );
  });

  it("rejects invalid identifiers before invoking a callable", async () => {
    await expect(listAdminSessionWaitlist("../session")).rejects.toThrow(
      "Unable to load this class waitlist. Please try again.",
    );
    expect(callableState.call).not.toHaveBeenCalled();
  });
});
