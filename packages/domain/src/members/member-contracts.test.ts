import { describe, expect, expectTypeOf, it } from "vitest";

import {
  matchesMemberReport,
  memberReportKeys,
  parseMemberImportPreview,
  parseMemberRecord,
  parseMemberSearchFilters,
} from "./member-contracts";
import type {
  MemberGender,
  MemberOrderBy,
  MemberRecord,
  MembershipStatus,
  PaymentStatus,
} from "./member-contracts";

const validMember = {
  memberId: "member-1",
  academyId: "academy-1",
  fullName: "Synthetic Member",
  email: "member@example.test",
  idCardNumber: "ID-1",
  vatNumber: "VAT-1",
  birthDate: "2000-01-02T00:00:00.000Z",
  mobileNumber: "+441234567890",
  frequency: "twice-weekly",
  paymentStatus: "regularized",
  gender: "unknown",
  trainingCenter: "Main Center",
  membershipStatus: "active",
  createdAt: "2026-08-11T10:00:00.000Z",
  createdBy: "user-1",
  updatedAt: "2026-08-11T10:00:00.000Z",
  updatedBy: "user-1",
  source: "manual",
  schemaVersion: "1",
} as const;

describe("member contracts", () => {
  it("parses a valid member and preserves an absent membership number", () => {
    const parsed = parseMemberRecord(validMember);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value).toEqual(validMember);
    expect("membershipNumber" in parsed.value).toBe(false);
    expect(Object.isFrozen(parsed.value)).toBe(true);
  });

  it("rejects impossible calendar dates in every ISO contract field", () => {
    const impossibleDates = ["2026-02-29T00:00:00.000Z", "2026-02-30T00:00:00.000Z"];
    const memberDateFields = ["birthDate", "inactiveAt", "createdAt", "updatedAt"] as const;

    for (const field of memberDateFields) {
      for (const date of impossibleDates) {
        const candidate = {
          ...validMember,
          ...(field === "inactiveAt" ? { membershipStatus: "inactive" as const } : {}),
          [field]: date,
        };
        const parsed = parseMemberRecord(candidate);

        expect(parsed.ok, `${field} should reject ${date}`).toBe(false);
        if (!parsed.ok) {
          expect(parsed.error).toEqual(
            expect.arrayContaining([{ path: [field], code: "invalid_iso_date" }]),
          );
        }
      }
    }

    for (const date of impossibleDates) {
      const parsed = parseMemberImportPreview({
        previewId: "preview-1",
        expiresAt: date,
        sourceReports: [],
        additions: [],
        updates: [],
        duplicates: [],
        conflicts: [],
      });

      expect(parsed.ok, `expiresAt should reject ${date}`).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error).toEqual(
          expect.arrayContaining([{ path: ["expiresAt"], code: "invalid_iso_date" }]),
        );
      }
    }
  });

  it("accepts an optional membership number and rejects unknown member fields", () => {
    const withNumber = parseMemberRecord({ ...validMember, membershipNumber: "M-001" });
    const withUnknownField = parseMemberRecord({ ...validMember, password: "never" });

    expect(withNumber.ok).toBe(true);
    expect(withUnknownField).toEqual({
      ok: false,
      error: expect.arrayContaining([{ path: ["password"], code: "unexpected_property" }]),
    });
  });

  it("exposes every approved report key and applies activeRegularized conjunctively", () => {
    expect(memberReportKeys).toEqual([
      "total",
      "active",
      "withNumber",
      "noNumber",
      "inactive",
      "regularized",
      "activeRegularized",
      "suspended",
    ]);

    for (const report of memberReportKeys) {
      expect(matchesMemberReport(validMember, report)).toBe(
        report === "total" ||
          report === "active" ||
          report === "noNumber" ||
          report === "regularized" ||
          report === "activeRegularized",
      );
    }

    const inactiveRegularized = {
      ...validMember,
      membershipStatus: "inactive" as const,
      inactiveAt: "2026-08-11T12:00:00.000Z",
    };
    const activeUnregularized = {
      ...validMember,
      paymentStatus: "notRegularized" as const,
    };

    expect(matchesMemberReport(inactiveRegularized, "activeRegularized")).toBe(false);
    expect(matchesMemberReport(activeUnregularized, "activeRegularized")).toBe(false);
  });

  it("parses all eleven search filters strictly", () => {
    const parsed = parseMemberSearchFilters({
      membershipNumber: "M-001",
      name: "synthetic",
      email: "member@example.test",
      idCardNumber: "ID-1",
      vatNumber: "VAT-1",
      mobileNumber: "+441234567890",
      frequency: "twice-weekly",
      paymentOrStatus: "active",
      gender: "unknown",
      trainingCenter: "Main Center",
      orderBy: "registrationDate",
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        membershipNumber: "M-001",
        name: "synthetic",
        email: "member@example.test",
        idCardNumber: "ID-1",
        vatNumber: "VAT-1",
        mobileNumber: "+441234567890",
        frequency: "twice-weekly",
        paymentOrStatus: "active",
        gender: "unknown",
        trainingCenter: "Main Center",
        orderBy: "registrationDate",
      },
    });

    expect(parseMemberSearchFilters({ orderBy: "not-approved" })).toEqual({
      ok: false,
      error: [{ path: ["orderBy"], code: "unknown_enum" }],
    });
    expect(parseMemberSearchFilters({ extra: "nope" })).toEqual({
      ok: false,
      error: [{ path: ["extra"], code: "unexpected_property" }],
    });
  });

  it("rejects raw values from import preview changes", () => {
    const parsed = parseMemberImportPreview({
      previewId: "preview-1",
      expiresAt: "2026-08-11T11:00:00.000Z",
      sourceReports: [{ source: "members.pdf", report: "active", rowCount: 2 }],
      additions: [{ stableKey: "member-1", rowNumbers: [2], fieldNames: ["fullName"] }],
      updates: [],
      duplicates: [],
      conflicts: [],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(() =>
      parseMemberImportPreview({
        previewId: "preview-1",
        expiresAt: "2026-08-11T11:00:00.000Z",
        sourceReports: [],
        additions: [
          { stableKey: "member-1", rowNumbers: [2], fieldNames: ["fullName"], value: "raw" },
        ],
        updates: [],
        duplicates: [],
        conflicts: [],
      }),
    ).not.toThrow();
    expect(
      parseMemberImportPreview({
        previewId: "preview-1",
        expiresAt: "2026-08-11T11:00:00.000Z",
        sourceReports: [],
        additions: [
          { stableKey: "member-1", rowNumbers: [2], fieldNames: ["fullName"], value: "raw" },
        ],
        updates: [],
        duplicates: [],
        conflicts: [],
      }).ok,
    ).toBe(false);
  });
});

function verifyMemberTypes(
  status: MembershipStatus,
  paymentStatus: PaymentStatus,
  gender: MemberGender,
  orderBy: MemberOrderBy,
  member: MemberRecord,
): void {
  void status;
  void paymentStatus;
  void gender;
  void orderBy;
  void member;
}

expectTypeOf<MemberRecord>().toMatchTypeOf<Readonly<Record<string, unknown>>>();
void verifyMemberTypes;
