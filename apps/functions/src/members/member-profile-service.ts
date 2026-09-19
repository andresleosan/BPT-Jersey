import type { FamilyRecord, FamilyRelationship } from "@bpt-jersey/domain/families";
import {
  maskMembershipReference,
  memberNamesLimit,
  toMemberRecordMaintenanceDetail,
  type StudentAdminProfile,
} from "@bpt-jersey/domain/members/directory";
import {
  academyDateOf,
  deriveBirthdayBadge,
  memberAgeOn,
  memberNameSearchLimit,
  memberNameSearchRequestSchema,
  memberNameSearchResultSchema,
  memberProfileSchema,
  nextFreeMemberNumber,
  wholeMonthsBetween,
  type CoachMemberProfile,
  type FullMemberProfile,
  type MemberNameSearchResult,
  type MemberProfileCards,
} from "@bpt-jersey/domain/members/profile";
import {
  currentMembershipStatuses,
  type MembershipRecord,
} from "@bpt-jersey/domain/memberships/lifecycle";
import type { StudentProfile } from "@bpt-jersey/domain/profiles";

import type { MemberProfileRecord } from "./canonical-member-directory-read-service.js";

export type MemberProfileStore = Readonly<{
  getFamily: (academyId: string, familyId: string) => Promise<FamilyRecord | undefined>;
  listStudentRelationships: (
    academyId: string,
    studentId: string,
  ) => Promise<readonly FamilyRelationship[]>;
  getUserDisplayName: (academyId: string, userId: string) => Promise<string | undefined>;
  listStudentMemberships: (
    academyId: string,
    studentId: string,
  ) => Promise<readonly MembershipRecord[]>;
  getPlanDisplayName: (academyId: string, planId: string) => Promise<string | undefined>;
  listMembershipNumbers: (
    academyId: string,
    limit: number,
  ) => Promise<readonly (string | undefined)[]>;
  listStudentNames: (
    academyId: string,
    limit: number,
  ) => Promise<readonly Readonly<{ studentId: string; fullName: string }>[]>;
}>;

export class MemberProfileError extends Error {
  public constructor(
    public readonly code: "invalid" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "MemberProfileError";
  }
}

export type MemberProfileService = Readonly<{
  fullProfile: (
    input: Readonly<{ academyId: string; record: MemberProfileRecord; now: string }>,
  ) => Promise<FullMemberProfile>;
  coachProfile: (input: Readonly<{ student: StudentProfile; now: string }>) => CoachMemberProfile;
  searchNames: (
    input: Readonly<{ academyId: string; value: unknown }>,
  ) => Promise<MemberNameSearchResult>;
}>;

const maxAccountManagers = 10;

function headerBase(student: StudentProfile, today: string) {
  return {
    studentId: student.studentId,
    fullName: student.fullName,
    age: memberAgeOn(student.dateOfBirth, today),
    participantType: student.participantType,
    status: student.status,
    birthdayBadge: deriveBirthdayBadge(student.dateOfBirth, today),
  };
}

/** A member with no admin profile is shown with the defaults the writer would create (Task 4). */
function profileOrDefault(
  student: StudentProfile,
  profile: StudentAdminProfile | undefined,
): StudentAdminProfile {
  return (
    profile ?? {
      studentId: student.studentId,
      academyId: student.academyId,
      gender: "unknown",
      source: "admin",
      schemaVersion: "1",
      createdAt: student.createdAt,
      createdBy: student.createdBy,
      updatedAt: student.updatedAt,
      updatedBy: student.updatedBy,
    }
  );
}

function isCurrentGuardian(relationship: FamilyRelationship, student: StudentProfile, now: string) {
  return (
    relationship.studentId === student.studentId &&
    relationship.academyId === student.academyId &&
    relationship.relationshipType === "guardian" &&
    relationship.active &&
    relationship.status === "active" &&
    relationship.validFrom <= now &&
    (relationship.validTo === undefined || relationship.validTo > now)
  );
}

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function createMemberProfileService(
  dependencies: Readonly<{ store: MemberProfileStore }>,
): MemberProfileService {
  const { store } = dependencies;

  async function accountManagers(
    academyId: string,
    student: StudentProfile,
    now: string,
  ): Promise<MemberProfileCards["accountManagers"]> {
    const candidates: { userId: string; familyId: string }[] = [];
    if (student.participantType === "minor") {
      const relationships = await store.listStudentRelationships(academyId, student.studentId);
      for (const relationship of relationships) {
        if (isCurrentGuardian(relationship, student, now)) {
          candidates.push({ userId: relationship.adultUserId, familyId: relationship.familyId });
        }
      }
    } else if (student.familyId !== undefined) {
      const family = await store.getFamily(academyId, student.familyId);
      if (
        family !== undefined &&
        family.active &&
        family.primaryContactUserId !== null &&
        family.primaryContactUserId !== student.userId
      ) {
        candidates.push({ userId: family.primaryContactUserId, familyId: family.familyId });
      }
    }
    const seen = new Set<string>();
    const managers: { displayName: string; familyId: string }[] = [];
    for (const candidate of candidates) {
      if (seen.has(candidate.userId) || managers.length >= maxAccountManagers) continue;
      seen.add(candidate.userId);
      const displayName = (await store.getUserDisplayName(academyId, candidate.userId))?.trim();
      if (displayName !== undefined && displayName.length > 0) {
        managers.push({ displayName, familyId: candidate.familyId });
      }
    }
    return managers;
  }

  async function currentMembership(
    academyId: string,
    studentId: string,
  ): Promise<MemberProfileCards["currentMembership"]> {
    const memberships = await store.listStudentMemberships(academyId, studentId);
    const current = memberships
      .filter((membership) =>
        (currentMembershipStatuses as readonly string[]).includes(membership.status),
      )
      .sort((left, right) => right.startsAt.localeCompare(left.startsAt))[0];
    if (current === undefined) return null;
    const planName = (await store.getPlanDisplayName(academyId, current.planId)) ?? current.planId;
    return {
      membershipId: current.membershipId,
      planName,
      status: current.status as (typeof currentMembershipStatuses)[number],
      validUntil: current.endsAt === null ? null : current.endsAt.slice(0, 10),
    };
  }

  return Object.freeze({
    async fullProfile({ academyId, record, now }) {
      const today = academyDateOf(now);
      const { student, adminProfile } = record;
      const profile = profileOrDefault(student, adminProfile);
      const maskedMemberReference = maskMembershipReference(profile.membershipNumber);
      const memberSince = profile.details?.registeredOn ?? student.createdAt.slice(0, 10);
      const [managers, membership, numbers] = await Promise.all([
        accountManagers(academyId, student, now),
        currentMembership(academyId, student.studentId),
        profile.membershipNumber === undefined
          ? store.listMembershipNumbers(academyId, memberNamesLimit)
          : Promise.resolve(undefined),
      ]);
      const parsed = memberProfileSchema.safeParse({
        view: "full",
        header: {
          ...headerBase(student, today),
          ...(maskedMemberReference === undefined ? {} : { maskedMemberReference }),
        },
        cards: {
          memberSince,
          monthsAsMember: wholeMonthsBetween(memberSince, today),
          ...(profile.details?.profession === undefined
            ? {}
            : { profession: profile.details.profession }),
          accountManagers: managers,
          currentMembership: membership,
        },
        details: toMemberRecordMaintenanceDetail(student, profile),
        ...(numbers === undefined ? {} : { nextFreeMemberNumber: nextFreeMemberNumber(numbers) }),
      });
      if (!parsed.success || parsed.data.view !== "full") {
        throw new MemberProfileError("unavailable", "Member profile projection is invalid");
      }
      return parsed.data;
    },

    coachProfile({ student, now }) {
      const parsed = memberProfileSchema.safeParse({
        view: "coach",
        header: headerBase(student, academyDateOf(now)),
      });
      if (!parsed.success || parsed.data.view !== "coach") {
        throw new MemberProfileError("unavailable", "Member profile projection is invalid");
      }
      return parsed.data;
    },

    async searchNames({ academyId, value }) {
      const request = memberNameSearchRequestSchema.safeParse(value);
      if (!request.success) throw new MemberProfileError("invalid", "Invalid name search");
      const students = await store.listStudentNames(academyId, memberNamesLimit + 1);
      if (students.length > memberNamesLimit) {
        throw new MemberProfileError("unavailable", "Too many members to search at once");
      }
      const needle = normalizeName(request.data.query);
      // ponytail: in-memory scan of at most 2000 names per search; an indexed search is the next step.
      const members = students
        .filter((student) => normalizeName(student.fullName).includes(needle))
        .sort((left, right) => left.fullName.localeCompare(right.fullName, "en-GB"))
        .slice(0, memberNameSearchLimit)
        .map((student) => ({ studentId: student.studentId, fullName: student.fullName }));
      const parsed = memberNameSearchResultSchema.safeParse({ members });
      if (!parsed.success) throw new MemberProfileError("unavailable", "Name search is invalid");
      return parsed.data;
    },
  });
}
