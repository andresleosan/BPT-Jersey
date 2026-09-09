import { parseFamilyRecord, parseFamilyRelationship } from "@bpt-jersey/domain/families";
import { parseMemberRecord, type MemberRecord } from "@bpt-jersey/domain/members";
import {
  normalizeAdministrativeIdentifier,
  studentAdminProfileSchema,
} from "@bpt-jersey/domain/members/directory";
import {
  assertForwardCapacity,
  memberDirectoryDryRunClassifications,
  type MemberDirectoryDryRunClassification,
  type MemberDirectoryOperationReceipt,
} from "@bpt-jersey/domain/members/directory-migration";
import {
  memberDirectoryPrivateManifestSchema,
  memberDirectoryPrivateOutputPlanSchema,
  type MemberDirectoryPrivateManifest,
  type MemberDirectoryPrivateManifestRow,
  type MemberDirectoryPrivateOutputPlan,
} from "@bpt-jersey/domain/members/directory-private-plan";
import {
  memberDirectoryMaxChunksPerOperation,
  memberDirectoryMaxRowsPerChunk,
  memberDirectoryMaxRowsPerOperation,
} from "@bpt-jersey/domain/members/directory-transitions";
import {
  deriveParticipantType,
  parseStudentProfileAt,
  trainingCenters,
  trainingTimePreferences,
  type StudentProfile,
  type TrainingTimePreference,
} from "@bpt-jersey/domain/profiles";

import {
  createMemberDirectoryOutputLeafMac,
  createMemberDirectoryPrivateManifestMac,
  createMemberDirectoryPrivatePlanMac,
  createMemberDirectorySourceRowMac,
  createMemberDirectorySourceSetMac,
  deriveStudentIdentityKeyId,
  studentIdentityKeySchema,
  type StudentIdentityKeyKind,
} from "./member-directory-crypto.js";
import {
  planMemberDirectoryForwardChunk,
  type MemberDirectoryForwardObservedRow,
  type MemberDirectoryForwardPlannedRow,
} from "./member-directory-forward-executor.js";
import { openMemberDirectoryFrozenPlan } from "./member-directory-frozen-plan.js";

/**
 * The forward dry-run (T108): the piece that **produces** the frozen artifacts every other forward
 * piece already knows how to consume.
 *
 * It classifies every legacy row, writes nothing at all, and emits the reviewed manifest, the
 * private output plan and the metadata-only receipt that binds them. Until now the executor could
 * consume a manifest and the store could hold one, and nothing made one.
 *
 * **Two passes, because a review is a real step and not a formality.**
 * `classifyMemberDirectoryForwardRows` answers "what is each legacy row, and what needs deciding",
 * and needs no decisions to run - that is the report a reviewer works from.
 * `planMemberDirectoryForwardDryRun` runs the same classification with the decisions folded in and
 * emits the artifacts, refusing outright if any write-eligible row is still undecided. Splitting it
 * this way is what keeps `explicit-existing-student-match` honest: the spec defines it as "approved
 * manifest maps legacy to an existing student", so it is a decision the dry-run corroborates, never
 * one it derives from a matching identifier.
 *
 * **Zero writes means zero domain writes.** Nothing here touches Firestore or the artifact store;
 * every document it reasons about arrives as a value, and the three artifacts leave as values. The
 * caller seals and stores them.
 *
 * **The output plan is derived by asking the executor.** Each chunk's targets, content MACs and
 * expected output root come from `planMemberDirectoryForwardChunk` run over the same rows with the
 * same inputs. A plan built by a second implementation of the same domain rules would be a second
 * place for them to drift, and the drift would surface at the last chunk with the earlier ones
 * already written. The check the plan exists for is unaffected: it freezes what the executor
 * produces **from the data as it was at review time**, so a source that changes before execution
 * still fails against it.
 *
 * **It proves its own output before returning.** The last thing it does is run
 * `openMemberDirectoryFrozenPlan` over what it just built - the same function the forward runner
 * will use. A dry-run that cannot open its own artifacts emits nothing rather than a pair somebody
 * discovers is unusable at confirmation time.
 */

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;
const administrativeIdentifierPattern = /^[A-Z0-9][A-Z0-9 ./-]{0,63}$/u;
const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/**
 * The identifier kinds a forward row reserves, mirroring the executor exactly. `auth-user-id` is
 * absent for the same reason there: migration never invents an Auth user.
 */
const forwardIdentityKinds = Object.freeze([
  "membership-number",
  "id-card-number",
  "vat-number",
  "legacy-member-id",
] as const satisfies readonly StudentIdentityKeyKind[]);

/**
 * Why a row was classified the way it was, in a closed vocabulary.
 *
 * It names the rule, never the value that tripped it. The report is a Restricted artifact like the
 * manifest, but a reason code that quoted a membership number would be one careless log line away
 * from breaking invariant 18, and there is no reason to make that possible.
 */
export const memberDirectoryDryRunReasonCodes = Object.freeze([
  "eligible",
  "unparsable-record",
  "member-id-mismatch",
  "foreign-academy",
  "date-of-birth-absent",
  "date-of-birth-not-a-plain-date",
  "date-of-birth-after-effective-date",
  "training-center-unrecognised",
  "administrative-identifier-unusable",
  "membership-number-repeated-in-source",
  "identifier-repeated-in-source",
  "identifier-already-reserved",
  "reviewed-target-student-absent",
  "reviewed-target-student-invalid",
  "reviewed-target-already-migrated",
  "reviewed-family-does-not-cover-the-minor",
  "minor-without-reviewed-family",
] as const);

export type MemberDirectoryDryRunReasonCode = (typeof memberDirectoryDryRunReasonCodes)[number];

export type MemberDirectoryDryRunSourceRow = Readonly<{
  /** The `members/{legacyMemberId}` document ID. */
  legacyMemberId: string;
  /** The stored document, exactly as read. */
  document: unknown;
}>;

/**
 * One reviewer decision. A create and a match are separate shapes rather than one shape with
 * optional halves, so a decision that is somehow both cannot be written down.
 */
export type MemberDirectoryDryRunReviewedDecision =
  | Readonly<{
      legacyMemberId: string;
      decision: "create";
      /** The legacy record has no equivalent field, so these are reviewed rather than derived. */
      trainingTimePreferences: readonly TrainingTimePreference[];
    }>
  | Readonly<{
      legacyMemberId: string;
      decision: "match";
      /** The existing student the reviewer bound. Equal to the legacy ID only for a same-ID row. */
      targetStudentId: string;
      reviewedReason: string;
      /** Required when, and only when, the matched student is a minor. */
      familyId?: string;
      relationshipId?: string;
    }>;

export type MemberDirectoryForwardDryRunInput = Readonly<{
  academyId: string;
  operationId: string;
  manifestId: string;
  planId: string;
  targetProjectClassification: "emulator" | "staging" | "production";
  codeVersion: string;
  /** Every `members` row of the tenant, ascending by document ID. */
  sourceRows: readonly MemberDirectoryDryRunSourceRow[];
  /** The bounded canonical scan: students, their admin profiles, and every current reservation. */
  existingStudents: readonly unknown[];
  existingAdminProfiles: readonly unknown[];
  existingIdentityKeys: readonly unknown[];
  /** Only the families and relationships a reviewed minor match names need to be read. */
  existingFamilies: readonly unknown[];
  existingRelationships: readonly unknown[];
  /** The admitted-student count the state/guard head carries right now. */
  stateAdmittedStudentCount: number;
  /** The completed identity-key bootstrap's baseline proof. */
  identityKeyBaselineMac: string;
  maximumApprovedRows: number;
  /** The receipt window, and the server-owned instants every create is prebound to. */
  effectiveDate: string;
  expiresAt: string;
  operationWriteTime: string;
  createdAt: string;
  manifestPreparedAt: string;
  manifestExpiresAt: string;
  actorId: string;
  decisions: readonly MemberDirectoryDryRunReviewedDecision[];
}>;

export type MemberDirectoryForwardDryRunDependencies = Readonly<{
  identitySecretMaterial: string;
  identitySecretVersion: string;
  integritySecretMaterial: string;
  integritySecretVersion: string;
  /**
   * Mints one backend-generated opaque student ID. It is a port because the spec requires the
   * server to create every target ID before `planMac` is finalized, and because a test that could
   * not fix them could not assert on a plan at all.
   */
  mintTargetStudentId: () => string;
}>;

export type MemberDirectoryDryRunClassifiedRow = Readonly<{
  legacyMemberId: string;
  classification: MemberDirectoryDryRunClassification;
  reasonCode: MemberDirectoryDryRunReasonCode;
  /** The fingerprint of the row as it was read, whether or not the row is eligible. */
  sourceRowMac: string;
  /** Present only for an eligible row: the student it would become. */
  targetStudentId?: string;
  /** Present only for an eligible match against a minor. */
  familyId?: string;
  relationshipId?: string;
  reviewedReason?: string;
  trainingTimePreferences?: readonly TrainingTimePreference[];
}>;

export type MemberDirectoryForwardClassificationReport = Readonly<{
  rows: readonly MemberDirectoryDryRunClassifiedRow[];
  counts: Readonly<Record<MemberDirectoryDryRunClassification, number>>;
  preExistingAdmittedStudentCount: number;
  plannedNewStudentCount: number;
  postCutoverAdmittedStudentCount: number;
  /** The legacy IDs a reviewer still has to decide before a plan can be emitted. */
  awaitingDecision: readonly string[];
}>;

export type MemberDirectoryForwardDryRun = Readonly<{
  report: MemberDirectoryForwardClassificationReport;
  manifest: MemberDirectoryPrivateManifest;
  plan: MemberDirectoryPrivateOutputPlan;
  receipt: MemberDirectoryOperationReceipt;
}>;

function dryRunFailure(reason: string): never {
  throw new Error(`Member directory forward dry-run refused: ${reason}`);
}

/** A classification plus the reason that produced it, with nothing eligible attached. */
type Verdict = Readonly<{
  classification: MemberDirectoryDryRunClassification;
  reasonCode: MemberDirectoryDryRunReasonCode;
}>;

function refuse(
  classification: MemberDirectoryDryRunClassification,
  reasonCode: MemberDirectoryDryRunReasonCode,
): Verdict {
  return Object.freeze({ classification, reasonCode });
}

/**
 * The administrative identifiers a row would reserve, normalized the one way the directory
 * normalizes them - the same normalization the executor stores and digests, so a value that is
 * unusable here is unusable there rather than failing halfway through a chunk.
 */
function administrativeValues(
  member: MemberRecord,
  legacyMemberId: string,
): readonly Readonly<{ kind: StudentIdentityKeyKind; value: string }>[] | undefined {
  const byKind: Readonly<Record<(typeof forwardIdentityKinds)[number], string | undefined>> = {
    "membership-number": member.membershipNumber,
    "id-card-number": member.idCardNumber,
    "vat-number": member.vatNumber,
    "legacy-member-id": legacyMemberId,
  };
  const values: Readonly<{ kind: StudentIdentityKeyKind; value: string }>[] = [];
  for (const kind of forwardIdentityKinds) {
    const raw = byKind[kind];
    if (raw === undefined) continue;
    const normalized = normalizeAdministrativeIdentifier(raw);
    if (!administrativeIdentifierPattern.test(normalized)) return undefined;
    values.push(Object.freeze({ kind, value: normalized }));
  }
  return Object.freeze(values);
}

/**
 * The shape checks that do not depend on anything outside the row itself. They run before every
 * cross-row and cross-collection rule, so a record that cannot be read is never also reported as a
 * duplicate of something.
 */
function classifyRecordShape(
  member: MemberRecord,
  legacyMemberId: string,
  academyId: string,
  effectiveDay: string,
): Verdict | undefined {
  if (member.memberId !== legacyMemberId) return refuse("invalid-record", "member-id-mismatch");
  if (member.academyId !== academyId) return refuse("cross-tenant", "foreign-academy");
  if (member.birthDate === undefined) {
    // Invariant 10: no date of birth, no participant type, and nothing may guess one.
    return refuse("missing-required-fields", "date-of-birth-absent");
  }
  if (!dateOnlyPattern.test(member.birthDate)) {
    // A legacy timestamp would need a time zone nobody chose, and truncating it can move somebody
    // across the adult boundary by a day.
    return refuse("invalid-record", "date-of-birth-not-a-plain-date");
  }
  if (member.birthDate > effectiveDay) {
    return refuse("invalid-record", "date-of-birth-after-effective-date");
  }
  if (
    member.trainingCenter === undefined ||
    !trainingCenters.includes(member.trainingCenter as (typeof trainingCenters)[number])
  ) {
    // Invariant 11: Town or West, and no silent default.
    return refuse("missing-required-fields", "training-center-unrecognised");
  }
  return undefined;
}

type ScannedDirectory = Readonly<{
  studentsById: ReadonlyMap<string, StudentProfile>;
  profileIds: ReadonlySet<string>;
  keysById: ReadonlyMap<string, unknown>;
  familiesById: ReadonlyMap<string, unknown>;
  relationshipsById: ReadonlyMap<string, unknown>;
}>;

function scanDirectory(input: MemberDirectoryForwardDryRunInput): ScannedDirectory {
  const studentsById = new Map<string, StudentProfile>();
  for (const value of input.existingStudents) {
    const parsed = parseStudentProfileAt(value, input.effectiveDate.slice(0, 10));
    if (!parsed.ok) {
      // The bounded scan rejects an invalid record rather than skipping it: a student the plan
      // cannot read is a student it cannot prove absent from any mapping.
      dryRunFailure("an existing canonical student is not a valid record");
    }
    if (studentsById.has(parsed.value.studentId)) {
      dryRunFailure("an existing canonical student was supplied twice");
    }
    studentsById.set(parsed.value.studentId, parsed.value);
  }

  const profileIds = new Set<string>();
  for (const value of input.existingAdminProfiles) {
    const parsed = studentAdminProfileSchema.safeParse(value);
    if (!parsed.success) dryRunFailure("an existing admin profile is not a valid record");
    if (profileIds.has(parsed.data.studentId)) {
      dryRunFailure("an existing admin profile was supplied twice");
    }
    if (!studentsById.has(parsed.data.studentId)) {
      // The bootstrap's join rule: an orphan profile means the two sets disagree about who exists,
      // and a plan built over that disagreement would be planning against a partial directory.
      dryRunFailure("an existing admin profile has no student");
    }
    profileIds.add(parsed.data.studentId);
  }

  const keysById = new Map<string, unknown>();
  for (const value of input.existingIdentityKeys) {
    const parsed = studentIdentityKeySchema.safeParse(value);
    if (!parsed.success) dryRunFailure("an existing identity key is not a valid record");
    if (keysById.has(parsed.data.keyId))
      dryRunFailure("an existing identity key was supplied twice");
    keysById.set(parsed.data.keyId, value);
  }

  const familiesById = new Map<string, unknown>();
  for (const value of input.existingFamilies) {
    const parsed = parseFamilyRecord(value);
    if (!parsed.ok) dryRunFailure("a supplied family is not a valid record");
    familiesById.set(parsed.value.familyId, value);
  }

  const relationshipsById = new Map<string, unknown>();
  for (const value of input.existingRelationships) {
    const parsed = parseFamilyRelationship(value);
    if (!parsed.ok) dryRunFailure("a supplied family relationship is not a valid record");
    relationshipsById.set(parsed.value.relationshipId, value);
  }

  return Object.freeze({
    studentsById,
    profileIds,
    keysById,
    familiesById,
    relationshipsById,
  });
}

/**
 * Classifies every legacy row, with zero writes and zero I/O.
 *
 * Runs with or without decisions: with none it is the report a reviewer works from, and every row
 * that needs one appears in `awaitingDecision`.
 */
export function classifyMemberDirectoryForwardRows(
  input: MemberDirectoryForwardDryRunInput,
  dependencies: MemberDirectoryForwardDryRunDependencies,
): MemberDirectoryForwardClassificationReport {
  if (!dateOnlyPattern.test(input.effectiveDate.slice(0, 10))) {
    dryRunFailure("the operation effective date does not begin with a plain date");
  }
  const effectiveDay = input.effectiveDate.slice(0, 10);

  if (input.sourceRows.length > memberDirectoryMaxRowsPerOperation) {
    // The v1 bound, applied to the source read rather than discovered at row 401.
    dryRunFailure(
      `one operation reads at most ${String(memberDirectoryMaxRowsPerOperation)} legacy rows`,
    );
  }
  if (input.existingStudents.length > memberDirectoryMaxRowsPerOperation) {
    dryRunFailure(
      `one operation reads at most ${String(memberDirectoryMaxRowsPerOperation)} existing students`,
    );
  }
  input.sourceRows.forEach((row, index) => {
    const previous = input.sourceRows[index - 1];
    if (previous !== undefined && row.legacyMemberId <= previous.legacyMemberId) {
      // Ascending document-ID order is what makes the frozen scan reproducible, and equal
      // neighbours are the duplicate-source case caught by the same comparison.
      dryRunFailure("legacy rows must ascend by document ID without repeats");
    }
  });

  const directory = scanDirectory(input);

  const decisionsById = new Map<string, MemberDirectoryDryRunReviewedDecision>();
  for (const decision of input.decisions) {
    if (decisionsById.has(decision.legacyMemberId)) {
      dryRunFailure(`two reviewed decisions cover ${decision.legacyMemberId}`);
    }
    decisionsById.set(decision.legacyMemberId, decision);
  }
  const sourceIds = new Set(input.sourceRows.map((row) => row.legacyMemberId));
  for (const legacyMemberId of decisionsById.keys()) {
    if (!sourceIds.has(legacyMemberId)) {
      // A decision about a row that is not in the source is a review of something that is not
      // there, which makes the whole review stale rather than partially usable.
      dryRunFailure(`a reviewed decision names ${legacyMemberId}, which the source does not hold`);
    }
  }

  // First pass over the source: parse, shape-check and collect the normalized identifiers, so the
  // cross-row duplicate rules below can be decided over the whole set rather than pairwise.
  type Prepared = Readonly<{
    row: MemberDirectoryDryRunSourceRow;
    sourceRowMac: string;
    member?: MemberRecord;
    verdict?: Verdict;
    identifiers?: readonly Readonly<{ kind: StudentIdentityKeyKind; value: string }>[];
  }>;
  const prepared: Prepared[] = input.sourceRows.map((row) => {
    const sourceRowMac = createMemberDirectorySourceRowMac({
      academyId: input.academyId,
      sourceCollection: "members",
      sourceId: row.legacyMemberId,
      document: row.document,
      secretMaterial: dependencies.integritySecretMaterial,
    });
    const parsed = parseMemberRecord(row.document);
    if (!parsed.ok) {
      return { row, sourceRowMac, verdict: refuse("invalid-record", "unparsable-record") };
    }
    const shape = classifyRecordShape(
      parsed.value,
      row.legacyMemberId,
      input.academyId,
      effectiveDay,
    );
    if (shape !== undefined) return { row, sourceRowMac, member: parsed.value, verdict: shape };
    const identifiers = administrativeValues(parsed.value, row.legacyMemberId);
    if (identifiers === undefined) {
      return {
        row,
        sourceRowMac,
        member: parsed.value,
        verdict: refuse("invalid-record", "administrative-identifier-unusable"),
      };
    }
    return { row, sourceRowMac, member: parsed.value, identifiers };
  });

  // Duplicates inside the source set. A repeated membership number has its own classification
  // because the spec names it; a repeated ID card or VAT is the same collision under
  // `identity-conflict`, which is the classification that covers an identity claimed twice.
  const membershipOwners = new Map<string, number>();
  const otherIdentifierOwners = new Map<string, number>();
  for (const entry of prepared) {
    if (entry.identifiers === undefined) continue;
    for (const identifier of entry.identifiers) {
      const target =
        identifier.kind === "membership-number" ? membershipOwners : otherIdentifierOwners;
      const key = `${identifier.kind}:${identifier.value}`;
      target.set(key, (target.get(key) ?? 0) + 1);
    }
  }

  const rows: MemberDirectoryDryRunClassifiedRow[] = [];
  const awaitingDecision: string[] = [];

  for (const entry of prepared) {
    const { row, sourceRowMac } = entry;
    if (
      entry.verdict !== undefined ||
      entry.member === undefined ||
      entry.identifiers === undefined
    ) {
      const verdict = entry.verdict ?? refuse("invalid-record", "unparsable-record");
      rows.push(Object.freeze({ legacyMemberId: row.legacyMemberId, sourceRowMac, ...verdict }));
      continue;
    }
    const member = entry.member;

    const duplicateMembership = entry.identifiers.some(
      (identifier) =>
        identifier.kind === "membership-number" &&
        (membershipOwners.get(`${identifier.kind}:${identifier.value}`) ?? 0) > 1,
    );
    if (duplicateMembership) {
      rows.push(
        Object.freeze({
          legacyMemberId: row.legacyMemberId,
          sourceRowMac,
          ...refuse("duplicate-membership-number", "membership-number-repeated-in-source"),
        }),
      );
      continue;
    }
    const duplicateOther = entry.identifiers.some(
      (identifier) =>
        identifier.kind !== "membership-number" &&
        (otherIdentifierOwners.get(`${identifier.kind}:${identifier.value}`) ?? 0) > 1,
    );
    if (duplicateOther) {
      rows.push(
        Object.freeze({
          legacyMemberId: row.legacyMemberId,
          sourceRowMac,
          ...refuse("identity-conflict", "identifier-repeated-in-source"),
        }),
      );
      continue;
    }

    const reserved = entry.identifiers.some((identifier) =>
      directory.keysById.has(
        deriveStudentIdentityKeyId({
          academyId: input.academyId,
          kind: identifier.kind,
          value: identifier.value,
          secretMaterial: dependencies.identitySecretMaterial,
        }),
      ),
    );
    if (reserved) {
      // Somebody already holds an identifier this row migrates. The executor refuses it too; this
      // is where it becomes a classification instead of a chunk that fails after freezing.
      rows.push(
        Object.freeze({
          legacyMemberId: row.legacyMemberId,
          sourceRowMac,
          ...refuse("identity-conflict", "identifier-already-reserved"),
        }),
      );
      continue;
    }

    const decision = decisionsById.get(row.legacyMemberId);
    if (decision !== undefined && decision.decision === "match") {
      rows.push(classifyReviewedMatch(input, directory, decision, sourceRowMac));
      continue;
    }

    if (directory.studentsById.has(row.legacyMemberId)) {
      // The spec is explicit: an unreviewed same-ID coincidence rejects the whole manifest. It is
      // also the only way the counts can hold - a `same-id-compatible` row counted in the receipt
      // and absent from the manifest would make the receipt describe a different plan.
      dryRunFailure(
        `row ${row.legacyMemberId} is an unreviewed same-ID coincidence with an existing student`,
      );
    }

    const dateOfBirth = member.birthDate;
    if (dateOfBirth === undefined) {
      dryRunFailure(`row ${row.legacyMemberId} lost its date of birth between two reads`);
    }
    if (deriveParticipantType(dateOfBirth, effectiveDay) !== "adult") {
      rows.push(
        Object.freeze({
          legacyMemberId: row.legacyMemberId,
          sourceRowMac,
          ...refuse("minor-requires-family-match", "minor-without-reviewed-family"),
        }),
      );
      continue;
    }

    if (decision === undefined) {
      awaitingDecision.push(row.legacyMemberId);
      rows.push(
        Object.freeze({
          legacyMemberId: row.legacyMemberId,
          sourceRowMac,
          classification: "createable-adult" as const,
          reasonCode: "eligible" as const,
        }),
      );
      continue;
    }

    const preferences = decision.trainingTimePreferences;
    if (
      preferences.length === 0 ||
      new Set(preferences).size !== preferences.length ||
      preferences.some((preference) => !trainingTimePreferences.includes(preference))
    ) {
      dryRunFailure(`row ${row.legacyMemberId} has no usable reviewed training time preferences`);
    }
    rows.push(
      Object.freeze({
        legacyMemberId: row.legacyMemberId,
        sourceRowMac,
        classification: "createable-adult" as const,
        reasonCode: "eligible" as const,
        trainingTimePreferences: Object.freeze([...preferences]),
      }),
    );
  }

  const counts = Object.fromEntries(
    memberDirectoryDryRunClassifications.map((classification) => [classification, 0]),
  ) as Record<MemberDirectoryDryRunClassification, number>;
  for (const row of rows) counts[row.classification] += 1;

  const preExistingAdmittedStudentCount = directory.studentsById.size;
  if (preExistingAdmittedStudentCount !== input.stateAdmittedStudentCount) {
    // Step 2 of the confirmation algorithm requires the scan to agree with the control plane before
    // anything is frozen; a disagreement means the directory moved under the plan.
    dryRunFailure("the canonical scan disagrees with the state's admitted student count");
  }
  const plannedNewStudentCount = counts["createable-adult"];
  const postCutoverAdmittedStudentCount = preExistingAdmittedStudentCount + plannedNewStudentCount;
  assertForwardCapacity({
    preExistingAdmittedStudentCount,
    plannedNewStudentCount,
    postCutoverAdmittedStudentCount,
  });

  return Object.freeze({
    rows: Object.freeze(rows),
    counts: Object.freeze(counts),
    preExistingAdmittedStudentCount,
    plannedNewStudentCount,
    postCutoverAdmittedStudentCount,
    awaitingDecision: Object.freeze(awaitingDecision),
  });
}

/**
 * A row a reviewer bound to an existing student.
 *
 * Every claim the decision makes is checked against what the scan actually read. A decision that
 * names a student who is not there, or one who has already been migrated, is not a row to set aside
 * - it means the review was taken against a directory that has since changed.
 */
function classifyReviewedMatch(
  input: MemberDirectoryForwardDryRunInput,
  directory: ScannedDirectory,
  decision: Extract<MemberDirectoryDryRunReviewedDecision, { decision: "match" }>,
  sourceRowMac: string,
): MemberDirectoryDryRunClassifiedRow {
  const legacyMemberId = decision.legacyMemberId;
  const isSameId = decision.targetStudentId === legacyMemberId;
  const classification: MemberDirectoryDryRunClassification = isSameId
    ? "same-id-compatible"
    : "explicit-existing-student-match";

  const student = directory.studentsById.get(decision.targetStudentId);
  if (student === undefined) {
    dryRunFailure(
      `the reviewed match for ${legacyMemberId} names a student the directory does not hold`,
    );
  }
  if (student.academyId !== input.academyId) {
    dryRunFailure(`the reviewed match for ${legacyMemberId} names a student of another academy`);
  }
  if (directory.profileIds.has(decision.targetStudentId)) {
    // Step 6 creates an admin profile only when absent, and nothing overwrites one. A target that
    // already has one has already been migrated, and there would be nowhere to record this row's
    // `legacyMemberId`.
    dryRunFailure(`the reviewed match for ${legacyMemberId} names an already-migrated student`);
  }
  if (decision.reviewedReason.trim().length === 0) {
    dryRunFailure(`the reviewed match for ${legacyMemberId} records no reason`);
  }

  if (student.participantType !== "minor") {
    if (decision.familyId !== undefined || decision.relationshipId !== undefined) {
      dryRunFailure(`the reviewed match for ${legacyMemberId} binds a family to an adult`);
    }
    return Object.freeze({
      legacyMemberId,
      sourceRowMac,
      classification,
      reasonCode: "eligible" as const,
      targetStudentId: decision.targetStudentId,
      reviewedReason: decision.reviewedReason,
    });
  }

  if (decision.familyId === undefined || decision.relationshipId === undefined) {
    // A minor with no reviewed family is exactly what the classification is named for; it stays a
    // counted, unlisted row rather than failing the run, because nobody claimed it was ready.
    return Object.freeze({
      legacyMemberId,
      sourceRowMac,
      ...refuse("minor-requires-family-match", "minor-without-reviewed-family"),
    });
  }

  const family = parseFamilyRecord(directory.familiesById.get(decision.familyId));
  const relationship = parseFamilyRelationship(
    directory.relationshipsById.get(decision.relationshipId),
  );
  const covered =
    family.ok &&
    relationship.ok &&
    family.value.familyId === decision.familyId &&
    family.value.academyId === input.academyId &&
    family.value.active &&
    relationship.value.relationshipId === decision.relationshipId &&
    relationship.value.familyId === decision.familyId &&
    relationship.value.studentId === decision.targetStudentId &&
    relationship.value.academyId === input.academyId &&
    relationship.value.active &&
    student.familyId === decision.familyId;
  if (!covered) {
    // Invariant 8. Migration never creates a family or a relationship, so a linkage that does not
    // already cover this student is a row that cannot be migrated - not one to repair.
    return Object.freeze({
      legacyMemberId,
      sourceRowMac,
      ...refuse("minor-requires-family-match", "reviewed-family-does-not-cover-the-minor"),
    });
  }

  return Object.freeze({
    legacyMemberId,
    sourceRowMac,
    classification,
    reasonCode: "eligible" as const,
    targetStudentId: decision.targetStudentId,
    reviewedReason: decision.reviewedReason,
    familyId: decision.familyId,
    relationshipId: decision.relationshipId,
  });
}

/**
 * Runs the classification with the decisions folded in and emits the three frozen artifacts.
 *
 * It refuses rather than emitting a partial plan whenever the review is incomplete: an eligible row
 * with no decision, or a decision the data no longer supports, means the manifest a human would be
 * approving is not the manifest the directory can execute.
 */
export function planMemberDirectoryForwardDryRun(
  input: MemberDirectoryForwardDryRunInput,
  dependencies: MemberDirectoryForwardDryRunDependencies,
): MemberDirectoryForwardDryRun {
  const report = classifyMemberDirectoryForwardRows(input, dependencies);
  if (report.awaitingDecision.length > 0) {
    dryRunFailure(
      `${String(report.awaitingDecision.length)} eligible rows are still awaiting a reviewed decision`,
    );
  }

  const eligible = report.rows.filter((row) => row.reasonCode === "eligible");
  if (eligible.length === 0) {
    // A forward operation with nothing to write is the parent's audited zero-row transition, not a
    // plan. Emitting an empty manifest would produce a receipt certifying nothing.
    dryRunFailure("no legacy row is eligible for migration");
  }
  if (eligible.length > input.maximumApprovedRows) {
    dryRunFailure("more rows are eligible than the operation approved");
  }

  const mintedIds = new Set<string>();
  const manifestRows: MemberDirectoryPrivateManifestRow[] = eligible.map((row) => {
    if (row.classification !== "createable-adult") {
      if (row.targetStudentId === undefined || row.reviewedReason === undefined) {
        dryRunFailure(`eligible match ${row.legacyMemberId} carries no reviewed target`);
      }
      return Object.freeze({
        sourceLegacyId: row.legacyMemberId,
        sourceUpdatedAt: sourceUpdatedAt(input, row.legacyMemberId),
        sourceRowMac: row.sourceRowMac,
        classification: row.classification as
          "same-id-compatible" | "explicit-existing-student-match",
        targetStudentId: row.targetStudentId,
        reviewedReason: row.reviewedReason,
        ...(row.familyId === undefined || row.relationshipId === undefined
          ? {}
          : {
              family: Object.freeze({
                familyId: row.familyId,
                relationshipId: row.relationshipId,
              }),
            }),
      }) as MemberDirectoryPrivateManifestRow;
    }
    const targetStudentId = dependencies.mintTargetStudentId();
    if (!safeIdentifierPattern.test(targetStudentId)) {
      dryRunFailure("a minted target student ID is not a safe identifier");
    }
    if (mintedIds.has(targetStudentId)) {
      dryRunFailure("a target student ID was minted twice");
    }
    if (targetStudentId === row.legacyMemberId) {
      // Invariant 28: a new document ID is backend-generated and opaque, never the legacy one.
      dryRunFailure("a minted target student ID reuses a legacy member ID");
    }
    if (report.rows.some((other) => other.legacyMemberId === targetStudentId)) {
      dryRunFailure("a minted target student ID collides with a legacy member ID");
    }
    mintedIds.add(targetStudentId);
    const preferences = row.trainingTimePreferences;
    if (preferences === undefined) {
      dryRunFailure(`eligible create ${row.legacyMemberId} carries no reviewed preferences`);
    }
    return Object.freeze({
      sourceLegacyId: row.legacyMemberId,
      sourceUpdatedAt: sourceUpdatedAt(input, row.legacyMemberId),
      sourceRowMac: row.sourceRowMac,
      classification: "createable-adult" as const,
      targetStudentId,
      trainingTimePreferences: preferences,
    }) as MemberDirectoryPrivateManifestRow;
  });

  const manifest = memberDirectoryPrivateManifestSchema.parse({
    schemaVersion: "1",
    manifestId: input.manifestId,
    operationId: input.operationId,
    academyId: input.academyId,
    targetProjectClassification: input.targetProjectClassification,
    codeVersion: input.codeVersion,
    preparedAt: input.manifestPreparedAt,
    expiresAt: input.manifestExpiresAt,
    rows: manifestRows,
  });

  const privateManifestMac = createMemberDirectoryPrivateManifestMac({
    manifest,
    secretMaterial: dependencies.integritySecretMaterial,
  });

  const chunks = buildPlanChunks(input, dependencies, manifest);

  const plan = memberDirectoryPrivateOutputPlanSchema.parse({
    schemaVersion: "1",
    planId: input.planId,
    operationId: input.operationId,
    academyId: input.academyId,
    manifestId: input.manifestId,
    privateManifestMac,
    chunks,
  });

  const receipt: unknown = {
    operationId: input.operationId,
    academyId: input.academyId,
    phase: "forward",
    targetProjectClassification: input.targetProjectClassification,
    codeVersion: input.codeVersion,
    schemaVersion: "1",
    effectiveDate: input.effectiveDate,
    expiresAt: input.expiresAt,
    sourceMac: createMemberDirectorySourceSetMac({
      academyId: input.academyId,
      operationId: input.operationId,
      rows: manifest.rows.map((row) => ({
        sourceId: row.sourceLegacyId,
        sourceRowMac: row.sourceRowMac,
      })),
      secretMaterial: dependencies.integritySecretMaterial,
    }),
    privateManifestMac,
    planMac: createMemberDirectoryPrivatePlanMac({
      plan,
      secretMaterial: dependencies.integritySecretMaterial,
    }),
    digestVersion: "hmac-sha256-v1",
    secretVersion: dependencies.identitySecretVersion,
    identityKeyBaselineMac: input.identityKeyBaselineMac,
    expectedOutputSetMacRoots: chunks.map((chunk) => chunk.expectedOutputSetMac),
    classificationCounts: report.counts,
    preExistingAdmittedStudentCount: report.preExistingAdmittedStudentCount,
    plannedNewStudentCount: report.plannedNewStudentCount,
    postCutoverAdmittedStudentCount: report.postCutoverAdmittedStudentCount,
    maximumApprovedRows: input.maximumApprovedRows,
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: dependencies.integritySecretVersion,
    operationWriteTime: input.operationWriteTime,
    createdAt: input.createdAt,
    createdBy: input.actorId,
  };

  /**
   * The dry-run proves its own output with the function the runner will use. If the three artifacts
   * do not bind to each other here, they never leave: a pair that only fails at confirmation time
   * has already cost a freeze and an approval.
   */
  const frozen = openMemberDirectoryFrozenPlan({
    receipt,
    manifest,
    plan,
    now: input.createdAt,
    integritySecretMaterial: dependencies.integritySecretMaterial,
  });

  return Object.freeze({
    report,
    manifest: frozen.manifest,
    plan: frozen.plan,
    receipt: frozen.receipt,
  });
}

/** The exact stored version of a legacy row, taken from the document the dry-run read. */
function sourceUpdatedAt(input: MemberDirectoryForwardDryRunInput, legacyMemberId: string): string {
  const row = input.sourceRows.find((candidate) => candidate.legacyMemberId === legacyMemberId);
  const parsed = parseMemberRecord(row?.document);
  if (!parsed.ok) dryRunFailure(`legacy row ${legacyMemberId} is no longer readable`);
  return parsed.value.updatedAt;
}

/**
 * Slices the manifest into chunks and asks the forward executor what each one produces.
 *
 * The executor is run with the same inputs the real chunk will receive, so the targets, content
 * MACs and output root the plan freezes are the ones the chunk will compute - not a second
 * implementation's opinion of them.
 */
function buildPlanChunks(
  input: MemberDirectoryForwardDryRunInput,
  dependencies: MemberDirectoryForwardDryRunDependencies,
  manifest: MemberDirectoryPrivateManifest,
): readonly Readonly<{
  chunkNo: number;
  sourceLegacyIds: readonly string[];
  targets: readonly Readonly<{ path: string; priorAbsence: true; contentMac: string }>[];
  expectedOutputSetMac: string;
}>[] {
  const ordered = [...manifest.rows].sort((left, right) =>
    left.sourceLegacyId > right.sourceLegacyId ? 1 : -1,
  );
  const slices: MemberDirectoryPrivateManifestRow[][] = [];
  for (let index = 0; index < ordered.length; index += memberDirectoryMaxRowsPerChunk) {
    slices.push(ordered.slice(index, index + memberDirectoryMaxRowsPerChunk));
  }
  if (slices.length > memberDirectoryMaxChunksPerOperation) {
    dryRunFailure(
      `one operation runs at most ${String(memberDirectoryMaxChunksPerOperation)} chunks`,
    );
  }

  const documentsById = new Map(input.sourceRows.map((row) => [row.legacyMemberId, row.document]));
  const studentsById = new Map<string, unknown>();
  for (const value of input.existingStudents) {
    const parsed = parseStudentProfileAt(value, input.effectiveDate.slice(0, 10));
    if (parsed.ok) studentsById.set(parsed.value.studentId, value);
  }
  const familiesById = new Map<string, unknown>();
  for (const value of input.existingFamilies) {
    const parsed = parseFamilyRecord(value);
    if (parsed.ok) familiesById.set(parsed.value.familyId, value);
  }
  const relationshipsById = new Map<string, unknown>();
  for (const value of input.existingRelationships) {
    const parsed = parseFamilyRelationship(value);
    if (parsed.ok) relationshipsById.set(parsed.value.relationshipId, value);
  }
  const keysById = new Map<string, unknown>();
  for (const value of input.existingIdentityKeys) {
    const parsed = studentIdentityKeySchema.safeParse(value);
    if (parsed.success) keysById.set(parsed.data.keyId, value);
  }

  return Object.freeze(
    slices.map((slice, index) => {
      const chunkNo = index + 1;
      const plannedRows: MemberDirectoryForwardPlannedRow[] = slice.map((row) =>
        Object.freeze({
          legacyMemberId: row.sourceLegacyId,
          classification: row.classification,
          explicitlyReviewed: row.classification !== "createable-adult",
          targetStudentId: row.targetStudentId,
          sourceRowMac: row.sourceRowMac,
          // A match never reaches `buildMigratedStudent`, so the empty list is never read
          // there; the manifest schema is what guarantees a create always carries its own.
          trainingTimePreferences: row.trainingTimePreferences ?? [],
          ...(row.family === undefined
            ? {}
            : { familyId: row.family.familyId, relationshipId: row.family.relationshipId }),
        }),
      );
      const observed: MemberDirectoryForwardObservedRow[] = slice.map((row) =>
        Object.freeze({
          legacyMemberId: row.sourceLegacyId,
          member: documentsById.get(row.sourceLegacyId),
          student: studentsById.get(row.targetStudentId),
          // Proved absent by the classification: a target that already had one was refused there.
          profile: undefined,
          ...(row.family === undefined
            ? {}
            : {
                family: familiesById.get(row.family.familyId),
                relationship: relationshipsById.get(row.family.relationshipId),
              }),
        }),
      );
      // Empty by construction - a row whose identifier was already reserved was classified
      // `identity-conflict` and never reached the manifest - but taken from the scan rather than
      // hardcoded, so the executor's own reservation check is real plumbing here too.
      const existingKeys = plannedRows.flatMap((planned) => {
        const parsed = parseMemberRecord(documentsById.get(planned.legacyMemberId));
        if (!parsed.ok) return [];
        const values = administrativeValues(parsed.value, planned.legacyMemberId) ?? [];
        return values.flatMap((identifier) => {
          const stored = keysById.get(
            deriveStudentIdentityKeyId({
              academyId: input.academyId,
              kind: identifier.kind,
              value: identifier.value,
              secretMaterial: dependencies.identitySecretMaterial,
            }),
          );
          return stored === undefined ? [] : [stored];
        });
      });

      const chunkPlan = planMemberDirectoryForwardChunk(
        {
          academyId: input.academyId,
          operationId: input.operationId,
          chunkNo,
          plannedRows,
          observed,
          existingKeys,
          operationWriteTime: input.operationWriteTime,
          effectiveDate: input.effectiveDate.slice(0, 10),
          actorId: input.actorId,
        },
        {
          identitySecretMaterial: dependencies.identitySecretMaterial,
          identitySecretVersion: dependencies.identitySecretVersion,
          integritySecretMaterial: dependencies.integritySecretMaterial,
        },
      );

      return Object.freeze({
        chunkNo,
        sourceLegacyIds: Object.freeze(slice.map((row) => row.sourceLegacyId)),
        targets: Object.freeze(
          chunkPlan.domainWrites.map((write) =>
            Object.freeze({
              path: write.path,
              priorAbsence: true as const,
              contentMac: createMemberDirectoryOutputLeafMac({
                path: write.path,
                data: write.data,
                secretMaterial: dependencies.integritySecretMaterial,
              }),
            }),
          ),
        ),
        expectedOutputSetMac: chunkPlan.outputSetMac,
      });
    }),
  );
}
