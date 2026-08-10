import type { Page } from "@playwright/test";
import type { RegyfitAccessRecord, UtcDateTime } from "@bpt-jersey/domain";

type SafeRegyfitAccessRecord = Omit<RegyfitAccessRecord, "ip">;
export type AdminE2ETestRole = "owner" | "administrator";

const fixedDate = "2026-08-08T12:00:00.000Z" as UtcDateTime;

const ownerRecords: readonly RegyfitAccessRecord[] = [
  {
    academyId: "synthetic-academy",
    sourceSystem: "regyfit",
    sourceId: "synthetic-regyfit-1",
    memberDisplayName: "Synthetic Member",
    memberNumber: "42",
    loginCount: 42,
    lastLoginAt: fixedDate,
    ip: "203.0.113.10",
    importRunId: "synthetic-import-run-1",
    capturedAt: fixedDate,
    schemaVersion: "1",
  },
  {
    academyId: "synthetic-academy",
    sourceSystem: "regyfit",
    sourceId: "synthetic-regyfit-2",
    memberDisplayName: "Synthetic Inactive Member",
    memberNumber: "43",
    loginCount: 0,
    lastLoginAt: null,
    ip: "203.0.113.10",
    importRunId: "synthetic-import-run-2",
    capturedAt: fixedDate,
    schemaVersion: "1",
  },
];

const administratorRecords: readonly SafeRegyfitAccessRecord[] = ownerRecords.map((record) => {
  const safeRecord = { ...record };
  Reflect.deleteProperty(safeRecord, "ip");
  return safeRecord as SafeRegyfitAccessRecord;
});

export async function injectSyntheticAdminRecords(
  page: Page,
  role: AdminE2ETestRole,
): Promise<void> {
  const records = role === "owner" ? ownerRecords : administratorRecords;

  await page.addInitScript(
    ({ role: injectedRole, records: injectedRecords }) => {
      (window as typeof window & { __BPT_ADMIN_E2E__?: unknown }).__BPT_ADMIN_E2E__ = {
        role: injectedRole,
        records: injectedRecords,
      };
    },
    { role, records },
  );
}
