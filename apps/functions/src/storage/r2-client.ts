import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { normalizeMemberImportPdfFileName } from "@bpt-jersey/domain/members";

export const MAX_MEMBER_IMPORT_PDF_BYTES = 10 * 1024 * 1024;
export const MEMBER_IMPORT_UPLOAD_URL_SECONDS = 600;

export type PdfUploadMetadata = Readonly<{
  fileName: string;
  contentType: string;
  sizeBytes: number;
}>;

export type R2Signer = (
  command: PutObjectCommand,
  options: Readonly<{ expiresIn: number }>,
) => Promise<string>;

export type R2GetSigner = (
  command: GetObjectCommand,
  options: Readonly<{ expiresIn: number }>,
) => Promise<string>;

export type R2Client = Readonly<{
  createPdfUploadUrl: (
    input: PdfUploadMetadata & { objectKey: string; expiresInSeconds: number },
  ) => Promise<string>;
  createPdfDownloadUrl: (input: { objectKey: string; expiresInSeconds: number }) => Promise<string>;
  putObject: (objectKey: string, body: Uint8Array, contentType: string) => Promise<void>;
  readObject: (objectKey: string) => Promise<Uint8Array>;
  deleteObject: (objectKey: string) => Promise<void>;
}>;

export type R2ClientOptions = Readonly<{
  bucket: string;
  endpoint: string;
  credentials: Readonly<{ accessKeyId: string; secretAccessKey: string }>;
  signer?: R2Signer;
  getSigner?: R2GetSigner;
  putObject?: (objectKey: string, body: Uint8Array, contentType: string) => Promise<void>;
  getObject?: (objectKey: string) => Promise<R2ObjectResponse>;
  deleteObject?: (objectKey: string) => Promise<void>;
}>;

export type R2ObjectResponse = Readonly<{
  body: AsyncIterable<Uint8Array>;
  contentLength?: number;
  abort?: () => void;
}>;

function assertObjectKey(objectKey: string): void {
  if (
    objectKey.length === 0 ||
    objectKey.length > 512 ||
    !objectKey.startsWith("academies/") ||
    objectKey.includes("..") ||
    objectKey.includes("\\") ||
    objectKey.includes("//")
  ) {
    throw new Error("Invalid private object key");
  }
}

function assertHttpsAbsoluteUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Signed URL is invalid");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.length === 0) {
      throw new Error("Signed URL is invalid");
    }
  } catch {
    throw new Error("Signed URL is invalid");
  }
  return value;
}

function isAsyncByteIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

async function readLimitedObject(response: R2ObjectResponse): Promise<Uint8Array> {
  if (
    response.contentLength !== undefined &&
    response.contentLength > MAX_MEMBER_IMPORT_PDF_BYTES
  ) {
    response.abort?.();
    throw new Error("Private object exceeds the maximum allowed size");
  }
  if (!isAsyncByteIterable(response.body)) {
    response.abort?.();
    throw new Error("Private object body is not stream-readable");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of response.body) {
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_MEMBER_IMPORT_PDF_BYTES) {
      response.abort?.();
      throw new Error("Private object exceeds the maximum allowed size");
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function validatePdfUpload(input: PdfUploadMetadata): PdfUploadMetadata {
  const fileName = normalizeMemberImportPdfFileName(input.fileName);
  if (fileName === undefined) {
    throw new Error("Only PDF uploads are accepted");
  }
  if (input.contentType !== "application/pdf") {
    throw new Error("Only PDF uploads are accepted");
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new Error("PDF size is invalid");
  }
  if (input.sizeBytes > MAX_MEMBER_IMPORT_PDF_BYTES) {
    throw new Error("PDF exceeds the maximum allowed size");
  }
  return Object.freeze({ ...input, fileName });
}

export function createR2Client(options: R2ClientOptions): R2Client {
  const s3Client = new S3Client({
    endpoint: options.endpoint,
    region: "auto",
    credentials: options.credentials,
  });
  const signer =
    options.signer ?? ((command, signerOptions) => getSignedUrl(s3Client, command, signerOptions));
  const getSigner =
    options.getSigner ??
    ((command, signerOptions) => getSignedUrl(s3Client, command, signerOptions));
  const putObject =
    options.putObject ??
    (async (objectKey: string, body: Uint8Array, contentType: string) => {
      assertObjectKey(objectKey);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: objectKey,
          Body: body,
          ContentType: contentType,
          ContentLength: body.byteLength,
        }),
      );
    });
  const getObject =
    options.getObject ??
    (async (objectKey: string): Promise<R2ObjectResponse> => {
      assertObjectKey(objectKey);
      const response = await s3Client.send(
        new GetObjectCommand({ Bucket: options.bucket, Key: objectKey }),
      );
      if (!response.Body) throw new Error("Private object has no body");
      const body = response.Body;
      if (!isAsyncByteIterable(body)) throw new Error("Private object body is not stream-readable");
      return {
        body,
        abort: () => {
          const destroyable = body as unknown as { destroy?: () => void };
          destroyable.destroy?.();
        },
        ...(response.ContentLength === undefined ? {} : { contentLength: response.ContentLength }),
      };
    });
  const deleteObject =
    options.deleteObject ??
    (async (objectKey: string) => {
      assertObjectKey(objectKey);
      await s3Client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: objectKey }));
    });

  return Object.freeze({
    createPdfUploadUrl: async (input) => {
      assertObjectKey(input.objectKey);
      const metadata = validatePdfUpload(input);
      if (
        !Number.isInteger(input.expiresInSeconds) ||
        input.expiresInSeconds < 60 ||
        input.expiresInSeconds > 600
      ) {
        throw new Error("Signed URL expiry is invalid");
      }
      const signedUrl = await signer(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: input.objectKey,
          ContentType: metadata.contentType,
          ContentLength: metadata.sizeBytes,
        }),
        { expiresIn: input.expiresInSeconds },
      );
      return assertHttpsAbsoluteUrl(signedUrl);
    },
    createPdfDownloadUrl: async (input) => {
      assertObjectKey(input.objectKey);
      if (
        !Number.isInteger(input.expiresInSeconds) ||
        input.expiresInSeconds < 60 ||
        input.expiresInSeconds > 600
      ) {
        throw new Error("Signed URL expiry is invalid");
      }
      const signedUrl = await getSigner(
        new GetObjectCommand({ Bucket: options.bucket, Key: input.objectKey }),
        { expiresIn: input.expiresInSeconds },
      );
      return assertHttpsAbsoluteUrl(signedUrl);
    },
    putObject: async (objectKey, body, contentType) => {
      assertObjectKey(objectKey);
      if (contentType !== "application/pdf") throw new Error("Only PDF objects are accepted");
      if (body.byteLength > MAX_MEMBER_IMPORT_PDF_BYTES) {
        throw new Error("Private object exceeds the maximum allowed size");
      }
      await putObject(objectKey, body, contentType);
    },
    readObject: async (objectKey) => {
      assertObjectKey(objectKey);
      return readLimitedObject(await getObject(objectKey));
    },
    deleteObject: async (objectKey) => {
      assertObjectKey(objectKey);
      return deleteObject(objectKey);
    },
  });
}

const R2_JURISDICTIONS = new Set(["eu", "fedramp"]);

/**
 * A jurisdiction-restricted bucket is only reachable on its own endpoint: the EU bucket that the
 * T011 residency policy requires lives at `<account>.eu.r2.cloudflarestorage.com` and does not
 * exist at all on the default host.
 *
 * An unrecognised jurisdiction throws instead of falling back to the default endpoint. The fallback
 * is the dangerous branch: a typo in `R2_JURISDICTION` would quietly aim private documents at the
 * unrestricted host, which is the exact guarantee the signed policy buys. Failing to write beats
 * writing outside the jurisdiction that was promised.
 */
export function r2EndpointFor(accountId: string, jurisdiction?: string): string {
  const normalized = jurisdiction?.trim().toLowerCase();
  if (normalized === undefined || normalized === "") {
    return `https://${accountId}.r2.cloudflarestorage.com`;
  }
  if (!R2_JURISDICTIONS.has(normalized)) {
    throw new Error("Private file storage jurisdiction is not recognised");
  }
  return `https://${accountId}.${normalized}.r2.cloudflarestorage.com`;
}

export function createR2ClientFromEnvironment(): R2Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Private file storage is not configured");
  }
  return createR2Client({
    bucket,
    endpoint: r2EndpointFor(accountId, process.env.R2_JURISDICTION),
    credentials: { accessKeyId, secretAccessKey },
  });
}

function isLoopbackEmulatorHost(host: string | undefined): boolean {
  const prefix = "127.0.0.1:";
  if (host === undefined || !host.startsWith(prefix)) return false;
  const port = Number(host.slice(prefix.length));
  return Number.isInteger(port) && port >= 1_024 && port <= 65_535;
}

/**
 * Private storage is R2 and nothing else outside the emulator.
 *
 * Accepting a waiver writes its evidence PDF before the consent commits, so with no binding at all
 * the authenticated onboarding path cannot be exercised offline: every acceptance fails on storage
 * long before the flow under test is reached. The Functions Emulator therefore gets an in-process
 * store, reachable only when this process is the Functions Emulator itself, talking to a loopback
 * Firestore Emulator on a demo project. Anywhere else an unconfigured R2 stays fail-closed.
 */
export function isEmulatorPrivateStorageAllowed(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const projectId = environment.GCLOUD_PROJECT ?? environment.FIREBASE_PROJECT_ID ?? "";
  return (
    environment.FUNCTIONS_EMULATOR === "true" &&
    isLoopbackEmulatorHost(environment.FIRESTORE_EMULATOR_HOST) &&
    projectId.startsWith("demo-") &&
    projectId.length > "demo-".length
  );
}

export function createDisabledR2Client(): R2Client {
  const disabled = async (): Promise<never> => {
    throw new Error("Private file storage is not configured");
  };
  return Object.freeze({
    createPdfUploadUrl: disabled,
    createPdfDownloadUrl: disabled,
    putObject: disabled,
    readObject: disabled,
    deleteObject: disabled,
  });
}

/**
 * Emulator-only in-process object store. It keeps the same key, content-type and size rules as the
 * R2 client so a suite cannot pass here on a payload production would reject, and its signed URLs
 * point at a reserved `.invalid` host that resolves nowhere.
 */
export function createEmulatorR2Client(
  objects: Map<string, Uint8Array> = new Map<string, Uint8Array>(),
): R2Client {
  const signedUrl = (objectKey: string, intent: string): string =>
    `https://private-storage.emulator.invalid/${encodeURIComponent(objectKey)}?intent=${intent}`;
  const assertExpiry = (expiresInSeconds: number): void => {
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 600) {
      throw new Error("Signed URL expiry is invalid");
    }
  };
  return Object.freeze({
    createPdfUploadUrl: async (input) => {
      assertObjectKey(input.objectKey);
      assertExpiry(input.expiresInSeconds);
      return assertHttpsAbsoluteUrl(signedUrl(input.objectKey, "upload"));
    },
    createPdfDownloadUrl: async (input) => {
      assertObjectKey(input.objectKey);
      assertExpiry(input.expiresInSeconds);
      return assertHttpsAbsoluteUrl(signedUrl(input.objectKey, "download"));
    },
    putObject: async (objectKey, body, contentType) => {
      assertObjectKey(objectKey);
      if (contentType !== "application/pdf") throw new Error("Only PDF objects are accepted");
      if (body.byteLength > MAX_MEMBER_IMPORT_PDF_BYTES) {
        throw new Error("Private object exceeds the maximum allowed size");
      }
      objects.set(objectKey, Uint8Array.from(body));
    },
    readObject: async (objectKey) => {
      assertObjectKey(objectKey);
      const stored = objects.get(objectKey);
      if (stored === undefined) throw new Error("Private object was not found");
      return Uint8Array.from(stored);
    },
    deleteObject: async (objectKey) => {
      assertObjectKey(objectKey);
      objects.delete(objectKey);
    },
  });
}

let emulatorPrivateStorage: R2Client | undefined;

/**
 * The single private-storage seam for the callables that persist PDF evidence. Configured R2 wins;
 * the emulator store is used only where `isEmulatorPrivateStorageAllowed` holds; everything else
 * fails closed.
 */
export function createPrivateStorageR2Client(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): R2Client {
  const configured = Boolean(
    environment.R2_ACCOUNT_ID &&
    environment.R2_BUCKET_NAME &&
    environment.R2_ACCESS_KEY_ID &&
    environment.R2_SECRET_ACCESS_KEY,
  );
  if (configured) return createR2ClientFromEnvironment();
  if (!isEmulatorPrivateStorageAllowed(environment)) return createDisabledR2Client();
  emulatorPrivateStorage ??= createEmulatorR2Client();
  return emulatorPrivateStorage;
}
