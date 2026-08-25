import { createHash, randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildPrivateDocumentObjectKey,
  type PrivateDocumentProjection,
} from "@bpt-jersey/domain/documents";
import {
  createDocumentStore,
  type DocumentFirestore,
} from "../../apps/functions/src/documents/private-document-service.js";
import type { R2Client } from "../../apps/functions/src/storage/r2-client.js";

const runId = "document-" + process.pid + "-" + randomUUID();
const academyId = runId + "-academy";
const ownerId = runId + "-owner";
const guardianId = runId + "-guardian";
const unrelatedGuardianId = runId + "-unrelated";
const studentId = runId + "-student";
const relationshipId = runId + "-relationship";
const documentId = runId + "-document";
const now = "2026-08-24T12:00:00Z";
const bytes = new TextEncoder().encode("synthetic-waiver-pdf");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);

const student = {
  studentId,
  academyId,
  fullName: "Synthetic Minor",
  dateOfBirth: "2015-01-01",
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
};

const relationship = {
  relationshipId,
  academyId,
  familyId: runId + "-family",
  studentId,
  adultUserId: guardianId,
  relationshipType: "guardian",
  permissions: ["readProfile"],
  validFrom: "2026-08-01T00:00:00Z",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: now,
  createdBy: ownerId,
  updatedAt: now,
  updatedBy: ownerId,
};

const r2: R2Client = {
  createPdfUploadUrl: async () => "https://r2.example.test/upload",
  createPdfDownloadUrl: async () => "https://r2.example.test/download",
  putObject: async () => undefined,
  readObject: async () => bytes,
  deleteObject: async () => undefined,
};

function store() {
  return createDocumentStore({
    firestore: firestore as unknown as DocumentFirestore,
    r2,
    generateDocumentId: () => documentId,
  });
}

describe("private documents against the Firestore emulator", () => {
  beforeAll(async () => {
    await firestore.doc("academies/" + academyId + "/students/" + studentId).set(student);
    await firestore
      .doc("academies/" + academyId + "/relationships/" + relationshipId)
      .set(relationship);
  });

  afterAll(async () => {
    await Promise.all([
      firestore.doc("academies/" + academyId + "/documents/" + documentId).delete(),
      firestore.doc("academies/" + academyId + "/students/" + studentId).delete(),
      firestore.doc("academies/" + academyId + "/relationships/" + relationshipId).delete(),
    ]);
    await deleteApp(app);
  });

  it("finalizes, authorizes, and revokes a synthetic private waiver", async () => {
    const current = store();
    const upload = await current.createWaiverUpload({
      academyId,
      actorId: ownerId,
      now,
      studentId,
      fileName: "waiver.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.byteLength,
      signedAt: null,
    });
    expect(upload).toEqual({
      documentId,
      objectKey: buildPrivateDocumentObjectKey(academyId, studentId, documentId),
      uploadUrl: "https://r2.example.test/upload",
    });

    const finalized = await current.finalizeWaiverUpload({
      academyId,
      actorId: ownerId,
      now,
      documentId,
      studentId,
      fileName: "waiver.pdf",
      sizeBytes: bytes.byteLength,
      signedAt: null,
      sha256,
    });
    expect(finalized).toMatchObject<Partial<PrivateDocumentProjection>>({
      documentId,
      studentId,
      sha256,
      status: "active",
    });

    await expect(
      current.getWaiverDownload({ academyId, actorId: guardianId, role: "guardian", studentId }),
    ).resolves.toMatchObject({ downloadUrl: "https://r2.example.test/download" });
    await expect(
      current.getWaiverDownload({
        academyId,
        actorId: unrelatedGuardianId,
        role: "guardian",
        studentId,
      }),
    ).rejects.toThrow(/permitted/i);

    const revoked = await current.revokeWaiver({ academyId, actorId: ownerId, documentId, now });
    expect(revoked.status).toBe("revoked");
    await expect(
      current.getWaiverDownload({ academyId, actorId: guardianId, role: "guardian", studentId }),
    ).resolves.toBeUndefined();
  });
});
