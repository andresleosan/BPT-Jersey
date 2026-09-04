import { httpsCallable } from "firebase/functions";

import {
  parseShopOrderProjection,
  parseShopOrderRequest,
  parseShopOrderStatusUpdate,
  parseShopProductDraft,
  parseShopProductProjection,
  parseShopProductStatusInput,
  sortShopProducts,
  type ShopOrderProjection,
  type ShopOrderRequest,
  type ShopOrderStatusUpdate,
  type ShopProductDraft,
  type ShopProductProjection,
} from "@bpt-jersey/domain/shop";
import { getFirebaseFunctions } from "./firebase-client";

const catalogError = "Unable to load the club shop.";
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
async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  const callable = httpsCallable<Input, Output>(getFirebaseFunctions(), name);
  return (await callable(input)).data;
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

export async function placeShopOrder(input: ShopOrderRequest): Promise<ShopOrderProjection> {
  try {
    const parsed = parseShopOrderRequest(input);
    if (!parsed.ok) throw new Error(orderError);
    return order(await call("placeShopOrder", parsed.value), orderError);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : "";
    if (code.endsWith("failed-precondition") && message) throw new Error(message);
    throw new Error(orderError);
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
