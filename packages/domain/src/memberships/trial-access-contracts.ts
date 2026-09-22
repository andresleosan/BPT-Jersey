import { z } from "zod";

import { siteValues } from "./plan-contracts";
import type { Site } from "./plan-contracts";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);

export const trialAccessStatuses = Object.freeze([
  "active",
  "exhausted",
  "expired",
  "converted",
] as const);
export type TrialAccessStatus = (typeof trialAccessStatuses)[number];

export const TRIAL_DAYS = 30;

export const trialAccessSchema = z.strictObject({
  trialId: identifier,
  academyId: identifier,
  studentId: identifier,
  site: z.enum(siteValues),
  experience: z.enum(["beginner", "experienced"]),
  allowance: z.union([z.literal(1), z.literal(2)]),
  countedAttendanceIds: z.array(identifier).max(10),
  status: z.enum(trialAccessStatuses),
  startsAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  enrolmentRequestId: identifier,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  schemaVersion: z.literal("1"),
});
export type TrialAccessRecord = z.infer<typeof trialAccessSchema>;

export function trialExpiresAt(startsAt: string): string {
  return new Date(Date.parse(startsAt) + TRIAL_DAYS * 86_400_000).toISOString();
}

export function trialAttendedCount(trial: TrialAccessRecord): number {
  return trial.countedAttendanceIds.length;
}

export function trialStatusAt(trial: TrialAccessRecord, nowIso: string): TrialAccessStatus {
  if (trial.status === "converted") {
    return "converted";
  }
  if (Date.parse(nowIso) >= Date.parse(trial.expiresAt)) {
    return "expired";
  }
  if (trialAttendedCount(trial) >= trial.allowance) {
    return "exhausted";
  }
  return "active";
}

export type TrialAccessView = Readonly<{
  site: Site;
  allowance: 1 | 2;
  attendedCount: number;
  futureBookings: number;
  expiresAt: string;
  status: TrialAccessStatus;
}>;
