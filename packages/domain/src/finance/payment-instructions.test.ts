import { describe, expect, it } from "vitest";

import {
  formatSortCode,
  normaliseSortCode,
  parsePaymentInstructionsInput,
  parsePaymentInstructionsRecord,
} from "./finance-contracts";

function input(overrides: Record<string, unknown> = {}) {
  return {
    accountName: "BPT Jersey",
    sortCode: "40-25-30",
    accountNumber: "12345678",
    bankName: "Synthetic Bank",
    referenceHint: "Quote your invoice reference",
    acceptsCash: true,
    ...overrides,
  };
}

describe("payment instructions (T010/T035 re-scope)", () => {
  it("accepts the exact six fields and normalises the sort code", () => {
    const parsed = parsePaymentInstructionsInput(input());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.sortCode).toBe("402530");
      expect(parsed.value.bankName).toBe("Synthetic Bank");
    }
  });

  it("accepts every common way of writing a sort code, and nothing else", () => {
    expect(normaliseSortCode("40-25-30")).toBe("402530");
    expect(normaliseSortCode("40 25 30")).toBe("402530");
    expect(normaliseSortCode("402530")).toBe("402530");
    expect(normaliseSortCode("40253")).toBeUndefined();
    expect(normaliseSortCode("40-25-3O")).toBeUndefined();
    expect(normaliseSortCode(402530)).toBeUndefined();
    expect(formatSortCode("402530")).toBe("40-25-30");
  });

  it("refuses an account number that is not eight digits", () => {
    for (const accountNumber of ["1234567", "123456789", "1234567a", " 12345678"]) {
      expect(parsePaymentInstructionsInput(input({ accountNumber })).ok, accountNumber).toBe(false);
    }
  });

  it("refuses an extra field, a missing field and a non-object", () => {
    expect(parsePaymentInstructionsInput({ ...input(), iban: "GB00" }).ok).toBe(false);
    const { referenceHint: _dropped, ...missing } = input();
    void _dropped;
    expect(parsePaymentInstructionsInput(missing).ok).toBe(false);
    expect(parsePaymentInstructionsInput(null).ok).toBe(false);
    expect(parsePaymentInstructionsInput([input()]).ok).toBe(false);
  });

  it("refuses untrimmed, empty, over-long and control-character text", () => {
    expect(parsePaymentInstructionsInput(input({ accountName: " BPT" })).ok).toBe(false);
    expect(parsePaymentInstructionsInput(input({ accountName: "BP" })).ok).toBe(false);
    expect(parsePaymentInstructionsInput(input({ accountName: "x".repeat(81) })).ok).toBe(false);
    expect(
      parsePaymentInstructionsInput(input({ referenceHint: `Ref${String.fromCharCode(10)}` })).ok,
    ).toBe(false);
    expect(parsePaymentInstructionsInput(input({ referenceHint: "x".repeat(121) })).ok).toBe(false);
  });

  it("lets the bank name be absent but never blank", () => {
    expect(parsePaymentInstructionsInput(input({ bankName: null })).ok).toBe(true);
    expect(parsePaymentInstructionsInput(input({ bankName: "" })).ok).toBe(false);
    expect(parsePaymentInstructionsInput(input({ bankName: undefined })).ok).toBe(false);
  });

  it("requires acceptsCash to be a real boolean", () => {
    expect(parsePaymentInstructionsInput(input({ acceptsCash: "yes" })).ok).toBe(false);
    expect(parsePaymentInstructionsInput(input({ acceptsCash: false })).ok).toBe(true);
  });

  it("parses a stored record and refuses one with a broken envelope", () => {
    const stored = {
      ...input({ sortCode: "402530" }),
      academyId: "academy-1",
      schemaVersion: 1,
      updatedAt: "2026-09-06T10:00:00.000Z",
      updatedBy: "owner-1",
    };
    expect(parsePaymentInstructionsRecord(stored).ok).toBe(true);
    expect(parsePaymentInstructionsRecord({ ...stored, schemaVersion: 2 }).ok).toBe(false);
    expect(parsePaymentInstructionsRecord({ ...stored, academyId: "" }).ok).toBe(false);
    expect(parsePaymentInstructionsRecord({ ...stored, updatedAt: "yesterday" }).ok).toBe(false);
    expect(parsePaymentInstructionsRecord({ ...stored, updatedBy: "" }).ok).toBe(false);
  });
});
