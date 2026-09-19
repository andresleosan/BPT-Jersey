import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemberClassFirestoreStore } from "../../apps/functions/src/schedule/member-class-records-firestore.js";
import { listMemberClassRecordsPage } from "../../apps/functions/src/schedule/member-class-records-service.js";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { listSubscriptionBilling } from "../../apps/functions/src/memberships/manual-subscription-service.js";
import { listMemberSubscriptionRecords } from "../../apps/functions/src/memberships/subscription-admin-service.js";
import { createMemberProfileFirestoreStore } from "../../apps/functions/src/members/member-profile-firestore.js";
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
  it("keeps imported membership, invoice and receipt documents out of real live readers", async () => {
    const envelope = {
      academyId,
      schemaVersion: "1",
      createdAt: at,
      updatedAt: at,
      createdBy: "u",
      updatedBy: "u",
    };
    expect(await listSubscriptionBilling(db, academyId, "s")).toEqual([]);
    await expect(listSubscriptionBilling(db, academyId, "missing")).rejects.toMatchObject({
      code: "not-found",
    });
    await base.collection("students").doc("s").update({ familyId: "f" });
    const batch = db.batch();
    batch.set(base.collection("memberships").doc("m"), {
      ...envelope,
      membershipId: "m",
      studentId: "s",
      familyId: "f",
      planId: PLAN_CATALOG[0]!.planId,
      status: "active",
      startsAt: at,
      endsAt: null,
      nextBillingAt: null,
    });
    batch.set(base.collection("memberships").doc("import"), {
      studentId: "s",
      source: "legacy-import",
    });
    batch.set(base.collection("invoices").doc("i"), {
      ...envelope,
      schemaVersion: 1,
      invoiceId: "i",
      membershipId: "m",
      familyId: "f",
      status: "partially_paid",
      totalMinor: 6000,
      currency: "GBP",
      dueAt: at,
      paidAt: null,
      chargeKind: "membership",
      sourceRef: null,
      invoiceReference: "SYNTHETIC",
      description: "Synthetic period",
    });
    batch.set(base.collection("invoices").doc("historical"), {
      membershipId: "m",
      source: "legacy-import",
    });
    batch.set(base.collection("invoices").doc("sibling"), {
      membershipId: "sibling",
      familyId: "f",
      status: "open",
    });
    batch.set(base.collection("payments").doc("p"), {
      ...envelope,
      schemaVersion: 1,
      paymentId: "p",
      familyId: "f",
      invoiceId: "i",
      status: "recorded",
      amountMinor: 2000,
      currency: "GBP",
      method: "cash",
      manualReference: "SYNTHETIC",
      providerReference: null,
      occurredAt: at,
    });
    batch.set(base.collection("payments").doc("historical"), {
      invoiceId: "i",
      source: "legacy-import",
    });
    await batch.commit();
    const billing = await listSubscriptionBilling(db, academyId, "s");
    expect(billing).toEqual([
      {
        membershipId: "m",
        complimentary: false,
        currentInvoiceId: "i",
        reason: null,
        invoices: [
          {
            invoiceId: "i",
            status: "partially_paid",
            totalMinor: 6000,
            dueAt: at,
            paidAt: null,
            description: "Synthetic period",
            payments: [
              {
                paymentId: "p",
                amountMinor: 2000,
                method: "cash",
                reference: "SYNTHETIC",
                occurredAt: at,
              },
            ],
          },
        ],
      },
    ]);
    expect(
      (await listMemberSubscriptionRecords(db, academyId, "s")).memberships.map(
        (m) => m.membershipId,
      ),
    ).toEqual(["m"]);
    expect(
      (await createMemberProfileFirestoreStore(db).listStudentMemberships(academyId, "s")).map(
        (m) => m.membershipId,
      ),
    ).toEqual(["m"]);
  });
});
