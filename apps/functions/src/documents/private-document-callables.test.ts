import { describe, expect, it, vi } from "vitest";
import {
  createPrivateWaiverUploadHandler,
  type DocumentCallableServices,
} from "./private-document-callables.js";
function request(data: unknown, role = "owner") {
  return { data, auth: { uid: "owner-1", token: { academyId: "academy-1", role } } } as never;
}
function services(pilotEnabled = true): DocumentCallableServices {
  return {
    pilotEnabled,
    store: {
      createWaiverUpload: vi.fn(async () => ({
        documentId: "document-1",
        objectKey: "academies/academy-1/documents/student-1/document-1.pdf",
        uploadUrl: "https://r2.example.test/upload",
      })),
      finalizeWaiverUpload: vi.fn(),
      getWaiverDownload: vi.fn(),
      revokeWaiver: vi.fn(),
    } as never,
  };
}
describe("private document callables", () => {
  it("fails closed outside the synthetic pilot", async () => {
    await expect(
      createPrivateWaiverUploadHandler(
        request({
          studentId: "student-1",
          fileName: "waiver.pdf",
          contentType: "application/pdf",
          sizeBytes: 100,
          signedAt: null,
        }),
        services(false),
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });
  it("requires admin role and accepts only the PDF contract", async () => {
    const current = services();
    await expect(
      createPrivateWaiverUploadHandler(
        request({
          studentId: "student-1",
          fileName: "waiver.pdf",
          contentType: "application/pdf",
          sizeBytes: 100,
          signedAt: null,
        }),
        current,
      ),
    ).resolves.toMatchObject({ documentId: "document-1" });
    await expect(
      createPrivateWaiverUploadHandler(
        request(
          {
            studentId: "student-1",
            fileName: "waiver.pdf",
            contentType: "application/pdf",
            sizeBytes: 100,
            signedAt: null,
          },
          "guardian",
        ),
        current,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});
