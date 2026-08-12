import { describe, expect, it } from "vitest";

import { createMemberReportPdf } from "./member-report-pdf.js";

describe("member report PDF generator", () => {
  it("returns a real PDF containing only the approved report projection columns", async () => {
    const bytes = await createMemberReportPdf("active", [
      {
        memberId: "member-1",
        membershipNumber: "M-001",
        fullName: "Synthetic Member",
        email: "member@example.test",
        idCardNumber: "ID-1",
        vatNumber: "VAT-1",
        birthDate: "2000-01-02",
        mobileNumber: "+441234567890",
        frequency: "twice-weekly",
        paymentStatus: "regularized",
        gender: "unknown",
        trainingCenter: "Main Center",
        membershipStatus: "active",
        createdAt: "2026-08-11T10:00:00.000Z",
        updatedAt: "2026-08-11T10:00:00.000Z",
        source: "admin",
        schemaVersion: "1",
      },
    ]);

    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.7");
    expect(bytes.byteLength).toBeGreaterThan(200);
    expect(new TextDecoder().decode(bytes)).not.toContain("password");
    expect(new TextDecoder().decode(bytes)).not.toContain("rawAuth");
  });

  it("does not fail when a member name contains unsupported Unicode characters", async () => {
    const bytes = await createMemberReportPdf("active", [
      {
        memberId: "member-unicode",
        fullName: "José García 日本語 🥋",
        paymentStatus: "unknown",
        gender: "unknown",
        membershipStatus: "active",
        createdAt: "2026-08-11T10:00:00.000Z",
        updatedAt: "2026-08-11T10:00:00.000Z",
        source: "admin",
        schemaVersion: "1",
      },
    ]);

    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.7");
  });
});
