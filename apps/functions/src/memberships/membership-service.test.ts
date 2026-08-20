import { describe, expect, it } from "vitest";

import { PLAN_CATALOG, type PlanRecord } from "@bpt-jersey/domain/memberships";
import type { MembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import type { FamilyRecord, FamilyRelationship } from "@bpt-jersey/domain/families";
import type { StudentProfile } from "@bpt-jersey/domain/profiles";

import {
  MembershipStoreError,
  createMembershipStore,
  type MembershipDocumentData,
  type MembershipFirestore,
  type MembershipScope,
} from "./membership-service.js";

type Ref = Readonly<{ id: string; path: string }>;
type Query = Readonly<{
  path: string;
  field: string;
  value: unknown;
  limit?: number | ((count: number) => Query);
}>;

const academyId = "academy-1";
const familyId = "family-1";
const studentId = "student-1";
const now = "2026-08-19T10:00:00.000Z";
const later = "2026-08-20T10:00:00.000Z";

function createFakeFirestore(initial: Record<string, MembershipDocumentData> = {}) {
  const records = new Map(Object.entries(initial));
  const writes: string[] = [];
  const audits: MembershipDocumentData[] = [];
  const queries: Query[] = [];
  const reads: string[] = [];
  const state = { hasWritten: false, readAfterWrite: false };
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const firestore: MembershipFirestore = {
    doc: (path) => ref(path),
    collection: (path) => ({
      doc: (id?: string) => ref(`${path}/${id ?? "audit-generated"}`),
      where: (field, _operator, value) => ({
        path,
        field,
        value,
        limit: (count) => {
          const query = { path, field, value, limit: count };
          queries.push(query);
          return query;
        },
      }),
    }),
    runTransaction: async (callback) => {
      const snapshot = new Map(records);
      const transaction = {
        get: async (target: Ref | Query) => {
          reads.push("field" in target ? target.path : target.path);
          if (state.hasWritten) {
            state.readAfterWrite = true;
            throw new Error("read after write");
          }
          if ("field" in target) {
            const matchingDocs = [...records.entries()]
              .filter(
                ([path, data]) =>
                  path.startsWith(`${target.path}/`) && data[target.field] === target.value,
              )
              .map(([path, data]) => ({ ...ref(path), exists: true, data: () => data }));
            const limit = typeof target.limit === "number" ? target.limit : undefined;
            return { docs: limit === undefined ? matchingDocs : matchingDocs.slice(0, limit) };
          }
          const data = records.get(target.path);
          return { ...ref(target.path), exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: MembershipDocumentData) => {
          if (records.has(target.path)) throw new Error("already exists");
          state.hasWritten = true;
          writes.push(`create:${target.path}`);
          records.set(target.path, data);
          if (target.path.includes("/auditEvents/")) audits.push(data);
          return transaction;
        },
        set: (target: Ref, data: MembershipDocumentData) => {
          state.hasWritten = true;
          writes.push(`set:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
      };
      try {
        return await callback(transaction);
      } catch (error) {
        records.clear();
        for (const [path, data] of snapshot) records.set(path, data);
        writes.length = 0;
        audits.length = 0;
        throw error;
      }
    },
  };
  return { firestore, records, writes, audits, queries, reads, state };
}

function family(overrides: Partial<FamilyRecord> = {}): FamilyRecord {
  return {
    familyId,
    academyId,
    primaryContactUserId: "guardian-1",
    billingContactUserId: "guardian-1",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: "creator-1",
    updatedAt: now,
    updatedBy: "creator-1",
    ...overrides,
  };
}

function student(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return {
    studentId,
    academyId,
    familyId,
    fullName: "Synthetic Student",
    dateOfBirth: "2012-01-01",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "minor",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: "creator-1",
    updatedAt: now,
    updatedBy: "creator-1",
    ...overrides,
  };
}

function relationship(overrides: Partial<FamilyRelationship> = {}): FamilyRelationship {
  return {
    relationshipId: `${familyId}--${studentId}`,
    academyId,
    familyId,
    studentId,
    adultUserId: "guardian-1",
    relationshipType: "guardian",
    permissions: ["readProfile"],
    validFrom: now,
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: "creator-1",
    updatedAt: now,
    updatedBy: "creator-1",
    ...overrides,
  };
}

function plan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    ...PLAN_CATALOG[1]!,
    academyId,
    active: true,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "creator-1",
    updatedAt: now,
    updatedBy: "creator-1",
    ...overrides,
  };
}

function membership(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    membershipId: "membership-1",
    academyId,
    familyId,
    studentId,
    planId: "bpt-jersey-adult",
    status: "active",
    startsAt: now,
    endsAt: null,
    nextBillingAt: null,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "creator-1",
    updatedAt: now,
    updatedBy: "creator-1",
    ...overrides,
  };
}

function services(extra: Record<string, MembershipDocumentData> = {}) {
  const fake = createFakeFirestore({
    [`academies/${academyId}/families/${familyId}`]: family(),
    [`academies/${academyId}/students/${studentId}`]: student(),
    [`academies/${academyId}/relationships/${familyId}--${studentId}`]: relationship(),
    [`academies/${academyId}/plans/bpt-jersey-adult`]: plan(),
    ...extra,
  });
  const store = createMembershipStore({
    firestore: fake.firestore,
    generateMembershipId: () => "membership-generated",
  });
  return { ...fake, store };
}

const unrestrictedScope: MembershipScope = { academyId };
const baseCreateInput = {
  academyId,
  actorId: "actor-1",
  now,
  familyId,
  studentId,
  planId: "bpt-jersey-adult" as const,
  status: "trial" as const,
  scope: unrestrictedScope,
};

describe("membership Firestore store", () => {
  it("creates trial and active memberships with references, envelope, and one audit draft", async () => {
    const { store, records, writes, audits, reads, state } = services();

    const trial = await store.createMembership(baseCreateInput);
    expect(trial).toMatchObject({
      membershipId: "membership-generated",
      academyId,
      familyId,
      studentId,
      planId: "bpt-jersey-adult",
      status: "trial",
      startsAt: now,
      endsAt: null,
      nextBillingAt: null,
      createdAt: now,
      createdBy: "actor-1",
      updatedAt: now,
      updatedBy: "actor-1",
    });
    expect(records.get(`academies/${academyId}/memberships/membership-generated`)).toEqual(trial);
    expect(writes).toEqual([
      `create:academies/${academyId}/memberships/membership-generated`,
      `create:academies/${academyId}/auditEvents/audit-generated`,
    ]);
    expect(audits[0]).toMatchObject({
      academyId,
      actorId: "actor-1",
      action: "membership.created",
      targetRef: `academies/${academyId}/memberships/membership-generated`,
    });
    expect(audits[0]).not.toHaveProperty("priceMinor");
    expect(reads.length).toBeGreaterThan(0);
    expect(state.readAfterWrite).toBe(false);

    const active = await services().store.createMembership({
      ...baseCreateInput,
      status: "active",
      actorId: "actor-2",
    });
    expect(active.status).toBe("active");
  });

  it("lists and gets only memberships inside the authorization scope", async () => {
    const existing = membership();
    const other = membership({
      membershipId: "membership-2",
      familyId: "family-2",
      studentId: "student-2",
    });
    const { store, queries } = services({
      [`academies/${academyId}/memberships/${existing.membershipId}`]: existing,
      [`academies/${academyId}/memberships/${other.membershipId}`]: other,
    });

    const scope: MembershipScope = { academyId, familyIds: [familyId] };
    await expect(store.listMemberships(scope)).resolves.toEqual([existing]);
    await expect(store.getMembership(scope, existing.membershipId)).resolves.toEqual(existing);
    await expect(store.getMembership(scope, other.membershipId)).resolves.toBeUndefined();
    expect(queries).toContainEqual({
      path: `academies/${academyId}/memberships`,
      field: "academyId",
      value: academyId,
      limit: 100,
    });
  });

  it("rejects inactive plans, unknown students, family mismatch, and cross-tenant references", async () => {
    await expect(
      services({
        [`academies/${academyId}/plans/bpt-jersey-adult`]: plan({ active: false }),
      }).store.createMembership(baseCreateInput),
    ).rejects.toMatchObject({ code: "precondition" });

    await expect(
      services().store.createMembership({ ...baseCreateInput, studentId: "missing-student" }),
    ).rejects.toMatchObject({ code: "invalid" });

    await expect(
      services().store.createMembership({ ...baseCreateInput, familyId: "other-family" }),
    ).rejects.toMatchObject({ code: "invalid" });

    await expect(
      services({
        [`academies/${academyId}/students/${studentId}`]: student({ familyId: "other-family" }),
      }).store.createMembership(baseCreateInput),
    ).rejects.toMatchObject({ code: "conflict" });

    await expect(
      services({
        [`academies/${academyId}/plans/bpt-jersey-adult`]: plan({ academyId: "academy-2" }),
      }).store.createMembership(baseCreateInput),
    ).rejects.toMatchObject({ code: "tenant" });

    await expect(
      services({
        [`academies/${academyId}/families/${familyId}`]: family({ familyId: "family-2" }),
      }).store.createMembership(baseCreateInput),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      services({
        [`academies/${academyId}/students/${studentId}`]: student({ studentId: "student-2" }),
      }).store.createMembership(baseCreateInput),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      services({
        [`academies/${academyId}/plans/bpt-jersey-adult`]: plan({ planId: "town-adult" }),
      }).store.createMembership(baseCreateInput),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects a duplicate current membership and does not leave writes or financial documents", async () => {
    const { store, records, writes } = services({
      [`academies/${academyId}/memberships/membership-existing`]: membership({
        membershipId: "membership-existing",
        status: "paused",
      }),
    });

    await expect(store.createMembership(baseCreateInput)).rejects.toMatchObject({
      code: "duplicate",
    });
    expect(writes).toEqual([]);
    expect(
      [...records.keys()].some((path) => /payments|invoices|receipts|balances|debt/u.test(path)),
    ).toBe(false);
  });

  it("detects a current membership after more than one hundred cancelled history records", async () => {
    const history = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => {
        const membershipId = `membership-history-${String(index).padStart(3, "0")}`;
        return [
          `academies/${academyId}/memberships/${membershipId}`,
          membership({ membershipId, status: "cancelled", endsAt: now }),
        ];
      }),
    );
    const current = membership({ membershipId: "membership-current-late", status: "active" });

    await expect(
      services({
        ...history,
        [`academies/${academyId}/memberships/${current.membershipId}`]: current,
      }).store.createMembership(baseCreateInput),
    ).rejects.toMatchObject({ code: "duplicate" });
  });

  it("applies every valid transition and keeps immutable references", async () => {
    const validTransitions = [
      ["trial", "active"],
      ["trial", "cancelled"],
      ["active", "paused"],
      ["active", "overdue"],
      ["active", "cancelled"],
      ["paused", "active"],
      ["paused", "cancelled"],
      ["overdue", "active"],
      ["overdue", "cancelled"],
    ] as const;

    for (const [currentStatus, targetStatus] of validTransitions) {
      const current = membership({ status: currentStatus });
      const { store } = services({
        [`academies/${academyId}/memberships/${current.membershipId}`]: current,
      });
      const updated = await store.transitionMembership({
        academyId,
        actorId: "actor-2",
        now: later,
        membershipId: current.membershipId,
        targetStatus,
        scope: unrestrictedScope,
      });
      expect(updated).toMatchObject({
        membershipId: current.membershipId,
        familyId: current.familyId,
        studentId: current.studentId,
        planId: current.planId,
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        updatedAt: later,
        updatedBy: "actor-2",
        status: targetStatus,
      });
    }

    await expect(
      services({
        [`academies/${academyId}/memberships/membership-1`]: membership({ status: "paused" }),
        [`academies/${academyId}/plans/bpt-jersey-adult`]: plan({ active: false }),
      }).store.transitionMembership({
        academyId,
        actorId: "actor-2",
        now: later,
        membershipId: "membership-1",
        targetStatus: "active",
        scope: unrestrictedScope,
      }),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("rejects invalid and terminal transitions, while same-state retry is a no-op", async () => {
    const current = membership();
    const { store, writes, audits } = services({
      [`academies/${academyId}/memberships/${current.membershipId}`]: current,
    });

    await expect(
      store.transitionMembership({
        academyId,
        actorId: "actor-2",
        now: later,
        membershipId: current.membershipId,
        targetStatus: "trial",
        scope: unrestrictedScope,
      }),
    ).rejects.toMatchObject({ code: "precondition" });
    expect(writes).toEqual([]);

    const sameState = await store.transitionMembership({
      academyId,
      actorId: "actor-2",
      now: later,
      membershipId: current.membershipId,
      targetStatus: "active",
      scope: unrestrictedScope,
    });
    expect(sameState).toEqual(current);
    expect(writes).toEqual([]);
    expect(audits).toEqual([]);

    for (const scope of [
      { academyId, familyIds: ["family-2"] },
      { academyId, studentIds: ["student-2"] },
    ] satisfies readonly MembershipScope[]) {
      await expect(
        store.transitionMembership({
          academyId,
          actorId: "actor-2",
          now: later,
          membershipId: current.membershipId,
          targetStatus: "paused",
          scope,
        }),
      ).rejects.toMatchObject({ code: "tenant" });
    }

    const cancelled = membership({ status: "cancelled", endsAt: later });
    await expect(
      services({
        [`academies/${academyId}/memberships/${cancelled.membershipId}`]: cancelled,
      }).store.transitionMembership({
        academyId,
        actorId: "actor-2",
        now: later,
        membershipId: cancelled.membershipId,
        targetStatus: "active",
        scope: unrestrictedScope,
      }),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("sets cancellation endsAt once, audits effective changes, and maps missing data safely", async () => {
    const current = membership({ endsAt: null });
    const { store, audits, writes } = services({
      [`academies/${academyId}/memberships/${current.membershipId}`]: current,
    });
    const cancelled = await store.transitionMembership({
      academyId,
      actorId: "actor-2",
      now: later,
      membershipId: current.membershipId,
      targetStatus: "cancelled",
      scope: unrestrictedScope,
    });
    expect(cancelled.endsAt).toBe(later);
    expect(audits[0]).toMatchObject({
      action: "membership.status.changed",
      targetRef: `academies/${academyId}/memberships/${current.membershipId}`,
    });
    expect(writes).toHaveLength(2);

    const alreadyEnded = membership({ endsAt: now });
    await expect(
      services({
        [`academies/${academyId}/memberships/${alreadyEnded.membershipId}`]: alreadyEnded,
      }).store.transitionMembership({
        academyId,
        actorId: "actor-2",
        now: later,
        membershipId: alreadyEnded.membershipId,
        targetStatus: "cancelled",
        scope: unrestrictedScope,
      }),
    ).resolves.toMatchObject({ endsAt: now });

    await expect(
      services().store.getMembership(unrestrictedScope, "missing-membership"),
    ).resolves.toBeUndefined();
    await expect(
      services({
        [`academies/${academyId}/memberships/${current.membershipId}`]: {
          ...current,
          unexpected: true,
        },
      }).store.transitionMembership({
        academyId,
        actorId: "actor-2",
        now: later,
        membershipId: current.membershipId,
        targetStatus: "cancelled",
        scope: unrestrictedScope,
      }),
    ).rejects.toBeInstanceOf(MembershipStoreError);
  });

  it("maps an adapter failure without exposing its raw message", async () => {
    const store = createMembershipStore({
      firestore: {
        doc: (path) => ({ id: path.split("/").at(-1) ?? "", path }),
        collection: () => ({
          doc: () => ({
            id: "audit-generated",
            path: "academies/academy-1/auditEvents/audit-generated",
          }),
          where: () => ({
            path: "academies/academy-1/memberships",
            field: "academyId",
            value: academyId,
            limit: () => ({
              path: "academies/academy-1/memberships",
              field: "academyId",
              value: academyId,
              limit: 100,
            }),
          }),
        }),
        runTransaction: async () => {
          throw new Error("raw firestore path");
        },
      },
    });

    await expect(store.getMembership(unrestrictedScope, "membership-1")).rejects.toMatchObject({
      code: "transaction",
      message: "Membership store operation failed",
    });
  });
});
