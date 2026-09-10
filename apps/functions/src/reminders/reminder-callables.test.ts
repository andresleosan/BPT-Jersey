import { describe, expect, it, vi } from "vitest";

import {
  createListClientRemindersHandler,
  type ReminderCallableServices,
} from "./reminder-callables";

function fakeRequest(data: unknown, role = "guardian", uid = "guardian-1") {
  return {
    auth: { uid, token: { academyId: "academy-1", role } },
    data,
  } as never;
}

function services(overrides: Partial<ReminderCallableServices> = {}): ReminderCallableServices {
  return {
    resolveGuardianAudience: vi.fn().mockResolvedValue({
      familyIds: ["family-1"],
      studentIds: ["student-1"],
      students: [{ studentId: "student-1", label: "Jordan" }],
    }),
    resolveAdultStudentAudience: vi.fn().mockResolvedValue({
      familyIds: ["family-adult"],
      studentIds: ["student-adult"],
      students: [{ studentId: "student-adult", label: "Your attendance" }],
    }),
    listFinancialAccount: vi.fn().mockResolvedValue({
      invoices: [],
      balanceMinor: 1250,
      paygDebtMinor: 0,
    }),
    listStudentAttendance: vi.fn().mockResolvedValue([
      {
        attendanceId: "student-secret-attendance",
        academyId: "academy-1",
        sessionId: "session-secret",
        studentId: "student-1",
        method: "manual",
        state: "no_show",
        occurredAt: new Date().toISOString(),
        notes: "private note",
        correctionOf: null,
        schemaVersion: "1",
        createdAt: new Date().toISOString(),
        createdBy: "coach-1",
        updatedAt: new Date().toISOString(),
        updatedBy: "coach-1",
      },
    ]),
    listCancelledSessionsForStudent: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("Reminder Callables (T048)", () => {
  it("tells a guardian which child's class was cancelled and why (T110)", async () => {
    const service = services({
      listCancelledSessionsForStudent: vi.fn().mockResolvedValue([
        {
          title: "Kids BJJ - West",
          startAt: "2026-09-10T17:30:00.000Z",
          reason:
            "Cancelled automatically: the minimum number of bookings was not reached one hour before the start.",
        },
      ]),
    });
    const handler = createListClientRemindersHandler({ services: service });

    const result = await handler(fakeRequest(null, "guardian", "guardian-1"));

    const cancelled = result.reminders.filter((reminder) => reminder.kind === "sessionCancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.title).toBe("Class cancelled");
    expect(cancelled[0]?.message).toContain("Jordan was booked into Kids BJJ - West");
    expect(cancelled[0]?.message).toContain("minimum number of bookings was not reached");
    expect(service.listCancelledSessionsForStudent).toHaveBeenCalledWith("academy-1", "student-1");
    // The notice carries no identifier of the student, the booking or the session: its own
    // reminderId is an index, and the class is named by its title and time.
    expect(JSON.stringify(cancelled)).not.toContain("student-1");
    expect(cancelled[0]?.reminderId).toBe("session-cancelled-0");
    expect(Object.keys(cancelled[0] ?? {})).toEqual([
      "reminderId",
      "kind",
      "severity",
      "title",
      "message",
      "amountMinor",
      "count",
      "createdAt",
      "schemaVersion",
    ]);
  });

  it("addresses an adult about their own cancelled class (T110)", async () => {
    const handler = createListClientRemindersHandler({
      services: services({
        listCancelledSessionsForStudent: vi
          .fn()
          .mockResolvedValue([
            { title: "Adults Gi - Town", startAt: "2026-09-11T18:00:00.000Z", reason: "Off." },
          ]),
      }),
    });

    const result = await handler(fakeRequest(null, "adultStudent", "adult-1"));

    const cancelled = result.reminders.filter((reminder) => reminder.kind === "sessionCancelled");
    expect(cancelled[0]?.message).toContain("You were booked into Adults Gi - Town");
  });

  it("resolves guardian reminders to the family scope", async () => {
    const service = services();
    const handler = createListClientRemindersHandler({ services: service });

    const result = await handler(fakeRequest(null, "guardian", "guardian-1"));

    expect(result.reminders.map((reminder) => reminder.kind)).toEqual(["payment", "attendance"]);
    expect(service.listFinancialAccount).toHaveBeenCalledWith({
      academyId: "academy-1",
      familyIds: ["family-1"],
      studentIds: ["student-1"],
    });
    expect(JSON.stringify(result)).not.toContain("student-secret-attendance");
    expect(JSON.stringify(result)).not.toContain("session-secret");
  });

  it("resolves adult-student reminders to only the own student scope", async () => {
    const service = services();
    const handler = createListClientRemindersHandler({ services: service });

    await handler(fakeRequest(null, "adultStudent", "adult-1"));

    expect(service.resolveAdultStudentAudience).toHaveBeenCalledWith("academy-1", "adult-1");
    expect(service.resolveGuardianAudience).not.toHaveBeenCalled();
    expect(service.listFinancialAccount).toHaveBeenCalledWith({
      academyId: "academy-1",
      familyIds: ["family-adult"],
      studentIds: ["student-adult"],
    });
  });

  it("denies staff, non-null payloads, and unresolved audiences", async () => {
    const handler = createListClientRemindersHandler({ services: services() });

    await expect(handler(fakeRequest(null, "coach", "coach-1"))).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(handler(fakeRequest({}, "guardian", "guardian-1"))).rejects.toMatchObject({
      code: "invalid-argument",
    });

    const unresolved = services({ resolveGuardianAudience: vi.fn().mockResolvedValue(undefined) });
    await expect(
      createListClientRemindersHandler({ services: unresolved })(
        fakeRequest(null, "guardian", "guardian-1"),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});
