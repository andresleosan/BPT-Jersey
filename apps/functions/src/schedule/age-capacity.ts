import { HttpsError } from "firebase-functions/v2/https";
import { parseAgeCapacities, type AgeAvailability } from "@bpt-jersey/domain/schedule/age-capacity";
import { ageOnDate, dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import { isIntroductionClass, type SessionRecord } from "@bpt-jersey/domain/schedule";
import { resolveCanonicalStudentIdInTransaction } from "../members/member-identity-resolution.js";
import type { BookingFirestore, BookingTransaction } from "./booking-transaction-service.js";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { requireUserActor } from "../auth/user-authorization.js";
import { scheduleCallableOptions } from "./schedule-callable-options.js";

type Reader = { firestore: BookingFirestore; transaction: BookingTransaction; academyId: string };

export async function studentAgeAt(input: Reader, studentId: string, startAt: string): Promise<{ studentId: string; age: number }> {
  const canonical = await resolveCanonicalStudentIdInTransaction({ get: async (path) => {
    const doc = await input.transaction.get(input.firestore.doc(path));
    return { id: doc.id, exists: doc.exists, data: doc.data() };
  } }, input.academyId, studentId);
  const profile = await input.transaction.get(input.firestore.doc(`academies/${input.academyId}/students/${canonical}`));
  const dob = profile.data()?.dateOfBirth;
  if (!profile.exists || profile.data()?.academyId !== input.academyId || typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    throw new HttpsError("failed-precondition", "Confirm the member's date of birth before using age-limited classes");
  }
  const age = ageOnDate(dob, dateKeyInJersey(new Date(startAt)));
  if (!Number.isInteger(age) || age < 0 || age > 120) throw new HttpsError("failed-precondition", "The member's date of birth needs review");
  return { studentId: canonical, age };
}

/** Reads only; callers write after all capacity/eligibility reads have completed. */
export async function readAgeOccupancy(input: Reader & {
  session: Pick<SessionRecord, "sessionId" | "startAt" | "capacity" | "ageCapacities">;
  now: string;
  excludeStudentId?: string;
  excludeWaitlistId?: string;
}): Promise<readonly AgeAvailability[]> {
  const parsed = parseAgeCapacities(input.session.ageCapacities, input.session.capacity);
  if (!parsed.ok) throw new HttpsError("failed-precondition", parsed.error);
  if (!parsed.value.length) return [];
  const base = `academies/${input.academyId}`;
  const [bookings, offers] = await Promise.all([
    input.transaction.get(input.firestore.collection(`${base}/bookings`).where("sessionId", "==", input.session.sessionId).where("status", "==", "confirmed").limit(501)),
    input.transaction.get(input.firestore.collection(`${base}/waitlistEntries`).where("sessionId", "==", input.session.sessionId).where("status", "==", "offered").limit(501)),
  ]);
  if (bookings.docs.length > 500 || offers.docs.length > 500) throw new HttpsError("failed-precondition", "Class occupancy needs review");
  const ids = new Set<string>();
  for (const doc of [...bookings.docs, ...offers.docs.filter((doc) => {
    const row = doc.data();
    return doc.id !== input.excludeWaitlistId && typeof row?.offerExpiresAt === "string" && row.offerExpiresAt > input.now;
  })]) {
    const row = doc.data();
    if (row?.academyId !== input.academyId || typeof row.studentId !== "string") throw new HttpsError("failed-precondition", "Class occupancy needs review");
    ids.add(row.studentId);
  }
  const people = await Promise.all([...ids].map((id) => studentAgeAt(input, id, input.session.startAt)));
  const unique = new Map(people.map((person) => [person.studentId, person.age]));
  if (input.excludeStudentId) unique.delete((await studentAgeAt(input, input.excludeStudentId, input.session.startAt)).studentId);
  return parsed.value.map((row) => ({ ...row, occupied: [...unique.values()].filter((age) => age === row.age).length }));
}

export async function ageCapacityFull(input: Reader & { session: SessionRecord; studentId: string; now: string; excludeWaitlistId?: string }): Promise<boolean> {
  if (!input.session.ageCapacities?.length) return false;
  const person = await studentAgeAt(input, input.studentId, input.session.startAt);
  const rows = await readAgeOccupancy({ ...input, excludeStudentId: input.studentId });
  const row = rows.find((row) => row.age === person.age);
  return row !== undefined && row.occupied >= row.capacity;
}

export async function assertAgeCapacityEdit(input: Reader & { current: SessionRecord; updated: SessionRecord; now: string }): Promise<void> {
  if (!input.current.ageCapacities?.length && !input.updated.ageCapacities?.length) return;
  const parsed = parseAgeCapacities(input.updated.ageCapacities, input.updated.capacity);
  if (!parsed.ok) throw new HttpsError("failed-precondition", parsed.error);
  if (input.updated.courseId || input.updated.isSeminar || input.updated.accessMode === "private-lesson" || input.updated.accessMode === "intro") {
    if (parsed.value.length) throw new HttpsError("failed-precondition", "Age limits are for ordinary classes");
  }
  if (parsed.value.length) {
    const program = await input.transaction.get(input.firestore.doc(`academies/${input.academyId}/programs/${input.updated.programId}`));
    if (isIntroductionClass(input.updated, program.data())) throw new HttpsError("failed-precondition", "Age limits are for ordinary classes");
  }
  const rows = await readAgeOccupancy({ ...input, session: input.updated });
  if (rows.some((row) => row.occupied > row.capacity)) throw new HttpsError("failed-precondition", "Age limits cannot be lower than existing bookings and active offers");
  if (input.updated.capacity !== null && input.updated.capacity !== input.current.capacity) {
    const base = `academies/${input.academyId}`;
    const bookings = await input.transaction.get(input.firestore.collection(`${base}/bookings`).where("sessionId", "==", input.updated.sessionId).where("status", "==", "confirmed").limit(501));
    const offers = await input.transaction.get(input.firestore.collection(`${base}/waitlistEntries`).where("sessionId", "==", input.updated.sessionId).where("status", "==", "offered").limit(501));
    const reserved = offers.docs.filter((doc) => String(doc.data()?.offerExpiresAt ?? "") > input.now).length;
    if (bookings.docs.length + reserved > input.updated.capacity) throw new HttpsError("failed-precondition", "Maximum capacity cannot be lower than existing bookings and active offers");
  }
}

export const getSessionAgeAvailability = onCall(scheduleCallableOptions, async (request) => {
  const actor = requireUserActor(request);
  if (!["owner", "administrator", "headCoach", "coach"].includes(actor.role)) throw new HttpsError("permission-denied", "Staff access required");
  const sessionId = request.data?.sessionId;
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sessionId)) throw new HttpsError("invalid-argument", "Select a class");
  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(db.doc(`academies/${actor.academyId}/sessions/${sessionId}`));
    const session = doc.data() as SessionRecord | undefined;
    if (!session) throw new HttpsError("not-found", "Class not found");
    return { rows: await readAgeOccupancy({ firestore: db as unknown as BookingFirestore, transaction: tx as unknown as BookingTransaction, academyId: actor.academyId, session, now: new Date().toISOString() }) };
  }, { readOnly: true });
});
