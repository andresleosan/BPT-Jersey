import { z } from "zod";
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
] as const);
export type MemberReviewFlag = (typeof memberReviewFlags)[number];

export const memberPlanStates = Object.freeze(["current", "expiring", "expired", "none"] as const);
export type MemberPlanState = (typeof memberPlanStates)[number];

export const memberOverviewRowSchema = z.strictObject({
  studentId: z.string().min(1),
  fullName: z.string().min(1).max(160),
  age: z.number().int().min(0).max(120).optional(),
  ageBand: z.enum(["kids", "teens", "adult"]).optional(),
  trainingCenter: z.enum(["Town", "West"]),
  centreConfirmed: z.boolean(),
  active: z.boolean(),
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
  rows: z.array(memberOverviewRowSchema).max(500).readonly(),
  counters: z.strictObject({
    total: z.number().int().min(0),
    active: z.number().int().min(0),
    expiring: z.number().int().min(0),
    review: z.number().int().min(0),
    inactive: z.number().int().min(0),
  }),
  generatedAt: z.string().min(1),
});
export type MemberOverview = Readonly<z.infer<typeof memberOverviewSchema>>;

export const expiringWindowDays = 30;

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
  guardianName?: string;
  online: boolean;
}>;

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

export function buildMemberOverview(input: {
  students: readonly OverviewStudentSource[];
  membershipsByStudent: ReadonlyMap<string, readonly OverviewMembershipSource[]>;
  planNames: ReadonlyMap<string, string>;
  familiesById: ReadonlyMap<string, OverviewFamilySource>;
  levelByStudent: ReadonlyMap<string, string>;
  now: string;
}): MemberOverview {
  const today = input.now.slice(0, 10);
  const expiringUntil = addDays(today, expiringWindowDays);
  const counters = { total: 0, active: 0, expiring: 0, review: 0, inactive: 0 };
  const rows = input.students.map((student): MemberOverviewRow => {
    const membership = currentMembership(input.membershipsByStudent.get(student.studentId) ?? [], input.now);
    const endsDate = membership?.endsAt?.slice(0, 10) ?? null;
    const covering = membership !== undefined && (endsDate === null || endsDate >= today) && membership.startsAt <= input.now;
    const planState: MemberPlanState = !membership
      ? "none"
      : !covering
        ? "expired"
        : endsDate !== null && endsDate <= expiringUntil
          ? "expiring"
          : "current";
    const flags: MemberReviewFlag[] = [];
    if (student.trainingCenterStatus === "unconfirmed") flags.push("centre-unconfirmed");
    if (!student.dateOfBirth || student.reviewReason === "date-of-birth-missing") flags.push("date-of-birth-missing");
    if (student.guardianStatus === "pending") flags.push("guardian-required");
    const family = student.familyId ? input.familiesById.get(student.familyId) : undefined;
    const age = student.dateOfBirth ? ageOn(student.dateOfBirth, today) : undefined;
    // Active means training on a live plan; anything else (no plan, lapsed, deactivated) is inactive.
    const training = student.active && (planState === "current" || planState === "expiring");
    counters.total += 1;
    if (training) counters.active += 1;
    else counters.inactive += 1;
    if (planState === "expiring") counters.expiring += 1;
    if (flags.length > 0) counters.review += 1;
    return {
      studentId: student.studentId,
      fullName: student.fullName,
      ...(age === undefined ? {} : { age, ageBand: participantTypeOn(student.dateOfBirth as string, today) }),
      trainingCenter: student.trainingCenter,
      centreConfirmed: student.trainingCenterStatus !== "unconfirmed",
      active: training,
      source: student.legacy ? "regyfit" : "bpt",
      ...(input.levelByStudent.has(student.studentId) ? { levelKey: input.levelByStudent.get(student.studentId) as string } : {}),
      ...(membership
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
