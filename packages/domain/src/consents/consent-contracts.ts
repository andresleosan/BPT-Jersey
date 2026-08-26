import { z } from "zod";

import { err, ok, type Result } from "../result";

export const waiverClauseKeys = Object.freeze([
  "photoVideo",
  "medicalTreatment",
  "hygiene",
  "dataProtection",
] as const);
export const waiverClauseResponses = Object.freeze(["accepted", "declined"] as const);
export const waiverVersionStatuses = Object.freeze([
  "published",
  "superseded",
  "withdrawn",
] as const);
export const consentStatuses = Object.freeze(["accepted", "revoked"] as const);

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const versionLabelPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const isoDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

const safeIdSchema = z.string().regex(safeIdPattern);
const hashSchema = z.string().regex(sha256Pattern);
const dateTimeSchema = z
  .string()
  .regex(isoDateTimePattern)
  .refine((value) => !Number.isNaN(Date.parse(value)));
const boundedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim() && !controlCharacterPattern.test(value));

export const waiverClauseKeySchema = z.enum(waiverClauseKeys);
export const waiverClauseResponseSchema = z.enum(waiverClauseResponses);
export const waiverVersionStatusSchema = z.enum(waiverVersionStatuses);
export const consentStatusSchema = z.enum(consentStatuses);

export const waiverClauseSchema = z.strictObject({
  key: waiverClauseKeySchema,
  heading: boundedText(120),
  body: boundedText(6_000),
  required: z.boolean(),
});

const orderedClausesSchema = z
  .array(waiverClauseSchema)
  .length(waiverClauseKeys.length)
  .superRefine((clauses, context) => {
    waiverClauseKeys.forEach((key, index) => {
      if (clauses[index]?.key !== key)
        context.addIssue({
          code: "custom",
          message: "Waiver clauses must use the fixed order",
          path: [index, "key"],
        });
    });
  })
  .readonly();

export const waiverPublicationInputSchema = z.strictObject({
  versionLabel: z.string().regex(versionLabelPattern),
  title: boundedText(160),
  introduction: boundedText(4_000),
  clauses: orderedClausesSchema,
  effectiveAt: dateTimeSchema,
  confirmReviewed: z.literal(true),
});

const waiverVersionBaseSchema = z.strictObject({
  waiverVersionId: safeIdSchema,
  academyId: safeIdSchema,
  versionLabel: z.string().regex(versionLabelPattern),
  title: boundedText(160),
  introduction: boundedText(4_000),
  clauses: orderedClausesSchema,
  contentHash: hashSchema,
  effectiveAt: dateTimeSchema,
  status: waiverVersionStatusSchema,
  supersededAt: dateTimeSchema.nullable(),
  schemaVersion: z.literal("1"),
  createdAt: dateTimeSchema,
  createdBy: safeIdSchema,
  updatedAt: dateTimeSchema,
  updatedBy: safeIdSchema,
});
export const waiverVersionSchema = waiverVersionBaseSchema.superRefine((value, context) => {
  if (value.status === "published" && value.supersededAt !== null)
    context.addIssue({
      code: "custom",
      message: "Published waiver cannot be retired",
      path: ["supersededAt"],
    });
  if (value.status !== "published" && value.supersededAt === null)
    context.addIssue({
      code: "custom",
      message: "Retired waiver requires a timestamp",
      path: ["supersededAt"],
    });
});

export const clauseResponsesSchema = z.strictObject({
  photoVideo: waiverClauseResponseSchema,
  medicalTreatment: waiverClauseResponseSchema,
  hygiene: waiverClauseResponseSchema,
  dataProtection: waiverClauseResponseSchema,
});

export const waiverAcceptanceInputSchema = z.strictObject({
  studentId: safeIdSchema,
  waiverVersionId: safeIdSchema,
  contentHash: hashSchema,
  typedName: boundedText(160),
  clauseResponses: clauseResponsesSchema,
});

const consentRecordBaseSchema = z.strictObject({
  consentId: safeIdSchema,
  academyId: safeIdSchema,
  subjectType: z.enum(["adult", "minor"]),
  subjectId: safeIdSchema,
  waiverVersionId: safeIdSchema,
  versionLabel: z.string().regex(versionLabelPattern),
  waiverContentHash: hashSchema,
  signedBy: safeIdSchema,
  signatureMethod: z.literal("authenticated_typed_name"),
  clauseResponses: clauseResponsesSchema,
  signedAt: dateTimeSchema,
  revokedAt: dateTimeSchema.nullable(),
  evidenceDocumentId: safeIdSchema,
  status: consentStatusSchema,
  schemaVersion: z.literal("1"),
  createdAt: dateTimeSchema,
  createdBy: safeIdSchema,
  updatedAt: dateTimeSchema,
  updatedBy: safeIdSchema,
});
export const consentRecordSchema = consentRecordBaseSchema.superRefine((value, context) => {
  if (value.status === "accepted" && value.revokedAt !== null)
    context.addIssue({
      code: "custom",
      message: "Accepted consent cannot be revoked",
      path: ["revokedAt"],
    });
  if (value.status === "revoked" && value.revokedAt === null)
    context.addIssue({
      code: "custom",
      message: "Revoked consent requires a timestamp",
      path: ["revokedAt"],
    });
});

export const waiverVersionProjectionSchema = waiverVersionBaseSchema.pick({
  waiverVersionId: true,
  versionLabel: true,
  title: true,
  introduction: true,
  clauses: true,
  contentHash: true,
  effectiveAt: true,
  schemaVersion: true,
});

export const consentProjectionSchema = consentRecordBaseSchema
  .pick({
    consentId: true,
    waiverVersionId: true,
    versionLabel: true,
    clauseResponses: true,
    signedAt: true,
    revokedAt: true,
    evidenceDocumentId: true,
    status: true,
    schemaVersion: true,
  })
  .extend({ studentId: safeIdSchema });

export const waiverSubjectProjectionSchema = z.strictObject({
  studentId: safeIdSchema,
  displayName: boundedText(160),
  participantType: z.enum(["adult", "minor"]),
  consent: consentProjectionSchema.nullable(),
});

export const waiverRegistrationProjectionSchema = z.strictObject({
  currentVersion: waiverVersionProjectionSchema.nullable(),
  subjects: z.array(waiverSubjectProjectionSchema).max(100),
});
export const consentIdInputSchema = z.strictObject({ consentId: safeIdSchema });
export const waiverVersionIdInputSchema = z.strictObject({ waiverVersionId: safeIdSchema });
export const waiverEvidenceDownloadSchema = z.strictObject({
  consent: consentProjectionSchema,
  downloadUrl: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:"),
  expiresAt: dateTimeSchema,
});

export type WaiverClauseKey = z.infer<typeof waiverClauseKeySchema>;
export type WaiverClauseResponse = z.infer<typeof waiverClauseResponseSchema>;
export type WaiverClause = z.infer<typeof waiverClauseSchema>;
export type WaiverPublicationInput = z.infer<typeof waiverPublicationInputSchema>;
export type WaiverVersion = z.infer<typeof waiverVersionSchema>;
export type WaiverVersionProjection = z.infer<typeof waiverVersionProjectionSchema>;
export type WaiverAcceptanceInput = z.infer<typeof waiverAcceptanceInputSchema>;
export type ClauseResponses = z.infer<typeof clauseResponsesSchema>;
export type ConsentRecord = z.infer<typeof consentRecordSchema>;
export type ConsentProjection = z.infer<typeof consentProjectionSchema>;
export type WaiverSubjectProjection = z.infer<typeof waiverSubjectProjectionSchema>;
export type WaiverRegistrationProjection = z.infer<typeof waiverRegistrationProjectionSchema>;
export type WaiverEvidenceDownload = z.infer<typeof waiverEvidenceDownloadSchema>;
export type ConsentValidationIssue = Readonly<{ path: readonly PropertyKey[]; code: string }>;

function isPlainData(value: unknown, depth = 0): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return true;
  if (depth > 8 || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes("length")) return false;
    for (let index = 0; index < value.length; index += 1)
      if (!Object.hasOwn(value, index) || !isPlainData(value[index], depth + 1)) return false;
    return true;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      descriptor.get ||
      descriptor.set ||
      !Object.hasOwn(descriptor, "value")
    )
      return false;
    if (!isPlainData(descriptor.value, depth + 1)) return false;
  }
  return true;
}

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
): Result<T, readonly ConsentValidationIssue[]> {
  if (!isPlainData(value))
    return err(Object.freeze([{ path: Object.freeze([]), code: "invalid_plain_data" }]));
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    return err(
      Object.freeze(
        parsed.error.issues.map((issue) =>
          Object.freeze({ path: Object.freeze([...issue.path]), code: issue.code }),
        ),
      ),
    );
  return ok(parsed.data);
}

export const parseWaiverPublicationInput = (value: unknown) =>
  parseWithSchema(waiverPublicationInputSchema, value);
export const parseWaiverAcceptanceInput = (value: unknown) =>
  parseWithSchema(waiverAcceptanceInputSchema, value);
export const parseWaiverVersion = (value: unknown) => parseWithSchema(waiverVersionSchema, value);
export const parseConsentRecord = (value: unknown) => parseWithSchema(consentRecordSchema, value);
export const parseWaiverRegistrationProjection = (value: unknown) =>
  parseWithSchema(waiverRegistrationProjectionSchema, value);
export const parseConsentIdInput = (value: unknown) => parseWithSchema(consentIdInputSchema, value);
export const parseWaiverVersionIdInput = (value: unknown) =>
  parseWithSchema(waiverVersionIdInputSchema, value);
export const parseWaiverEvidenceDownload = (value: unknown) =>
  parseWithSchema(waiverEvidenceDownloadSchema, value);

export function canonicalizeWaiverContent(input: WaiverPublicationInput): string {
  return JSON.stringify({
    versionLabel: input.versionLabel,
    title: input.title,
    introduction: input.introduction,
    clauses: input.clauses.map(({ key, heading, body, required }) => ({
      key,
      heading,
      body,
      required,
    })),
    effectiveAt: input.effectiveAt,
  });
}

export function toWaiverVersionProjection(version: WaiverVersion): WaiverVersionProjection {
  return waiverVersionProjectionSchema.parse({
    waiverVersionId: version.waiverVersionId,
    versionLabel: version.versionLabel,
    title: version.title,
    introduction: version.introduction,
    clauses: version.clauses,
    contentHash: version.contentHash,
    effectiveAt: version.effectiveAt,
    schemaVersion: version.schemaVersion,
  });
}

export function toConsentProjection(consent: ConsentRecord): ConsentProjection {
  return consentProjectionSchema.parse({
    consentId: consent.consentId,
    studentId: consent.subjectId,
    waiverVersionId: consent.waiverVersionId,
    versionLabel: consent.versionLabel,
    clauseResponses: consent.clauseResponses,
    signedAt: consent.signedAt,
    revokedAt: consent.revokedAt,
    evidenceDocumentId: consent.evidenceDocumentId,
    status: consent.status,
    schemaVersion: consent.schemaVersion,
  });
}
