/**
 * Session detail for a member who booked the class (T044V2): the coach's plan and who is coming.
 * Everything another member sees goes through a MemberPublicCard; anyone outside the requester's own
 * cohort, hidden, or without a date of birth only adds to `hiddenCount` and never leaves an id.
 */
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  leaderboardCohort,
  leaderboardEligible,
  leaderboardSnapshotSchema,
  publicDisplayNames,
  sessionDetailResponseSchema,
  type LeaderboardRow,
  type MemberPublicCard,
} from "@bpt-jersey/domain/members/engagement";
import { buildBookingIdCandidates, parseSessionCurriculum } from "@bpt-jersey/domain/schedule";

import { fromData as publicSettingsFrom } from "../account-settings/account-settings-service.js";
import { signPhotoUrl } from "../account-settings/profile-photo.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { toPublicCard } from "../competitors/public-card.js";
import { checkConfirmedBooking } from "../schedule/attendance-transaction-service.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";
import { createMemberDirectoryReadTransaction } from "../members/member-directory-firestore.js";
import { readCanonicalMemberIdentityIds } from "../members/member-identity-firestore.js";
import { resolveCanonicalStudentIdInTransaction } from "../members/member-identity-resolution.js";
import { createPrivateStorageR2Client, type R2Client } from "../storage/r2-client.js";

// Both ids end up in document paths, so no slashes or other path characters.
const documentId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const sessionDetailRequestSchema = z.strictObject({ sessionId: documentId, studentId: documentId });
const notBookedMessage = "This class is only available once you have booked it.";
const courseSessionMessage = "Class details are not available for course sessions.";
const rosterLimit = 200;

type Person = {
  studentId: string;
  fullName: string;
  settings: ReturnType<typeof publicSettingsFrom>;
};

async function requesterHasConfirmedBooking(
  db: Firestore,
  academyId: string,
  sessionId: string,
  identityIds: readonly string[],
): Promise<boolean> {
  const results = await Promise.all(
    identityIds.map(
      async (id) =>
        checkConfirmedBooking(
          await db.getAll(
            ...buildBookingIdCandidates(sessionId, id).map((bookingId) =>
              db.doc(`academies/${academyId}/bookings/${bookingId}`),
            ),
          ),
          academyId,
          sessionId,
          id,
        ) === "confirmed",
    ),
  );
  return results.includes(true);
}

/** A card for a member who is not (yet) in the nightly snapshot: name and consented photo, no progress. */
async function minimalCard(
  person: Person,
  displayName: string,
  r2: R2Client,
): Promise<MemberPublicCard> {
  return {
    studentId: person.studentId,
    displayName: displayName.slice(0, 80),
    photoUrl: await signPhotoUrl(
      r2,
      person.settings.photoObjectKey,
      person.settings.photoConsentAt,
    ),
    belt: null,
    stripes: 0,
    streakCount: 0,
    attendancesSinceSeasonStart: 0,
    promotionPercent: null,
    skillKeys: [],
  };
}

/** The plan and the roster of a session the requested participant holds a confirmed booking on (R9, R10). */
export const getSessionDetail = onCall(
  { ...browserAdminCallableOptions, secrets: enrolmentStorageSecrets },
  async (request) => {
    const actor = await requireMemberAccountActor(request);
    const input = sessionDetailRequestSchema.safeParse(request.data);
    if (!input.success) throw new HttpsError("invalid-argument", "Invalid session request");
    const { sessionId, studentId } = input.data;
    const { academyId } = actor;
    const access = await createFirestoreMemberAccessService().authorise(
      academyId,
      actor.userId,
      studentId,
    );
    if (!access.allowed)
      throw new HttpsError("permission-denied", "This member is not available to your account.");
    try {
      const db = getFirestore();
      const now = new Date().toISOString();
      const root = `academies/${academyId}`;
      // Canonical id first, then its historical ids: a booking under an old identity still counts.
      const identityIds = await readCanonicalMemberIdentityIds(db, academyId, studentId);
      const canonicalId = identityIds[0] ?? studentId;
      if (!(await requesterHasConfirmedBooking(db, academyId, sessionId, identityIds)))
        throw new HttpsError("permission-denied", notBookedMessage);

      const [session, bookings] = await Promise.all([
        db.doc(`${root}/sessions/${sessionId}`).get(),
        db.collection(`${root}/bookings`).where("sessionId", "==", sessionId).get(),
      ]);
      // Course-only participants never saw the social settings, so a course session has no roster.
      if (session.get("courseId")) throw new HttpsError("permission-denied", courseSessionMessage);
      const curriculumResult =
        session.exists && session.get("academyId") === academyId
          ? parseSessionCurriculum(session.get("curriculum"))
          : null;
      const curriculum = curriculumResult?.ok ? curriculumResult.value : null;

      // Confirmed bookings under the same rule as the gate; a member marked absent (the calendar's
      // `schemaVersion === "2" && absent` signal) is not coming, so is neither listed nor counted.
      const bookedIds = new Set<string>();
      for (const booking of bookings.docs) {
        const value = booking.data();
        if (
          typeof value.studentId === "string" &&
          checkConfirmedBooking([booking], academyId, sessionId, value.studentId) === "confirmed" &&
          !(value.schemaVersion === "2" && value.absent === true)
        )
          bookedIds.add(value.studentId);
      }
      // Every booked identity resolved to its canonical student; one that cannot be resolved stays hidden.
      let unresolved = 0;
      const others = new Set<string>();
      await Promise.all(
        [...bookedIds]
          .filter((id) => !identityIds.includes(id))
          .map(async (id) => {
            try {
              const canonical = await db.runTransaction((tx) =>
                resolveCanonicalStudentIdInTransaction(
                  createMemberDirectoryReadTransaction(db, tx),
                  academyId,
                  id,
                ),
              );
              if (canonical !== canonicalId) others.add(canonical);
            } catch {
              unresolved += 1;
            }
          }),
      );

      const ids = [canonicalId, ...others];
      const [students, settings] = await Promise.all([
        db.getAll(...ids.map((id) => db.doc(`${root}/students/${id}`))),
        db.getAll(...ids.map((id) => db.doc(`${root}/memberPublicSettings/${id}`))),
      ]);
      const people = ids.map((id, index): Person & { dateOfBirth: unknown } => {
        const student = students[index]!;
        const fullName = student.exists ? student.get("fullName") : null;
        const setting = settings[index]!;
        return {
          studentId: id,
          fullName: typeof fullName === "string" ? fullName.trim() : "",
          dateOfBirth: student.exists ? student.get("dateOfBirth") : null,
          settings: publicSettingsFrom(academyId, id, setting.exists ? setting.data() : undefined),
        };
      });
      const self = people[0]!;

      // The requester's own cohort decides who they may see; without a date of birth they see nobody else.
      const eligible = leaderboardEligible(self.dateOfBirth as string | null | undefined, now);
      const cohort = eligible ? leaderboardCohort(self.dateOfBirth as string, now) : null;
      const visible = people
        .slice(1)
        .filter(
          (person) =>
            cohort !== null &&
            person.fullName !== "" &&
            person.settings.showToMembers &&
            leaderboardEligible(person.dateOfBirth as string | null | undefined, now) &&
            leaderboardCohort(person.dateOfBirth as string, now) === cohort,
        );
      const hiddenCount = people.length - 1 - visible.length + unresolved;

      const rowsById = new Map<string, LeaderboardRow>();
      if (cohort !== null) {
        const snapshot = await db.doc(`${root}/leaderboards/${cohort}`).get();
        const parsed = leaderboardSnapshotSchema.safeParse(snapshot.data());
        if (snapshot.exists && parsed.success && parsed.data.cohort === cohort)
          for (const row of parsed.data.rows) rowsById.set(row.studentId, row);
      }
      const names = publicDisplayNames(self.fullName === "" ? visible : [...visible, self]);
      const r2 = createPrivateStorageR2Client();
      const nameOf = (person: Person, fallbackName: string) =>
        rowsById.get(person.studentId)?.displayName ?? names.get(person.studentId) ?? fallbackName;
      const cardOf = (person: Person, fallbackName: string) => {
        const row = rowsById.get(person.studentId);
        return row ? toPublicCard(row, r2) : minimalCard(person, nameOf(person, fallbackName), r2);
      };
      // Sorted and capped before any card is built, so photos are signed only for returned cards.
      const shown = visible
        .map((person) => ({ person, name: nameOf(person, person.fullName) }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, rosterLimit - 1);
      const [mine, ...theirs] = await Promise.all([
        cardOf(self, "You"),
        ...shown.map(({ person }) => cardOf(person, person.fullName)),
      ]);

      return sessionDetailResponseSchema.parse({
        curriculum,
        roster: [{ card: mine!, isYou: true }, ...theirs.map((card) => ({ card, isYou: false }))],
        hiddenCount: hiddenCount + (visible.length - shown.length),
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("failed-precondition", "Session detail is unavailable");
    }
  },
);
