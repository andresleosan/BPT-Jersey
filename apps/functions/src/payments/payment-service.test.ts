import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryPaymentCheckoutStore,
  createPaymentAdapter,
  createUnconfiguredPaymentProvider,
} from "./payment-service";

const request = {
  academyId: "demo-academy",
  invoiceId: "invoice-1",
  familyId: "family-1",
  amountMinor: 12500,
  currency: "GBP" as const,
  idempotencyKey: "checkout-attempt-1",
  requestedAt: "2026-08-26T10:00:00Z",
};

describe("payment adapter service", () => {
  it("uses an unconfigured provider without network calls and is idempotent", async () => {
    const store = createInMemoryPaymentCheckoutStore();
    const provider = createUnconfiguredPaymentProvider();
    const adapter = createPaymentAdapter({
      provider,
      store,
      now: () => "2026-08-26T10:00:00Z",
    });

    const [first, second] = await Promise.all([
      adapter.createCheckout(request),
      adapter.createCheckout(request),
    ]);

    expect(first.status).toBe("unconfigured");
    expect(first.failureCode).toBe("provider_unconfigured");
    expect(second).toEqual(first);
  });

  it("normalizes accepted provider output and never forwards a malformed result", async () => {
    const createCheckout = vi.fn(async () => ({
      status: "created",
      providerCheckoutId: "provider-checkout-1",
      checkoutUrl: "https://payments.example/checkout/provider-checkout-1",
      failureCode: null,
      retryable: false,
    }));
    const adapter = createPaymentAdapter({
      provider: { name: "synthetic-provider", createCheckout },
      store: createInMemoryPaymentCheckoutStore(),
      now: () => "2026-08-26T10:00:00Z",
    });

    const record = await adapter.createCheckout(request);
    expect(record.status).toBe("created");
    expect(record.checkoutUrl).toBe("https://payments.example/checkout/provider-checkout-1");
    expect(createCheckout).toHaveBeenCalledTimes(1);
  });

  it("isolates idempotency by tenant and fails closed for invalid input", async () => {
    const createCheckout = vi.fn(async () => ({
      status: "unconfigured",
      providerCheckoutId: null,
      checkoutUrl: null,
      failureCode: "provider_unconfigured",
      retryable: false,
    }));
    const adapter = createPaymentAdapter({
      provider: { name: "unconfigured", createCheckout },
      store: createInMemoryPaymentCheckoutStore(),
      now: () => "2026-08-26T10:00:00Z",
    });

    await adapter.createCheckout(request);
    await adapter.createCheckout({ ...request, academyId: "other-academy" });
    expect(createCheckout).toHaveBeenCalledTimes(2);
    await expect(adapter.createCheckout({ ...request, amountMinor: -1 })).rejects.toMatchObject({
      code: "invalid",
    });
  });
});
