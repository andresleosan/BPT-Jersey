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

import { downloadClassHistoryPdf, fetchClassHistory } from "./class-history-client";

const input = Object.freeze({
  academyId: "academy-1",
  since: "2026-09-01T00:00:00.000Z",
  actorId: null,
  registrationType: "all" as const,
  limit: 50,
  cursor: null,
});

const row = Object.freeze({
  id: "event-1",
  occurredAt: "2026-09-16T18:30:00.000Z",
  action: "booking.created" as const,
  actorId: "user-1",
  actorRole: "coach" as const,
  actorGroup: "staff" as const,
  actorName: "Alex Coach",
  actorIp: "203.0.113.4",
  studentId: "student-1",
  studentName: "Jamie Student",
  sessionId: "session-1",
  sessionStartAt: "2026-09-16T18:30:00.000Z",
  programId: "program-1",
  programName: "No-Gi Fundamentals",
  locationId: "location-1",
  source: "bpt" as const,
  sentence: "Jamie Student was booked by Alex Coach into No-Gi Fundamentals on 16 Sep 2026 at 18:30",
});

describe("class history web client", () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.getFirebaseFunctions.mockClear();
    mocks.httpsCallable.mockReset();
    mocks.httpsCallable.mockReturnValue(mocks.callable);
  });

  it("parses the rows the callable returns", async () => {
    mocks.callable.mockResolvedValue({ data: { rows: [row], total: 1 } });
    await expect(fetchClassHistory(input)).resolves.toEqual({ rows: [row], total: 1 });
    expect(mocks.httpsCallable).toHaveBeenLastCalledWith({}, "listClassHistory");
    expect(mocks.callable).toHaveBeenLastCalledWith(input);
  });

  it("rejects a payload with unexpected fields", async () => {
    mocks.callable.mockResolvedValue({ data: { rows: [{ ...row, secret: "x" }], total: 1 } });
    await expect(fetchClassHistory(input)).rejects.toThrow("The log is temporarily unavailable.");
  });

  it("never leaks the Firebase error text", async () => {
    mocks.callable.mockRejectedValue(new Error("FirebaseError: permission-denied projects/xyz"));
    await expect(fetchClassHistory(input)).rejects.toThrow("The log is temporarily unavailable.");
  });

  it("rejects an invalid outgoing filter without calling the callable", async () => {
    await expect(
      fetchClassHistory({ ...input, registrationType: "bogus" as never }),
    ).rejects.toThrow("The log is temporarily unavailable. Please try again.");
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it("decodes the exported PDF into a blob without touching the DOM", async () => {
    const pdfBase64 = Buffer.from("%PDF-1.4 test").toString("base64");
    mocks.callable.mockResolvedValue({
      data: { pdfBase64, fileName: "class-history-2026-09-16.pdf" },
    });
    const result = await downloadClassHistoryPdf(input);
    expect(mocks.httpsCallable).toHaveBeenLastCalledWith({}, "exportClassHistoryPdf");
    expect(result.fileName).toBe("class-history-2026-09-16.pdf");
    expect(result.blob.type).toBe("application/pdf");
    expect(await result.blob.text()).toBe("%PDF-1.4 test");
  });

  it("never leaks the Firebase error text on export failure", async () => {
    mocks.callable.mockRejectedValue(new Error("FirebaseError: internal projects/xyz"));
    await expect(downloadClassHistoryPdf(input)).rejects.toThrow(
      "The PDF could not be prepared. Please try again.",
    );
  });

  it("rejects a malformed export payload", async () => {
    mocks.callable.mockResolvedValue({ data: { pdfBase64: "abc", fileName: "not-a-pdf" } });
    await expect(downloadClassHistoryPdf(input)).rejects.toThrow(
      "The PDF could not be prepared. Please try again.",
    );
  });
});
