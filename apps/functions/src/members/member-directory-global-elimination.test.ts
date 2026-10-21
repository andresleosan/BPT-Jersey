import { describe, expect, it, vi } from "vitest";

import { parseAuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  memberDirectoryStateSchema,
  type MemberDirectoryState,
} from "@bpt-jersey/domain/members/directory";
import { planMemberDirectoryGlobalLegacyElimination } from "@bpt-jersey/domain/members/directory-transitions";

import {
  applyGlobalLegacyElimination,
  buildLegacyReadsEliminatedAuditDraft,
  expectedGlobalLegacyEliminationConfirmation,
  isNestedLegacyHistoryPath,
  planGlobalLegacyEliminationDryRun,
  type GlobalLegacyEliminationStore,
  type NestedLegacyHistoryCounts,
} from "./member-directory-global-elimination.js";
import {
  advanceMemberDirectoryControlPlane,
  assertMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
} from "./member-directory-state.js";

vi.mock("@bpt-jersey/domain/members/directory-transitions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@bpt-jersey/domain/members/directory-transitions")>();
  return {
    ...actual,
    planMemberDirectoryGlobalLegacyElimination: vi.fn(
      actual.planMemberDirectoryGlobalLegacyElimination,
    ),
  };
});

const projectId = "demo-bpt-jersey";
const academyId = "academy-1";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const otherSecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const statePath = `academies/${academyId}/memberDirectoryStates/current`;
const guardPath = `memberDirectoryRestoreGuards/${academyId}`;
const eventPath = (eventId: string) => `${guardPath}/events/${eventId}`;
const now = "2026-10-21T22:00:00.000Z";
const zeroNested: NestedLegacyHistoryCounts = { evaluations: 0, graduations: 0, medicalLeaves: 0 };

function baseState(overrides: Record<string, unknown> = {}): MemberDirectoryState {
  return memberDirectoryStateSchema.parse({
    stateId: "current",
    academyId,
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "identity-v1",
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: "baseline-1",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 400,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: "system-1",
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: "system-1",
    ...overrides,
  });
}

/** A valid two-event chain ending at revision 1, the shape a live directory has after any write. */
function controlPlaneDocuments(
  overrides: Record<string, unknown> = {},
  documentAcademyId: string = academyId,
) {
  const initialState = baseState({ academyId: documentAcademyId });
  const initial = buildInitialMemberDirectoryControlPlane({
    projectId,
    state: initialState,
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    now: "2026-09-03T20:00:00.000Z",
    actorId: "system-1",
  });
  const at = "2026-10-20T10:00:00.000Z";
  const state = baseState({
    ...overrides,
    academyId: documentAcademyId,
    stateRevision: 1,
    updatedAt: at,
    updatedBy: "owner-1",
  });
  const next = advanceMemberDirectoryControlPlane({
    projectId,
    state: initialState,
    guard: initial.guard,
    event: initial.event,
    nextState: state,
    operationId: "profile-update-1",
    transitionKind: "canonical-identity-update",
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    now: at,
    actorId: "owner-1",
  });
  return {
    [statePath]: state,
    [guardPath]: next.guard,
    [eventPath(next.event.eventId)]: next.event,
  } as Record<string, Readonly<Record<string, unknown>>>;
}

/**
 * Strict like real Firestore: a read after the first write throws, and `create` fails when the
 * document exists. Writes stage and land only when the callback returns.
 */
function fakeStore(
  initial: Record<string, Readonly<Record<string, unknown>>>,
  nested: NestedLegacyHistoryCounts = zeroNested,
) {
  const records = new Map(Object.entries(initial));
  const writes: string[] = [];
  const store: GlobalLegacyEliminationStore = {
    countNestedLegacyHistory: async () => nested,
    runTransaction: async (callback) => {
      const staged = new Map<string, Readonly<Record<string, unknown>>>();
      const assertNoWrite = () => {
        if (staged.size > 0) {
          throw new Error(
            "Firestore transactions require all reads to be executed before all writes.",
          );
        }
      };
      const result = await callback({
        get: async (path) => {
          assertNoWrite();
          const data = records.get(path);
          return { exists: data !== undefined, data: () => data };
        },
        countLegacyMembers: async (id) => {
          assertNoWrite();
          const prefix = `academies/${id}/members/`;
          return [...records.keys()].some((path) => path.startsWith(prefix)) ? 1 : 0;
        },
        set: (path, data) => {
          staged.set(path, data);
        },
        create: (path, data) => {
          if (records.has(path) || staged.has(path)) throw new Error("already exists");
          staged.set(path, data);
        },
      });
      for (const [path, data] of staged) {
        records.set(path, data);
        writes.push(path);
      }
      return result;
    },
  };
  return { store, records, writes };
}

const binding = { projectId, academyId, integritySecretMaterial: integritySecret } as const;

/** What the documents as stored would confirm to, so only the control-plane check can refuse. */
function boundConfirmation(
  documents: Record<string, Readonly<Record<string, unknown>>>,
  boundProjectId = projectId,
): string {
  const guard = documents[guardPath] ?? {};
  return expectedGlobalLegacyEliminationConfirmation({
    projectId: boundProjectId,
    academyId,
    stateRevision: Number(documents[statePath]?.stateRevision),
    lastEventId: String(guard.lastEventId),
    lastEventMac: String(guard.lastEventMac),
    legacyMemberDocuments: 0,
    nestedLegacyHistory: zeroNested,
  });
}

async function confirmationFor(store: GlobalLegacyEliminationStore): Promise<string> {
  const view = await planGlobalLegacyEliminationDryRun(store, binding);
  if (view.status !== "ready" && view.status !== "blocked") throw new Error("unexpected");
  return view.expectedConfirmation;
}

describe("T097 global legacy-read elimination (ADR-009, Enmienda 2026-10-21)", () => {
  it("dry run reports the bound plan and the next state without writing", async () => {
    const { store, writes } = fakeStore(controlPlaneDocuments());

    const view = await planGlobalLegacyEliminationDryRun(store, binding);

    expect(view).toMatchObject({
      status: "ready",
      academyId,
      projectId,
      stateRevision: 1,
      lastEventId: "1",
      lastEventTransitionKind: "canonical-identity-update",
      globalLegacyReadEliminated: false,
      rollbackProtocolVersion: "legacy-projection-v1",
      rollbackEligibleStudentCount: 400,
      rollbackCapacityLimit: 400,
      legacyMemberDocuments: 0,
      nestedLegacyHistory: zeroNested,
      unmetPreconditions: [],
      nextState: {
        stateRevision: 2,
        globalLegacyReadEliminated: true,
        rollbackProtocolVersion: "disabled",
        rollbackEligibleStudentCount: 400,
        rollbackCapacityLimit: 400,
      },
    });
    if (view.status !== "ready") throw new Error("unexpected");
    expect(view.expectedConfirmation).toMatch(
      /^ELIMINATE LEGACY MEMBER READS academy-1 r1 e1 [a-f0-9]{16}$/u,
    );
    expect(writes).toEqual([]);
  });

  it("dry run reports blocked with the unmet precondition when a legacy members document exists", async () => {
    const { store, writes } = fakeStore({
      ...controlPlaneDocuments(),
      [`academies/${academyId}/members/legacy-1`]: { a: 1 },
    });

    const view = await planGlobalLegacyEliminationDryRun(store, binding);

    expect(view).toMatchObject({
      status: "blocked",
      legacyMemberDocuments: 1,
      nestedLegacyHistory: zeroNested,
      unmetPreconditions: ["legacy-members-empty"],
      refusal: expect.stringMatching(/legacy-members-empty/u),
    });
    expect(writes).toEqual([]);
  });

  it("dry run reports blocked with the unmet precondition when nested legacy history remains", async () => {
    const nested = { ...zeroNested, graduations: 1 };
    const { store, writes } = fakeStore(controlPlaneDocuments(), nested);

    const view = await planGlobalLegacyEliminationDryRun(store, binding);

    expect(view).toMatchObject({
      status: "blocked",
      legacyMemberDocuments: 0,
      nestedLegacyHistory: nested,
      unmetPreconditions: ["nested-legacy-history-adapted"],
      refusal: expect.stringMatching(/nested-legacy-history-adapted/u),
    });
    expect(writes).toEqual([]);
  });

  it("binds the confirmation to every measured fact", () => {
    const base = {
      projectId,
      academyId,
      stateRevision: 1,
      lastEventId: "1",
      lastEventMac: "b".repeat(64),
      legacyMemberDocuments: 0,
      nestedLegacyHistory: zeroNested,
    };
    const reference = expectedGlobalLegacyEliminationConfirmation(base);
    for (const change of [
      { projectId: "demo-other" },
      { lastEventMac: "c".repeat(64) },
      { legacyMemberDocuments: 1 },
      { nestedLegacyHistory: { ...zeroNested, medicalLeaves: 1 } },
    ]) {
      expect(expectedGlobalLegacyEliminationConfirmation({ ...base, ...change })).not.toBe(
        reference,
      );
    }
    expect(expectedGlobalLegacyEliminationConfirmation({ ...base })).toBe(reference);
  });

  it("eliminates legacy reads at the bound: marker, disabled protocol, guard chain and audit", async () => {
    const { store, records, writes } = fakeStore(controlPlaneDocuments());
    const confirmation = await confirmationFor(store);

    const result = await applyGlobalLegacyElimination(store, {
      ...binding,
      confirmation,
      actorId: "operator-1",
      now,
    });

    expect(result).toEqual({
      status: "eliminated",
      academyId,
      stateRevision: 2,
      eventId: "2",
    });
    const auditPath = `academies/${academyId}/auditEvents/t097-global-legacy-elimination-2`;
    expect(writes.sort()).toEqual([statePath, guardPath, eventPath("2"), auditPath].sort());
    const control = assertMemberDirectoryControlPlane({
      projectId,
      state: records.get(statePath),
      guard: records.get(guardPath),
      event: records.get(eventPath("2")),
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
    });
    expect(control.state).toMatchObject({
      globalLegacyReadEliminated: true,
      rollbackProtocolVersion: "disabled",
      stateRevision: 2,
      rollbackEligibleStudentCount: 400,
      rollbackCapacityLimit: 400,
      updatedAt: now,
      updatedBy: "operator-1",
    });
    expect(control.guard).toMatchObject({
      highestStateRevision: 2,
      globalLegacyReadEverEliminated: true,
      lastEventId: "2",
    });
    expect(control.event).toMatchObject({
      transitionKind: "global-legacy-eliminate",
      operationId: "t097-global-legacy-elimination",
      previousStateRevision: 1,
      currentStateRevision: 2,
    });
    expect(records.get(auditPath)).toMatchObject({
      action: "member.directory.legacy-reads-eliminated",
      targetRef: statePath,
      correlationId: "t097-global-legacy-elimination-2",
      auditEventId: "t097-global-legacy-elimination-2",
    });
  });

  it("builds an audit draft the real catalogue accepts, with ids only", () => {
    const draft = buildLegacyReadsEliminatedAuditDraft({
      academyId,
      actorId: "operator-1",
      stateRevision: 795,
    });
    const parsed = parseAuditEventDraft(draft);
    expect(parsed.ok).toBe(true);
    expect(draft).toEqual({
      academyId,
      actorId: "operator-1",
      action: "member.directory.legacy-reads-eliminated",
      targetRef: statePath,
      purpose: "global legacy-read elimination (T097)",
      correlationId: "t097-global-legacy-elimination-795",
    });
  });

  it("answers already-eliminated with no write and no planning once the marker is set", async () => {
    const { store, writes } = fakeStore(controlPlaneDocuments());
    const confirmation = await confirmationFor(store);
    await applyGlobalLegacyElimination(store, {
      ...binding,
      confirmation,
      actorId: "operator-1",
      now,
    });
    writes.length = 0;
    const planner = vi.mocked(planMemberDirectoryGlobalLegacyElimination);
    planner.mockClear();

    const again = await applyGlobalLegacyElimination(store, {
      ...binding,
      confirmation,
      actorId: "operator-1",
      now: "2026-10-21T22:05:00.000Z",
    });

    expect(again).toEqual({ status: "already-eliminated", academyId, stateRevision: 2 });
    expect(writes).toEqual([]);
    expect(planner).not.toHaveBeenCalled();
    await expect(planGlobalLegacyEliminationDryRun(store, binding)).resolves.toMatchObject({
      status: "already-eliminated",
      stateRevision: 2,
      lastEventId: "2",
      lastEventTransitionKind: "global-legacy-eliminate",
      globalLegacyReadEliminated: true,
      rollbackProtocolVersion: "disabled",
      rollbackEligibleStudentCount: 400,
    });
  });

  describe("refuses and writes nothing", () => {
    async function expectRefused(
      documents: Record<string, Readonly<Record<string, unknown>>>,
      options: Readonly<{
        nested?: NestedLegacyHistoryCounts;
        confirmation?: (store: GlobalLegacyEliminationStore) => Promise<string>;
        secret?: string;
        projectId?: string;
        before?: (records: Map<string, Readonly<Record<string, unknown>>>) => void;
      }>,
      message: RegExp,
    ) {
      const { store, records, writes } = fakeStore(documents, options.nested);
      const confirmation = options.confirmation
        ? await options.confirmation(store)
        : "ELIMINATE LEGACY MEMBER READS academy-1 r1 e1 0000000000000000";
      options.before?.(records);
      await expect(
        applyGlobalLegacyElimination(store, {
          projectId: options.projectId ?? projectId,
          academyId,
          integritySecretMaterial: options.secret ?? integritySecret,
          confirmation,
          actorId: "operator-1",
          now,
        }),
      ).rejects.toThrow(message);
      expect(writes).toEqual([]);
    }

    it("a confirmation that is not the dry run's", async () => {
      await expectRefused(controlPlaneDocuments(), {}, /rerun the dry run/u);
    });

    it("a state that changed after the dry run", async () => {
      const later = controlPlaneDocuments();
      await expectRefused(
        controlPlaneDocuments(),
        {
          confirmation: confirmationFor,
          before: (records) => {
            // A profile edit moved the directory to a new revision with a new guard event.
            const initial = buildInitialMemberDirectoryControlPlane({
              projectId,
              state: baseState(),
              integritySecretMaterial: integritySecret,
              integritySecretVersion: "integrity-v1",
              now: "2026-09-03T20:00:00.000Z",
              actorId: "system-1",
            });
            const moved = baseState({
              stateRevision: 1,
              updatedAt: "2026-10-21T21:00:00.000Z",
              updatedBy: "owner-2",
            });
            const next = advanceMemberDirectoryControlPlane({
              projectId,
              state: baseState(),
              guard: initial.guard,
              event: initial.event,
              nextState: moved,
              operationId: "profile-update-2",
              transitionKind: "canonical-identity-update",
              integritySecretMaterial: integritySecret,
              integritySecretVersion: "integrity-v1",
              now: "2026-10-21T21:00:00.000Z",
              actorId: "owner-2",
            });
            expect(next.event.eventMac).not.toBe(later[guardPath]?.lastEventMac);
            records.set(statePath, moved);
            records.set(guardPath, next.guard);
            records.set(eventPath("1"), next.event);
          },
        },
        /rerun the dry run/u,
      );
    });

    it("a legacy members document", async () => {
      await expectRefused(
        { ...controlPlaneDocuments(), [`academies/${academyId}/members/legacy-1`]: { a: 1 } },
        { confirmation: confirmationFor },
        /not proven: legacy-members-empty$/u,
      );
    });

    it("nested legacy history above zero", async () => {
      await expectRefused(
        controlPlaneDocuments(),
        { confirmation: confirmationFor, nested: { ...zeroNested, graduations: 1 } },
        /not proven: nested-legacy-history-adapted$/u,
      );
    });

    it("a tampered guard event MAC", async () => {
      const documents = controlPlaneDocuments();
      const event = documents[eventPath("1")] ?? {};
      const guard = documents[guardPath] ?? {};
      const tampered = {
        ...documents,
        [eventPath("1")]: { ...event, eventMac: "f".repeat(64) },
        [guardPath]: { ...guard, lastEventMac: "f".repeat(64) },
      };
      await expectRefused(
        tampered,
        { confirmation: async () => boundConfirmation(tampered) },
        /control plane could not be verified/u,
      );
    });

    it("a guard that does not match the state", async () => {
      const documents = controlPlaneDocuments();
      const mismatched = {
        ...documents,
        [guardPath]: { ...(documents[guardPath] ?? {}), highestRollbackEligibleStudentCount: 399 },
      };
      await expectRefused(
        mismatched,
        { confirmation: async () => boundConfirmation(mismatched) },
        /control plane could not be verified/u,
      );
    });

    it("a control plane copied from another academy", async () => {
      // Valid state, guard and event for academy-2, stored under academy-1's paths.
      const copied = controlPlaneDocuments({}, "academy-2");
      await expectRefused(
        copied,
        { confirmation: async () => boundConfirmation(copied) },
        /control plane could not be verified/u,
      );
    });

    it("the wrong integrity secret", async () => {
      const documents = controlPlaneDocuments();
      await expectRefused(
        documents,
        { secret: otherSecret, confirmation: async () => boundConfirmation(documents) },
        /control plane could not be verified/u,
      );
    });

    it("the wrong project", async () => {
      const documents = controlPlaneDocuments();
      await expectRefused(
        documents,
        {
          projectId: "demo-other",
          confirmation: async () => boundConfirmation(documents, "demo-other"),
        },
        /control plane could not be verified/u,
      );
    });

    it("a tuple that is not canonical open idle", async () => {
      await expectRefused(
        controlPlaneDocuments({
          readerVersion: "legacy-rollback-v1",
          directoryWriteMode: "blocked",
          freezeStatus: "frozen",
          operationPhase: "rollback-readonly",
        }),
        { confirmation: confirmationFor },
        /canonical open idle tuple/u,
      );
    });

    it("incomplete identity-key coverage", async () => {
      await expectRefused(
        controlPlaneDocuments({
          identityKeyCoverage: "incomplete",
          identityKeyBaselineMac: undefined,
          identityKeyBaselineArtifactId: undefined,
        }),
        { confirmation: confirmationFor },
        /complete identity-key coverage/u,
      );
    });
  });

  it("counts nested history only under legacy students or members, not canonical leaves", () => {
    expect(
      isNestedLegacyHistoryPath(academyId, `academies/${academyId}/students/s1/evaluations/e1`),
    ).toBe(true);
    expect(
      isNestedLegacyHistoryPath(academyId, `academies/${academyId}/members/m1/medicalLeaves/l1`),
    ).toBe(true);
    expect(isNestedLegacyHistoryPath(academyId, `academies/${academyId}/medicalLeaves/l1`)).toBe(
      false,
    );
    expect(
      isNestedLegacyHistoryPath(academyId, `academies/academy-2/students/s1/graduations/g1`),
    ).toBe(false);
  });
});
