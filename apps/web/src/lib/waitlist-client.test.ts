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
  cancelClientWaitlist,
  joinClientWaitlist,
  listClientMemberships,
  listStudentWaitlist,
} from "./waitlist-client";

const waitingEntry = {
  sessionId: "session-1",
  position: 2,
  status: "waiting",
  requestedAt: "2026-09-01T10:00:00.000Z",
  cancelledAt: null,
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