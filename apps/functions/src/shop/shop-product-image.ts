import { randomUUID } from "node:crypto";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { z } from "zod";

import { PhotoRejected, sanitiseAvatar } from "../account-settings/profile-photo.js";
import { browserAdminCallableOptions, browserOrigins } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { coursesAcademyId } from "../courses/course-public-http.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { createPrivateStorageR2Client } from "../storage/r2-client.js";
import { isMissingObjectError } from "./shop-proof.js";

/** Catalog photos are public, so the private bucket serves them through shopProductImage. */
const imageName = /^[0-9a-f-]{36}\.webp$/u;
// The R2 client only stores webp images under academies/{id}/{folder}/{id}/{uuid}.webp.
const productImageKey = (academyId: string, name: string) => `academies/${academyId}/shop-products/catalog/${name}`;

const uploadSchema = z.strictObject({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(1).max(2_800_000),
});

/** Re-encoded like every avatar (EXIF dropped), but never cropped: the shop card shows the whole product. */
export const uploadShopProductImage = onCall(
  { ...browserAdminCallableOptions, secrets: enrolmentStorageSecrets, concurrency: 1, timeoutSeconds: 30 },
  async (request) => {
    const input = uploadSchema.safeParse(request.data);
    if (!input.success) throw new HttpsError("invalid-argument", "Choose a JPEG, PNG or WebP picture under 2 MB.");
    const actor = await requireActiveOfficeActor(request);
    let webp: Buffer;
    try {
      webp = await sanitiseAvatar(Buffer.from(input.data.base64, "base64"), input.data.contentType, { width: 1200, height: 1200 }, "inside");
    } catch (error) {
      if (error instanceof PhotoRejected) throw new HttpsError("invalid-argument", "That picture could not be used. Choose a JPEG, PNG or WebP under 2 MB.");
      throw error;
    }
    const name = `${randomUUID()}.webp`;
    await createPrivateStorageR2Client().putObject(productImageKey(actor.academyId, name), webp, "image/webp");
    // ponytail: a replaced picture stays in R2; add a cleanup if the bucket ever matters.
    return { imageUrl: `https://europe-west9-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/shopProductImage/${name}` };
  },
);

/** Object names are random and never rewritten, so browsers may cache them for a year. */
export const shopProductImage = onRequest(
  { cors: browserOrigins, invoker: "public", timeoutSeconds: 15, maxInstances: 3, secrets: enrolmentStorageSecrets },
  async (request, response) => {
    response.set("X-Content-Type-Options", "nosniff");
    if (request.method !== "GET") { response.set("Allow", "GET"); response.status(405).end(); return; }
    const name = request.path.replace(/^\//u, "");
    const academyId = coursesAcademyId.value();
    if (!imageName.test(name) || !academyId) { response.status(404).end(); return; }
    try {
      const bytes = await createPrivateStorageR2Client().readObject(productImageKey(academyId, name));
      response.set("Content-Type", "image/webp");
      response.set("Cache-Control", "public, max-age=31536000, immutable");
      response.status(200).send(Buffer.from(bytes));
    } catch (error) {
      response.set("Cache-Control", "no-store");
      response.status(isMissingObjectError(error) ? 404 : 500).end();
    }
  },
);
