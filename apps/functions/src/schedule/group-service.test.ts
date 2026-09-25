import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";

import { saveMemberGroup } from "./group-callables";
import { groupKey } from "./group-keys";
import { createGroupService } from "./group-service";

vi.mock("../auth/office-actor.js", () => ({
  requireActiveOfficeActor: async () => ({
    userId: "owner-1",
    role: "owner",
    academyId: "demo-academy",
  }),
}));
vi.mock("firebase-admin/firestore", async (original) => ({
  ...(await original<typeof import("firebase-admin/firestore")>()),
  getFirestore: () => ({}),
}));

type Document = Record<string, unknown>;
type Filter = Readonly<{ field: string; operator: string; value: unknown }>;

const academyId = "demo-academy";
const root = `academies/${academyId}`;

/** The slice of the Admin SDK the group service and the booking transaction use, held in memory. */
function createDb() {
  const store = new Map<string, Document>();
  let generated = 0;
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const snapshot = (path: string) => {
    const value = store.get(path);
    return {
      id: idOf(path),
      exists: value !== undefined,
      ref: docRef(path),
      data: () => value,
      get: (field: string) => value?.[field],
    };
  };
  function docRef(path: string) {
    return {
      id: idOf(path),
      path,
      get: async () => snapshot(path),
      set: async (value: Document) => void store.set(path, value),
    };
  }
  function query(path: string, filters: readonly Filter[]): Document {
    return {
      collectionPath: path,
      where: (field: string, operator: string, value: unknown) =>
        query(path, [...filters, { field, operator, value }]),
      limit: () => query(path, filters),
      doc: (id?: string) => docRef(`${path}/${id ?? `generated-${(generated += 1)}`}`),
      get: async () => run(path, filters),
    };
  }
  function run(path: string, filters: readonly Filter[]) {
    const docs = [...store.keys()]
      .filter((key) => parentOf(key) === path)
      .filter((key) =>
        filters.every(({ field, operator, value }) => {
          const actual = store.get(key)![field];
          if (operator === "==") return actual === value;
          if (operator === "array-contains") return Array.isArray(actual) && actual.includes(value);
          if (operator === ">=") return String(actual) >= String(value);
          if (operator === "<") return String(actual) < String(value);
          throw new Error(`Unsupported operator ${operator}`);
        }),
      )
      .map(snapshot);
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
  const read = async (target: Document) =>
    typeof target.collectionPath === "string"
      ? (target.get as () => Promise<unknown>)()
      : snapshot(String(target.path));
  const db = {
    collection: (path: string) => query(path, []),
    doc: (path: string) => docRef(path),
    getAll: async (...refs: { path: string }[]) => refs.map((ref) => snapshot(ref.path)),
    runTransaction: async <T>(update: (tx: unknown) => Promise<T>): Promise<T> => {
      const writes: [string, Document | null, "set" | "update"][] = [];
      const tx = {
        get: read,
        getAll: async (...refs: { path: string }[]) => refs.map((ref) => snapshot(ref.path)),
        set: (ref: { path: string }, value: Document) => void writes.push([ref.path, value, "set"]),
        create: (ref: { path: string }, value: Document) => {
          if (store.has(ref.path)) throw new Error(`${ref.path} already exists`);
          writes.push([ref.path, value, "set"]);
        },
        update: (ref: { path: string }, value: Document) =>
          void writes.push([ref.path, value, "update"]),
      };
      const result = await update(tx);
      for (const [path, value, kind] of writes)
        store.set(path, kind === "update" ? { ...store.get(path), ...value } : value!);
      return result;
    },
  };
  return {
    db: db as unknown as Firestore,
    seed: (path: string, value: Document) => store.set(`${root}/${path}`, value),
    get: (path: string) => store.get(`${root}/${path}`),
    list: (collection: string) =>
      [...store.entries()]
        .filter(([key]) => parentOf(key) === `${root}/${collection}`)
        .map(([, value]) => value),
  };
}

const stamp = "2026-01-01T00:00:00.000Z";
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

function seedStudent(db: ReturnType<typeof createDb>, studentId: string, extra: Document = {}) {
  db.seed(`students/${studentId}`, {
    studentId,
    academyId,
    familyId: `family-${studentId}`,
    userId: `user-${studentId}`,
    fullName: `Member ${studentId}`,
    dateOfBirth: "1996-01-01",
    phoneNumber: "+441534000000",
    email: `${studentId}@example.test`,
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: stamp,
    createdBy: "owner-1",
    updatedAt: stamp,
    updatedBy: "owner-1",
    ...extra,
  });
}
function seedMembership(db: ReturnType<typeof createDb>, studentId: string, extra: Document = {}) {
  db.seed(`memberships/m-${studentId}`, {
    membershipId: `m-${studentId}`,
    academyId,
    familyId: `family-${studentId}`,
    studentId,
    planId: "bpt-jersey-adult",
    status: "active",
    startsAt: stamp,
    endsAt: null,
    nextBillingAt: null,
    schemaVersion: "1",
    createdAt: stamp,
    createdBy: "owner-1",
    updatedAt: stamp,
    updatedBy: "owner-1",
    ...extra,
  });
}
function seedTrial(db: ReturnType<typeof createDb>, studentId: string, extra: Document = {}) {
  db.seed(`trialAccess/${studentId}`, {
    trialId: `trial-${studentId}`,
    academyId,
    studentId,
    site: "Town",
    experience: "beginner",
    allowance: 2,
    countedAttendanceIds: [],
    status: "active",
    startsAt: inDays(-2),
    expiresAt: inDays(28),
    enrolmentRequestId: `enrol-${studentId}`,
    createdAt: inDays(-2),
    updatedAt: inDays(-2),
    schemaVersion: "1",
    ...extra,
  });
}
/** A parent account that is the primary contact of the child's family. */
function seedFamily(db: ReturnType<typeof createDb>, parentId: string, childId: string) {
  db.seed(`families/family-${childId}`, {
    familyId: `family-${childId}`,
    academyId,
    primaryContactUserId: `user-${parentId}`,
  });
}

const actor = { userId: "owner-1", role: "owner" as const };
const save = (db: ReturnType<typeof createDb>, studentIds: string[], extra: Document = {}) =>
  createGroupService(db.db, academyId).save(
    {
      groupId: "g1",
      name: "Competition team",
      site: "Town",
      studentIds,
      revision: 0,
      ...extra,
    } as never,
    actor,
  );

describe("saving a group", () => {
  let db: ReturnType<typeof createDb>;
  beforeEach(() => {
    db = createDb();
    seedStudent(db, "parent", { fullName: "Pat Parent" });
    seedStudent(db, "kid", { dateOfBirth: "2016-01-01", participantType: "kids" });
    seedFamily(db, "parent", "kid");
  });

  it("stores the group's site", async () => {
    seedMembership(db, "kid");
    await save(db, ["kid"]);
    expect(db.get("memberGroups/g1")).toMatchObject({
      site: "Town",
      studentIds: ["kid"],
      revision: 1,
    });
  });

  it("refuses a guardian whose child trains, naming them", async () => {
    seedMembership(db, "kid");
    await expect(save(db, ["parent"])).rejects.toMatchObject({
      code: "failed-precondition",
      message: "Guardians can't be added to a group: Pat Parent",
    });
    expect(db.get("memberGroups/g1")).toBeUndefined();
  });

  it("refuses a guardian whose child is on an active trial", async () => {
    seedTrial(db, "kid");
    await expect(save(db, ["parent"])).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("accepts a guardian who trains on their own plan", async () => {
    seedMembership(db, "kid");
    seedMembership(db, "parent");
    await save(db, ["parent"]);
    expect(db.get("memberGroups/g1")).toMatchObject({ studentIds: ["parent"] });
  });

  it("accepts a parent on their own overdue plan whose child trains", async () => {
    seedMembership(db, "kid");
    seedMembership(db, "parent", { status: "overdue" });
    await save(db, ["parent"]);
    expect(db.get("memberGroups/g1")).toMatchObject({ studentIds: ["parent"] });
  });

  it("refuses a guardian whose child is on an overdue plan, as the Members list shows them", async () => {
    seedMembership(db, "kid", { status: "overdue" });
    await expect(save(db, ["parent"])).rejects.toMatchObject({
      message: "Guardians can't be added to a group: Pat Parent",
    });
  });

  it("accepts a guardian on their own active trial", async () => {
    seedMembership(db, "kid");
    seedTrial(db, "parent");
    await save(db, ["parent"]);
    expect(db.get("memberGroups/g1")).toMatchObject({ studentIds: ["parent"] });
  });

  it("does not treat a parent of inactive or unpaid children as a guardian", async () => {
    seedTrial(db, "kid", { status: "converted" });
    await save(db, ["parent"]);
    seedStudent(db, "kid", { active: false, status: "inactive" });
    seedMembership(db, "kid");
    await save(db, ["parent"], { groupId: "g2" });
    expect(db.get("memberGroups/g2")).toMatchObject({ studentIds: ["parent"] });
  });

  it("refuses an inactive member", async () => {
    seedStudent(db, "gone", { active: false, status: "inactive" });
    await expect(save(db, ["gone"])).rejects.toMatchObject({
      code: "failed-precondition",
      message: "Only active members can be added: Member gone",
    });
  });

  it("renames a group whose existing member has since become inactive", async () => {
    seedMembership(db, "kid");
    await save(db, ["kid"]);
    seedStudent(db, "kid", { active: false, status: "inactive" });
    await save(db, ["kid"], { name: "Renamed team", site: "West", revision: 1 });
    expect(db.get("memberGroups/g1")).toMatchObject({
      name: "Renamed team",
      site: "West",
      studentIds: ["kid"],
      revision: 2,
    });
  });

  it("still refuses a guardian added to a group that already exists", async () => {
    seedMembership(db, "kid");
    await save(db, ["kid"]);
    await expect(save(db, ["kid", "parent"], { revision: 1 })).rejects.toMatchObject({
      message: "Guardians can't be added to a group: Pat Parent",
    });
    expect(db.get("memberGroups/g1")).toMatchObject({ studentIds: ["kid"], revision: 1 });
  });

  it("lists each group's site and leaves older groups without one", async () => {
    seedMembership(db, "kid");
    await save(db, ["kid"]);
    db.seed("memberGroups/g0", {
      groupId: "g0",
      academyId,
      name: "Before sites",
      studentIds: [],
      revision: 3,
      active: true,
      updatedAt: stamp,
    });
    const groups = await createGroupService(db.db, academyId).list();
    expect(groups.map((group) => [group.groupId, group.site])).toEqual([
      ["g0", undefined],
      ["g1", "Town"],
    ]);
  });
});

describe("registering a group for a class", () => {
  const startAt = inDays(3);
  function seedClass(db: ReturnType<typeof createDb>) {
    db.seed("sessions/sess1", {
      sessionId: "sess1",
      academyId,
      classId: null,
      programId: "tiny-kids",
      locationId: "west",
      instructorId: "coach-1",
      title: "Tiny Kids",
      startAt,
      endAt: new Date(Date.parse(startAt) + 3_600_000).toISOString(),
      capacity: 10,
      minParticipants: 1,
      status: "scheduled",
      cancellationReason: null,
      schemaVersion: "1",
      createdAt: stamp,
      createdBy: "owner-1",
      updatedAt: stamp,
      updatedBy: "owner-1",
    });
    db.seed("programs/tiny-kids", {
      programId: "tiny-kids",
      academyId,
      name: "Tiny Kids",
      ageBand: "kids",
      ageRange: { minAge: 4, maxAge: 5 },
      sites: ["Town"],
      discipline: "bjj",
      level: "fundamentals",
      active: true,
      schemaVersion: "1",
    });
    db.seed("plans/town-adult", {
      ...PLAN_CATALOG.find((plan) => plan.planId === "town-adult")!,
      academyId,
      active: true,
      schemaVersion: "1",
      createdAt: stamp,
      createdBy: "owner-1",
      updatedAt: stamp,
      updatedBy: "owner-1",
    });
    db.seed("memberGroups/g1", {
      groupId: "g1",
      academyId,
      name: "Coaches",
      site: "West",
      studentIds: ["adult", "unpaid"],
      revision: 1,
      active: true,
      updatedAt: stamp,
    });
  }

  it("books an adult into a class their age, centre and plan would not allow, and blocks an unpaid member", async () => {
    const db = createDb();
    seedClass(db);
    seedStudent(db, "adult");
    seedMembership(db, "adult", { planId: "town-adult" });
    seedStudent(db, "unpaid");

    await createGroupService(db.db, academyId).enrol("g1", "sess1", actor);

    expect(db.list("bookings")).toEqual([
      expect.objectContaining({ studentId: "adult", status: "confirmed" }),
    ]);
    expect(db.get(`groupRegistrationResults/${groupKey("g1", "sess1", "adult")}`)).toMatchObject({
      state: "registered",
    });
    expect(db.get(`groupRegistrationResults/${groupKey("g1", "sess1", "unpaid")}`)).toMatchObject({
      state: "blocked",
      reason: "Missing Payment",
    });
  });
});

describe("groups offered for a class", () => {
  function seedSession(db: ReturnType<typeof createDb>, locationId: string) {
    db.seed("sessions/sess1", {
      sessionId: "sess1",
      academyId,
      programId: "p1",
      locationId,
      startAt: inDays(3),
      status: "scheduled",
    });
    for (const [groupId, site] of [
      ["g-town", "Town"],
      ["g-west", "West"],
      ["g-old", undefined],
    ] as const)
      db.seed(`memberGroups/${groupId}`, {
        groupId,
        academyId,
        name: groupId,
        ...(site ? { site } : {}),
        studentIds: [],
        revision: 1,
        active: true,
        updatedAt: stamp,
      });
  }

  it("offers the office only groups from the class's site and groups without a site", async () => {
    const db = createDb();
    seedSession(db, "west");
    const groups = await createGroupService(db.db, academyId).sessionGroups("sess1", true);
    expect(groups.map((group) => [group.groupId, group.site])).toEqual([
      ["g-old", undefined],
      ["g-west", "West"],
    ]);
  });

  it("refuses to register a group from the other site", async () => {
    const db = createDb();
    seedSession(db, "town");
    await expect(
      createGroupService(db.db, academyId).enrol("g-west", "sess1", actor),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      message: "Choose a group from this class's site.",
    });
    expect(db.list("groupAssignments")).toEqual([]);
  });
});

describe("saveMemberGroup callable", () => {
  it("refuses a group without a site", async () => {
    await expect(
      saveMemberGroup.run({
        data: { groupId: "g1", name: "Competition team", studentIds: [], revision: 0 },
      } as never),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
