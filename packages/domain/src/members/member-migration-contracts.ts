import { guardianContactSchema } from "../families/family-contracts";
import { z } from "zod";
import { deriveParticipantType } from "../profiles/profile-contracts";
import {
  adminCreateStudentInputShape,
  normalizeAdministrativeIdentifier,
} from "./member-directory-contracts";

export const MEMBER_MIGRATION_ID = "member-unification-s1-2026-09";

export type LegacyMemberInput = Readonly<{
  memberId: string;
  fullName: string;
  birthDate?: string;
  membershipNumber?: string;
  idCardNumber?: string;
}>;

export type ArchiveRecordInput = Readonly<{
  recordId: string;
  fullName: string;
  birthDate?: string;
  memberNumber?: string;
  idCardNumber?: string;
}>;

export type MemberMigrationCategory = "strong" | "suggested" | "ambiguous" | "none";
export type MemberMigrationCandidateReason = "member-number" | "id-card" | "name-and-birth-date";
export type MinorFlag = boolean | "unknown";

export type MemberMigrationRow = Readonly<{
  legacyMemberId: string;
  category: MemberMigrationCategory;
  candidates: readonly Readonly<{ recordId: string; reason: MemberMigrationCandidateReason }>[];
  isMinor: MinorFlag;
}>;

export type MemberMigrationQueue = Readonly<{
  rows: readonly MemberMigrationRow[];
  archiveOnly: readonly string[];
}>;

export type BuildMemberMigrationQueueInput = Readonly<{
  members: readonly LegacyMemberInput[];
  records: readonly ArchiveRecordInput[];
  decidedMemberIds: ReadonlySet<string>;
  linkedRecordIds: ReadonlySet<string>;
  today: string;
}>;

function strongKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const key = normalizeAdministrativeIdentifier(value);
  return key.length === 0 ? undefined : key;
}

// ponytail: exact normalised equality only; fuzzy matching would be an automatic name match (rule 9).
export function normalizeMemberName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function countBy(values: readonly (string | undefined)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function indexBy(
  records: readonly ArchiveRecordInput[],
  key: (record: ArchiveRecordInput) => string | undefined,
): Map<string, ArchiveRecordInput[]> {
  const index = new Map<string, ArchiveRecordInput[]>();
  for (const record of records) {
    const value = key(record);
    if (value === undefined) continue;
    index.set(value, [...(index.get(value) ?? []), record]);
  }
  return index;
}

function minorFlag(birthDate: string | undefined, today: string): MinorFlag {
  if (birthDate === undefined) return "unknown";
  try {
    return deriveParticipantType(birthDate, today) === "minor";
  } catch {
    return "unknown";
  }
}

export function buildMemberMigrationQueue(
  input: BuildMemberMigrationQueueInput,
): MemberMigrationQueue {
  const open = input.records.filter((record) => !input.linkedRecordIds.has(record.recordId));
  const byNumber = indexBy(open, (record) => strongKey(record.memberNumber));
  const byIdCard = indexBy(open, (record) => strongKey(record.idCardNumber));
  const memberNumbers = countBy(input.members.map((member) => strongKey(member.membershipNumber)));
  const memberIdCards = countBy(input.members.map((member) => strongKey(member.idCardNumber)));
  const offered = new Set<string>();

  const rows = input.members
    .filter((member) => !input.decidedMemberIds.has(member.memberId))
    .map((member): MemberMigrationRow => {
      const number = strongKey(member.membershipNumber);
      const idCard = strongKey(member.idCardNumber);
      const strong = new Map<string, MemberMigrationCandidateReason>();
      for (const record of number === undefined ? [] : (byNumber.get(number) ?? [])) {
        strong.set(record.recordId, "member-number");
      }
      for (const record of idCard === undefined ? [] : (byIdCard.get(idCard) ?? [])) {
        if (!strong.has(record.recordId)) strong.set(record.recordId, "id-card");
      }
      const shared =
        (number !== undefined && (memberNumbers.get(number) ?? 0) > 1) ||
        (idCard !== undefined && (memberIdCards.get(idCard) ?? 0) > 1);

      let category: MemberMigrationCategory;
      let candidates: MemberMigrationRow["candidates"];
      if (strong.size > 0) {
        category = strong.size === 1 && !shared ? "strong" : "ambiguous";
        candidates = [...strong].map(([recordId, reason]) => ({ recordId, reason }));
      } else {
        const name = normalizeMemberName(member.fullName);
        candidates = open
          .filter(
            (record) =>
              member.birthDate !== undefined &&
              record.birthDate === member.birthDate &&
              normalizeMemberName(record.fullName) === name,
          )
          .map((record) => ({ recordId: record.recordId, reason: "name-and-birth-date" as const }));
        category = candidates.length > 0 ? "suggested" : "none";
      }
      candidates.forEach((candidate) => offered.add(candidate.recordId));
      const matchedBirthDate =
        category === "strong"
          ? open.find((record) => record.recordId === candidates[0]?.recordId)?.birthDate
          : undefined;
      return Object.freeze({
        legacyMemberId: member.memberId,
        category,
        candidates: Object.freeze(candidates.map((candidate) => Object.freeze(candidate))),
        isMinor: minorFlag(member.birthDate ?? matchedBirthDate, input.today),
      });
    });

  return Object.freeze({
    rows: Object.freeze(rows),
    archiveOnly: Object.freeze(
      open.map((record) => record.recordId).filter((recordId) => !offered.has(recordId)),
    ),
  });
}

export function maskIdentifier(value: string | undefined): string | undefined {
  return value === undefined ? undefined : `•••${value.slice(-3)}`;
}

const legacyMemberIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/u);
const recordIdSchema = z.string().regex(/^[0-9]{1,12}$/u);
const trainingFields = {
  trainingCenter: z.enum(["Town", "West"]),
  trainingTimePreferences: z
    .array(z.enum(["morning", "afternoon", "evening"]))
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length),
};

export const memberMigrationDecisionInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("link"),
    legacyMemberId: legacyMemberIdSchema,
    recordId: recordIdSchema,
    requestId: z.uuid(),
    ...trainingFields,
  }),
  z.strictObject({
    kind: z.literal("create-unlinked"),
    legacyMemberId: legacyMemberIdSchema,
    requestId: z.uuid(),
    ...trainingFields,
  }),
  z.strictObject({
    kind: z.literal("skip"),
    legacyMemberId: legacyMemberIdSchema,
    reason: z.string().trim().min(3).max(200),
  }),
]);
export type MemberMigrationDecisionInput = z.infer<typeof memberMigrationDecisionInputSchema>;

export const decideMemberMigrationInputSchema = z.strictObject({
  decisions: z.array(memberMigrationDecisionInputSchema).min(1).max(50),
});

export const memberMigrationRejectionCodes = [
  "unknown-member",
  "already-decided",
  "not-a-candidate",
  "record-already-linked",
  "identifier-reserved",
  "invalid-member-data",
  "identity-changed",
  "write-failed",
] as const;
export type MemberMigrationRejectionCode = (typeof memberMigrationRejectionCodes)[number];

export const decideMemberMigrationResultSchema = z.strictObject({
  results: z.array(
    z.discriminatedUnion("status", [
      z.strictObject({
        legacyMemberId: legacyMemberIdSchema,
        status: z.literal("applied"),
        studentId: z.string().min(1).optional(),
      }),
      z.strictObject({
        legacyMemberId: legacyMemberIdSchema,
        status: z.literal("rejected"),
        code: z.enum(memberMigrationRejectionCodes),
      }),
    ]),
  ),
});
export type DecideMemberMigrationResult = z.infer<typeof decideMemberMigrationResultSchema>;

export const memberMigrationDecisionRecordSchema = z.strictObject({
  legacyMemberId: legacyMemberIdSchema,
  academyId: z.string().min(1),
  migrationId: z.literal(MEMBER_MIGRATION_ID),
  kind: z.enum(["link", "create-unlinked", "skip"]),
  recordId: recordIdSchema.optional(),
  studentId: z.string().min(1).optional(),
  reason: z.string().min(3).max(200).optional(),
  trainingCenter: z.enum(["Town", "West"]).optional(),
  trainingTimePreferences: z.array(z.enum(["morning", "afternoon", "evening"])).optional(),
  decidedAt: z.string().min(1),
  decidedBy: z.string().min(1),
  schemaVersion: z.literal("1"),
});
export type MemberMigrationDecisionRecord = z.infer<typeof memberMigrationDecisionRecordSchema>;

const sideSchema = z.strictObject({
  fullName: z.string(),
  birthDate: z.string().optional(),
  memberNumberMasked: z.string().optional(),
  idCardMasked: z.string().optional(),
});
export const memberMigrationQueueResponseSchema = z.strictObject({
  rows: z.array(
    z.strictObject({
      legacyMemberId: legacyMemberIdSchema,
      category: z.enum(["strong", "suggested", "ambiguous", "none"]),
      isMinor: z.union([z.boolean(), z.literal("unknown")]),
      member: sideSchema,
      candidates: z.array(
        z.strictObject({
          recordId: recordIdSchema,
          reason: z.enum(["member-number", "id-card", "name-and-birth-date"]),
          record: sideSchema,
        }),
      ),
    }),
  ),
  archiveOnly: z.number().int().min(0),
  decided: z.number().int().min(0),
});
export type MemberMigrationQueueResponse = z.infer<typeof memberMigrationQueueResponseSchema>;

export function toMemberMigrationQueueResponse(
  queue: MemberMigrationQueue,
  members: readonly LegacyMemberInput[],
  records: readonly ArchiveRecordInput[],
  decided: number,
): MemberMigrationQueueResponse {
  const memberById = new Map(members.map((member) => [member.memberId, member]));
  const recordById = new Map(records.map((record) => [record.recordId, record]));
  const side = (value: LegacyMemberInput | ArchiveRecordInput) => ({
    fullName: value.fullName,
    ...(value.birthDate === undefined ? {} : { birthDate: value.birthDate }),
    ...("membershipNumber" in value && value.membershipNumber !== undefined
      ? { memberNumberMasked: maskIdentifier(value.membershipNumber) }
      : {}),
    ...("memberNumber" in value && value.memberNumber !== undefined
      ? { memberNumberMasked: maskIdentifier(value.memberNumber) }
      : {}),
    ...(value.idCardNumber === undefined
      ? {}
      : { idCardMasked: maskIdentifier(value.idCardNumber) }),
  });
  return {
    rows: queue.rows.flatMap((row) => {
      const member = memberById.get(row.legacyMemberId);
      if (member === undefined) return [];
      return [
        {
          legacyMemberId: row.legacyMemberId,
          category: row.category,
          isMinor: row.isMinor,
          member: side(member),
          candidates: row.candidates.flatMap((candidate) => {
            const record = recordById.get(candidate.recordId);
            return record === undefined
              ? []
              : [{ recordId: candidate.recordId, reason: candidate.reason, record: side(record) }];
          }),
        },
      ];
    }),
    archiveOnly: queue.archiveOnly.length,
    decided,
  };
}

/** S1 alone permits an absent birth date; the student writer records a review flag. */
export const legacyStudentInputSchema = z.strictObject({
  ...adminCreateStudentInputShape,
  dateOfBirth: adminCreateStudentInputShape.dateOfBirth.optional(),
});
export type LegacyStudentInput = z.infer<typeof legacyStudentInputSchema>;

const reviewInputFields = {
  studentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  requestId: z.uuid(),
};
export const assignMemberGuardianInputSchema = z.strictObject({
  ...reviewInputFields,
  guardianContact: guardianContactSchema,
});
export const setMemberDateOfBirthInputSchema = z.strictObject({
  ...reviewInputFields,
  dateOfBirth: adminCreateStudentInputShape.dateOfBirth,
});
export const memberReviewInputSchema = z.discriminatedUnion("kind", [
  assignMemberGuardianInputSchema.extend({ kind: z.literal("assign-guardian") }),
  setMemberDateOfBirthInputSchema.extend({ kind: z.literal("set-date-of-birth") }),
]);
export const memberReviewResultSchema = z.strictObject({ studentId: reviewInputFields.studentId });
