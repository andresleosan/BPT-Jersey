import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import { parseStudentProfile, type StudentProfile } from "@bpt-jersey/domain/profiles";
import {
  buildInAppReminders,
  type FinancialAccountSummary,
  type InAppReminderRecord,
} from "@bpt-jersey/domain/reminders";
import type { AttendanceRecord } from "@bpt-jersey/domain/schedule";
import { requireUserActor } from "../auth/user-authorization.js";
import { createFamilyStore } from "../families/family-service.js";
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

    if (actor.role !== "guardian" && actor.role !== "adultStudent") permissionDenied();

    try {
      const audience =
        actor.role === "guardian"
          ? await services.resolveGuardianAudience(actor.academyId, actor.userId)
          : await services.resolveAdultStudentAudience(actor.academyId, actor.userId);
      if (audience === undefined) permissionDenied();

      const [financialAccount, attendance] = await Promise.all([
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
      ]);

      return {
        reminders: buildInAppReminders({
          now: new Date().toISOString(),
          financialAccount,
          attendance,
        }),
      };
    } catch (error) {
      return mapReadError(error);
    }
  };
}

async function findStudentByUserId(
  academyId: string,
  userId: string,
): Promise<StudentProfile | undefined> {
  const snapshot = await getFirestore()
    .collection(`academies/${academyId}/students`)
    .where("userId", "==", userId)
    .limit(2)
    .get();
  if (snapshot.docs.length !== 1) return undefined;
  const document = snapshot.docs[0];
  if (document === undefined) return undefined;
  const parsed = parseStudentProfile(document.data());
  if (!parsed.ok || document.id !== parsed.value.studentId) return undefined;
  const student = parsed.value;
  if (
    student.academyId !== academyId ||
    student.userId !== userId ||
    student.familyId === undefined ||
    !student.active ||
    student.status !== "active"
  ) {
    return undefined;
  }
  return student;
}

function createDefaultReminderServices(): ReminderCallableServices {
  const firestore = getFirestore();
  const familyStore = createFamilyStore({
    auth: {
      getUser: async (userId) => ({ uid: (await getAuth().getUser(userId)).uid }),
    },
    firestore: firestore as unknown as Parameters<typeof createFamilyStore>[0]["firestore"],
  });
  const financeStore = createFinanceStore({
    firestore: firestore as unknown as Parameters<typeof createFinanceStore>[0]["firestore"],
    appendAudit: () => undefined,
  });
  const scheduleStore = createFirestoreScheduleStore({
    firestore: firestore as unknown as Parameters<
      typeof createFirestoreScheduleStore
    >[0]["firestore"],
  });

  return {
    resolveGuardianAudience: async (academyId, userId) => {
      const projection = await familyStore.getGuardianFamily(academyId, userId);
      if (
        projection === undefined ||
        !projection.family.active ||
        projection.family.status !== "active"
      ) {
        return undefined;
      }
      const students = projection.students
        .filter((student) => student.active && student.status === "active")
        .map((student) => ({ studentId: student.studentId, label: student.fullName }));
      return Object.freeze({
        familyIds: Object.freeze([projection.family.familyId]),
        studentIds: Object.freeze(students.map((student) => student.studentId)),
        students: Object.freeze(students),
      });
    },
    resolveAdultStudentAudience: async (academyId, userId) => {
      const student = await findStudentByUserId(academyId, userId);
      if (student === undefined || student.familyId === undefined) return undefined;
      return Object.freeze({
        familyIds: Object.freeze([student.familyId]),
        studentIds: Object.freeze([student.studentId]),
        students: Object.freeze([{ studentId: student.studentId, label: "Your attendance" }]),
      });
    },
    listFinancialAccount: (scope) => financeStore.listFinancialAccount(scope),
    listStudentAttendance: (academyId, studentId) =>
      scheduleStore.listStudentAttendance(academyId, studentId),
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
