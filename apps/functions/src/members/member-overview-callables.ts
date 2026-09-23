import {
  buildMemberOverview,
  type OverviewFamilySource,
  type OverviewMembershipSource,
  type OverviewStudentSource,
} from "@bpt-jersey/domain/members/overview";
import type { ParticipantType } from "@bpt-jersey/domain/memberships";
import { parseEffectiveStudentProfileAt } from "@bpt-jersey/domain/profiles";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";

/**
 * The whole directory in one office read, next to the data (europe-west9). The academy has a few
 * hundred members, so five bounded collection reads beat a paginated, cursor-signed protocol.
 * ponytail: hard bound of 500 per collection; page it the day the academy outgrows that.
 */
const bound = 500;

export async function memberOverviewHandler(academyId: string, now: string) {
  const firestore = getFirestore();
  const root = `academies/${academyId}`;
  const read = (name: string) => firestore.collection(`${root}/${name}`).limit(bound + 1).get();
  const [students, memberships, plans, families, decisions, levels] = await Promise.all([
    read("students"),
    read("memberships"),
    read("plans"),
    read("families"),
    read("memberMigrationDecisions"),
    read("studentLevelProgress"),
  ]);
  if (students.size > bound) throw new HttpsError("failed-precondition", "The directory is too large for one page.");
  const today = dateKeyInJersey(new Date(now));
  const legacyStudentIds = new Set(
    decisions.docs.map((document) => document.get("studentId")).filter((id): id is string => typeof id === "string"),
  );
  const studentRows: OverviewStudentSource[] = [];
  for (const document of students.docs) {
    const parsed = parseEffectiveStudentProfileAt(document.data(), today);
    if (!parsed.ok || parsed.value.academyId !== academyId) continue; // invalid documents are the record page's problem
    const student = parsed.value;
    studentRows.push({
      studentId: student.studentId,
      fullName: student.fullName,
      ...(student.dateOfBirth ? { dateOfBirth: student.dateOfBirth } : {}),
      trainingCenter: student.trainingCenter,
      ...(student.trainingCenterStatus ? { trainingCenterStatus: student.trainingCenterStatus } : {}),
      ...(student.guardianStatus ? { guardianStatus: student.guardianStatus } : {}),
      ...(student.reviewReason ? { reviewReason: student.reviewReason } : {}),
      active: student.active,
      ...(student.userId ? { userId: student.userId } : {}),
      ...(student.familyId ? { familyId: student.familyId } : {}),
      legacy: legacyStudentIds.has(student.studentId),
    });
  }
  const membershipsByStudent = new Map<string, OverviewMembershipSource[]>();
  for (const document of memberships.docs) {
    const data = document.data();
    if (typeof data.studentId !== "string" || typeof data.planId !== "string" || typeof data.startsAt !== "string") continue;
    const list = membershipsByStudent.get(data.studentId) ?? [];
    list.push({
      studentId: data.studentId,
      planId: data.planId,
      status: String(data.status ?? ""),
      startsAt: data.startsAt,
      endsAt: typeof data.endsAt === "string" ? data.endsAt : null,
    });
    membershipsByStudent.set(data.studentId, list);
  }
  const planNames = new Map(
    plans.docs.map((document) => [document.id, String(document.get("displayName") ?? document.id)]),
  );
  const bands: readonly ParticipantType[] = ["kids", "teens", "adult"];
  const planBands = new Map(
    plans.docs.map((document) => {
      const eligible: unknown = document.get("eligibleParticipantTypes");
      return [
        document.id,
        Array.isArray(eligible) ? bands.filter((band) => eligible.includes(band)) : [],
      ] as const;
    }),
  );
  const guardianUserIds = families.docs
    .map((document) => document.get("primaryContactUserId"))
    .filter((id): id is string => typeof id === "string");
  const guardianUsers = guardianUserIds.length
    ? await firestore.getAll(...guardianUserIds.map((id) => firestore.doc(`${root}/users/${id}`)))
    : [];
  const guardianNames = new Map(guardianUsers.map((user) => [user.id, String(user.get("displayName") ?? "")]));
  const familiesById = new Map<string, OverviewFamilySource>();
  for (const document of families.docs) {
    const primary = document.get("primaryContactUserId");
    const contactName = document.get("guardianContact")?.fullName;
    const guardianName =
      typeof primary === "string" ? guardianNames.get(primary) : typeof contactName === "string" ? contactName : undefined;
    familiesById.set(document.id, {
      familyId: document.id,
      ...(guardianName ? { guardianName } : {}),
      online: typeof primary === "string",
    });
  }
  const levelByStudent = new Map<string, string>();
  for (const document of levels.docs) {
    const key = document.get("currentDefinitionKey");
    if (typeof key === "string") levelByStudent.set(document.id, key);
  }
  return buildMemberOverview({ students: studentRows, membershipsByStudent, planNames, familiesById, levelByStudent, planBands, now });
}

export const getMemberOverview = onCall(
  { ...browserAdminCallableOptions, region: "europe-west9" },
  async (request) => {
    const actor = await requireActiveOfficeActor(request);
    return memberOverviewHandler(actor.academyId, new Date().toISOString());
  },
);
