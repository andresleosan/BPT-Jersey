import { err, ok, type Result } from "../result";

/**
 * T116: delegating administrative permissions to a coach.
 *
 * The DOCX lets administration give a coach extra permissions. The role, however, lives in the auth
 * claim, and a claim is the wrong place for this: it is minted at sign-in, it survives until the
 * token refreshes, and widening it would hand a coach administrative reach that no longer says who
 * gave it, why, or until when.
 *
 * So the claim is never touched. A grant is a document: office names one permission from a closed
 * list, says why, and it expires. Authorization becomes "the role allows it, or a live grant does",
 * and every other rule - App Check, tenant, fail-closed by role - stays exactly as it was. Revoking
 * takes effect immediately, because the check reads the document instead of a token the holder
 * carries around.
 */

/**
 * The closed list of what may be delegated. Adding an entry is a deliberate act: it must arrive with
 * the callable that honours it and the test that proves a coach without the grant is still refused.
 *
 * What is absent matters more than what is present. Money, health, safeguarding, member exports and
 * staff administration itself are not delegable. The last one is the load-bearing exclusion: a coach
 * who could grant permissions could grant themselves anything, and the closed list would stop
 * meaning anything at all.
 */
export const delegablePermissions = Object.freeze(["reviewPenalties", "manageClasses"] as const);
export type DelegablePermission = (typeof delegablePermissions)[number];

export function isDelegablePermission(value: unknown): value is DelegablePermission {
  return typeof value === "string" && delegablePermissions.includes(value as DelegablePermission);
}

/** Only staff who are not already administrative can receive a grant. */
export const grantableRoles = Object.freeze(["headCoach", "coach"] as const);
export type GrantableRole = (typeof grantableRoles)[number];

/** Only office may grant, the same pair that already resolves penalties. */
export const grantingRoles = Object.freeze(["owner", "administrator"] as const);
export type GrantingRole = (typeof grantingRoles)[number];

/**
 * A grant always expires. An open-ended delegation is indistinguishable from a role change, and the
 * point of T116 is that it is not one. Six months is long enough for a season and short enough that
 * a forgotten grant dies on its own.
 */
export const maxGrantDurationDays = 180;

export const permissionGrantStatuses = Object.freeze(["active", "revoked", "expired"] as const);
export type PermissionGrantStatus = (typeof permissionGrantStatuses)[number];

export type PermissionGrant = Readonly<{
  grantId: string;
  academyId: string;
  /** The staff member who receives the permission; their claim is unchanged. */
  subjectUserId: string;
  permission: DelegablePermission;
  reason: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revocationReason: string | null;
  schemaVersion: "1";
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const minReasonLength = 8;
const maxReasonLength = 200;
const dayMs = 86_400_000;

function parseReason(value: unknown, label: string): Result<string, string> {
  if (typeof value !== "string") return err(`${label} is required`);
  const trimmed = value.trim();
  if (trimmed.length < minReasonLength) return err(`${label} is too short`);
  if (trimmed.length > maxReasonLength) return err(`${label} is too long`);
  return ok(trimmed);
}

/**
 * Whether a grant is live at a point in time. Expiry is derived here rather than stored, so a grant
 * that has run out stops working without anything having to sweep it.
 */
export function permissionGrantStatusAt(
  grant: Pick<PermissionGrant, "revokedAt" | "expiresAt">,
  now: string,
): PermissionGrantStatus {
  if (grant.revokedAt !== null) return "revoked";
  const expiryMs = Date.parse(grant.expiresAt);
  const nowMs = Date.parse(now);
  // An unreadable date counts as expired: fail closed, never open.
  if (Number.isNaN(expiryMs) || Number.isNaN(nowMs)) return "expired";
  return nowMs < expiryMs ? "active" : "expired";
}

export type DelegatedPermissionDecision = Readonly<{
  allowed: boolean;
  /** The grant that allowed it, so the caller can audit which document opened the door. */
  grantId: string | null;
  reason: string;
}>;

/**
 * The whole authorization question in one place: does this actor hold a live grant for this
 * permission? This never replaces the role check - a caller consults it only after the role check
 * has already said no.
 */
export function evaluateDelegatedPermission(input: {
  grants: readonly PermissionGrant[];
  subjectUserId: string;
  permission: DelegablePermission;
  now: string;
}): DelegatedPermissionDecision {
  const live = input.grants.filter(
    (grant) =>
      grant.subjectUserId === input.subjectUserId &&
      grant.permission === input.permission &&
      permissionGrantStatusAt(grant, input.now) === "active",
  );
  const chosen = [...live].sort((left, right) => right.expiresAt.localeCompare(left.expiresAt))[0];
  if (chosen === undefined) {
    return Object.freeze({
      allowed: false,
      grantId: null,
      reason: `No live grant for ${input.permission}`,
    });
  }
  return Object.freeze({
    allowed: true,
    grantId: chosen.grantId,
    reason: `Granted by ${chosen.grantedBy} until ${chosen.expiresAt}`,
  });
}

export type GrantPermissionCommand = Readonly<{
  subjectUserId: string;
  permission: DelegablePermission;
  reason: string;
  expiresAt: string;
}>;

const grantCommandKeys = Object.freeze([
  "subjectUserId",
  "permission",
  "reason",
  "expiresAt",
] as const);

/** Closed payload: four fields, nothing else. */
export function parseGrantPermissionCommand(
  input: unknown,
): Result<GrantPermissionCommand, string> {
  if (!isRecord(input)) return err("Grant command must be an object");
  const keys = Object.keys(input);
  if (keys.length !== grantCommandKeys.length || grantCommandKeys.some((k) => !keys.includes(k))) {
    return err("Grant command accepts only subjectUserId, permission, reason and expiresAt");
  }
  if (typeof input.subjectUserId !== "string" || !identifierPattern.test(input.subjectUserId)) {
    return err("subjectUserId is invalid");
  }
  if (!isDelegablePermission(input.permission)) return err("permission is not delegable");
  const reason = parseReason(input.reason, "reason");
  if (!reason.ok) return err(reason.error);
  if (typeof input.expiresAt !== "string" || Number.isNaN(Date.parse(input.expiresAt))) {
    return err("expiresAt is invalid");
  }
  return ok(
    Object.freeze({
      subjectUserId: input.subjectUserId,
      permission: input.permission,
      reason: reason.value,
      expiresAt: input.expiresAt,
    }),
  );
}

export type RevokePermissionCommand = Readonly<{ grantId: string; reason: string }>;

export function parseRevokePermissionCommand(
  input: unknown,
): Result<RevokePermissionCommand, string> {
  if (!isRecord(input)) return err("Revoke command must be an object");
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes("grantId") || !keys.includes("reason")) {
    return err("Revoke command accepts only grantId and reason");
  }
  if (typeof input.grantId !== "string" || !identifierPattern.test(input.grantId)) {
    return err("grantId is invalid");
  }
  const reason = parseReason(input.reason, "reason");
  if (!reason.ok) return err(reason.error);
  return ok(Object.freeze({ grantId: input.grantId, reason: reason.value }));
}

export type GrantDecision = Readonly<{ grant: PermissionGrant }>;

/**
 * Decides whether office may create this grant. Every refusal here is a rule that would otherwise
 * have to be re-checked, and eventually forgotten, at each call site.
 */
export function decidePermissionGrant(input: {
  command: GrantPermissionCommand;
  actorId: string;
  actorRole: string;
  /** The role the subject holds today, read from their staff profile rather than from a claim. */
  subjectRole: string | null;
  subjectActive: boolean;
  academyId: string;
  grantId: string;
  now: string;
}): Result<GrantDecision, string> {
  if (!grantingRoles.includes(input.actorRole as GrantingRole)) {
    return err("Only office may grant a permission");
  }
  if (input.command.subjectUserId === input.actorId) {
    return err("A grant cannot be given to oneself");
  }
  if (input.subjectRole === null) return err("Subject is not staff of this academy");
  if (!grantableRoles.includes(input.subjectRole as GrantableRole)) {
    return err("Only a coach or head coach may receive a grant");
  }
  if (!input.subjectActive) return err("Subject staff member is not active");

  const nowMs = Date.parse(input.now);
  const expiryMs = Date.parse(input.command.expiresAt);
  if (Number.isNaN(nowMs) || Number.isNaN(expiryMs)) return err("Grant window is invalid");
  if (expiryMs <= nowMs) return err("Grant must expire in the future");
  if (expiryMs - nowMs > maxGrantDurationDays * dayMs) {
    return err(`Grant may not last more than ${maxGrantDurationDays} days`);
  }

  return ok(
    Object.freeze({
      grant: Object.freeze({
        grantId: input.grantId,
        academyId: input.academyId,
        subjectUserId: input.command.subjectUserId,
        permission: input.command.permission,
        reason: input.command.reason,
        grantedBy: input.actorId,
        grantedAt: input.now,
        expiresAt: input.command.expiresAt,
        revokedAt: null,
        revokedBy: null,
        revocationReason: null,
        schemaVersion: "1" as const,
      }),
    }),
  );
}
