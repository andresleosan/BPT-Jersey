import sharp from "sharp";
import type { R2Client } from "../storage/r2-client.js";

const maxBytes = 2 * 1024 * 1024;
/** Signed avatar URLs live 15 minutes; the R2 client refuses any other expiry for avatars. */
const avatarUrlSeconds = 900;
const signatures: Record<"image/jpeg" | "image/png" | "image/webp", (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};

export class PhotoRejected extends Error {}

/** Q3: size first, magic bytes, one decoded frame, then a fresh 512×512 WebP without metadata. */
export async function sanitiseAvatar(bytes: Buffer, mime: "image/jpeg" | "image/png" | "image/webp"): Promise<Buffer> {
  if (bytes.length === 0 || bytes.length > maxBytes || !signatures[mime]?.(bytes)) throw new PhotoRejected();
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning", animated: false });
    const meta = await image.metadata();
    if ((meta.pages ?? 1) !== 1 || !meta.width || !meta.height) throw new PhotoRejected();
    // sharp drops EXIF/ICC/XMP unless withMetadata() is called.
    return await image.rotate().resize(512, 512, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw new PhotoRejected();
  }
}

/** The only way another member's photo leaves the server: a consented key, signed for 15 minutes. */
export async function signPhotoUrl(r2: R2Client, objectKey: string | null, consentAt: string | null): Promise<string | null> {
  if (!objectKey || !consentAt || !r2.createPrivateImageUrl) return null;
  return r2.createPrivateImageUrl({ objectKey, expiresInSeconds: avatarUrlSeconds, contentType: "image/webp" });
}
