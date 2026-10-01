import { z } from "zod";

import { httpsCallable } from "./callable";

import {
  parseShopOrderProjection,
  parseShopCheckoutRequest,
  parseShopOrderStatusUpdate,
  parseShopProductDraft,
  parseShopProductProjection,
  parseShopProductStatusInput,
  sortShopProducts,
  type ShopCheckoutRequest,
  type ShopOrderProjection,
  type ShopOrderStatusUpdate,
  type ShopProductDraft,
  type ShopProductProjection,
} from "@bpt-jersey/domain/shop";
import { getFirebaseFunctions } from "./firebase-client";

const catalogError = "Unable to load the club shop.";
const publicCatalogError = "Unable to load the club shop catalog.";
const productError = "Unable to save the product.";
const orderError = "Unable to place the order.";
const ordersError = "Unable to load orders.";
const orderUpdateError = "Unable to update the order.";

function product(value: unknown, message: string): ShopProductProjection {
  const parsed = parseShopProductProjection(value);
  if (!parsed.ok) throw new Error(message);
  return parsed.value;
}
function order(value: unknown, message: string): ShopOrderProjection {
  const parsed = parseShopOrderProjection(value);
  if (!parsed.ok) throw new Error(message);
  return parsed.value;
}
function list(value: unknown, message: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(message);
  return value;
}
/** The callable's own message, only when the error carries the given code and a message. */
function callableMessage(error: unknown, code: string): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const actual = "code" in error ? String((error as { code: unknown }).code) : "";
  const message = "message" in error ? String((error as { message: unknown }).message) : "";
  return actual.endsWith(code) && message ? message : undefined;
}
async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  const callable = httpsCallable<Input, Output>(getFirebaseFunctions(), name);
  return (await callable(input)).data;
}

/** Reads the published catalogue without a session. Only active products ever come back. */
export async function listPublicShopCatalog(
  academyId: string,
): Promise<readonly ShopProductProjection[]> {
  try {
    const data = list(
      await call<{ academyId: string }, unknown>("listPublicShopCatalog", { academyId }),
      publicCatalogError,
    );
    return sortShopProducts(data.map((item) => product(item, publicCatalogError)));
  } catch {
    throw new Error(publicCatalogError);
  }
}

export async function listShopCatalog(): Promise<readonly ShopProductProjection[]> {
  try {
    const data = list(await call<null, unknown>("listShopCatalog", null), catalogError);
    return sortShopProducts(data.map((item) => product(item, catalogError)));
  } catch {
    throw new Error(catalogError);
  }
}

export async function listManagedShopProducts(): Promise<readonly ShopProductProjection[]> {
  try {
    const data = list(await call<null, unknown>("listManagedShopProducts", null), catalogError);
    return sortShopProducts(data.map((item) => product(item, catalogError)));
  } catch {
    throw new Error(catalogError);
  }
}

export async function saveShopProduct(input: ShopProductDraft): Promise<ShopProductProjection> {
  try {
    const parsed = parseShopProductDraft(input);
    if (!parsed.ok) throw new Error(productError);
    return product(await call("saveShopProduct", parsed.value), productError);
  } catch {
    throw new Error(productError);
  }
}

export async function setShopProductActive(
  productId: string,
  active: boolean,
): Promise<ShopProductProjection> {
  try {
    const parsed = parseShopProductStatusInput({ productId, active });
    if (!parsed.ok) throw new Error(productError);
    const result = product(await call("setShopProductActive", parsed.value), productError);
    if (result.productId !== productId || result.active !== active) throw new Error(productError);
    return result;
  } catch {
    throw new Error(productError);
  }
}

export async function placeShopOrder(input: ShopCheckoutRequest): Promise<ShopOrderProjection> {
  try {
    const parsed = parseShopCheckoutRequest(input);
    if (!parsed.ok) throw new Error(orderError);
    return order(await call("placeShopOrder", parsed.value), orderError);
  } catch (error) {
    // Both codes carry a message written for the customer by the callable.
    const message =
      callableMessage(error, "failed-precondition") ?? callableMessage(error, "already-exists");
    throw new Error(message ?? orderError);
  }
}

const proofError = "The payment screenshot could not be uploaded.";

/** Same base64 hand-off as the PAYG and intro receipts; the server re-checks the bytes. */
export async function uploadShopOrderProof(requestId: string, file: File): Promise<string> {
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size < 1 || file.size > 2 * 1024 * 1024)
    throw new Error("Choose a PNG or JPEG screenshot up to 2 MB.");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const data = await call("uploadShopOrderProof", { requestId, contentType: file.type, base64: btoa(binary) });
    return z.strictObject({ proofId: z.string().regex(/^[a-f0-9]{64}$/u) }).parse(data).proofId;
  } catch (error) {
    // The callable says what is wrong with the file (type, size, not a real image).
    throw new Error(callableMessage(error, "invalid-argument") ?? proofError);
  }
}

export async function getShopOrderProofUrl(orderId: string): Promise<string> {
  try {
    const data = await call("getShopOrderProofUrl", { orderId });
    return z.object({ url: z.url() }).parse(data).url;
  } catch (error) {
    // not-found means R2's 90-day rule already deleted it; the callable says so.
    throw new Error(
      callableMessage(error, "not-found") ?? "The transfer screenshot is unavailable.",
    );
  }
}

export async function listMyShopOrders(): Promise<readonly ShopOrderProjection[]> {
  try {
    const data = list(await call<null, unknown>("listMyShopOrders", null), ordersError);
    return Object.freeze(data.map((item) => order(item, ordersError)));
  } catch {
    throw new Error(ordersError);
  }
}

export async function listShopOrders(): Promise<readonly ShopOrderProjection[]> {
  try {
    const data = list(await call<null, unknown>("listShopOrders", null), ordersError);
    return Object.freeze(data.map((item) => order(item, ordersError)));
  } catch {
    throw new Error(ordersError);
  }
}

export async function updateShopOrder(input: ShopOrderStatusUpdate): Promise<ShopOrderProjection> {
  try {
    const parsed = parseShopOrderStatusUpdate(input);
    if (!parsed.ok) throw new Error(orderUpdateError);
    return order(await call("updateShopOrder", parsed.value), orderUpdateError);
  } catch {
    throw new Error(orderUpdateError);
  }
}
