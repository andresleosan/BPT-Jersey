import { describe, expect, it, vi } from "vitest";
import {
  createDeliveryDispatcher,
  createInMemoryDeliveryHistoryStore,
  createUnconfiguredDeliveryProvider,
} from "./delivery-service";

const request = {
  deliveryId: "delivery-1",
  academyId: "academy-1",
  channel: "email" as const,
  recipient: "guardian@example.test",
  templateId: "payment.reminder",
  variables: { firstName: "Alex" },
  requestedAt: "2026-08-23T12:00:00.000Z",
};

describe("delivery service", () => {
  it("records a safe skipped outcome when no provider is configured", async () => {
    const history = createInMemoryDeliveryHistoryStore();
    const dispatcher = createDeliveryDispatcher({
      provider: createUnconfiguredDeliveryProvider(),
      history,
      now: () => "2026-08-23T12:00:01.000Z",
    });

    const result = await dispatcher.dispatch(request);
    expect(result.status).toBe("skipped");
    expect(result.failureCode).toBe("provider_unconfigured");
    expect(await history.list("academy-1")).toHaveLength(1);
  });

  it("retries only retryable failures with bounded backoff and becomes idempotent", async () => {
    const history = createInMemoryDeliveryHistoryStore();
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        status: "failed",
        providerMessageId: null,
        failureCode: "rate_limited",
        retryable: true,
      })
      .mockResolvedValueOnce({
        status: "failed",
        providerMessageId: null,
        failureCode: "provider_timeout",
        retryable: true,
      })
      .mockResolvedValueOnce({
        status: "accepted",
        providerMessageId: "msg-1",
        failureCode: null,
        retryable: false,
      });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createDeliveryDispatcher({
      provider: { name: "fake-provider", send },
      history,
      now: () => "2026-08-23T12:00:01.000Z",
      sleep,
    });

    const result = await dispatcher.dispatch(request);
    expect(result.status).toBe("accepted");
    expect(result.attempt).toBe(3);
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);

    const second = await dispatcher.dispatch(request);
    expect(second).toEqual(result);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does not retry a permanent provider failure or mix academies", async () => {
    const history = createInMemoryDeliveryHistoryStore();
    const send = vi.fn().mockResolvedValue({
      status: "failed",
      providerMessageId: null,
      failureCode: "invalid_recipient",
      retryable: false,
    });
    const dispatcher = createDeliveryDispatcher({
      provider: { name: "fake-provider", send },
      history,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    const result = await dispatcher.dispatch(request);
    expect(result.status).toBe("failed");
    expect(send).toHaveBeenCalledTimes(1);
    expect(await history.list("academy-2")).toHaveLength(0);
  });
});
