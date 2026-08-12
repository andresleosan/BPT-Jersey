import { describe, expect, it } from "vitest";

import { createR2Client, MAX_MEMBER_IMPORT_PDF_BYTES, validatePdfUpload } from "./r2-client.js";

describe("private R2 member import adapter", () => {
  it("accepts only bounded PDF metadata", () => {
    expect(
      validatePdfUpload({
        fileName: "members.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).toEqual({ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 });

    expect(() =>
      validatePdfUpload({
        fileName: "members.exe",
        contentType: "application/octet-stream",
        sizeBytes: 1024,
      }),
    ).toThrowError("Only PDF uploads are accepted");
    expect(() =>
      validatePdfUpload({
        fileName: "members.pdf",
        contentType: "application/pdf",
        sizeBytes: MAX_MEMBER_IMPORT_PDF_BYTES + 1,
      }),
    ).toThrowError("PDF exceeds the maximum allowed size");
  });

  it("issues a short-lived PUT URL through the injected S3 client", async () => {
    const commands: unknown[] = [];
    const client = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async (command, options) => {
        commands.push({ command, options });
        return "https://signed.example/upload";
      },
    });

    const result = await client.createPdfUploadUrl({
      objectKey: "academies/academy-1/member-imports/session-1/members.pdf",
      fileName: "members.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      expiresInSeconds: 600,
    });

    expect(result).toBe("https://signed.example/upload");
    expect(commands).toHaveLength(1);
    expect(JSON.stringify(commands[0])).not.toContain("test-secret-key");
  });

  it.each([
    ["http://signed.example/upload", "http signer URL"],
    ["/relative/upload", "relative signer URL"],
    ["not a URL", "malformed signer URL"],
  ])("rejects a %s from the upload signer", async (signedUrl) => {
    const client = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => signedUrl,
    });

    await expect(
      client.createPdfUploadUrl({
        objectKey: "academies/academy-1/member-imports/session-1/members.pdf",
        fileName: "members.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
        expiresInSeconds: 600,
      }),
    ).rejects.toThrow("Signed URL is invalid");
  });

  it.each([
    ["http://signed.example/report.pdf", "http signer URL"],
    ["/relative/report.pdf", "relative signer URL"],
    ["not a URL", "malformed signer URL"],
  ])("rejects a %s", async (signedUrl) => {
    const client = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      getSigner: async () => signedUrl,
    });

    await expect(
      client.createPdfDownloadUrl({
        objectKey: "academies/academy-1/member-reports/session-1/active.pdf",
        expiresInSeconds: 300,
      }),
    ).rejects.toThrow("Signed URL is invalid");
  });

  it("accepts only an absolute HTTPS download URL while preserving expiry validation", async () => {
    const client = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      getSigner: async () => "https://signed.example/report.pdf",
    });

    await expect(
      client.createPdfDownloadUrl({
        objectKey: "academies/academy-1/member-reports/session-1/active.pdf",
        expiresInSeconds: 300,
      }),
    ).resolves.toBe("https://signed.example/report.pdf");
    await expect(
      client.createPdfDownloadUrl({
        objectKey: "academies/academy-1/member-reports/session-1/active.pdf",
        expiresInSeconds: 30,
      }),
    ).rejects.toThrow("Signed URL expiry is invalid");
  });

  it("does not require a real bucket for object cleanup in tests", async () => {
    const deleted: string[] = [];
    const client = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async (objectKey) => {
        deleted.push(objectKey);
      },
    });

    await client.deleteObject("academies/academy-1/member-imports/session-1/members.pdf");

    expect(deleted).toEqual(["academies/academy-1/member-imports/session-1/members.pdf"]);
  });

  it("aborts a streaming body over the limit even when ContentLength is absent", async () => {
    let aborted = false;
    const oversizedChunk = new Uint8Array(MAX_MEMBER_IMPORT_PDF_BYTES / 2 + 1);
    const client = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      getObject: async () => ({
        body: (async function* () {
          yield oversizedChunk;
          yield oversizedChunk;
        })(),
        abort: () => {
          aborted = true;
        },
      }),
    });

    await expect(
      client.readObject("academies/academy-1/member-imports/session-1/members.pdf"),
    ).rejects.toThrow("Private object exceeds the maximum allowed size");
    expect(aborted).toBe(true);
  });

  it("only exposes a stream adapter to injected object readers", async () => {
    const chunks: unknown[] = [];
    const client = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      getObject: async () => ({
        body: (async function* () {
          const chunk = new Uint8Array([37, 80, 68, 70]);
          chunks.push(chunk);
          yield chunk;
        })(),
      }),
    });

    await expect(
      client.readObject("academies/academy-1/member-imports/session-1/members.pdf"),
    ).resolves.toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(chunks[0]).toBeInstanceOf(Uint8Array);
  });
});
