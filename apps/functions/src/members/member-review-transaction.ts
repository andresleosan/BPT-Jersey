import { createHash } from "node:crypto";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import type { CanonicalDirectoryReadTransaction } from "./canonical-member-directory-read-service.js";
import type { CanonicalMemberDirectoryActor } from "./canonical-member-directory-service.js";
import {
  advanceMemberDirectoryControlPlane, assertCanonicalMemberDirectoryWriterReady,
  assertMemberDirectoryControlPlane, memberDirectoryRestoreGuardSchema,
  type MemberDirectoryTransitionKind,
} from "./member-directory-state.js";

export type MemberReviewIntegrity = Readonly<{
  projectId: string; identitySecretVersion: string;
  integritySecretMaterial: string; integritySecretVersion: string;
}>;

/** Call after the shared restricted transaction has checked the live staff actor.
 * Reads every guard before returning a write-only commit, so callers can finish their reads first.
 */
export async function prepareMemberReviewWrite(
  tx: CanonicalDirectoryReadTransaction, binding: MemberReviewIntegrity,
  actor: CanonicalMemberDirectoryActor, requestId: string, studentId: string, now: string,
  transitionKind: MemberDirectoryTransitionKind = "member-data-review",
): Promise<() => void> {
  const base = `academies/${actor.academyId}`;
  const statePath = `${base}/memberDirectoryStates/current`;
  const guardPath = `memberDirectoryRestoreGuards/${actor.academyId}`;
  const [stateDoc, guardDoc] = await Promise.all([tx.get(statePath), tx.get(guardPath)]);
  const state = assertCanonicalMemberDirectoryWriterReady(stateDoc.data, {
    academyId: actor.academyId, digestVersion: "hmac-sha256-v1", secretVersion: binding.identitySecretVersion,
  });
  const guard = memberDirectoryRestoreGuardSchema.parse(guardDoc.data);
  const eventDoc = await tx.get(`${guardPath}/events/${guard.lastEventId}`);
  const control = assertMemberDirectoryControlPlane({ ...binding, state, guard, event: eventDoc.data });
  const nextState = { ...state, stateRevision: state.stateRevision + 1, updatedAt: now, updatedBy: actor.actorId };
  const next = advanceMemberDirectoryControlPlane({ ...binding, ...control, nextState,
    operationId: requestId, transitionKind, now, actorId: actor.actorId,
  });
  return () => {
    tx.set(statePath, nextState);
    tx.set(guardPath, next.guard);
    tx.create(`${guardPath}/events/${next.event.eventId}`, next.event);
    appendAuditEventInTransaction({ create: (ref: { id: string }, value) =>
      tx.create(`${base}/auditEvents/${ref.id}`, value) }, { id: `review-${requestId}` }, {
      academyId: actor.academyId, actorId: actor.actorId, action: "member.updated",
      targetRef: `${base}/students/${studentId}`, purpose: "member-record-maintenance", correlationId: `write-${createHash("sha256").update(`${actor.academyId}:${studentId}:${requestId}`).digest("hex")}`,
    } as AuditEventDraft);
  };
}
