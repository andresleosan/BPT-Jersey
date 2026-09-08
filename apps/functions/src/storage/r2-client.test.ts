import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDisabledR2Client,
  createEmulatorR2Client,
  createPrivateStorageR2Client,
  createR2Client,
  isEmulatorPrivateStorageAllowed,
  MAX_MEMBER_IMPORT_PDF_BYTES,
  r2EndpointFor,
  validatePdfUpload,
} from "./r2-client.js";

describe("private storage endpoint and jurisdiction", () => {
  const account = "05fb22c155667de064b55c4e287b21d8";

  it("keeps the default endpoint when no jurisdiction is configured", () => {
    expect(r2EndpointFor(account)).toBe(`https://${account}.r2.cloudflarestorage.com`);
    expect(r2EndpointFor(account, "")).toBe(`https://${account}.r2.cloudflarestorage.com`);
  });

  it("routes an EU-restricted bucket to its own endpoint", () => {
    expect(r2EndpointFor(account, "eu")).toBe(`https://${account}.eu.r2.cloudflarestorage.com`);
    expect(r2EndpointFor(account, " EU ")).toBe(`https://${account}.eu.r2.cloudflarestorage.com`);
  });

  /**
   * The T011 residency policy buys a jurisdictional guarantee for waivers and private documents,
   * and the bucket that carries it does not exist on the default host. A typo must therefore stop
   * the write rather than aim it at the unrestricted endpoint: silently leaving the jurisdiction is
   * the failure the policy exists to prevent, and it would look like a working deployment.
   */
  it("refuses an unrecognised jurisdiction instead of falling back to the default host", () => {
    expect(() => r2EndpointFor(account, "europe")).toThrowError(
      "Private file storage jurisdiction is not recognised",
    );
    expect(() => r2EndpointFor(account, "e u")).toThrowError(
      "Private file storage jurisdiction is not recognised",
    );
  });
});

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

describe("private storage selection outside and inside the Functions Emulator", () => {
  const emulatorEnvironment = Object.freeze({
    FUNCTIONS_EMULATOR: "true",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    GCLOUD_PROJECT: "demo-bpt-jersey",
  });
  const objectKey = "academies/academy-1/documents/student-1/document-1.pdf";
  const pdf = new TextEncoder().encode("%PDF-1.4 synthetic");

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows the in-process store only for the Functions Emulator on a loopback demo project", () => {
    expect(isEmulatorPrivateStorageAllowed(emulatorEnvironment)).toBe(true);
    expect(
      isEmulatorPrivateStorageAllowed({
        FUNCTIONS_EMULATOR: "true",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        FIREBASE_PROJECT_ID: "demo-bpt-jersey",
      }),
    ).toBe(true);
  });

  it.each([
    ["no Functions Emulator marker", { ...emulatorEnvironment, FUNCTIONS_EMULATOR: undefined }],
    ["a non-true Functions Emulator marker", { ...emulatorEnvironment, FUNCTIONS_EMULATOR: "1" }],
    ["no Firestore Emulator host", { ...emulatorEnvironment, FIRESTORE_EMULATOR_HOST: undefined }],
    [
      "a hostname instead of loopback",
      { ...emulatorEnvironment, FIRESTORE_EMULATOR_HOST: "localhost:8080" },
    ],
    [
      "a non-loopback address",
      { ...emulatorEnvironment, FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080" },
    ],
    ["a privileged port", { ...emulatorEnvironment, FIRESTORE_EMULATOR_HOST: "127.0.0.1:80" }],
    ["a malformed port", { ...emulatorEnvironment, FIRESTORE_EMULATOR_HOST: "127.0.0.1:80x0" }],
    ["the production project", { ...emulatorEnvironment, GCLOUD_PROJECT: "bptjersey-f5a25" }],
    ["a bare demo prefix", { ...emulatorEnvironment, GCLOUD_PROJECT: "demo-" }],
    ["no project at all", { ...emulatorEnvironment, GCLOUD_PROJECT: undefined }],
  ])("stays fail-closed with %s", (_label, environment) => {
    expect(isEmulatorPrivateStorageAllowed(environment)).toBe(false);
  });

  it("rejects every operation on the disabled client", async () => {
    const disabled = createDisabledR2Client();
    const expected = "Private file storage is not configured";
    await expect(
      disabled.createPdfUploadUrl({
        objectKey,
        fileName: "waiver.pdf",
        contentType: "application/pdf",
        sizeBytes: pdf.byteLength,
        expiresInSeconds: 600,
      }),
    ).rejects.toThrowError(expected);
    await expect(
      disabled.createPdfDownloadUrl({ objectKey, expiresInSeconds: 600 }),
    ).rejects.toThrowError(expected);
    await expect(disabled.putObject(objectKey, pdf, "application/pdf")).rejects.toThrowError(
      expected,
    );
    await expect(disabled.readObject(objectKey)).rejects.toThrowError(expected);
    await expect(disabled.deleteObject(objectKey)).rejects.toThrowError(expected);
  });

  it("stores, reads back and deletes PDF objects by copy in the emulator store", async () => {
    const client = createEmulatorR2Client();
    await client.putObject(objectKey, pdf, "application/pdf");
    const stored = await client.readObject(objectKey);
    expect(Buffer.from(stored).equals(Buffer.from(pdf))).toBe(true);
    stored[0] = 0;
    expect((await client.readObject(objectKey))[0]).toBe(pdf[0]);
    await client.deleteObject(objectKey);
    await expect(client.readObject(objectKey)).rejects.toThrowError("Private object was not found");
  });

  it("keeps the production key, content-type and size rules in the emulator store", async () => {
    const client = createEmulatorR2Client();
    await expect(client.putObject(objectKey, pdf, "text/plain")).rejects.toThrowError(
      "Only PDF objects are accepted",
    );
    await expect(
      client.putObject(
        objectKey,
        new Uint8Array(MAX_MEMBER_IMPORT_PDF_BYTES + 1),
        "application/pdf",
      ),
    ).rejects.toThrowError("Private object exceeds the maximum allowed size");
    await expect(
      client.putObject("tenants/academy-1/document.pdf", pdf, "application/pdf"),
    ).rejects.toThrowError("Invalid private object key");
    await expect(client.readObject("academies/../secret.pdf")).rejects.toThrowError(
      "Invalid private object key",
    );
  });

  it("signs emulator URLs on a reserved host that resolves nowhere", async () => {
    const client = createEmulatorR2Client();
    const upload = await client.createPdfUploadUrl({
      objectKey,
      fileName: "waiver.pdf",
      contentType: "application/pdf",
      sizeBytes: pdf.byteLength,
      expiresInSeconds: 60,
    });
    const download = await client.createPdfDownloadUrl({ objectKey, expiresInSeconds: 600 });
    for (const [url, intent] of [
      [upload, "upload"],
      [download, "download"],
    ] as const) {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe("https:");
      expect(parsed.hostname.endsWith(".invalid")).toBe(true);
      expect(parsed.searchParams.get("intent")).toBe(intent);
      expect(decodeURIComponent(parsed.pathname.slice(1))).toBe(objectKey);
    }
    await expect(
      client.createPdfDownloadUrl({ objectKey, expiresInSeconds: 59 }),
    ).rejects.toThrowError("Signed URL expiry is invalid");
    await expect(
      client.createPdfDownloadUrl({ objectKey, expiresInSeconds: 601 }),
    ).rejects.toThrowError("Signed URL expiry is invalid");
  });

  it("prefers configured R2, then the emulator store, and otherwise fails closed", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "synthetic-account");
    vi.stubEnv("R2_BUCKET_NAME", "synthetic-bucket");
    vi.stubEnv("R2_ACCESS_KEY_ID", "synthetic-access-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "synthetic-secret-key");
    const configured = createPrivateStorageR2Client({ ...process.env, ...emulatorEnvironment });
    await expect(configured.putObject(objectKey, pdf, "text/plain")).rejects.toThrowError(
      "Only PDF objects are accepted",
    );
    // The real adapter validates upload metadata before signing; the emulator store does not.
    await expect(
      configured.createPdfUploadUrl({
        objectKey,
        fileName: "waiver.pdf",
        contentType: "application/octet-stream",
        sizeBytes: pdf.byteLength,
        expiresInSeconds: 600,
      }),
    ).rejects.toThrowError("Only PDF uploads are accepted");

    const emulator = createPrivateStorageR2Client(emulatorEnvironment);
    await emulator.putObject(objectKey, pdf, "application/pdf");
    expect(createPrivateStorageR2Client(emulatorEnvironment)).toBe(emulator);
    expect(
      (await createPrivateStorageR2Client(emulatorEnvironment).readObject(objectKey)).byteLength,
    ).toBe(pdf.byteLength);
    await emulator.deleteObject(objectKey);

    const disabled = createPrivateStorageR2Client({
      ...emulatorEnvironment,
      GCLOUD_PROJECT: "bptjersey-f5a25",
    });
    await expect(disabled.putObject(objectKey, pdf, "application/pdf")).rejects.toThrowError(
      "Private file storage is not configured",
    );
  });
});
