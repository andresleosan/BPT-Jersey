import { describe, expect, it } from "vitest";
import {
  buildDeliveryHistoryRecord,
  parseDeliveryHistoryRecord,
  parseExternalDeliveryRequest,
} from "./delivery-contracts";

const request = {
  deliveryId: "delivery-1",
  academyId: "academy-1",
  channel: "email" as const,
  recipient: "guardian@example.test",
  templateId: "payment.reminder",
  variables: { firstName: "Alex", amount: "£25.00" },
  requestedAt: "2026-08-23T12:00:00.000Z",
};

describe("delivery contracts", () => {
  it("accepts a strict email request and freezes variables", () => {
    const parsed = parseExternalDeliveryRequest(request);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.isFrozen(parsed.value.variables)).toBe(true);
    expect(parsed.value.recipient).toBe("guardian@example.test");
  });

  it("validates channel-specific recipients and rejects extra fields", () => {
    expect(
      parseExternalDeliveryRequest({
        ...request,
        channel: "sms",
        recipient: "07900111222",
      }).ok,
    ).toBe(false);
    expect(
      parseExternalDeliveryRequest({
        ...request,
        internalNote: "do not persist",
      }).ok,
    ).toBe(false);
  });

  it("builds history without recipient or message variables", () => {
    const parsed = parseExternalDeliveryRequest(request);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const history = buildDeliveryHistoryRecord({
      request: parsed.value,
      provider: "unconfigured",
      result: {
        status: "skipped",
        providerMessageId: null,
        failureCode: "provider_unconfigured",
        retryable: false,
      },
      attempt: 1,
      occurredAt: "2026-08-23T12:00:01.000Z",
    });

    expect(history).not.toHaveProperty("recipient");
    expect(history).not.toHaveProperty("variables");
    expect(parseDeliveryHistoryRecord(history).ok).toBe(true);
  });

  it("rejects malformed history and unsafe provider values", () => {
    expect(
      parseDeliveryHistoryRecord({
        deliveryId: "delivery-1",
        academyId: "academy-1",
        channel: "email",
        provider: "Provider With Spaces",
        status: "failed",
        attempt: 1,
        providerMessageId: null,
        failureCode: "provider_error",
        retryable: true,
        occurredAt: "2026-08-23T12:00:01.000Z",
        schemaVersion: 1,
      }).ok,
    ).toBe(false);
  });
});
