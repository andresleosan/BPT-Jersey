import { describe, expect, it } from "vitest";

import { memberDirectoryStateSchema } from "@bpt-jersey/domain/members/directory";

import { createFirestoreMemberMigrationStore } from "./member-migration-firestore.js";

const statePath = "academies/academy-1/memberDirectoryStates/current";

function state(overrides: Record<string, unknown> = {}) {
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

/** Records every document and query read (all inside one transaction); queries answer empty. */
function migrationFirestore(stored: unknown) {
  const reads: string[] = [];
  let transactions = 0;
  const transaction = {
    get: async (target: Readonly<{ kind: "doc" | "query"; path: string }>) => {
      reads.push(target.path);
      return target.kind === "doc" ? { data: () => stored } : { size: 0, docs: [] };
    },
  };
  const firestore = {
    doc: (path: string) => ({ kind: "doc", path }),
    collection: (path: string) => ({ limit: () => ({ kind: "query", path }) }),
    runTransaction: async (callback: (current: typeof transaction) => Promise<unknown>) => {
      transactions += 1;
      return callback(transaction);
    },
  };
  return {
    reads,
    transactions: () => transactions,
    store: createFirestoreMemberMigrationStore(firestore as never),
  };
}

describe("the member migration store and the global marker (2026-10-20 capacity prep, part 2)", () => {
  const sources = [
    "members",
    "regyfitMemberRecords",
    "memberMigrationDecisions",
    "regyfitOfficeLinks",
    "regyfitMemberLinks",
  ].map((name) => `academies/academy-1/${name}`);

  it("reads the queue's sources with the state, in one transaction, while legacy reads are allowed", async () => {
    const { reads, store, transactions } = migrationFirestore(state());

    await expect(store.load("academy-1")).resolves.toMatchObject({ members: [], records: [] });
    expect(reads).toEqual([statePath, ...sources]);
    expect(transactions()).toBe(1);
  });

  it("closes before any legacy read once the global marker is set", async () => {
    const { reads, store } = migrationFirestore(
      state({ globalLegacyReadEliminated: true, rollbackProtocolVersion: "disabled" }),
    );

    await expect(store.load("academy-1")).rejects.toMatchObject({
      code: "unavailable",
      reason: "legacy_reads_eliminated",
    });
    expect(reads).toEqual([statePath]);
  });

  it.each([
    ["missing", undefined],
    ["unreadable", { stateId: "current", globalLegacyReadEliminated: false }],
  ])("treats a %s state as unavailable, never as open", async (_label, stored) => {
    const { reads, store } = migrationFirestore(stored);

    await expect(store.load("academy-1")).rejects.toMatchObject({
      code: "unavailable",
      message: "Member directory state is unavailable",
    });
    expect(reads).toEqual([statePath]);
  });
});
