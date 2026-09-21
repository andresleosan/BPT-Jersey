import { describe, expect, it } from "vitest";

import { buildStudentIdentityKey } from "./member-directory-crypto.js";

import {
  applyMembershipNumberReconciliation,
  expectedMembershipNumberReconciliationConfirmation,
  planMembershipNumberReconciliation,
  type MembershipNumberReconciliationStore,
} from "./membership-number-reconciliation-firestore.js";

const now = "2026-09-21T05:00:00.000Z";
const identitySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

type Stored = Readonly<{ version: string; data: Readonly<Record<string, unknown>> }>;

function fakeStore(initial: Record<string, Stored>) {
  const records = new Map(Object.entries(initial));
  const writes: string[] = [];
  const listRows = async ({ academyId }: Readonly<{ academyId: string }>) =>
    [...records.entries()].flatMap(([path, stored]) => {
      const prefix = `academies/${academyId}/`;
      if (!path.startsWith(prefix)) return [];
      const recordRef = path.slice(prefix.length);
      if (!/^(?:studentAdminProfiles|members)\//u.test(recordRef)) return [];
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
  return { store, records, writes };
}

function seededRecords(): Record<string, Stored> {
  return {
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
