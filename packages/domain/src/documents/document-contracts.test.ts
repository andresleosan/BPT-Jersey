import { describe, expect, it } from "vitest";
import {
  buildPrivateDocumentObjectKey,
  parsePrivateDocumentRecord,
  parsePrivateDocumentUploadInput,
} from "./document-contracts.js";
describe("private document contracts", () => {
  it("builds tenant-scoped PDF keys and rejects unsafe uploads", () => {
    expect(buildPrivateDocumentObjectKey("academy-1", "student-1", "document-1")).toBe(
      "academies/academy-1/documents/student-1/document-1.pdf",
    );
    expect(
      parsePrivateDocumentUploadInput({
        studentId: "student-1",
        fileName: "waiver.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
        signedAt: null,
      }).ok,
    ).toBe(true);
    expect(
      parsePrivateDocumentUploadInput({
        studentId: "student-1",
        fileName: "../waiver.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
        signedAt: null,
      }).ok,
    ).toBe(false);
    expect(
      parsePrivateDocumentUploadInput({
        studentId: "student-1",
        fileName: "waiver.pdf",
        contentType: "text/plain",
        sizeBytes: 100,
        signedAt: null,
      }).ok,
    ).toBe(false);
  });
  it("rejects records whose object key does not match their identity", () => {
    expect(
      parsePrivateDocumentRecord({
        documentId: "document-1",
        academyId: "academy-1",
        studentId: "student-1",
        kind: "waiver",
        objectKey: "academies/academy-1/documents/student-1/other.pdf",
        fileName: "waiver.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
        sha256: "0".repeat(64),
        signedAt: null,
        status: "active",
        schemaVersion: "1",
        createdAt: "2026-08-24T12:00:00Z",
        createdBy: "owner-1",
        updatedAt: "2026-08-24T12:00:00Z",
        updatedBy: "owner-1",
      }).ok,
    ).toBe(false);
  });
});
