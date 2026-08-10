import type { AdminRole } from "@bpt-jersey/domain";
import type { RegyfitAccessRecord } from "@bpt-jersey/domain";

import type { AdminSession } from "./admin-auth";

type SafeRegyfitAccessRecord = Omit<RegyfitAccessRecord, "ip">;
type AdminE2ERole = Extract<AdminRole, "owner" | "administrator">;
type AdminE2EPayload = Readonly<{ role: AdminE2ERole; records: unknown[] }>;

const adminE2EFlagBaked = process.env.NEXT_PUBLIC_ADMIN_E2E === "true";
const commonRecordKeys = [
  "academyId",
  "sourceSystem",
  "sourceId",
  "memberDisplayName",
  "memberNumber",
  "loginCount",
  "lastLoginAt",
  "importRunId",
  "capturedAt",
  "schemaVersion",
] as const;
const ownerRecordKeys = [...commonRecordKeys, "ip"] as const;

declare global {
  interface Window {
    __BPT_ADMIN_E2E__?: unknown;
  }
}

function runtimeHostname(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.hostname;
}

function isLoopbackHostname(hostname: string | undefined): boolean {
  const normalizedHostname = hostname?.toLowerCase();
  return (
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "localhost" ||
    normalizedHostname === "::1" ||
    normalizedHostname === "[::1]"
  );
}

export function isAdminE2EEnabled(
  hostname: string | undefined = runtimeHostname(),
  bakedFlag: boolean = adminE2EFlagBaked,
): boolean {
  return bakedFlag && isLoopbackHostname(hostname);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function hasKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  return expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isCommonRecord(value: unknown): value is SafeRegyfitAccessRecord {
  if (!isPlainRecord(value) || !hasKeys(value, commonRecordKeys)) {
    return false;
  }

  const loginCount = value.loginCount;

  return (
    typeof value.academyId === "string" &&
    value.academyId.trim().length > 0 &&
    value.sourceSystem === "regyfit" &&
    typeof value.sourceId === "string" &&
    value.sourceId.startsWith("synthetic-") &&
    typeof value.memberDisplayName === "string" &&
    typeof value.memberNumber === "string" &&
    typeof loginCount === "number" &&
    Number.isInteger(loginCount) &&
    loginCount >= 0 &&
    (value.lastLoginAt === null || typeof value.lastLoginAt === "string") &&
    typeof value.importRunId === "string" &&
    value.importRunId.startsWith("synthetic-") &&
    typeof value.capturedAt === "string" &&
    value.capturedAt.trim().length > 0 &&
    value.schemaVersion === "1"
  );
}

function isOwnerRecord(value: unknown): value is RegyfitAccessRecord {
  if (!isCommonRecord(value) || !isPlainRecord(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    hasExactKeys(value, ownerRecordKeys) &&
    typeof record.ip === "string" &&
    record.ip.trim().length > 0
  );
}

function isAdministratorRecord(value: unknown): value is SafeRegyfitAccessRecord {
  return isCommonRecord(value) && hasExactKeys(value, commonRecordKeys);
}

function injectedPayload(): unknown {
  return typeof window === "undefined" ? undefined : window.__BPT_ADMIN_E2E__;
}

function validPayload(payload: unknown, role: AdminE2ERole): payload is AdminE2EPayload {
  return (
    isPlainRecord(payload) &&
    hasExactKeys(payload, ["role", "records"]) &&
    payload.role === role &&
    Array.isArray(payload.records)
  );
}

export function adminSessionForTestRole(role: AdminE2ERole): AdminSession {
  return Object.freeze({
    uid: `synthetic-admin-${role}`,
    email: `${role}@example.test`,
    displayName: `Synthetic ${role}`,
    academyId: "synthetic-academy",
    role,
  });
}

export function readInjectedRegyfitRecordsForRole(
  role: Extract<AdminRole, "owner">,
  payload?: unknown,
): readonly RegyfitAccessRecord[];
export function readInjectedRegyfitRecordsForRole(
  role: Extract<AdminRole, "administrator">,
  payload?: unknown,
): readonly SafeRegyfitAccessRecord[];
export function readInjectedRegyfitRecordsForRole(
  role: AdminE2ERole,
  payload: unknown = injectedPayload(),
): readonly RegyfitAccessRecord[] | readonly SafeRegyfitAccessRecord[] {
  if (!validPayload(payload, role)) {
    return [];
  }

  if (role === "owner") {
    const records = payload.records.filter(isOwnerRecord);
    return records.length === payload.records.length ? records : [];
  }

  const records = payload.records.filter(isAdministratorRecord);
  return records.length === payload.records.length ? records : [];
}
