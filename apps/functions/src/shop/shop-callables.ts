import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  parseShopCheckoutRequest,
  parseShopOrderStatusUpdate,
  parseShopProductDraft,
  parseShopProductStatusInput,
  toShopOrderProjection,
  toShopProductProjection,
  type ShopOrderProjection,
  type ShopProductProjection,
} from "@bpt-jersey/domain/shop";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { validateIntroProof } from "../memberships/intro-payment-proof.js";
import { createPrivateStorageR2Client } from "../storage/r2-client.js";
import {
  readShopProof,
  shopProofContentType,
  shopProofKey,
  type ShopProofStorage,
} from "./shop-proof.js";
import { createShopStore, ShopStoreError, type ShopStore } from "./shop-service.js";

export type ShopCallableServices = Readonly<{
  store: ShopStore;
  /** Private screenshot storage; resolved lazily so catalogue reads never touch R2. */
  storage?: () => ShopProofStorage;
  now?: () => string;
}>;

// Every signed-in account may buy: a shopper (buyer with no student record), members, coaches and
// the office. Administration and payment screenshots stay with owner and administrator.
const accountRoles = new Set([
  "owner",
  "administrator",
  "headCoach",
  "coach",
  "guardian",
  "adultStudent",
  "teenStudent",
  "shopper",
]);
const catalogRoles = accountRoles;
const customerRoles = accountRoles;
const adminRoles = new Set(["owner", "administrator"]);
const evidenceUnavailable = "Payment evidence is unavailable.";

function storageOf(services: ShopCallableServices): ShopProofStorage {
  if (!services.storage) throw new HttpsError("failed-precondition", evidenceUnavailable);
  return services.storage();
}

function invalid(): never {
  throw new HttpsError("invalid-argument", "Shop payload is invalid");
}
function noPayload(value: unknown): void {
  if (value !== null && value !== undefined) invalid();
}
// An anonymous caller carries no academy claim, so the public catalogue takes the tenant from the
// payload. It is a plain slug, never used to widen access: the handler only ever reads published
// products of that academy and returns the same projection the signed-in catalogue returns.
const publicAcademyIdPattern = /^[a-z][a-z0-9-]{2,60}$/u;

function publicAcademyId(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== "academyId") invalid();
  const academyId = (value as { academyId: unknown }).academyId;
  if (typeof academyId !== "string" || !publicAcademyIdPattern.test(academyId)) invalid();
  return academyId;
}

function actorWithRole(request: CallableRequest<unknown>, roles: Set<string>, message: string) {
  const actor = requireUserActor(request);
  if (!roles.has(actor.role)) throw new HttpsError("permission-denied", message);
  return actor;
}
function now(services: ShopCallableServices): string {
  return services.now?.() ?? new Date().toISOString();
}
function mapError(error: unknown, operation: "read" | "write"): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof ShopStoreError) {
    if (error.code === "invalid")
      throw new HttpsError("invalid-argument", "Shop payload is invalid");
    if (error.code === "not-found") throw new HttpsError("not-found", "Shop record not found");
    if (error.code === "forbidden" || error.code === "tenant")
      throw new HttpsError("permission-denied", "Shop access is not permitted");
    if (error.code === "conflict")
      throw new HttpsError("already-exists", "Shop request already used");
    if (error.code === "precondition") throw new HttpsError("failed-precondition", error.message);
  }
  throw new HttpsError(
    "internal",
    operation === "read" ? "Unable to read the club shop" : "Unable to update the club shop",
  );
}

export async function listShopCatalogHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<readonly ShopProductProjection[]> {
  const actor = actorWithRole(request, catalogRoles, "Shop access is not permitted");
  noPayload(request.data);
  try {
    const products = await services.store.listProducts(actor.academyId);
    return products.filter((product) => product.active).map(toShopProductProjection);
  } catch (error) {
    return mapError(error, "read");
  }
}

/**
 * The club shop catalogue is public information: the academy already lists its merchandise on its
 * own website, so a visitor can read it without an account and only needs to sign in to order.
 * Hidden products never leave the backend and the projection carries no order, customer, cost or
 * internal field.
 */
export async function listPublicShopCatalogHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<readonly ShopProductProjection[]> {
  const academyId = publicAcademyId(request.data);
  try {
    const products = await services.store.listProducts(academyId);
    return products.filter((product) => product.active).map(toShopProductProjection);
  } catch (error) {
    return mapError(error, "read");
  }
}

export async function listManagedShopProductsHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<readonly ShopProductProjection[]> {
  const actor = actorWithRole(request, adminRoles, "Shop administration is not permitted");
  noPayload(request.data);
  try {
    return (await services.store.listProducts(actor.academyId)).map(toShopProductProjection);
  } catch (error) {
    return mapError(error, "read");
  }
}

export async function saveShopProductHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<ShopProductProjection> {
  const actor = actorWithRole(request, adminRoles, "Shop administration is not permitted");
  const parsed = parseShopProductDraft(request.data);
  if (!parsed.ok) return invalid();
  try {
    return toShopProductProjection(
      await services.store.saveProduct({
        academyId: actor.academyId,
        actorId: actor.userId,
        now: now(services),
        draft: parsed.value,
      }),
    );
  } catch (error) {
    return mapError(error, "write");
  }
}

export async function setShopProductActiveHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<ShopProductProjection> {
  const actor = actorWithRole(request, adminRoles, "Shop administration is not permitted");
  const parsed = parseShopProductStatusInput(request.data);
  if (!parsed.ok) return invalid();
  try {
    return toShopProductProjection(
      await services.store.setProductActive({
        academyId: actor.academyId,
        actorId: actor.userId,
        now: now(services),
        productId: parsed.value.productId,
        active: parsed.value.active,
      }),
    );
  } catch (error) {
    return mapError(error, "write");
  }
}

export async function placeShopOrderHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<ShopOrderProjection> {
  const actor = actorWithRole(request, customerRoles, "Sign in to order");
  const parsed = parseShopCheckoutRequest(request.data);
  if (!parsed.ok) return invalid();
  try {
    if (parsed.value.paymentMethod === "bank_transfer") {
      const key = shopProofKey(
        actor.academyId,
        actor.userId,
        parsed.value.requestId,
        parsed.value.proofId!,
      );
      if (!(await readShopProof(storageOf(services), key, parsed.value.proofId!)))
        throw new HttpsError(
          "failed-precondition",
          "Upload the transfer screenshot again before placing the order.",
        );
    }
    return toShopOrderProjection(
      await services.store.placeOrder({
        academyId: actor.academyId,
        actorId: actor.userId,
        now: now(services),
        request: parsed.value,
      }),
    );
  } catch (error) {
    return mapError(error, "write");
  }
}

export async function listMyShopOrdersHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<readonly ShopOrderProjection[]> {
  const actor = actorWithRole(request, customerRoles, "Shop orders require a client account");
  noPayload(request.data);
  try {
    const orders = await services.store.listCustomerOrders(actor.academyId, actor.userId);
    return orders
      .filter((order) => order.customerUserId === actor.userId)
      .map(toShopOrderProjection);
  } catch (error) {
    return mapError(error, "read");
  }
}

export async function listShopOrdersHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<readonly ShopOrderProjection[]> {
  const actor = actorWithRole(request, adminRoles, "Shop administration is not permitted");
  noPayload(request.data);
  try {
    return (await services.store.listOrders(actor.academyId)).map(toShopOrderProjection);
  } catch (error) {
    return mapError(error, "read");
  }
}

export async function updateShopOrderHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<ShopOrderProjection> {
  const actor = actorWithRole(request, adminRoles, "Shop administration is not permitted");
  const parsed = parseShopOrderStatusUpdate(request.data);
  if (!parsed.ok) return invalid();
  try {
    return toShopOrderProjection(
      await services.store.updateOrder({
        academyId: actor.academyId,
        actorId: actor.userId,
        now: now(services),
        update: parsed.value,
      }),
    );
  } catch (error) {
    return mapError(error, "write");
  }
}

const proofUploadSchema = z.strictObject({
  requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  contentType: z.enum(["image/png", "image/jpeg"]),
  base64: z
    .string()
    .min(4)
    .max(Math.ceil((2 * 1024 * 1024) / 3) * 4),
});

export async function uploadShopOrderProofHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<{ proofId: string }> {
  const actor = actorWithRole(request, customerRoles, "Sign in to order");
  const input = proofUploadSchema.safeParse(request.data);
  if (!input.success)
    throw new HttpsError("invalid-argument", "Choose a PNG or JPEG screenshot up to 2 MB.");
  const validated = validateIntroProof(input.data.contentType, input.data.base64);
  const storage = storageOf(services);
  try {
    await storage.putObject(
      shopProofKey(actor.academyId, actor.userId, input.data.requestId, validated.proofId),
      validated.bytes,
      input.data.contentType,
    );
  } catch {
    throw new HttpsError("internal", "The payment screenshot could not be uploaded.");
  }
  return { proofId: validated.proofId };
}

export async function getShopOrderProofUrlHandler(
  request: CallableRequest<unknown>,
  services: ShopCallableServices,
): Promise<{ url: string; expiresAt: string }> {
  const actor = actorWithRole(request, adminRoles, "Shop administration is not permitted");
  const input = z
    .strictObject({ orderId: z.string().regex(/^order-[A-Za-z0-9._:-]{1,128}$/u) })
    .safeParse(request.data);
  if (!input.success) invalid();
  let order;
  try {
    order = await services.store.getOrder(actor.academyId, input.data.orderId);
  } catch (error) {
    return mapError(error, "read");
  }
  if (order.paymentMethod !== "bank_transfer" || !order.proofId)
    throw new HttpsError("failed-precondition", evidenceUnavailable);
  const storage = storageOf(services);
  const objectKey = shopProofKey(
    actor.academyId,
    order.customerUserId,
    order.requestId,
    order.proofId,
  );
  const bytes = await readShopProof(storage, objectKey, order.proofId);
  const contentType = bytes ? shopProofContentType(bytes) : undefined;
  if (!contentType || !storage.createPrivateImageUrl)
    throw new HttpsError("failed-precondition", evidenceUnavailable);
  return {
    url: await storage.createPrivateImageUrl({ objectKey, expiresInSeconds: 60, contentType }),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function callableServices(): ShopCallableServices {
  const firestore = getFirestore() as unknown as Parameters<typeof createShopStore>[0]["firestore"];
  return {
    store: createShopStore({
      firestore,
      appendAudit: (transaction, reference, draft) =>
        appendAuditEventInTransaction(transaction, reference, draft as AuditEventDraft),
    }),
    storage: () => createPrivateStorageR2Client(),
  };
}

export const shopCallableOptions = browserAdminCallableOptions;

export const listShopCatalog = onCall(shopCallableOptions, (request) =>
  listShopCatalogHandler(request, callableServices()),
);
export const listPublicShopCatalog = onCall(shopCallableOptions, (request) =>
  listPublicShopCatalogHandler(request, callableServices()),
);
export const listManagedShopProducts = onCall(shopCallableOptions, (request) =>
  listManagedShopProductsHandler(request, callableServices()),
);
export const saveShopProduct = onCall(shopCallableOptions, (request) =>
  saveShopProductHandler(request, callableServices()),
);
export const setShopProductActive = onCall(shopCallableOptions, (request) =>
  setShopProductActiveHandler(request, callableServices()),
);
const shopProofCallableOptions = { ...shopCallableOptions, secrets: enrolmentStorageSecrets };
export const placeShopOrder = onCall(shopProofCallableOptions, (request) =>
  placeShopOrderHandler(request, callableServices()),
);
export const uploadShopOrderProof = onCall(shopProofCallableOptions, (request) =>
  uploadShopOrderProofHandler(request, callableServices()),
);
export const getShopOrderProofUrl = onCall(shopProofCallableOptions, (request) =>
  getShopOrderProofUrlHandler(request, callableServices()),
);
export const listMyShopOrders = onCall(shopCallableOptions, (request) =>
  listMyShopOrdersHandler(request, callableServices()),
);
export const listShopOrders = onCall(shopCallableOptions, (request) =>
  listShopOrdersHandler(request, callableServices()),
);
export const updateShopOrder = onCall(shopCallableOptions, (request) =>
  updateShopOrderHandler(request, callableServices()),
);
