import { describe, expect, it } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";
import { matchesMemberReport } from "@bpt-jersey/domain";

import {
  confirmMemberPdfImportHandler,
  cleanupExpiredMemberImportSessions,
  cleanupExpiredMemberImportSessionsSchedule,
  createMemberHandler,
  createMemberPdfImportSessionHandler,
  createMemoryMemberImportCleanupJournal,
  createMemoryMemberImportPreviewStore,
  createMemoryMemberImportSessionStore,
  parseMemberImportSession,
  getMemberReportHandler,
  getMemberReportPdfHandler,
  getMemberReportSummaryHandler,
  createMemoryMemberReportRateLimiter,
  createMemoryMemberReportExportStore,
  createMemberReportRateLimitKey,
  MAX_MEMBER_REPORT_PDF_BYTES,
  MAX_MEMBER_SEARCH_ROWS,
  MAX_MEMBER_REPORT_ROWS,
  previewMemberPdfImportHandler,
  searchMembersHandler,
  type MemberCallableServices,
} from "./member-callables.js";
import { createMemberService, type MemberStore } from "./member-service.js";
import { createR2Client, type R2Client } from "../storage/r2-client.js";
import type { MemberImportPreviewStore } from "./member-import-storage.js";

const member = {
  memberId: "member-1",
  academyId: "academy-1",
  membershipNumber: "42",
  fullName: "Synthetic Member",
  email: "member@example.test",
  idCardNumber: "ID-42",
  paymentStatus: "regularized" as const,
  gender: "unknown" as const,
  membershipStatus: "active" as const,
  createdAt: "2026-08-11T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-08-11T10:00:00.000Z",
  updatedBy: "admin-1",
  source: "admin",
  schemaVersion: "1" as const,
};

function request(
  role: "owner" | "administrator" | "coach",
  academyId = "academy-1",
  data: unknown = {},
): CallableRequest {
  return {
    auth: {
      uid: "admin-1",
      token: { academyId, role, firebase: { sign_in_second_factor: "totp" } },
    },
    data,
  } as unknown as CallableRequest;
}

const syntheticReport = [
  "TOTAL MEMBERS IN DATABASE (1)",
  "Member Nº | Name | ID Card Nº | Birthdate | VAT Number | Mobile nº",
  "M-100 | Synthetic Member | ID-100 | 10 Jan 2000 | VAT-100 | +44100100",
  "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/1",
].join("\n");

function services(
  records: readonly unknown[] = [member],
  pdfTexts: readonly string[] = [
    [
      "TOTAL MEMBERS IN DATABASE (0)",
      "Member Nº | Name | ID Card Nº | Birthdate | VAT Number | Mobile nº",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/1",
    ].join("\n"),
  ],
  previewStore: MemberImportPreviewStore = createMemoryMemberImportPreviewStore(),
): MemberCallableServices {
  const stored = [...records];
  const r2: R2Client = createR2Client({
    bucket: "private-bucket",
    endpoint: "https://account.r2.cloudflarestorage.com",
    credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
    signer: async () => "https://signed.example/upload",
    putObject: async () => undefined,
    getObject: async (objectKey) => ({
      body: (async function* () {
        yield new Uint8Array([37, 80, 68, 70, objectKey.includes("/1-") ? 1 : 0]);
      })(),
    }),
  });
  const store: MemberStore = {
    create: async (record) => {
      stored.push(record);
    },
    list: async (_academyId, limit) => stored.slice(0, limit),
    countByReport: async (academyId, report) =>
      stored.filter(
        (record) =>
          typeof record === "object" &&
          record !== null &&
          (record as { academyId?: unknown }).academyId === academyId &&
          matchesMemberReport(record as never, report),
      ).length,
    applyImport: async ({ mutations, result }) => {
      for (const mutation of mutations) {
        if (mutation.kind === "create" && mutation.record) stored.push(mutation.record);
        if (mutation.kind === "update") {
          const index = stored.findIndex(
            (record) =>
              typeof record === "object" &&
              record !== null &&
              (record as { memberId?: unknown }).memberId === mutation.memberId,
          );
          if (index >= 0) stored[index] = { ...(stored[index] as object), ...mutation.updates };
        }
      }
      return result;
    },
  };
  return {
    memberService: createMemberService(store, {
      pageTokenSecret: "test-page-token-secret-32-bytes!!",
    }),
    r2,
    sessions: createMemoryMemberImportSessionStore(),
    previewStore,
    cleanupJournal: createMemoryMemberImportCleanupJournal(),
    reportExports: createMemoryMemberReportExportStore(),
    reportRateLimiter: createMemoryMemberReportRateLimiter(),
    now: () => new Date("2026-08-11T12:00:00.000Z"),
    createId: () => "session-1",
    pdfTextExtractor: async (bytes: Uint8Array) => pdfTexts[bytes[4] ?? 0] ?? "",
  };
}

describe("member callable boundaries", () => {
  it("uses a distinct rate-limit key for each academy and actor tuple", () => {
    expect(createMemberReportRateLimitKey("academy_a", "actor")).not.toBe(
      createMemberReportRateLimitKey("academy", "a_actor"),
    );
  });

  it("rejects unauthenticated and non-administrative calls before storage", async () => {
    const servicesForTest = services();
    const unauthenticated = { data: {} } as CallableRequest;

    await expect(createMemberHandler(unauthenticated, servicesForTest)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(searchMembersHandler(request("coach"), servicesForTest)).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("rejects client-owned academy, status, actor and unknown fields", async () => {
    const servicesForTest = services();
    const result = createMemberHandler(
      request("administrator", "academy-1", {
        fullName: "New Member",
        academyId: "academy-2",
        membershipStatus: "active",
        createdBy: "attacker",
        password: "do-not-store",
      }),
      servicesForTest,
    );

    await expect(result).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("creates a scoped member with server-owned state and no sensitive projection fields", async () => {
    const servicesForTest = services([]);
    const result = await createMemberHandler(
      request("administrator", "academy-1", { fullName: "New Member", email: "new@example.test" }),
      servicesForTest,
    );

    expect(result).toEqual({ memberId: expect.any(String) });
    const stored = await servicesForTest.memberService.list("academy-1");
    expect(stored[0]).toMatchObject({
      academyId: "academy-1",
      membershipStatus: "active",
      paymentStatus: "unknown",
      createdBy: "admin-1",
      updatedBy: "admin-1",
    });
    expect(stored[0]).not.toHaveProperty("password");
    expect(stored[0]).not.toHaveProperty("ip");
  });

  it("searches with a fixed limit and returns only safe academy-scoped projections", async () => {
    const servicesForTest = services();
    const result = await searchMembersHandler(
      request("administrator", "academy-1", { filters: { name: "Synthetic" } }),
      servicesForTest,
    );

    expect(result).toEqual({
      members: [expect.objectContaining({ memberId: "member-1", fullName: "Synthetic Member" })],
    });
    expect(result.members[0]).not.toHaveProperty("academyId");
    expect(result.members[0]).not.toHaveProperty("createdBy");
    expect(result.members[0]).not.toHaveProperty("updatedBy");
    expect(result.members[0]).not.toHaveProperty("password");
    expect(result.members[0]).not.toHaveProperty("ip");
  });

  it("allowlists projections when stored documents contain sensitive extras", async () => {
    const stored = {
      ...member,
      password: "password: never-return",
      ip: "198.51.100.20",
      token: "token: never-return",
      rawAuth: { uid: "raw-auth-never-return" },
    };
    const result = await searchMembersHandler(
      request("administrator", "academy-1", {}),
      services([stored]),
    );

    expect(result.members[0]).toEqual(expect.objectContaining({ memberId: "member-1" }));
    for (const sensitiveField of ["password", "ip", "token", "rawAuth"]) {
      expect(result.members[0]).not.toHaveProperty(sensitiveField);
    }
  });

  it("returns a continuation token after the fixed page size", async () => {
    const records = Array.from({ length: 51 }, (_, index) => ({
      ...member,
      memberId: `member-${index + 1}`,
      fullName: `Synthetic Member ${String(index + 1).padStart(2, "0")}`,
    }));
    const result = await searchMembersHandler(
      request("administrator", "academy-1", {}),
      services(records),
    );

    expect(result.members).toHaveLength(50);
    expect(result.nextPageToken).toEqual(expect.any(String));
    const nextPage = await searchMembersHandler(
      request("administrator", "academy-1", { pageToken: result.nextPageToken }),
      services(records),
    );
    expect(nextPage.members).toHaveLength(1);
    expect(nextPage.members[0]?.memberId).toBe("member-51");
  });

  it("rejects forged and cross-query continuation tokens", async () => {
    const records = Array.from({ length: 51 }, (_, index) => ({
      ...member,
      memberId: `member-${index + 1}`,
      fullName: `Synthetic Member ${String(index + 1).padStart(2, "0")}`,
    }));
    const firstPage = await searchMembersHandler(
      request("administrator", "academy-1", {}),
      services(records),
    );
    const token = firstPage.nextPageToken as string;

    await expect(
      searchMembersHandler(
        request("administrator", "academy-1", { pageToken: `x${token.slice(1)}` }),
        services(records),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      searchMembersHandler(
        request("administrator", "academy-1", {
          filters: { name: "Synthetic" },
          pageToken: token,
        }),
        services(records),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("keeps report reads inside the actor academy", async () => {
    const servicesForTest = services();

    await expect(
      getMemberReportHandler(
        request("administrator", "academy-2", { report: "total" }),
        servicesForTest,
      ),
    ).resolves.toEqual({ report: "total", members: [], generatedAt: "2026-08-11T12:00:00.000Z" });
  });

  it("returns a count-only aggregate summary", async () => {
    const result = await getMemberReportSummaryHandler(
      request("administrator", "academy-1", { report: "active" }),
      services(),
    );

    expect(result).toEqual({ report: "active", count: 1 });
  });

  it("rejects a report before PDF generation when the row limit is exceeded", async () => {
    const servicesForTest = services(
      Array.from({ length: MAX_MEMBER_REPORT_ROWS + 1 }, (_, index) => ({
        ...member,
        memberId: `member-${index}`,
      })),
    );
    const reportPdf = async () => {
      throw new Error("PDF generator must not run");
    };

    await expect(
      getMemberReportPdfHandler(request("administrator", "academy-1", { report: "active" }), {
        ...servicesForTest,
        reportPdf,
      }),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
  });

  it("bounds search reads and rejects overflow before materializing a result", async () => {
    const records = Array.from({ length: MAX_MEMBER_SEARCH_ROWS + 1 }, (_, index) => ({
      ...member,
      memberId: `member-${index}`,
    }));
    let requestedLimit: number | undefined;
    const base = services([]);
    const store: MemberStore = {
      create: async () => undefined,
      list: async (_academyId, limit) => {
        requestedLimit = limit;
        return records.slice(0, limit);
      },
      countByReport: async () => 0,
      applyImport: async () => ({ imported: 0, updated: 0, conflicts: 0 }),
    };

    await expect(
      searchMembersHandler(request("administrator", "academy-1", {}), {
        ...base,
        memberService: createMemberService(store, {
          pageTokenSecret: "test-page-token-secret-32-bytes!!",
        }),
      }),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
    expect(requestedLimit).toBe(MAX_MEMBER_SEARCH_ROWS + 1);
  });

  it("bounds report reads and never invokes PDF generation after report overflow", async () => {
    const records = Array.from({ length: MAX_MEMBER_REPORT_ROWS + 1 }, (_, index) => ({
      ...member,
      memberId: `member-${index}`,
    }));
    let requestedLimit: number | undefined;
    let generated = false;
    const base = services([]);
    const store: MemberStore = {
      create: async () => undefined,
      list: async (_academyId, limit) => {
        requestedLimit = limit;
        return records.slice(0, limit);
      },
      countByReport: async () => records.length,
      applyImport: async () => ({ imported: 0, updated: 0, conflicts: 0 }),
    };

    await expect(
      getMemberReportPdfHandler(request("administrator", "academy-1", { report: "active" }), {
        ...base,
        memberService: createMemberService(store, {
          pageTokenSecret: "test-page-token-secret-32-bytes!!",
        }),
        reportPdf: async () => {
          generated = true;
          return new Uint8Array([37, 80, 68, 70]);
        },
      }),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
    expect(requestedLimit).toBe(MAX_MEMBER_REPORT_ROWS + 1);
    expect(generated).toBe(false);
  });

  it("rejects a generated PDF that exceeds the byte limit", async () => {
    const servicesForTest = services();
    const reportPdf = async () => new Uint8Array(MAX_MEMBER_REPORT_PDF_BYTES + 1);

    await expect(
      getMemberReportPdfHandler(request("administrator", "academy-1", { report: "active" }), {
        ...servicesForTest,
        reportPdf,
      }),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
  });

  it("returns a generic resource-exhausted error after the administrator rate limit", async () => {
    const rateLimiter = createMemoryMemberReportRateLimiter({ maxRequests: 2, windowMs: 60_000 });
    const base = services();
    const limited = { ...base, reportRateLimiter: rateLimiter };

    await getMemberReportPdfHandler(
      request("administrator", "academy-1", { report: "active" }),
      limited,
    );
    await getMemberReportPdfHandler(
      request("administrator", "academy-1", { report: "active" }),
      limited,
    );
    await expect(
      getMemberReportPdfHandler(
        request("administrator", "academy-1", { report: "active" }),
        limited,
      ),
    ).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "Report export is temporarily unavailable",
    });
  });

  it("rate-limits member searches, reports, and report counters independently", async () => {
    const base = services();
    const limited = {
      ...base,
      reportRateLimiter: createMemoryMemberReportRateLimiter({ maxRequests: 1, windowMs: 60_000 }),
    };

    await searchMembersHandler(request("administrator", "academy-1", { filters: {} }), limited);
    await expect(
      searchMembersHandler(request("administrator", "academy-1", { filters: {} }), limited),
    ).rejects.toMatchObject({ code: "resource-exhausted" });

    await getMemberReportHandler(
      request("administrator", "academy-1", { report: "active" }),
      limited,
    );
    await expect(
      getMemberReportHandler(request("administrator", "academy-1", { report: "active" }), limited),
    ).rejects.toMatchObject({ code: "resource-exhausted" });

    await getMemberReportSummaryHandler(
      request("administrator", "academy-1", { report: "active" }),
      limited,
    );
    await expect(
      getMemberReportSummaryHandler(
        request("administrator", "academy-1", { report: "active" }),
        limited,
      ),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
  });

  it("does not collide rate-limit keys when identity components contain separators", async () => {
    const rateLimiter = createMemoryMemberReportRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const now = new Date("2026-08-11T12:00:00.000Z");

    await rateLimiter.consume({ academyId: "academy:one", actorId: "admin", scope: "search", now });
    await expect(
      rateLimiter.consume({ academyId: "academy", actorId: "one:admin", scope: "search", now }),
    ).resolves.toBeUndefined();
  });

  it("uses a durable export journal and compensates when signing fails", async () => {
    const deleted: string[] = [];
    const base = services();
    const exports = createMemoryMemberReportExportStore();
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      getSigner: async () => {
        throw new Error("signing unavailable");
      },
      putObject: async () => undefined,
      deleteObject: async (objectKey) => {
        deleted.push(objectKey);
      },
    });
    const exportServices = { ...base, r2, reportExports: exports };

    await expect(
      getMemberReportPdfHandler(
        request("administrator", "academy-1", { report: "active" }),
        exportServices,
      ),
    ).rejects.toMatchObject({ code: "internal" });
    expect(deleted).toEqual(["academies/academy-1/member-reports/session-1/active.pdf"]);
    await expect(exports.get("session-1")).resolves.toMatchObject({ status: "failed" });
  });

  it("compensates a durable export when the R2 PUT fails", async () => {
    const deleted: string[] = [];
    const base = services();
    const exports = createMemoryMemberReportExportStore();
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      putObject: async () => {
        throw new Error("R2 PUT failed");
      },
      deleteObject: async (objectKey) => {
        deleted.push(objectKey);
      },
    });

    await expect(
      getMemberReportPdfHandler(request("administrator", "academy-1", { report: "active" }), {
        ...base,
        r2,
        reportExports: exports,
      }),
    ).rejects.toMatchObject({ code: "internal" });
    expect(deleted).toEqual(["academies/academy-1/member-reports/session-1/active.pdf"]);
    await expect(exports.get("session-1")).resolves.toMatchObject({ status: "failed" });
  });

  it("generates a real-report artifact from the canonical projection and signs only its download", async () => {
    const stored: Array<{ key: string; bytes: Uint8Array; contentType: string }> = [];
    const base = services();
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      getSigner: async () => "https://signed.example/report.pdf",
      putObject: async (key, bytes, contentType) => {
        stored.push({ key, bytes, contentType });
      },
    });
    const servicesForTest: MemberCallableServices = {
      ...base,
      r2,
      reportPdf: async (report, members) => {
        expect(report).toBe("active");
        expect(members).toEqual([expect.objectContaining({ memberId: "member-1" })]);
        return new Uint8Array([37, 80, 68, 70]);
      },
    };

    await expect(
      getMemberReportPdfHandler(
        request("administrator", "academy-1", { report: "active" }),
        servicesForTest,
      ),
    ).resolves.toEqual({
      downloadUrl: "https://signed.example/report.pdf",
      expiresAt: "2026-08-11T12:05:00.000Z",
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      key: "academies/academy-1/member-reports/session-1/active.pdf",
      contentType: "application/pdf",
    });
    expect(stored[0]?.bytes).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(await servicesForTest.reportExports?.get("session-1")).toMatchObject({
      objectKey: "academies/academy-1/member-reports/session-1/active.pdf",
      status: "uploaded",
    });
  });

  it("rejects arbitrary report payload fields before generating a PDF", async () => {
    const servicesForTest = services();

    await expect(
      getMemberReportPdfHandler(
        request("administrator", "academy-1", { report: "active", members: [member] }),
        servicesForTest,
      ),
    ).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("creates temporary signed PDF upload URLs without receiving binary data", async () => {
    const servicesForTest = services([]);
    const result = await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      servicesForTest,
    );

    expect(result).toEqual({
      sessionId: "session-1",
      uploads: [
        {
          objectKey: "academies/academy-1/member-imports/session-1/0-members.pdf",
          uploadUrl: "https://signed.example/upload",
        },
      ],
      expiresAt: "2026-08-11T12:10:00.000Z",
    });
  });

  it("previews without writing members and confirms only an explicit server preview", async () => {
    const servicesForTest = services([]);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      servicesForTest,
    );
    const preview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      servicesForTest,
    );

    expect(preview).toMatchObject({ previewId: expect.any(String), expiresAt: expect.any(String) });
    expect(preview.previewId).not.toBe("session-1-preview");
    expect(preview.previewId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(await servicesForTest.memberService.list("academy-1")).toEqual([]);
    await expect(
      confirmMemberPdfImportHandler(
        request("administrator", "academy-1", {
          sessionId: "session-1",
          previewId: "forged",
          confirm: true,
        }),
        servicesForTest,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("applies a confirmed preview, preserves empty fields, and assigns server IDs to additions", async () => {
    const existing = {
      ...member,
      membershipNumber: "M-100",
      fullName: "Synthetic Member",
      idCardNumber: "ID-OLD",
      mobileNumber: "+440000000",
    };
    const report = [
      "TOTAL MEMBERS IN DATABASE (2)",
      "Member Nº | Name | ID Card Nº | Birthdate | VAT Number | Mobile nº",
      "M-100 | Synthetic Member | ID-NEW | 11 Nov 2011 |  | ",
      " | Synthetic New Member | ID-200 | 10 Jan 2000 | VAT-200 | +44200",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/1",
    ].join("\n");
    const servicesForTest = services([existing], [report]);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      servicesForTest,
    );
    const preview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      servicesForTest,
    );

    await expect(
      confirmMemberPdfImportHandler(
        request("administrator", "academy-1", {
          sessionId: "session-1",
          previewId: preview.previewId,
          confirm: true,
        }),
        servicesForTest,
      ),
    ).resolves.toEqual({ imported: 1, updated: 1, conflicts: 0 });

    const stored = await servicesForTest.memberService.list("academy-1");
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: "member-1",
          membershipNumber: "M-100",
          idCardNumber: "ID-NEW",
          mobileNumber: "+440000000",
        }),
        expect.objectContaining({
          memberId: "session-1",
          fullName: "Synthetic New Member",
        }),
      ]),
    );
  });

  it("returns the original result on repeated confirmation without duplicating writes", async () => {
    const servicesForTest = services([], [syntheticReport]);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      servicesForTest,
    );
    const preview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      servicesForTest,
    );
    const confirmation = {
      sessionId: "session-1",
      previewId: preview.previewId,
      confirm: true as const,
    };

    await expect(
      confirmMemberPdfImportHandler(
        request("administrator", "academy-1", confirmation),
        servicesForTest,
      ),
    ).resolves.toEqual({ imported: 1, updated: 0, conflicts: 0 });
    await expect(
      confirmMemberPdfImportHandler(
        request("administrator", "academy-1", confirmation),
        servicesForTest,
      ),
    ).resolves.toEqual({ imported: 1, updated: 0, conflicts: 0 });
    await expect(servicesForTest.memberService.list("academy-1")).resolves.toHaveLength(1);
  });

  it("allows a confirmed retry after the import session expires", async () => {
    const servicesForTest = services([], [syntheticReport]);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      servicesForTest,
    );
    const preview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      servicesForTest,
    );
    const confirmation = {
      sessionId: "session-1",
      previewId: preview.previewId,
      confirm: true as const,
    };
    await confirmMemberPdfImportHandler(
      request("administrator", "academy-1", confirmation),
      servicesForTest,
    );
    await expect(
      confirmMemberPdfImportHandler(request("administrator", "academy-1", confirmation), {
        ...servicesForTest,
        now: () => new Date("2026-08-11T12:10:00.000Z"),
      }),
    ).resolves.toEqual({ imported: 1, updated: 0, conflicts: 0 });
  });

  it("rejects an expired preview before any canonical write", async () => {
    const servicesForTest = services([], [syntheticReport]);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      servicesForTest,
    );
    const preview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      servicesForTest,
    );
    const expiredServices = {
      ...servicesForTest,
      now: () => new Date("2026-08-11T12:10:00.000Z"),
    };

    await expect(
      confirmMemberPdfImportHandler(
        request("administrator", "academy-1", {
          sessionId: "session-1",
          previewId: preview.previewId,
          confirm: true,
        }),
        expiredServices,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(servicesForTest.memberService.list("academy-1")).resolves.toEqual([]);
  });

  it("blocks canonical writes when the preview contains a conflict", async () => {
    const conflictReport = [
      "ACTIVE MEMBERS IN DATABASE (1)",
      "Member Nº | Name | ID Card Nº | Birthdate | VAT Number | Mobile nº",
      "M-100 | Different Synthetic Member | ID-100 | 10 Jan 2000 | VAT-100 | +44100100",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/1",
    ].join("\n");
    const servicesForTest = services([{ ...member, membershipNumber: "M-100" }], [conflictReport]);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "conflict.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      servicesForTest,
    );
    const preview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      servicesForTest,
    );
    await expect(
      confirmMemberPdfImportHandler(
        request("administrator", "academy-1", {
          sessionId: "session-1",
          previewId: preview.previewId,
          confirm: true,
        }),
        servicesForTest,
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(servicesForTest.memberService.list("academy-1")).resolves.toHaveLength(1);
  });

  it("rejects concurrent confirmations with a forged different result", async () => {
    const servicesForTest = services([], [syntheticReport]);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      servicesForTest,
    );
    const preview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      servicesForTest,
    );
    const original = await confirmMemberPdfImportHandler(
      request("administrator", "academy-1", {
        sessionId: "session-1",
        previewId: preview.previewId,
        confirm: true,
      }),
      servicesForTest,
    );
    const stored = await servicesForTest.previewStore!.get(preview.previewId);
    if (!stored) throw new Error("preview missing");
    await expect(
      servicesForTest.previewStore!.confirmIfPending({
        previewId: stored.previewId,
        operationId: stored.previewId,
        sessionId: stored.sessionId,
        academyId: stored.academyId,
        actorId: stored.actorId,
        sourceHash: stored.sourceHash,
        result: { imported: 99, updated: 0, conflicts: 0 },
      }),
    ).rejects.toThrow(/result|inconsistent/i);
    expect(original).toEqual({ imported: 1, updated: 0, conflicts: 0 });
  });

  it("rejects a report above the row limit before materializing a preview", async () => {
    const previewStore = createMemoryMemberImportPreviewStore();
    const oversizedReport = [
      `TOTAL MEMBERS IN DATABASE (${MAX_MEMBER_REPORT_ROWS + 1})`,
      "Member Nº | Name | ID Card Nº | Birthdate | VAT Number | Mobile nº",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/1",
    ].join("\n");
    const servicesForTest = services([], [oversizedReport], previewStore);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "oversized.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      servicesForTest,
    );

    await expect(
      previewMemberPdfImportHandler(
        request("administrator", "academy-1", { sessionId: "session-1" }),
        servicesForTest,
      ),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
  });

  it("rejects persisted sessions with too many or cross-tenant object keys", async () => {
    const base = services([]);
    const sessions = createMemoryMemberImportSessionStore();
    const invalidSession = {
      sessionId: "session-1",
      academyId: "academy-1",
      objectKeys: [
        "academies/academy-1/member-imports/session-1/0-a.pdf",
        "academies/academy-1/member-imports/session-1/1-b.pdf",
        "academies/academy-1/member-imports/session-1/2-c.pdf",
        "academies/academy-1/member-imports/session-1/3-d.pdf",
        "academies/academy-2/member-imports/session-1/4-e.pdf",
        "academies/academy-1/member-imports/session-1/5-f.pdf",
      ],
      expiresAt: "2026-08-11T12:10:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T12:10:00.000Z",
      cleanupStatus: "pending" as const,
    };
    const invalidSessionStore = {
      ...sessions,
      get: async () => invalidSession,
    };

    await expect(
      previewMemberPdfImportHandler(
        request("administrator", "academy-1", { sessionId: "session-1" }),
        { ...base, sessions: invalidSessionStore },
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("clears the persisted preview before a failed re-preview", async () => {
    const previewStore = createMemoryMemberImportPreviewStore();
    const base = services([], [syntheticReport], previewStore);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      base,
    );
    const oldPreview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      base,
    );
    const failed = services([], ["UNSUPPORTED MEMBERS EXPORT (1)"], {
      ...previewStore,
      remove: async () => {
        throw new Error("preview remove unavailable");
      },
    });
    const session = await base.sessions.get("session-1");
    if (!session) throw new Error("test session missing");
    await failed.sessions.save(session);

    await expect(
      previewMemberPdfImportHandler(
        request("administrator", "academy-1", { sessionId: "session-1" }),
        failed,
      ),
    ).rejects.toMatchObject({
      code: "internal",
      message: "Unable to clear member import preview",
    });
    await expect(failed.previewStore?.get(oldPreview.previewId)).resolves.toMatchObject({
      status: "expired",
    });
    await expect(failed.sessions.get("session-1")).resolves.toMatchObject({
      previewState: "invalidated",
      preview: oldPreview,
    });
    await expect(
      confirmMemberPdfImportHandler(
        request("administrator", "academy-1", {
          sessionId: "session-1",
          previewId: oldPreview.previewId,
          confirm: true,
        }),
        failed,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("fails closed when the session preview record belongs to another tenant", async () => {
    const base = services([], [syntheticReport]);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      base,
    );
    const validPreview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      base,
    );
    let invalidated = 0;
    let removed = 0;
    const session = await base.sessions.get("session-1");
    if (!session) throw new Error("test session missing");
    const foreignSessionStore = {
      ...base.sessions,
      get: async () => ({ ...session, preview: { ...validPreview, academyId: "academy-2" } }),
    };
    const foreignStore = {
      ...base.previewStore!,
      invalidate: async () => {
        invalidated += 1;
      },
      remove: async () => {
        removed += 1;
      },
    };

    await expect(
      previewMemberPdfImportHandler(
        request("administrator", "academy-1", { sessionId: "session-1" }),
        { ...base, sessions: foreignSessionStore, previewStore: foreignStore },
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(invalidated).toBe(0);
    expect(removed).toBe(0);
  });

  it("rejects confirmation when the session preview and durable record are inconsistent", async () => {
    const base = services([], [syntheticReport]);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      base,
    );
    const preview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      base,
    );
    const foreignRecord = {
      ...(await base.previewStore!.get(preview.previewId))!,
      sessionId: "other-session",
    };
    const foreignStore = {
      ...base.previewStore!,
      get: async () => foreignRecord,
    };

    await expect(
      confirmMemberPdfImportHandler(
        request("administrator", "academy-1", {
          sessionId: "session-1",
          previewId: preview.previewId,
          confirm: true,
        }),
        { ...base, previewStore: foreignStore },
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("fails closed during cleanup when an expired preview is not related to its session", async () => {
    const base = services([]);
    const expired = {
      previewId: "123e4567-e89b-42d3-a456-426614174111",
      sessionId: "session-1",
      academyId: "academy-1",
      actorId: "admin-1",
      expiresAt: "2026-08-11T11:00:00.000Z",
      sourceHash: "a".repeat(64),
      reportKeys: ["total"] as const,
      preview: {
        previewId: "123e4567-e89b-42d3-a456-426614174111",
        expiresAt: "2026-08-11T11:00:00.000Z",
        sourceReports: [{ source: "pdf-1", report: "total" as const, rowCount: 0 }],
        additions: [],
        updates: [],
        duplicates: [],
        conflicts: [],
      },
      status: "pending" as const,
    };
    let removed = 0;
    const previewStore = {
      ...base.previewStore!,
      listExpired: async () => [expired],
      remove: async () => {
        removed += 1;
      },
    };
    const sessions = {
      ...base.sessions,
      get: async () => ({
        sessionId: "session-1",
        academyId: "academy-2",
        objectKeys: ["academies/academy-2/member-imports/session-1/0-members.pdf"],
        expiresAt: "2026-08-11T12:00:00.000Z",
        cleanupAttempts: 0,
        nextCleanupAt: "2026-08-11T12:00:00.000Z",
        cleanupStatus: "pending" as const,
      }),
    };

    await expect(
      cleanupExpiredMemberImportSessions(
        {
          r2: base.r2,
          sessions: { ...sessions, listExpired: async () => [] },
          cleanupJournal: base.cleanupJournal,
          previewStore,
        },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).resolves.toBeUndefined();
    expect(removed).toBe(0);
  });

  it("rejects malformed and inconsistent persisted session timestamps and previews", () => {
    const valid = {
      sessionId: "session-1",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/session-1/0-members.pdf"],
      expiresAt: "2026-08-11T12:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T12:00:00.000Z",
      cleanupStatus: "pending" as const,
    };
    expect(parseMemberImportSession({ ...valid, expiresAt: "tomorrow" })).toBeUndefined();
    expect(parseMemberImportSession({ ...valid, nextCleanupAt: "tomorrow" })).toBeUndefined();
    expect(parseMemberImportSession({ ...valid })).toBeUndefined();
    expect(parseMemberImportSession({ ...valid, previewState: "unknown" })).toBeUndefined();
    expect(
      parseMemberImportSession({
        ...valid,
        preview: {
          previewId: "123e4567-e89b-42d3-a456-426614174111",
          expiresAt: "2026-08-11T11:00:00.000Z",
          sourceReports: [],
          additions: [],
          updates: [],
          duplicates: [],
          conflicts: [],
        },
      }),
    ).toBeUndefined();
  });

  it("does not delete journal objects when its session preview is cross-tenant", async () => {
    const base = services([]);
    const sessions = createMemoryMemberImportSessionStore();
    await sessions.save({
      sessionId: "journal-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/journal-session/members.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
      previewState: "pending",
      preview: {
        previewId: "123e4567-e89b-42d3-a456-426614174112",
        expiresAt: "2026-08-11T11:00:00.000Z",
        sourceReports: [],
        additions: [],
        updates: [],
        duplicates: [],
        conflicts: [],
      },
    });
    const previewStore = {
      ...base.previewStore!,
      get: async () => ({
        previewId: "123e4567-e89b-42d3-a456-426614174112",
        sessionId: "journal-session",
        academyId: "academy-2",
        actorId: "admin-1",
        expiresAt: "2026-08-11T11:00:00.000Z",
        sourceHash: "a".repeat(64),
        reportKeys: ["total"] as const,
        preview: {
          previewId: "123e4567-e89b-42d3-a456-426614174112",
          expiresAt: "2026-08-11T11:00:00.000Z",
          sourceReports: [],
          additions: [],
          updates: [],
          duplicates: [],
          conflicts: [],
        },
        status: "pending" as const,
      }),
    };
    await base.cleanupJournal.save({
      sessionId: "journal-session",
      objectKeys: ["academies/academy-1/member-imports/journal-session/members.pdf"],
      attempts: 0,
      nextCleanupAt: "2026-11-11T11:00:00.000Z",
      lastError: "pending",
      status: "pending",
      kind: "import",
    });
    let deletes = 0;
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deletes += 1;
      },
    });

    await expect(
      cleanupExpiredMemberImportSessions(
        { r2, sessions, cleanupJournal: base.cleanupJournal, previewStore },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).resolves.toBeUndefined();
    expect(deletes).toBe(0);
  });

  it("sanitizes session and preview store failures while preserving intentional HttpsErrors", async () => {
    const base = services([]);
    const failingGet = {
      ...base,
      sessions: {
        ...base.sessions,
        get: async () => {
          throw new Error("storage detail");
        },
      },
    };
    await expect(
      previewMemberPdfImportHandler(
        request("administrator", "academy-1", { sessionId: "session-1" }),
        failingGet,
      ),
    ).rejects.toMatchObject({ code: "internal", message: "Unable to load member import session" });

    const failingPreviewStore = {
      ...base,
      previewStore: {
        ...base.previewStore!,
        get: async () => {
          throw new Error("preview storage detail");
        },
      },
    };
    await base.sessions.save({
      sessionId: "session-1",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/session-1/0-members.pdf"],
      expiresAt: "2026-08-11T12:10:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T12:10:00.000Z",
      cleanupStatus: "pending",
      previewState: "pending",
    });
    await expect(
      confirmMemberPdfImportHandler(
        request("administrator", "academy-1", {
          sessionId: "session-1",
          previewId: "preview-1",
          confirm: true,
        }),
        failingPreviewStore,
      ),
    ).rejects.toMatchObject({ code: "internal", message: "Unable to load member import preview" });
  });

  it("uses a bounded import projection and requests at most max plus one records", async () => {
    let requestedLimit = 0;
    const base = services([{ ...member, membershipNumber: "M-100" }], [syntheticReport]);
    const original = base.memberService;
    const projected = {
      ...original,
      listForImport: async () => {
        requestedLimit = MAX_MEMBER_REPORT_ROWS + 1;
        return [
          {
            memberId: "member-1",
            membershipNumber: "M-100",
            fullName: "Synthetic Member",
            membershipStatus: "active" as const,
            paymentStatus: "unknown" as const,
          },
        ];
      },
    };
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      { ...base, memberService: projected },
    );
    await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      { ...base, memberService: projected },
    );
    expect(requestedLimit).toBe(MAX_MEMBER_REPORT_ROWS + 1);
  });

  it("classifies parsed rows against canonical members and persists opaque preview metadata", async () => {
    const previewStore = createMemoryMemberImportPreviewStore();
    const servicesForTest = services(
      [{ ...member, membershipNumber: "M-100" }],
      [syntheticReport],
      previewStore,
    );
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      servicesForTest,
    );

    const preview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      servicesForTest,
    );

    expect(preview).toMatchObject({
      sourceReports: [{ report: "total", rowCount: 1 }],
      additions: [],
      updates: [
        {
          stableKey: "membership:m100",
          fieldNames: expect.arrayContaining(["idCardNumber"]),
        },
      ],
      duplicates: [],
      conflicts: [],
    });
    const stored = await previewStore.get(preview.previewId);
    expect(stored).toMatchObject({
      sessionId: "session-1",
      academyId: "academy-1",
      actorId: "admin-1",
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      reportKeys: ["total"],
      status: "pending",
    });
    expect(stored).not.toHaveProperty("rawText");
    expect(stored).not.toHaveProperty("rows");
  });

  it("treats rows without identifiers as additions and marks contradictory identifiers as conflicts", async () => {
    const noNumberReport = [
      "MEMBERS WITHOUT MEMBER NUMBER IN DATABASE (1)",
      "Member Nº | Name | ID Card Nº | Birthdate | VAT Number | Mobile nº",
      " | Synthetic New Member | ID-200 | 10 Jan 2000 | VAT-200 | +44200",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/1",
    ].join("\n");
    const conflictReport = [
      "ACTIVE MEMBERS IN DATABASE (1)",
      "Member Nº | Name | ID Card Nº | Birthdate | VAT Number | Mobile nº",
      "M-100 | Contradictory Imported Member | ID-100 | 10 Jan 2000 | VAT-100 | +44100100",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/1",
    ].join("\n");
    const previewStore = createMemoryMemberImportPreviewStore();
    const servicesForTest = services(
      [{ ...member, membershipNumber: "M-100" }],
      [noNumberReport, conflictReport],
      previewStore,
    );
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [
          { fileName: "new.pdf", contentType: "application/pdf", sizeBytes: 1024 },
          { fileName: "conflict.pdf", contentType: "application/pdf", sizeBytes: 1024 },
        ],
      }),
      servicesForTest,
    );

    const preview = await previewMemberPdfImportHandler(
      request("administrator", "academy-1", { sessionId: "session-1" }),
      servicesForTest,
    );

    expect(preview.additions).toEqual([
      expect.objectContaining({ stableKey: expect.stringMatching(/^fingerprint:/) }),
    ]);
    expect(preview.conflicts).toEqual([expect.objectContaining({ stableKey: "membership:m100" })]);
    expect(await servicesForTest.memberService.list("academy-1")).toEqual([
      expect.objectContaining({ membershipNumber: "M-100" }),
    ]);
  });

  it("rejects invalid PDFs and unknown layouts without creating a preview", async () => {
    const previewStore = createMemoryMemberImportPreviewStore();
    const base = services([], ["UNSUPPORTED MEMBERS EXPORT (1)"], previewStore);
    const invalidR2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      getObject: async () => ({
        body: (async function* () {
          yield new Uint8Array([1, 2, 3]);
        })(),
      }),
    });
    const invalidServices = { ...base, r2: invalidR2 };
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "invalid.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      invalidServices,
    );
    await expect(
      previewMemberPdfImportHandler(
        request("administrator", "academy-1", { sessionId: "session-1" }),
        invalidServices,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(previewStore.get("session-1-preview")).resolves.toBeUndefined();

    const unknownServices = services([], ["UNSUPPORTED MEMBERS EXPORT (1)"], previewStore);
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "unknown.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      unknownServices,
    );
    await expect(
      previewMemberPdfImportHandler(
        request("administrator", "academy-1", { sessionId: "session-1" }),
        unknownServices,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(previewStore.get("session-1-preview")).resolves.toBeUndefined();
  });

  it("rejects cross-tenant previews before reading R2 and removes preview records during cleanup", async () => {
    let reads = 0;
    const previewStore = createMemoryMemberImportPreviewStore();
    const base = services([], [syntheticReport], previewStore);
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      getObject: async () => {
        reads += 1;
        return {
          body: (async function* () {
            yield new Uint8Array([37, 80, 68, 70]);
          })(),
        };
      },
    });
    const scoped = { ...base, r2 };
    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      scoped,
    );
    await expect(
      previewMemberPdfImportHandler(
        request("administrator", "academy-2", { sessionId: "session-1" }),
        scoped,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(reads).toBe(0);
  });

  it("cleans expired objects and session records through injected adapters", async () => {
    const deleted: string[] = [];
    const sessionStore = createMemoryMemberImportSessionStore();
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    await sessionStore.save({
      sessionId: "expired-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/expired-session/members.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async (objectKey) => {
        deleted.push(objectKey);
      },
    });

    await cleanupExpiredMemberImportSessions(
      { r2, sessions: sessionStore, cleanupJournal },
      new Date("2026-08-11T12:00:00.000Z"),
    );

    expect(deleted).toEqual(["academies/academy-1/member-imports/expired-session/members.pdf"]);
    await expect(sessionStore.get("expired-session")).resolves.toBeUndefined();
  });

  it("cleans an expired UUID preview without deriving its id from the session", async () => {
    const previewStore = createMemoryMemberImportPreviewStore();
    const expiredPreview = {
      ...{
        previewId: "123e4567-e89b-42d3-a456-426614174099",
        sessionId: "expired-session",
        academyId: "academy-1",
        actorId: "admin-1",
        expiresAt: "2026-08-11T11:00:00.000Z",
        sourceHash: "a".repeat(64),
        reportKeys: ["total"] as const,
        preview: {
          previewId: "123e4567-e89b-42d3-a456-426614174099",
          expiresAt: "2026-08-11T11:00:00.000Z",
          sourceReports: [{ source: "pdf-1", report: "total" as const, rowCount: 0 }],
          additions: [],
          updates: [],
          duplicates: [],
          conflicts: [],
        },
        status: "pending" as const,
      },
    };
    const deleted: string[] = [];
    const order: string[] = [];
    await previewStore.save(expiredPreview);
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    const sessions = createMemoryMemberImportSessionStore();
    await sessions.save({
      sessionId: "expired-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/expired-session/members.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
      preview: expiredPreview.preview,
    });
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async (objectKey) => {
        order.push(`r2:${objectKey}`);
        deleted.push(objectKey);
      },
    });
    const orderedSessions = {
      ...sessions,
      remove: async (sessionId: string) => {
        order.push(`session:${sessionId}`);
        await sessions.remove(sessionId);
      },
    };
    const orderedPreviewStore = {
      ...previewStore,
      remove: async (previewId: string) => {
        order.push(`preview:${previewId}`);
        await previewStore.remove(previewId);
      },
    };
    await cleanupExpiredMemberImportSessions(
      {
        r2,
        sessions: orderedSessions,
        cleanupJournal,
        previewStore: orderedPreviewStore,
      },
      new Date("2026-08-11T12:00:00.000Z"),
    );

    await expect(previewStore.get(expiredPreview.previewId)).resolves.toBeUndefined();
    expect(deleted).toEqual(["academies/academy-1/member-imports/expired-session/members.pdf"]);
    await expect(sessions.get("expired-session")).resolves.toBeUndefined();
    expect(order).toEqual([
      "r2:academies/academy-1/member-imports/expired-session/members.pdf",
      "session:expired-session",
      "preview:123e4567-e89b-42d3-a456-426614174099",
    ]);
  });

  it("retries a failed preview removal from expired previews on the next cleanup", async () => {
    const previewStore = createMemoryMemberImportPreviewStore();
    const preview = {
      previewId: "123e4567-e89b-42d3-a456-426614174101",
      expiresAt: "2026-08-11T11:00:00.000Z",
      sourceReports: [{ source: "pdf-1", report: "total" as const, rowCount: 0 }],
      additions: [],
      updates: [],
      duplicates: [],
      conflicts: [],
    };
    await previewStore.save({
      previewId: preview.previewId,
      sessionId: "retry-preview-session",
      academyId: "academy-1",
      actorId: "admin-1",
      expiresAt: preview.expiresAt,
      sourceHash: "a".repeat(64),
      reportKeys: ["total"],
      preview,
      status: "pending",
    });
    const sessions = createMemoryMemberImportSessionStore();
    await sessions.save({
      sessionId: "retry-preview-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/retry-preview-session/members.pdf"],
      expiresAt: preview.expiresAt,
      cleanupAttempts: 0,
      nextCleanupAt: preview.expiresAt,
      cleanupStatus: "pending",
      preview,
    });
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    const basePreviewStore = previewStore;
    let removeAttempts = 0;
    const retryingPreviewStore = {
      ...basePreviewStore,
      remove: async (previewId: string) => {
        removeAttempts += 1;
        if (removeAttempts === 1) throw new Error("temporary preview store failure");
        await basePreviewStore.remove(previewId);
      },
    };
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => undefined,
    });

    await expect(
      cleanupExpiredMemberImportSessions(
        { r2, sessions, cleanupJournal, previewStore: retryingPreviewStore },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).rejects.toThrow("Member import cleanup journal unavailable");
    await expect(previewStore.get(preview.previewId)).resolves.toBeDefined();

    await cleanupExpiredMemberImportSessions(
      { r2, sessions, cleanupJournal, previewStore: retryingPreviewStore },
      new Date("2026-08-11T12:05:00.000Z"),
    );
    await expect(previewStore.get(preview.previewId)).resolves.toBeUndefined();
    expect(removeAttempts).toBe(2);
  });

  it("cleans the session and R2 objects when the related preview is already absent", async () => {
    const previewStore = createMemoryMemberImportPreviewStore();
    const preview = {
      previewId: "123e4567-e89b-42d3-a456-426614174100",
      expiresAt: "2026-08-11T11:00:00.000Z",
      sourceReports: [{ source: "pdf-1", report: "total" as const, rowCount: 0 }],
      additions: [],
      updates: [],
      duplicates: [],
      conflicts: [],
    };
    const sessions = createMemoryMemberImportSessionStore();
    await sessions.save({
      sessionId: "missing-preview-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/missing-preview-session/members.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
      preview,
    });
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    const deleted: string[] = [];
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async (objectKey) => {
        deleted.push(objectKey);
      },
    });
    await cleanupExpiredMemberImportSessions(
      { r2, sessions, cleanupJournal, previewStore },
      new Date("2026-08-11T12:00:00.000Z"),
    );

    expect(deleted).toEqual([
      "academies/academy-1/member-imports/missing-preview-session/members.pdf",
    ]);
    await expect(sessions.get("missing-preview-session")).resolves.toBeUndefined();
    await expect(previewStore.get(preview.previewId)).resolves.toBeUndefined();
  });

  it("fails closed before R2 when an import journal has unexpected object keys", async () => {
    const sessions = createMemoryMemberImportSessionStore();
    await sessions.save({
      sessionId: "journal-key-mismatch",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/journal-key-mismatch/members.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    await cleanupJournal.save({
      sessionId: "journal-key-mismatch",
      objectKeys: ["academies/academy-2/member-imports/other-session/members.pdf"],
      attempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      lastError: "pending",
      status: "pending",
      kind: "import",
    });
    let deleted = 0;
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deleted += 1;
      },
    });

    await expect(
      cleanupExpiredMemberImportSessions(
        { r2, sessions, cleanupJournal },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).rejects.toThrow("Member import cleanup journal invalid or missing");
    expect(deleted).toBe(0);
  });

  it("cleans report exports from the durable journal when session listing is unavailable", async () => {
    const reportExports = createMemoryMemberReportExportStore();
    await reportExports.save({
      sessionId: "export-session",
      academyId: "academy-1",
      report: "active",
      objectKey: "academies/academy-1/member-reports/export-session/active.pdf",
      createdAt: "2026-08-11T10:00:00.000Z",
      expiresAt: "2026-08-11T11:00:00.000Z",
      status: "uploaded",
    });
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    await cleanupJournal.save({
      sessionId: "member-report-export:export-session",
      objectKeys: ["academies/academy-1/member-reports/export-session/active.pdf"],
      attempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      lastError: "Report export cleanup pending",
      status: "pending",
      kind: "report-export",
    });
    const deleted: string[] = [];
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async (objectKey) => {
        deleted.push(objectKey);
      },
    });
    const sessions = {
      ...createMemoryMemberImportSessionStore(),
      listExpired: async () => {
        throw new Error("temporary session scan failure");
      },
    };

    await cleanupExpiredMemberImportSessions(
      { r2, sessions, cleanupJournal, reportExports },
      new Date("2026-08-11T12:00:00.000Z"),
    );

    expect(deleted).toEqual(["academies/academy-1/member-reports/export-session/active.pdf"]);
    await expect(reportExports.get("export-session")).resolves.toBeUndefined();
  });

  it("fails closed before R2 when a report export journal key mismatches its session", async () => {
    const reportExports = createMemoryMemberReportExportStore();
    await reportExports.save({
      sessionId: "mismatched-export",
      academyId: "academy-1",
      report: "active",
      objectKey: "academies/academy-1/member-reports/mismatched-export/active.pdf",
      createdAt: "2026-08-11T10:00:00.000Z",
      expiresAt: "2026-08-11T11:00:00.000Z",
      status: "uploaded",
    });
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    await cleanupJournal.save({
      sessionId: "member-report-export:mismatched-export",
      objectKeys: ["academies/academy-1/member-reports/other-export/active.pdf"],
      attempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      lastError: "pending",
      status: "pending",
      kind: "report-export",
    });
    let deleted = 0;
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deleted += 1;
      },
    });

    await expect(
      cleanupExpiredMemberImportSessions(
        { r2, sessions: createMemoryMemberImportSessionStore(), cleanupJournal, reportExports },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).rejects.toThrow("Member import cleanup journal invalid or missing");
    expect(deleted).toBe(0);
  });

  it("fails closed before R2 when the durable report export sessionId is inconsistent", async () => {
    const reportExports = {
      ...createMemoryMemberReportExportStore(),
      get: async () => ({
        sessionId: "different-export",
        academyId: "academy-1",
        report: "active" as const,
        objectKey: "academies/academy-1/member-reports/durable-export/active.pdf",
        createdAt: "2026-08-11T10:00:00.000Z",
        expiresAt: "2026-08-11T11:00:00.000Z",
        status: "uploaded" as const,
      }),
    };
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    await cleanupJournal.save({
      sessionId: "member-report-export:durable-export",
      objectKeys: ["academies/academy-1/member-reports/durable-export/active.pdf"],
      attempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      lastError: "pending",
      status: "pending",
      kind: "report-export",
    });
    let deleted = 0;
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deleted += 1;
      },
    });

    await expect(
      cleanupExpiredMemberImportSessions(
        {
          r2,
          sessions: createMemoryMemberImportSessionStore(),
          cleanupJournal,
          reportExports,
        },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).rejects.toThrow("Member import cleanup journal invalid or missing");
    expect(deleted).toBe(0);
  });

  it("fails closed before R2 when a report export journal lacks its required prefix", async () => {
    const reportExports = createMemoryMemberReportExportStore();
    await reportExports.save({
      sessionId: "missing-prefix-export",
      academyId: "academy-1",
      report: "active",
      objectKey: "academies/academy-1/member-reports/missing-prefix-export/active.pdf",
      createdAt: "2026-08-11T10:00:00.000Z",
      expiresAt: "2026-08-11T11:00:00.000Z",
      status: "uploaded",
    });
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    await cleanupJournal.save({
      sessionId: "missing-prefix-export",
      objectKeys: ["academies/academy-1/member-reports/missing-prefix-export/active.pdf"],
      attempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      lastError: "pending",
      status: "pending",
      kind: "report-export",
    });
    let deleted = 0;
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deleted += 1;
      },
    });

    await expect(
      cleanupExpiredMemberImportSessions(
        {
          r2,
          sessions: createMemoryMemberImportSessionStore(),
          cleanupJournal,
          reportExports,
        },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).rejects.toThrow("Member import cleanup journal invalid or missing");
    expect(deleted).toBe(0);
  });

  it("persists a durable session before requesting upload URLs", async () => {
    const sequence: string[] = [];
    const base = services([]);
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => {
        sequence.push("sign");
        return "https://signed.example/upload";
      },
    });
    const durableServices: MemberCallableServices = {
      ...base,
      r2,
      sessions: {
        ...base.sessions,
        save: async (session) => {
          sequence.push(`save:${session.cleanupStatus}`);
          await base.sessions.save(session);
        },
      },
    };

    await createMemberPdfImportSessionHandler(
      request("administrator", "academy-1", {
        files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
      }),
      durableServices,
    );

    expect(sequence).toEqual(["save:pending", "sign", "save:pending"]);
  });

  it("does not request URLs or delete objects when durable session persistence fails", async () => {
    let signed = false;
    let deleted = false;
    const base = services([]);
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => {
        signed = true;
        return "https://signed.example/upload";
      },
      deleteObject: async () => {
        deleted = true;
      },
    });
    const failingServices: MemberCallableServices = {
      ...base,
      r2,
      sessions: {
        ...base.sessions,
        save: async () => {
          throw new Error("session store unavailable");
        },
      },
    };

    await expect(
      createMemberPdfImportSessionHandler(
        request("administrator", "academy-1", {
          files: [{ fileName: "members.pdf", contentType: "application/pdf", sizeBytes: 1024 }],
        }),
        failingServices,
      ),
    ).rejects.toThrow("session store unavailable");
    expect(signed).toBe(false);
    expect(deleted).toBe(false);
  });

  it("records cleanup failure in the journal when normal session save is unavailable", async () => {
    const baseSessions = createMemoryMemberImportSessionStore();
    await baseSessions.save({
      sessionId: "save-failure-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/save-failure-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    const sessions: MemberCallableServices["sessions"] = {
      ...baseSessions,
      save: async () => {
        throw new Error("normal session store unavailable");
      },
    };
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        throw new Error("R2 unavailable");
      },
    });

    await cleanupExpiredMemberImportSessions(
      { r2, sessions, cleanupJournal },
      new Date("2026-08-11T12:00:00.000Z"),
    );

    await expect(cleanupJournal.get("save-failure-session")).resolves.toMatchObject({
      attempts: 1,
      status: "pending",
    });
  });

  it("fails closed when the durable cleanup claim cannot be persisted", async () => {
    const sessionStore = createMemoryMemberImportSessionStore();
    await sessionStore.save({
      sessionId: "claim-failure-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/claim-failure-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    let deleteCount = 0;
    const baseJournal = createMemoryMemberImportCleanupJournal();
    const cleanupJournal = {
      ...baseJournal,
      claim: async () => {
        throw new Error("journal unavailable");
      },
    };
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deleteCount += 1;
      },
    });

    await expect(
      cleanupExpiredMemberImportSessions(
        { r2, sessions: sessionStore, cleanupJournal },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).rejects.toThrow("journal unavailable");
    expect(deleteCount).toBe(0);
  });

  it("propagates a sanitized failure when listDue is unavailable", async () => {
    const sessionStore = createMemoryMemberImportSessionStore();
    await sessionStore.save({
      sessionId: "list-due-failure-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/list-due-failure-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    const baseJournal = createMemoryMemberImportCleanupJournal();
    const cleanupJournal = {
      ...baseJournal,
      listDue: async () => {
        throw new Error("firestore endpoint and credentials leaked");
      },
    };

    await expect(
      cleanupExpiredMemberImportSessions(
        {
          r2: services().r2,
          sessions: sessionStore,
          cleanupJournal,
        },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).rejects.toThrow("Member import cleanup journal unavailable");
  });

  it("fails closed when the claimed journal entry is missing", async () => {
    const sessionStore = createMemoryMemberImportSessionStore();
    await sessionStore.save({
      sessionId: "missing-journal-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/missing-journal-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    const baseJournal = createMemoryMemberImportCleanupJournal();
    const cleanupJournal = {
      ...baseJournal,
      get: async () => undefined,
    };
    let deleteCount = 0;
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deleteCount += 1;
      },
    });

    await expect(
      cleanupExpiredMemberImportSessions(
        { r2, sessions: sessionStore, cleanupJournal },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).rejects.toThrow("Member import cleanup journal invalid or missing");
    expect(deleteCount).toBe(0);
  });

  it("fails closed when the claimed journal entry is invalid", async () => {
    const sessionStore = createMemoryMemberImportSessionStore();
    await sessionStore.save({
      sessionId: "invalid-journal-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/invalid-journal-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    const baseJournal = createMemoryMemberImportCleanupJournal();
    const cleanupJournal = {
      ...baseJournal,
      get: async () => ({ invalid: true }) as never,
    };
    let deleteCount = 0;
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deleteCount += 1;
      },
    });

    await expect(
      cleanupExpiredMemberImportSessions(
        { r2, sessions: sessionStore, cleanupJournal },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).rejects.toThrow("Member import cleanup journal invalid or missing");
    expect(deleteCount).toBe(0);
  });

  it("persists the claim before a delete failure and records the result durably", async () => {
    const sessionStore = createMemoryMemberImportSessionStore();
    await sessionStore.save({
      sessionId: "delete-failure-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/delete-failure-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    const baseJournal = createMemoryMemberImportCleanupJournal();
    let claimObservedByDelete = false;
    const cleanupJournal = {
      ...baseJournal,
      claim: (baseJournal as unknown as MemberCallableServices["cleanupJournal"]).claim,
    };
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        const entry = await baseJournal.get("delete-failure-session");
        claimObservedByDelete =
          entry?.attempts === 1 &&
          entry.status === "running" &&
          entry.nextCleanupAt === "2026-08-11T12:01:00.000Z" &&
          entry.leaseId !== undefined;
        throw new Error("R2 unavailable");
      },
    });

    await cleanupExpiredMemberImportSessions(
      { r2, sessions: sessionStore, cleanupJournal },
      new Date("2026-08-11T12:00:00.000Z"),
    );

    expect(claimObservedByDelete).toBe(true);
    await expect(baseJournal.get("delete-failure-session")).resolves.toMatchObject({
      attempts: 1,
      status: "pending",
      nextCleanupAt: "2026-08-11T12:01:00.000Z",
    });
  });

  it("retains the durable running claim and backoff when recordFailure fails after delete", async () => {
    const sessionStore = createMemoryMemberImportSessionStore();
    await sessionStore.save({
      sessionId: "record-failure-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/record-failure-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    const baseJournal = createMemoryMemberImportCleanupJournal();
    let recordFailureCalls = 0;
    let deleteCount = 0;
    const cleanupJournal = {
      ...baseJournal,
      recordFailure: async (sessionId: string, leaseId: string, now: Date): Promise<void> => {
        recordFailureCalls += 1;
        if (recordFailureCalls === 1) throw new Error("journal write unavailable");
        await baseJournal.recordFailure(sessionId, leaseId, now);
      },
    };
    const sessions: MemberCallableServices["sessions"] = {
      ...sessionStore,
      remove: async () => {
        throw new Error("session remove unavailable");
      },
    };
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deleteCount += 1;
      },
    });

    await expect(
      cleanupExpiredMemberImportSessions(
        { r2, sessions, cleanupJournal },
        new Date("2026-08-11T12:00:00.000Z"),
      ),
    ).rejects.toThrow("Member import cleanup journal unavailable");
    await expect(baseJournal.get("record-failure-session")).resolves.toMatchObject({
      attempts: 1,
      status: "running",
      nextCleanupAt: "2026-08-11T12:01:00.000Z",
      leaseId: expect.any(String),
      leaseUntil: "2026-08-11T12:05:00.000Z",
    });

    await cleanupExpiredMemberImportSessions(
      { r2, sessions, cleanupJournal },
      new Date("2026-08-11T12:01:00.000Z"),
    );
    expect(deleteCount).toBe(1);

    await cleanupExpiredMemberImportSessions(
      { r2, sessions, cleanupJournal },
      new Date("2026-08-11T12:05:00.000Z"),
    );
    expect(deleteCount).toBe(2);
    await expect(baseJournal.get("record-failure-session")).resolves.toMatchObject({
      attempts: 2,
      status: "pending",
      nextCleanupAt: "2026-08-11T12:07:00.000Z",
    });
  });

  it("does not clean a session again while its backoff is in the future", async () => {
    const sessionStore = createMemoryMemberImportSessionStore();
    await sessionStore.save({
      sessionId: "backoff-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/backoff-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    let deleteCount = 0;
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deleteCount += 1;
        throw new Error("R2 unavailable");
      },
    });
    const cleanupServices = {
      r2,
      sessions: sessionStore,
      cleanupJournal: createMemoryMemberImportCleanupJournal(),
    };

    await cleanupExpiredMemberImportSessions(cleanupServices, new Date("2026-08-11T12:00:00.000Z"));
    await cleanupExpiredMemberImportSessions(cleanupServices, new Date("2026-08-11T12:00:30.000Z"));

    expect(deleteCount).toBe(1);
  });

  it("revalidates the cleanup time after claiming and before deleting", async () => {
    const sessionStore = createMemoryMemberImportSessionStore();
    await sessionStore.save({
      sessionId: "revalidation-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/revalidation-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    const baseJournal = createMemoryMemberImportCleanupJournal();
    const cleanupJournal = {
      ...baseJournal,
      claim: async (...args: Parameters<MemberCallableServices["cleanupJournal"]["claim"]>) => {
        const claimed = await (
          baseJournal as unknown as MemberCallableServices["cleanupJournal"]
        ).claim(...args);
        if (claimed) {
          await baseJournal.save({
            ...claimed,
            nextCleanupAt: "2026-08-11T13:00:00.000Z",
          });
        }
        return claimed;
      },
    };
    let deleteCount = 0;
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deleteCount += 1;
      },
    });

    await cleanupExpiredMemberImportSessions(
      { r2, sessions: sessionStore, cleanupJournal },
      new Date("2026-08-11T12:00:00.000Z"),
    );

    expect(deleteCount).toBe(0);
    await expect(baseJournal.get("revalidation-session")).resolves.toMatchObject({
      nextCleanupAt: "2026-08-11T13:00:00.000Z",
    });
  });

  it("allows only one concurrent cleanup claim for a session", async () => {
    const sessionStore = createMemoryMemberImportSessionStore();
    await sessionStore.save({
      sessionId: "concurrent-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/concurrent-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    let deleteCount = 0;
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        deleteCount += 1;
        await Promise.resolve();
      },
    });
    const cleanupServices = {
      r2,
      sessions: sessionStore,
      cleanupJournal: createMemoryMemberImportCleanupJournal(),
    };

    await Promise.all([
      cleanupExpiredMemberImportSessions(cleanupServices, new Date("2026-08-11T12:00:00.000Z")),
      cleanupExpiredMemberImportSessions(cleanupServices, new Date("2026-08-11T12:00:00.000Z")),
    ]);

    expect(deleteCount).toBe(1);
    await expect(sessionStore.get("concurrent-session")).resolves.toBeUndefined();
  });

  it("journals a remove failure and skips a terminal journal entry", async () => {
    const baseSessions = createMemoryMemberImportSessionStore();
    await baseSessions.save({
      sessionId: "remove-failure-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/remove-failure-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    await baseSessions.save({
      sessionId: "terminal-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/terminal-session/object.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 5,
      nextCleanupAt: "2026-08-11T12:00:00.000Z",
      cleanupStatus: "failed",
    });
    const sessions: MemberCallableServices["sessions"] = {
      ...baseSessions,
      remove: async (sessionId) => {
        if (sessionId === "remove-failure-session") throw new Error("remove unavailable");
        await baseSessions.remove(sessionId);
      },
    };
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    await cleanupJournal.save({
      sessionId: "terminal-session",
      objectKeys: ["academies/academy-1/member-imports/terminal-session/object.pdf"],
      attempts: 5,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      lastError: "R2 cleanup failed",
      status: "failed",
    });
    const deleted: string[] = [];
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async (objectKey) => {
        deleted.push(objectKey);
      },
    });

    await cleanupExpiredMemberImportSessions(
      { r2, sessions, cleanupJournal },
      new Date("2026-08-11T12:00:00.000Z"),
    );

    await expect(cleanupJournal.get("remove-failure-session")).resolves.toMatchObject({
      attempts: 1,
      status: "pending",
    });
    expect(deleted).toEqual([
      "academies/academy-1/member-imports/remove-failure-session/object.pdf",
    ]);
  });

  it("backs off cleanup failures and lets other sessions proceed", async () => {
    const sessionStore = createMemoryMemberImportSessionStore();
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    await sessionStore.save({
      sessionId: "failed-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/failed-session/session.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    await sessionStore.save({
      sessionId: "healthy-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/healthy-session/session.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    const deleted: string[] = [];
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async (objectKey) => {
        if (objectKey.includes("failed")) throw new Error("R2 unavailable");
        deleted.push(objectKey);
      },
    });

    await cleanupExpiredMemberImportSessions(
      { r2, sessions: sessionStore, cleanupJournal },
      new Date("2026-08-11T12:00:00.000Z"),
    );

    await expect(sessionStore.get("healthy-session")).resolves.toBeUndefined();
    await expect(cleanupJournal.get("failed-session")).resolves.toMatchObject({
      attempts: 1,
      nextCleanupAt: "2026-08-11T12:01:00.000Z",
      status: "pending",
      lastError: "R2 cleanup failed",
    });
    expect(deleted).toEqual(["academies/academy-1/member-imports/healthy-session/session.pdf"]);
  });

  it("stops cleanup after five attempts and records the failed state", async () => {
    const sessionStore = createMemoryMemberImportSessionStore();
    const cleanupJournal = createMemoryMemberImportCleanupJournal();
    await sessionStore.save({
      sessionId: "exhausted-session",
      academyId: "academy-1",
      objectKeys: ["academies/academy-1/member-imports/exhausted-session/session.pdf"],
      expiresAt: "2026-08-11T11:00:00.000Z",
      cleanupAttempts: 0,
      nextCleanupAt: "2026-08-11T11:00:00.000Z",
      cleanupStatus: "pending",
    });
    const r2 = createR2Client({
      bucket: "private-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
      signer: async () => "https://signed.example/upload",
      deleteObject: async () => {
        throw new Error("R2 unavailable");
      },
    });
    const retryTimes = [0, 1, 3, 7, 15].map(
      (minutes) => new Date(Date.parse("2026-08-11T12:00:00.000Z") + minutes * 60_000),
    );
    for (const retryTime of retryTimes) {
      await cleanupExpiredMemberImportSessions(
        { r2, sessions: sessionStore, cleanupJournal },
        retryTime,
      );
    }

    await expect(cleanupJournal.get("exhausted-session")).resolves.toMatchObject({
      attempts: 5,
      status: "failed",
      lastError: "R2 cleanup failed",
    });
    await cleanupExpiredMemberImportSessions(
      { r2, sessions: sessionStore, cleanupJournal },
      new Date("2026-08-11T13:00:00.000Z"),
    );
    await expect(cleanupJournal.get("exhausted-session")).resolves.toMatchObject({
      attempts: 5,
    });
  });

  it("exposes a fixed fifteen-minute scheduled cleanup trigger", () => {
    expect(cleanupExpiredMemberImportSessionsSchedule).toBeDefined();
  });
});
