import { describe, expect, it } from "vitest";

import { adminInboxQuerySchema, adminNotificationKinds } from "./subscription-admin-contracts";

const base = { kind: null, readState: "all", from: null, to: null, cursor: null } as const;

describe("adminInboxQuerySchema", () => {
  it("accepts kind, read state and a date range", () => {
    const result = adminInboxQuerySchema.safeParse({
      ...base,
      kind: "payment",
      readState: "read",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-26T23:59:59.999Z",
    });
    expect(result.success).toBe(true);
    expect(adminNotificationKinds).toContain("payment");
  });

  it("rejects a range where from is after to", () => {
    const result = adminInboxQuerySchema.safeParse({
      ...base,
      from: "2026-09-27T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects the legacy filter field and unknown kinds", () => {
    expect(adminInboxQuerySchema.safeParse({ filter: "all", cursor: null }).success).toBe(false);
    expect(adminInboxQuerySchema.safeParse({ ...base, kind: "coach" }).success).toBe(false);
  });
});
