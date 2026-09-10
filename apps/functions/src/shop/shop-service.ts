import {
  canTransitionShopOrder,
  parseShopOrderRecord,
  parseShopProductRecord,
  sortShopProducts,
  type ShopOrderRecord,
  type ShopOrderRequest,
  type ShopOrderStatusUpdate,
  type ShopProductDraft,
  type ShopProductRecord,
} from "@bpt-jersey/domain/shop";

export type ShopDocumentData = Readonly<Record<string, unknown>>;
export type ShopDocumentReference = Readonly<{ id: string; path: string }>;
export type ShopDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => ShopDocumentData | undefined;
}>;
export type ShopQuerySnapshot = Readonly<{ docs: readonly ShopDocumentSnapshot[] }>;
export type ShopQuery = Readonly<{ path: string; field: string; value: unknown; limit: number }>;
export type ShopCollection = Readonly<{
  doc: (id?: string) => ShopDocumentReference;
  where: (
    field: string,
    operator: "==",
    value: unknown,
  ) => Readonly<{ limit: (count: number) => ShopQuery }>;
}>;
export type ShopTransaction = Readonly<{
  get: (
    target: ShopDocumentReference | ShopQuery,
  ) => Promise<ShopDocumentSnapshot | ShopQuerySnapshot>;
  create: (ref: ShopDocumentReference, data: ShopDocumentData) => ShopTransaction;
  set: (ref: ShopDocumentReference, data: ShopDocumentData) => ShopTransaction;
}>;
export type ShopFirestore = Readonly<{
  doc: (path: string) => ShopDocumentReference;
  collection: (path: string) => ShopCollection;
  runTransaction: <T>(callback: (transaction: ShopTransaction) => Promise<T>) => Promise<T>;
}>;

export type ShopAuditAction =
  | "shop.product.saved"
  | "shop.product.status.changed"
  | "shop.order.placed"
  | "shop.order.status.changed";
export type ShopAuditDraft = Readonly<{
  academyId: string;
  actorId: string;
  action: ShopAuditAction;
  targetRef: string;
  purpose: string;
  correlationId: string;
}>;

export type ShopStoreDependencies = Readonly<{
  firestore: ShopFirestore;
  appendAudit: (
    transaction: ShopTransaction,
    reference: ShopDocumentReference,
    draft: ShopAuditDraft,
  ) => void;
}>;

export type SaveShopProductInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  draft: ShopProductDraft;
}>;
export type SetShopProductActiveInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  productId: string;
  active: boolean;
}>;
export type PlaceShopOrderInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  request: ShopOrderRequest;
}>;
export type UpdateShopOrderInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  update: ShopOrderStatusUpdate;
}>;

export type ShopStore = Readonly<{
  listProducts: (academyId: string) => Promise<readonly ShopProductRecord[]>;
  saveProduct: (input: SaveShopProductInput) => Promise<ShopProductRecord>;
  setProductActive: (input: SetShopProductActiveInput) => Promise<ShopProductRecord>;
  placeOrder: (input: PlaceShopOrderInput) => Promise<ShopOrderRecord>;
  listOrders: (academyId: string) => Promise<readonly ShopOrderRecord[]>;
  listCustomerOrders: (academyId: string, userId: string) => Promise<readonly ShopOrderRecord[]>;
  updateOrder: (input: UpdateShopOrderInput) => Promise<ShopOrderRecord>;
}>;

export type ShopStoreErrorCode =
  "invalid" | "tenant" | "not-found" | "conflict" | "precondition" | "forbidden";

export class ShopStoreError extends Error {
  public readonly code: ShopStoreErrorCode;

  public constructor(code: ShopStoreErrorCode, message: string) {
    super(message);
    this.name = "ShopStoreError";
    this.code = code;
  }
}

const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
export const SHOP_PRODUCT_QUERY_LIMIT = 200;
export const SHOP_ORDER_QUERY_LIMIT = 500;
export const SHOP_CUSTOMER_ORDER_QUERY_LIMIT = 100;

function id(value: string, label: string): string {
  if (typeof value !== "string" || !safePathSegmentPattern.test(value))
    throw new ShopStoreError("invalid", `Invalid ${label}`);
  return value;
}
function timestamp(value: string): string {
  if (typeof value !== "string" || !dateTimePattern.test(value) || Number.isNaN(Date.parse(value)))
    throw new ShopStoreError("invalid", "Invalid shop timestamp");
  return value;
}
function collectionPath(academyId: string, collection: string): string {
  return `academies/${academyId}/${collection}`;
}
function asDocument(value: ShopDocumentSnapshot | ShopQuerySnapshot): ShopDocumentSnapshot {
  if ("docs" in value) throw new ShopStoreError("invalid", "Expected document snapshot");
  return value;
}
function asQuery(value: ShopDocumentSnapshot | ShopQuerySnapshot): ShopQuerySnapshot {
  if (!("docs" in value)) throw new ShopStoreError("invalid", "Expected query snapshot");
  return value;
}
function storedProduct(snapshot: ShopDocumentSnapshot, academyId: string): ShopProductRecord {
  const parsed = parseShopProductRecord(snapshot.data());
  if (!parsed.ok) throw new ShopStoreError("invalid", "Stored product contract rejected");
  if (parsed.value.academyId !== academyId || parsed.value.productId !== snapshot.id)
    throw new ShopStoreError("tenant", "Product tenant mismatch");
  return parsed.value;
}
function storedOrder(snapshot: ShopDocumentSnapshot, academyId: string): ShopOrderRecord {
  const parsed = parseShopOrderRecord(snapshot.data());
  if (!parsed.ok) throw new ShopStoreError("invalid", "Stored order contract rejected");
  if (parsed.value.academyId !== academyId || parsed.value.orderId !== snapshot.id)
    throw new ShopStoreError("tenant", "Order tenant mismatch");
  return parsed.value;
}
function sortOrders(orders: readonly ShopOrderRecord[]): readonly ShopOrderRecord[] {
  return Object.freeze(
    [...orders].sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || left.orderId.localeCompare(right.orderId),
    ),
  );
}
function appendAudit(
  dependencies: ShopStoreDependencies,
  transaction: ShopTransaction,
  academyId: string,
  actorId: string,
  action: ShopAuditAction,
  targetRef: string,
): void {
  const reference = dependencies.firestore
    .collection(collectionPath(academyId, "auditEvents"))
    .doc();
  dependencies.appendAudit(transaction, reference, {
    academyId,
    actorId,
    action,
    targetRef,
    purpose: "club shop operation",
    correlationId: `shop:${reference.id}`,
  });
}

export function shopOrderId(requestId: string): string {
  return `order-${requestId}`;
}

export function createShopStore(dependencies: ShopStoreDependencies): ShopStore {
  const { firestore } = dependencies;

  async function readProducts(
    transactionOrNull: ShopTransaction | null,
    academyId: string,
  ): Promise<readonly ShopProductRecord[]> {
    const query = firestore
      .collection(collectionPath(academyId, "shopProducts"))
      .where("academyId", "==", academyId)
      .limit(SHOP_PRODUCT_QUERY_LIMIT);
    const snapshot = transactionOrNull
      ? asQuery(await transactionOrNull.get(query))
      : await firestore.runTransaction(async (transaction) =>
          asQuery(await transaction.get(query)),
        );
    return sortShopProducts(snapshot.docs.map((document) => storedProduct(document, academyId)));
  }

  async function readOrders(
    academyId: string,
    field: "academyId" | "customerUserId",
    value: string,
    limit: number,
  ): Promise<readonly ShopOrderRecord[]> {
    const query = firestore
      .collection(collectionPath(academyId, "shopOrders"))
      .where(field, "==", value)
      .limit(limit);
    const snapshot = await firestore.runTransaction(async (transaction) =>
      asQuery(await transaction.get(query)),
    );
    return sortOrders(snapshot.docs.map((document) => storedOrder(document, academyId)));
  }

  return Object.freeze({
    async listProducts(academyId) {
      return readProducts(null, id(academyId, "academy"));
    },

    async saveProduct(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      const reference = firestore.doc(
        `${collectionPath(academyId, "shopProducts")}/${id(input.draft.productId, "product")}`,
      );
      return firestore.runTransaction(async (transaction) => {
        const snapshot = asDocument(await transaction.get(reference));
        const existing = snapshot.exists ? storedProduct(snapshot, academyId) : null;
        const candidate = parseShopProductRecord({
          ...input.draft,
          academyId,
          active: existing?.active ?? true,
          schemaVersion: "1",
          createdAt: existing?.createdAt ?? now,
          createdBy: existing?.createdBy ?? actorId,
          updatedAt: now,
          updatedBy: actorId,
        });
        if (!candidate.ok) throw new ShopStoreError("invalid", "Product contract rejected");
        if (existing) transaction.set(reference, candidate.value);
        else transaction.create(reference, candidate.value);
        appendAudit(
          dependencies,
          transaction,
          academyId,
          actorId,
          "shop.product.saved",
          reference.path,
        );
        return candidate.value;
      });
    },

    async setProductActive(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      const reference = firestore.doc(
        `${collectionPath(academyId, "shopProducts")}/${id(input.productId, "product")}`,
      );
      return firestore.runTransaction(async (transaction) => {
        const snapshot = asDocument(await transaction.get(reference));
        if (!snapshot.exists) throw new ShopStoreError("not-found", "Product not found");
        const existing = storedProduct(snapshot, academyId);
        if (existing.active === input.active) return existing;
        const candidate = parseShopProductRecord({
          ...existing,
          active: input.active,
          updatedAt: now,
          updatedBy: actorId,
        });
        if (!candidate.ok) throw new ShopStoreError("invalid", "Product contract rejected");
        transaction.set(reference, candidate.value);
        appendAudit(
          dependencies,
          transaction,
          academyId,
          actorId,
          "shop.product.status.changed",
          reference.path,
        );
        return candidate.value;
      });
    },

    async placeOrder(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      const { request } = input;
      const productReference = firestore.doc(
        `${collectionPath(academyId, "shopProducts")}/${id(request.productId, "product")}`,
      );
      const orderReference = firestore.doc(
        `${collectionPath(academyId, "shopOrders")}/${shopOrderId(id(request.requestId, "request"))}`,
      );
      return firestore.runTransaction(async (transaction) => {
        const existingOrder = asDocument(await transaction.get(orderReference));
        if (existingOrder.exists) {
          const stored = storedOrder(existingOrder, academyId);
          if (stored.customerUserId !== actorId)
            throw new ShopStoreError("conflict", "Order request id already used");
          return stored;
        }
        const productSnapshot = asDocument(await transaction.get(productReference));
        if (!productSnapshot.exists) throw new ShopStoreError("not-found", "Product not found");
        const product = storedProduct(productSnapshot, academyId);
        if (!product.active) throw new ShopStoreError("precondition", "Product is not published");
        if (product.stockStatus === "sold-out")
          throw new ShopStoreError("precondition", "Product is sold out");
        if (product.sizes.length > 0) {
          if (request.size === null || !product.sizes.includes(request.size))
            throw new ShopStoreError("precondition", "Choose a size offered for this product");
        } else if (request.size !== null) {
          throw new ShopStoreError("precondition", "This product has no size options");
        }
        const candidate = parseShopOrderRecord({
          orderId: orderReference.id,
          academyId,
          requestId: request.requestId,
          customerUserId: actorId,
          productId: product.productId,
          productName: product.name,
          category: product.category,
          size: request.size,
          quantity: request.quantity,
          unitPriceMinor: product.priceMinor,
          totalMinor: product.priceMinor * request.quantity,
          currency: product.currency,
          contactName: request.contactName,
          contactPhone: request.contactPhone,
          note: request.note,
          status: "requested",
          paymentStatus: "unpaid",
          staffNote: null,
          schemaVersion: "1",
          createdAt: now,
          createdBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
        });
        if (!candidate.ok) throw new ShopStoreError("invalid", "Order contract rejected");
        transaction.create(orderReference, candidate.value);
        appendAudit(
          dependencies,
          transaction,
          academyId,
          actorId,
          "shop.order.placed",
          orderReference.path,
        );
        return candidate.value;
      });
    },

    async listOrders(academyId) {
      const academy = id(academyId, "academy");
      return readOrders(academy, "academyId", academy, SHOP_ORDER_QUERY_LIMIT);
    },

    async listCustomerOrders(academyId, userId) {
      return readOrders(
        id(academyId, "academy"),
        "customerUserId",
        id(userId, "user"),
        SHOP_CUSTOMER_ORDER_QUERY_LIMIT,
      );
    },

    async updateOrder(input) {
      const academyId = id(input.academyId, "academy");
      const actorId = id(input.actorId, "actor");
      const now = timestamp(input.now);
      const { update } = input;
      const reference = firestore.doc(
        `${collectionPath(academyId, "shopOrders")}/${id(update.orderId, "order")}`,
      );
      return firestore.runTransaction(async (transaction) => {
        const snapshot = asDocument(await transaction.get(reference));
        if (!snapshot.exists) throw new ShopStoreError("not-found", "Order not found");
        const existing = storedOrder(snapshot, academyId);
        const nextStatus = update.status ?? existing.status;
        if (nextStatus !== existing.status && !canTransitionShopOrder(existing.status, nextStatus))
          throw new ShopStoreError("precondition", "Order status transition is not allowed");
        const candidate = parseShopOrderRecord({
          ...existing,
          status: nextStatus,
          paymentStatus: update.paymentStatus ?? existing.paymentStatus,
          staffNote: update.staffNote === undefined ? existing.staffNote : update.staffNote,
          updatedAt: now,
          updatedBy: actorId,
        });
        if (!candidate.ok) throw new ShopStoreError("invalid", "Order contract rejected");
        transaction.set(reference, candidate.value);
        appendAudit(
          dependencies,
          transaction,
          academyId,
          actorId,
          "shop.order.status.changed",
          reference.path,
        );
        return candidate.value;
      });
    },
  });
}
