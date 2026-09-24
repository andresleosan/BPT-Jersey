import { settingsMessages } from "../../../lib/account-settings-client";

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
/** A full-resolution decode of anything larger can exhaust a phone tab's memory. */
const maxSourceBytes = 25 * 1024 * 1024;

export type CroppedAvatar = Readonly<{ base64: string; mime: "image/webp" | "image/png"; previewUrl: string }>;

/**
 * Q3: a fixed centre square, drawn at 512×512 and encoded as WebP with the native canvas; no library.
 * Safari cannot encode WebP and hands back PNG, which the server accepts and re-encodes anyway.
 * A file the browser cannot decode (an SVG, a broken file) throws the one fixed message.
 * ponytail: fixed centre crop; drag-to-frame only if Luis asks for it.
 */
export async function cropToSquareWebp(file: File): Promise<CroppedAvatar> {
  if (!acceptedTypes.has(file.type)) throw new Error(settingsMessages.photoType);
  if (file.size > maxSourceBytes) throw new Error(settingsMessages.photoTooLarge);
  let bitmap: ImageBitmap;
  try {
    // The canvas output carries no EXIF, so the rotation must be applied here.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(settingsMessages.photoType);
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context || side === 0) throw new Error(settingsMessages.photoType);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(settingsMessages.photoType))), "image/webp", 0.85),
  );
  const mime = blob.type === "image/webp" ? "image/webp" : "image/png";
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Chunked: spreading a whole image into String.fromCharCode can overflow the call stack.
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  const base64 = btoa(binary);
  return { base64, mime, previewUrl: `data:${mime};base64,${base64}` };
}
