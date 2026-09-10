import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  decidePermissionGrant,
  evaluateDelegatedPermission,
  permissionGrantStatusAt,
  type DelegablePermission,
  type DelegatedPermissionDecision,
  type GrantPermissionCommand,
  type PermissionGrant,
  type PermissionGrantStatus,
  type RevokePermissionCommand,
} from "@bpt-jersey/domain/staff/permission-grants";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";

/**
 * T116: the store behind the delegated permission. Office grants and revokes; every other callable
 * only ever asks the read-side question "does this actor hold a live grant?".
 *
 * Nothing here touches a custom claim. That is the point: the coach signs in with the same token
 * they always had, and their extra reach lives in a document that office can read, audit and take
 * away in one write.
 */
export type PermissionGrantErrorCode = "invalid" | "not-found" | "tenant" | "conflict" | "denied";

export class PermissionGrantError extends Error {
  public constructor(
    public readonly code: PermissionGrantErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PermissionGrantError";
  }
}

export type GrantDocumentData = Readonly<Record<string, unknown>>;
export type GrantDocumentReference = Readonly<{ id: string; path?: string }>;
export type GrantDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => GrantDocumentData | undefined;
}>;
export type GrantQuery = Readonly<{
  where: (field: string, operator: "==", value: unknown) => GrantQuery;
  limit: (count: number) => GrantQuery;
  get: () => Promise<Readonly<{ docs: readonly GrantDocumentSnapshot[] }>>;
}>;
export type GrantTransaction = Readonly<{
  get: (reference: GrantDocumentReference) => Promise<GrantDocumentSnapshot>;
  create: (reference: GrantDocumentReference, data: GrantDocumentData) => unknown;
  set: (reference: GrantDocumentReference, data: GrantDocumentData) => unknown;
}>;
export type GrantFirestore = Readonly<{
  doc: (path: string) => GrantDocumentReference;
  collection: (path: string) => GrantQuery;
  runTransaction: <T>(update: (transaction: GrantTransaction) => Promise<T>) => Promise<T>;
}>;

export type PermissionGrantView = PermissionGrant & Readonly<{ status: PermissionGrantStatus }>;

export type PermissionGrantService = Readonly<{
  grantPermission: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      actorRole: string;
      command: GrantPermissionCommand;
      now?: string;
    }>,
  ) => Promise<PermissionGrantView>;
  revokePermission: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      actorRole: string;
      command: RevokePermissionCommand;
      now?: string;
    }>,
  ) => Promise<PermissionGrantView>;
  listPermissionGrants: (
    input: Readonly<{ academyId: string; subjectUserId?: string; now?: string }>,
  ) => Promise<readonly PermissionGrantView[]>;
  /** The read-side question every other callable asks. Never throws on a plain denial. */
  evaluatePermission: (
    input: Readonly<{
      academyId: string;
      subjectUserId: string;
      permission: DelegablePermission;
      now?: string;
    }>,
  ) => Promise<DelegatedPermissionDecision>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const maxGrantsPerAcademy = 500;
const maxStaffMatches = 10;

function fail(code: PermissionGrantErrorCode, message: string): never {
  throw new PermissionGrantError(code, message);
}

function segment(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    fail("invalid", `${label} is invalid`);
  }
  return value;
}

function validDateTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function path(academyId: string, collection: string, id: string): string {
  return `academies/${academyId}/${collection}/${id}`;
}

function auditDraft(
  academyId: string,
  actorId: string,
  action: "staff.permission.granted" | "staff.permission.revoked",
  grantId: string,
): AuditEventDraft {
  return {
    academyId,
    actorId,
    action,
    targetRef: path(academyId, "staffPermissionGrants", grantId),
    purpose: "staff-permission-delegation",
    correlationId: grantId,
  } as AuditEventDraft;
}

function storedGrant(
  value: GrantDocumentData | undefined,
  academyId: string,
  grantId: string,
): PermissionGrant {
  if (value === undefined) fail("not-found", "Grant is unavailable");
  if (
    value.grantId !== grantId ||
    value.academyId !== academyId ||
    typeof value.subjectUserId !== "string" ||
    typeof value.permission !== "string"
  ) {
    fail("tenant", "Grant tenant binding is invalid");
  }
  return value as unknown as PermissionGrant;
}

function withStatus(grant: PermissionGrant, now: string): PermissionGrantView {
  return Object.freeze({ ...grant, status: permissionGrantStatusAt(grant, now) });
}

export function createPermissionGrantService(options: {
  firestore: GrantFirestore;
  now?: () => string;
  newGrantId?: () => string;
}): PermissionGrantService {
  const currentTime = (override?: string): string => {
    const value = override ?? options.now?.() ?? new Date().toISOString();
    if (!validDateTime(value)) fail("invalid", "Grant time is invalid");
    return value;
  };

  async function readGrants(
    academyId: string,
    subjectUserId?: string,
  ): Promise<readonly PermissionGrant[]> {
    let query = options.firestore.collection(`academies/${academyId}/staffPermissionGrants`);
    if (subjectUserId !== undefined) query = query.where("subjectUserId", "==", subjectUserId);
    const snapshot = await query.limit(maxGrantsPerAcademy + 1).get();
    if (snapshot.docs.length > maxGrantsPerAcademy) {
      fail("conflict", "Too many grants to evaluate in one read");
    }
    return snapshot.docs
      .map((document) => document.data())
      .filter((value): value is GrantDocumentData => value !== undefined)
      .filter(
        (value) =>
          value.academyId === academyId &&
          typeof value.grantId === "string" &&
          typeof value.subjectUserId === "string" &&
          typeof value.permission === "string" &&
          typeof value.expiresAt === "string",
      )
      .map((value) => value as unknown as PermissionGrant);
  }

  return {
    async grantPermission(input) {
      const academyId = segment(input.academyId, "academyId");
      const actorId = segment(input.actorId, "actorId");
      const now = currentTime(input.now);
      const subjectUserId = segment(input.command.subjectUserId, "subjectUserId");

      // The subject's role comes from the staff record, never from anything the caller sent.
      const staffSnapshot = await options.firestore
        .collection(`academies/${academyId}/staff`)
        .where("userId", "==", subjectUserId)
        .limit(maxStaffMatches)
        .get();
      const staff = staffSnapshot.docs
        .map((document) => document.data())
        .filter((value): value is GrantDocumentData => value !== undefined)
        .filter((value) => value.academyId === academyId)[0];

      const decision = decidePermissionGrant({
        command: input.command,
        actorId,
        actorRole: input.actorRole,
        subjectRole: typeof staff?.role === "string" ? staff.role : null,
        subjectActive: staff?.active === true && staff?.status === "active",
        academyId,
        grantId: options.newGrantId?.() ?? `${subjectUserId}__${input.command.permission}__${now}`,
        now,
      });
      if (!decision.ok) fail("denied", decision.error);
      const grant = decision.value.grant;

      const grantRef = options.firestore.doc(
        path(academyId, "staffPermissionGrants", grant.grantId),
      );
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `staff-permission-granted-${grant.grantId}`),
      );
      await options.firestore.runTransaction(async (transaction) => {
        const [existing, auditSnapshot] = await Promise.all([
          transaction.get(grantRef),
          transaction.get(auditRef),
        ]);
        // A replay of the same decision must not mint a second grant or a second audit event.
        if (existing.exists || auditSnapshot.exists) {
          fail("conflict", "Grant already exists");
        }
        transaction.create(grantRef, grant as unknown as GrantDocumentData);
        appendAuditEventInTransaction(
          transaction as never,
          auditRef as never,
          auditDraft(academyId, actorId, "staff.permission.granted", grant.grantId),
        );
      });
      return withStatus(grant, now);
    },

    async revokePermission(input) {
      const academyId = segment(input.academyId, "academyId");
      const actorId = segment(input.actorId, "actorId");
      const grantId = segment(input.command.grantId, "grantId");
      const now = currentTime(input.now);
      if (input.actorRole !== "owner" && input.actorRole !== "administrator") {
        fail("denied", "Only office may revoke a permission");
      }

      const grantRef = options.firestore.doc(path(academyId, "staffPermissionGrants", grantId));
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `staff-permission-revoked-${grantId}`),
      );
      const revoked = await options.firestore.runTransaction(async (transaction) => {
        const [snapshot, auditSnapshot] = await Promise.all([
          transaction.get(grantRef),
          transaction.get(auditRef),
        ]);
        const current = storedGrant(
          snapshot.exists ? snapshot.data() : undefined,
          academyId,
          grantId,
        );
        // Revoking twice is not an error worth surfacing, but it must not write twice either.
        if (current.revokedAt !== null || auditSnapshot.exists) {
          fail("conflict", "Grant is already revoked");
        }
        const next: PermissionGrant = Object.freeze({
          ...current,
          revokedAt: now,
          revokedBy: actorId,
          revocationReason: input.command.reason,
        });
        transaction.set(grantRef, next as unknown as GrantDocumentData);
        appendAuditEventInTransaction(
          transaction as never,
          auditRef as never,
          auditDraft(academyId, actorId, "staff.permission.revoked", grantId),
        );
        return next;
      });
      return withStatus(revoked, now);
    },

    async listPermissionGrants(input) {
      const academyId = segment(input.academyId, "academyId");
      const now = currentTime(input.now);
      const subjectUserId =
        input.subjectUserId === undefined
          ? undefined
          : segment(input.subjectUserId, "subjectUserId");
      const grants = await readGrants(academyId, subjectUserId);
      return Object.freeze(
        grants
          .map((grant) => withStatus(grant, now))
          .sort((left, right) => right.grantedAt.localeCompare(left.grantedAt)),
      );
    },

    async evaluatePermission(input) {
      const academyId = segment(input.academyId, "academyId");
      const subjectUserId = segment(input.subjectUserId, "subjectUserId");
      const now = currentTime(input.now);
      const grants = await readGrants(academyId, subjectUserId);
      return evaluateDelegatedPermission({
        grants,
        subjectUserId,
        permission: input.permission,
        now,
      });
    },
  };
}
