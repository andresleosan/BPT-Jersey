import { parseFamilyRecord, parseFamilyRelationship } from "@bpt-jersey/domain/families";
import { parseMemberRecord, type MemberRecord } from "@bpt-jersey/domain/members";
import {
  normalizeAdministrativeIdentifier,
  studentAdminProfileSchema,
} from "@bpt-jersey/domain/members/directory";
import {
  buildMemberDirectoryChunkId,
  isWriteEligibleClassification,
  type MemberDirectoryDryRunClassification,
} from "@bpt-jersey/domain/members/directory-migration";
import { memberDirectoryMaxRowsPerChunk } from "@bpt-jersey/domain/members/directory-transitions";
import {
  deriveParticipantType,
  parseStudentProfileAt,
  trainingCenters,
  trainingTimePreferences,
  type TrainingCenter,
  type TrainingTimePreference,
} from "@bpt-jersey/domain/profiles";

import type { MemberDirectoryChunkDomainWrite } from "./member-directory-chunk-runner.js";
import {
  buildStudentIdentityKey,
  createMemberDirectoryChunkOutputSetMac,
  createMemberDirectorySourceRowMac,
  constantTimeMacEquals,
  studentIdentityKeySchema,
  type StudentIdentityKey,
  type StudentIdentityKeyKind,
} from "./member-directory-crypto.js";

/**
 * The forward chunk executor (T108) - the largest of the seven and the first that writes real
 * domain documents rather than identity reservations.
 *
 * Like the bootstrap executor it is a pure function over documents that were already read: the
 * runner owns the transaction, the freeze and the control plane, and this owns the question the
 * runner deliberately knows nothing about - which documents this chunk creates and whether it may
 * create them at all.
 *
 * Three rules from `docs/data/migrations/member-directory-v1.md` shape everything below.
 *
 * - **It is additive only.** Every write is a create. Invariant 17 - the forward operation never
 *   deletes or overwrites members - and step 6 - no existing student or profile is overwritten -
 *   leave no case where forward touches a document that already exists.
 * - **It never quarantines.** The confirmation algorithm rejects the whole plan when any row is no
 *   longer eligible, an input changed or a mapping became ambiguous (step 3), and "any conflict
 *   makes the confirmation fail closed; partial best-effort writes are not allowed". So a row this
 *   executor cannot migrate ends the chunk with the freeze standing, rather than being set aside
 *   and counted. `quarantinedCount` stays 0 for the same reason it does in bootstrap.
 * - **Nothing new is invented.** Invariant 9: no Auth users, guardians, families, relationships or
 *   memberships. Invariant 23: a migrated student is created `active=false`/`status=inactive`, and
 *   the legacy membership and payment labels never activate anybody.
 *
 * **Where each field comes from, and why the split is where it is.** Everything the legacy row can
 * answer is derived from the legacy row re-read inside this chunk, so the plan cannot smuggle in a
 * value the source never held. The reviewed row supplies only what the source cannot: the target
 * student ID, the classification and its review, the training-time preferences - which have no
 * legacy counterpart at all, so deriving them would be exactly the silent default invariant 11
 * forbids for the training center - and, for a minor, the family and relationship the review bound.
 * `sourceRowMac` is what ties the two halves together: the reviewed row carries the fingerprint the
 * dry-run saw, and a legacy row that has changed since then fails the chunk instead of migrating a
 * record nobody reviewed.
 */

const studentsPathPrefix = "students";
const adminProfilesPathPrefix = "studentAdminProfiles";
const identityKeyPathPrefix = "studentIdentityKeys";

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * The identifier kinds a forward row reserves. `auth-user-id` is deliberately absent: migration
 * never invents an Auth user (invariant 9), and an existing student's own Auth link was already
 * reserved by the bootstrap whose baseline this operation verified before it started.
 */
const forwardIdentityKinds = Object.freeze([
  "membership-number",
  "id-card-number",
  "vat-number",
  "legacy-member-id",
] as const satisfies readonly StudentIdentityKeyKind[]);

export type MemberDirectoryForwardPlannedRow = Readonly<{
  /** The `members/{legacyMemberId}` document this row migrates. */
  legacyMemberId: string;
  classification: MemberDirectoryDryRunClassification;
  /** True only when a reviewer explicitly cleared a `same-id-compatible` coincidence. */
  explicitlyReviewed: boolean;
  /**
   * The backend-generated opaque ID bound in the reviewed manifest for a create, or the reviewed
   * existing student ID for a match. Never derived from `legacyMemberId` (invariant 28).
   */
  targetStudentId: string;
  /** The fingerprint of the legacy row as the dry-run read it. */
  sourceRowMac: string;
  /** Reviewed, because the legacy record has no equivalent field to derive them from. */
  trainingTimePreferences: readonly TrainingTimePreference[];
  /** Bound by the review for a match against an existing minor, and only then. */
  familyId?: string;
  relationshipId?: string;
}>;

export type MemberDirectoryForwardObservedRow = Readonly<{
  /** The row this observation belongs to, checked against the plan rather than assumed. */
  legacyMemberId: string;
  /** The direct-get of `members/{legacyMemberId}`, re-read inside this chunk. */
  member: unknown;
  /** The direct-get of `students/{targetStudentId}`; undefined when the document is absent. */
  student: unknown;
  /** The direct-get of `studentAdminProfiles/{targetStudentId}`; undefined when absent. */
  profile: unknown;
  /** The family and relationship a minor match names; undefined for every other row. */
  family?: unknown;
  relationship?: unknown;
}>;

export type MemberDirectoryForwardChunkInput = Readonly<{
  academyId: string;
  operationId: string;
  chunkNo: number;
  /** The exact ordered slice of the frozen plan this chunk covers. */
  plannedRows: readonly MemberDirectoryForwardPlannedRow[];
  /** The documents read for those rows, in the same order. */
  observed: readonly MemberDirectoryForwardObservedRow[];
  /** Every `studentIdentityKeys` document read for the expected keys of this chunk. */
  existingKeys: readonly unknown[];
  /**
   * The single server-owned write time the receipt fixed before `planMac`. Every create uses it, so
   * the plan's canonical content MACs can be prebound; a per-document clock read could not be.
   */
  operationWriteTime: string;
  /** The effective date the receipt fixed, from which `participantType` is derived (invariant 12). */
  effectiveDate: string;
  actorId: string;
}>;

export type MemberDirectoryForwardChunkDependencies = Readonly<{
  identitySecretMaterial: string;
  identitySecretVersion: string;
  integritySecretMaterial: string;
}>;

export type MemberDirectoryForwardChunkPlan = Readonly<{
  chunkId: string;
  rowCount: number;
  /** Always zero: forward fails the chunk closed instead of setting a row aside. */
  quarantinedCount: 0;
  createdStudentCount: number;
  createdProfileCount: number;
  createdKeyCount: number;
  domainWrites: readonly MemberDirectoryChunkDomainWrite[];
  outputSetMac: string;
}>;

function forwardFailure(reason: string): never {
  throw new Error(`Member directory forward chunk refused: ${reason}`);
}

function documentPath(academyId: string, collection: string, documentId: string): string {
  return `academies/${academyId}/${collection}/${documentId}`;
}

/**
 * The legacy row, re-read and required to be exactly the record the review saw.
 *
 * The MAC is compared in constant time and covers the stored document, so a changed name, a changed
 * membership number and a changed `updatedAt` are all one failure: the plan describes a record that
 * no longer exists, and confirmation fails closed rather than migrating the newer one.
 */
function parsedMember(
  value: unknown,
  row: MemberDirectoryForwardPlannedRow,
  academyId: string,
  integritySecretMaterial: string,
): MemberRecord {
  if (value === undefined || value === null) {
    forwardFailure(`planned legacy member ${row.legacyMemberId} no longer exists`);
  }
  const parsed = parseMemberRecord(value);
  if (!parsed.ok) {
    forwardFailure(`legacy member ${row.legacyMemberId} is not a valid record`);
  }
  if (parsed.value.memberId !== row.legacyMemberId) {
    forwardFailure(`legacy member ${row.legacyMemberId} does not own the document read for it`);
  }
  if (parsed.value.academyId !== academyId) {
    forwardFailure(`legacy member ${row.legacyMemberId} belongs to another academy`);
  }
  const observedMac = createMemberDirectorySourceRowMac({
    academyId,
    sourceCollection: "members",
    sourceId: parsed.value.memberId,
    document: value,
    secretMaterial: integritySecretMaterial,
  });
  if (!constantTimeMacEquals(observedMac, row.sourceRowMac)) {
    forwardFailure(`legacy member ${row.legacyMemberId} changed since it was reviewed`);
  }
  return parsed.value;
}

/**
 * A legacy administrative value, normalized the one way the whole directory normalizes them.
 *
 * The normalized form is what gets stored as well as what gets digested. Storing the raw value and
 * digesting the normalized one would break the exact-lookup recheck, which recomputes the digest
 * from the value it finds on the profile: the two would disagree and every lookup of a correctly
 * reserved identifier would answer no-match.
 */
function normalizedAdministrativeValue(
  value: string,
  label: string,
  legacyMemberId: string,
): string {
  const normalized = normalizeAdministrativeIdentifier(value);
  if (!/^[A-Z0-9][A-Z0-9 ./-]{0,63}$/u.test(normalized)) {
    forwardFailure(`legacy member ${legacyMemberId} has an unusable ${label}`);
  }
  return normalized;
}

/** The date of birth a student document may carry, taken only when the legacy row is unambiguous. */
function migratedDateOfBirth(member: MemberRecord, effectiveDate: string): string {
  if (member.birthDate === undefined) {
    // Invariant 10. A row with no date of birth is `missing-required-fields` and never eligible;
    // seeing one here means the source changed under a plan that said otherwise.
    forwardFailure(`legacy member ${member.memberId} has no date of birth`);
  }
  if (!dateOnlyPattern.test(member.birthDate)) {
    // A legacy timestamp would need a time zone nobody chose, and truncating it can move somebody
    // across the adult boundary by a day. Refuse rather than pick.
    forwardFailure(`legacy member ${member.memberId} has a date of birth that is not a plain date`);
  }
  if (member.birthDate > effectiveDate) {
    forwardFailure(`legacy member ${member.memberId} has a date of birth after the effective date`);
  }
  return member.birthDate;
}

function migratedTrainingCenter(member: MemberRecord): TrainingCenter {
  // Invariant 11: Town or West only, and no silent default.
  const center = member.trainingCenter;
  if (center === undefined || !trainingCenters.includes(center as TrainingCenter)) {
    forwardFailure(`legacy member ${member.memberId} has no recognised training center`);
  }
  return center as TrainingCenter;
}

function reviewedPreferences(row: MemberDirectoryForwardPlannedRow): readonly string[] {
  const preferences = row.trainingTimePreferences;
  if (
    preferences.length === 0 ||
    new Set(preferences).size !== preferences.length ||
    preferences.some((preference) => !trainingTimePreferences.includes(preference))
  ) {
    forwardFailure(`row ${row.legacyMemberId} has no usable reviewed training time preferences`);
  }
  return Object.freeze([...preferences]);
}

/**
 * The student document a `createable-adult` row creates.
 *
 * It carries no `familyId` and no `userId`: invariant 9 forbids inventing either, and a migrated
 * student that silently claimed one would be a link nobody authorised.
 */
function buildMigratedStudent(
  input: MemberDirectoryForwardChunkInput,
  row: MemberDirectoryForwardPlannedRow,
  member: MemberRecord,
): Readonly<Record<string, unknown>> {
  const dateOfBirth = migratedDateOfBirth(member, input.effectiveDate);
  if (deriveParticipantType(dateOfBirth, input.effectiveDate) !== "adult") {
    // `minor-requires-family-match` is never write-eligible. A plan that says adult over a row that
    // reads minor is exactly the changed input step 3 rejects.
    forwardFailure(`row ${row.legacyMemberId} is not an adult at the effective date`);
  }
  const student = {
    studentId: row.targetStudentId,
    academyId: input.academyId,
    fullName: member.fullName,
    dateOfBirth,
    ...(member.mobileNumber === undefined ? {} : { phoneNumber: member.mobileNumber }),
    ...(member.email === undefined ? {} : { email: member.email }),
    trainingCenter: migratedTrainingCenter(member),
    trainingTimePreferences: reviewedPreferences(row),
    participantType: "adult" as const,
    // Invariant 23. The legacy membership and payment labels never reach this document at all.
    active: false,
    status: "inactive" as const,
    schemaVersion: "1" as const,
    createdAt: input.operationWriteTime,
    createdBy: input.actorId,
    updatedAt: input.operationWriteTime,
    updatedBy: input.actorId,
  };
  const parsed = parseStudentProfileAt(student, input.effectiveDate);
  if (!parsed.ok) {
    forwardFailure(`row ${row.legacyMemberId} does not produce a valid student record`);
  }
  return Object.freeze(student);
}

/**
 * The admin profile every forward row creates, whether the student is new or was matched.
 *
 * `importRunId` is deliberately not carried over from the legacy row. On a `legacy-member-migration`
 * profile that field names the import run that produced the profile, and the run that produced this
 * one is the migration; copying the member PDF import's run ID there would file this profile under
 * a provenance it does not have.
 */
function buildMigratedProfile(
  input: MemberDirectoryForwardChunkInput,
  row: MemberDirectoryForwardPlannedRow,
  member: MemberRecord,
  legacyMemberId: string,
): Readonly<Record<string, unknown>> {
  const profile = {
    studentId: row.targetStudentId,
    academyId: input.academyId,
    ...(member.membershipNumber === undefined
      ? {}
      : {
          membershipNumber: normalizedAdministrativeValue(
            member.membershipNumber,
            "membership number",
            row.legacyMemberId,
          ),
        }),
    ...(member.idCardNumber === undefined
      ? {}
      : {
          idCardNumber: normalizedAdministrativeValue(
            member.idCardNumber,
            "ID card number",
            row.legacyMemberId,
          ),
        }),
    ...(member.vatNumber === undefined
      ? {}
      : {
          vatNumber: normalizedAdministrativeValue(
            member.vatNumber,
            "VAT number",
            row.legacyMemberId,
          ),
        }),
    gender: member.gender,
    ...(member.frequency === undefined ? {} : { frequencyNote: member.frequency }),
    source: "legacy-member-migration" as const,
    migrationId: input.operationId,
    legacyMemberId,
    schemaVersion: "1" as const,
    createdAt: input.operationWriteTime,
    createdBy: input.actorId,
    updatedAt: input.operationWriteTime,
    updatedBy: input.actorId,
  };
  const parsed = studentAdminProfileSchema.safeParse(profile);
  if (!parsed.success) {
    forwardFailure(`row ${row.legacyMemberId} does not produce a valid admin profile`);
  }
  return Object.freeze(profile);
}

/**
 * The existing student a match row attaches to: same academy, owning its own document, and - when
 * it is a minor - covered by the active family and relationship the review bound (invariant 8).
 */
function assertMatchedStudent(
  input: MemberDirectoryForwardChunkInput,
  row: MemberDirectoryForwardPlannedRow,
  observed: MemberDirectoryForwardObservedRow,
): void {
  if (observed.student === undefined || observed.student === null) {
    forwardFailure(`matched student ${row.targetStudentId} does not exist`);
  }
  const parsed = parseStudentProfileAt(observed.student, input.effectiveDate);
  if (!parsed.ok) {
    forwardFailure(`matched student ${row.targetStudentId} is not a valid record`);
  }
  const student = parsed.value;
  if (student.studentId !== row.targetStudentId) {
    forwardFailure(`matched student ${row.targetStudentId} does not own the document read for it`);
  }
  if (student.academyId !== input.academyId) {
    forwardFailure(`matched student ${row.targetStudentId} belongs to another academy`);
  }
  if (student.participantType !== "minor") {
    if (row.familyId !== undefined || row.relationshipId !== undefined) {
      // A family bound for an adult match is a review that describes a different student.
      forwardFailure(`row ${row.legacyMemberId} binds a family to an adult match`);
    }
    return;
  }
  if (row.familyId === undefined || row.relationshipId === undefined) {
    forwardFailure(`row ${row.legacyMemberId} matches a minor without a reviewed family`);
  }
  const family = parseFamilyRecord(observed.family);
  if (!family.ok) {
    forwardFailure(`row ${row.legacyMemberId} has no valid family record`);
  }
  const relationship = parseFamilyRelationship(observed.relationship);
  if (!relationship.ok) {
    forwardFailure(`row ${row.legacyMemberId} has no valid family relationship`);
  }
  if (
    family.value.familyId !== row.familyId ||
    family.value.academyId !== input.academyId ||
    !family.value.active
  ) {
    forwardFailure(`row ${row.legacyMemberId} names a family that is not active in this academy`);
  }
  if (
    relationship.value.relationshipId !== row.relationshipId ||
    relationship.value.familyId !== row.familyId ||
    relationship.value.studentId !== row.targetStudentId ||
    relationship.value.academyId !== input.academyId ||
    !relationship.value.active
  ) {
    forwardFailure(
      `row ${row.legacyMemberId} names a relationship that does not cover this student`,
    );
  }
  if (student.familyId !== row.familyId) {
    forwardFailure(`matched student ${row.targetStudentId} is not in the reviewed family`);
  }
}

/**
 * What each eligible classification is allowed to do with its target student.
 *
 * Eligibility itself is not re-listed here - `isWriteEligibleClassification` owns it, so a
 * classification that becomes eligible elsewhere cannot quietly become eligible here too. This
 * decides only the shape of the write once eligibility has been granted, and an eligible
 * classification with no shape defined fails closed rather than defaulting to one.
 */
function assertRowTarget(
  input: MemberDirectoryForwardChunkInput,
  row: MemberDirectoryForwardPlannedRow,
  observed: MemberDirectoryForwardObservedRow,
): Readonly<{ createsStudent: boolean }> {
  if (
    !isWriteEligibleClassification(row.classification, {
      explicitlyReviewed: row.explicitlyReviewed,
    })
  ) {
    forwardFailure(`row ${row.legacyMemberId} is not write eligible`);
  }
  if (observed.profile !== undefined && observed.profile !== null) {
    // Step 6 creates an admin profile only when absent, and nothing overwrites one. A profile that
    // exists now means the plan's prior-absence assertion no longer holds, which is a changed input
    // rather than a row to skip. It also has nowhere to record `legacyMemberId`, so the reservation
    // this row would write could never be rechecked against it.
    forwardFailure(`target student ${row.targetStudentId} already has an admin profile`);
  }
  switch (row.classification) {
    case "createable-adult": {
      if (row.targetStudentId === row.legacyMemberId) {
        // Invariant 28: a new document ID is backend-generated and opaque, never the legacy one.
        forwardFailure(`row ${row.legacyMemberId} reuses its legacy ID as a new student ID`);
      }
      if (observed.student !== undefined && observed.student !== null) {
        forwardFailure(`target student ${row.targetStudentId} already exists`);
      }
      if (row.familyId !== undefined || row.relationshipId !== undefined) {
        forwardFailure(`row ${row.legacyMemberId} binds a family to a created student`);
      }
      return Object.freeze({ createsStudent: true });
    }
    case "explicit-existing-student-match": {
      if (row.targetStudentId === row.legacyMemberId) {
        // The same ID pointing at an existing student is the `same-id-compatible` coincidence, and
        // the manifest rule rejects an unreviewed one. Letting it through under the explicit-match
        // label would be the way around the review.
        forwardFailure(`row ${row.legacyMemberId} is a same-ID coincidence in another name`);
      }
      assertMatchedStudent(input, row, observed);
      return Object.freeze({ createsStudent: false });
    }
    case "same-id-compatible": {
      if (row.targetStudentId !== row.legacyMemberId) {
        forwardFailure(`row ${row.legacyMemberId} is not the same-ID student it claims`);
      }
      assertMatchedStudent(input, row, observed);
      return Object.freeze({ createsStudent: false });
    }
    default: {
      forwardFailure(`row ${row.legacyMemberId} has no defined forward write shape`);
    }
  }
}

/** The identifiers this row reserves, taken from the legacy record it is migrating. */
function forwardIdentityValues(
  member: MemberRecord,
  legacyMemberId: string,
): readonly Readonly<{ kind: StudentIdentityKeyKind; value: string }>[] {
  const byKind: Readonly<Record<(typeof forwardIdentityKinds)[number], string | undefined>> = {
    "membership-number": member.membershipNumber,
    "id-card-number": member.idCardNumber,
    "vat-number": member.vatNumber,
    "legacy-member-id": legacyMemberId,
  };
  return Object.freeze(
    forwardIdentityKinds.flatMap((kind) => {
      const value = byKind[kind];
      return value === undefined ? [] : [{ kind, value }];
    }),
  );
}

/**
 * Plans one forward chunk: the students, admin profiles and reservations it creates, and the MAC
 * that proves the three together. It performs no I/O and decides nothing about the control plane -
 * the caller hands the result to `runMemberDirectoryChunkCommit`, which decides whether it may
 * commit at all.
 */
export function planMemberDirectoryForwardChunk(
  input: MemberDirectoryForwardChunkInput,
  dependencies: MemberDirectoryForwardChunkDependencies,
): MemberDirectoryForwardChunkPlan {
  const chunkId = buildMemberDirectoryChunkId({
    operationId: input.operationId,
    phase: "forward",
    chunkNo: input.chunkNo,
  });

  if (!dateOnlyPattern.test(input.effectiveDate) || Number.isNaN(Date.parse(input.effectiveDate))) {
    // Every age decision in this chunk is taken against this date, so a malformed one has to stop
    // the chunk here rather than surface as an opaque throw from the first date derivation.
    forwardFailure("the operation effective date is not a plain date");
  }
  if (input.plannedRows.length === 0) {
    // A zero-row forward plan is a real case, but it is the parent's audited frozen -> applying
    // transition, not a chunk. An empty chunk would write a receipt certifying nothing.
    forwardFailure("a chunk must cover at least one planned row");
  }
  if (input.plannedRows.length > memberDirectoryMaxRowsPerChunk) {
    forwardFailure(`a chunk covers at most ${String(memberDirectoryMaxRowsPerChunk)} planned rows`);
  }
  if (input.observed.length !== input.plannedRows.length) {
    forwardFailure("the documents read do not cover the planned rows exactly");
  }
  input.plannedRows.forEach((row, index) => {
    const previous = input.plannedRows[index - 1];
    // Strictly ascending legacy document-ID order, because that is the order the bounded scan froze
    // the plan in. Equal neighbours are the duplicate-source case, caught by the same comparison.
    if (previous !== undefined && row.legacyMemberId <= previous.legacyMemberId) {
      forwardFailure("planned rows must ascend by legacy member ID without repeats");
    }
  });

  const keysById = new Map<string, StudentIdentityKey>();
  for (const value of input.existingKeys) {
    const parsed = studentIdentityKeySchema.safeParse(value);
    if (!parsed.success) {
      // A malformed reservation is unattributable: it cannot be proven compatible, and treating it
      // as absent would try to create a key over a document that already exists.
      forwardFailure("an existing identity key is not a valid record");
    }
    if (keysById.has(parsed.data.keyId)) {
      forwardFailure("an existing identity key was supplied twice");
    }
    keysById.set(parsed.data.keyId, parsed.data);
  }

  const writes: MemberDirectoryChunkDomainWrite[] = [];
  const claimedStudentIds = new Set<string>();
  const claimedKeyIds = new Set<string>();
  let createdStudentCount = 0;
  let createdKeyCount = 0;

  input.plannedRows.forEach((row, index) => {
    const observed = input.observed[index];
    if (observed === undefined || observed.legacyMemberId !== row.legacyMemberId) {
      forwardFailure("the documents read are not in the planned order");
    }
    if (claimedStudentIds.has(row.targetStudentId)) {
      // Two rows of one chunk targeting one student means two legacy records claim one person, and
      // the second create would collide inside the transaction rather than after it.
      forwardFailure("two planned rows target the same student");
    }
    claimedStudentIds.add(row.targetStudentId);

    const member = parsedMember(
      observed.member,
      row,
      input.academyId,
      dependencies.integritySecretMaterial,
    );
    const legacyMemberId = normalizedAdministrativeValue(
      row.legacyMemberId,
      "legacy member ID",
      row.legacyMemberId,
    );
    const target = assertRowTarget(input, row, observed);

    if (target.createsStudent) {
      writes.push(
        Object.freeze({
          operation: "create" as const,
          path: documentPath(input.academyId, studentsPathPrefix, row.targetStudentId),
          data: buildMigratedStudent(input, row, member),
        }),
      );
      createdStudentCount += 1;
    }
    writes.push(
      Object.freeze({
        operation: "create" as const,
        path: documentPath(input.academyId, adminProfilesPathPrefix, row.targetStudentId),
        data: buildMigratedProfile(input, row, member, legacyMemberId),
      }),
    );

    for (const candidate of forwardIdentityValues(member, legacyMemberId)) {
      const expected = buildStudentIdentityKey({
        academyId: input.academyId,
        kind: candidate.kind,
        value: candidate.value,
        ownerStudentId: row.targetStudentId,
        secretMaterial: dependencies.identitySecretMaterial,
        secretVersion: dependencies.identitySecretVersion,
        now: input.operationWriteTime,
        actorId: input.actorId,
      });
      if (claimedKeyIds.has(expected.keyId)) {
        forwardFailure("two planned rows claim the same identifier");
      }
      claimedKeyIds.add(expected.keyId);

      const stored = keysById.get(expected.keyId);
      if (stored !== undefined) {
        // A reservation that already exists is a live identity conflict, not something forward may
        // adopt: `identity-conflict` is never write-eligible, and even a key owned by this same
        // student would mean somebody already holds the identifier this row is migrating.
        forwardFailure("an identifier this row migrates is already reserved");
      }
      writes.push(
        Object.freeze({
          operation: "create" as const,
          path: documentPath(input.academyId, identityKeyPathPrefix, expected.keyId),
          data: expected,
        }),
      );
      createdKeyCount += 1;
    }
  });

  const domainWrites = Object.freeze(
    // Sorted by path so the same plan produces the same write list every time it is replanned.
    // Paths are unique - a repeated student or key was already refused - so the order is total.
    [...writes].sort((left, right) => (left.path > right.path ? 1 : -1)),
  );

  return Object.freeze({
    chunkId,
    rowCount: input.plannedRows.length,
    quarantinedCount: 0 as const,
    createdStudentCount,
    createdProfileCount: input.plannedRows.length,
    createdKeyCount,
    domainWrites,
    outputSetMac: createMemberDirectoryChunkOutputSetMac({
      chunkId,
      phase: "forward",
      writes: domainWrites,
      secretMaterial: dependencies.integritySecretMaterial,
    }),
  });
}
