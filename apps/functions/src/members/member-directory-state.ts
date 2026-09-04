import {
  memberDirectoryStateSchema,
  type MemberDirectoryState,
} from "@bpt-jersey/domain/members/directory";
import { z } from "zod";

import {
  canonicalizeMemberDirectoryValue,
  constantTimeMacEquals,
  createMemberDirectoryIntegrityMac,
} from "./member-directory-crypto.js";

export const memberDirectoryTransitionKinds = Object.freeze([
  "initialize",
  "canonical-identity-create",
  "canonical-identity-update",
  "adult-auth-link",
  "family-minor-create",
  "identity-key-bootstrap",
  "identity-key-reconcile",
  "directory-forward",
  "failed-forward-compensation",
  "rollback-projection",
  "rollback-readonly",
  "canonical-recovery",
  "restore-prepare",
  "restore-acquire",
  "restore-complete",
  "restore-rehearsal-complete",
  "global-legacy-eliminate",
  "lease-renewed",
  "post-deadline-recovery",
] as const);

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const macPattern = /^[a-f0-9]{64}$/u;
const utcMillisecondPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const safeIdentifier = z.string().regex(safeIdentifierPattern);
const timestamp = z
  .string()
  .regex(utcMillisecondPattern)
  .refine((value) => {
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
  });

export const memberDirectoryRestoreGuardSchema = z.strictObject({
  guardId: safeIdentifier,
  projectId: safeIdentifier,
  academyId: safeIdentifier,
  highestStateRevision: z.number().int().nonnegative().safe(),
  globalLegacyReadEverEliminated: z.boolean(),
  highestRollbackEligibleStudentCount: z.number().int().nonnegative().max(400).safe(),
  restoreEpoch: z.number().int().nonnegative().safe(),
  integrityMacVersion: z.literal("hmac-sha256-v1"),
  integritySecretVersion: safeIdentifier,
  lastEventId: z.string().regex(/^\d+$/u),
  lastEventMac: z.string().regex(macPattern),
  schemaVersion: z.literal("1"),
  createdAt: timestamp,
  createdBy: safeIdentifier,
  updatedAt: timestamp,
  updatedBy: safeIdentifier,
});

export type MemberDirectoryRestoreGuard = Readonly<
  z.infer<typeof memberDirectoryRestoreGuardSchema>
>;

export const memberDirectoryGuardEventSchema = z.strictObject({
  eventId: z.string().regex(/^\d+$/u),
  guardId: safeIdentifier,
  projectId: safeIdentifier,
  academyId: safeIdentifier,
  previousStateRevision: z.number().int().min(-1).safe(),
  currentStateRevision: z.number().int().nonnegative().safe(),
  previousEventMac: z.string().regex(macPattern),
  globalLegacyReadEverEliminated: z.boolean(),
  highestRollbackEligibleStudentCount: z.number().int().nonnegative().max(400).safe(),
  restoreEpoch: z.number().int().nonnegative().safe(),
  operationId: safeIdentifier,
  transitionKind: z.enum(memberDirectoryTransitionKinds),
  occurredAt: timestamp,
  actorId: safeIdentifier,
  integrityMacVersion: z.literal("hmac-sha256-v1"),
  integritySecretVersion: safeIdentifier,
  eventMac: z.string().regex(macPattern),
  schemaVersion: z.literal("1"),
});

export type MemberDirectoryGuardEvent = Readonly<z.infer<typeof memberDirectoryGuardEventSchema>>;
export type MemberDirectoryTransitionKind = (typeof memberDirectoryTransitionKinds)[number];
export type AdminDirectoryReader = "canonical" | "legacy-rollback";

type IntegrityBinding = Readonly<{
  integritySecretMaterial: string;
  integritySecretVersion: string;
}>;

function eventMac(
  event: Omit<MemberDirectoryGuardEvent, "eventMac">,
  integritySecretMaterial: string,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-guard-event-v1",
    values: [canonicalizeMemberDirectoryValue(event)],
    secretMaterial: integritySecretMaterial,
  });
}

function parsedState(value: unknown): MemberDirectoryState {
  const parsed = memberDirectoryStateSchema.safeParse(value);
  if (!parsed.success) throw new Error("Member directory state is invalid or missing");
  return parsed.data;
}

function parsedGuard(value: unknown): MemberDirectoryRestoreGuard {
  const parsed = memberDirectoryRestoreGuardSchema.safeParse(value);
  if (!parsed.success) throw new Error("Member directory restore guard is invalid or missing");
  return parsed.data;
}

function parsedEvent(value: unknown): MemberDirectoryGuardEvent {
  const parsed = memberDirectoryGuardEventSchema.safeParse(value);
  if (!parsed.success) throw new Error("Member directory guard event is invalid or missing");
  return parsed.data;
}

export function buildInitialMemberDirectoryControlPlane(
  input: Readonly<{
    projectId: string;
    state: MemberDirectoryState;
    now: string;
    actorId: string;
  }> &
    IntegrityBinding,
): Readonly<{ guard: MemberDirectoryRestoreGuard; event: MemberDirectoryGuardEvent }> {
  const state = parsedState(input.state);
  if (state.stateRevision !== 0) throw new Error("Initial state revision must be zero");
  if (!safeIdentifierPattern.test(input.projectId)) throw new Error("Invalid project ID");
  if (!safeIdentifierPattern.test(input.actorId)) throw new Error("Invalid actor ID");
  if (!safeIdentifierPattern.test(input.integritySecretVersion)) {
    throw new Error("Invalid integrity secret version");
  }
  const occurredAt = timestamp.parse(input.now);
  const eventWithoutMac: Omit<MemberDirectoryGuardEvent, "eventMac"> = {
    eventId: "0",
    guardId: state.academyId,
    projectId: input.projectId,
    academyId: state.academyId,
    previousStateRevision: -1,
    currentStateRevision: 0,
    previousEventMac: "0".repeat(64),
    globalLegacyReadEverEliminated: state.globalLegacyReadEliminated,
    highestRollbackEligibleStudentCount: state.rollbackEligibleStudentCount,
    restoreEpoch: 0,
    operationId: "state-initialization",
    transitionKind: "initialize",
    occurredAt,
    actorId: input.actorId,
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: input.integritySecretVersion,
    schemaVersion: "1",
  };
  const event = memberDirectoryGuardEventSchema.parse({
    ...eventWithoutMac,
    eventMac: eventMac(eventWithoutMac, input.integritySecretMaterial),
  });
  const guard = memberDirectoryRestoreGuardSchema.parse({
    guardId: state.academyId,
    projectId: input.projectId,
    academyId: state.academyId,
    highestStateRevision: 0,
    globalLegacyReadEverEliminated: state.globalLegacyReadEliminated,
    highestRollbackEligibleStudentCount: state.rollbackEligibleStudentCount,
    restoreEpoch: 0,
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: input.integritySecretVersion,
    lastEventId: "0",
    lastEventMac: event.eventMac,
    schemaVersion: "1",
    createdAt: occurredAt,
    createdBy: input.actorId,
    updatedAt: occurredAt,
    updatedBy: input.actorId,
  });
  return Object.freeze({ guard: Object.freeze(guard), event: Object.freeze(event) });
}

export function assertMemberDirectoryControlPlane(
  input: Readonly<{
    projectId: string;
    state: unknown;
    guard: unknown;
    event: unknown;
  }> &
    IntegrityBinding,
): Readonly<{
  state: MemberDirectoryState;
  guard: MemberDirectoryRestoreGuard;
  event: MemberDirectoryGuardEvent;
}> {
  const state = parsedState(input.state);
  const guard = parsedGuard(input.guard);
  const event = parsedEvent(input.event);
  if (
    guard.projectId !== input.projectId ||
    guard.academyId !== state.academyId ||
    guard.guardId !== state.academyId ||
    guard.highestStateRevision !== state.stateRevision ||
    guard.globalLegacyReadEverEliminated !== state.globalLegacyReadEliminated ||
    guard.highestRollbackEligibleStudentCount !== state.rollbackEligibleStudentCount ||
    guard.integritySecretVersion !== input.integritySecretVersion ||
    guard.lastEventId !== String(state.stateRevision) ||
    guard.lastEventMac !== event.eventMac ||
    event.eventId !== guard.lastEventId ||
    event.guardId !== guard.guardId ||
    event.projectId !== guard.projectId ||
    event.academyId !== guard.academyId ||
    event.currentStateRevision !== guard.highestStateRevision ||
    event.previousStateRevision !== event.currentStateRevision - 1 ||
    event.globalLegacyReadEverEliminated !== guard.globalLegacyReadEverEliminated ||
    event.highestRollbackEligibleStudentCount !== guard.highestRollbackEligibleStudentCount ||
    event.restoreEpoch !== guard.restoreEpoch ||
    event.integritySecretVersion !== input.integritySecretVersion
  ) {
    throw new Error("Member directory control-plane binding mismatch");
  }
  const { eventMac: storedMac, ...eventWithoutMac } = event;
  const expectedMac = eventMac(eventWithoutMac, input.integritySecretMaterial);
  if (!constantTimeMacEquals(storedMac, expectedMac)) {
    throw new Error("Member directory guard event MAC mismatch");
  }
  return Object.freeze({ state, guard, event });
}

export function advanceMemberDirectoryControlPlane(
  input: Readonly<{
    projectId: string;
    state: MemberDirectoryState;
    guard: unknown;
    event: unknown;
    nextState: MemberDirectoryState;
    operationId: string;
    transitionKind: MemberDirectoryTransitionKind;
    now: string;
    actorId: string;
  }> &
    IntegrityBinding,
): Readonly<{ guard: MemberDirectoryRestoreGuard; event: MemberDirectoryGuardEvent }> {
  const current = assertMemberDirectoryControlPlane(input);
  const nextState = parsedState(input.nextState);
  if (
    nextState.academyId !== current.state.academyId ||
    nextState.stateRevision !== current.state.stateRevision + 1
  ) {
    throw new Error("Member directory state revision must advance exactly once");
  }
  if (
    (current.state.globalLegacyReadEliminated && !nextState.globalLegacyReadEliminated) ||
    nextState.rollbackEligibleStudentCount < current.state.rollbackEligibleStudentCount
  ) {
    throw new Error("Member directory monotonic state cannot decrease");
  }
  if (nextState.updatedAt !== input.now || nextState.updatedBy !== input.actorId) {
    throw new Error("Member directory state audit envelope mismatch");
  }
  const occurredAt = timestamp.parse(input.now);
  if (
    !safeIdentifierPattern.test(input.operationId) ||
    !safeIdentifierPattern.test(input.actorId)
  ) {
    throw new Error("Invalid member directory transition identity");
  }
  const eventWithoutMac: Omit<MemberDirectoryGuardEvent, "eventMac"> = {
    eventId: String(nextState.stateRevision),
    guardId: current.guard.guardId,
    projectId: input.projectId,
    academyId: nextState.academyId,
    previousStateRevision: current.state.stateRevision,
    currentStateRevision: nextState.stateRevision,
    previousEventMac: current.event.eventMac,
    globalLegacyReadEverEliminated: nextState.globalLegacyReadEliminated,
    highestRollbackEligibleStudentCount: nextState.rollbackEligibleStudentCount,
    restoreEpoch: current.guard.restoreEpoch,
    operationId: input.operationId,
    transitionKind: input.transitionKind,
    occurredAt,
    actorId: input.actorId,
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: input.integritySecretVersion,
    schemaVersion: "1",
  };
  const event = memberDirectoryGuardEventSchema.parse({
    ...eventWithoutMac,
    eventMac: eventMac(eventWithoutMac, input.integritySecretMaterial),
  });
  const guard = memberDirectoryRestoreGuardSchema.parse({
    ...current.guard,
    highestStateRevision: nextState.stateRevision,
    globalLegacyReadEverEliminated: nextState.globalLegacyReadEliminated,
    highestRollbackEligibleStudentCount: nextState.rollbackEligibleStudentCount,
    lastEventId: event.eventId,
    lastEventMac: event.eventMac,
    updatedAt: occurredAt,
    updatedBy: input.actorId,
  });
  return Object.freeze({ guard: Object.freeze(guard), event: Object.freeze(event) });
}

export function assertCanonicalMemberDirectoryWriterReady(
  value: unknown,
  expected: Readonly<{
    academyId: string;
    digestVersion: "hmac-sha256-v1";
    secretVersion: string;
  }>,
): MemberDirectoryState {
  const state = parsedState(value);
  if (
    state.academyId !== expected.academyId ||
    state.readerVersion !== "canonical-v1" ||
    state.directoryWriteMode !== "canonical-v1" ||
    state.freezeStatus !== "open" ||
    state.operationPhase !== "idle" ||
    state.lastCommittedChunkNo !== 0 ||
    state.identityKeyCoverage !== "complete" ||
    state.digestVersion !== expected.digestVersion ||
    state.secretVersion !== expected.secretVersion
  ) {
    throw new Error("Canonical member directory writer is unavailable");
  }
  return state;
}

export function selectAdminDirectoryReader(value: unknown): AdminDirectoryReader {
  const state = parsedState(value);
  if (
    state.readerVersion === "canonical-v1" &&
    state.directoryWriteMode === "canonical-v1" &&
    state.freezeStatus === "open" &&
    state.operationPhase === "idle" &&
    state.lastCommittedChunkNo === 0 &&
    state.identityKeyCoverage === "complete"
  ) {
    return "canonical";
  }
  if (
    state.readerVersion === "legacy-rollback-v1" &&
    state.directoryWriteMode === "blocked" &&
    state.freezeStatus === "frozen" &&
    state.operationPhase === "rollback-readonly" &&
    state.globalLegacyReadEliminated === false &&
    state.lastCommittedChunkNo === 0
  ) {
    return "legacy-rollback";
  }
  if (state.readerVersion === "legacy-v1") {
    throw new Error("Member directory migration is required");
  }
  throw new Error("Member directory reader is unavailable");
}
