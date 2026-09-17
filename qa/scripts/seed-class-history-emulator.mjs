import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

/**
 * T048V2-H: writes the class audit events the registrations log reads, straight into the Firestore
 * Emulator. The log is a read-only view over `academies/<id>/auditEvents`, so the events are
 * planted here rather than produced by driving bookings through the UI - that would test the
 * booking flow, not this screen. The programs, sessions, students and staff documents are seeded
 * too, because the log resolves every name through them.
 *
 * Emulator only: the guard below refuses to run without a loopback FIRESTORE_EMULATOR_HOST.
 */

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function assertSafeFirestoreEmulator() {
  const match = /^127\.0\.0\.1:([1-9]\d{3,4})$/u.exec(process.env.FIRESTORE_EMULATOR_HOST ?? "");
  const port = Number(match?.[1]);
  if (!match || port < 1_024 || port > 65_535) {
    throw new Error("Class history seed requires a loopback FIRESTORE_EMULATOR_HOST.");
  }
}

const programId = "prog-gi-evenings";
const locationId = "loc-town";
const sessionId = "session-2026-09-16-gi";
const sessionStartAt = "2026-09-16T17:30:00.000Z";
const studentId = "student-ana";
const studentName = "Ana Synthetic";
const otherStudentId = "student-bruno";
const otherStudentName = "Bruno Synthetic";
const memberUid = "uid-member-ana";
const staffKey = "staff-office-1";

/**
 * Three events, one per actor group the four columns must render: a member booking with an
 * address, the same member cancelling, and a drop-in given by staff. Every row carries
 * `actorName: null`, which is what the booking and attendance writers store in production: both
 * the member's and the staff member's name are resolved server-side from the `userId` on their
 * student / staff document, never shown as an auth uid. `occurredAt` is a Timestamp, as the audit
 * writer writes it.
 */
function events(staffUid) {
  const classBlock = {
    studentId,
    studentName,
    sessionId,
    sessionStartAt,
    programId,
    locationId,
  };
  return [
    {
      id: "class-history-e2e-1",
      data: {
        occurredAt: Timestamp.fromDate(new Date("2026-09-15T09:00:00.000Z")),
        action: "booking.created",
        actorId: memberUid,
        actorRole: "adultStudent",
        actorGroup: "member",
        actorName: null,
        actorIp: "203.0.113.10",
        source: "bpt",
        class: classBlock,
      },
    },
    {
      id: "class-history-e2e-2",
      data: {
        occurredAt: Timestamp.fromDate(new Date("2026-09-15T10:15:00.000Z")),
        action: "booking.cancelled",
        actorId: memberUid,
        actorRole: "adultStudent",
        actorGroup: "member",
        actorName: null,
        actorIp: "203.0.113.10",
        source: "bpt",
        class: classBlock,
      },
    },
    {
      id: "class-history-e2e-3",
      data: {
        occurredAt: Timestamp.fromDate(new Date("2026-09-15T11:30:00.000Z")),
        action: "dropin.created",
        actorId: staffUid,
        actorRole: "owner",
        actorGroup: "staff",
        actorName: null,
        actorIp: "198.51.100.7",
        source: "bpt",
        class: { ...classBlock, studentId: otherStudentId, studentName: otherStudentName },
      },
    },
  ];
}

async function main() {
  assertSafeFirestoreEmulator();
  const academyId = required("T048_CLASS_HISTORY_ACADEMY_ID");
  const staffUid = required("T048_CLASS_HISTORY_STAFF_UID");

  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-bpt-jersey" });
  const firestore = getFirestore(app);
  try {
    const academy = firestore.doc(`academies/${academyId}`);
    await academy.collection("programs").doc(programId).set({
      name: "GI All Levels Evenings",
      academyId,
    });
    await academy.collection("sessions").doc(sessionId).set({
      academyId,
      programId,
      locationId,
      startAt: sessionStartAt,
      endAt: "2026-09-16T18:30:00.000Z",
    });
    await academy
      .collection("students")
      .doc(studentId)
      .set({ academyId, fullName: studentName, userId: memberUid });
    await academy
      .collection("students")
      .doc(otherStudentId)
      .set({ academyId, fullName: otherStudentName });
    await academy.collection("staff").doc(staffKey).set({
      academyId,
      userId: staffUid,
      role: "owner",
      active: true,
      status: "active",
    });

    const batch = firestore.batch();
    for (const event of events(staffUid)) {
      batch.set(academy.collection("auditEvents").doc(event.id), event.data);
    }
    await batch.commit();
    console.log(JSON.stringify({ academyId, seededEvents: 3, staffKey }));
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Class history seed failed");
  process.exitCode = 1;
});
