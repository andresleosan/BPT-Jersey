import { z } from "zod";
import type { ParticipantType } from "../memberships/plan-contracts";
import { trialStatusAt, type TrialAccessRecord } from "../memberships/trial-access-contracts";
import { participantTypeOn } from "../schedule/member-calendar-contracts";

/**
 * One row per canonical member for the unified Members workspace: identity summary, current plan
 * and its end, guardian/account summary and the review flags the office must resolve. Server
 * projection only; nothing here is a restricted identifier.
 */
export const memberReviewFlags = Object.freeze([
  "centre-unconfirmed",
  "date-of-birth-missing",
  "guardian-required",
  "plan-band-differs",
] as const);
export type MemberReviewFlag = (typeof memberReviewFlags)[number];

export const memberPlanStates = Object.freeze(["current", "expiring", "expired", "trial", "none"] as const);
export type MemberPlanState = (typeof memberPlanStates)[number];

export const memberOverviewRowSchema = z.strictObject({
  studentId: z.string().min(1),
  /** Guardian rows are adults shown only because they look after an active member. */
  rowKind: z.enum(["member", "guardian"]).default("member"),
  userId: z.string().min(1).max(128).optional(),
  fullName: z.string().min(1).max(160),
  age: z.number().int().min(0).max(120).optional(),
  ageBand: z.enum(["kids", "teens", "adult"]).optional(),
  trainingCenter: z.enum(["Town", "West"]),
  centreConfirmed: z.boolean(),
  /** Training on a live plan or trial. */
  active: z.boolean(),
  /** The member record's own status; defaulted so a response from an older server still parses. */
  recordActive: z.boolean().default(true),
  source: z.enum(["regyfit", "bpt"]),
  levelKey: z.string().max(80).optional(),
  plan: z
    .strictObject({
      planId: z.string().min(1),
      displayName: z.string().min(1).max(120),
      status: z.string().min(1),
      endsAt: z.string().nullable(),
    })
    .optional(),
  planState: z.enum(memberPlanStates),
  guardian: z
    .strictObject({ fullName: z.string().max(160), online: z.boolean() })
    .optional(),
  ownAccount: z.boolean(),
  flags: z.array(z.enum(memberReviewFlags)).max(4).readonly(),
});
export type MemberOverviewRow = Readonly<z.infer<typeof memberOverviewRowSchema>>;

export const memberOverviewSchema = z.strictObject({
  // Up to 500 students plus the synthetic guardian rows of family contacts without a record.
  rows: z.array(memberOverviewRowSchema).max(1000).readonly(),
  counters: z.strictObject({
    total: z.number().int().min(0),
    active: z.number().int().min(0),
    expiring: z.number().int().min(0),
    review: z.number().int().min(0),
    inactive: z.number().int().min(0),
    // Defaulted so a response from a server that predates guardian rows still parses.
    guardians: z.number().int().min(0).default(0),
  }),
  generatedAt: z.string().min(1),
});
export type MemberOverview = Readonly<z.infer<typeof memberOverviewSchema>>;

export const expiringWindowDays = 30;

/** A guardian row: looks after an active member and has no live plan or trial of their own. */
export function isGuardianOnly(input: Readonly<{
  hasOwnCoveringPlan: boolean;
  hasActiveTrial: boolean;
  guardsActiveStudent: boolean;
}>): boolean {
  return input.guardsActiveStudent && !input.hasOwnCoveringPlan && !input.hasActiveTrial;
}

export type OverviewStudentSource = Readonly<{
  studentId: string;
  fullName: string;
  dateOfBirth?: string;
  trainingCenter: "Town" | "West";
  trainingCenterStatus?: "unconfirmed";
  guardianStatus?: "pending" | "assigned";
  reviewReason?: "date-of-birth-missing";
  active: boolean;
  userId?: string;
  familyId?: string;
  legacy: boolean;
}>;
export type OverviewMembershipSource = Readonly<{
  studentId: string;
  planId: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
}>;
export type OverviewFamilySource = Readonly<{
  familyId: string;
  primaryContactUserId?: string;
  guardianName?: string;
  online: boolean;
}>;
export type OverviewTrialSource = Readonly<{
  status: string;
  expiresAt: string;
  allowance: number;
  countedAttendanceIds: readonly string[];
}>;
/** A family's primary contact account, shown as a guardian row when it has no member record. */
export type OverviewGuardianUserSource = Readonly<{ userId: string; fullName: string; familyIds: readonly string[] }>;

export const freeTrialPlanId = "free-trial";

function ageOn(dateOfBirth: string, today: string): number {
  let age = Number(today.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  if (today.slice(5) < dateOfBirth.slice(5)) age -= 1;
  return age;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The membership that covers today, else the most recently ended one. */
export function currentMembership(
  memberships: readonly OverviewMembershipSource[],
  now: string,
): OverviewMembershipSource | undefined {
  const live = memberships
    .filter((m) => ["active", "trial", "paused", "overdue"].includes(m.status) && m.startsAt <= now && (m.endsAt === null || m.endsAt >= now))
    .sort((a, b) => (b.endsAt ?? "9") > (a.endsAt ?? "9") ? 1 : -1)[0];
  if (live) return live;
  return memberships
    .filter((m) => m.endsAt !== null)
    .sort((a, b) => ((b.endsAt as string) > (a.endsAt as string) ? 1 : -1))[0];
}

/**
 * Whether the member's own plan covers `now` for the guardian decision: the current membership
 * (active, trial, paused or overdue) has started and has not ended before today. It is not the
 * booking rule, which still needs an active paid membership.
 */
export function hasCoveringMembership(
  memberships: readonly OverviewMembershipSource[],
  now: string,
): boolean {
  const membership = currentMembership(memberships, now);
  const endsDate = membership?.endsAt?.slice(0, 10) ?? null;
  return membership !== undefined && (endsDate === null || endsDate >= now.slice(0, 10)) && membership.startsAt <= now;
}

export function buildMemberOverview(input: {
  students: readonly OverviewStudentSource[];
  membershipsByStudent: ReadonlyMap<string, readonly OverviewMembershipSource[]>;
  planNames: ReadonlyMap<string, string>;
  familiesById: ReadonlyMap<string, OverviewFamilySource>;
  levelByStudent: ReadonlyMap<string, string>;
  /** Plan id → its `eligibleParticipantTypes`, to flag a live plan outside the member's age band. */
  planBands: ReadonlyMap<string, readonly ParticipantType[]>;
  trialsByStudent: ReadonlyMap<string, OverviewTrialSource>;
  /** Primary contacts of families (`families.primaryContactUserId`). */
  guardianUsers: readonly OverviewGuardianUserSource[];
  now: string;
}): MemberOverview {
  const today = input.now.slice(0, 10);
  const expiringUntil = addDays(today, expiringWindowDays);
  const counters = { total: 0, active: 0, expiring: 0, review: 0, inactive: 0, guardians: 0 };
  // First pass: each student's plan standing, so guardians can be judged against their children.
  const standings = new Map(
    input.students.map((student) => {
      const memberships = input.membershipsByStudent.get(student.studentId) ?? [];
      const membership = currentMembership(memberships, input.now);
      const endsDate = membership?.endsAt?.slice(0, 10) ?? null;
      const covering = hasCoveringMembership(memberships, input.now);
      const trial = input.trialsByStudent.get(student.studentId);
      // trialStatusAt reads only status, expiry, allowance and counted attendance; a stored
      // "exhausted" or "expired" status also ends the trial, and a deactivated member has none.
      const activeTrial =
        student.active &&
        trial !== undefined &&
        trial.status === "active" &&
        trialStatusAt(trial as TrialAccessRecord, input.now) === "active";
      const planState: MemberPlanState = covering
        ? endsDate !== null && endsDate <= expiringUntil
          ? "expiring"
          : "current"
        : activeTrial
          ? "trial"
          : membership
            ? "expired"
            : "none";
      const training = student.active && (planState === "current" || planState === "expiring" || planState === "trial");
      return [student.studentId, { membership, covering, activeTrial, trial, planState, training }] as const;
    }),
  );
  const familiesByGuardian = new Map<string, Set<string>>();
  const guard = (userId: string, familyId: string) =>
    familiesByGuardian.set(userId, (familiesByGuardian.get(userId) ?? new Set()).add(familyId));
  for (const family of input.familiesById.values()) if (family.primaryContactUserId) guard(family.primaryContactUserId, family.familyId);
  for (const user of input.guardianUsers) for (const familyId of user.familyIds) guard(user.userId, familyId);
  /** The first training member of a family this user looks after, other than the user's own record. */
  const activeChildOf = (userId: string): OverviewStudentSource | undefined => {
    const familyIds = familiesByGuardian.get(userId);
    if (!familyIds) return undefined;
    return input.students.find(
      (student) =>
        student.familyId !== undefined &&
        familyIds.has(student.familyId) &&
        student.userId !== userId &&
        standings.get(student.studentId)?.training === true,
    );
  };
  const rows = input.students.map((student): MemberOverviewRow => {
    const { membership, covering, activeTrial, trial, planState, training } = standings.get(student.studentId)!;
    const guardianOnly =
      student.userId !== undefined &&
      isGuardianOnly({
        hasOwnCoveringPlan: covering,
        hasActiveTrial: activeTrial,
        guardsActiveStudent: activeChildOf(student.userId) !== undefined,
      });
    const flags: MemberReviewFlag[] = [];
    if (student.trainingCenterStatus === "unconfirmed") flags.push("centre-unconfirmed");
    if (!student.dateOfBirth || student.reviewReason === "date-of-birth-missing") flags.push("date-of-birth-missing");
    if (student.guardianStatus === "pending") flags.push("guardian-required");
    const family = student.familyId ? input.familiesById.get(student.familyId) : undefined;
    const age = student.dateOfBirth ? ageOn(student.dateOfBirth, today) : undefined;
    const ageBand = age === undefined ? undefined : participantTypeOn(student.dateOfBirth as string, today);
    const eligible = membership ? input.planBands.get(membership.planId) : undefined;
    // H3: only flagged for the office; the live subscription is never changed here.
    if (covering && ageBand && eligible && !eligible.includes(ageBand)) flags.push("plan-band-differs");
    // Active means training on a live plan or trial; guardians are counted apart; the rest is inactive.
    counters.total += 1;
    if (training) counters.active += 1;
    else if (guardianOnly) counters.guardians += 1;
    else counters.inactive += 1;
    if (planState === "expiring") counters.expiring += 1;
    if (flags.length > 0) counters.review += 1;
    return {
      studentId: student.studentId,
      rowKind: guardianOnly ? "guardian" : "member",
      fullName: student.fullName,
      ...(age === undefined || ageBand === undefined ? {} : { age, ageBand }),
      trainingCenter: student.trainingCenter,
      centreConfirmed: student.trainingCenterStatus !== "unconfirmed",
      active: training,
      recordActive: student.active,
      source: student.legacy ? "regyfit" : "bpt",
      ...(input.levelByStudent.has(student.studentId) ? { levelKey: input.levelByStudent.get(student.studentId) as string } : {}),
      ...(planState === "trial" && trial
        ? { plan: { planId: freeTrialPlanId, displayName: "Free Trial", status: "active", endsAt: trial.expiresAt } }
        : membership
        ? {
            plan: {
              planId: membership.planId,
              displayName: input.planNames.get(membership.planId) ?? membership.planId,
              status: membership.status,
              endsAt: membership.endsAt,
            },
          }
        : {}),
      planState,
      ...(family?.guardianName ? { guardian: { fullName: family.guardianName, online: family.online } } : {}),
      ownAccount: student.userId !== undefined,
      flags,
    };
  });
  const withRecord = new Set(input.students.map((student) => student.userId).filter((id) => id !== undefined));
  const seen = new Set<string>();
  for (const user of input.guardianUsers) {
    if (withRecord.has(user.userId) || seen.has(user.userId)) continue;
    const child = activeChildOf(user.userId);
    if (!child) continue;
    seen.add(user.userId);
    counters.total += 1;
    counters.guardians += 1;
    rows.push({
      studentId: `guardian:${user.userId}`,
      rowKind: "guardian",
      userId: user.userId,
      fullName: user.fullName,
      trainingCenter: child.trainingCenter,
      centreConfirmed: child.trainingCenterStatus !== "unconfirmed",
      active: false,
      recordActive: true,
      source: "bpt",
      planState: "none",
      ownAccount: true,
      flags: [],
    });
  }
  rows.sort((a, b) => a.fullName.localeCompare(b.fullName, "en-GB"));
  return { rows, counters, generatedAt: input.now };
}

/** Owner-only: removes a member record the office created by mistake (a migration duplicate). */
export const deleteMemberAccountInputSchema = z.strictObject({
  studentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  requestId: z.uuid(),
});
export const deleteMemberAccountResultSchema = z.strictObject({
  studentId: deleteMemberAccountInputSchema.shape.studentId,
  cancelledBookings: z.number().int().min(0),
  removedMemberships: z.number().int().min(0),
});
