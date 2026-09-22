import type { MemberRecord } from "@bpt-jersey/domain/members";
import {
  buildMemberMigrationQueue,
  migrationIdentityValues,
  reviewedMigrationValues,
  decideMemberMigrationInputSchema,
  noTrainingTimePreference,
  toMemberMigrationQueueResponse,
  unconfirmedTrainingCenterPlaceholder,
  type ArchiveRecordInput,
  type DecideMemberMigrationResult,
  type LegacyMemberInput,
  type MemberMigrationDecisionInput,
  type MemberMigrationQueueResponse,
  type MemberMigrationRejectionCode,
} from "@bpt-jersey/domain/members/migration";
import { normalizeAdministrativeIdentifier } from "@bpt-jersey/domain/members/directory";
import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import {
  CanonicalMemberDirectoryError,
  legacyMigrationErrorMessages,
  type CanonicalMemberDirectoryActor,
  type OfficeMemberDirectoryService,
} from "./canonical-member-directory-service.js";

export type MemberMigrationSnapshot = Readonly<{
  versions: Readonly<{ members: Readonly<Record<string, string>>; records: Readonly<Record<string, string>> }>;
  members: readonly MemberRecord[];
  records: readonly RegyfitMemberRecord[];
  decidedMemberIds: ReadonlySet<string>;
  linkedRecordIds: ReadonlySet<string>;
}>;
export type MemberMigrationStore = Readonly<{
  load(academyId: string): Promise<MemberMigrationSnapshot>;
}>;
export type MemberMigrationWriter = Pick<
  OfficeMemberDirectoryService,
  "registerLegacyMember" | "skipLegacyMember"
>;

export class MemberMigrationInputError extends Error {}

const toMemberInput = (member: MemberRecord): LegacyMemberInput => ({
  memberId: member.memberId,
  fullName: member.fullName,
  ...(member.birthDate === undefined ? {} : { birthDate: member.birthDate }),
  ...(member.membershipNumber === undefined ? {} : { membershipNumber: member.membershipNumber }),
  ...(member.idCardNumber === undefined ? {} : { idCardNumber: member.idCardNumber }),
});
const toRecordInput = (record: RegyfitMemberRecord): ArchiveRecordInput => ({
  recordId: record.recordId,
  fullName: record.fullName,
  ...(record.birthDate === undefined ? {} : { birthDate: record.birthDate }),
  ...(record.memberNumber === undefined ? {} : { memberNumber: record.memberNumber }),
  ...(record.idCardNumber === undefined ? {} : { idCardNumber: record.idCardNumber }),
});

function rejectionFor(error: unknown): MemberMigrationRejectionCode {
  if (!(error instanceof CanonicalMemberDirectoryError)) return "write-failed";
  if (error.code === "invalid" && error.message === "Invalid admin student input")
    return "invalid-member-data";
  if (error.message === legacyMigrationErrorMessages.alreadyDecided) return "already-decided";
  if (error.message === legacyMigrationErrorMessages.recordLinked) return "record-already-linked";
  if (error.message === "Administrative identifier is already reserved")
    return "identifier-reserved";
  if (error.message === "Imported identity changed. Refresh before registering.")
    return "identity-changed";
  return "write-failed";
}

export function createMemberMigrationService(
  deps: Readonly<{ store: MemberMigrationStore; writer: MemberMigrationWriter; now: () => string }>,
) {
  async function queueFor(academyId: string) {
    const snapshot = await deps.store.load(academyId);
    const members = snapshot.members.map(toMemberInput);
    const records = snapshot.records.map(toRecordInput);
    const queue = buildMemberMigrationQueue({
      members,
      records,
      decidedMemberIds: snapshot.decidedMemberIds,
      linkedRecordIds: snapshot.linkedRecordIds,
      today: deps.now().slice(0, 10),
    });
    return { snapshot, members, records, queue };
  }

  return {
    async listQueue(actor: CanonicalMemberDirectoryActor): Promise<MemberMigrationQueueResponse> {
      const { snapshot, members, records, queue } = await queueFor(actor.academyId);
      return toMemberMigrationQueueResponse(
        queue,
        members,
        records,
        snapshot.decidedMemberIds.size,
        snapshot.versions,
        (memberId, recordId) => migrationIdentityValues(snapshot.members.find((member) => member.memberId === memberId)!, snapshot.records.find((record) => record.recordId === recordId)).conflicts,
      );
    },

    async decide(
      actor: CanonicalMemberDirectoryActor,
      input: unknown,
    ): Promise<DecideMemberMigrationResult> {
      const parsed = decideMemberMigrationInputSchema.safeParse(input);
      if (!parsed.success) throw new MemberMigrationInputError("Invalid migration decisions");
      const { snapshot, queue } = await queueFor(actor.academyId);
      const members = new Map(snapshot.members.map((member) => [member.memberId, member]));
      const records = new Map(snapshot.records.map((record) => [record.recordId, record]));
      const rows = new Map(queue.rows.map((row) => [row.legacyMemberId, row]));
      const results: DecideMemberMigrationResult["results"] = [];

      for (const decision of parsed.data.decisions) {
        const reject = (code: MemberMigrationRejectionCode) =>
          results.push({ legacyMemberId: decision.legacyMemberId, status: "rejected", code });
        const member = members.get(decision.legacyMemberId);
        if (member === undefined) {
          reject("unknown-member");
          continue;
        }
        const row = rows.get(decision.legacyMemberId);
        if (row === undefined) {
          reject("already-decided");
          continue;
        }
        if (decision.kind !== "skip") {
          const record = decision.kind === "link" ? records.get(decision.recordId) : undefined;
          if (snapshot.versions.members[member.memberId] !== decision.review.legacyVersion ||
              (decision.kind === "link" && snapshot.versions.records[decision.recordId] !== decision.review.recordVersion)) {
            reject("identity-changed"); continue;
          }
          const conflicts = migrationIdentityValues(member, record).conflicts;
          if (parsed.data.decisions.length > 1 && (decision.kind !== "link" || row.category !== "strong" || conflicts.length)) {
            reject("batch-requires-compatible-identity"); continue;
          }
          if (conflicts.some((field) => !decision.review.choices.some((choice) => choice.field === field))) {
            reject("conflicts-require-review"); continue;
          }
        }
        try {
          if (decision.kind === "skip") {
            await deps.writer.skipLegacyMember({
              actor,
              legacyMemberId: member.memberId,
              reason: decision.reason,
              now: deps.now(),
            });
            results.push({ legacyMemberId: member.memberId, status: "applied" });
          } else {
            const created = await deps.writer.registerLegacyMember(
              registrationFor(
                actor,
                member,
                decision,
                row.candidates,
                records,
                deps.now(),
              ),
            );
            results.push({
              legacyMemberId: member.memberId,
              status: "applied",
              studentId: created.studentId,
            });
          }
          rows.delete(member.memberId);
        } catch (error) {
          if (error instanceof MemberMigrationInputError) {
            reject("not-a-candidate");
            continue;
          }
          reject(rejectionFor(error));
        }
      }
      return { results };
    },
  };
}

function registrationFor(
  actor: CanonicalMemberDirectoryActor,
  member: MemberRecord,
  decision: Exclude<MemberMigrationDecisionInput, { kind: "skip" }>,
  candidates: readonly Readonly<{ recordId: string }>[],
  records: ReadonlyMap<string, RegyfitMemberRecord>,
  now: string,
) {
  const record = decision.kind === "link" ? records.get(decision.recordId) : undefined;
  if (decision.kind === "link" && (!record || !candidates.some((candidate) => candidate.recordId === decision.recordId))) {
    throw new MemberMigrationInputError("not-a-candidate");
  }
  const chosen = reviewedMigrationValues(member, record, decision.review);
  // ponytail: no centre in the decision → placeholder flagged unconfirmed; no preference → all three.
  const training = {
    trainingCenter: decision.trainingCenter ?? unconfirmedTrainingCenterPlaceholder,
    trainingTimePreferences: [...(decision.trainingTimePreferences ?? noTrainingTimePreference)],
  };
  const trainingCenterStatus = decision.trainingCenter === undefined ? ("unconfirmed" as const) : undefined;
  return {
    actor, now, legacyMemberId: member.memberId, ...(record ? { recordId: record.recordId } : {}),
    review: decision.review, ...training,
    ...(trainingCenterStatus ? { trainingCenterStatus } : {}),
    value: {
      requestId: decision.requestId, fullName: chosen.fullName!,
      ...(chosen.birthDate ? { dateOfBirth: chosen.birthDate } : {}), ...training,
      ...(chosen.membershipNumber ? { membershipNumber: normalizeAdministrativeIdentifier(chosen.membershipNumber) } : {}),
      ...(chosen.idCardNumber ? { idCardNumber: normalizeAdministrativeIdentifier(chosen.idCardNumber) } : {}),
      ...(chosen.vatNumber ? { vatNumber: normalizeAdministrativeIdentifier(chosen.vatNumber) } : {}),
      ...(chosen.email ? { email: chosen.email } : {}),
      ...(chosen.mobileNumber ? { phoneNumber: chosen.mobileNumber } : {}), gender: chosen.gender,
    },
  };
}
