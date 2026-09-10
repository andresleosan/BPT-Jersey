import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it, afterAll, beforeAll } from "vitest";

import {
  createFirestoreMemberImportCleanupJournal,
  createFirestoreMemberReportExportStore,
  createFirestoreMemberReportRateLimiter,
  createMemberReportRateLimitKey,
} from "../../apps/functions/src/members/member-callables.js";
import { createFirestoreMemberStore } from "../../apps/functions/src/members/member-service.js";

const runId = `integration-${process.pid}-${randomUUID()}`;
const academyId = `${runId}-academy`;
const memberCollection = `academies/${academyId}/members`;
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);

const member = {
  memberId: `${runId}-numbered`,
  academyId,
  membershipNumber: "M-001",
  fullName: "Synthetic Numbered Member",
  paymentStatus: "unknown" as const,
  gender: "unknown" as const,
  membershipStatus: "active" as const,
  createdAt: "2026-08-11T10:00:00.000Z",
  createdBy: "integration-admin",
  updatedAt: "2026-08-11T10:00:00.000Z",
  updatedBy: "integration-admin",
  source: "integration",
  schemaVersion: "1" as const,
};

const noNumberMember = {
  ...member,
  memberId: `${runId}-missing-number`,
  fullName: "Synthetic Missing Number Member",
};
delete (noNumberMember as { membershipNumber?: string }).membershipNumber;

const reportSessionId = `${runId}-report`;
const cleanupSessionId = `${runId}-cleanup`;
const rateLimitActorId = `${runId}-actor`;
const collidingRateLimitTuples = [
  { academyId: `${runId}-a_b`, actorId: "c" },
  { academyId: `${runId}-a`, actorId: "b_c" },
] as const;

async function deleteIfPresent(path: string): Promise<void> {
  await firestore.doc(path).delete();
}

describe("Firestore adapters against the local emulator", () => {
  beforeAll(async () => {
    await firestore.collection(memberCollection).doc(member.memberId).set(member);
    await firestore.collection(memberCollection).doc(noNumberMember.memberId).set(noNumberMember);
  });

  afterAll(async () => {
    await Promise.all([
      deleteIfPresent(`${memberCollection}/${member.memberId}`),
      deleteIfPresent(`${memberCollection}/${noNumberMember.memberId}`),
      deleteIfPresent(
        `memberReportRateLimits/${createMemberReportRateLimitKey(academyId, rateLimitActorId)}`,
      ),
      ...collidingRateLimitTuples.map(({ academyId: tupleAcademyId, actorId }) =>
        deleteIfPresent(
          `memberReportRateLimits/${createMemberReportRateLimitKey(tupleAcademyId, actorId)}`,
        ),
      ),
      deleteIfPresent(`memberReportExports/${reportSessionId}`),
      deleteIfPresent(`memberImportCleanupJournal/${cleanupSessionId}`),
    ]);
    await deleteApp(app);
  });

  it("counts noNumber using the canonical undefined-field predicate", async () => {
    const store = createFirestoreMemberStore(firestore);

    await expect(store.countByReport(academyId, "noNumber")).resolves.toBe(1);
  });

  it("enforces the report rate limit transactionally across adapter instances", async () => {
    const first = createFirestoreMemberReportRateLimiter(firestore, {
      maxRequests: 1,
      windowMs: 60_000,
    });
    const second = createFirestoreMemberReportRateLimiter(firestore, {
      maxRequests: 1,
      windowMs: 60_000,
    });
    const results = await Promise.allSettled([
      first.consume({
        academyId,
        actorId: rateLimitActorId,
        now: new Date("2026-08-11T12:00:00.000Z"),
      }),
      second.consume({
        academyId,
        actorId: rateLimitActorId,
        now: new Date("2026-08-11T12:00:00.000Z"),
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "resource-exhausted" } });
  });

  it("isolates rate limits for tuples that previously shared a concatenated key", async () => {
    const limiter = createFirestoreMemberReportRateLimiter(firestore, {
      maxRequests: 1,
      windowMs: 60_000,
    });
    const now = new Date("2026-08-11T12:00:00.000Z");

    await limiter.consume({ ...collidingRateLimitTuples[0], now });
    await expect(limiter.consume({ ...collidingRateLimitTuples[1], now })).resolves.toBeUndefined();
    await expect(limiter.consume({ ...collidingRateLimitTuples[0], now })).rejects.toMatchObject({
      code: "resource-exhausted",
    });
    await expect(limiter.consume({ ...collidingRateLimitTuples[1], now })).rejects.toMatchObject({
      code: "resource-exhausted",
    });
  });

  it("persists and removes report export and import cleanup journals", async () => {
    const exports = createFirestoreMemberReportExportStore(firestore);
    const cleanup = createFirestoreMemberImportCleanupJournal(firestore);
    const exportSession = {
      sessionId: reportSessionId,
      academyId,
      report: "active" as const,
      objectKey: `academies/${academyId}/member-reports/${reportSessionId}/active.pdf`,
      createdAt: "2026-08-11T10:00:00.000Z",
      expiresAt: "2026-08-11T11:00:00.000Z",
      status: "uploaded" as const,
    };
    const cleanupEntry = {
      sessionId: cleanupSessionId,
      objectKeys: [`academies/${academyId}/member-imports/${cleanupSessionId}/members.pdf`],
      attempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      lastError: "Cleanup pending",
      status: "pending" as const,
      kind: "import" as const,
    };

    await exports.save(exportSession);
    await cleanup.save(cleanupEntry);
    await expect(exports.get(reportSessionId)).resolves.toEqual(exportSession);
    await expect(cleanup.get(cleanupSessionId)).resolves.toEqual(cleanupEntry);

    const claimed = await cleanup.claim(
      cleanupEntry,
      "2026-08-11T12:00:00.000Z",
      `${runId}-lease`,
      300_000,
    );
    expect(claimed).toMatchObject({ status: "running", attempts: 1 });
    await cleanup.complete(cleanupSessionId, `${runId}-lease`);
    await expect(cleanup.get(cleanupSessionId)).resolves.toMatchObject({ status: "completed" });

    await exports.remove(reportSessionId);
    await expect(exports.get(reportSessionId)).resolves.toBeUndefined();
  });

  it("rejects a report export document whose sessionId differs from the requested document", async () => {
    const exports = createFirestoreMemberReportExportStore(firestore);
    const requestedSessionId = `${runId}-requested-export`;
    await firestore
      .collection("memberReportExports")
      .doc(requestedSessionId)
      .set({
        sessionId: `${runId}-different-export`,
        academyId,
        report: "active",
        objectKey: `academies/${academyId}/member-reports/${requestedSessionId}/active.pdf`,
        createdAt: "2026-08-11T10:00:00.000Z",
        expiresAt: "2026-08-11T11:00:00.000Z",
        status: "uploaded",
      });

    await expect(exports.get(requestedSessionId)).rejects.toThrow(
      "Member report export journal is invalid",
    );
    await deleteIfPresent(`memberReportExports/${requestedSessionId}`);
  });

  it("applies member import atomically, preserves fields, and returns the same result on retry", async () => {
    const store = createFirestoreMemberStore(firestore);
    const operationId = `${runId}-member-import`;
    const importedMemberId = `${runId}-imported`;
    const result = { imported: 1, updated: 1, conflicts: 0 } as const;
    const input = {
      academyId,
      actorId: "integration-admin",
      now: "2026-08-11T12:00:00.000Z",
      operationId,
      sourceHash: "b".repeat(64),
      reportKeys: ["total"] as const,
      mutations: [
        {
          kind: "update" as const,
          memberId: member.memberId,
          expectedUpdatedAt: member.updatedAt,
          updates: { idCardNumber: "ID-UPDATED" },
        },
        {
          kind: "create" as const,
          memberId: importedMemberId,
          record: {
            memberId: importedMemberId,
            academyId,
            fullName: "Synthetic Imported Member",
            paymentStatus: "unknown" as const,
            gender: "unknown" as const,
            membershipStatus: "active" as const,
            createdAt: "2026-08-11T12:00:00.000Z",
            createdBy: "integration-admin",
            updatedAt: "2026-08-11T12:00:00.000Z",
            updatedBy: "integration-admin",
            source: "member-pdf-import",
            schemaVersion: "1" as const,
          },
        },
      ],
      result,
    };

    await expect(store.applyImport(input)).resolves.toEqual(result);
    await expect(store.applyImport(input)).resolves.toEqual(result);
    const updatedSnapshot = await firestore.doc(`${memberCollection}/${member.memberId}`).get();
    expect(updatedSnapshot.data()).toEqual(
      expect.objectContaining({ idCardNumber: "ID-UPDATED", paymentStatus: "unknown" }),
    );
    const importedSnapshot = await firestore.doc(`${memberCollection}/${importedMemberId}`).get();
    expect(importedSnapshot.exists).toBe(true);
    const audits = await firestore.collection(`academies/${academyId}/auditEvents`).get();
    const importAudits = audits.docs.filter(
      (document) => document.data().correlationId === operationId,
    );
    expect(importAudits).toHaveLength(1);
    expect(importAudits[0]?.data()).toEqual(
      expect.objectContaining({
        action: "member.import.confirmed",
        imported: 1,
        updated: 1,
        conflicts: 0,
        sourceHash: "b".repeat(64),
        reportKeys: ["total"],
        result: "completed",
        schemaVersion: 1,
        auditEventId: expect.any(String),
        occurredAt: expect.anything(),
      }),
    );
    expect(importAudits[0]?.data()).not.toHaveProperty("fullName");
    expect(importAudits[0]?.data()).not.toHaveProperty("email");
    expect(importAudits[0]?.data()).not.toHaveProperty("records");
    await Promise.all([
      deleteIfPresent(`${memberCollection}/${importedMemberId}`),
      deleteIfPresent(`academies/${academyId}/memberImportOperations/${operationId}`),
      ...importAudits.map((document) => document.ref.delete()),
    ]);
    await firestore.collection(memberCollection).doc(member.memberId).set(member);
  });
});
