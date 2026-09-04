import { z } from "zod";

import { err, ok, type Result } from "../result";

export const shopProductCategories = Object.freeze([
  "gi",
  "rashguard",
  "shorts",
  "backpack",
  "casual",
  "other",
] as const);
export type ShopProductCategory = (typeof shopProductCategories)[number];
export const shopProductCategoryLabels: Readonly<Record<ShopProductCategory, string>> =
  Object.freeze({
    gi: "GIs (kimonos)",
    rashguard: "Rashguards",
    shorts: "Shorts",
    backpack: "Backpacks",
    casual: "Casual clothing",
    other: "Other",
  });
export const shopStockStatuses = Object.freeze(["in-stock", "made-to-order", "sold-out"] as const);
export const shopOrderStatuses = Object.freeze([
  "requested",
  "confirmed",
  "ready",
  "collected",
  "cancelled",
] as const);
export const shopPaymentStatuses = Object.freeze(["unpaid", "paid"] as const);
export const shopPaymentMethodNote =
  "Orders are paid at the academy on collection. No online payment is taken.";
export const shopOrderMaximumQuantity = 10;
export type ShopOrderStatus = (typeof shopOrderStatuses)[number];
export const shopOrderTransitions: Readonly<Record<ShopOrderStatus, readonly ShopOrderStatus[]>> =
  Object.freeze({
    requested: Object.freeze(["confirmed", "cancelled"] as const),
    confirmed: Object.freeze(["ready", "cancelled"] as const),
    ready: Object.freeze(["collected", "cancelled"] as const),
    collected: Object.freeze([] as const),
    cancelled: Object.freeze([] as const),
  });

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const productIdPattern = /^[a-z0-9][a-z0-9-]{1,63}$/u;
const isoDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

const safeIdSchema = z.string().regex(safeIdPattern);
const productIdSchema = z.string().regex(productIdPattern);
const dateTimeSchema = z
  .string()
  .regex(isoDateTimePattern)
  .refine((value) => !Number.isNaN(Date.parse(value)));
const boundedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim() && !controlCharacterPattern.test(value));
const httpsImageUrlSchema = z
  .string()
  .max(1_024)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  });
const localImagePathSchema = z.string().regex(/^\/[A-Za-z0-9._\-/%]{1,255}$/u);
const imageSourceSchema = z.union([httpsImageUrlSchema, localImagePathSchema]);
const minorAmountSchema = z.number().int().nonnegative().safe();

export const shopProductCategorySchema = z.enum(shopProductCategories);
export const shopStockStatusSchema = z.enum(shopStockStatuses);
export const shopOrderStatusSchema = z.enum(shopOrderStatuses);
export const shopPaymentStatusSchema = z.enum(shopPaymentStatuses);

const sizesSchema = z
  .array(boundedText(16))
  .max(12)
  .refine((sizes) => new Set(sizes).size === sizes.length)
  .readonly();

export const shopProductDraftSchema = z.strictObject({
  productId: productIdSchema,
  name: boundedText(120),
  category: shopProductCategorySchema,
  description: boundedText(600).nullable(),
  priceMinor: minorAmountSchema,
  currency: z.literal("GBP"),
  sizes: sizesSchema,
  imageUrl: imageSourceSchema.nullable(),
  stockStatus: shopStockStatusSchema,
  sortOrder: z.number().int().min(0).max(999),
});

export const shopProductRecordSchema = shopProductDraftSchema.extend({
  academyId: safeIdSchema,
  active: z.boolean(),
  schemaVersion: z.literal("1"),
  createdAt: dateTimeSchema,
  createdBy: safeIdSchema,
  updatedAt: dateTimeSchema,
  updatedBy: safeIdSchema,
});

export const shopProductProjectionSchema = shopProductDraftSchema.extend({
  active: z.boolean(),
});

export const shopProductStatusInputSchema = z.strictObject({
  productId: productIdSchema,
  active: z.boolean(),
});

export const shopOrderRequestSchema = z.strictObject({
  requestId: safeIdSchema,
  productId: productIdSchema,
  size: boundedText(16).nullable(),
  quantity: z.number().int().min(1).max(shopOrderMaximumQuantity),
  contactName: boundedText(160),
  contactPhone: boundedText(64).nullable(),
  note: boundedText(500).nullable(),
});

const shopOrderBaseSchema = z.strictObject({
  orderId: safeIdSchema,
  academyId: safeIdSchema,
  requestId: safeIdSchema,
  customerUserId: safeIdSchema,
  productId: productIdSchema,
  productName: boundedText(120),
  category: shopProductCategorySchema,
  size: boundedText(16).nullable(),
  quantity: z.number().int().min(1).max(shopOrderMaximumQuantity),
  unitPriceMinor: minorAmountSchema,
  totalMinor: minorAmountSchema,
  currency: z.literal("GBP"),
  contactName: boundedText(160),
  contactPhone: boundedText(64).nullable(),
  note: boundedText(500).nullable(),
  status: shopOrderStatusSchema,
  paymentStatus: shopPaymentStatusSchema,
  staffNote: boundedText(500).nullable(),
  schemaVersion: z.literal("1"),
  createdAt: dateTimeSchema,
  createdBy: safeIdSchema,
  updatedAt: dateTimeSchema,
  updatedBy: safeIdSchema,
});

export const shopOrderRecordSchema = shopOrderBaseSchema.superRefine((value, context) => {
  if (value.totalMinor !== value.unitPriceMinor * value.quantity)
    context.addIssue({
      code: "custom",
      message: "Order total must equal unit price times quantity",
      path: ["totalMinor"],
    });
});

export const shopOrderProjectionSchema = shopOrderBaseSchema.pick({
  orderId: true,
  customerUserId: true,
  productId: true,
  productName: true,
  category: true,
  size: true,
  quantity: true,
  unitPriceMinor: true,
  totalMinor: true,
  currency: true,
  contactName: true,
  contactPhone: true,
  note: true,
  status: true,
  paymentStatus: true,
  staffNote: true,
  createdAt: true,
  updatedAt: true,
});

export const shopOrderStatusUpdateSchema = z
  .strictObject({
    orderId: safeIdSchema,
    status: shopOrderStatusSchema.optional(),
    paymentStatus: shopPaymentStatusSchema.optional(),
    staffNote: boundedText(500).nullable().optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.paymentStatus !== undefined ||
      value.staffNote !== undefined,
    { message: "An order update must change at least one field" },
  );

export type ShopStockStatus = (typeof shopStockStatuses)[number];
export type ShopPaymentStatus = (typeof shopPaymentStatuses)[number];
export type ShopProductDraft = z.infer<typeof shopProductDraftSchema>;
export type ShopProductRecord = z.infer<typeof shopProductRecordSchema>;
export type ShopProductProjection = z.infer<typeof shopProductProjectionSchema>;
export type ShopProductStatusInput = z.infer<typeof shopProductStatusInputSchema>;
export type ShopOrderRequest = z.infer<typeof shopOrderRequestSchema>;
export type ShopOrderRecord = z.infer<typeof shopOrderRecordSchema>;
export type ShopOrderProjection = z.infer<typeof shopOrderProjectionSchema>;
export type ShopOrderStatusUpdate = z.infer<typeof shopOrderStatusUpdateSchema>;
export type ShopValidationIssue = Readonly<{ path: readonly PropertyKey[]; code: string }>;

function isPlainData(value: unknown, depth = 0): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return true;
  if (depth > 8 || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes("length")) return false;
    for (let index = 0; index < value.length; index += 1)
      if (!Object.hasOwn(value, index) || !isPlainData(value[index], depth + 1)) return false;
    return true;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      descriptor.get ||
      descriptor.set ||
      !Object.hasOwn(descriptor, "value")
    )
      return false;
    if (!isPlainData(descriptor.value, depth + 1)) return false;
  }
  return true;
}

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
): Result<T, readonly ShopValidationIssue[]> {
  if (!isPlainData(value))
    return err(Object.freeze([{ path: Object.freeze([]), code: "invalid_plain_data" }]));
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    return err(
      Object.freeze(
        parsed.error.issues.map((issue) =>
          Object.freeze({ path: Object.freeze([...issue.path]), code: issue.code }),
        ),
      ),
    );
  return ok(parsed.data);
}

export const parseShopProductDraft = (value: unknown) =>
  parseWithSchema(shopProductDraftSchema, value);
export const parseShopProductRecord = (value: unknown) =>
  parseWithSchema(shopProductRecordSchema, value);
export const parseShopProductProjection = (value: unknown) =>
  parseWithSchema(shopProductProjectionSchema, value);
export const parseShopProductStatusInput = (value: unknown) =>
  parseWithSchema(shopProductStatusInputSchema, value);
export const parseShopOrderRequest = (value: unknown) =>
  parseWithSchema(shopOrderRequestSchema, value);
export const parseShopOrderRecord = (value: unknown) =>
  parseWithSchema(shopOrderRecordSchema, value);
export const parseShopOrderProjection = (value: unknown) =>
  parseWithSchema(shopOrderProjectionSchema, value);
export const parseShopOrderStatusUpdate = (value: unknown) =>
  parseWithSchema(shopOrderStatusUpdateSchema, value);

export function canTransitionShopOrder(from: ShopOrderStatus, to: ShopOrderStatus): boolean {
  return shopOrderTransitions[from].includes(to);
}

export function toShopProductProjection(record: ShopProductRecord): ShopProductProjection {
  return shopProductProjectionSchema.parse({
    productId: record.productId,
    name: record.name,
    category: record.category,
    description: record.description,
    priceMinor: record.priceMinor,
    currency: record.currency,
    sizes: record.sizes,
    imageUrl: record.imageUrl,
    stockStatus: record.stockStatus,
    sortOrder: record.sortOrder,
    active: record.active,
  });
}

export function toShopOrderProjection(record: ShopOrderRecord): ShopOrderProjection {
  return shopOrderProjectionSchema.parse({
    orderId: record.orderId,
    customerUserId: record.customerUserId,
    productId: record.productId,
    productName: record.productName,
    category: record.category,
    size: record.size,
    quantity: record.quantity,
    unitPriceMinor: record.unitPriceMinor,
    totalMinor: record.totalMinor,
    currency: record.currency,
    contactName: record.contactName,
    contactPhone: record.contactPhone,
    note: record.note,
    status: record.status,
    paymentStatus: record.paymentStatus,
    staffNote: record.staffNote,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export function sortShopProducts<T extends Pick<ShopProductDraft, "sortOrder" | "name">>(
  products: readonly T[],
): readonly T[] {
  return Object.freeze(
    [...products].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    ),
  );
}

export function formatShopPrice(priceMinor: number, currency: "GBP" = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(priceMinor / 100);
}
