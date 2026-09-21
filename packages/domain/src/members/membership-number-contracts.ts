import { z } from "zod";

import { err, ok, type Result } from "../result";

export const membershipNumberIssues = Object.freeze(["invalid_format", "out_of_range"] as const);
export type MembershipNumberIssue = (typeof membershipNumberIssues)[number];

/** Canonical visible member numbers are positive decimal strings with at most nine digits. */
export function canonicaliseMembershipNumber(value: string): Result<string, MembershipNumberIssue> {
  const digits = value.trim().replace(/^#/u, "");
  if (!/^\d+$/u.test(digits)) return err("invalid_format");
  const canonical = digits.replace(/^0+(?=\d)/u, "");
  if (!/^[1-9]\d{0,8}$/u.test(canonical)) return err("out_of_range");
  return ok(canonical);
}

export const canonicalMembershipNumberSchema = z
  .string()
  .max(64)
  .transform((value, context) => {
    const result = canonicaliseMembershipNumber(value);
    if (result.ok) return result.value;
    context.addIssue({
      code: "custom",
      message:
        result.error === "invalid_format"
          ? "Membership number must contain decimal digits only"
          : "Membership number must be between 1 and 999999999",
    });
    return z.NEVER;
  });

export function nextMonotonicMembershipNumber(values: readonly (string | undefined)[]): string {
  let highest = 0;
  for (const value of values) {
    if (value === undefined) continue;
    const result = canonicaliseMembershipNumber(value);
    if (result.ok) highest = Math.max(highest, Number(result.value));
  }
  if (highest >= 999_999_999) throw new RangeError("Membership number sequence is exhausted");
  return String(highest + 1);
}
