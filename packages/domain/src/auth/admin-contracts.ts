import type { AcademyId } from "../identifiers";
import { err, ok } from "../result";
import type { Result } from "../result";
import type { ValidationIssue } from "../errors";
import { administrativeRoles, userRoles } from "../actor-context";
import type { UserRole } from "../actor-context";

export type AdminRole = (typeof administrativeRoles)[number];

export type UserClaims = Readonly<{
  academyId: AcademyId;
  role: UserRole;
}>;

export type AdminClaims = Readonly<{
  academyId: AcademyId;
  role: AdminRole;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return { path, code };
}

export function parseUserClaims(value: unknown): Result<UserClaims, ValidationIssue[]> {
  if (!isRecord(value)) {
    return err([issue([], "CLAIMS_MUST_BE_OBJECT")]);
  }

  const keys = Reflect.ownKeys(value);
  const issues: ValidationIssue[] = [];
  if (keys.length !== 2 || !keys.includes("academyId") || !keys.includes("role")) {
    issues.push(issue([], "CLAIMS_UNKNOWN_FIELD"));
  }

  const academyId = value.academyId;
  if (typeof academyId !== "string" || academyId.trim().length === 0) {
    issues.push(issue(["academyId"], "ACADEMY_ID_REQUIRED"));
  }

  const role = value.role;
  if (!userRoles.includes(role as UserRole)) {
    issues.push(issue(["role"], "USER_ROLE_INVALID"));
  }

  if (issues.length > 0) {
    return err(issues);
  }

  return ok(
    Object.freeze({
      academyId: academyId as AcademyId,
      role: role as UserRole,
    }),
  );
}

export function parseAdminClaims(value: unknown): Result<AdminClaims, ValidationIssue[]> {
  const claims = parseUserClaims(value);
  if (!claims.ok) {
    return err(claims.error);
  }
  if (!administrativeRoles.includes(claims.value.role as AdminRole)) {
    return err([issue(["role"], "ADMIN_ROLE_INVALID")]);
  }

  return ok(
    Object.freeze({
      academyId: claims.value.academyId,
      role: claims.value.role as AdminRole,
    }),
  );
}

export function canReadRegyfitAccess(role: UserRole): boolean {
  return administrativeRoles.includes(role as AdminRole);
}

export function canReadRestrictedIp(role: UserRole): boolean {
  return role === "owner";
}
