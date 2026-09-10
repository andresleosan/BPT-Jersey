import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const expectedFirestoreEmulatorHost = "127.0.0.1:8080";

function assertSafeEmulator() {
  if (
    process.env.FIRESTORE_EMULATOR_HOST?.trim() !== expectedFirestoreEmulatorHost ||
    (process.env.GCLOUD_PROJECT ?? "demo-bpt-jersey") !== "demo-bpt-jersey"
  ) {
    throw new Error("Retention seed requires the demo Firestore Emulator.");
  }
}

async function main() {
  assertSafeEmulator();
  const academyId = "synthetic-academy";
  const studentId = "student-retention-real";
  const kind = "membership_expiring";
  const runDate = "2026-08-28";
  const deduplicationKey =
    "v2:" + kind.length + ":" + kind + ":" + studentId.length + ":" + studentId + ":" + runDate;
  const alertId =
    "retention-v2__" +
    academyId.length +
    "_" +
    academyId +
    "__" +
    kind.length +
    "_" +
    kind +
    "__" +
    studentId.length +
    "_" +
    studentId +
    "__" +
    runDate;
  const app = initializeApp({ projectId: "demo-bpt-jersey" }, "t062-seed");

  try {
    await getFirestore(app)
      .doc("academies/" + academyId + "/retentionAlerts/" + alertId)
      .set({
        alertId,
        academyId,
        studentId,
        kind,
        severity: "warning",
        status: "open",
        reasonCode: kind,
        evidence: {
          lastAttendedAt: "2026-08-25T10:00:00Z",
          noShowCount: 0,
          membershipEndsAt: "2026-09-02T00:00:00Z",
        },
        deduplicationKey,
        createdAt: runDate + "T00:00:00.000Z",
        schemaVersion: "1",
      });
    console.log(
      JSON.stringify({
        academyId,
        alertId,
        emulator: expectedFirestoreEmulatorHost,
      }),
    );
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Retention Emulator seed failed");
  process.exitCode = 1;
});
