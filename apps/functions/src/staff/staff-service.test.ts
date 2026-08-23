import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createStaffStore, type StaffDocumentData, type StaffFirestore } from "./staff-service.js";

type Ref = Readonly<{ id: string; path: string }>;

const user = (overrides: Record<string, unknown> = {}): StaffDocumentData => ({
  userId: "user-1",
  academyId: "academy-1",
  accountType: "staff",
  active: true,
  status: "active",
  ...overrides,
});

const storedStaff = (overrides: Record<string, unknown> = {}): StaffDocumentData => ({
  staffId: "staff-1",
  academyId: "academy-1",
  userId: "user-1",
  role: "coach",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-21T09:00:00Z",
  createdBy: "owner-1",
  updatedAt: "2026-08-21T09:00:00Z",
  updatedBy: "owner-1",
  ...overrides,
});

function canonicalAvailabilityId(
  academyId: string,
  staffId: string,
  window: Readonly<{
    weekday: number;
    startLocal: string;
    endLocal: string;
    timezone: string;
  }>,
): string {
  return createHash("sha256")
    .update(
      `${academyId}|${staffId}|${window.weekday}|${window.startLocal}|${window.endLocal}|${window.timezone}`,
    )
    .digest("hex")
    .slice(0, 40);
}

function canonicalAssignmentId(
  academyId: string,
  staffId: string,
  assignment: Readonly<{ targetType: string; targetId: string }>,
): string {
  return createHash("sha256")
    .update(`${academyId}|${staffId}|${assignment.targetType}|${assignment.targetId}`)
    .digest("hex")
    .slice(0, 40);
}

function createFakeFirestore(initial: Record<string, StaffDocumentData> = {}) {
  const records = new Map(Object.entries(initial));
  const operations: string[] = [];
  let generatedId = 0;
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const fake: StaffFirestore = {
    doc: ref,
    collection: (path) => ({
      doc: (id?: string) => ref(`${path}/${id ?? `generated-${generatedId++}`}`),
      limit: (count: number) => ({ path, limit: count }),
      where: (field, _operator, value) => ({
        path,
        field,
        value,
        limit: (count: number) => ({ path, field, value, limit: count }),
      }),
    }),
    runTransaction: async (callback) => {
      const transaction = {
        get: async (
          target: Ref | { path: string; field?: string; value?: unknown; limit: number },
        ) => {
          operations.push(`get:${"field" in target ? target.path : target.path}`);
          if ("limit" in target) {
            const docs = [...records.entries()]
              .filter(
                ([path, data]) =>
                  path.startsWith(`${target.path}/`) &&
                  (target.field === undefined || data[target.field] === target.value),
              )
              .slice(0, target.limit)
              .map(([path, data]) => ({ ...ref(path), exists: true, data: () => data }));
            return { docs };
          }
          const data = records.get(target.path);
          return { ...ref(target.path), exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: StaffDocumentData) => {
          operations.push(`create:${target.path}`);
          if (records.has(target.path)) throw new Error("already exists");
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: StaffDocumentData) => {
          operations.push(`set:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
      };
      return callback(transaction);
    },
  };
  return { firestore: fake, records, operations };
}

function createStore(firestore: StaffFirestore) {
  return createStaffStore({
    firestore,
    appendAudit: () => undefined,
  });
}

const createInput = () => ({
  academyId: "academy-1",
  actorId: "owner-1",
  userId: "user-1",
  role: "coach" as const,
  now: "2026-08-21T09:00:00Z",
  requestId: "request-1",
});

describe("staff Firestore store", () => {
  it("reads the canonical user before atomically creating one staff profile", async () => {
    const { firestore, records, operations } = createFakeFirestore({
      "academies/academy-1/users/user-1": user(),
    });
    const audits: unknown[] = [];
    const store = createStaffStore({
      firestore,
      appendAudit: (_transaction, _ref, draft) => audits.push(draft),
    });

    const profile = await store.createStaffProfile(createInput());

    expect(profile.staffId).toMatch(/^[a-f0-9]{40}$/u);
    expect(profile.userId).toBe("user-1");
    expect(records.get(`academies/academy-1/staff/${profile.staffId}`)).toMatchObject({
      academyId: "academy-1",
      role: "coach",
      active: true,
      status: "active",
    });
    expect(operations[0]).toBe("get:academies/academy-1/users/user-1");
    expect(operations).toContain(`create:academies/academy-1/staff/${profile.staffId}`);
    const firstWrite = operations.findIndex((operation) => operation.startsWith("create:"));
    expect(firstWrite).toBeGreaterThan(0);
    expect(operations.slice(0, firstWrite).every((operation) => operation.startsWith("get:"))).toBe(
      true,
    );
    expect(audits).toEqual([
      {
        academyId: "academy-1",
        actorId: "owner-1",
        action: "staff.created",
        targetRef: `academies/academy-1/staff/${profile.staffId}`,
        purpose: "staff lifecycle operation",
        correlationId: expect.stringMatching(new RegExp(`^staff:${profile.staffId}:`, "u")),
      },
    ]);
  });

  it("fails closed for missing, cross-tenant, and duplicate active users", async () => {
    const missing = createFakeFirestore();
    await expect(createStore(missing.firestore).createStaffProfile(createInput())).rejects.toThrow(
      /user/i,
    );

    const crossTenant = createFakeFirestore({
      "academies/academy-1/users/user-1": user({ academyId: "academy-2" }),
    });
    await expect(
      createStore(crossTenant.firestore).createStaffProfile(createInput()),
    ).rejects.toThrow(/tenant/i);

    const duplicate = createFakeFirestore({
      "academies/academy-1/users/user-1": user(),
      "academies/academy-1/staff/staff-existing": storedStaff({ staffId: "staff-existing" }),
    });
    await expect(
      createStore(duplicate.firestore).createStaffProfile(createInput()),
    ).rejects.toThrow(/duplicate/i);

    const unsupported = createFakeFirestore({
      "academies/academy-1/users/user-1": user(),
    });
    await expect(
      createStore(unsupported.firestore).createStaffProfile({
        ...createInput(),
        role: "owner" as never,
      }),
    ).rejects.toThrow(/invalid/i);

    const overflowing: Record<string, StaffDocumentData> = {
      "academies/academy-1/users/user-1": user(),
    };
    for (let index = 0; index < 101; index += 1) {
      overflowing[`academies/academy-1/staff/staff-${index}`] = storedStaff({
        staffId: `staff-${index}`,
        active: false,
        status: "inactive",
      });
    }
    await expect(
      createStore(createFakeFirestore(overflowing).firestore).createStaffProfile(createInput()),
    ).rejects.toThrow(/limit/i);
  });

  it("rejects overlapping windows and mutations for inactive staff", async () => {
    const { firestore } = createFakeFirestore({
      "academies/academy-1/users/user-1": user(),
      "academies/academy-1/staff/staff-1": storedStaff({ active: false, status: "inactive" }),
    });
    const store = createStore(firestore);

    await expect(
      store.replaceStaffAvailability({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        windows: [
          { weekday: 1, startLocal: "17:00", endLocal: "19:00", timezone: "Europe/London" },
        ],
      }),
    ).rejects.toThrow(/inactive/i);

    const active = createFakeFirestore({
      "academies/academy-1/staff/staff-1": storedStaff(),
    });
    await expect(
      createStore(active.firestore).replaceStaffAvailability({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        windows: [
          { weekday: 1, startLocal: "17:00", endLocal: "19:00", timezone: "Europe/London" },
          { weekday: 1, startLocal: "18:00", endLocal: "20:00", timezone: "Europe/London" },
        ],
      }),
    ).rejects.toThrow(/overlap/i);
  });

  it("validates assignment targets before writing and is idempotent for replacement", async () => {
    const { firestore, records, operations } = createFakeFirestore({
      "academies/academy-1/staff/staff-1": storedStaff(),
      "academies/academy-1/staff/staff-2": storedStaff({ staffId: "staff-2", userId: "user-2" }),
      "academies/academy-1/locations/location-town": { academyId: "academy-1" },
    });
    const store = createStore(firestore);
    const input = {
      academyId: "academy-1",
      actorId: "owner-1",
      staffId: "staff-1",
      assignments: [{ targetType: "location" as const, targetId: "location-town" }],
    };

    await store.replaceStaffAssignments(input);
    const firstWriteCount = operations.filter((operation) => operation.startsWith("set:")).length;
    await store.replaceStaffAssignments(input);

    expect(firstWriteCount).toBe(1);
    expect(operations.filter((operation) => operation.startsWith("set:")).length).toBe(1);
    expect(
      [...records.keys()].filter((key) => key.startsWith("academies/academy-1/staffAssignments/")),
    ).toHaveLength(1);

    await createStore(firestore).replaceStaffAssignments({
      ...input,
      staffId: "staff-2",
    });
    expect(
      [...records.keys()].filter((key) => key.startsWith("academies/academy-1/staffAssignments/")),
    ).toHaveLength(2);

    await expect(
      store.replaceStaffAssignments({
        ...input,
        assignments: [{ targetType: "program", targetId: "program-missing" }],
      }),
    ).rejects.toThrow(/target/i);
  });

  it("revokes active availability and assignments when staff is deactivated", async () => {
    const { firestore, records, operations } = createFakeFirestore({
      "academies/academy-1/users/user-1": user(),
      "academies/academy-1/staff/staff-1": storedStaff(),
      "academies/academy-1/staffAvailability/availability-1": {
        academyId: "academy-1",
        staffId: "staff-1",
        active: true,
        weekday: 1,
        startLocal: "17:00",
        endLocal: "19:00",
        timezone: "Europe/London",
        updatedAt: "2026-08-21T09:00:00Z",
      },
      "academies/academy-1/staffAssignments/staff-1-location-location-town": {
        academyId: "academy-1",
        staffId: "staff-1",
        targetType: "location",
        targetId: "location-town",
        active: true,
        updatedAt: "2026-08-21T09:00:00Z",
      },
    });

    await expect(
      createStore(firestore).setStaffActive({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        active: "false" as never,
        now: "2026-08-21T10:00:00Z",
      }),
    ).rejects.toThrow(/active state/i);

    await createStore(firestore).setStaffActive({
      academyId: "academy-1",
      actorId: "owner-1",
      staffId: "staff-1",
      active: false,
      now: "2026-08-21T10:00:00Z",
    });

    expect(records.get("academies/academy-1/staffAvailability/availability-1")).toMatchObject({
      active: false,
    });
    expect(
      records.get("academies/academy-1/staffAssignments/staff-1-location-location-town"),
    ).toMatchObject({ active: false });
    const firstWrite = operations.findIndex((operation) => operation.startsWith("set:"));
    expect(operations.slice(0, firstWrite).every((operation) => operation.startsWith("get:"))).toBe(
      true,
    );

    records.set("academies/academy-1/staffAvailability/availability-1", {
      ...records.get("academies/academy-1/staffAvailability/availability-1"),
      active: true,
    });
    records.set("academies/academy-1/staffAssignments/staff-1-location-location-town", {
      ...records.get("academies/academy-1/staffAssignments/staff-1-location-location-town"),
      active: true,
    });
    await createStore(firestore).setStaffActive({
      academyId: "academy-1",
      actorId: "owner-1",
      staffId: "staff-1",
      active: false,
      now: "2026-08-21T10:01:00Z",
    });
    expect(records.get("academies/academy-1/staffAvailability/availability-1")).toMatchObject({
      active: false,
    });
    expect(
      records.get("academies/academy-1/staffAssignments/staff-1-location-location-town"),
    ).toMatchObject({ active: false });
  });

  it("rejects malformed active derived records before deactivation writes", async () => {
    const malformedAvailability = createFakeFirestore({
      "academies/academy-1/users/user-1": user(),
      "academies/academy-1/staff/staff-1": storedStaff(),
      "academies/academy-1/staffAvailability/window-1": {
        academyId: "academy-1",
        staffId: "staff-1",
        active: true,
        weekday: 1,
        startLocal: "17:00",
        endLocal: "19:00",
        timezone: "Europe/London",
        userId: "private-user",
      },
    });
    await expect(
      createStore(malformedAvailability.firestore).setStaffActive({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        active: false,
        now: "2026-08-21T10:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(malformedAvailability.operations.some((operation) => operation.startsWith("set:"))).toBe(
      false,
    );

    const malformedAssignment = createFakeFirestore({
      "academies/academy-1/users/user-1": user(),
      "academies/academy-1/staff/staff-1": storedStaff(),
      "academies/academy-1/staffAssignments/assignment-1": {
        academyId: "academy-1",
        staffId: "staff-1",
        active: true,
        targetType: "location",
        targetId: "location-town",
        userId: "private-user",
      },
    });
    await expect(
      createStore(malformedAssignment.firestore).setStaffActive({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        active: false,
        now: "2026-08-21T10:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(malformedAssignment.operations.some((operation) => operation.startsWith("set:"))).toBe(
      false,
    );
  });

  it("rejects malformed active derived records before replacement writes", async () => {
    const malformedAvailability = createFakeFirestore({
      "academies/academy-1/staff/staff-1": storedStaff(),
      "academies/academy-1/staffAvailability/window-1": {
        academyId: "academy-1",
        staffId: "staff-1",
        active: true,
        weekday: 1,
        startLocal: "17:00",
        endLocal: "19:00",
        timezone: "Europe/London",
        userId: "private-user",
      },
    });
    await expect(
      createStore(malformedAvailability.firestore).replaceStaffAvailability({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        windows: [],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(malformedAvailability.operations.some((operation) => operation.startsWith("set:"))).toBe(
      false,
    );

    const malformedAssignment = createFakeFirestore({
      "academies/academy-1/staff/staff-1": storedStaff(),
      "academies/academy-1/staffAssignments/assignment-1": {
        academyId: "academy-1",
        staffId: "staff-1",
        active: true,
        targetType: "location",
        targetId: "location-town",
        userId: "private-user",
      },
    });
    await expect(
      createStore(malformedAssignment.firestore).replaceStaffAssignments({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        assignments: [],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(malformedAssignment.operations.some((operation) => operation.startsWith("set:"))).toBe(
      false,
    );
  });

  it("rejects malformed inactive derived records before replacement writes", async () => {
    const availability = {
      academyId: "academy-1",
      staffId: "staff-1",
      weekday: 1,
      startLocal: "17:00",
      endLocal: "19:00",
      timezone: "Europe/London",
      active: false,
      updatedAt: "2026-08-21T09:00:00Z",
    };
    const canonicalAvailability = canonicalAvailabilityId("academy-1", "staff-1", availability);
    const malformedAvailability = createFakeFirestore({
      "academies/academy-1/staff/staff-1": storedStaff(),
      [`academies/academy-1/staffAvailability/${canonicalAvailability}`]: {
        ...availability,
        userId: "private-user",
      },
    });
    await expect(
      createStore(malformedAvailability.firestore).replaceStaffAvailability({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        windows: [],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(malformedAvailability.operations.some((operation) => operation.startsWith("set:"))).toBe(
      false,
    );

    const nonCanonicalAvailability = createFakeFirestore({
      "academies/academy-1/staff/staff-1": storedStaff(),
      "academies/academy-1/staffAvailability/not-the-canonical-id": availability,
    });
    await expect(
      createStore(nonCanonicalAvailability.firestore).replaceStaffAvailability({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        windows: [],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      nonCanonicalAvailability.operations.some((operation) => operation.startsWith("set:")),
    ).toBe(false);

    const assignment = {
      academyId: "academy-1",
      staffId: "staff-1",
      targetType: "location" as const,
      targetId: "location-town",
      active: false,
      updatedAt: "2026-08-21T09:00:00Z",
    };
    const canonicalAssignment = canonicalAssignmentId("academy-1", "staff-1", assignment);
    const malformedAssignment = createFakeFirestore({
      "academies/academy-1/staff/staff-1": storedStaff(),
      [`academies/academy-1/staffAssignments/${canonicalAssignment}`]: {
        ...assignment,
        userId: "private-user",
      },
    });
    await expect(
      createStore(malformedAssignment.firestore).replaceStaffAssignments({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        assignments: [],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(malformedAssignment.operations.some((operation) => operation.startsWith("set:"))).toBe(
      false,
    );

    const nonCanonicalAssignment = createFakeFirestore({
      "academies/academy-1/staff/staff-1": storedStaff(),
      "academies/academy-1/staffAssignments/not-the-canonical-id": assignment,
    });
    await expect(
      createStore(nonCanonicalAssignment.firestore).replaceStaffAssignments({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        assignments: [],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      nonCanonicalAssignment.operations.some((operation) => operation.startsWith("set:")),
    ).toBe(false);
  });

  it("fails closed when a replacement query exceeds its safe limit", async () => {
    const initial: Record<string, StaffDocumentData> = {
      "academies/academy-1/staff/staff-1": storedStaff(),
    };
    for (let index = 0; index < 101; index += 1) {
      initial[`academies/academy-1/staffAvailability/window-${index}`] = {
        academyId: "academy-1",
        staffId: "staff-1",
        active: true,
        weekday: 1,
        startLocal: "17:00",
        endLocal: "18:00",
        timezone: "Europe/London",
      };
    }
    const { firestore, operations } = createFakeFirestore(initial);

    await expect(
      createStore(firestore).replaceStaffAvailability({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        windows: [],
      }),
    ).rejects.toThrow(/limit/i);
    expect(operations.some((operation) => operation.startsWith("set:"))).toBe(false);
  });

  it("rejects replacement input arrays over the shared limit before opening a transaction", async () => {
    const { firestore, operations } = createFakeFirestore({
      "academies/academy-1/staff/staff-1": storedStaff(),
    });
    const windows = Array.from({ length: 101 }, () => ({
      weekday: 1,
      startLocal: "17:00",
      endLocal: "19:00",
      timezone: "Europe/London",
    }));
    const assignments = Array.from({ length: 101 }, (_, index) => ({
      targetType: "location" as const,
      targetId: `location-${index}`,
    }));

    await expect(
      createStore(firestore).replaceStaffAvailability({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        windows,
      }),
    ).rejects.toMatchObject({ code: "precondition" });
    await expect(
      createStore(firestore).replaceStaffAssignments({
        academyId: "academy-1",
        actorId: "owner-1",
        staffId: "staff-1",
        assignments,
      }),
    ).rejects.toMatchObject({ code: "precondition" });
    expect(operations).toEqual([]);
  });

  it("returns the same profile when a create request is retried with its request ID", async () => {
    const { firestore, records, operations } = createFakeFirestore({
      "academies/academy-1/users/user-1": user(),
    });
    const store = createStore(firestore);
    const input = createInput();

    const first = await store.createStaffProfile(input);
    const second = await store.createStaffProfile(input);

    expect(second).toEqual(first);
    expect(
      operations.filter((operation) => operation.startsWith("create:academies/academy-1/staff/")),
    ).toHaveLength(1);
    expect([...records.keys()].filter((key) => key.includes("/staff/")).length).toBe(1);
  });

  it("lists only same-tenant staff as a bounded deterministic safe projection", async () => {
    const first = storedStaff({ staffId: "staff-z", role: "coach" });
    const second = storedStaff({ staffId: "staff-a", role: "headCoach" });
    const { firestore } = createFakeFirestore({
      "academies/academy-1/staff/staff-z": first,
      "academies/academy-1/staff/staff-a": second,
      "academies/academy-2/staff/staff-cross-tenant": storedStaff({
        staffId: "staff-cross-tenant",
        academyId: "academy-2",
      }),
    });

    await expect(createStore(firestore).listStaffProfiles("academy-1")).resolves.toEqual([
      {
        staffKey: "staff-a",
        role: "headCoach",
        active: true,
        status: "active",
        schemaVersion: "1",
      },
      {
        staffKey: "staff-z",
        role: "coach",
        active: true,
        status: "active",
        schemaVersion: "1",
      },
    ]);
  });

  it("returns an empty list and rejects malformed stored staff documents", async () => {
    const empty = createFakeFirestore();
    await expect(createStore(empty.firestore).listStaffProfiles("academy-1")).resolves.toEqual([]);

    const malformed = createFakeFirestore({
      "academies/academy-1/staff/staff-invalid": storedStaff({ displayName: "private" }),
    });
    await expect(
      createStore(malformed.firestore).listStaffProfiles("academy-1"),
    ).rejects.toMatchObject({ code: "invalid" });

    const overflowing: Record<string, StaffDocumentData> = {};
    for (let index = 0; index < 101; index += 1) {
      overflowing[`academies/academy-1/staff/staff-${index}`] = storedStaff({
        staffId: `staff-${index}`,
      });
    }
    await expect(
      createStore(createFakeFirestore(overflowing).firestore).listStaffProfiles("academy-1"),
    ).rejects.toMatchObject({ code: "precondition" });
  });
});
