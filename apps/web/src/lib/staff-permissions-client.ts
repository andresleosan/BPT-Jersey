import { httpsCallable as firebaseHttpsCallable } from "firebase/functions";

import {
  delegablePermissions,
  permissionGrantStatuses,
  type DelegablePermission,
  type GrantPermissionCommand,
  type PermissionGrant,
  type PermissionGrantStatus,
  type RevokePermissionCommand,
} from "@bpt-jersey/domain/staff/permission-grants";

import { getFirebaseFunctions } from "./firebase-client";

/**
 * These callables are deployed with `consumeAppCheckToken: true`, so their App Check token is
 * single-use and the client has to ask for a limited-use one. Sending the ordinary cached token
 * gets the call rejected, and an App Check rejection surfaces as `401` — indistinguishable from
 * "not signed in" unless you already know to look here. Observed in production 2026-09-08 against a
 * real administrator session.
 */
const permissionGrantCallableClientOptions = Object.freeze({ limitedUseAppCheckTokens: true });

function httpsCallable<RequestData, ResponseData>(
  functions: ReturnType<typeof getFirebaseFunctions>,
  name: string,
) {
  return firebaseHttpsCallable<RequestData, ResponseData>(
    functions,
    name,
    permissionGrantCallableClientOptions,
  );
}

/**
 * T116: the office view of delegated permissions. Only office reaches these callables, so a failure
 * here is an administrative error rather than something a member could ever provoke - but the error
 * text stays generic all the same, because it is rendered next to staff identifiers.
 */
const safeListError = "Unable to load permission grants. Please try again.";
const safeGrantError = "Unable to grant that permission. Please try again.";
const safeRevokeError = "Unable to revoke that grant. Please try again.";

export type PermissionGrantView = PermissionGrant & Readonly<{ status: PermissionGrantStatus }>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGrant(value: unknown): value is PermissionGrantView {
  return (
    isPlainRecord(value) &&
    typeof value.grantId === "string" &&
    typeof value.subjectUserId === "string" &&
    typeof value.permission === "string" &&
    delegablePermissions.includes(value.permission as DelegablePermission) &&
    typeof value.reason === "string" &&
    typeof value.grantedBy === "string" &&
    typeof value.grantedAt === "string" &&
    typeof value.expiresAt === "string" &&
    typeof value.status === "string" &&
    permissionGrantStatuses.includes(value.status as PermissionGrantStatus)
  );
}

export async function listStaffPermissionGrants(
  filter: Readonly<{ subjectUserId?: string }> = {},
): Promise<readonly PermissionGrantView[]> {
  try {
    const callable = httpsCallable<unknown, unknown>(
      getFirebaseFunctions(),
      "listStaffPermissionGrants",
    );
    const result = await callable(
      filter.subjectUserId === undefined ? null : { subjectUserId: filter.subjectUserId },
    );
    const data = result.data;
    if (!isPlainRecord(data) || !Array.isArray(data.grants)) throw new Error(safeListError);
    if (!data.grants.every(isGrant)) throw new Error(safeListError);
    return Object.freeze([...data.grants]);
  } catch {
    throw new Error(safeListError);
  }
}

export async function grantStaffPermission(
  command: GrantPermissionCommand,
): Promise<PermissionGrantView> {
  try {
    const callable = httpsCallable<GrantPermissionCommand, unknown>(
      getFirebaseFunctions(),
      "grantStaffPermission",
    );
    const result = await callable(command);
    const data = result.data;
    if (!isPlainRecord(data) || !isGrant(data.grant)) throw new Error(safeGrantError);
    return data.grant;
  } catch {
    throw new Error(safeGrantError);
  }
}

export async function revokeStaffPermission(
  command: RevokePermissionCommand,
): Promise<PermissionGrantView> {
  try {
    const callable = httpsCallable<RevokePermissionCommand, unknown>(
      getFirebaseFunctions(),
      "revokeStaffPermission",
    );
    const result = await callable(command);
    const data = result.data;
    if (!isPlainRecord(data) || !isGrant(data.grant)) throw new Error(safeRevokeError);
    return data.grant;
  } catch {
    throw new Error(safeRevokeError);
  }
}

/** What office reads on the row. A grant that has run out says so without anything sweeping it. */
export function permissionGrantLabel(permission: DelegablePermission): string {
  return permission === "reviewPenalties" ? "Review no-show penalties" : "Manage classes";
}

export function permissionGrantStatusLabel(grant: PermissionGrantView): string {
  if (grant.status === "revoked") return "Revoked";
  if (grant.status === "expired") return "Expired";
  return `Active until ${grant.expiresAt.slice(0, 10)}`;
}
