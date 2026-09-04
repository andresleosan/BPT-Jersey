import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  parseShopOrderRequest,
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
import { createShopStore, ShopStoreError, type ShopStore } from "./shop-service.js";

export type ShopCallableServices = Readonly<{
  store: ShopStore;
  now?: () => string;
}>;

const catalogRoles = new Set(["owner", "administrator", "guardian", "adultStudent"]);
const customerRoles = new Set(["guardian", "adultStudent"]);
const adminRoles = new Set(["owner", "administrator"]);

function invalid(): never {
  throw new HttpsError("invalid-argument", "Shop payload is invalid");
}
function noPayload(value: unknown): void {
  if (value !== null && value !== undefined) invalid();
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
  const actor = actorWithRole(request, customerRoles, "Shop orders require a client account");
  const parsed = parseShopOrderRequest(request.data);
  if (!parsed.ok) return invalid();
  try {
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

function callableServices(): ShopCallableServices {
  const firestore = getFirestore() as unknown as Parameters<typeof createShopStore>[0]["firestore"];
  return {
    store: createShopStore({
      firestore,
      appendAudit: (transaction, reference, draft) =>
        appendAuditEventInTransaction(transaction, reference, draft as AuditEventDraft),
    }),
  };
}

export const shopCallableOptions = browserAdminCallableOptions;

export const listShopCatalog = onCall(shopCallableOptions, (request) =>
  listShopCatalogHandler(request, callableServices()),
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
export const placeShopOrder = onCall(shopCallableOptions, (request) =>
  placeShopOrderHandler(request, callableServices()),
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
