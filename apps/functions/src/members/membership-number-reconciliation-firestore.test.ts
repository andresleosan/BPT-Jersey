import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { memberDirectoryStateSchema } from "@bpt-jersey/domain/members/directory";
import type { MembershipNumberPlan } from "@bpt-jersey/domain/members/membership-number";

import { buildStudentIdentityKey } from "./member-directory-crypto.js";

import {
  applyMembershipNumberReconciliation,
  createMembershipNumberReconciliationFirestoreStore,
  expectedMembershipNumberReconciliationConfirmation,
  planMembershipNumberReconciliation,
  type MembershipNumberReconciliationStore,
} from "./membership-number-reconciliation-firestore.js";
import { buildMembershipNumberReconciliationPlan } from "./membership-number-reconciliation.js";

const now = "2026-09-21T05:00:00.000Z";
const identitySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

type Stored = Readonly<{ version: string; data: Readonly<Record<string, unknown>> }>;

const statePath = "academies/academy-1/memberDirectoryStates/current";

function directoryState(overrides: Record<string, unknown> = {}) {
  return memberDirectoryStateSchema.parse({
    stateId: "current",
    academyId: "academy-1",
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 794,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: "baseline-1",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "2",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 400,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "system",
    ...overrides,
  });
}

const eliminated = {
  globalLegacyReadEliminated: true,
  rollbackProtocolVersion: "disabled",
  stateRevision: 795,
};

function fakeStore(initial: Record<string, Stored>) {
  const records = new Map(Object.entries(initial));
  const writes: string[] = [];
  const reads: string[] = [];
  const listRows = async ({
    academyId,
    legacyReadsEliminated,
  }: Readonly<{ academyId: string; legacyReadsEliminated?: boolean }>) =>
    [...records.entries()].flatMap(([path, stored]) => {
      const prefix = `academies/${academyId}/`;
      if (!path.startsWith(prefix)) return [];
      const recordRef = path.slice(prefix.length);
      if (!/^(?:studentAdminProfiles|members)\//u.test(recordRef)) return [];
      if (legacyReadsEliminated === true && recordRef.startsWith("members/")) return [];
      const membershipNumber = stored.data.membershipNumber;
      if (typeof membershipNumber !== "string") return [];
      const sourceKind = recordRef.startsWith("studentAdminProfiles/") ? "canonical" : "legacy";
      const ownerId = sourceKind === "canonical" ? stored.data.studentId : stored.data.memberId;
      if (typeof ownerId !== "string") throw new Error("Invalid synthetic owner");
      return [
        {
          recordRef,
          sourceKind,
          ownerId,
          sourceVersion: stored.version,
          membershipNumber,
        } as const,
      ];
    });
  const store: MembershipNumberReconciliationStore = {
    identitySecretMaterial: identitySecret,
    identitySecretVersion: "identity-v1",
    listSourceRows: listRows,
    firestore: {
      doc: (path) => ({ id: path.split("/").at(-1) ?? "", path }),
      runTransaction: async (callback) => {
        const staged = new Map<string, Readonly<Record<string, unknown>>>();
        const creates = new Set<string>();
        const transaction = {
          get: async (reference: Readonly<{ id: string; path: string }>) => {
            // Real Firestore rejects this; the first production apply failed on it (2026-09-21).
            if (staged.size > 0) {
              throw new Error(
                "Firestore transactions require all reads to be executed before all writes.",
              );
            }
            reads.push(reference.path);
            const stored = records.get(reference.path);
            return {
              id: reference.id,
              exists: stored !== undefined,
              ...(stored === undefined ? {} : { version: stored.version }),
              data: () => stored?.data,
            };
          },
          create: (
            reference: Readonly<{ id: string; path: string }>,
            data: Readonly<Record<string, unknown>>,
          ) => {
            if (records.has(reference.path) || staged.has(reference.path)) {
              throw new Error("already exists");
            }
            creates.add(reference.path);
            staged.set(reference.path, data);
            return transaction;
          },
          set: (
            reference: Readonly<{ id: string; path: string }>,
            data: Readonly<Record<string, unknown>>,
          ) => {
            staged.set(reference.path, data);
            return transaction;
          },
        };
        const result = await callback(transaction);
        for (const [path, data] of staged) {
          if (creates.has(path) && records.has(path)) throw new Error("already exists");
          const previous = records.get(path);
          records.set(path, {
            version: previous === undefined ? "created" : `${previous.version}-updated`,
            data,
          });
          writes.push(path);
        }
        return result;
      },
    },
  };
  return { store, records, writes, reads };
}

function seededRecords(): Record<string, Stored> {
  return {
    // Plan and apply read the directory state they are bound to (2026-10-20).
    [statePath]: { version: "state-v794", data: directoryState() },
    "academies/academy-1/studentAdminProfiles/canonical": {
      version: "canonical-v1",
      data: { studentId: "canonical", membershipNumber: "33", immutable: "profile-history" },
    },
    "academies/academy-1/members/legacy-a": {
      version: "legacy-v1",
      data: { memberId: "legacy-a", membershipNumber: "#33", immutable: "legacy-history" },
    },
    "academies/academy-1/attendance/attendance-1": {
      version: "attendance-v1",
      data: { studentId: "legacy-a", status: "present" },
    },
    "academies/academy-1/payments/payment-1": {
      version: "payment-v1",
      data: { studentId: "legacy-a", amountMinor: 5000 },
    },
    "academies/academy-1/auditEvents/existing-audit": {
      version: "audit-v1",
      data: { targetRef: "academies/academy-1/members/legacy-a", action: "member.created" },
    },
    "academies/academy-1/studentIdentityKeys/legacy-alias-key": {
      version: "alias-v1",
      data: { ownerStudentId: "legacy-a", kind: "membership-number", historicalAlias: true },
    },
  };
}

async function buildPlan(harness: ReturnType<typeof fakeStore>) {
  return planMembershipNumberReconciliation(harness.store, {
    academyId: "academy-1",
    generatedAt: now,
  });
}

function confirmationFor(plan: Awaited<ReturnType<typeof buildPlan>>) {
  const identity = {
    academyId: plan.academyId,
    operationId: "reconcile-2026-09-21",
    contentHash: plan.contentHash,
  } as const;
  return {
    ...identity,
    confirmation: expectedMembershipNumberReconciliationConfirmation(identity),
    actorId: "system-reconciliation",
    appliedAt: now,
  } as const;
}

describe("membership number Firestore reconciliation", () => {
  it("plans without writing", async () => {
    const harness = fakeStore(seededRecords());
    const plan = await buildPlan(harness);

    expect(plan.rows).toHaveLength(2);
    expect(harness.writes).toEqual([]);
  });

  it("requires the exact academy, operation, hash and confirmation before a write", async () => {
    const harness = fakeStore(seededRecords());
    const plan = await buildPlan(harness);
    const valid = confirmationFor(plan);

    for (const invalid of [
      { ...valid, academyId: "academy-2" },
      { ...valid, operationId: "other-operation" },
      { ...valid, contentHash: "a".repeat(64) },
      { ...valid, confirmation: "wrong" },
    ]) {
      await expect(
        applyMembershipNumberReconciliation(harness.store, plan, invalid),
      ).rejects.toThrow(/academy|operation|hash|confirmation/i);
    }
    expect(harness.writes).toEqual([]);
  });

  it("keeps the canonical owner, reassigns collisions, preserves aliases and unrelated records", async () => {
    const harness = fakeStore(seededRecords());
    const protectedBefore = new Map(
      [...harness.records.entries()].filter(
        ([path]) => /\/(?:attendance|payments)\//u.test(path) || path.endsWith("/existing-audit"),
      ),
    );
    const aliasBefore = harness.records.get(
      "academies/academy-1/studentIdentityKeys/legacy-alias-key",
    );
    const plan = await buildPlan(harness);

    const result = await applyMembershipNumberReconciliation(
      harness.store,
      plan,
      confirmationFor(plan),
    );

    expect(result.rows).toEqual([
      { recordRef: "studentAdminProfiles/canonical", status: "applied" },
      { recordRef: "members/legacy-a", status: "applied" },
    ]);
    expect(harness.records.get("academies/academy-1/studentAdminProfiles/canonical")?.data).toEqual(
      { studentId: "canonical", membershipNumber: "33", immutable: "profile-history" },
    );
    expect(harness.records.get("academies/academy-1/members/legacy-a")?.data).toEqual({
      memberId: "legacy-a",
      membershipNumber: "34",
      immutable: "legacy-history",
    });
    expect(
      [...harness.records.values()].filter(
        ({ data }) => data.kind === "membership-number" && data.ownerStudentId === "legacy-a",
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(harness.records.get("academies/academy-1/studentIdentityKeys/legacy-alias-key")).toEqual(
      aliasBefore,
    );
    for (const [path, value] of protectedBefore) expect(harness.records.get(path)).toEqual(value);
  });

  it("skips stale and manual-review rows without domain writes", async () => {
    const seeded = seededRecords();
    const manualPath = "academies/academy-1/members/manual";
    seeded[manualPath] = {
      version: "manual-v1",
      data: { memberId: "manual", membershipNumber: "invalid-value" },
    };
    const harness = fakeStore(seeded);
    const plan = await buildPlan(harness);
    const stalePath = "academies/academy-1/members/legacy-a";
    const stale = harness.records.get(stalePath);
    if (stale === undefined) throw new Error("Missing stale fixture");
    harness.records.set(stalePath, { ...stale, version: "legacy-v2" });

    const result = await applyMembershipNumberReconciliation(
      harness.store,
      plan,
      confirmationFor(plan),
    );

    expect(result.rows).toEqual(
      expect.arrayContaining([
        { recordRef: "members/legacy-a", status: "stale" },
        { recordRef: "members/manual", status: "manual_review" },
      ]),
    );
    expect(harness.records.get(stalePath)?.data.membershipNumber).toBe("#33");
    expect(harness.writes).not.toContain(stalePath);
    expect(harness.writes).not.toContain(manualPath);
  });

  it("isolates a foreign reservation as manual review without rolling back its chunk", async () => {
    const harness = fakeStore(seededRecords());
    const plan = await buildPlan(harness);
    const row = plan.rows.find(({ recordRef }) => recordRef === "members/legacy-a");
    if (row?.proposed === undefined) throw new Error("Missing collision proposal");
    const reservation = buildStudentIdentityKey({
      academyId: plan.academyId,
      kind: "membership-number",
      value: row.proposed,
      ownerStudentId: "different-owner",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      actorId: "fixture",
      now,
    });
    harness.records.set(`academies/academy-1/studentIdentityKeys/${reservation.keyId}`, {
      version: "reservation-v1",
      data: reservation,
    });

    const result = await applyMembershipNumberReconciliation(
      harness.store,
      plan,
      confirmationFor(plan),
    );

    expect(result.rows).toEqual([
      { recordRef: "studentAdminProfiles/canonical", status: "applied" },
      { recordRef: "members/legacy-a", status: "manual_review" },
    ]);
    expect(
      harness.records.get("academies/academy-1/studentAdminProfiles/canonical")?.data
        .membershipNumber,
    ).toBe("33");
    expect(harness.records.get("academies/academy-1/members/legacy-a")?.data.membershipNumber).toBe(
      "#33",
    );
  });

  it("preserves stale and manual-review outcomes on an exact replay", async () => {
    const seeded = seededRecords();
    seeded["academies/academy-1/members/manual"] = {
      version: "manual-v1",
      data: { memberId: "manual", membershipNumber: "invalid-value" },
    };
    const harness = fakeStore(seeded);
    const plan = await buildPlan(harness);
    const stalePath = "academies/academy-1/members/legacy-a";
    const stale = harness.records.get(stalePath);
    if (stale === undefined) throw new Error("Missing stale fixture");
    harness.records.set(stalePath, { ...stale, version: "legacy-v2" });
    const confirmation = confirmationFor(plan);
    await applyMembershipNumberReconciliation(harness.store, plan, confirmation);

    const replay = await applyMembershipNumberReconciliation(harness.store, plan, confirmation);

    expect(replay.rows).toEqual(
      expect.arrayContaining([
        { recordRef: "studentAdminProfiles/canonical", status: "already_applied" },
        { recordRef: "members/legacy-a", status: "stale" },
        { recordRef: "members/manual", status: "manual_review" },
      ]),
    );
  });

  it("rejects a tampered plan even when its declared hash is unchanged", async () => {
    const harness = fakeStore(seededRecords());
    const plan = await buildPlan(harness);
    const tampered = {
      ...plan,
      rows: plan.rows.map((row) =>
        row.recordRef === "members/legacy-a" ? { ...row, proposed: "35" } : row,
      ),
    };

    await expect(
      applyMembershipNumberReconciliation(harness.store, tampered, confirmationFor(plan)),
    ).rejects.toThrow(/hash/i);
    expect(harness.writes).toEqual([]);
  });

  it("returns already_applied on an exact retry without new writes", async () => {
    const harness = fakeStore(seededRecords());
    const plan = await buildPlan(harness);
    const confirmation = confirmationFor(plan);
    await applyMembershipNumberReconciliation(harness.store, plan, confirmation);
    const writesAfterFirst = harness.writes.length;

    const replay = await applyMembershipNumberReconciliation(harness.store, plan, confirmation);

    expect(replay.rows.every((row) => row.status === "already_applied")).toBe(true);
    expect(harness.writes).toHaveLength(writesAfterFirst);
  });

  it("rejects a receipt whose stored rows do not match the frozen chunk", async () => {
    const harness = fakeStore(seededRecords());
    const plan = await buildPlan(harness);
    const confirmation = confirmationFor(plan);
    await applyMembershipNumberReconciliation(harness.store, plan, confirmation);
    const receiptPath =
      "academies/academy-1/membershipNumberReconciliationReceipts/reconcile-2026-09-21:0";
    const receipt = harness.records.get(receiptPath);
    if (receipt === undefined) throw new Error("Missing receipt fixture");
    harness.records.set(receiptPath, {
      ...receipt,
      data: {
        ...receipt.data,
        rows: [{ recordRef: "members/other", status: "applied" }],
      },
    });

    await expect(
      applyMembershipNumberReconciliation(harness.store, plan, confirmation),
    ).rejects.toThrow(/receipt conflict/i);
  });
});

describe("membership numbers bound to the member directory (2026-10-20 capacity prep, part 4)", () => {
  const setState = (harness: ReturnType<typeof fakeStore>, overrides: Record<string, unknown>) =>
    harness.records.set(statePath, { version: "state-later", data: directoryState(overrides) });
  const apply = (
    harness: ReturnType<typeof fakeStore>,
    plan: Awaited<ReturnType<typeof buildPlan>>,
  ) => applyMembershipNumberReconciliation(harness.store, plan, confirmationFor(plan));

  it("binds a plan to the state's revision and mode, inside its hash", async () => {
    const harness = fakeStore(seededRecords());
    const plan = await buildPlan(harness);
    const rebound = { ...plan, directory: { stateRevision: 795, legacyReadsEliminated: true } };

    expect(plan.directory).toEqual({ stateRevision: 794, legacyReadsEliminated: false });
    await expect(
      applyMembershipNumberReconciliation(harness.store, rebound, confirmationFor(plan)),
    ).rejects.toThrow(/hash/i);
    expect(harness.writes).toEqual([]);
  });

  it("plans and applies canonical profiles only once legacy reads are eliminated", async () => {
    const harness = fakeStore(seededRecords());
    setState(harness, eliminated);
    const legacyBefore = harness.records.get("academies/academy-1/members/legacy-a");

    const plan = await buildPlan(harness);
    const result = await apply(harness, plan);

    expect(plan.directory).toEqual({ stateRevision: 795, legacyReadsEliminated: true });
    expect(plan.rows.map((row) => row.recordRef)).toEqual(["studentAdminProfiles/canonical"]);
    expect(result.rows).toEqual([
      { recordRef: "studentAdminProfiles/canonical", status: "applied" },
    ]);
    expect(harness.records.get("academies/academy-1/members/legacy-a")).toEqual(legacyBefore);
    expect(harness.writes.filter((path) => path.includes("/members/"))).toEqual([]);
  });

  it("refuses a plan built before the marker, before any row is read or written", async () => {
    const harness = fakeStore(seededRecords());
    const plan = await buildPlan(harness);
    setState(harness, eliminated);
    const before = new Map(harness.records);

    await expect(apply(harness, plan)).rejects.toThrow(/stale/i);
    expect(harness.writes).toEqual([]);
    expect(harness.records).toEqual(before);
  });

  it("applies a plan written before the binding only while legacy reads are allowed", async () => {
    const unboundPlan = async (harness: ReturnType<typeof fakeStore>) =>
      buildMembershipNumberReconciliationPlan({
        academyId: "academy-1",
        generatedAt: now,
        rows: await harness.store.listSourceRows({ academyId: "academy-1" }),
      });
    const open = fakeStore(seededRecords());
    const closed = fakeStore(seededRecords());
    setState(closed, eliminated);

    const legacy = await unboundPlan(closed);
    expect(legacy).not.toHaveProperty("directory");
    await expect(apply(closed, legacy)).rejects.toThrow(/stale/i);
    expect(closed.writes).toEqual([]);
    await expect(apply(open, await unboundPlan(open))).resolves.toMatchObject({
      rows: expect.arrayContaining([{ recordRef: "members/legacy-a", status: "applied" }]),
    });
  });

  it("stops a plan whose directory went backwards since it was built", async () => {
    const harness = fakeStore(seededRecords());
    const plan = await buildPlan(harness);
    // A restore took the directory back a revision: the plan no longer describes it.
    setState(harness, { stateRevision: 793 });

    await expect(apply(harness, plan)).rejects.toThrow(/does not match/i);
    expect(harness.writes).toEqual([]);
  });

  it("answers an exact replay from its receipts after the marker (a lost response)", async () => {
    const harness = fakeStore(seededRecords());
    const plan = await buildPlan(harness);
    await apply(harness, plan);
    setState(harness, eliminated);
    const writes = harness.writes.length;

    const replay = await apply(harness, plan);

    expect(replay.rows.every((row) => row.status === "already_applied")).toBe(true);
    expect(harness.writes).toHaveLength(writes);
  });

  it("fails closed when the directory state does not read", async () => {
    const harness = fakeStore(seededRecords());
    const plan = await buildPlan(harness);
    harness.records.delete(statePath);

    await expect(buildPlan(harness)).rejects.toThrow(/readable directory state/i);
    await expect(apply(harness, plan)).rejects.toThrow(/readable directory state/i);
    expect(harness.writes).toEqual([]);
  });

  it("queries the legacy directory through Firestore only while legacy reads are allowed", async () => {
    const queried: string[] = [];
    const query = (path: string): Record<string, unknown> => ({
      orderBy: () => query(path),
      limit: () => query(path),
      startAfter: () => query(path),
      get: async () => {
        queried.push(path);
        return { docs: [], size: 0 };
      },
    });
    const store = createMembershipNumberReconciliationFirestoreStore({
      firestore: { collection: query } as never,
      identitySecretMaterial: identitySecret,
    });

    await store.listSourceRows({ academyId: "academy-1", legacyReadsEliminated: true });
    expect(queried).toEqual(["academies/academy-1/studentAdminProfiles"]);
    queried.length = 0;
    await store.listSourceRows({ academyId: "academy-1" });
    expect([...queried].sort()).toEqual([
      "academies/academy-1/members",
      "academies/academy-1/studentAdminProfiles",
    ]);
  });

  // An independent copy of the content hash: a checksum anyone can recompute, not a MAC.
  function hashOf(value: unknown): string {
    const canonical = (item: unknown): string => {
      if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
      if (item === null || typeof item !== "object") return JSON.stringify(item);
      const fields = Object.keys(item)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(Reflect.get(item, key))}`);
      return `{${fields.join(",")}}`;
    };
    return createHash("sha256").update(canonical(value)).digest("hex");
  }

  it("refuses a row whose kind contradicts its collection before any read, whatever its hash", async () => {
    const forge = (plan: MembershipNumberPlan, rows: MembershipNumberPlan["rows"]) => {
      const { contentHash, ...payload } = plan;
      expect(hashOf(payload)).toBe(contentHash);
      const forged = { ...payload, rows };
      return { ...forged, contentHash: hashOf(forged) };
    };
    const closed = fakeStore(seededRecords());
    setState(closed, eliminated);
    const afterMarker = await buildPlan(closed);
    const open = fakeStore(seededRecords());
    const beforeMarker = await buildPlan(open);
    const cases: [ReturnType<typeof fakeStore>, MembershipNumberPlan][] = [
      // A members record labelled canonical would pass the legacy gate after the marker.
      [
        closed,
        forge(afterMarker, [
          ...afterMarker.rows,
          {
            ...afterMarker.rows[0]!,
            recordRef: "members/legacy-a",
            ownerId: "legacy-a",
            sourceVersion: "legacy-v1",
          },
        ]),
      ],
      // A profile labelled legacy would be read with the member record's owner field.
      [
        open,
        forge(
          beforeMarker,
          beforeMarker.rows.map((row) =>
            row.recordRef.startsWith("studentAdminProfiles/")
              ? { ...row, sourceKind: "legacy" as const }
              : row,
          ),
        ),
      ],
    ];

    for (const [harness, forged] of cases) {
      harness.reads.length = 0;
      await expect(
        applyMembershipNumberReconciliation(harness.store, forged, confirmationFor(forged)),
      ).rejects.toThrow(/contradicts the record's collection/u);
      expect(harness.reads).toEqual([]);
      expect(harness.writes).toEqual([]);
    }
  });

  function profiles(count: number): Record<string, Stored> {
    const seeded: Record<string, Stored> = {
      [statePath]: { version: "state-v794", data: directoryState() },
    };
    for (let index = 1; index <= count; index += 1) {
      seeded[`academies/academy-1/studentAdminProfiles/s${index}`] = {
        version: `profile-v${index}`,
        data: { studentId: `s${index}`, membershipNumber: String(index) },
      };
    }
    return seeded;
  }
  // The same store, running `before` ahead of its nth transaction, which then runs or is lost.
  function aroundTransaction(
    harness: ReturnType<typeof fakeStore>,
    nth: number,
    before: () => void,
    lost = false,
  ): MembershipNumberReconciliationStore {
    let count = 0;
    return {
      ...harness.store,
      firestore: {
        ...harness.store.firestore,
        runTransaction: async (callback) => {
          count += 1;
          if (count === nth) {
            before();
            if (lost) throw new Error("synthetic lost connection");
          }
          return harness.store.firestore.runTransaction(callback);
        },
      },
    };
  }
  const receiptPath = (chunk: number) =>
    `academies/academy-1/membershipNumberReconciliationReceipts/reconcile-2026-09-21:${chunk}`;

  it("stops before the next chunk when the marker lands between chunks", async () => {
    const harness = fakeStore(profiles(101));
    const plan = await buildPlan(harness);
    const store = aroundTransaction(harness, 2, () => setState(harness, eliminated));

    await expect(
      applyMembershipNumberReconciliation(store, plan, confirmationFor(plan)),
    ).rejects.toThrow(/stale/i);
    expect(harness.records.has(receiptPath(0))).toBe(true);
    expect(harness.records.has(receiptPath(1))).toBe(false);
    expect(harness.records.get("academies/academy-1/studentAdminProfiles/s101")?.version).toBe(
      "profile-v101",
    );
  });

  it("replays a committed first chunk after the marker and refuses the chunk that never ran", async () => {
    const harness = fakeStore(profiles(101));
    const plan = await buildPlan(harness);
    const lost = aroundTransaction(harness, 2, () => undefined, true);
    await expect(
      applyMembershipNumberReconciliation(lost, plan, confirmationFor(plan)),
    ).rejects.toThrow("synthetic lost connection");
    setState(harness, eliminated);
    const writes = harness.writes.length;
    harness.reads.length = 0;

    await expect(apply(harness, plan)).rejects.toThrow(/stale/i);
    // Chunk 0 answers from its receipt without reading a row; chunk 1 stops at the state.
    expect(harness.reads).toEqual([receiptPath(0), receiptPath(1), statePath]);
    expect(harness.writes).toHaveLength(writes);
  });
});
