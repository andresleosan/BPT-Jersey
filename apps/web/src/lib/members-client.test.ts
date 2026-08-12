import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  getFirebaseFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(),
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: mocks.getFirebaseFunctions,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: mocks.httpsCallable,
}));

import {
  createMember,
  getMemberReport,
  getMemberReportPdf,
  getMemberReportSummary,
  searchMembers,
} from "./members-client";

describe("Members web client", () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.getFirebaseFunctions.mockClear();
    mocks.httpsCallable.mockReset();
  });

  it("sends the exact member-owned payload and returns the member ID", async () => {
    mocks.callable.mockResolvedValue({ data: { memberId: "member-123" } });
    mocks.httpsCallable.mockReturnValue(mocks.callable);

    await expect(
      createMember({
        membershipNumber: "BPT-123",
        fullName: "Alex Johnson",
        email: "alex@example.test",
        idCardNumber: "ID-123",
        vatNumber: "VAT-123",
        birthDate: "1990-01-02",
        mobileNumber: "+44 7000 000000",
        frequency: "Twice weekly",
        gender: "unknown",
        trainingCenter: "St Helier",
      }),
    ).resolves.toEqual({ memberId: "member-123" });

    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "createMember");
    expect(mocks.callable).toHaveBeenCalledWith({
      membershipNumber: "BPT-123",
      fullName: "Alex Johnson",
      email: "alex@example.test",
      idCardNumber: "ID-123",
      vatNumber: "VAT-123",
      birthDate: "1990-01-02",
      mobileNumber: "+44 7000 000000",
      frequency: "Twice weekly",
      gender: "unknown",
      trainingCenter: "St Helier",
    });
  });

  it("omits undefined optional fields from the callable payload", async () => {
    mocks.callable.mockResolvedValue({ data: { memberId: "member-456" } });
    mocks.httpsCallable.mockReturnValue(mocks.callable);

    await createMember({ fullName: "Alex Johnson" });

    expect(mocks.callable).toHaveBeenCalledWith({ fullName: "Alex Johnson" });
  });

  it("sanitizes callable failures and malformed responses", async () => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockRejectedValue(new Error("private Firebase stack detail"));

    await expect(createMember({ fullName: "Alex Johnson" })).rejects.toThrow(
      "Unable to create member. Please try again.",
    );
    await expect(createMember({ fullName: "Alex Johnson" })).rejects.not.toThrow(
      "private Firebase stack detail",
    );

    mocks.callable.mockResolvedValue({ data: { memberId: "" } });
    await expect(createMember({ fullName: "Alex Johnson" })).rejects.toThrow(
      "Unable to create member. Please try again.",
    );
  });

  it("sends only the eleven approved member search filters and the continuation token", async () => {
    mocks.callable.mockResolvedValue({ data: { members: [], nextPageToken: "next-token" } });
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    const filters = {
      membershipNumber: "M-001",
      name: "Alex",
      email: "alex@example.test",
      idCardNumber: "ID-001",
      vatNumber: "VAT-001",
      mobileNumber: "+441234567890",
      frequency: "twice-weekly",
      paymentOrStatus: "active" as const,
      gender: "unknown" as const,
      trainingCenter: "Main Center",
      orderBy: "registrationDate" as const,
      unexpected: "must-not-cross-boundary",
    };

    await expect(searchMembers(filters, "next-token")).resolves.toEqual({
      members: [],
      nextPageToken: "next-token",
    });
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "searchMembers");
    expect(mocks.callable).toHaveBeenCalledWith({
      filters: {
        membershipNumber: "M-001",
        name: "Alex",
        email: "alex@example.test",
        idCardNumber: "ID-001",
        vatNumber: "VAT-001",
        mobileNumber: "+441234567890",
        frequency: "twice-weekly",
        paymentOrStatus: "active",
        gender: "unknown",
        trainingCenter: "Main Center",
        orderBy: "registrationDate",
      },
      pageToken: "next-token",
    });
  });

  it("accepts only a future, bounded PDF expiry", async () => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockResolvedValue({
      data: {
        downloadUrl: "https://signed.example/report.pdf",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
    });

    await expect(getMemberReportPdf("active")).resolves.toHaveProperty("downloadUrl");

    for (const expiresAt of [
      new Date(Date.now() - 1_000).toISOString(),
      new Date(Date.now() + 11 * 60 * 1000).toISOString(),
      "not-a-date",
    ]) {
      mocks.callable.mockResolvedValue({
        data: { downloadUrl: "https://signed.example/report.pdf", expiresAt },
      });
      await expect(getMemberReportPdf("active")).rejects.toThrow(
        "Unable to download member report. Please try again.",
      );
    }
  });

  it("keeps report calls allowlisted and returns a signed PDF URL", async () => {
    mocks.callable.mockResolvedValueOnce({
      data: { report: "active", members: [], generatedAt: "2026-08-11T12:00:00.000Z" },
    });
    mocks.callable.mockResolvedValueOnce({
      data: {
        downloadUrl: "https://signed.example/report.pdf",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
    });
    mocks.httpsCallable.mockReturnValue(mocks.callable);

    await expect(getMemberReport("active")).resolves.toMatchObject({ report: "active" });
    await expect(getMemberReportPdf("active")).resolves.toMatchObject({
      downloadUrl: "https://signed.example/report.pdf",
    });
    expect(mocks.callable).toHaveBeenNthCalledWith(1, { report: "active" });
    expect(mocks.callable).toHaveBeenNthCalledWith(2, { report: "active" });
  });

  it("returns a count-only report summary", async () => {
    mocks.callable.mockResolvedValue({ data: { report: "active", count: 12 } });
    mocks.httpsCallable.mockReturnValue(mocks.callable);

    await expect(getMemberReportSummary("active")).resolves.toEqual({ report: "active", count: 12 });
    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, "getMemberReportSummary");
    expect(mocks.callable).toHaveBeenCalledWith({ report: "active" });
  });

  it("sanitizes malformed search and report responses", async () => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockResolvedValueOnce({ data: { members: [{ memberId: "" }] } });
    await expect(searchMembers({})).rejects.toThrow("Unable to search members. Please try again.");

    mocks.callable.mockResolvedValueOnce({ data: { report: "active", members: [] } });
    await expect(getMemberReport("active")).rejects.toThrow(
      "Unable to load member report. Please try again.",
    );

    mocks.callable.mockResolvedValueOnce({ data: { downloadUrl: "javascript:alert(1)" } });
    await expect(getMemberReportPdf("active")).rejects.toThrow(
      "Unable to download member report. Please try again.",
    );

    mocks.callable.mockResolvedValueOnce({ data: { report: "active", count: -1 } });
    await expect(getMemberReportSummary("active")).rejects.toThrow(
      "Unable to load member report counters. Please try again.",
    );
  });
});
