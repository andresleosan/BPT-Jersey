import {
  studentAdminProfileSchema,
  type StudentAdminProfile,
} from "@bpt-jersey/domain/members/directory";
import { buildMemberDirectoryChunkId } from "@bpt-jersey/domain/members/directory-migration";
import { memberDirectoryMaxRowsPerChunk } from "@bpt-jersey/domain/members/directory-transitions";
import { parseStudentProfile, type StudentProfile } from "@bpt-jersey/domain/profiles";

import type { MemberDirectoryChunkDomainWrite } from "./member-directory-chunk-runner.js";
import {
  buildStudentIdentityKey,
  buildStudentIdentityKeyTuple,
  createMemberDirectoryChunkOutputSetMac,
  studentIdentityKeySchema,
  type StudentIdentityKey,
  type StudentIdentityKeyKind,
} from "./member-directory-crypto.js";

/**
 * The identity-key bootstrap chunk executor (T108) - the first of the seven, and the one whose
 * domain writes are the narrowest: it creates the identity reservations that the students who
 * predate writer activation should already have had.
 *
 * It is a pure function over documents that were already read. The runner owns the transaction and
 * the freeze rules; this owns the question the runner deliberately knows nothing about - which
 * documents this chunk writes, and whether it may write at all.
 *
 * Two properties of bootstrap shape everything below, and both come from
 * `docs/data/migrations/member-directory-v1.md`:
 *
 * - It is **additive and idempotent**. A key that already exists and is compatible is preserved,
 *   not rewritten, which is what lets a failed bootstrap be abandoned without deleting anything and
 *   a later one adopt every compatible key.
 * - It **never quarantines**. Quarantine is the forward phase's answer to a row it cannot migrate;
 *   here an unreadable, cross-tenant, reassigned or unattributable record fails the chunk closed and
 *   leaves the freeze standing. Bootstrap creates reservations that guard identity uniqueness, so
 *   skipping a row it could not understand would open exactly the hole the reservation exists to
 *   close.
 */

const identityKeyPathPrefix = "studentIdentityKeys";

export type MemberDirectoryBootstrapObservedRow = Readonly<{
  /** The student ID this row was planned under, before anything was read. */
  studentId: string;
  /** The direct-get of `students/{studentId}`; undefined when the document is gone. */
  student: unknown;
  /** The direct-get of `studentAdminProfiles/{studentId}`; undefined when the document is gone. */
  profile: unknown;
}>;

export type MemberDirectoryBootstrapChunkInput = Readonly<{
  academyId: string;
  operationId: string;
  chunkNo: number;
  /** The exact ordered slice of the frozen plan this chunk covers. */
  plannedStudentIds: readonly string[];
  /** The direct-gets for those IDs, in the same order. */
  observed: readonly MemberDirectoryBootstrapObservedRow[];
  /** Every `studentIdentityKeys` document read for the expected keys of this chunk. */
  existingKeys: readonly unknown[];
  now: string;
  actorId: string;
}>;

export type MemberDirectoryBootstrapChunkDependencies = Readonly<{
  identitySecretMaterial: string;
  identitySecretVersion: string;
  integritySecretMaterial: string;
}>;

export type MemberDirectoryBootstrapChunkPlan = Readonly<{
  chunkId: string;
  rowCount: number;
  /** Always zero: bootstrap fails closed instead of quarantining. */
  quarantinedCount: 0;
  createdKeyCount: number;
  preservedKeyCount: number;
  /**
   * The `(kind,keyId,ownerStudentId,digestVersion,secretVersion)` tuples this chunk's rows are
   * expected to own, in canonical lexical order. Verification folds the tuples of every chunk into
   * `identityKeyBaselineMac`, so emitting them here is what lets that step recompute the baseline
   * without re-deriving keys from raw identifiers a second time.
   */
  expectedKeyTuples: readonly string[];
  domainWrites: readonly MemberDirectoryChunkDomainWrite[];
  outputSetMac: string;
}>;

function bootstrapFailure(reason: string): never {
  throw new Error(`Member directory bootstrap chunk refused: ${reason}`);
}

function identityKeyPath(academyId: string, keyId: string): string {
  return `academies/${academyId}/${identityKeyPathPrefix}/${keyId}`;
}

function parsedStudent(value: unknown, studentId: string): StudentProfile {
  if (value === undefined || value === null) {
    bootstrapFailure(`planned student ${studentId} no longer exists`);
  }
  const parsed = parseStudentProfile(value);
  if (!parsed.ok) {
    bootstrapFailure(`student ${studentId} is not a valid record`);
  }
  return parsed.value;
}

function parsedProfile(value: unknown, studentId: string): StudentAdminProfile {
  if (value === undefined || value === null) {
    // An admin profile missing for a planned student is the orphan case, not an empty row: the
    // plan was frozen over the join of both collections, so one half vanishing means the freeze
    // did not hold.
    bootstrapFailure(`planned student ${studentId} has no admin profile`);
  }
  const parsed = studentAdminProfileSchema.safeParse(value);
  if (!parsed.success) {
    bootstrapFailure(`admin profile ${studentId} is not a valid record`);
  }
  return parsed.data;
}

/**
 * The current identifiers a student is expected to hold a reservation for.
 *
 * All five kinds are covered on purpose. Leaving `auth-user-id` out would let a bootstrapped
 * student's own self-service profile find no reservation and mint a second student for the same
 * person, and leaving `legacy-member-id` out would free the legacy identifier for reuse - the two
 * failures the baseline exists to make impossible.
 */
function expectedIdentityValues(
  student: StudentProfile,
  profile: StudentAdminProfile,
): readonly Readonly<{ kind: StudentIdentityKeyKind; value: string }>[] {
  const candidates: Readonly<{ kind: StudentIdentityKeyKind; value: string | undefined }>[] = [
    { kind: "membership-number", value: profile.membershipNumber },
    { kind: "id-card-number", value: profile.idCardNumber },
    { kind: "vat-number", value: profile.vatNumber },
    {
      kind: "legacy-member-id",
      value: profile.source === "legacy-member-migration" ? profile.legacyMemberId : undefined,
    },
    { kind: "auth-user-id", value: student.userId },
  ];
  return Object.freeze(
    candidates.flatMap(({ kind, value }) => (value === undefined ? [] : [{ kind, value }])),
  );
}

/**
 * Plans one bootstrap chunk: what it must create, what it may leave alone, and the MAC that proves
 * the two together. It performs no I/O and makes no decision about the control plane - the caller
 * hands the result to `runMemberDirectoryChunkCommit`, which decides whether it may commit at all.
 */
export function planMemberDirectoryBootstrapChunk(
  input: MemberDirectoryBootstrapChunkInput,
  dependencies: MemberDirectoryBootstrapChunkDependencies,
): MemberDirectoryBootstrapChunkPlan {
  const chunkId = buildMemberDirectoryChunkId({
    operationId: input.operationId,
    phase: "bootstrap",
    chunkNo: input.chunkNo,
  });

  if (input.plannedStudentIds.length === 0) {
    // A zero-row bootstrap is a real case, but it is the parent's audited frozen -> applying
    // transition, not a chunk. An empty chunk would write a receipt certifying nothing.
    bootstrapFailure("a chunk must cover at least one planned student");
  }
  if (input.plannedStudentIds.length > memberDirectoryMaxRowsPerChunk) {
    bootstrapFailure(
      `a chunk covers at most ${String(memberDirectoryMaxRowsPerChunk)} planned students`,
    );
  }
  input.plannedStudentIds.forEach((studentId, index) => {
    const previous = input.plannedStudentIds[index - 1];
    // Strictly ascending document-ID order, because that is the order the bounded scan froze the
    // plan in. Equal neighbours are the duplicate case and are caught by the same comparison.
    if (previous !== undefined && studentId <= previous) {
      bootstrapFailure("planned students must ascend by document ID without repeats");
    }
  });
  if (input.observed.length !== input.plannedStudentIds.length) {
    bootstrapFailure("the documents read do not cover the planned students exactly");
  }

  const keysById = new Map<string, StudentIdentityKey>();
  for (const value of input.existingKeys) {
    const parsed = studentIdentityKeySchema.safeParse(value);
    if (!parsed.success) {
      // A malformed reservation is unattributable: it cannot be proven compatible, and treating it
      // as absent would try to create a key over a document that already exists.
      bootstrapFailure("an existing identity key is not a valid record");
    }
    if (keysById.has(parsed.data.keyId)) {
      bootstrapFailure("an existing identity key was supplied twice");
    }
    keysById.set(parsed.data.keyId, parsed.data);
  }

  const creations: StudentIdentityKey[] = [];
  const tuples: string[] = [];
  const claimedKeyIds = new Set<string>();
  let preservedKeyCount = 0;

  input.plannedStudentIds.forEach((plannedStudentId, index) => {
    const row = input.observed[index];
    if (row === undefined || row.studentId !== plannedStudentId) {
      bootstrapFailure("the documents read are not in the planned order");
    }
    const student = parsedStudent(row.student, plannedStudentId);
    const profile = parsedProfile(row.profile, plannedStudentId);
    if (student.studentId !== plannedStudentId || profile.studentId !== plannedStudentId) {
      bootstrapFailure(`student ${plannedStudentId} does not own the documents read for it`);
    }
    if (student.academyId !== input.academyId || profile.academyId !== input.academyId) {
      bootstrapFailure(`student ${plannedStudentId} belongs to another academy`);
    }

    for (const candidate of expectedIdentityValues(student, profile)) {
      const expected = buildStudentIdentityKey({
        academyId: input.academyId,
        kind: candidate.kind,
        value: candidate.value,
        ownerStudentId: plannedStudentId,
        secretMaterial: dependencies.identitySecretMaterial,
        secretVersion: dependencies.identitySecretVersion,
        now: input.now,
        actorId: input.actorId,
      });
      if (claimedKeyIds.has(expected.keyId)) {
        // Two rows of one chunk deriving the same key means two students claim one identifier.
        bootstrapFailure("two planned students claim the same current identifier");
      }
      claimedKeyIds.add(expected.keyId);
      tuples.push(buildStudentIdentityKeyTuple(expected));

      const stored = keysById.get(expected.keyId);
      if (stored === undefined) {
        creations.push(expected);
        continue;
      }
      if (stored.ownerStudentId !== expected.ownerStudentId) {
        // Reassigned: the identifier is already reserved for someone else. Preserving the freeze is
        // the whole point - resolving it needs a human, not a heuristic.
        bootstrapFailure("an existing identity key is owned by another student");
      }
      if (
        stored.academyId !== expected.academyId ||
        stored.kind !== expected.kind ||
        stored.digestVersion !== expected.digestVersion ||
        stored.secretVersion !== expected.secretVersion
      ) {
        // A key under another secret or digest version cannot be proven to cover this identifier.
        // Rotation needs the approved multi-version protocol, which is outside v1.
        bootstrapFailure("an existing identity key is not compatible with the planned key");
      }
      preservedKeyCount += 1;
    }
  });

  const domainWrites = Object.freeze(
    creations
      .map((key): MemberDirectoryChunkDomainWrite =>
        Object.freeze({
          operation: "create" as const,
          path: identityKeyPath(input.academyId, key.keyId),
          data: key,
        }),
      )
      // Sorted by path so the same plan produces the same write list every time it is replanned.
      // Paths are unique here - a repeated key ID was already refused - so the order is total.
      .sort((left, right) => (left.path > right.path ? 1 : -1)),
  );

  return Object.freeze({
    chunkId,
    rowCount: input.plannedStudentIds.length,
    quarantinedCount: 0 as const,
    createdKeyCount: domainWrites.length,
    preservedKeyCount,
    expectedKeyTuples: Object.freeze([...tuples].sort()),
    domainWrites,
    outputSetMac: createMemberDirectoryChunkOutputSetMac({
      chunkId,
      phase: "bootstrap",
      writes: domainWrites,
      secretMaterial: dependencies.integritySecretMaterial,
    }),
  });
}
