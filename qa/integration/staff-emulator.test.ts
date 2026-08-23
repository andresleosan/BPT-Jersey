import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { appendAuditEventInTransaction } from "../../apps/functions/src/audit/audit-writer.js";
import {
  createStaffStore,
  type StaffFirestore,
  type StaffStore,
} from "../../apps/functions/src/staff/staff-service.js";

const runId = `staff-integration-${process.pid}-${randomUUID()}`;
const academyA = `${runId}-academy-a`;
const academyB = `${runId}-academy-b`;
const userA = `${runId}-user-a`;
const userB = `${runId}-user-b`;
const actorA = `${runId}-owner-a`;
const now = "2026-08-21T12:00:00.000Z";
const later = "2026-08-21T13:00:00.000Z";
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();

function isLocalEmulatorHost(host: string | undefined): boolean {
  if (host === undefined || host === "") return false;
  try {
    const url = new URL(`http://${host}`);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") &&
      url.pathname === "/" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

const useLocalEmulator = isLocalEmulatorHost(firestoreEmulatorHost);
if (!useLocalEmulator) {
  console.warn(
    "SKIP staff emulator integration: FIRESTORE_EMULATOR_HOST must be a local emulator host",
  );
}

const app = useLocalEmulator ? initializeApp({ projectId: "demo-bpt-jersey" }, runId) : undefined;
const firestore = app === undefined ? undefined : getFirestore(app);
const store =
  firestore === undefined
    ? undefined
    : createStaffStore({
        firestore: firestore as unknown as StaffFirestore,
        appendAudit: (transaction, reference, draft) => {
          appendAuditEventInTransaction(transaction, reference, draft);
        },
      });

const academyCollections = Object.freeze([
  "users",
  "staff",
  "staffAvailability",
  "staffAssignments",
  "locations",
  "programs",
  "classes",
  "auditEvents",
  "adminRoleLocks",
] as const);
const safeAuditEventFields = Object.freeze([
  "academyId",
  "actorId",
  "action",
  "targetRef",
  "purpose",
  "correlationId",
  "auditEventId",
  "occurredAt",
  "result",
  "schemaVersion",
] as const);
const piiFieldPattern =
  /(?:email|phone|telephone|displayName|fullName|firstName|lastName|address|dateOfBirth|dob|user(?:Id)?|uid|medical|health|diagnos|passport|national|card|token|cookie|secret|password)/iu;

function requireFirestore(): Firestore {
  if (firestore === undefined) throw new Error("Local Firestore emulator is unavailable");
  return firestore;
}

function requireStore(): StaffStore {
  if (store === undefined) throw new Error("Staff store is unavailable");
  return store;
}

async function deleteCollection(path: string): Promise<void> {
  const currentFirestore = requireFirestore();
  const snapshot = await currentFirestore.collection(path).get();
  await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
}

async function clearRunData(): Promise<void> {
  await Promise.all(
    [academyA, academyB].flatMap((academyId) =>
      academyCollections.map((collectionName) =>
        deleteCollection(`academies/${academyId}/${collectionName}`),
      ),
    ),
  );
}

function assertNoPiiFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPiiFields(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, nestedValue] of Object.entries(value)) {
    expect(key, `${path}.${key} must not contain PII`).not.toMatch(piiFieldPattern);
    assertNoPiiFields(nestedValue, `${path}.${key}`);
  }
}

async function seedFixture(): Promise<void> {
  const currentFirestore = requireFirestore();
  await Promise.all([
    currentFirestore.doc(`academies/${academyA}/users/${userA}`).set({
      userId: userA,
      academyId: academyA,
      accountType: "staff",
      active: true,
      status: "active",
    }),
    currentFirestore.doc(`academies/${academyB}/users/${userB}`).set({
      userId: userB,
      academyId: academyB,
      accountType: "staff",
      active: true,
      status: "active",
    }),
    currentFirestore.doc(`academies/${academyA}/users/${userB}`).set({
      userId: userB,
      academyId: academyB,
      accountType: "staff",
      active: true,
      status: "active",
    }),
    ...[academyA, academyB].flatMap((academyId) => [
      currentFirestore.doc(`academies/${academyId}/locations/location-town`).set({ academyId }),
      currentFirestore.doc(`academies/${academyId}/programs/program-bjj`).set({ academyId }),
      currentFirestore.doc(`academies/${academyId}/classes/class-fundamentals`).set({ academyId }),
    ]),
  ]);
}

const describeLocal = useLocalEmulator ? describe : describe.skip;

describeLocal("staff lifecycle against the local Firestore emulator", () => {
  it("runs the complete tenant-scoped staff lifecycle", async () => {
    await seedFixture();
    const currentFirestore = requireFirestore();
    const currentStore = requireStore();

    const created = await currentStore.createStaffProfile({
      academyId: academyA,
      actorId: actorA,
      userId: userA,
      role: "coach",
      now,
      requestId: `${runId}-create-1`,
    });
    const retried = await currentStore.createStaffProfile({
      academyId: academyA,
      actorId: actorA,
      userId: userA,
      role: "coach",
      now: later,
      requestId: `${runId}-create-1`,
    });

    expect(retried).toEqual(created);
    await expect(
      currentFirestore.collection(`academies/${academyA}/staff`).get(),
    ).resolves.toMatchObject({
      size: 1,
    });

    const updated = await currentStore.updateStaffProfile({
      academyId: academyA,
      actorId: actorA,
      staffId: created.staffId,
      role: "headCoach",
      now: later,
    });
    expect(updated).toMatchObject({ role: "headCoach", active: true, status: "active" });

    await currentStore.replaceStaffAvailability({
      academyId: academyA,
      actorId: actorA,
      staffId: created.staffId,
      windows: [
        { weekday: 1, startLocal: "17:00", endLocal: "19:00", timezone: "Europe/London" },
        { weekday: 3, startLocal: "18:00", endLocal: "20:00", timezone: "Europe/London" },
      ],
    });
    await currentStore.replaceStaffAvailability({
      academyId: academyA,
      actorId: actorA,
      staffId: created.staffId,
      windows: [{ weekday: 1, startLocal: "18:00", endLocal: "20:00", timezone: "Europe/London" }],
    });
    const availability = await currentFirestore
      .collection(`academies/${academyA}/staffAvailability`)
      .where("staffId", "==", created.staffId)
      .get();
    expect(availability.docs).toHaveLength(3);
    expect(availability.docs.map((document) => document.data().active).sort()).toEqual([
      false,
      false,
      true,
    ]);

    await currentStore.replaceStaffAssignments({
      academyId: academyA,
      actorId: actorA,
      staffId: created.staffId,
      assignments: [
        { targetType: "location", targetId: "location-town" },
        { targetType: "program", targetId: "program-bjj" },
      ],
    });
    await currentStore.replaceStaffAssignments({
      academyId: academyA,
      actorId: actorA,
      staffId: created.staffId,
      assignments: [{ targetType: "class", targetId: "class-fundamentals" }],
    });
    const assignments = await currentFirestore
      .collection(`academies/${academyA}/staffAssignments`)
      .where("staffId", "==", created.staffId)
      .get();
    expect(assignments.docs).toHaveLength(3);
    expect(
      assignments.docs
        .find((document) => document.data().targetId === "class-fundamentals")
        ?.data(),
    ).toMatchObject({ active: true, academyId: academyA, staffId: created.staffId });
    expect(
      assignments.docs
        .filter((document) => document.data().targetId !== "class-fundamentals")
        .every((document) => document.data().active === false),
    ).toBe(true);

    const deactivated = await currentStore.setStaffActive({
      academyId: academyA,
      actorId: actorA,
      staffId: created.staffId,
      active: false,
      now: later,
    });
    expect(deactivated).toMatchObject({ active: false, status: "inactive" });

    const revokedAvailability = await currentFirestore
      .collection(`academies/${academyA}/staffAvailability`)
      .where("staffId", "==", created.staffId)
      .get();
    const revokedAssignments = await currentFirestore
      .collection(`academies/${academyA}/staffAssignments`)
      .where("staffId", "==", created.staffId)
      .get();
    expect(revokedAvailability.docs.every((document) => document.data().active === false)).toBe(
      true,
    );
    expect(revokedAssignments.docs.every((document) => document.data().active === false)).toBe(
      true,
    );

    const auditEvents = await currentFirestore
      .collection(`academies/${academyA}/auditEvents`)
      .get();
    const actions = auditEvents.docs.map((document) => document.data().action).sort();
    expect(actions).toEqual([
      "staff.assignments.replaced",
      "staff.assignments.replaced",
      "staff.availability.replaced",
      "staff.availability.replaced",
      "staff.created",
      "staff.status.changed",
      "staff.updated",
    ]);
    for (const document of auditEvents.docs) {
      const data = document.data();
      expect(Object.keys(data).sort()).toEqual([...safeAuditEventFields].sort());
      assertNoPiiFields(data, `auditEvents/${document.id}`);
    }

    await expect(
      currentStore.createStaffProfile({
        academyId: academyA,
        actorId: actorA,
        userId: userB,
        role: "coach",
        now,
        requestId: `${runId}-cross-tenant`,
      }),
    ).rejects.toMatchObject({ code: "tenant" });
  });

  afterAll(async () => {
    try {
      await clearRunData();
    } finally {
      if (app !== undefined) await deleteApp(app);
    }
  });
});
