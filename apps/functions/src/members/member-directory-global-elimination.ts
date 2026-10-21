import { createHash } from "node:crypto";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { memberDirectoryStateSchema } from "@bpt-jersey/domain/members/directory";
import {
  listUnmetMemberDirectoryGlobalEliminationPreconditions,
  planMemberDirectoryGlobalLegacyElimination,
} from "@bpt-jersey/domain/members/directory-transitions";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { canonicalizeMemberDirectoryValue } from "./member-directory-crypto.js";
import {
  advanceMemberDirectoryControlPlane,
  assertMemberDirectoryControlPlane,
  memberDirectoryRestoreGuardSchema,
} from "./member-directory-state.js";

/**
 * T097: the one transition that sets `globalLegacyReadEliminated` (ADR-009, Enmienda 2026-10-21).
 * Run by the operator CLI only: dry run first, then `--apply` with the dry run's exact confirmation.
 * It writes four metadata documents (state, guard header, guard event, audit) and nothing else;
 * outputs and errors carry ids, revisions and counts only.
 */

export const nestedLegacyHistoryCollectionIds = Object.freeze([
  "evaluations",
  "graduations",
  "medicalLeaves",
] as const);

export type NestedLegacyHistoryCounts = Readonly<
  Record<(typeof nestedLegacyHistoryCollectionIds)[number], number>
>;

export type GlobalLegacyEliminationTransaction = Readonly<{
  get: (path: string) => Promise<Readonly<{ exists: boolean; data: () => unknown }>>;
  /** `academies/{a}/members` read with `limit(1)`: 0 or 1. */
  countLegacyMembers: (academyId: string) => Promise<number>;
  set: (path: string, data: Readonly<Record<string, unknown>>) => void;
  create: (path: string, data: Readonly<Record<string, unknown>>) => void;
}>;

export type GlobalLegacyEliminationStore = Readonly<{
  /** Read once, outside the transaction, paths only. */
  countNestedLegacyHistory: (academyId: string) => Promise<NestedLegacyHistoryCounts>;
  runTransaction: <T>(
    callback: (transaction: GlobalLegacyEliminationTransaction) => Promise<T>,
    options: Readonly<{ readOnly: boolean }>,
  ) => Promise<T>;
}>;

export type GlobalLegacyEliminationBinding = Readonly<{
  projectId: string;
  academyId: string;
  integritySecretMaterial: string;
}>;

export class GlobalLegacyEliminationError extends Error {
  constructor(
    readonly code: "control-plane" | "confirmation-mismatch" | "not-proven",
    message: string,
  ) {
    super(message);
    this.name = "GlobalLegacyEliminationError";
  }
}

const integritySecretVersion = "integrity-v1";
const operationId = "t097-global-legacy-elimination";

function statePath(academyId: string): string {
  return `academies/${academyId}/memberDirectoryStates/current`;
}

function guardPath(academyId: string): string {
  return `memberDirectoryRestoreGuards/${academyId}`;
}

function guardEventPath(academyId: string, eventId: string): string {
  return `memberDirectoryRestoreGuards/${academyId}/events/${eventId}`;
}

/** A nested history document counts when its parent document sits under legacy students or members. */
export function isNestedLegacyHistoryPath(academyId: string, documentPath: string): boolean {
  const parent = documentPath.split("/").slice(0, -2).join("/");
  return (
    parent.startsWith(`academies/${academyId}/students/`) ||
    parent.startsWith(`academies/${academyId}/members/`)
  );
}

export function expectedGlobalLegacyEliminationConfirmation(
  input: Readonly<{
    projectId: string;
    academyId: string;
    stateRevision: number;
    lastEventId: string;
    lastEventMac: string;
    legacyMemberDocuments: number;
    nestedLegacyHistory: NestedLegacyHistoryCounts;
  }>,
): string {
  const hash16 = createHash("sha256")
    .update(
      canonicalizeMemberDirectoryValue({
        projectId: input.projectId,
        academyId: input.academyId,
        stateRevision: input.stateRevision,
        lastEventId: input.lastEventId,
        lastEventMac: input.lastEventMac,
        legacyMemberDocuments: input.legacyMemberDocuments,
        nestedLegacyHistory: { ...input.nestedLegacyHistory },
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return `ELIMINATE LEGACY MEMBER READS ${input.academyId} r${input.stateRevision} e${input.lastEventId} ${hash16}`;
}

export function buildLegacyReadsEliminatedAuditDraft(
  input: Readonly<{ academyId: string; actorId: string; stateRevision: number }>,
): AuditEventDraft {
  return {
    academyId: input.academyId as AuditEventDraft["academyId"],
    actorId: input.actorId as AuditEventDraft["actorId"],
    action: "member.directory.legacy-reads-eliminated",
    targetRef: statePath(input.academyId),
    purpose: "global legacy-read elimination (T097)",
    correlationId: `${operationId}-${input.stateRevision}` as AuditEventDraft["correlationId"],
  };
}

function nestedTotal(counts: NestedLegacyHistoryCounts): number {
  return nestedLegacyHistoryCollectionIds.reduce((total, id) => total + counts[id], 0);
}

/** Every read, before any write: state, guard header, its last event, members (limit 1). */
async function readControlPlane(
  transaction: GlobalLegacyEliminationTransaction,
  academyId: string,
) {
  const state = (await transaction.get(statePath(academyId))).data();
  const guard = (await transaction.get(guardPath(academyId))).data();
  const parsedGuard = memberDirectoryRestoreGuardSchema.safeParse(guard);
  const event = parsedGuard.success
    ? (await transaction.get(guardEventPath(academyId, parsedGuard.data.lastEventId))).data()
    : undefined;
  const legacyMemberDocuments = await transaction.countLegacyMembers(academyId);
  return { state, guard, event, legacyMemberDocuments };
}

function verifiedControlPlane(
  binding: GlobalLegacyEliminationBinding,
  read: Readonly<{ state: unknown; guard: unknown; event: unknown }>,
) {
  try {
    const control = assertMemberDirectoryControlPlane({
      projectId: binding.projectId,
      state: read.state,
      guard: read.guard,
      event: read.event,
      integritySecretMaterial: binding.integritySecretMaterial,
      integritySecretVersion,
    });
    if (control.state.academyId !== binding.academyId) throw new Error("academy mismatch");
    return control;
  } catch {
    throw new GlobalLegacyEliminationError(
      "control-plane",
      "The member directory control plane could not be verified (state, guard and event MAC).",
    );
  }
}

export async function planGlobalLegacyEliminationDryRun(
  store: GlobalLegacyEliminationStore,
  binding: GlobalLegacyEliminationBinding,
) {
  const nestedLegacyHistory = await store.countNestedLegacyHistory(binding.academyId);
  const read = await store.runTransaction(
    async (transaction) => readControlPlane(transaction, binding.academyId),
    { readOnly: true },
  );
  const { state, guard, event } = verifiedControlPlane(binding, read);
  const view = {
    academyId: binding.academyId,
    projectId: binding.projectId,
    stateRevision: state.stateRevision,
    lastEventId: guard.lastEventId,
    lastEventTransitionKind: event.transitionKind,
    globalLegacyReadEliminated: state.globalLegacyReadEliminated,
    rollbackProtocolVersion: state.rollbackProtocolVersion,
    rollbackEligibleStudentCount: state.rollbackEligibleStudentCount,
    rollbackCapacityLimit: state.rollbackCapacityLimit,
  };
  if (state.globalLegacyReadEliminated) {
    return Object.freeze({ status: "already-eliminated" as const, ...view });
  }
  const evidence = {
    legacyMemberDocumentCount: read.legacyMemberDocuments,
    nestedLegacyDocumentCount: nestedTotal(nestedLegacyHistory),
    operatorConfirmationVerified: true,
  };
  let refusal: string | undefined;
  try {
    planMemberDirectoryGlobalLegacyElimination({
      currentState: state,
      evidence,
      now: state.updatedAt,
      actorId: state.updatedBy,
    });
  } catch (error) {
    refusal = error instanceof Error ? error.message : "Global legacy-read elimination refused";
  }
  return Object.freeze({
    status: refusal === undefined ? ("ready" as const) : ("blocked" as const),
    ...view,
    legacyMemberDocuments: read.legacyMemberDocuments,
    nestedLegacyHistory,
    unmetPreconditions: listUnmetMemberDirectoryGlobalEliminationPreconditions(evidence),
    ...(refusal === undefined ? {} : { refusal }),
    nextState: {
      stateRevision: state.stateRevision + 1,
      globalLegacyReadEliminated: true,
      rollbackProtocolVersion: "disabled",
      rollbackEligibleStudentCount: state.rollbackEligibleStudentCount,
      rollbackCapacityLimit: state.rollbackCapacityLimit,
    },
    expectedConfirmation: expectedGlobalLegacyEliminationConfirmation({
      projectId: binding.projectId,
      academyId: binding.academyId,
      stateRevision: state.stateRevision,
      lastEventId: guard.lastEventId,
      lastEventMac: guard.lastEventMac,
      legacyMemberDocuments: read.legacyMemberDocuments,
      nestedLegacyHistory,
    }),
  });
}

export async function applyGlobalLegacyElimination(
  store: GlobalLegacyEliminationStore,
  input: GlobalLegacyEliminationBinding &
    Readonly<{ confirmation: string; actorId: string; now: string }>,
): Promise<
  Readonly<
    | { status: "eliminated"; academyId: string; stateRevision: number; eventId: string }
    | { status: "already-eliminated"; academyId: string; stateRevision: number }
  >
> {
  const nestedLegacyHistory = await store.countNestedLegacyHistory(input.academyId);
  return store.runTransaction(
    async (transaction) => {
      const read = await readControlPlane(transaction, input.academyId);
      // Only this transition sets the marker, so a set marker means T097 already committed.
      const marked = memberDirectoryStateSchema.safeParse(read.state);
      if (marked.success && marked.data.globalLegacyReadEliminated) {
        return Object.freeze({
          status: "already-eliminated" as const,
          academyId: input.academyId,
          stateRevision: marked.data.stateRevision,
        });
      }
      const control = verifiedControlPlane(input, read);
      const expected = expectedGlobalLegacyEliminationConfirmation({
        projectId: input.projectId,
        academyId: input.academyId,
        stateRevision: control.state.stateRevision,
        lastEventId: control.guard.lastEventId,
        lastEventMac: control.guard.lastEventMac,
        legacyMemberDocuments: read.legacyMemberDocuments,
        nestedLegacyHistory,
      });
      if (input.confirmation !== expected) {
        throw new GlobalLegacyEliminationError(
          "confirmation-mismatch",
          "The confirmation does not match the directory as read now; rerun the dry run.",
        );
      }
      let nextState;
      try {
        nextState = planMemberDirectoryGlobalLegacyElimination({
          currentState: control.state,
          evidence: {
            legacyMemberDocumentCount: read.legacyMemberDocuments,
            nestedLegacyDocumentCount: nestedTotal(nestedLegacyHistory),
            operatorConfirmationVerified: true,
          },
          now: input.now,
          actorId: input.actorId,
        });
      } catch (error) {
        throw new GlobalLegacyEliminationError(
          "not-proven",
          error instanceof Error ? error.message : "Global legacy-read elimination refused",
        );
      }
      const next = advanceMemberDirectoryControlPlane({
        projectId: input.projectId,
        state: control.state,
        guard: control.guard,
        event: control.event,
        nextState,
        operationId,
        transitionKind: "global-legacy-eliminate",
        integritySecretMaterial: input.integritySecretMaterial,
        integritySecretVersion,
        now: input.now,
        actorId: input.actorId,
      });

      transaction.set(statePath(input.academyId), nextState);
      transaction.set(guardPath(input.academyId), next.guard);
      transaction.create(guardEventPath(input.academyId, next.event.eventId), next.event);
      const auditPath = `academies/${input.academyId}/auditEvents/${operationId}-${nextState.stateRevision}`;
      appendAuditEventInTransaction(
        {
          create: (reference: Readonly<{ id: string; path: string }>, data) =>
            transaction.create(reference.path, data),
        },
        { id: `${operationId}-${nextState.stateRevision}`, path: auditPath },
        buildLegacyReadsEliminatedAuditDraft({
          academyId: input.academyId,
          actorId: input.actorId,
          stateRevision: nextState.stateRevision,
        }),
      );
      return Object.freeze({
        status: "eliminated" as const,
        academyId: input.academyId,
        stateRevision: nextState.stateRevision,
        eventId: next.event.eventId,
      });
    },
    { readOnly: false },
  );
}
