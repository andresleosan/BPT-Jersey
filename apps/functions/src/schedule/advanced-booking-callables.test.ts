import { describe, expect, it, vi } from "vitest";

import type { WaitlistEntryRecord } from "@bpt-jersey/domain/schedule/advanced-booking";
import {
  createCancelWaitlistHandler,
  createJoinWaitlistHandler,
  createListSessionWaitlistHandler,
  createListStudentWaitlistHandler,
} from "./advanced-booking-callables";
import { WaitlistStoreError, type WaitlistStore } from "./advanced-booking-service";

const entry: WaitlistEntryRecord = Object.freeze({
  waitlistId: "session-1__student-1",
  academyId: "academy-1",
  sessionId: "session-1",
  studentId: "student-1",
  membershipId: "membership-1",
  position: 1,
  status: "waiting",
  requestedAt: "2026-08-28T12:00:00Z",
  offeredAt: null,
  offerExpiresAt: null,
  acceptedAt: null,
  cancelledAt: null,
  schemaVersion: "1",
  createdAt: "2026-08-28T12:00:00Z",
  createdBy: "adult-1",
  updatedAt: "2026-08-28T12:00:00Z",
  updatedBy: "adult-1",
});

const cancelledEntry: WaitlistEntryRecord = Object.freeze({
  ...entry,
  status: "cancelled",
  cancelledAt: entry.updatedAt,
});

function request(data: unknown, role: string, uid = role + "-1", academyId = "academy-1") {
  return { auth: { uid, token: { role, academyId } }, data } as never;
}

function store(overrides: Partial<WaitlistStore> = {}): WaitlistStore {
  return {
    joinWaitlist: vi.fn(async () => entry),

    cancelWaitlist: vi.fn(async () => cancelledEntry),

    listSessionWaitlist: vi.fn(async () => [entry]),
    listStudentWaitlist: vi.fn(async () => [entry]),
    ...overrides,
  };
}

describe("advanced booking waitlist callables", () => {
  it("lets an adult join only their own student scope and minimizes the response", async () => {
    const waitlistStore = store();
    const response = await createJoinWaitlistHandler({ waitlistStore })(
      request(
        { sessionId: "session-1", studentId: "adult-1", membershipId: "membership-1" },
        "adultStudent",
        "adult-1",
      ),
    );
    expect(response.entry).toMatchObject({
      sessionId: "session-1",
      position: 1,
      status: "waiting",
    });
    expect(response.entry).not.toHaveProperty("academyId");
    expect(response.entry).not.toHaveProperty("membershipId");
    expect(response.entry).not.toHaveProperty("waitlistId");
    expect(waitlistStore.joinWaitlist).toHaveBeenCalledWith(
      expect.objectContaining({ academyId: "academy-1", actorId: "adult-1" }),
    );
  });

  it("permits an active guardian resolver and denies unrelated student scope", async () => {
    const waitlistStore = store();
    const allowed = createJoinWaitlistHandler({
      waitlistStore,
      isGuardianOfStudent: vi.fn(async () => true),
    });
    await expect(
      allowed(
        request(
          { sessionId: "session-1", studentId: "student-1", membershipId: "membership-1" },
          "guardian",
        ),
      ),
    ).resolves.toBeDefined();

    const denied = createJoinWaitlistHandler({
      waitlistStore,
      isGuardianOfStudent: vi.fn(async () => false),
    });
    await expect(
      denied(
        request(
          { sessionId: "session-1", studentId: "student-1", membershipId: "membership-1" },
          "guardian",
        ),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createJoinWaitlistHandler({ waitlistStore })(
        request(
          { sessionId: "session-1", studentId: "student-2", membershipId: "membership-1" },
          "adultStudent",
          "student-1",
        ),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("cancels and lists a student waitlist through the same scope guard", async () => {
    const waitlistStore = store();
    const cancellation = await createCancelWaitlistHandler({ waitlistStore })(
      request({ sessionId: "session-1", studentId: "adult-1" }, "adultStudent", "adult-1"),
    );
    expect(cancellation.entry.status).toBe("cancelled");

    const listed = await createListStudentWaitlistHandler({ waitlistStore })(
      request({ studentId: "adult-1" }, "adultStudent", "adult-1"),
    );
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]).not.toHaveProperty("studentReference");
  });

  it.each(["owner", "administrator", "headCoach", "coach"])(
    "lets %s list a minimized session queue",
    async (role) => {
      const response = await createListSessionWaitlistHandler({ waitlistStore: store() })(
        request({ sessionId: "session-1" }, role),
      );
      expect(response.entries[0]).toMatchObject({
        studentReference: "student-1",
        position: 1,
      });
      expect(response.entries[0]).not.toHaveProperty("membershipId");
      expect(response.entries[0]).not.toHaveProperty("academyId");
    },
  );

  it.each(["guardian", "adultStudent"])("denies %s from listing a session queue", async (role) => {
    await expect(
      createListSessionWaitlistHandler({ waitlistStore: store() })(
        request({ sessionId: "session-1" }, role),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects unknown fields and unauthenticated requests", async () => {
    const handler = createListStudentWaitlistHandler({ waitlistStore: store() });
    await expect(
      handler(request({ studentId: "student-1", academyId: "academy-2" }, "owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      handler({ auth: undefined, data: { studentId: "student-1" } } as never),
    ).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("maps store failures to safe callable errors", async () => {
    const waitlistStore = store({
      listStudentWaitlist: vi.fn(async () => {
        throw new WaitlistStoreError("tenant", "sensitive tenant details");
      }),
    });
    await expect(
      createListStudentWaitlistHandler({ waitlistStore })(
        request({ studentId: "student-1" }, "owner"),
      ),
    ).rejects.toMatchObject({
      code: "internal",
      message: "Waitlist is not available",
    });
  });
});
