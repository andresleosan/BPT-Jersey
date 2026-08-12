import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  getFirebaseFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(),
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: mocks.getFirebaseFunctions,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mocks.httpsCallable,
}));

import {
  confirmMemberImport,
  createMemberImportSession,
  previewMemberImport,
  uploadMemberImportFiles,
  validateMemberImportFiles,
  type MemberImportFile,
} from "./member-import-client";

function pdf(name = "members.pdf", size = 100): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

function futureIso(minutes = 5): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

const preview = {
  previewId: "preview-1",
  expiresAt: futureIso(),
  sourceReports: [{ source: "pdf-1", report: "active", rowCount: 2 }],
  additions: [{ stableKey: "new-member", rowNumbers: [2], fieldNames: ["fullName"] }],
  updates: [],
  duplicates: [],
  conflicts: [],
};

describe("member import client", () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.httpsCallable.mockReset();
  });

  it("validates only non-empty PDF files up to five and 10 MiB each", () => {
    expect(validateMemberImportFiles([pdf("one.pdf"), pdf("two.pdf")])).toHaveLength(2);
    expect(validateMemberImportFiles(Array.from({ length: 6 }, (_, index) => pdf(`${index}.pdf`)))).toEqual([]);
    expect(validateMemberImportFiles([pdf("large.pdf", 10 * 1024 * 1024 + 1)])).toEqual([]);
    expect(validateMemberImportFiles([new File(["text"], "members.txt", { type: "text/plain" })])).toEqual([]);
  });

  it("sends the exact session metadata payload and returns the server response", async () => {
    const response = {
      sessionId: "session-1",
      uploads: [{ objectKey: "server/key.pdf", uploadUrl: "https://upload.example/key" }],
      expiresAt: futureIso(),
    };
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockResolvedValue({ data: response });

    const file = validateMemberImportFiles([pdf("members.pdf", 12)])[0];
    if (file === undefined) throw new Error("Test file was not accepted");
    await expect(createMemberImportSession([file])).resolves.toEqual(response);
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "createMemberPdfImportSession");
    expect(mocks.callable).toHaveBeenCalledWith({
      files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 12 }],
    });
  });

  it("uploads only to returned HTTPS URLs and reports progress", async () => {
    const open = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const progress = vi.fn();
    const files = validateMemberImportFiles([pdf("members.pdf")]);
    const file = files[0];
    if (file === undefined) throw new Error("Test file was not accepted");
    const session = {
      sessionId: "session-1",
      uploads: [{ objectKey: "server/key.pdf", uploadUrl: "https://upload.example/key" }],
      expiresAt: futureIso(),
    };

    await uploadMemberImportFiles(files, session, progress);

    expect(open).toHaveBeenCalledWith("https://upload.example/key", {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: file.file,
    });
    expect(progress).toHaveBeenCalledWith(1, 1);
    open.mockRestore();
  });

  it("sends only sessionId for preview and the explicit confirmation payload", async () => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable
      .mockResolvedValueOnce({ data: preview })
      .mockResolvedValueOnce({ data: { imported: 1, updated: 2, conflicts: 0 } });

    await expect(previewMemberImport("session-1")).resolves.toEqual(preview);
    await expect(confirmMemberImport("session-1", "preview-1")).resolves.toEqual({
      imported: 1,
      updated: 2,
      conflicts: 0,
    });
    expect(mocks.callable).toHaveBeenNthCalledWith(1, { sessionId: "session-1" });
    expect(mocks.callable).toHaveBeenNthCalledWith(2, {
      sessionId: "session-1",
      previewId: "preview-1",
      confirm: true,
    });
  });

  it("rejects expired or unbounded session responses", async () => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    for (const expiresAt of [
      new Date(Date.now() - 1).toISOString(),
      new Date(Date.now() + 11 * 60 * 1000).toISOString(),
    ]) {
      mocks.callable.mockResolvedValueOnce({
        data: {
          sessionId: "session-1",
          uploads: [{ objectKey: "server/key.pdf", uploadUrl: "https://upload.example/key" }],
          expiresAt,
        },
      });
      const file = validateMemberImportFiles([pdf()])[0];
      if (!file) throw new Error("Test file was not accepted");
      await expect(createMemberImportSession([file])).rejects.toThrow(
        "Unable to start member import. Please try again.",
      );
    }
  });

  it("rejects expired or unbounded preview responses", async () => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    for (const expiresAt of [
      new Date(Date.now() - 1).toISOString(),
      new Date(Date.now() + 11 * 60 * 1000).toISOString(),
    ]) {
      mocks.callable.mockResolvedValueOnce({ data: { ...preview, expiresAt } });
      await expect(previewMemberImport("session-1")).rejects.toThrow(
        "Unable to prepare member import. Please try again.",
      );
    }
  });

  it("sanitizes callable, upload, and malformed response errors", async () => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockRejectedValue(new Error("private callable details"));
    await expect(previewMemberImport("session-1")).rejects.toThrow(
      "Unable to prepare member import. Please try again.",
    );

    mocks.callable.mockResolvedValue({ data: { sessionId: "session-1", uploads: [] } });
    const invalidResponseFile = validateMemberImportFiles([pdf()])[0];
    if (invalidResponseFile === undefined) throw new Error("Test file was not accepted");
    await expect(createMemberImportSession([invalidResponseFile])).rejects.toThrow(
      "Unable to start member import. Please try again.",
    );

    const validFiles = validateMemberImportFiles([pdf()]);
    await expect(
      uploadMemberImportFiles(validFiles as readonly MemberImportFile[], {
        sessionId: "session-1",
        uploads: [{ objectKey: "server/key.pdf", uploadUrl: "http://not-https.example/key" }],
        expiresAt: "2026-08-11T12:10:00.000Z",
      }),
    ).rejects.toThrow("Unable to upload member reports. Please try again.");
  });
});
