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
  acceptClientWaitlistOffer,
  cancelClientWaitlist,
  declineClientWaitlistOffer,
  joinClientWaitlist,
  listClientMemberships,
  listStudentWaitlist,
  parseClientWaitlistItem,
} from "./waitlist-client";

const waitingEntry = {
  sessionId: "session-1",
  position: 2,
  status: "waiting",
  requestedAt: "2026-09-01T10:00:00.000Z",
  offeredAt: null,
  offerExpiresAt: null,
  acceptedAt: null,
  cancelledAt: null,
} as const;

const offeredEntry = {
  ...waitingEntry,
  status: "offered",
  offeredAt: "2026-09-01T10:15:00.000Z",
  offerExpiresAt: "2026-09-01T10:45:00.000Z",
} as const;

const membership = {
  membershipId: "membership-1",
  familyId: "family-1",
  studentId: "student-1",
  planId: "adult-unlimited",
  status: "active",
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: null,
  nextBillingAt: "2026-10-01T00:00:00.000Z",
} as const;

describe("waitlist client", () => {
  afterEach(() => {
    callableState.call.mockReset();
    callableState.calls.length = 0;
  });

  it("loads only strict membership projections", async () => {
    callableState.call.mockResolvedValueOnce({ data: [membership] });

    await expect(listClientMemberships()).resolves.toEqual([membership]);
    expect(callableState.calls).toEqual([{ name: "listMemberships", payload: null }]);

    callableState.call.mockResolvedValueOnce({
      data: [{ ...membership, academyId: "private-academy" }],
    });
    await expect(listClientMemberships()).rejects.toThrow(
      "Unable to load eligible memberships. Please try again.",
    );
  });

  it("loads a minimized student waitlist and rejects extra fields", async () => {
    callableState.call.mockResolvedValueOnce({ data: { entries: [waitingEntry] } });

    await expect(listStudentWaitlist("student-1")).resolves.toEqual([waitingEntry]);
    expect(callableState.calls[0]).toEqual({
      name: "listStudentWaitlist",
      payload: { studentId: "student-1" },
    });

    callableState.call.mockResolvedValueOnce({
      data: { entries: [{ ...waitingEntry, requestedAt: "2026-02-31T10:00:00.000Z" }] },
    });
    await expect(listStudentWaitlist("student-1")).rejects.toThrow(
      "Unable to load your waitlist. Please try again.",
    );

    callableState.call.mockResolvedValueOnce({
      data: { entries: [{ ...waitingEntry, studentReference: "private-student" }] },
    });
    await expect(listStudentWaitlist("student-1")).rejects.toThrow(
      "Unable to load your waitlist. Please try again.",
    );
  });

  it("joins and cancels with exact student-scoped payloads", async () => {
    callableState.call
      .mockResolvedValueOnce({ data: { entry: waitingEntry } })
      .mockResolvedValueOnce({
        data: {
          entry: {
            ...waitingEntry,
            status: "cancelled",
            cancelledAt: "2026-09-02T10:00:00.000Z",
          },
        },
      });

    await expect(
      joinClientWaitlist({
        sessionId: "session-1",
        studentId: "student-1",
        membershipId: "membership-1",
      }),
    ).resolves.toEqual(waitingEntry);
    await expect(
      cancelClientWaitlist({ sessionId: "session-1", studentId: "student-1" }),
    ).resolves.toMatchObject({ status: "cancelled" });

    expect(callableState.calls).toEqual([
      {
        name: "joinWaitlist",
        payload: {
          sessionId: "session-1",
          studentId: "student-1",
          membershipId: "membership-1",
        },
      },
      {
        name: "cancelWaitlistEntry",
        payload: { sessionId: "session-1", studentId: "student-1" },
      },
    ]);
  });

  it("accepts and declines offers with exact student-scoped payloads", async () => {
    callableState.call
      .mockResolvedValueOnce({
        data: {
          entry: {
            ...offeredEntry,
            status: "accepted",
            acceptedAt: "2026-09-01T10:20:00.000Z",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          entry: {
            ...offeredEntry,
            status: "cancelled",
            cancelledAt: "2026-09-01T10:21:00.000Z",
          },
        },
      });

    await expect(
      acceptClientWaitlistOffer({ sessionId: "session-1", studentId: "student-1" }),
    ).resolves.toMatchObject({ status: "accepted" });
    await expect(
      declineClientWaitlistOffer({ sessionId: "session-1", studentId: "student-1" }),
    ).resolves.toMatchObject({ status: "cancelled" });

    expect(callableState.calls).toEqual([
      {
        name: "acceptWaitlistOffer",
        payload: { sessionId: "session-1", studentId: "student-1" },
      },
      {
        name: "declineWaitlistOffer",
        payload: { sessionId: "session-1", studentId: "student-1" },
      },
    ]);
  });

  it("rejects incomplete offer timestamps and private response fields", async () => {
    callableState.call.mockResolvedValueOnce({
      data: { entries: [{ ...offeredEntry, offerExpiresAt: null }] },
    });
    await expect(listStudentWaitlist("student-1")).rejects.toThrow(
      "Unable to load your waitlist. Please try again.",
    );

    callableState.call.mockResolvedValueOnce({
      data: {
        entries: [
          {
            ...offeredEntry,
            status: "accepted",
            offerExpiresAt: null,
            acceptedAt: "2026-09-01T10:20:00.000Z",
          },
        ],
      },
    });
    await expect(listStudentWaitlist("student-1")).rejects.toThrow(
      "Unable to load your waitlist. Please try again.",
    );

    callableState.call.mockResolvedValueOnce({
      data: { entries: [{ ...offeredEntry, waitlistId: "private-waitlist" }] },
    });
    await expect(listStudentWaitlist("student-1")).rejects.toThrow(
      "Unable to load your waitlist. Please try again.",
    );
  });

  it("rejects a zero-length offer window and preserves nanosecond ordering", () => {
    expect(() =>
      parseClientWaitlistItem({
        ...offeredEntry,
        offerExpiresAt: offeredEntry.offeredAt,
      }),
    ).toThrow("Unable to load your waitlist");

    expect(
      parseClientWaitlistItem({
        ...offeredEntry,
        offeredAt: "2026-09-01T10:15:00.000000001Z",
        offerExpiresAt: "2026-09-01T10:15:00.000000002Z",
      }).status,
    ).toBe("offered");
  });

  it("rejects accessor payloads without evaluating them", async () => {
    let accessorReads = 0;
    const hostileEntry = { ...waitingEntry } as Record<string, unknown>;
    Object.defineProperty(hostileEntry, "sessionId", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return "session-1";
      },
    });
    callableState.call.mockResolvedValueOnce({ data: { entries: [hostileEntry] } });

    await expect(listStudentWaitlist("student-1")).rejects.toThrow(
      "Unable to load your waitlist. Please try again.",
    );
    expect(accessorReads).toBe(0);
  });

  it("maps backend eligibility and permission failures to safe messages", async () => {
    callableState.call.mockRejectedValueOnce({ code: "functions/failed-precondition" });
    await expect(
      joinClientWaitlist({
        sessionId: "session-1",
        studentId: "student-1",
        membershipId: "membership-1",
      }),
    ).rejects.toThrow("This session is not open for waitlisting");

    callableState.call.mockRejectedValueOnce({ code: "functions/permission-denied" });
    await expect(
      cancelClientWaitlist({ sessionId: "session-1", studentId: "student-1" }),
    ).rejects.toThrow("You do not have access to manage this participant's waitlist.");
  });

  it("rejects invalid identifiers before invoking a callable", async () => {
    await expect(listStudentWaitlist("../student")).rejects.toThrow(
      "Unable to load your waitlist. Please try again.",
    );
    expect(callableState.call).not.toHaveBeenCalled();
  });
});
