import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";

import {
  appendAuditEventInTransaction,
  matchesAuditEventReplay,
} from "../../apps/functions/src/audit/audit-writer.js";

const app = initializeApp({ projectId: "demo-bpt-jersey" }, `audit-${process.pid}-${randomUUID()}`);
const firestore = getFirestore(app);
const academyId = `demo-academy-${randomUUID()}`;
const eventId = "regyfit-access-concurrent-1";
const reference = firestore.doc(`academies/${academyId}/auditEvents/${eventId}`);
const draft = {
  academyId,
  actorId: "system-regyfit-importer",
  action: "regyfit.access.imported",
  targetRef: `academies/${academyId}/regyfitAccessRecords`,
  purpose: "approved Regyfit access import",
  correlationId: "regyfit-access:concurrent-1",
  importRunId: "concurrent-1",
  moduleKey: "alunos-acessos",
  sourceRoute: "/admin2/modulos/alunos/acessos_alunos.php",
  recordCount: 10,
  contentSha256: "c".repeat(64),
} as unknown as AuditEventDraft;

afterAll(async () => {
  await reference.delete();
  await deleteApp(app);
});

async function appendOrReplay(event: AuditEventDraft): Promise<void> {
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) {
      appendAuditEventInTransaction(transaction, reference, event);
      return;
    }
    if (
      !matchesAuditEventReplay(snapshot.data(), reference.id, event, {
        allowLegacyMissingGeneratedFields: true,
      })
    ) {
      throw new Error("audit replay conflict");
    }
  });
}

describe("audit writer against the local Firestore emulator", () => {
  it("converges concurrent identical Regyfit appends to one event", async () => {
    await Promise.all([appendOrReplay(draft), appendOrReplay(draft)]);

    const snapshot = await reference.get();
    expect(snapshot.exists).toBe(true);
    expect(snapshot.data()).toEqual(
      expect.objectContaining({
        auditEventId: eventId,
        action: "regyfit.access.imported",
        result: "completed",
        schemaVersion: 1,
      }),
    );
  });

  it("rejects a divergent concurrent replay without mutation", async () => {
    const divergent = { ...draft, contentSha256: "d".repeat(64) } as unknown as AuditEventDraft;

    await expect(appendOrReplay(divergent)).rejects.toThrow("audit replay conflict");
    expect((await reference.get()).data()).toEqual(
      expect.objectContaining({ contentSha256: "c".repeat(64) }),
    );
  });
});
