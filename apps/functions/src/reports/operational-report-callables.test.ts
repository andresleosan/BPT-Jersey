import { describe, expect, it, vi } from "vitest";

const liveAuthUsers = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUser: async (uid: string) => liveAuthUsers.get(uid) }),
}));
import { buildOperationalReport, type OperationalReport } from "@bpt-jersey/domain/reports";

import { createGetOperationalReportHandler } from "./operational-report-callables";
import type { OperationalReportStore } from "./operational-report-service";

const query = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-31T23:59:59.999Z",
} as const;

const report: OperationalReport = buildOperationalReport({
  query,
  students: [],
  attendance: [],
  memberships: [],
  invoices: [],
  payments: [],
  now: "2026-08-31T23:59:59.999Z",
});

function request(
  data: unknown,
  role = "owner",
  uid: string | null = "owner-1",
  academyId = "academy-1",
) {
  if (uid) {
    liveAuthUsers.set(uid, {
      uid,
      disabled: false,
      customClaims: { academyId, role },
      tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
    });
  }
  return {
    auth: uid ? { uid, token: { academyId, role, auth_time: 1_700_000_000 } } : undefined,
    data,
  } as never;
}

describe("operational report callable", () => {
  it("allows owner and administrator roles with actor-derived tenant scope", async () => {
    const store: OperationalReportStore = {
      getOperationalReport: async (academyId, parsedQuery) => {
        expect(academyId).toBe("academy-1");
        expect(parsedQuery).toEqual(query);
        return report;
      },
    };
    const handler = createGetOperationalReportHandler({ store });

    await expect(handler(request(query, "owner"))).resolves.toEqual({ report });
    await expect(handler(request(query, "administrator"))).resolves.toEqual({ report });
  });

  it("rejects non-financial roles, unauthenticated calls and invalid ranges", async () => {
    const store: OperationalReportStore = {
      getOperationalReport: async () => report,
    };
    const handler = createGetOperationalReportHandler({ store });

    await expect(handler(request(query, "coach"))).rejects.toThrow(
      /Owner or administrator access required/,
    );
    await expect(handler(request(query, "guardian"))).rejects.toThrow(
      /Owner or administrator access required/,
    );
    await expect(handler(request(query, "owner", null))).rejects.toThrow();
    await expect(
      handler(
        request({
          from: "2026-08-01T00:00:00.000Z",
          to: "2026-10-01T00:00:00.000Z",
        }),
      ),
    ).rejects.toThrow(/cannot exceed 31 days/);
    await expect(handler(request({ ...query, academyId: "academy-2" }))).rejects.toThrow(
      /must contain only from and to/,
    );
  });

  it("refuses a token issued before a demotion or a session revocation (N-02)", async () => {
    const handler = createGetOperationalReportHandler({
      store: { getOperationalReport: async () => report },
    });
    const demoted = request(query, "administrator", "admin-9");
    liveAuthUsers.set("admin-9", {
      uid: "admin-9",
      disabled: false,
      customClaims: { academyId: "academy-1", role: "coach" },
      tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
    });
    await expect(handler(demoted)).rejects.toMatchObject({ code: "permission-denied" });
    const disabled = request(query, "owner", "owner-9");
    liveAuthUsers.set("owner-9", {
      uid: "owner-9",
      disabled: true,
      customClaims: { academyId: "academy-1", role: "owner" },
      tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
    });
    await expect(handler(disabled)).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("returns a generic error without exposing source details", async () => {
    const store: OperationalReportStore = {
      getOperationalReport: async () => {
        throw new Error("student-private-id failed in invoices");
      },
    };
    const handler = createGetOperationalReportHandler({ store });

    await expect(handler(request(query))).rejects.toThrow("Unable to retrieve operational report.");
  });
});
