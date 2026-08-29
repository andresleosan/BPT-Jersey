import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
const projectId = "demo-bpt-jersey";

function isSafeLoopbackEmulator(host) {
  const match = /^127\.0\.0\.1:([1-9]\d{3,4})$/u.exec(host ?? "");
  return Boolean(match) && Number(match[1]) >= 1_024 && Number(match[1]) <= 65_535;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function assertSafeEmulators() {
  if (
    !isSafeLoopbackEmulator(firestoreHost) ||
    !isSafeLoopbackEmulator(authHost) ||
    (process.env.GCLOUD_PROJECT ?? projectId) !== projectId ||
    process.env.AUTH_EMULATOR_E2E_ROLE !== "adultStudent"
  ) {
    throw new Error(
      "Waitlist UI seed requires loopback demo Firestore/Auth Emulators and adultStudent role.",
    );
  }
}

async function main() {
  assertSafeEmulators();
  const email = required("AUTH_EMULATOR_E2E_EMAIL");
  if (!email.endsWith("@example.test")) {
    throw new Error("Waitlist UI seed requires a synthetic example.test user.");
  }

  const academyId = "synthetic-academy";
  const familyId = "family-waitlist-ui";
  const sessionId = "session-waitlist-ui";
  const membershipId = "membership-waitlist-ui";
  const app = initializeApp({ projectId }, "t060-ui-seed");
  const auth = getAuth(app);
  const firestore = getFirestore(app);

  try {
    const user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { displayName: "Synthetic Adult Waitlist" });
    const studentId = user.uid;
    const now = Date.now();
    const createdAt = new Date(now - 30 * 24 * 60 * 60 * 1_000).toISOString();
    const startAt = new Date(now + 3 * 24 * 60 * 60 * 1_000).toISOString();
    const endAt = new Date(now + 3 * 24 * 60 * 60 * 1_000 + 60 * 60 * 1_000).toISOString();
    const commonAudit = {
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt,
      createdBy: studentId,
      updatedAt: createdAt,
      updatedBy: studentId,
    };

    await Promise.all([
      firestore.doc(`academies/${academyId}/users/${studentId}`).set({
        userId: studentId,
        academyId,
        accountType: "client",
        displayName: "Synthetic Adult Waitlist",
        email,
        phoneNumber: "+441534555019",
        ...commonAudit,
      }),
      firestore.doc(`academies/${academyId}/students/${studentId}`).set({
        studentId,
        academyId,
        familyId,
        userId: studentId,
        fullName: "Synthetic Adult Waitlist",
        dateOfBirth: "1990-01-01",
        phoneNumber: "+441534555019",
        email,
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        participantType: "adult",
        ...commonAudit,
      }),
      firestore.doc(`academies/${academyId}/families/${familyId}`).set({
        familyId,
        academyId,
        primaryContactUserId: studentId,
        billingContactUserId: studentId,
        ...commonAudit,
      }),
      firestore.doc(`academies/${academyId}/memberships/${membershipId}`).set({
        membershipId,
        academyId,
        familyId,
        studentId,
        planId: "bpt-jersey-adult",
        status: "active",
        startsAt: createdAt,
        endsAt: null,
        nextBillingAt: null,
        schemaVersion: "1",
        createdAt,
        createdBy: studentId,
        updatedAt: createdAt,
        updatedBy: studentId,
      }),
      firestore.doc(`academies/${academyId}/sessions/${sessionId}`).set({
        sessionId,
        academyId,
        classId: null,
        programId: "adult-fundamentals",
        locationId: "town",
        instructorId: "coach-waitlist-ui",
        title: "Synthetic full UI class",
        startAt,
        endAt,
        capacity: 1,
        minParticipants: 1,
        status: "scheduled",
        isSeminar: false,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt,
        createdBy: studentId,
        updatedAt: createdAt,
        updatedBy: studentId,
      }),
      firestore.doc(`academies/${academyId}/bookings/${sessionId}__student-confirmed-ui`).set({
        bookingId: `${sessionId}__student-confirmed-ui`,
        academyId,
        sessionId,
        studentId: "student-confirmed-ui",
        membershipId: "membership-confirmed-ui",
        status: "confirmed",
        requestedAt: createdAt,
        cancelledAt: null,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt,
        createdBy: "student-confirmed-ui",
        updatedAt: createdAt,
        updatedBy: "student-confirmed-ui",
      }),
      firestore.doc(`academies/${academyId}/waitlistEntries/${sessionId}__${studentId}`).delete(),
    ]);

    console.log(JSON.stringify({ academyId, sessionId, studentId, firestoreHost, authHost }));
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Waitlist UI Emulator seed failed");
  process.exitCode = 1;
});
