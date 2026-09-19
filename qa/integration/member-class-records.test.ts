import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemberClassFirestoreStore } from "../../apps/functions/src/schedule/member-class-records-firestore.js";
import { listMemberClassRecordsPage } from "../../apps/functions/src/schedule/member-class-records-service.js";
const enabled =
  process.env.BPT_TEST_INTEGRATION === "true" && Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const at = "2026-09-20T10:00:00.000Z";
describe.skipIf(!enabled)("member class Firestore pages", () => {
  const academyId = "class-records-" + randomUUID();
  const app = initializeApp({ projectId: "demo-bpt-jersey" }, academyId);
  const db = getFirestore(app);
  const base = db.doc(`academies/${academyId}`);
  const actor = { academyId, role: "owner" };
  const store = createMemberClassFirestoreStore(db);
  beforeAll(async () => {
    const envelope = {
      academyId,
      schemaVersion: "1",
      createdAt: at,
      updatedAt: at,
      createdBy: "u",
      updatedBy: "u",
    };
    await base
      .collection("students")
      .doc("s")
      .set({
        ...envelope,
        studentId: "s",
        fullName: "Synthetic member",
        participantType: "adult",
        dateOfBirth: "1990-01-01",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        active: true,
        status: "active",
      });
    await base
      .collection("memberDirectoryStates")
      .doc("current")
      .set({
        ...envelope,
        stateId: "current",
        readerVersion: "canonical-v1",
        directoryWriteMode: "canonical-v1",
        freezeStatus: "open",
        stateRevision: 0,
        globalLegacyReadEliminated: false,
        identityKeyCoverage: "complete",
        digestVersion: "hmac-sha256-v1",
        secretVersion: "v1",
        identityKeyBaselineMac: "a".repeat(64),
        identityKeyBaselineArtifactId: "baseline",
        rollbackProtocolVersion: "legacy-projection-v1",
        rollbackCapacityLimit: 400,
        rollbackEligibleStudentCount: 1,
        operationPhase: "idle",
        lastCommittedChunkNo: 0,
      });
    const batch = db.batch();
    for (let i = 0; i < 28; i++) {
      const recordId = `b${String(i).padStart(2, "0")}`;
      batch.set(base.collection("bookings").doc(recordId), {
        ...envelope,
        bookingId: recordId,
        studentId: "s",
        sessionId: "missing",
        status: "confirmed",
        requestedAt: at,
      });
    }
    batch.set(base.collection("attendance").doc("visit"), {
      ...envelope,
      attendanceId: "visit",
      studentId: "s",
      sessionId: "missing",
      occurredAt: at,
      state: "excused",
      method: "manual",
      correctionOf: null,
      notes: "private",
    });
    batch.set(base.collection("attendance").doc("correction"), {
      ...envelope,
      attendanceId: "correction",
      studentId: "s",
      sessionId: "missing",
      occurredAt: at,
      state: "excused",
      method: "manual",
      correctionOf: "visit",
    });
    await batch.commit();
  });
  afterAll(async () => {
    await db.recursiveDelete(base);
    await deleteApp(app);
  });
  it("orders tied events by document ID and continues without duplicates; corrections stay out", async () => {
    const first = await listMemberClassRecordsPage(store, actor, {
      studentId: "s",
      kind: "bookings",
    });
    expect(first.rows.map((r) => r.recordId)).toEqual(
      Array.from({ length: 25 }, (_, i) => `b${String(27 - i).padStart(2, "0")}`),
    );
    const second = await listMemberClassRecordsPage(store, actor, {
      studentId: "s",
      kind: "bookings",
      cursor: first.nextCursor!,
    });
    expect(second.rows.map((r) => r.recordId)).toEqual(["b02", "b01", "b00"]);
    expect(second.nextCursor).toBeNull();
    expect(
      await listMemberClassRecordsPage(store, actor, { studentId: "s", kind: "attendance" }),
    ).toEqual({
      studentId: "s",
      kind: "attendance",
      rows: [
        { recordId: "visit", session: null, occurredAt: at, state: "excused", method: "manual" },
      ],
      nextCursor: null,
    });
  });
  it("rejects cross-student, changed and deleted cursors", async () => {
    const ref = base.collection("bookings").doc("cursor");
    for (const data of [
      { studentId: "sibling", requestedAt: at },
      { studentId: "s", requestedAt: "2026-09-19T10:00:00.000Z" },
      null,
    ]) {
      if (data) await ref.set({ academyId, bookingId: "cursor", ...data });
      else await ref.delete();
      await expect(
        listMemberClassRecordsPage(store, actor, {
          studentId: "s",
          kind: "bookings",
          cursor: { at, recordId: "cursor" },
        }),
      ).rejects.toMatchObject({ code: "aborted" });
    }
  });
});
