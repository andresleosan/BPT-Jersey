import { z } from "zod";

import { err, ok, type Result } from "../result";

/**
 * T117: manageable disclaimers and their acceptance per participant.
 *
 * This is deliberately not the waiver of T090. The waiver is one mandatory document with four fixed
 * clauses that gates enrolment; reusing it would force that fixed shape onto everything else the
 * academy ever needs somebody to read. A disclaimer is freestanding: office writes one, gives it a
 * key, says who it is for and whether it is required, and publishes it.
 *
 * The property that makes "versioned acceptance" mean anything is that **an acceptance is bound to
 * one published version and its content hash**. Accepting v1 is not accepting v2: publishing a new
 * version leaves every prior acceptance in place as history and puts the disclaimer back on the
 * participant's outstanding list. Nothing silently inherits consent across a text change.
 *
 * No disclaimer text ships in this repository. The corpus is empty until office publishes, and the
 * legal wording itself remains blocked by T011.
 */

export const disclaimerAudiences = Object.freeze(["all", "adult", "minor"] as const);
export const disclaimerStatuses = Object.freeze(["published", "superseded", "withdrawn"] as const);
export const disclaimerAcceptanceStatuses = Object.freeze(["accepted", "withdrawn"] as const);
export const participantTypes = Object.freeze(["adult", "minor"] as const);

const keyPattern = /^[a-z][a-z0-9-]{2,47}$/u;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const versionLabelPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const isoDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
/** No escapes here on purpose: a code-point check reads plainly and cannot be mangled. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

const safeIdSchema = z.string().regex(safeIdPattern);
const dateTimeSchema = z
  .string()
  .regex(isoDateTimePattern)
  .refine((value) => !Number.isNaN(Date.parse(value)));
const boundedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim() && !hasControlCharacter(value));

export const disclaimerAudienceSchema = z.enum(disclaimerAudiences);
export const disclaimerStatusSchema = z.enum(disclaimerStatuses);
export const participantTypeSchema = z.enum(participantTypes);

/** What office sends to publish. The identity and the hash are derived, never supplied. */
export const disclaimerPublicationInputSchema = z.strictObject({
  key: z.string().regex(keyPattern),
  versionLabel: z.string().regex(versionLabelPattern),
  title: boundedText(120),
  body: boundedText(20_000),
  audience: disclaimerAudienceSchema,
  required: z.boolean(),
  effectiveAt: dateTimeSchema,
});

export const disclaimerSchema = z.strictObject({
  disclaimerId: safeIdSchema,
  academyId: safeIdSchema,
  key: z.string().regex(keyPattern),
  versionLabel: z.string().regex(versionLabelPattern),
  title: boundedText(120),
  body: boundedText(20_000),
  audience: disclaimerAudienceSchema,
  required: z.boolean(),
  contentHash: z.string().regex(sha256Pattern),
  status: disclaimerStatusSchema,
  effectiveAt: dateTimeSchema,
  publishedAt: dateTimeSchema,
  publishedBy: safeIdSchema,
  supersededBy: safeIdSchema.nullable(),
  withdrawnAt: dateTimeSchema.nullable(),
  schemaVersion: z.literal("1"),
});

export const disclaimerAcceptanceSchema = z
  .strictObject({
    acceptanceId: safeIdSchema,
    academyId: safeIdSchema,
    disclaimerId: safeIdSchema,
    key: z.string().regex(keyPattern),
    versionLabel: z.string().regex(versionLabelPattern),
    /** The hash of the exact text that was accepted, copied at acceptance time. */
    contentHash: z.string().regex(sha256Pattern),
    studentId: safeIdSchema,
    /** Who pressed accept: the adult themselves, or the guardian acting for a minor. */
    acceptedBy: safeIdSchema,
    acceptedAt: dateTimeSchema,
    withdrawnAt: dateTimeSchema.nullable(),
    status: z.enum(disclaimerAcceptanceStatuses),
    schemaVersion: z.literal("1"),
  })
  .superRefine((value, context) => {
    if (value.status === "withdrawn" && value.withdrawnAt === null) {
      context.addIssue({
        code: "custom",
        message: "A withdrawn acceptance requires a timestamp",
        path: ["withdrawnAt"],
      });
    }
    if (value.status === "accepted" && value.withdrawnAt !== null) {
      context.addIssue({
        code: "custom",
        message: "An accepted acceptance cannot carry a withdrawal timestamp",
        path: ["withdrawnAt"],
      });
    }
  });

/** What a participant is shown. It never carries who else accepted anything. */
export const disclaimerProjectionSchema = z.strictObject({
  disclaimerId: safeIdSchema,
  key: z.string().regex(keyPattern),
  versionLabel: z.string().regex(versionLabelPattern),
  title: boundedText(120),
  body: boundedText(20_000),
  required: z.boolean(),
  contentHash: z.string().regex(sha256Pattern),
  effectiveAt: dateTimeSchema,
});

export const outstandingDisclaimerSchema = z.strictObject({
  studentId: safeIdSchema,
  disclaimer: disclaimerProjectionSchema,
  /** Set when the participant accepted an earlier version of the same disclaimer. */
  previouslyAcceptedVersionLabel: z.string().regex(versionLabelPattern).nullable(),
});

export const disclaimerAcceptanceInputSchema = z.strictObject({
  disclaimerId: safeIdSchema,
  studentId: safeIdSchema,
  /** The hash the participant was shown. A mismatch means the text changed under them. */
  contentHash: z.string().regex(sha256Pattern),
});

export const disclaimerWithdrawalInputSchema = z.strictObject({
  acceptanceId: safeIdSchema,
});

export type DisclaimerAudience = z.infer<typeof disclaimerAudienceSchema>;
export type DisclaimerStatus = z.infer<typeof disclaimerStatusSchema>;
export type ParticipantType = z.infer<typeof participantTypeSchema>;
export type DisclaimerPublicationInput = z.infer<typeof disclaimerPublicationInputSchema>;
export type Disclaimer = z.infer<typeof disclaimerSchema>;
export type DisclaimerAcceptance = z.infer<typeof disclaimerAcceptanceSchema>;
export type DisclaimerProjection = z.infer<typeof disclaimerProjectionSchema>;
export type OutstandingDisclaimer = z.infer<typeof outstandingDisclaimerSchema>;
export type DisclaimerAcceptanceInput = z.infer<typeof disclaimerAcceptanceInputSchema>;
export type DisclaimerWithdrawalInput = z.infer<typeof disclaimerWithdrawalInputSchema>;
export type DisclaimerValidationIssue = Readonly<{ path: readonly PropertyKey[]; code: string }>;

function isPlainRecord(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
): Result<T, readonly DisclaimerValidationIssue[]> {
  if (!isPlainRecord(value)) {
    return err(Object.freeze([{ path: Object.freeze([]), code: "invalid_plain_data" }]));
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return err(
      Object.freeze(
        parsed.error.issues.map((issue) =>
          Object.freeze({ path: Object.freeze([...issue.path]), code: issue.code }),
        ),
      ),
    );
  }
  return ok(parsed.data);
}

export const parseDisclaimerPublicationInput = (value: unknown) =>
  parseWithSchema(disclaimerPublicationInputSchema, value);
export const parseDisclaimer = (value: unknown) => parseWithSchema(disclaimerSchema, value);
export const parseDisclaimerAcceptance = (value: unknown) =>
  parseWithSchema(disclaimerAcceptanceSchema, value);
export const parseDisclaimerAcceptanceInput = (value: unknown) =>
  parseWithSchema(disclaimerAcceptanceInputSchema, value);
export const parseDisclaimerWithdrawalInput = (value: unknown) =>
  parseWithSchema(disclaimerWithdrawalInputSchema, value);

/**
 * The exact bytes an acceptance is bound to. Only the fields a reader would notice are included:
 * changing the title or the body produces a different hash, changing the effective date does not
 * ask anybody to read anything again.
 */
export function canonicalizeDisclaimerContent(
  input: Pick<DisclaimerPublicationInput, "key" | "versionLabel" | "title" | "body" | "audience">,
): string {
  return JSON.stringify({
    key: input.key,
    versionLabel: input.versionLabel,
    title: input.title,
    body: input.body,
    audience: input.audience,
  });
}

/** Deterministic identity, so republishing the same label is a conflict rather than a duplicate. */
export function disclaimerId(key: string, versionLabel: string): string {
  return `${key}__${versionLabel}`;
}

export function disclaimerAcceptanceId(disclaimerIdValue: string, studentId: string): string {
  return `${disclaimerIdValue}__${studentId}`;
}

export function isDisclaimerLive(disclaimer: Disclaimer, now: string): boolean {
  if (disclaimer.status !== "published") return false;
  const effectiveMs = Date.parse(disclaimer.effectiveAt);
  const nowMs = Date.parse(now);
  // An unreadable date is treated as not yet live: nobody is asked to accept something undated.
  if (Number.isNaN(effectiveMs) || Number.isNaN(nowMs)) return false;
  return effectiveMs <= nowMs;
}

export function appliesToParticipant(
  disclaimer: Pick<Disclaimer, "audience">,
  participantType: ParticipantType,
): boolean {
  return disclaimer.audience === "all" || disclaimer.audience === participantType;
}

export function toDisclaimerProjection(disclaimer: Disclaimer): DisclaimerProjection {
  return disclaimerProjectionSchema.parse({
    disclaimerId: disclaimer.disclaimerId,
    key: disclaimer.key,
    versionLabel: disclaimer.versionLabel,
    title: disclaimer.title,
    body: disclaimer.body,
    required: disclaimer.required,
    contentHash: disclaimer.contentHash,
    effectiveAt: disclaimer.effectiveAt,
  });
}

/**
 * What this participant still has to read. A disclaimer is outstanding when it is live, applies to
 * them, and they hold no live acceptance of THIS version. An acceptance of an earlier version is
 * reported alongside rather than hidden: the participant is being asked again because the text
 * changed, and saying so is the difference between a re-consent and a nag.
 */
export function deriveOutstandingDisclaimers(input: {
  disclaimers: readonly Disclaimer[];
  acceptances: readonly DisclaimerAcceptance[];
  studentId: string;
  participantType: ParticipantType;
  now: string;
}): readonly OutstandingDisclaimer[] {
  const live = input.acceptances.filter(
    (acceptance) => acceptance.studentId === input.studentId && acceptance.status === "accepted",
  );
  const acceptedIds = new Set(live.map((acceptance) => acceptance.disclaimerId));
  const acceptedLabelByKey = new Map(live.map((a) => [a.key, a.versionLabel] as const));

  const outstanding = input.disclaimers
    .filter(
      (disclaimer) =>
        isDisclaimerLive(disclaimer, input.now) &&
        appliesToParticipant(disclaimer, input.participantType) &&
        !acceptedIds.has(disclaimer.disclaimerId),
    )
    .map((disclaimer) =>
      Object.freeze({
        studentId: input.studentId,
        disclaimer: toDisclaimerProjection(disclaimer),
        previouslyAcceptedVersionLabel: acceptedLabelByKey.get(disclaimer.key) ?? null,
      }),
    );

  // Required first, then oldest effective date: what blocks the most comes first.
  return Object.freeze(
    [...outstanding].sort(
      (left, right) =>
        Number(right.disclaimer.required) - Number(left.disclaimer.required) ||
        left.disclaimer.effectiveAt.localeCompare(right.disclaimer.effectiveAt) ||
        left.disclaimer.key.localeCompare(right.disclaimer.key),
    ),
  );
}
