import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { error as logError } from "firebase-functions/logger";
import {
  beltScore,
  leaderboardCohort,
  leaderboardEligible,
  leaderboardRowSchema,
  publicDisplayNames,
  seasonStartFor,
  sessionStreak,
  type LeaderboardCohort,
  type LeaderboardRow,
  type MemberPublicCard,
} from "@bpt-jersey/domain/members/engagement";
import { memberIdentityAliasSchema } from "@bpt-jersey/domain/members/reconciliation";

import { fromData as publicSettingsFrom } from "../account-settings/account-settings-service.js";
import { signPhotoUrl } from "../account-settings/profile-photo.js";
import {
  countedAttendance,
  createLevelCatalogStore,
  type GenericDocumentSnapshot,
} from "../levels/level-service.js";
import type { R2Client } from "../storage/r2-client.js";

/** Same "live plan" rule as the member overview's `currentMembership` (E6). */
const livePlanStatuses = ["active", "trial", "paused", "overdue"];
/** Students summarised at once; each summary is a handful of small reads. */
const progressConcurrency = 10;

type Progress = Pick<
  LeaderboardRow,
  "belt" | "stripes" | "promotionPercent" | "beltScore" | "skillKeys"
>;
const noProgress: Progress = {
  belt: null,
  stripes: 0,
  promotionPercent: null,
  beltScore: 0,
  skillKeys: [],
};

type Candidate = { studentId: string; fullName: string; cohort: LeaderboardCohort };

/**
 * One row per active student on a live plan with a valid date of birth, grouped by the cohort they
 * pay in. Global reads: students, live memberships, identity aliases, public settings, the season's
 * attendance and the published catalogue, each once; per student only the level progress summary.
 * A student whose progress cannot be read keeps a row without belt data.
 */
export async function buildLeaderboardRows(
  db: Firestore,
  academyId: string,
  nowIso: string,
): Promise<Map<LeaderboardCohort, LeaderboardRow[]>> {
  const root = `academies/${academyId}`;
  const seasonStart = seasonStartFor(nowIso);
  // 1 September 00:00 in Jersey (BST), the same boundary the member's own streak panel uses.
  const seasonStartIso = new Date(
    Date.parse(`${seasonStart}T00:00:00.000Z`) - 3_600_000,
  ).toISOString();
  const [students, memberships, aliases, settings, attendance] = await Promise.all([
    db.collection(`${root}/students`).where("status", "==", "active").get(),
    db.collection(`${root}/memberships`).where("status", "in", livePlanStatuses).get(),
    db.collection(`${root}/memberIdentityAliases`).get(),
    db.collection(`${root}/memberPublicSettings`).get(),
    db.collection(`${root}/attendance`).where("occurredAt", ">=", seasonStartIso).get(),
  ]);

  // Historical identities count for their canonical student, as in the member's own streak panel.
  const aliasesOf = new Map<string, string[]>();
  const canonicalOf = new Map<string, string>();
  for (const document of aliases.docs) {
    const parsed = memberIdentityAliasSchema.safeParse(document.data());
    if (
      !parsed.success ||
      parsed.data.academyId !== academyId ||
      parsed.data.studentId !== document.id
    )
      continue;
    canonicalOf.set(document.id, parsed.data.canonicalStudentId);
    aliasesOf.set(parsed.data.canonicalStudentId, [
      ...(aliasesOf.get(parsed.data.canonicalStudentId) ?? []),
      document.id,
    ]);
  }
  const onLivePlan = new Set<string>();
  for (const document of memberships.docs) {
    const data = document.data();
    if (
      typeof data.studentId === "string" &&
      typeof data.startsAt === "string" &&
      data.startsAt <= nowIso &&
      (data.endsAt === null ||
        data.endsAt === undefined ||
        (typeof data.endsAt === "string" && data.endsAt >= nowIso))
    ) {
      // A plan can still sit on a historical identity: it counts for the canonical student.
      onLivePlan.add(canonicalOf.get(data.studentId) ?? data.studentId);
    }
  }

  const candidates: Candidate[] = [];
  for (const document of students.docs) {
    const data = document.data();
    const fullName = typeof data.fullName === "string" ? data.fullName.trim() : "";
    const dateOfBirth = typeof data.dateOfBirth === "string" ? data.dateOfBirth : null;
    // Review focus 2: no valid date of birth → no table, so a child never lands in the adults.
    if (
      data.active !== true ||
      fullName === "" ||
      !onLivePlan.has(document.id) ||
      !leaderboardEligible(dateOfBirth)
    )
      continue;
    candidates.push({
      studentId: document.id,
      fullName,
      cohort: leaderboardCohort(dateOfBirth, nowIso),
    });
  }

  const attendanceByIdentity = new Map<string, QueryDocumentSnapshot[]>();
  for (const document of attendance.docs) {
    const identity = document.get("studentId");
    if (typeof identity !== "string") continue;
    attendanceByIdentity.set(identity, [...(attendanceByIdentity.get(identity) ?? []), document]);
  }
  const settingsById = new Map(settings.docs.map((document) => [document.id, document.data()]));

  const levels = createLevelCatalogStore({ firestore: db as never });
  let catalog: Awaited<ReturnType<typeof levels.listPublished>> | null = null;
  try {
    catalog = await levels.listPublished(academyId);
  } catch {
    logError("Leaderboard build has no published level catalogue", { academyId });
  }

  // Each session document is read at most once per build, however many students attended it.
  const sessionCache = new Map<string, Promise<GenericDocumentSnapshot>>();
  const progressOf = async (studentId: string): Promise<Progress> => {
    if (catalog === null) return noProgress;
    try {
      const summary = await levels.getStudentProgressSummary(
        academyId,
        studentId,
        catalog,
        sessionCache,
      );
      if (summary.state !== "initialized") return noProgress;
      const current = summary.currentDefinition;
      return {
        belt: { name: current.name, color: current.visual.colors[0] ?? "#ffffff" },
        stripes: current.stripeNumber ?? 0,
        promotionPercent: summary.progressPercent,
        beltScore: beltScore(current.sequence, summary.progressPercent),
        skillKeys: summary.skillChecklist
          .filter((item) => item.isCompleted)
          .map((item) => item.skillKey),
      };
    } catch {
      // Known case: more than 400 lifetime attendance records (the level store's safe read limit).
      logError("Leaderboard progress unavailable", { studentId });
      return noProgress;
    }
  };

  const attendedAtOf = (studentId: string): string[] => {
    const identityIds = [studentId, ...(aliasesOf.get(studentId) ?? [])];
    const docs = identityIds.flatMap((id) => attendanceByIdentity.get(id) ?? []);
    try {
      return countedAttendance({ docs } as never, academyId, studentId, identityIds)
        .map((record) => String(record.occurredAt))
        .filter((occurredAt) => occurredAt <= nowIso);
    } catch {
      logError("Leaderboard attendance unavailable", { studentId });
      return [];
    }
  };

  const progressById = new Map<string, Progress>();
  for (let index = 0; index < candidates.length; index += progressConcurrency) {
    const chunk = candidates.slice(index, index + progressConcurrency);
    const results = await Promise.all(chunk.map((candidate) => progressOf(candidate.studentId)));
    chunk.forEach((candidate, offset) =>
      progressById.set(candidate.studentId, results[offset] ?? noProgress),
    );
  }

  const cohorts = new Map<LeaderboardCohort, LeaderboardRow[]>();
  for (const cohort of ["kids", "teens", "adults"] as const) {
    const members = candidates
      .filter((candidate) => candidate.cohort === cohort)
      .sort((a, b) => a.studentId.localeCompare(b.studentId));
    const settingsOf = new Map(
      members.map((member) => [
        member.studentId,
        publicSettingsFrom(academyId, member.studentId, settingsById.get(member.studentId)),
      ]),
    );
    // Q8: the "Mia R." / "Mia Ro." disambiguation only looks at the member's own table, and (Q9)
    // only at its visible members, so a hidden member never shows through someone else's label.
    // A hidden member's own label is worked out against the visible members plus themselves.
    const visible = members.filter((member) => settingsOf.get(member.studentId)?.showToMembers);
    const visibleNames = publicDisplayNames(visible);
    const nameOf = (member: Candidate) =>
      (
        visibleNames.get(member.studentId) ??
        publicDisplayNames([...visible, member]).get(member.studentId) ??
        member.fullName
      ).slice(0, 80);
    const rows: LeaderboardRow[] = [];
    for (const member of members) {
      const attendedAt = attendedAtOf(member.studentId);
      const publicSettings = settingsOf.get(member.studentId)!;
      const row = {
        studentId: member.studentId,
        displayName: nameOf(member),
        ...(progressById.get(member.studentId) ?? noProgress),
        streakCount: sessionStreak(attendedAt, nowIso),
        attendancesSinceSeasonStart: attendedAt.length,
        // Only a consented photo ever reaches a row; toPublicCard relies on it.
        photoObjectKey: publicSettings.photoConsentAt ? publicSettings.photoObjectKey : null,
        hidden: !publicSettings.showToMembers,
      };
      const parsed = leaderboardRowSchema.safeParse(row);
      if (parsed.success) {
        rows.push(parsed.data);
        continue;
      }
      // Keep the member with the safe defaults; drop the row only if even that is invalid.
      logError("Leaderboard row is invalid", { studentId: member.studentId });
      const fallback = leaderboardRowSchema.safeParse({ ...row, ...noProgress });
      if (fallback.success) rows.push(fallback.data);
    }
    cohorts.set(cohort, rows);
  }
  return cohorts;
}

/**
 * What another member sees of a row. The build keeps `photoObjectKey` only when the photo had
 * consent (`photoConsentAt`), so a key on a row is itself the consent check for signing.
 */
export async function toPublicCard(row: LeaderboardRow, r2: R2Client): Promise<MemberPublicCard> {
  const consentCheckedAtBuild = row.photoObjectKey === null ? null : "leaderboard-build";
  // Explicit allowlist: a field added to the row later never leaks into the public card.
  return {
    studentId: row.studentId,
    displayName: row.displayName,
    photoUrl: await signPhotoUrl(r2, row.photoObjectKey, consentCheckedAtBuild),
    belt: row.belt,
    stripes: row.stripes,
    streakCount: row.streakCount,
    attendancesSinceSeasonStart: row.attendancesSinceSeasonStart,
    promotionPercent: row.promotionPercent,
    skillKeys: row.skillKeys,
  };
}
