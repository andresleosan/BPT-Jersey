import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { projectIntroAttendance } from "./intro-conversion-service";

type Doc = Record<string, unknown>;
type Filter = { field: string; value: unknown };
function fakeFirestore(initial: Record<string, Doc>) {
  const records = new Map(Object.entries(initial));
  const split = (path: string) => ({
    id: path.slice(path.lastIndexOf("/") + 1),
    parent: path.slice(0, path.lastIndexOf("/")),
  });
  const query = (path: string, filters: Filter[] = [], maximum = Infinity) => ({
    collectionPath: path,
    filters,
    maximum,
    where(field: string, _operator: string, value: unknown) {
      return query(path, [...filters, { field, value }], maximum);
    },
    orderBy() {
      return query(path, filters, maximum);
    },
    limit(count: number) {
      return query(path, filters, count);
    },
  });
  const db = {
    doc(path: string) {
      return { id: split(path).id, path };
    },
    collection(path: string) {
      return query(path);
    },
    async runTransaction<T>(callback: (transaction: never) => Promise<T>) {
      const writes: { path: string; value: Doc }[] = [];
      const transaction = {
        async get(target: {
          path?: string;
          collectionPath?: string;
          filters?: Filter[];
          maximum?: number;
        }) {
          if (target.collectionPath) {
            const docs = [...records.entries()]
              .filter(
                ([path, value]) =>
                  split(path).parent === target.collectionPath &&
                  (target.filters ?? []).every(
                    ({ field, value: expected }) => value[field] === expected,
                  ),
              )
              .slice(0, target.maximum)
              .map(([path, value]) => ({ id: split(path).id, exists: true, data: () => value }));
            return { docs, size: docs.length };
          }
          const value = records.get(target.path!);
          return { id: split(target.path!).id, exists: value !== undefined, data: () => value };
        },
        create(reference: { path: string }, value: Doc) {
          if (records.has(reference.path)) throw new Error("exists");
          writes.push({ path: reference.path, value });
        },
        set(reference: { path: string }, value: Doc) {
          writes.push({ path: reference.path, value });
        },
      };
      const result = await callback(transaction as never);
      writes.forEach(({ path, value }) => records.set(path, value));
      return result;
    },
  };
  return { db: db as unknown as Firestore, records };
}

const academyId = "academy-1";
const now = "2026-09-21T12:00:00.000Z";
const audit = {
  schemaVersion: "1",
  createdAt: now,
  createdBy: "seed",
  updatedAt: now,
  updatedBy: "seed",
};
function attendanceDoc(
  attendanceId: string,
  sessionId: string,
  state: "attended" | "no_show" = "attended",
): Doc {
  return {
    attendanceId,
    academyId,
    sessionId,
    studentId: "student-1",
    method: "manual",
    state,
    occurredAt: now,
    notes: null,
    correctionOf: null,
    ...audit,
  };
}
function introBookingDoc(bookingId: string, sessionId: string): Doc {
  return {
    bookingId,
    academyId,
    sessionId,
    studentId: "student-1",
    membershipId: null,
    source: { kind: "intro" },
    status: "confirmed",
    requestedAt: now,
    cancelledAt: null,
    cancellationReason: null,
    ...audit,
    schemaVersion: "3",
  };
}
function trialDoc(overrides: Doc = {}): Doc {
  return {
    trialId: "student-1",
    academyId,
    studentId: "student-1",
    site: "Town",
    experience: "beginner",
    allowance: 2,
    countedAttendanceIds: [],
    status: "active",
    startsAt: "2026-09-20T10:00:00.000Z",
    expiresAt: "2026-10-20T10:00:00.000Z",
    enrolmentRequestId: "enrol-1",
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
    schemaVersion: "1",
    ...overrides,
  };
}
/** A second intro class, so a second attendance can be projected for the same student. */
const secondClass: Record<string, Doc> = {
  [`academies/${academyId}/attendance/attendance-2`]: attendanceDoc("attendance-2", "session-2"),
  [`academies/${academyId}/sessions/session-2`]: {
    sessionId: "session-2",
    academyId,
    accessMode: "intro",
    ...audit,
  },
  [`academies/${academyId}/bookings/booking-2`]: introBookingDoc("booking-2", "session-2"),
};
/** A single current guardian, so a minor's notices have a recipient. */
const guardian: Record<string, Doc> = {
  [`academies/${academyId}/relationships/family-1--student-1`]: {
    relationshipId: "family-1--student-1",
    academyId,
    familyId: "family-1",
    studentId: "student-1",
    adultUserId: "guardian-1",
    relationshipType: "guardian",
    permissions: ["readProfile"],
    validFrom: "2026-01-01T00:00:00Z",
    active: true,
    status: "active",
    ...audit,
  },
  [`academies/${academyId}/users/guardian-1`]: {
    userId: "guardian-1",
    academyId,
    accountType: "client",
    displayName: "Synthetic Guardian",
    email: "guardian@example.test",
    phoneNumber: "+441534000001",
    active: true,
    status: "active",
    ...audit,
  },
};
function seeded(
  options: {
    /** `null` seeds a session without `accessMode`, like an under-16 age-band class. */
    accessMode?: "intro" | "membership" | null;
    state?: "attended" | "no_show";
    student?: Doc;
    booking?: Doc;
    trial?: Doc;
    extra?: Record<string, Doc>;
  } = {},
) {
  const accessMode = options.accessMode === undefined ? "intro" : options.accessMode;
  return fakeFirestore({
    [`academies/${academyId}/attendance/attendance-1`]: attendanceDoc(
      "attendance-1",
      "session-1",
      options.state ?? "attended",
    ),
    [`academies/${academyId}/sessions/session-1`]: {
      sessionId: "session-1",
      academyId,
      ...(accessMode === null ? {} : { accessMode }),
      ...audit,
    },
    [`academies/${academyId}/students/student-1`]: {
      studentId: "student-1",
      academyId,
      userId: "user-1",
      fullName: "Synthetic Adult",
      dateOfBirth: "1990-01-01",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active: true,
      status: "active",
      ...audit,
      ...options.student,
    },
    [`academies/${academyId}/users/user-1`]: {
      userId: "user-1",
      academyId,
      accountType: "client",
      displayName: "Synthetic Adult",
      email: "adult@example.test",
      phoneNumber: "+441534000000",
      active: true,
      status: "active",
      ...audit,
    },
    [`academies/${academyId}/bookings/booking-1`]:
      options.booking ?? introBookingDoc("booking-1", "session-1"),
    ...(options.trial === undefined
      ? {}
      : { [`academies/${academyId}/trialAccess/student-1`]: options.trial }),
    ...options.extra,
  });
}
const project = (store: ReturnType<typeof seeded>, attendanceId = "attendance-1") =>
  projectIntroAttendance(store.db, { academyId, attendanceId, now });
const pathsUnder = (store: ReturnType<typeof seeded>, segment: string) =>
  [...store.records.entries()].filter(([path]) => path.includes(segment));

describe("intro attendance projection", () => {
  it("creates one deterministic conversion and in-app notice", async () => {
    const store = seeded();
    await expect(
      projectIntroAttendance(store.db, { academyId, attendanceId: "attendance-1", now }),
    ).resolves.toBe("created");
    await expect(
      projectIntroAttendance(store.db, { academyId, attendanceId: "attendance-1", now }),
    ).resolves.toBe("existing");
    expect(
      [...store.records.keys()].filter((path) => path.includes("/introConversions/")),
    ).toHaveLength(1);
    const notices = [...store.records.entries()].filter(([path]) =>
      path.includes("/memberNotifications/"),
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.[1]).toMatchObject({
      recipientUid: "user-1",
      href: "/account/membership?from=intro",
      readAt: null,
    });
  });
  it.each([
    ["an absence", seeded({ state: "no_show" })],
    [
      "a membership booking",
      seeded({
        accessMode: "membership",
        booking: {
          bookingId: "booking-1",
          academyId,
          sessionId: "session-1",
          studentId: "student-1",
          membershipId: "membership-1",
          status: "confirmed",
          requestedAt: now,
          cancelledAt: null,
          cancellationReason: null,
          ...audit,
        },
      }),
    ],
  ])("ignores %s", async (_label, store) => {
    await expect(project(store)).resolves.toBe("ignored");
    expect([...store.records.keys()].some((path) => path.includes("memberNotifications"))).toBe(
      false,
    );
  });
  it("creates the conversion when a mistaken absence is corrected to attended", async () => {
    const store = seeded();
    const path = `academies/${academyId}/attendance/attendance-1`;
    store.records.set(path, { ...store.records.get(path)!, correctionOf: "attendance-0" });
    await expect(
      projectIntroAttendance(store.db, { academyId, attendanceId: "attendance-1", now }),
    ).resolves.toBe("created");
  });
  it("fails closed when the recipient account is not active", async () => {
    const store = seeded();
    store.records.delete(`academies/${academyId}/users/user-1`);
    await expect(
      projectIntroAttendance(store.db, { academyId, attendanceId: "attendance-1", now }),
    ).resolves.toBe("unresolved");
    expect(
      store.records.get(`academies/${academyId}/introConversionIssues/intro-student-1`),
    ).toMatchObject({
      status: "unresolved",
      reason: "recipient_inactive",
      attendanceId: "attendance-1",
    });
  });
  it("counts a first attendance and sends the enjoy-training notice", async () => {
    const store = seeded({ trial: trialDoc() });
    await expect(project(store)).resolves.toBe("created");
    expect(store.records.get(`academies/${academyId}/trialAccess/student-1`)).toMatchObject({
      countedAttendanceIds: ["attendance-1"],
      status: "active",
      updatedAt: now,
    });
    const notices = pathsUnder(store, "/memberNotifications/");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.[1]).toMatchObject({
      title: "Did you enjoy training with us?",
      body: "Tap here to get a membership and keep training with us.",
      href: "/account/membership?from=intro",
    });
  });
  it("counts a second attendance without a second notice", async () => {
    const store = seeded({ trial: trialDoc(), extra: secondClass });
    await expect(project(store)).resolves.toBe("created");
    await expect(project(store, "attendance-2")).resolves.toBe("existing");
    expect(store.records.get(`academies/${academyId}/trialAccess/student-1`)).toMatchObject({
      countedAttendanceIds: ["attendance-1", "attendance-2"],
      status: "exhausted",
    });
    expect(pathsUnder(store, "/memberNotifications/")).toHaveLength(1);
    expect(pathsUnder(store, "/memberships/")).toHaveLength(0);
  });
  it("converts a West adult to PAYG when the allowance is used", async () => {
    const store = seeded({
      student: { trainingCenter: "West", familyId: "family-1" },
      trial: trialDoc({ site: "West", experience: "experienced", allowance: 1 }),
    });
    await expect(project(store)).resolves.toBe("created");
    expect(store.records.get(`academies/${academyId}/memberships/payg-trial-student-1`)).toEqual({
      membershipId: "payg-trial-student-1",
      academyId,
      familyId: "family-1",
      studentId: "student-1",
      planId: "payg",
      status: "active",
      startsAt: now,
      endsAt: null,
      nextBillingAt: null,
      createdAt: now,
      createdBy: "system",
      updatedAt: now,
      updatedBy: "system",
      schemaVersion: "1",
    });
    expect(store.records.get(`academies/${academyId}/trialAccess/student-1`)).toMatchObject({
      countedAttendanceIds: ["attendance-1"],
      status: "converted",
    });
    const payg = pathsUnder(store, "/memberNotifications/payg-");
    expect(payg).toHaveLength(1);
    expect(payg[0]?.[1]).toMatchObject({
      recipientUid: "user-1",
      kind: "intro_membership_ready",
      title: "You're now on Pay as you go",
      body: "Book classes at West and pay online or at the academy.",
      href: "/account/membership",
      readAt: null,
    });
    // The same class used the allowance and created the membership: no contradictory nudge.
    expect(pathsUnder(store, "/memberNotifications/intro-")).toHaveLength(0);
  });
  it("still creates the membership when the recipient cannot be resolved", async () => {
    const store = seeded({
      student: { trainingCenter: "West", familyId: "family-1" },
      trial: trialDoc({ site: "West", experience: "experienced", allowance: 1 }),
    });
    store.records.delete(`academies/${academyId}/users/user-1`);
    await expect(project(store)).resolves.toBe("unresolved");
    expect(
      store.records.get(`academies/${academyId}/memberships/payg-trial-student-1`),
    ).toMatchObject({ planId: "payg", status: "active", familyId: "family-1" });
    expect(store.records.get(`academies/${academyId}/trialAccess/student-1`)).toMatchObject({
      countedAttendanceIds: ["attendance-1"],
      status: "converted",
    });
    expect(pathsUnder(store, "/memberNotifications/")).toHaveLength(0);
    expect(
      store.records.get(`academies/${academyId}/introConversionIssues/intro-student-1`),
    ).toMatchObject({ status: "unresolved", reason: "recipient_inactive" });
  });
  it("records an issue when a West 12+ trial has no billing account", async () => {
    const store = seeded({
      student: { trainingCenter: "West" },
      trial: trialDoc({ site: "West", experience: "experienced", allowance: 1 }),
    });
    await expect(project(store)).resolves.toBe("created");
    expect(pathsUnder(store, "/memberships/")).toHaveLength(0);
    expect(store.records.get(`academies/${academyId}/trialAccess/student-1`)).toMatchObject({
      status: "exhausted",
    });
    expect(
      store.records.get(`academies/${academyId}/introConversionIssues/intro-student-1`),
    ).toMatchObject({
      status: "unresolved",
      reason: "billing_account_missing",
      attendanceId: "attendance-1",
    });
    expect(pathsUnder(store, "/memberNotifications/intro-")).toHaveLength(1);
  });
  it("records an issue when the conversion document cannot be read", async () => {
    const store = seeded({
      student: { trainingCenter: "West", familyId: "family-1" },
      trial: trialDoc({ site: "West", experience: "experienced", allowance: 1 }),
      extra: {
        [`academies/${academyId}/introConversions/intro-student-1`]: {
          conversionId: "intro-student-1",
          corrupted: true,
        },
      },
    });
    await expect(project(store)).resolves.toBe("existing");
    expect(
      store.records.get(`academies/${academyId}/memberships/payg-trial-student-1`),
    ).toMatchObject({ planId: "payg", status: "active" });
    expect(pathsUnder(store, "/memberNotifications/")).toHaveLength(0);
    expect(
      store.records.get(`academies/${academyId}/introConversionIssues/intro-student-1`),
    ).toMatchObject({ status: "unresolved", reason: "conversion_unreadable" });
  });
  it("converts a West teen to the teens PAYG plan", async () => {
    const store = seeded({
      student: {
        fullName: "Synthetic Teen",
        dateOfBirth: "2012-01-01",
        participantType: "minor",
        trainingCenter: "West",
        familyId: "family-1",
      },
      trial: trialDoc({ site: "West", experience: "experienced", allowance: 1 }),
      extra: guardian,
    });
    await expect(project(store)).resolves.toBe("created");
    expect(
      store.records.get(`academies/${academyId}/memberships/payg-trial-student-1`),
    ).toMatchObject({ planId: "west-teens-payg", status: "active", familyId: "family-1" });
    expect(pathsUnder(store, "/memberNotifications/payg-")[0]?.[1]).toMatchObject({
      recipientUid: "guardian-1",
    });
  });
  it("does not convert a West kid under 12", async () => {
    const store = seeded({
      student: {
        fullName: "Synthetic Kid",
        dateOfBirth: "2016-01-01",
        participantType: "minor",
        trainingCenter: "West",
        familyId: "family-1",
      },
      trial: trialDoc({ site: "West", experience: "experienced", allowance: 1 }),
      extra: guardian,
    });
    await expect(project(store)).resolves.toBe("created");
    expect(store.records.get(`academies/${academyId}/trialAccess/student-1`)).toMatchObject({
      status: "exhausted",
    });
    expect(pathsUnder(store, "/memberships/")).toHaveLength(0);
    expect(pathsUnder(store, "/memberNotifications/payg-")).toHaveLength(0);
  });
  it("keeps the West conversion to one membership and one notice", async () => {
    const store = seeded({
      student: { trainingCenter: "West", familyId: "family-1" },
      trial: trialDoc({ site: "West", experience: "experienced", allowance: 1 }),
      extra: secondClass,
    });
    await expect(project(store)).resolves.toBe("created");
    await expect(project(store, "attendance-2")).resolves.toBe("existing");
    expect(pathsUnder(store, "/memberships/")).toHaveLength(1);
    expect(pathsUnder(store, "/memberNotifications/")).toHaveLength(1);
    expect(store.records.get(`academies/${academyId}/trialAccess/student-1`)).toMatchObject({
      countedAttendanceIds: ["attendance-1", "attendance-2"],
      status: "converted",
    });
  });
  it("counts an under-16 age-band class booked as intro", async () => {
    const store = seeded({ accessMode: null, trial: trialDoc() });
    await expect(project(store)).resolves.toBe("created");
    expect(store.records.get(`academies/${academyId}/trialAccess/student-1`)).toMatchObject({
      countedAttendanceIds: ["attendance-1"],
    });
  });
  it("ignores a retried attendance already counted", async () => {
    const store = seeded({
      trial: trialDoc({ countedAttendanceIds: ["attendance-1"] }),
    });
    await expect(project(store)).resolves.toBe("created");
    expect(store.records.get(`academies/${academyId}/trialAccess/student-1`)).toMatchObject({
      countedAttendanceIds: ["attendance-1"],
      updatedAt: "2026-09-20T10:00:00.000Z",
    });
  });
});
