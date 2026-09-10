import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildPrivateDocumentObjectKey } from "@bpt-jersey/domain/documents";
import {
  createDocumentStore,
  type DocumentData,
  type DocumentFirestore,
} from "./private-document-service.js";
import type { R2Client } from "../storage/r2-client.js";

type Ref = Readonly<{ id: string; path: string }>;
function fakeFirestore(initial: Record<string, DocumentData> = {}) {
  const records = new Map(Object.entries(initial));
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const firestore: DocumentFirestore = {
    doc: ref,
    collection: (path) => ({
      doc: (id?: string) => ref(path + "/" + (id ?? "generated")),
      where: (field, _op, value) => ({
        path,
        field,
        value,
        limit: (limit: number) => ({ path, field, value, limit }),
      }),
    }),
    runTransaction: async (callback) => {
      const transaction = {
        get: async (
          target: Ref | { path: string; field?: string; value?: unknown; limit: number },
        ) => {
          if ("limit" in target)
            return {
              docs: [...records.entries()]
                .filter(
                  ([key, value]) =>
                    key.startsWith(target.path + "/") &&
                    (target.field === undefined || value[target.field] === target.value),
                )
                .slice(0, target.limit)
                .map(([key, value]) => ({ ...ref(key), exists: true, data: () => value })),
            };
          const data = records.get(target.path);
          return { ...ref(target.path), exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: DocumentData) => {
          if (records.has(target.path)) throw new Error("already exists");
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: DocumentData) => {
          records.set(target.path, data);
          return transaction;
        },
      };
      return callback(transaction);
    },
  };
  return { firestore, records };
}
const student: DocumentData = {
  studentId: "student-1",
  academyId: "academy-1",
  userId: "user-1",
  fullName: "Synthetic Minor",
  dateOfBirth: "2015-01-01",
  phoneNumber: "+15550000001",
  email: "minor@example.test",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  participantType: "minor",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-24T10:00:00Z",
  createdBy: "owner-1",
  updatedAt: "2026-08-24T10:00:00Z",
  updatedBy: "owner-1",
};
const relationship: DocumentData = {
  relationshipId: "family-1--student-1",
  academyId: "academy-1",
  familyId: "family-1",
  studentId: "student-1",
  adultUserId: "guardian-1",
  relationshipType: "guardian",
  permissions: ["readProfile"],
  validFrom: "2026-08-01T00:00:00Z",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-01T00:00:00Z",
  createdBy: "owner-1",
  updatedAt: "2026-08-01T00:00:00Z",
  updatedBy: "owner-1",
};
function r2For(bytes: Uint8Array): R2Client {
  return {
    createPdfUploadUrl: async () => "https://r2.example.test/upload",
    createPdfDownloadUrl: async () => "https://r2.example.test/download",
    putObject: async () => undefined,
    readObject: async () => bytes,
    deleteObject: async () => undefined,
  };
}
describe("private document store", () => {
  it("prepares, finalizes and authorizes a synthetic private waiver", async () => {
    const seeded = fakeFirestore({
      "academies/academy-1/students/student-1": student,
      "academies/academy-1/relationships/family-1--student-1": relationship,
    });
    const bytes = new TextEncoder().encode("synthetic-pdf-fixture");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const store = createDocumentStore({
      firestore: seeded.firestore,
      r2: r2For(bytes),
      generateDocumentId: () => "document-1",
    });
    const upload = await store.createWaiverUpload({
      academyId: "academy-1",
      actorId: "owner-1",
      now: "2026-08-24T12:00:00Z",
      studentId: "student-1",
      fileName: "waiver.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.byteLength,
      signedAt: null,
    });
    expect(upload).toEqual({
      documentId: "document-1",
      objectKey: buildPrivateDocumentObjectKey("academy-1", "student-1", "document-1"),
      uploadUrl: "https://r2.example.test/upload",
    });
    const finalized = await store.finalizeWaiverUpload({
      academyId: "academy-1",
      actorId: "owner-1",
      now: "2026-08-24T12:01:00Z",
      documentId: "document-1",
      studentId: "student-1",
      fileName: "waiver.pdf",
      sizeBytes: bytes.byteLength,
      signedAt: null,
      sha256: hash,
    });
    expect(finalized).toMatchObject({ documentId: "document-1", sha256: hash, status: "active" });
    await expect(
      store.getWaiverDownload({
        academyId: "academy-1",
        actorId: "guardian-1",
        role: "guardian",
        studentId: "student-1",
      }),
    ).resolves.toMatchObject({ downloadUrl: "https://r2.example.test/download" });
    await expect(
      store.getWaiverDownload({
        academyId: "academy-1",
        actorId: "guardian-2",
        role: "guardian",
        studentId: "student-1",
      }),
    ).rejects.toThrow(/permitted/i);
    const revoked = await store.revokeWaiver({
      academyId: "academy-1",
      actorId: "owner-1",
      documentId: "document-1",
      now: "2026-08-24T12:02:00Z",
    });
    expect(revoked.status).toBe("revoked");
  });
  it("rejects guardian downloads outside the relationship validity window", async () => {
    for (const currentRelationship of [
      { ...relationship, validFrom: "2999-01-01T00:00:00Z" },
      { ...relationship, validTo: "2020-01-01T00:00:00Z" },
    ]) {
      const seeded = fakeFirestore({
        "academies/academy-1/students/student-1": student,
        "academies/academy-1/relationships/family-1--student-1": currentRelationship,
      });
      const store = createDocumentStore({
        firestore: seeded.firestore,
        r2: r2For(new Uint8Array()),
      });
      await expect(
        store.getWaiverDownload({
          academyId: "academy-1",
          actorId: "guardian-1",
          role: "guardian",
          studentId: "student-1",
        }),
      ).rejects.toThrow(/permitted/i);
    }
  });
  it("rejects upload preparation for an inactive minor", async () => {
    const seeded = fakeFirestore({
      "academies/academy-1/students/student-1": { ...student, active: false, status: "inactive" },
    });
    const store = createDocumentStore({ firestore: seeded.firestore, r2: r2For(new Uint8Array()) });
    await expect(
      store.createWaiverUpload({
        academyId: "academy-1",
        actorId: "owner-1",
        now: "2026-08-24T12:00:00Z",
        studentId: "student-1",
        fileName: "waiver.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
        signedAt: null,
      }),
    ).rejects.toThrow(/eligible/i);
  });
  it("fails closed when the hash or declared size is wrong", async () => {
    const seeded = fakeFirestore({ "academies/academy-1/students/student-1": student });
    const bytes = new TextEncoder().encode("synthetic-pdf-fixture");
    const store = createDocumentStore({
      firestore: seeded.firestore,
      r2: r2For(bytes),
      generateDocumentId: () => "document-2",
    });
    await expect(
      store.finalizeWaiverUpload({
        academyId: "academy-1",
        actorId: "owner-1",
        now: "2026-08-24T12:00:00Z",
        documentId: "document-2",
        studentId: "student-1",
        fileName: "waiver.pdf",
        sizeBytes: 99,
        signedAt: null,
        sha256: "0".repeat(64),
      }),
    ).rejects.toThrow(/content|hash/i);
  });
});
