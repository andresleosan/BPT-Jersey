/**
 * Callables for the competitor tables (T043V2). Reserved by phase 0 so that the three member
 * features register their callables in their own file; `src/index.ts` already re-exports it.
 * Add the callable here and its name to `deploy-runtime.ts`, nothing else touches `index.ts`.
 */
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { error as logError } from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { z } from "zod";
import {
  competitorsResponseSchema,
  leaderboardCohort,
  leaderboardEligible,
  leaderboardSnapshotSchema,
  rankNeighbours,
  seasonStartFor,
  type LeaderboardRow,
} from "@bpt-jersey/domain/members/engagement";

import { fromData as publicSettingsFrom } from "../account-settings/account-settings-service.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { coursesAcademyId } from "../courses/course-public-http.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createMemberDirectoryReadTransaction } from "../members/member-directory-firestore.js";
import { resolveCanonicalStudentIdInTransaction } from "../members/member-identity-resolution.js";
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";
import { createPrivateStorageR2Client, type R2Client } from "../storage/r2-client.js";
import { buildLeaderboardRows, toPublicCard } from "./public-card.js";

const memberStudentRequestSchema = z.strictObject({ studentId: z.string().min(1).max(128) });

/** Nightly snapshot of the three cohort tables; members read it through getCompetitors. */
export const buildLeaderboards = onSchedule(
  {
    schedule: "30 23 * * *",
    timeZone: "Europe/Jersey",
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 1,
  },
  async () => {
    const academyId = coursesAcademyId.value();
    if (!academyId) return;
    const db = getFirestore();
    const now = new Date().toISOString();
    const cohorts = await buildLeaderboardRows(db, academyId, now);
    // One write per cohort: a cohort that fails the schema (or the document size) keeps yesterday's
    // snapshot without holding back the other two.
    for (const cohort of ["kids", "teens", "adults"] as const) {
      const rows = cohorts.get(cohort) ?? [];
      try {
        // ponytail: one document per cohort, ~1 KB a row → fine below ~800 members per cohort; shard by page past that.
        await db.doc(`academies/${academyId}/leaderboards/${cohort}`).set(
          leaderboardSnapshotSchema.parse({
            cohort,
            builtAt: now,
            seasonStart: seasonStartFor(now),
            rows,
          }),
        );
      } catch {
        logError("Leaderboard snapshot not written", { cohort, rowCount: rows.length });
      }
    }
  },
);

/**
 * I1: "Show me to other members" and photo removal apply at once, not after the nightly build.
 * Reads the live settings of the members that would be shown (never the whole cohort), drops the
 * ones hidden since the build and ranks again until every shown member is still visible. The
 * requester's own row always stays. Cards sign only the photo the live settings still consent to.
 */
async function liveNeighbourCards(
  db: Firestore,
  academyId: string,
  snapshotRows: readonly LeaderboardRow[],
  studentId: string,
  r2: R2Client,
) {
  const scores = {
    attendance: (row: LeaderboardRow) => row.attendancesSinceSeasonStart * 1000 + row.streakCount,
    belt: (row: LeaderboardRow) => row.beltScore,
  };
  const live = new Map<string, ReturnType<typeof publicSettingsFrom>>();
  let rows = snapshotRows;
  for (;;) {
    const windows = {
      attendance: rankNeighbours({
        entries: rows,
        currentStudentId: studentId,
        score: scores.attendance,
      }),
      belt: rankNeighbours({ entries: rows, currentStudentId: studentId, score: scores.belt }),
    };
    const shown = new Set(
      [windows.attendance, windows.belt].flatMap((window) =>
        window === null ? [] : [...window.above, window.current, ...window.below],
      ),
    );
    const unread = [...shown].map((row) => row.studentId).filter((id) => !live.has(id));
    if (unread.length > 0) {
      const documents = await db.getAll(
        ...unread.map((id) => db.doc(`academies/${academyId}/memberPublicSettings/${id}`)),
      );
      unread.forEach((id, index) => {
        const document = documents[index]!;
        live.set(
          id,
          publicSettingsFrom(academyId, id, document.exists ? document.data() : undefined),
        );
      });
    }
    const hiddenNow = new Set(
      [...shown]
        .map((row) => row.studentId)
        .filter((id) => id !== studentId && live.get(id)?.showToMembers === false),
    );
    if (hiddenNow.size === 0) {
      const card = (row: LeaderboardRow) => {
        const settings = live.get(row.studentId);
        const photoObjectKey = settings?.photoConsentAt ? settings.photoObjectKey : null;
        return toPublicCard({ ...row, photoObjectKey }, r2);
      };
      const cards = async (window: (typeof windows)["belt"]) => {
        if (window === null) return null;
        const [above, current, below] = await Promise.all([
          Promise.all(window.above.map(card)),
          card(window.current),
          Promise.all(window.below.map(card)),
        ]);
        return { above, current, below };
      };
      const [attendance, belt] = await Promise.all([
        cards(windows.attendance),
        cards(windows.belt),
      ]);
      return { attendance, belt };
    }
    rows = rows.filter((row) => !hiddenNow.has(row.studentId));
  }
}

/** The two members above and below the requested student in their own cohort (R2, R7). */
export const getCompetitors = onCall(
  { ...browserAdminCallableOptions, secrets: enrolmentStorageSecrets },
  async (request) => {
    const actor = await requireMemberAccountActor(request);
    const input = memberStudentRequestSchema.safeParse(request.data);
    if (!input.success) throw new HttpsError("invalid-argument", "Invalid competitors request");
    const { studentId } = input.data;
    const access = await createFirestoreMemberAccessService().authorise(
      actor.academyId,
      actor.userId,
      studentId,
    );
    if (!access.allowed)
      throw new HttpsError("permission-denied", "This member is not available to your account.");
    try {
      const db = getFirestore();
      const now = new Date().toISOString();
      // Same resolver as the access service: a member addressed by a historical id finds their row.
      const canonicalId = await db.runTransaction((tx) =>
        resolveCanonicalStudentIdInTransaction(
          createMemberDirectoryReadTransaction(db, tx),
          actor.academyId,
          studentId,
        ),
      );
      const student = await db.doc(`academies/${actor.academyId}/students/${canonicalId}`).get();
      const dateOfBirth = student.get("dateOfBirth");
      if (!leaderboardEligible(dateOfBirth, now)) {
        return competitorsResponseSchema.parse({
          cohort: "adults",
          builtAt: null,
          attendance: null,
          belt: null,
        });
      }
      // The server picks the table from the student's own date of birth; nobody chooses a cohort.
      const cohort = leaderboardCohort(dateOfBirth as string, now);
      const snapshot = await db.doc(`academies/${actor.academyId}/leaderboards/${cohort}`).get();
      const parsed = leaderboardSnapshotSchema.safeParse(snapshot.data());
      if (!snapshot.exists || !parsed.success || parsed.data.cohort !== cohort) {
        return competitorsResponseSchema.parse({
          cohort,
          builtAt: null,
          attendance: null,
          belt: null,
        });
      }
      const rows = parsed.data.rows.filter((row) => !row.hidden || row.studentId === canonicalId);
      const { attendance, belt } = await liveNeighbourCards(
        db,
        actor.academyId,
        rows,
        canonicalId,
        createPrivateStorageR2Client(),
      );
      return competitorsResponseSchema.parse({
        cohort,
        builtAt: parsed.data.builtAt,
        attendance,
        belt,
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("failed-precondition", "Competitors are unavailable");
    }
  },
);
