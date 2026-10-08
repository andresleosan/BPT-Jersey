import { settingsMessages } from "../../../lib/account-settings-client";

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
/** A full-resolution decode of anything larger can exhaust a phone tab's memory. */
const maxSourceBytes = 25 * 1024 * 1024;

export type CroppedAvatar = Readonly<{
  base64: string;
  mime: "image/webp" | "image/png";
  previewUrl: string;
}>;

/**
 * Q3: a fixed centre square, drawn at 512×512 and encoded as WebP with the native canvas; no library.
 * Safari cannot encode WebP and hands back PNG, which the server accepts and re-encodes anyway.
 * A file the browser cannot decode (an SVG, a broken file) throws the one fixed message.
 * ponytail: fixed centre crop; drag-to-frame only if Luis asks for it.
 */
export async function cropToSquareWebp(
  file: File,
  /** Another output (the coach card is 600×800) keeps the same centre crop at that ratio. */
  size: Readonly<{ width: number; height: number }> = { width: 512, height: 512 },
): Promise<CroppedAvatar> {
  if (!acceptedTypes.has(file.type)) throw new Error(settingsMessages.photoType);
  if (file.size > maxSourceBytes) throw new Error(settingsMessages.photoTooLarge);
  let bitmap: ImageBitmap;
  try {
    // The canvas output carries no EXIF, so the rotation must be applied here.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(settingsMessages.photoType);
  }
  const ratio = size.width / size.height;
  const cropWidth = Math.min(bitmap.width, bitmap.height * ratio);
  const cropHeight = cropWidth / ratio;
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context || cropWidth === 0) throw new Error(settingsMessages.photoType);
  context.drawImage(
    bitmap,
    (bitmap.width - cropWidth) / 2,
    (bitmap.height - cropHeight) / 2,
    cropWidth,
    cropHeight,
    0,
    0,
    size.width,
    size.height,
  );
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(settingsMessages.photoType))),
      "image/webp",
      0.85,
    ),
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
