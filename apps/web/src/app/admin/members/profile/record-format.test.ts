import { afterEach, describe, expect, it, vi } from "vitest";

const originalTimeZone = process.env.TZ;

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
  vi.resetModules();
});

describe("formatRecordDate", () => {
  /**
   * The formatter is built at import time, so the module is re-imported after the zone changes: with
   * `timeZone: "UTC"` removed this reads "14 Jan 2026". CI runs in UTC, where that mistake is
   * invisible, so the zone is pinned here instead.
   */
  it("keeps a date-only value on its own day west of UTC", async () => {
    process.env.TZ = "America/New_York";
    vi.resetModules();
    const { formatRecordDate } = await import("./record-format");
    expect(formatRecordDate("2026-01-15")).toBe("15 Jan 2026");
  });

  it("keeps a date-only value on its own day east of UTC", async () => {
    process.env.TZ = "Pacific/Auckland";
    vi.resetModules();
    const { formatRecordDate } = await import("./record-format");
    expect(formatRecordDate("2026-01-15")).toBe("15 Jan 2026");
  });
});
