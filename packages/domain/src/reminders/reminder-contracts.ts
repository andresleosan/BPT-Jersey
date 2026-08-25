import type { AttendanceRecord } from "../schedule/schedule-contracts";

export const reminderKinds = Object.freeze(["payment", "attendance"] as const);
export type ReminderKind = (typeof reminderKinds)[number];

export type InAppReminderRecord = Readonly<{
  reminderId: string;
  kind: ReminderKind;
  severity: "warning";
  title: string;
  message: string;
  amountMinor: number | null;
  count: number | null;
  createdAt: string;
  schemaVersion: "1";
}>;

export type FinancialAccountSummary = Readonly<{
  balanceMinor: number;
  paygDebtMinor: number;
}>;
export type ReminderAttendanceEntry = Readonly<{
  label: string;
  records: readonly Pick<AttendanceRecord, "state" | "occurredAt">[];
}>;

export type BuildInAppRemindersInput = Readonly<{
  now: string;
  financialAccount: FinancialAccountSummary;
  attendance: readonly ReminderAttendanceEntry[];
  lookbackDays?: number;
}>;

const followUpStates = new Set(["absent", "no_show"] as const);

function validNonNegativeAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function formatGbp(amountMinor: number): string {
  return `£${(amountMinor / 100).toFixed(2)}`;
}

/**
 * Builds safe, read-only reminders from canonical financial and attendance projections.
 * Student IDs, invoice IDs, and attendance IDs never enter the output contract.
 */
export function buildInAppReminders(
  input: BuildInAppRemindersInput,
): readonly InAppReminderRecord[] {
  if (
    !validIsoDate(input.now) ||
    !validNonNegativeAmount(input.financialAccount.balanceMinor) ||
    !validNonNegativeAmount(input.financialAccount.paygDebtMinor)
  ) {
    return Object.freeze([]);
  }

  const lookbackDays = input.lookbackDays ?? 30;
  if (!Number.isSafeInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) {
    return Object.freeze([]);
  }

  const reminders: InAppReminderRecord[] = [];
  const balanceMinor = Math.max(
    input.financialAccount.balanceMinor,
    input.financialAccount.paygDebtMinor,
  );
  if (balanceMinor > 0) {
    reminders.push(
      Object.freeze({
        reminderId: "payment-balance",
        kind: "payment",
        severity: "warning",
        title: "Payment follow-up",
        message: `Your account has an outstanding balance of ${formatGbp(balanceMinor)}.`,
        amountMinor: balanceMinor,
        count: null,
        createdAt: input.now,
        schemaVersion: "1",
      }),
    );
  }

  const cutoff = Date.parse(input.now) - lookbackDays * 24 * 60 * 60 * 1000;
  let attendanceReminderIndex = 0;
  for (const entry of input.attendance) {
    const count = entry.records.filter(
      (record) =>
        followUpStates.has(record.state as "absent" | "no_show") &&
        validIsoDate(record.occurredAt) &&
        Date.parse(record.occurredAt) >= cutoff,
    ).length;
    if (count === 0) continue;

    const label = entry.label.trim() || "your account";
    reminders.push(
      Object.freeze({
        reminderId: `attendance-follow-up-${attendanceReminderIndex++}`,
        kind: "attendance",
        severity: "warning",
        title: "Attendance follow-up",
        message: `${label} has ${count} attendance record${count === 1 ? "" : "s"} to follow up in the last ${lookbackDays} days.`,
        amountMinor: null,
        count,
        createdAt: input.now,
        schemaVersion: "1",
      }),
    );
  }

  return Object.freeze(reminders);
}
