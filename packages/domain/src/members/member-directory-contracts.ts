import { z } from "zod";

import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";
import { memberGenders } from "./member-contracts";
import {
  deriveParticipantType,
  participantTypes,
  trainingCenters,
  trainingTimePreferences,
} from "../profiles/profile-contracts";

export const studentAdminProfileSources = Object.freeze([
  "admin",
  "member-pdf-import",
  "legacy-member-migration",
] as const);

export const adminDirectoryReadPurposes = Object.freeze([
  "member-identity-lookup",
  "member-record-maintenance",
] as const);

export const publicAdminIdentifierLookupKinds = Object.freeze([
  "membership-number",
  "id-card-number",
  "vat-number",
] as const);

export const memberDirectoryReaderVersions = Object.freeze([
  "legacy-v1",
  "canonical-v1",
  "legacy-rollback-v1",
] as const);

export const memberDirectoryWriteModes = Object.freeze([
  "legacy-v1",
  "canonical-v1",
  "blocked",
] as const);

export const memberDirectoryFreezeStatuses = Object.freeze(["open", "frozen"] as const);

export const memberDirectoryOperationPhases = Object.freeze([
  "idle",
  "bootstrap",
  "identity-reconcile",
  "forward",
  "compensation",
  "rollback-projection",
  "rollback-readonly",
  "canonical-recovery",
  "restore-prepared",
  "restore-recovery",
  "restore-rehearsal-complete",
] as const);

const profileStatuses = ["active", "inactive", "suspended"] as const;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const administrativeIdentifierPattern = /^[A-Z0-9][A-Z0-9 ./-]{0,63}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const utcMillisecondDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function isCanonicalText(value: string): boolean {
  return value === value.trim() && !controlCharacterPattern.test(value);
}

function isCalendarDate(value: string): boolean {
  if (!dateOnlyPattern.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function isUtcMillisecondDateTime(value: string): boolean {
  if (!utcMillisecondDateTimePattern.test(value)) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

const opaqueIdentifierSchema = z.string().regex(identifierPattern);
const administrativeIdentifierSchema = z.string().regex(administrativeIdentifierPattern);
const canonicalText = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine(isCanonicalText, { message: "Text must be trimmed and contain no control characters" });
const dateOnlySchema = z.string().refine(isCalendarDate, { message: "Invalid calendar date" });
const auditDateTimeSchema = z
  .string()
  .refine(isUtcMillisecondDateTime, { message: "Invalid UTC millisecond timestamp" });

// T106 step 1: the official waiver form captures an emergency contact and a postal address at
// enrolment. Both are Confidential, optional, live only in the Restricted admin profile and are
// projected exclusively through the purpose-bound maintenance detail (never in general rows).
export const emergencyContactSchema = z
  .strictObject({
    fullName: canonicalText(160),
    relationship: canonicalText(64),
    phoneNumber: canonicalText(64),
    alternatePhoneNumber: canonicalText(64).optional(),
  })
  .readonly();

export type EmergencyContact = Readonly<z.infer<typeof emergencyContactSchema>>;

export const postalAddressSchema = z
  .strictObject({
    line: canonicalText(240),
    postCode: canonicalText(16),
  })
  .readonly();

export type PostalAddress = Readonly<z.infer<typeof postalAddressSchema>>;

const studentAdminProfileBaseShape = {
  studentId: opaqueIdentifierSchema,
  academyId: opaqueIdentifierSchema,
  membershipNumber: administrativeIdentifierSchema.optional(),
  idCardNumber: administrativeIdentifierSchema.optional(),
  vatNumber: administrativeIdentifierSchema.optional(),
  gender: z.enum(memberGenders),
  frequencyNote: canonicalText(256).optional(),
  emergencyContact: emergencyContactSchema.optional(),
  postalAddress: postalAddressSchema.optional(),
  schemaVersion: z.literal("1"),
  createdAt: auditDateTimeSchema,
  createdBy: opaqueIdentifierSchema,
  updatedAt: auditDateTimeSchema,
  updatedBy: opaqueIdentifierSchema,
} as const;

const adminStudentProfileSchema = z.strictObject({
  ...studentAdminProfileBaseShape,
  source: z.literal("admin"),
});

const pdfImportStudentProfileSchema = z.strictObject({
  ...studentAdminProfileBaseShape,
  source: z.literal("member-pdf-import"),
  importRunId: opaqueIdentifierSchema,
});

const legacyMigrationStudentProfileSchema = z.strictObject({
  ...studentAdminProfileBaseShape,
  source: z.literal("legacy-member-migration"),
  migrationId: opaqueIdentifierSchema,
  legacyMemberId: administrativeIdentifierSchema,
  importRunId: opaqueIdentifierSchema.optional(),
});

export const studentAdminProfileSchema = z.discriminatedUnion("source", [
  adminStudentProfileSchema,
  pdfImportStudentProfileSchema,
  legacyMigrationStudentProfileSchema,
]);

export type StudentAdminProfile = Readonly<z.infer<typeof studentAdminProfileSchema>>;
export type StudentAdminProfileSource = (typeof studentAdminProfileSources)[number];
export type AdminDirectoryReadPurpose = (typeof adminDirectoryReadPurposes)[number];
export type PublicAdminIdentifierLookupKind = (typeof publicAdminIdentifierLookupKinds)[number];

const activeDirectoryPhases = new Set<(typeof memberDirectoryOperationPhases)[number]>([
  "bootstrap",
  "identity-reconcile",
  "forward",
  "compensation",
  "rollback-projection",
  "canonical-recovery",
  "restore-recovery",
]);

const validDirectoryStateTuples = new Set([
  "legacy-v1|legacy-v1|open|idle|false",
  "legacy-v1|blocked|frozen|bootstrap|false",
  "legacy-v1|blocked|frozen|forward|false",
  "legacy-v1|blocked|frozen|compensation|false",
  "canonical-v1|canonical-v1|open|idle|false",
  "canonical-v1|canonical-v1|open|idle|true",
  "canonical-v1|blocked|frozen|identity-reconcile|false",
  "canonical-v1|blocked|frozen|identity-reconcile|true",
  "canonical-v1|blocked|frozen|rollback-projection|false",
  "legacy-rollback-v1|blocked|frozen|rollback-readonly|false",
  "legacy-rollback-v1|blocked|frozen|canonical-recovery|false",
  "canonical-v1|blocked|frozen|restore-prepared|false",
  "canonical-v1|blocked|frozen|restore-prepared|true",
  "canonical-v1|blocked|frozen|restore-recovery|false",
  "canonical-v1|blocked|frozen|restore-recovery|true",
  "canonical-v1|blocked|frozen|restore-rehearsal-complete|false",
  "canonical-v1|blocked|frozen|restore-rehearsal-complete|true",
]);

export const memberDirectoryStateSchema = z
  .strictObject({
    stateId: z.literal("current"),
    academyId: opaqueIdentifierSchema,
    readerVersion: z.enum(memberDirectoryReaderVersions),
    directoryWriteMode: z.enum(memberDirectoryWriteModes),
    freezeStatus: z.enum(memberDirectoryFreezeStatuses),
    stateRevision: z.number().int().nonnegative().safe(),
    globalLegacyReadEliminated: z.boolean(),
    identityKeyCoverage: z.enum(["incomplete", "complete"]),
    digestVersion: z.literal("hmac-sha256-v1"),
    secretVersion: opaqueIdentifierSchema,
    identityKeyBaselineMac: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    identityKeyBaselineArtifactId: opaqueIdentifierSchema.optional(),
    rollbackProtocolVersion: z.enum(["legacy-projection-v1", "disabled"]),
    rollbackCapacityLimit: z.literal(400),
    rollbackEligibleStudentCount: z.number().int().nonnegative().max(400).safe(),
    operationPhase: z.enum(memberDirectoryOperationPhases),
    lastCommittedChunkNo: z.number().int().nonnegative().safe(),
    activeOperationId: opaqueIdentifierSchema.optional(),
    leaseId: opaqueIdentifierSchema.optional(),
    leaseOwner: opaqueIdentifierSchema.optional(),
    leaseExpiresAt: auditDateTimeSchema.optional(),
    operationDeadline: auditDateTimeSchema.optional(),
    preparedOperationId: opaqueIdentifierSchema.optional(),
    schemaVersion: z.literal("1"),
    createdAt: auditDateTimeSchema,
    createdBy: opaqueIdentifierSchema,
    updatedAt: auditDateTimeSchema,
    updatedBy: opaqueIdentifierSchema,
  })
  .superRefine((state, context) => {
    const tuple = [
      state.readerVersion,
      state.directoryWriteMode,
      state.freezeStatus,
      state.operationPhase,
      String(state.globalLegacyReadEliminated),
    ].join("|");
    if (!validDirectoryStateTuples.has(tuple)) {
      context.addIssue({
        code: "custom",
        path: ["operationPhase"],
        message: "Invalid member directory state tuple",
      });
    }

    const requiredProtocol = state.globalLegacyReadEliminated ? "disabled" : "legacy-projection-v1";
    if (state.rollbackProtocolVersion !== requiredProtocol) {
      context.addIssue({
        code: "custom",
        path: ["rollbackProtocolVersion"],
        message: "Rollback protocol does not match the global legacy marker",
      });
    }

    const baselineFields = [state.identityKeyBaselineMac, state.identityKeyBaselineArtifactId];
    const mustHaveBaseline = state.identityKeyCoverage === "complete";
    const hasCompleteBaseline = baselineFields.every((field) => field !== undefined);
    const hasAnyBaseline = baselineFields.some((field) => field !== undefined);
    if ((mustHaveBaseline && !hasCompleteBaseline) || (!mustHaveBaseline && hasAnyBaseline)) {
      context.addIssue({
        code: "custom",
        path: ["identityKeyCoverage"],
        message: "Identity baseline fields do not match coverage",
      });
    }

    const coordinationFields = [
      state.activeOperationId,
      state.leaseId,
      state.leaseOwner,
      state.leaseExpiresAt,
      state.operationDeadline,
    ];
    const isActive = activeDirectoryPhases.has(state.operationPhase);
    const hasCompleteCoordination = coordinationFields.every((field) => field !== undefined);
    const hasAnyCoordination = coordinationFields.some((field) => field !== undefined);
    if ((isActive && !hasCompleteCoordination) || (!isActive && hasAnyCoordination)) {
      context.addIssue({
        code: "custom",
        path: ["activeOperationId"],
        message: "Invalid active-operation coordination envelope",
      });
    }

    const isRestorePrepared = state.operationPhase === "restore-prepared";
    if (
      (isRestorePrepared && state.preparedOperationId === undefined) ||
      (!isRestorePrepared && state.preparedOperationId !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["preparedOperationId"],
        message: "preparedOperationId is reserved for restore-prepared",
      });
    }

    if (!isActive && state.lastCommittedChunkNo !== 0) {
      context.addIssue({
        code: "custom",
        path: ["lastCommittedChunkNo"],
        message: "Stable directory states must have chunk zero",
      });
    }
  });

export type MemberDirectoryState = Readonly<z.infer<typeof memberDirectoryStateSchema>>;

const studentDirectoryShape = {
  studentId: opaqueIdentifierSchema,
  fullName: canonicalText(160),
  trainingCenter: z.enum(trainingCenters),
  participantType: z.enum(participantTypes),
  active: z.boolean(),
  status: z.enum(profileStatuses),
} as const;

export const adminDirectoryRowSchema = z.strictObject({
  ...studentDirectoryShape,
  membershipReference: z
    .string()
    .regex(/^\*{4}.{4}$/u)
    .optional(),
});

export type AdminDirectoryRow = Readonly<z.infer<typeof adminDirectoryRowSchema>>;

export const memberRecordMaintenanceDetailSchema = z.strictObject({
  ...studentDirectoryShape,
  dateOfBirth: dateOnlySchema,
  phoneNumber: canonicalText(64).optional(),
  email: z.string().email().max(320).refine(isCanonicalText).optional(),
  trainingTimePreferences: z.array(z.enum(trainingTimePreferences)).max(3).readonly(),
  membershipNumber: administrativeIdentifierSchema.optional(),
  idCardNumber: administrativeIdentifierSchema.optional(),
  vatNumber: administrativeIdentifierSchema.optional(),
  gender: z.enum(memberGenders),
  frequencyNote: canonicalText(256).optional(),
  emergencyContact: emergencyContactSchema.optional(),
  postalAddress: postalAddressSchema.optional(),
});

export type MemberRecordMaintenanceDetail = Readonly<
  z.infer<typeof memberRecordMaintenanceDetailSchema>
>;

export type StudentDirectorySource = Readonly<{
  studentId: string;
  academyId: string;
  fullName: string;
  dateOfBirth: string;
  phoneNumber?: string;
  email?: string;
  trainingCenter: (typeof trainingCenters)[number];
  trainingTimePreferences: readonly (typeof trainingTimePreferences)[number][];
  participantType: (typeof participantTypes)[number];
  active: boolean;
  status: (typeof profileStatuses)[number];
}>;

export function normalizeAdministrativeIdentifier(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}

const administrativeIdentifierInputSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => !controlCharacterPattern.test(value), {
    message: "Identifier contains control characters",
  })
  .transform(normalizeAdministrativeIdentifier)
  .pipe(administrativeIdentifierSchema);

const createTrainingPreferencesSchema = z
  .array(z.enum(trainingTimePreferences))
  .min(1)
  .max(trainingTimePreferences.length)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Duplicate training time preference",
        });
      }
      seen.add(value);
    });
  })
  .readonly();

export const adminCreateStudentInputSchema = z
  .strictObject({
    requestId: opaqueIdentifierSchema,
    fullName: canonicalText(160),
    dateOfBirth: dateOnlySchema,
    phoneNumber: canonicalText(64).optional(),
    email: z.string().email().max(320).refine(isCanonicalText).optional(),
    trainingCenter: z.enum(trainingCenters),
    trainingTimePreferences: createTrainingPreferencesSchema,
    membershipNumber: administrativeIdentifierInputSchema.optional(),
    idCardNumber: administrativeIdentifierInputSchema.optional(),
    vatNumber: administrativeIdentifierInputSchema.optional(),
    gender: z.enum(memberGenders).optional(),
    frequencyNote: canonicalText(256).optional(),
    emergencyContact: emergencyContactSchema.optional(),
    postalAddress: postalAddressSchema.optional(),
  })
  .readonly();

export type AdminCreateStudentInput = Readonly<z.infer<typeof adminCreateStudentInputSchema>>;

export const adminUpdateStudentInputSchema = z
  .strictObject({
    studentId: opaqueIdentifierSchema,
    requestId: z.string().regex(uuidV4Pattern),
    fullName: canonicalText(160),
    dateOfBirth: dateOnlySchema,
    phoneNumber: canonicalText(64).optional(),
    email: z.string().email().max(320).refine(isCanonicalText).optional(),
    trainingCenter: z.enum(trainingCenters),
    trainingTimePreferences: createTrainingPreferencesSchema,
    membershipNumber: administrativeIdentifierInputSchema.optional(),
    idCardNumber: administrativeIdentifierInputSchema.optional(),
    vatNumber: administrativeIdentifierInputSchema.optional(),
    gender: z.enum(memberGenders),
    frequencyNote: canonicalText(256).optional(),
    emergencyContact: emergencyContactSchema.optional(),
    postalAddress: postalAddressSchema.optional(),
  })
  .readonly();

export type AdminUpdateStudentInput = Readonly<z.infer<typeof adminUpdateStudentInputSchema>>;

function isPlainData(value: unknown, depth = 0): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (depth > 8 || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes("length")) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !isPlainData(value[index], depth + 1)) return false;
    }
    return true;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, "value") ||
      !isPlainData(descriptor.value, depth + 1)
    ) {
      return false;
    }
  }
  return true;
}

function zodIssues(error: z.ZodError): readonly ValidationIssue[] {
  return Object.freeze(
    error.issues.map((issue) =>
      Object.freeze({
        path: Object.freeze(
          issue.path.filter(
            (segment): segment is string | number =>
              typeof segment === "string" || typeof segment === "number",
          ),
        ),
        code: issue.code,
      }),
    ),
  );
}

export function parseAdminCreateStudentInput(
  value: unknown,
  effectiveDate: string,
): Result<AdminCreateStudentInput, readonly ValidationIssue[]> {
  if (!isPlainData(value)) {
    return err(Object.freeze([{ path: Object.freeze([]), code: "invalid_plain_data" }]));
  }
  if (!dateOnlySchema.safeParse(effectiveDate).success) {
    return err(
      Object.freeze([{ path: Object.freeze(["effectiveDate"]), code: "invalid_effective_date" }]),
    );
  }
  const parsed = adminCreateStudentInputSchema.safeParse(value);
  if (!parsed.success) return err(zodIssues(parsed.error));
  try {
    if (deriveParticipantType(parsed.data.dateOfBirth, effectiveDate) !== "adult") {
      return err(
        Object.freeze([
          { path: Object.freeze(["dateOfBirth"]), code: "minor_requires_family_flow" },
        ]),
      );
    }
  } catch {
    return err(
      Object.freeze([{ path: Object.freeze(["dateOfBirth"]), code: "invalid_date_of_birth" }]),
    );
  }
  return ok(parsed.data);
}

export function parseAdminUpdateStudentInput(
  value: unknown,
  effectiveDate: string,
): Result<AdminUpdateStudentInput, readonly ValidationIssue[]> {
  if (!isPlainData(value)) {
    return err(Object.freeze([{ path: Object.freeze([]), code: "invalid_plain_data" }]));
  }
  if (!dateOnlySchema.safeParse(effectiveDate).success) {
    return err(
      Object.freeze([{ path: Object.freeze(["effectiveDate"]), code: "invalid_effective_date" }]),
    );
  }
  const parsed = adminUpdateStudentInputSchema.safeParse(value);
  if (!parsed.success) return err(zodIssues(parsed.error));
  try {
    deriveParticipantType(parsed.data.dateOfBirth, effectiveDate);
  } catch {
    return err(
      Object.freeze([{ path: Object.freeze(["dateOfBirth"]), code: "invalid_date_of_birth" }]),
    );
  }
  return ok(parsed.data);
}

export function maskMembershipReference(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeAdministrativeIdentifier(value);
  return normalized.length < 8 ? undefined : `****${normalized.slice(-4)}`;
}

function assertProjectionBinding(
  student: StudentDirectorySource,
  profile: StudentAdminProfile | undefined,
): void {
  if (
    profile !== undefined &&
    (profile.studentId !== student.studentId || profile.academyId !== student.academyId)
  ) {
    throw new Error("Student admin profile binding mismatch");
  }
}

export function toAdminDirectoryRow(
  student: StudentDirectorySource,
  profile?: StudentAdminProfile,
): AdminDirectoryRow {
  assertProjectionBinding(student, profile);
  const membershipReference = maskMembershipReference(profile?.membershipNumber);
  return Object.freeze({
    studentId: student.studentId,
    fullName: student.fullName,
    trainingCenter: student.trainingCenter,
    participantType: student.participantType,
    active: student.active,
    status: student.status,
    ...(membershipReference === undefined ? {} : { membershipReference }),
  });
}

export function toMemberRecordMaintenanceDetail(
  student: StudentDirectorySource,
  profile: StudentAdminProfile,
): MemberRecordMaintenanceDetail {
  assertProjectionBinding(student, profile);
  return Object.freeze({
    studentId: student.studentId,
    fullName: student.fullName,
    dateOfBirth: student.dateOfBirth,
    ...(student.phoneNumber === undefined ? {} : { phoneNumber: student.phoneNumber }),
    ...(student.email === undefined ? {} : { email: student.email }),
    trainingCenter: student.trainingCenter,
    trainingTimePreferences: Object.freeze([...student.trainingTimePreferences]),
    participantType: student.participantType,
    active: student.active,
    status: student.status,
    ...(profile.membershipNumber === undefined
      ? {}
      : { membershipNumber: profile.membershipNumber }),
    ...(profile.idCardNumber === undefined ? {} : { idCardNumber: profile.idCardNumber }),
    ...(profile.vatNumber === undefined ? {} : { vatNumber: profile.vatNumber }),
    gender: profile.gender,
    ...(profile.frequencyNote === undefined ? {} : { frequencyNote: profile.frequencyNote }),
    ...(profile.emergencyContact === undefined
      ? {}
      : { emergencyContact: Object.freeze({ ...profile.emergencyContact }) }),
    ...(profile.postalAddress === undefined
      ? {}
      : { postalAddress: Object.freeze({ ...profile.postalAddress }) }),
  });
}
