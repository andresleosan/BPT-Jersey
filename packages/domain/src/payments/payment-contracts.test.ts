import { describe, expect, it } from "vitest";

import {
  buildPaymentCheckoutRecord,
  parsePaymentCheckoutRecord,
  parsePaymentCheckoutRequest,
  parsePaymentProviderResult,
} from "./payment-contracts";

const request = {
  academyId: "demo-academy",
  invoiceId: "invoice-1",
  familyId: "family-1",
  amountMinor: 12500,
  currency: "GBP" as const,
  idempotencyKey: "checkout-attempt-1",
  requestedAt: "2026-08-26T10:00:00Z",
};

describe("payment adapter contracts", () => {
  it("accepts a provider-independent checkout request and record", () => {
    const parsed = parsePaymentCheckoutRequest(request);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const record = buildPaymentCheckoutRecord({
      request: parsed.value,
      checkoutId: "checkout-1",
      provider: "unconfigured",
      result: parsePaymentProviderResult({
        status: "unconfigured",
        providerCheckoutId: null,
        checkoutUrl: null,
        failureCode: "provider_unconfigured",
        retryable: false,
      }),
      now: "2026-08-26T10:00:00Z",
    });
    expect(record.status).toBe("unconfigured");
    expect(parsePaymentCheckoutRecord(record).ok).toBe(true);
  });

  it("rejects card data, extra fields, invalid amounts and unsafe URLs", () => {
    expect(parsePaymentCheckoutRequest({ ...request, cardNumber: "4242424242424242" }).ok).toBe(
      false,
    );
    expect(parsePaymentCheckoutRequest({ ...request, amountMinor: 0 }).ok).toBe(false);
    expect(parsePaymentCheckoutRequest({ ...request, idempotencyKey: "bad/key" }).ok).toBe(false);
    const result = parsePaymentProviderResult({
      status: "created",
      providerCheckoutId: "provider-1",
      checkoutUrl: "http://unsafe.example/checkout",
      failureCode: null,
      retryable: false,
    });
    expect(result.checkoutUrl).toBeNull();
    expect(result.providerCheckoutId).toBeNull();
    expect(result.status).toBe("failed");
  });

  it("fails closed for malformed provider results", () => {
    expect(
      parsePaymentProviderResult({ status: "created", checkoutUrl: "javascript:alert(1)" }),
    ).toMatchObject({
      status: "failed",
      failureCode: "provider_invalid_response",
    });
  });
});
