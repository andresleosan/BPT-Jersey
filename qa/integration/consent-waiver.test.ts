import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { appendAuditEventInTransaction } from "../../apps/functions/src/audit/audit-writer.js";
import {
  createConsentStore,
  type ConsentFirestore,
} from "../../apps/functions/src/consents/consent-service.js";
import type { R2Client } from "../../apps/functions/src/storage/r2-client.js";

const runId = `consent-${process.pid}-${randomUUID()}`;
const academyId = `${runId}-academy`;
const ownerId = `${runId}-owner`;
const guardianId = `${runId}-guardian`;
const otherGuardianId = `${runId}-other`;
const studentId = `${runId}-student`;
const relationshipId = `${runId}-relationship`;
const documentId = `${runId}-document`;
const now = "2026-08-25T12:00:00Z";
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);
const objects = new Map<string, Uint8Array>();
const r2: R2Client = {
  createPdfUploadUrl: async () => "https://r2.example.test/upload",
  createPdfDownloadUrl: async () => "https://r2.example.test/download",
  putObject: async (key, body) => {
    objects.set(key, body);
  },
  readObject: async (key) => objects.get(key) ?? new Uint8Array(),
  deleteObject: async (key) => {
    objects.delete(key);
  },
};

const audit = (
  transaction: Parameters<typeof appendAuditEventInTransaction>[0],
  reference: Parameters<typeof appendAuditEventInTransaction>[1],
  draft: Parameters<typeof appendAuditEventInTransaction>[2],
) => appendAuditEventInTransaction(transaction, reference, draft);
const store = createConsentStore({
  firestore: firestore as unknown as ConsentFirestore,
  r2,
  createEvidencePdf: async () => new TextEncoder().encode("%PDF synthetic emulator waiver"),
  generateDocumentId: () => documentId,
  appendAudit: (transaction, reference, draft) =>
    audit(transaction, reference, draft as AuditEventDraft),
});

describe("versioned waiver against the Firestore emulator", () => {
  beforeAll(async () => {
    await Promise.all([
      firestore.doc(`academies/${academyId}/users/${guardianId}`).set({
        userId: guardianId,
        academyId,
        accountType: "client",
        displayName: "Synthetic Guardian",
        email: "guardian@example.test",
        phoneNumber: "+441534000001",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: now,
        createdBy: ownerId,
        updatedAt: now,
        updatedBy: ownerId,
      }),
      firestore.doc(`academies/${academyId}/users/${otherGuardianId}`).set({
        userId: otherGuardianId,
        academyId,
        accountType: "client",
        displayName: "Synthetic Other Guardian",
        email: "other-guardian@example.test",
        phoneNumber: "+441534000002",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: now,
        createdBy: ownerId,
        updatedAt: now,
        updatedBy: ownerId,
      }),
      firestore.doc(`academies/${academyId}/students/${studentId}`).set({
        studentId,
        academyId,
        familyId: `${runId}-family`,
        fullName: "Synthetic Minor",
        dateOfBirth: "2014-01-01",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        participantType: "minor",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: now,
        createdBy: ownerId,
        updatedAt: now,
        updatedBy: ownerId,
      }),
      firestore.doc(`academies/${academyId}/relationships/${relationshipId}`).set({
        relationshipId,
        academyId,
        familyId: `${runId}-family`,
        studentId,
        adultUserId: guardianId,
        relationshipType: "guardian",
        permissions: ["readProfile"],
        validFrom: "2026-01-01T00:00:00Z",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: now,
        createdBy: ownerId,
        updatedAt: now,
        updatedBy: ownerId,
      }),
    ]);
  });

  afterAll(async () => {
    for (const name of [
      "auditEvents",
      "documents",
      "consents",
      "waiverVersions",
      "relationships",
      "students",
      "users",
    ]) {
      const snapshot = await firestore.collection(`academies/${academyId}/${name}`).get();
      await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
    }
    await deleteApp(app);
  });

  it("atomically links current version, guardian acceptance, evidence and audit", async () => {
    const version = await store.publishWaiverVersion({
      academyId,
      actorId: ownerId,
      now,
      publication: {
        versionLabel: "pilot-emulator",
        title: "Synthetic emulator waiver",
        introduction: "Synthetic content only.",
        effectiveAt: now,
        confirmReviewed: true,
        clauses: [
          {
            key: "photoVideo",
            heading: "Photo and video",
            body: "Synthetic media clause.",
            required: false,
          },
          {
            key: "medicalTreatment",
            heading: "Medical treatment",
            body: "Synthetic medical clause.",
            required: true,
          },
          { key: "hygiene", heading: "Hygiene", body: "Synthetic hygiene clause.", required: true },
          {
            key: "dataProtection",
            heading: "Data protection",
            body: "Synthetic data clause.",
            required: true,
          },
        ],
      },
    });
    const consent = await store.acceptWaiver({
      academyId,
      actorId: guardianId,
      role: "guardian",
      now: "2026-08-25T12:10:00Z",
      studentId,
      waiverVersionId: version.waiverVersionId,
      contentHash: version.contentHash,
      typedName: "Synthetic Guardian",
      clauseResponses: {
        photoVideo: "declined",
        medicalTreatment: "accepted",
        hygiene: "accepted",
        dataProtection: "accepted",
      },
    });
    const [storedConsent, storedDocument, audits] = await Promise.all([
      firestore.doc(`academies/${academyId}/consents/${consent.consentId}`).get(),
      firestore.doc(`academies/${academyId}/documents/${documentId}`).get(),
      firestore.collection(`academies/${academyId}/auditEvents`).get(),
    ]);
    expect(storedConsent.data()).toMatchObject({
      evidenceDocumentId: documentId,
      signedBy: guardianId,
      status: "accepted",
    });
    expect(storedDocument.data()).toMatchObject({ studentId, status: "active", kind: "waiver" });
    expect(audits.docs.map((entry) => entry.data().action)).toEqual(
      expect.arrayContaining(["waiver.version.published", "consent.accepted"]),
    );
    await expect(
      store.getWaiverEvidenceDownload({
        academyId,
        actorId: otherGuardianId,
        role: "guardian",
        consentId: consent.consentId,
        now,
      }),
    ).rejects.toThrow(/eligible|permitted/i);
    await store.revokeWaiverConsent({
      academyId,
      actorId: guardianId,
      role: "guardian",
      consentId: consent.consentId,
      now: "2026-08-25T13:00:00Z",
    });
    expect(
      (await firestore.doc(`academies/${academyId}/consents/${consent.consentId}`).get()).data(),
    ).toMatchObject({ status: "revoked" });
  });
});
