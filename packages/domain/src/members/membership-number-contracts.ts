import { z } from "zod";

import { err, ok, type Result } from "../result";

export const membershipNumberIssues = Object.freeze(["invalid_format", "out_of_range"] as const);
export type MembershipNumberIssue = (typeof membershipNumberIssues)[number];

/** Canonical visible member numbers are positive decimal strings with at most nine digits. */
export function canonicaliseMembershipNumber(value: string): Result<string, MembershipNumberIssue> {
  if (value.length > 64) return err("invalid_format");
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

export const membershipNumberPlanActions = Object.freeze([
  "already_canonical",
  "canonicalise",
  "reassign",
  "manual_review",
] as const);
export type MembershipNumberPlanAction = (typeof membershipNumberPlanActions)[number];

export const membershipNumberSourceKinds = Object.freeze(["canonical", "legacy"] as const);
export type MembershipNumberSourceKind = (typeof membershipNumberSourceKinds)[number];

const opaqueIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const recordRefSchema = z
  .string()
  .regex(/^(?:studentAdminProfiles|members)\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u, {
    message: "Invalid record reference",
  });
const sourceVersionSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
const canonicalStoredMembershipNumberSchema = z.string().regex(/^[1-9]\d{0,8}$/u);
const utcMillisecondSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => {
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
  });

export const membershipNumberPlanRowSchema = z
  .strictObject({
    recordRef: recordRefSchema,
    sourceKind: z.enum(membershipNumberSourceKinds),
    ownerId: opaqueIdSchema,
    sourceVersion: sourceVersionSchema,
    currentMasked: z.string().regex(/^\*{4}(?:\*{0,3}[1-9]\d{0,3})?$/u),
    action: z.enum(membershipNumberPlanActions),
    proposed: canonicalStoredMembershipNumberSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.action === "manual_review" && value.proposed !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["proposed"],
        message: "Manual review has no proposal",
      });
    }
    if (value.action !== "manual_review" && value.proposed === undefined) {
      context.addIssue({
        code: "custom",
        path: ["proposed"],
        message: "Planned action requires a proposal",
      });
    }
  });

export type MembershipNumberPlanRow = Readonly<z.infer<typeof membershipNumberPlanRowSchema>>;

export const membershipNumberPlanPayloadSchema = z
  .strictObject({
    academyId: opaqueIdSchema,
    generatedAt: utcMillisecondSchema,
    rows: z.array(membershipNumberPlanRowSchema).max(100_000).readonly(),
    schemaVersion: z.literal("1"),
  })
  .readonly();

export type MembershipNumberPlanPayload = Readonly<
  z.infer<typeof membershipNumberPlanPayloadSchema>
>;

export const membershipNumberPlanSchema = z
  .strictObject({
    academyId: opaqueIdSchema,
    generatedAt: utcMillisecondSchema,
    rows: z.array(membershipNumberPlanRowSchema).max(100_000).readonly(),
    schemaVersion: z.literal("1"),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .readonly();

export type MembershipNumberPlan = Readonly<z.infer<typeof membershipNumberPlanSchema>>;
