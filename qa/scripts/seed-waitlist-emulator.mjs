import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const expectedFirestoreEmulatorHost = "127.0.0.1:8080";
const projectId = "demo-bpt-jersey";

function assertSafeEmulator() {
  if (
    process.env.FIRESTORE_EMULATOR_HOST?.trim() !== expectedFirestoreEmulatorHost ||
    (process.env.GCLOUD_PROJECT ?? projectId) !== projectId
  ) {
    throw new Error("Waitlist seed requires the demo Firestore Emulator.");
  }
}

function pairDocumentIds(leftInput, rightInput) {
  const left = leftInput.trim();
  const right = rightInput.trim();
  return [`v2:${left.length}:${left}:${right.length}:${right}`, `${left}__${right}`];
}

async function main() {
  assertSafeEmulator();
  const academyId = "synthetic-academy";
  const sessionId = "session-waitlist-real";
  const candidates = Array.from({ length: 5 }, (_, index) => ({
    studentId: `student-waitlist-real-${index}`,
    membershipId: `membership-waitlist-real-${index}`,
  }));
  const now = Date.now();
  const createdAt = new Date(now - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const startAt = new Date(now + 7 * 24 * 60 * 60 * 1_000).toISOString();
  const endAt = new Date(now + 7 * 24 * 60 * 60 * 1_000 + 60 * 60 * 1_000).toISOString();
  const app = initializeApp({ projectId }, "t060-seed");
  const firestore = getFirestore(app);

  try {
    await Promise.all([
      firestore.doc(`academies/${academyId}/sessions/${sessionId}`).set({
        sessionId,
        academyId,
        classId: null,
        programId: "adult-fundamentals",
        locationId: "town",
        instructorId: "coach-waitlist-real",
        title: "Synthetic full class",
        startAt,
        endAt,
        capacity: 1,
        minParticipants: 1,
        status: "scheduled",
        isSeminar: false,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt,
        createdBy: "owner-waitlist-real",
        updatedAt: createdAt,
        updatedBy: "owner-waitlist-real",
      }),
      ...candidates.map(({ membershipId, studentId }) =>
        firestore.doc(`academies/${academyId}/memberships/${membershipId}`).set({
          membershipId,
          academyId,
          familyId: "family-waitlist-real",
          studentId,
          planId: "bpt-jersey-adult",
          status: "active",
          startsAt: createdAt,
          endsAt: null,
          nextBillingAt: null,
          schemaVersion: "1",
          createdAt,
          createdBy: "owner-waitlist-real",
          updatedAt: createdAt,
          updatedBy: "owner-waitlist-real",
        }),
      ),
      firestore.doc(`academies/${academyId}/bookings/${sessionId}__student-confirmed`).set({
        bookingId: `${sessionId}__student-confirmed`,
        academyId,
        sessionId,
        studentId: "student-confirmed",
        membershipId: "membership-confirmed",
        status: "confirmed",
        requestedAt: createdAt,
        cancelledAt: null,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt,
        createdBy: "student-confirmed",
        updatedAt: createdAt,
        updatedBy: "student-confirmed",
      }),
      ...candidates.flatMap(({ studentId }) =>
        pairDocumentIds(sessionId, studentId).map((waitlistId) =>
          firestore.doc(`academies/${academyId}/waitlistEntries/${waitlistId}`).delete(),
        ),
      ),
      firestore.doc(`academies/${academyId}/waitlistPositionStates/${sessionId}`).delete(),
    ]);
    console.log(
      JSON.stringify({
        academyId,
        sessionId,
        candidates: candidates.length,
        emulator: expectedFirestoreEmulatorHost,
      }),
    );
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Waitlist Emulator seed failed");
  process.exitCode = 1;
});
