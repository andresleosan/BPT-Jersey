import { describe, expect, it } from "vitest";

import { domainErrorCodes } from "./errors";
import type { DomainError } from "./errors";

const errors: readonly DomainError[] = [
  {
    code: "VALIDATION_FAILED",
    retryable: false,
    issues: [{ path: ["email"], code: "invalid_format" }],
  },
  { code: "UNAUTHENTICATED", retryable: false },
  { code: "FORBIDDEN", retryable: false },
  { code: "NOT_FOUND", retryable: false, resource: "student" },
  { code: "CONFLICT", retryable: false },
  { code: "PRECONDITION_FAILED", retryable: false },
  { code: "RATE_LIMITED", retryable: true, retryAfterSeconds: 10 },
  { code: "INTEGRATION_UNAVAILABLE", retryable: true, integration: "payments" },
  { code: "INTERNAL", retryable: false },
];

describe("DomainError", () => {
  it("defines every code once", () => {
    expect(domainErrorCodes).toHaveLength(9);
    expect(new Set(domainErrorCodes).size).toBe(domainErrorCodes.length);
    expect(errors.map(({ code }) => code)).toEqual(domainErrorCodes);
    expect(errors.map(({ code, retryable }) => [code, retryable])).toEqual([
      ["VALIDATION_FAILED", false],
      ["UNAUTHENTICATED", false],
      ["FORBIDDEN", false],
      ["NOT_FOUND", false],
      ["CONFLICT", false],
      ["PRECONDITION_FAILED", false],
      ["RATE_LIMITED", true],
      ["INTEGRATION_UNAVAILABLE", true],
      ["INTERNAL", false],
    ]);
  });

  it("serializes only the safe public contract", () => {
    for (const error of errors) {
      const serialized = JSON.parse(JSON.stringify(error)) as Record<string, unknown>;

      expect(serialized).toEqual(error);
      expect(serialized).not.toHaveProperty("stack");
      expect(serialized).not.toHaveProperty("cause");
      expect(serialized).not.toHaveProperty("password");
      expect(serialized).not.toHaveProperty("token");
    }
  });
});
