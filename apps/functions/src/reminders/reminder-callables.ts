import { createFirestoreMemberAccessService } from "../members/member-access-service.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { listPayerFamilyIds } from "../finance/payer-scope-service.js";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  buildInAppReminders,
  type FinancialAccountSummary,
  type InAppReminderRecord,
} from "@bpt-jersey/domain/reminders";
import type { AttendanceRecord } from "@bpt-jersey/domain/schedule";
import { requireUserActor } from "../auth/user-authorization.js";
import { createFinanceStore, type FinanceReadScope } from "../finance/finance-service.js";
import { createFirestoreScheduleStore } from "../schedule/schedule-service.js";

export type ReminderAudienceStudent = Readonly<{
  studentId: string;
  label: string;
}>;

export type ReminderAudience = Readonly<{
  familyIds: readonly string[];
  studentIds: readonly string[];
  students: readonly ReminderAudienceStudent[];
}>;

export type ReminderCallableServices = Readonly<{
  resolveGuardianAudience: (
    academyId: string,
    userId: string,
  ) => Promise<ReminderAudience | undefined>;
  resolveAdultStudentAudience: (
    academyId: string,
    userId: string,
  ) => Promise<ReminderAudience | undefined>;
  listFinancialAccount: (scope: FinanceReadScope) => Promise<FinancialAccountSummary>;
  listStudentAttendance: (
    academyId: string,
    studentId: string,
  ) => Promise<readonly AttendanceRecord[]>;
  /** T110: classes this student had booked that are cancelled, for the in-app notice. */
  listCancelledSessionsForStudent: (
    academyId: string,
    studentId: string,
  ) => Promise<readonly Readonly<{ title: string; startAt: string; reason: string }>[]>;
}>;

function parseNoPayload(value: unknown): void {
  if (value !== null) {
    throw new HttpsError("invalid-argument", "Reminder filters are not supported");
  }
}

function permissionDenied(): never {
  throw new HttpsError("permission-denied", "Reminder access is not permitted");
}

function mapReadError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  throw new HttpsError("internal", "Reminders are not available");
}

export function createListClientRemindersHandler({
  services,
}: {
  services: ReminderCallableServices;
}) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ reminders: readonly InAppReminderRecord[] }> => {
    const actor = requireUserActor(request);
    parseNoPayload(request.data);

    if (!["guardian", "adultStudent", "teenStudent"].includes(actor.role)) permissionDenied();
    await requireMemberAccountActor(request);

    try {
      const audience =
        actor.role === "guardian"
          ? await services.resolveGuardianAudience(actor.academyId, actor.userId)
          : await services.resolveAdultStudentAudience(actor.academyId, actor.userId);
      if (audience === undefined) permissionDenied();

      const [financialAccount, attendance, cancelledPerStudent] = await Promise.all([
        services.listFinancialAccount({
          academyId: actor.academyId,
          familyIds: audience.familyIds,
          ...(audience.studentIds.length > 0 ? { studentIds: audience.studentIds } : {}),
        }),
        Promise.all(
          audience.students.map(async (student) => ({
            label: student.label,
            records: await services.listStudentAttendance(actor.academyId, student.studentId),
          })),
        ),
        Promise.all(
          audience.students.map(async (student) => {
            const sessions = await services.listCancelledSessionsForStudent(
              actor.academyId,
              student.studentId,
            );
            // A guardian is told which child, an adult is told about their own class.
            const label = student.label;
            return sessions.map((session) => ({ ...session, label }));
          }),
        ),
      ]);

      return {
        reminders: buildInAppReminders({
          now: new Date().toISOString(),
          financialAccount,
          attendance,
          cancelledSessions: cancelledPerStudent.flat(),
        }),
      };
    } catch (error) {
      return mapReadError(error);
    }
  };
}

function createDefaultReminderServices(): ReminderCallableServices {
  const firestore = getFirestore();
  const financeStore = createFinanceStore({
    firestore: firestore as unknown as Parameters<typeof createFinanceStore>[0]["firestore"],
    appendAudit: () => undefined,
  });
  const scheduleStore = createFirestoreScheduleStore({
    firestore: firestore as unknown as Parameters<
      typeof createFirestoreScheduleStore
    >[0]["firestore"],
  });

  async function resolveAudience(academyId: string, actorId: string): Promise<ReminderAudience> {
    const [profiles, familyIds] = await Promise.all([createFirestoreMemberAccessService({ firestore }).listProfiles(academyId, actorId), listPayerFamilyIds(academyId, actorId, firestore)]);
    return { familyIds, studentIds: profiles.map((profile) => profile.studentId),
      students: profiles.map((profile) => ({ studentId: profile.studentId, label: profile.fullName })) };
  }
  return {
    resolveGuardianAudience: resolveAudience,
    resolveAdultStudentAudience: resolveAudience,
    listFinancialAccount: (scope) => financeStore.listFinancialAccount(scope),
    listStudentAttendance: (academyId, studentId) =>
      scheduleStore.listStudentAttendance(academyId, studentId),
    listCancelledSessionsForStudent: (academyId, studentId) =>
      scheduleStore.listCancelledSessionsForStudent(academyId, studentId),
  };
}

let defaultServices: ReminderCallableServices | undefined;
function getServices(): ReminderCallableServices {
  defaultServices ??= createDefaultReminderServices();
  return defaultServices;
}

export const reminderCallableOptions = { enforceAppCheck: true };

export const listClientReminders = onCall(reminderCallableOptions, async (request) =>
  createListClientRemindersHandler({ services: getServices() })(request),
);
