// Book every session a member's plan covers — for KIDS and TEENS with a live paid membership only.
// Adults (and any other subscription) book their own classes. Office equivalent of the member-area
// `bulkBookEligibleSessions`, built on the same booking transaction (site, age band, plan, weekly
// limit, capacity, cutoff and the unconfirmed-centre gate all apply). Dry-run by default; counters only.
//
// ponytail: default window is 14 days, not the member area's 90 — an automatic booking a member
// never asked for still counts as a no-show if they miss it. Widen with BULK_BOOK_DAYS.
//
// Build first: node apps/functions/scripts/build-deploy-artifact.mjs
// usage (dry-run):
//   S1_ACADEMY_ID=<academyId> S1_TARGET=production GCLOUD_PROJECT=bptjersey-f5a25 \
//   S1_ACTOR_ID=<provisioned owner uid> node qa/scripts/member-unification-bulk-book.mjs
// apply: add BULK_BOOK_APPLY=yes MEMBER_UNIFICATION_CONFIRMATION=member-unification-book-v1
// optional: BULK_BOOK_DAYS=<1..90> BULK_BOOK_STUDENT_IDS=<id,id,...> (restrict to some members)

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { evaluatePlanAccess } from "../../packages/domain/lib/memberships/plan-contracts.js";
import { dateKeyInJersey, participantTypeOn } from "../../packages/domain/lib/schedule/member-calendar-contracts.js";
import { sessionAccessMode } from "../../packages/domain/lib/schedule/schedule-contracts.js";
import { reportScriptError, resolveTarget, SafeScriptError } from "./member-unification-s1-report.mjs";

const confirmationPhrase = "member-unification-book-v1";
const skippableCodes = new Set(["capacity", "capacity-not-set", "conflict", "financial", "ineligible", "not-found", "weekly-limit"]);
const perMemberLimit = 200;
const concurrency = 8;

/** Memberships covering `now`, one per student (the latest-ending). Pure, self-checkable. */
export function liveMembershipByStudent(memberships, now) {
  const byStudent = new Map();
  for (const membership of memberships) {
    if (!["active", "trial"].includes(membership.status)) continue;
    if (membership.startsAt > now || (membership.endsAt !== null && membership.endsAt < now)) continue;
    const current = byStudent.get(membership.studentId);
    if (!current || (membership.endsAt ?? "9") > (current.endsAt ?? "9")) byStudent.set(membership.studentId, membership);
  }
  return byStudent;
}

/** Operator rule (22 Sep 2026): automatic bookings are for kids and teens; adults book themselves. */
export function autoBookedStudents(live, studentsById, today) {
  const kept = new Map();
  const skipped = { adult: 0, dateOfBirthMissing: 0, unknownStudent: 0 };
  for (const [studentId, membership] of live) {
    const student = studentsById.get(studentId);
    if (!student) {
      skipped.unknownStudent += 1;
      continue;
    }
    if (!student.dateOfBirth) {
      skipped.dateOfBirthMissing += 1;
      continue;
    }
    if (participantTypeOn(student.dateOfBirth, today) === "adult") {
      skipped.adult += 1;
      continue;
    }
    kept.set(studentId, membership);
  }
  return { kept, skipped };
}

export function bookableSessions(sessions, from) {
  return sessions
    .filter(
      (session) =>
        !session.courseId &&
        sessionAccessMode(session) === "membership" &&
        (session.status === "scheduled" || session.status === "active") &&
        Date.parse(session.startAt) >= Date.parse(from),
    )
    .sort((left, right) => left.startAt.localeCompare(right.startAt))
    .slice(0, perMemberLimit);
}

/**
 * Monday of the session's week on the academy's local date, as the booking service counts it.
 * ponytail: mirrors weekStart() in booking-transaction-service; a mismatch only skips an attempt,
 * it can never book wrongly, because the service still enforces the real limit.
 */
export function weekStart(iso) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Jersey", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(iso));
  const read = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const offset = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(read("weekday"));
  return new Date(Date.UTC(Number(read("year")), Number(read("month")) - 1, Number(read("day")) - offset)).toISOString().slice(0, 10);
}

async function main() {
  const env = process.env;
  const academyId = env.S1_ACADEMY_ID?.trim();
  if (!academyId || academyId.includes("/")) throw new SafeScriptError("Invalid S1_ACADEMY_ID");
  const actorId = env.S1_ACTOR_ID?.trim();
  if (!actorId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(actorId)) throw new SafeScriptError("Invalid S1_ACTOR_ID");
  const { projectId } = resolveTarget(env);
  const apply = env.BULK_BOOK_APPLY === "yes";
  if (apply && env.MEMBER_UNIFICATION_CONFIRMATION !== confirmationPhrase) {
    throw new SafeScriptError("Apply requires MEMBER_UNIFICATION_CONFIRMATION=" + confirmationPhrase);
  }
  const days = Number(env.BULK_BOOK_DAYS ?? "14");
  if (!(Number.isSafeInteger(days) && days >= 1 && days <= 90)) throw new SafeScriptError("BULK_BOOK_DAYS must be 1..90");
  const onlyStudents = env.BULK_BOOK_STUDENT_IDS ? new Set(env.BULK_BOOK_STUDENT_IDS.split(",").map((id) => id.trim())) : undefined;

  let scheduleService;
  let bookingModule;
  try {
    scheduleService = await import(new URL("../../.firebase-functions/lib/src/schedule/schedule-service.js", import.meta.url));
    bookingModule = await import(new URL("../../.firebase-functions/lib/src/schedule/booking-transaction-service.js", import.meta.url));
  } catch {
    throw new SafeScriptError("Deploy artifact missing: run node apps/functions/scripts/build-deploy-artifact.mjs first");
  }
  const requireFromArtifact = createRequire(new URL("../../.firebase-functions/package.json", import.meta.url));
  const { initializeApp } = requireFromArtifact("firebase-admin/app");
  const { getFirestore } = requireFromArtifact("firebase-admin/firestore");
  const firestore = getFirestore(initializeApp({ projectId }));
  const store = scheduleService.createFirestoreScheduleStore({ firestore });

  const now = new Date();
  const from = now.toISOString();
  const to = new Date(now.getTime() + days * 86_400_000).toISOString();
  const [membershipDocs, studentDocs, planDocs, programDocs, groupDocs] = await Promise.all([
    firestore.collection(`academies/${academyId}/memberships`).get(),
    firestore.collection(`academies/${academyId}/students`).get(),
    firestore.collection(`academies/${academyId}/plans`).get(),
    firestore.collection(`academies/${academyId}/programs`).get(),
    firestore.collection(`academies/${academyId}/studentGroupAccess`).get(),
  ]);
  const plansById = new Map(planDocs.docs.map((document) => [document.id, document.data()]));
  const programsById = new Map(programDocs.docs.map((document) => [document.id, document.data()]));
  const extraProgramsByStudent = new Map(groupDocs.docs.map((document) => [document.id, new Set(document.get("programIds") ?? [])]));
  const live = liveMembershipByStudent(membershipDocs.docs.map((document) => document.data()), from);
  const studentsById = new Map(studentDocs.docs.map((document) => [document.id, document.data()]));
  const eligible = autoBookedStudents(live, studentsById, from.slice(0, 10));
  const targets = [...eligible.kept.entries()].filter(([studentId]) => !onlyStudents || onlyStudents.has(studentId));
  const sessions = bookableSessions(await store.listSessions(academyId, { from, to }), from);
  console.log(`mode: ${apply ? "APPLY" : "dry-run"}`);
  console.log(`window: ${days} days`);
  console.log(`membersWithLiveMembership: ${live.size}`);
  console.log(`kidsAndTeensToAutoBook: ${targets.length}`);
  console.log(`adultsBookThemselves: ${eligible.skipped.adult}`);
  console.log(`skippedDateOfBirthMissing: ${eligible.skipped.dateOfBirthMissing}`);
  console.log(`bookableSessionsInWindow: ${sessions.length}`);
  if (!apply) return;

  const totals = { booked: 0, alreadyBooked: 0, skipped: 0, skippedByPlan: 0, skippedWeekFull: 0, membersFailed: 0 };
  const skippedByCode = {};
  let done = 0;
  const bookMember = async (index, studentId, membership) => {
    let existing;
    try {
      existing = await store.listStudentBookings(academyId, studentId);
    } catch {
      totals.membersFailed += 1;
      return;
    }
    const confirmed = new Set(existing.filter((booking) => booking.status === "confirmed").map((booking) => booking.sessionId));
    const fullWeeks = new Set();
    const plan = plansById.get(membership.planId);
    const dateOfBirth = studentsById.get(studentId)?.dateOfBirth;
    const extraPrograms = extraProgramsByStudent.get(studentId) ?? new Set();
    // Same pure evaluator the booking transaction runs, minus the weekly count: a session the plan
    // can never cover (other site, other age band) is dropped here instead of costing a 2 s "no".
    // Programs granted as an extra group are always attempted; the service decides those.
    const coveredByPlan = (session) => {
      const program = programsById.get(session.programId);
      if (!plan || !program || !dateOfBirth || extraPrograms.has(session.programId)) return true;
      const participantType = participantTypeOn(dateOfBirth, dateKeyInJersey(new Date(session.startAt)));
      if (program.ageBand !== "all" && program.ageBand !== participantType) return false;
      return evaluatePlanAccess(plan, {
        participantType,
        site: session.locationId === "town" ? "Town" : "West",
        sessionType: program.discipline === "open-mat" ? "openMat" : "class",
        weeklyClassesUsed: 0,
      }).allowed;
    };
    // Members start at different points of the list so two workers rarely contend on one session.
    const shift = (index * 7) % Math.max(sessions.length, 1);
    const ordered = [...sessions.slice(shift), ...sessions.slice(0, shift)];
    for (const session of ordered) {
      if (confirmed.has(session.sessionId)) {
        totals.alreadyBooked += 1;
        continue;
      }
      if (!coveredByPlan(session)) {
        totals.skippedByPlan += 1;
        continue;
      }
      const week = weekStart(session.startAt);
      if (fullWeeks.has(week)) {
        totals.skippedWeekFull += 1;
        continue;
      }
      const startedAt = Date.now();
      try {
        await store.requestBooking(
          academyId,
          { kind: "membership", sessionId: session.sessionId, studentId, membershipId: membership.membershipId },
          actorId,
          { ip: null, role: "owner" }, // the audit draft needs an explicit ip: a script has none
        );
        totals.booked += 1;
        if (env.BPT_OPERATOR_DEBUG === "1") console.log(`attempt booked ${Date.now() - startedAt}ms`);
      } catch (error) {
        if (error instanceof bookingModule.BookingTransactionError && skippableCodes.has(error.code)) {
          totals.skipped += 1;
          skippedByCode[error.code] = (skippedByCode[error.code] ?? 0) + 1;
          if (error.code === "weekly-limit") fullWeeks.add(week);
          // Codes only, never member data: enough to see where a long run spends its time.
          if (env.BPT_OPERATOR_DEBUG === "1") console.log(`attempt ${error.code} ${Date.now() - startedAt}ms · ${error.message}`);
          continue;
        }
        totals.membersFailed += 1;
        if (env.BPT_OPERATOR_DEBUG === "1") {
          // Booking errors carry codes and fixed sentences, never member data.
          console.error(`memberFailed: ${error?.name ?? "Error"}/${error?.code ?? "-"}: ${String(error?.message ?? "").slice(0, 200)}`);
        }
        return;
      }
    }
  };
  // Every rejected attempt costs ~2 s of serial transactional reads, so members run side by side.
  const queue = targets.map(([studentId, membership], index) => [index, studentId, membership]);
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        await bookMember(...item);
        done += 1;
        console.log(`progress: member ${done}/${targets.length} \u00b7 booked ${totals.booked}`);
      }
    }),
  );
  for (const [key, value] of Object.entries(totals)) console.log(`${key}: ${value}`);
  for (const [code, count] of Object.entries(skippedByCode)) console.log(`skipped_${code}: ${count}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on("unhandledRejection", reportScriptError);
  main().catch(reportScriptError);
}
