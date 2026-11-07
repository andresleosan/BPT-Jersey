import { z } from "zod";

export const onlinePaymentMethods = [
  "debit_card",
  "credit_card",
  "apple_pay",
  "google_pay",
] as const;
export type OnlinePaymentMethod = (typeof onlinePaymentMethods)[number];
export const onlinePaymentOptionsSchema = z.strictObject({
  provider: z.string().max(64),
  methods: z.array(z.enum(onlinePaymentMethods)).max(4),
});
export const checkoutMethods = ["bank_transfer", ...onlinePaymentMethods] as const;
export type CheckoutMethod = (typeof checkoutMethods)[number];
export const paymentMethodLabels = {
  bank_transfer: "Bank transfer",
  debit_card: "Debit card",
  credit_card: "Credit card",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  cash: "Cash",
  other: "Other",
} as const;

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\u0000-\u001f\u007f]/u.test(v));
export const billingDetailsSchema = z.strictObject({
  name: text(120),
  email: z.email().max(254),
  line1: text(160),
  line2: z
    .string()
    .trim()
    .max(160)
    .refine((v) => !/[\u0000-\u001f\u007f]/u.test(v)),
  city: text(100),
  postalCode: text(20),
  countryCode: z.string().regex(/^[A-Z]{2}$/u),
});
export type BillingDetails = z.infer<typeof billingDetailsSchema>;
export const prepareCheckoutSchema = z.strictObject({
  invoiceId: id,
  method: z.enum(onlinePaymentMethods),
  billing: billingDetailsSchema,
  requestId: z.uuid(),
});
export type PrepareCheckoutInput = z.infer<typeof prepareCheckoutSchema>;
export const checkoutRecordSchema = z.strictObject({
  checkoutId: id,
  academyId: id,
  invoiceId: id,
  requestedBy: id,
  method: z.enum(onlinePaymentMethods),
  billing: billingDetailsSchema,
  settledMethod: z.enum(onlinePaymentMethods).nullable().default(null),
  amountMinor: z.number().int().positive().max(100_000_000),
  currency: z.literal("GBP"),
  status: z.enum([
    "preparing",
    "unconfigured",
    "requires_action",
    "processing",
    "succeeded",
    "failed",
    "cancelled",
    "review_required",
  ]),
  provider: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u),
  providerCheckoutId: id.nullable(),
  checkoutUrl: z.url().max(2048).nullable(),
  paymentId: id.nullable(),
  failureCode: z.string().max(80).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  schemaVersion: z.literal(1),
});
export type CheckoutRecord = z.infer<typeof checkoutRecordSchema>;
export const checkoutPageSchema = z.strictObject({ items: z.array(checkoutRecordSchema).max(50) });

/** Only a provider adapter that has verified the signature may produce this event. */
export const verifiedPaymentEventSchema = z.strictObject({
  eventId: id,
  academyId: id,
  checkoutId: id,
  providerCheckoutId: id,
  transactionId: id,
  amountMinor: z.number().int().positive().max(100_000_000),
  currency: z.literal("GBP"),
  status: z.enum(["succeeded", "failed", "cancelled"]),
  method: z.enum(onlinePaymentMethods),
  occurredAt: z.iso.datetime(),
});
export type VerifiedPaymentEvent = z.infer<typeof verifiedPaymentEventSchema>;
