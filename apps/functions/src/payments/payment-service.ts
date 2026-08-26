import { createHash } from "node:crypto";

import {
  buildPaymentCheckoutRecord,
  parsePaymentCheckoutRecord,
  parsePaymentCheckoutRequest,
  parsePaymentProviderResult,
  type PaymentCheckoutRecord,
  type PaymentCheckoutRequest,
} from "@bpt-jersey/domain/payments";

export class PaymentAdapterError extends Error {
  public readonly code: "invalid" | "tenant" | "conflict" | "integration";

  public constructor(code: "invalid" | "tenant" | "conflict" | "integration", message: string) {
    super(message);
    this.name = "PaymentAdapterError";
    this.code = code;
  }
}

export type PaymentProvider = Readonly<{
  name: string;
  createCheckout: (request: PaymentCheckoutRequest) => Promise<unknown>;
}>;

export type PaymentCheckoutStore = Readonly<{
  getByIdempotency: (
    academyId: string,
    idempotencyKey: string,
  ) => Promise<PaymentCheckoutRecord | null>;
  append: (record: PaymentCheckoutRecord) => Promise<void>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const providerPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

function assertIdentifier(value: string, field: string): void {
  if (!identifierPattern.test(value)) throw new PaymentAdapterError("invalid", `Invalid ${field}`);
}

function assertProviderName(value: string): void {
  if (!providerPattern.test(value))
    throw new PaymentAdapterError("invalid", "Invalid payment provider");
}

function buildCheckoutId(academyId: string, idempotencyKey: string): string {
  const digest = createHash("sha256")
    .update(`${academyId}/${idempotencyKey}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `checkout-${digest}`;
}

export function createUnconfiguredPaymentProvider(): PaymentProvider {
  return Object.freeze({
    name: "unconfigured",
    async createCheckout() {
      return Object.freeze({
        status: "unconfigured" as const,
        providerCheckoutId: null,
        checkoutUrl: null,
        failureCode: "provider_unconfigured",
        retryable: false,
      });
    },
  });
}

export function createPaymentAdapter(params: {
  provider: PaymentProvider;
  store: PaymentCheckoutStore;
  now?: () => string;
}): Readonly<{
  createCheckout: (rawRequest: unknown) => Promise<PaymentCheckoutRecord>;
}> {
  assertProviderName(params.provider.name);
  const now = params.now ?? (() => new Date().toISOString());
  const inFlight = new Map<string, Promise<PaymentCheckoutRecord>>();

  return {
    async createCheckout(rawRequest) {
      const parsed = parsePaymentCheckoutRequest(rawRequest);
      if (!parsed.ok) throw new PaymentAdapterError("invalid", "Invalid payment checkout request");
      const request = parsed.value;
      assertIdentifier(request.academyId, "academyId");
      const operationKey = `${request.academyId}/${request.idempotencyKey}`;
      const active = inFlight.get(operationKey);
      if (active !== undefined) return active;
      const operation = (async () => {
        const existing = await params.store.getByIdempotency(
          request.academyId,
          request.idempotencyKey,
        );
        if (existing !== null) return existing;

        let providerResult: unknown;
        try {
          providerResult = await params.provider.createCheckout(request);
        } catch {
          providerResult = Object.freeze({
            status: "failed" as const,
            providerCheckoutId: null,
            checkoutUrl: null,
            failureCode: "provider_error",
            retryable: true,
          });
        }
        const record = buildPaymentCheckoutRecord({
          request,
          checkoutId: buildCheckoutId(request.academyId, request.idempotencyKey),
          provider: params.provider.name,
          result: parsePaymentProviderResult(providerResult),
          now: now(),
        });
        await params.store.append(record);
        return record;
      })();
      inFlight.set(operationKey, operation);
      try {
        return await operation;
      } finally {
        if (inFlight.get(operationKey) === operation) inFlight.delete(operationKey);
      }
    },
  };
}

export function createInMemoryPaymentCheckoutStore(): PaymentCheckoutStore {
  const records = new Map<string, PaymentCheckoutRecord>();
  return {
    async getByIdempotency(academyId, idempotencyKey) {
      assertIdentifier(academyId, "academyId");
      assertIdentifier(idempotencyKey, "idempotencyKey");
      return records.get(`${academyId}/${idempotencyKey}`) ?? null;
    },
    async append(record) {
      const parsed = parsePaymentCheckoutRecord(record);
      if (!parsed.ok) throw new PaymentAdapterError("invalid", "Invalid payment checkout record");
      assertIdentifier(parsed.value.academyId, "academyId");
      records.set(`${parsed.value.academyId}/${parsed.value.idempotencyKey}`, parsed.value);
    },
  };
}
