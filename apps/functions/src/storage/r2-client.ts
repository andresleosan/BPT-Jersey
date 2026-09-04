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
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}
