import { beforeEach, describe, expect, it } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import { parseAuditEventDraft, type AuditEventDraft } from "@bpt-jersey/domain/audit";
import type { UserRole } from "@bpt-jersey/domain";

import {
  handleExportClassHistoryPdf,
  handleListClassHistory,
  type ClassHistoryCallableServices,
} from "./class-history-callables.js";
import type { ClassHistoryStore, ClassHistoryStoredEvent } from "./class-history-service.js";

const academyId = "demo-academy";

const bookingEvent: ClassHistoryStoredEvent = {
  id: "event-1",
  occurredAt: "2026-09-16T10:00:00.000Z",
  action: "booking.created",
  actorId: "student-1",
  actorRole: "adultStudent",
  actorGroup: "member",
  actorName: null,
  actorIp: "82.112.144.10",
  source: "bpt",
  class: {
    studentId: "student-1",
    memberId: null,
    studentName: null,
    sessionId: "session-1",
    sessionStartAt: "2026-09-16T17:30:00.000Z",
    programId: "program-1",
    locationId: "location-1",
  },
};

type TestServices = ClassHistoryCallableServices & {
  auditedActions: string[];
  auditedDrafts: AuditEventDraft[];
};

function store(overrides: Partial<ClassHistoryStore> = {}): ClassHistoryStore {
  return {
    queryEvents: async () => [bookingEvent],
    readStudents: async () => new Map([["student-1", "Ana Silva"]]),
    readSessions: async () =>
      new Map([
        [
          "session-1",
          {
            startAt: "2026-09-16T17:30:00.000Z",
            programId: "program-1",
            programName: "Adults Gi",
          },
        ],
      ]),
    readStaffNames: async () => new Map<string, string>(),
    readMemberNames: async () => new Map([["student-1", "Ana Silva"]]),
    readDirectoryMemberNames: async () => new Map<string, string>(),
    ...overrides,
  };
}

function services(overrides: Partial<ClassHistoryStore> = {}): TestServices {
  const auditedActions: string[] = [];
  const auditedDrafts: AuditEventDraft[] = [];
  return {
    storeFor: () => store(overrides),
    recordRead: async (draft) => {
      auditedActions.push(draft.action);
      auditedDrafts.push(draft);
    },
    now: () => "2026-09-17T09:00:00.000Z",
    correlationId: () => "class-history-test",
    auditedActions,
    auditedDrafts,
  };
}

function request(role: UserRole | undefined, data: unknown): CallableRequest<unknown> {
  return {
    data,
    rawRequest: {} as CallableRequest<unknown>["rawRequest"],
    auth: role === undefined ? undefined : { uid: `${role}-1`, token: { academyId, role } },
  } as unknown as CallableRequest<unknown>;
}

const data = {
  academyId,
  since: "2026-09-01T00:00:00.000Z",
  registrationType: "all",
  limit: 200,
};

let current: TestServices;
let adminRequest: CallableRequest<unknown>;
let coachRequest: CallableRequest<unknown>;

beforeEach(() => {
  current = services();
  adminRequest = request("administrator", data);
  coachRequest = request("coach", data);
});

describe("handleListClassHistory", () => {
  it("returns the rows an administrator asked for", async () => {
    const page = await handleListClassHistory(current, adminRequest);
    expect(page.total).toBe(1);
    expect(page.rows[0]?.sentence).toBe("Ana Silva booked the class of 16 Sep 2026 at 18:30");
  });

  it("refuses a caller who is not an administrator", async () => {
    await expect(handleListClassHistory(current, coachRequest)).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("refuses another academy", async () => {
    await expect(
      handleListClassHistory(current, request("administrator", { ...data, academyId: "other" })),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects a since value that is not a timestamp", async () => {
    await expect(
      handleListClassHistory(current, request("administrator", { ...data, since: "yesterday" })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("rejects a registration type outside the enum", async () => {
    await expect(
      handleListClassHistory(
        current,
        request("administrator", { ...data, registrationType: "everything" }),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("rejects a limit that is not a whole number", async () => {
    await expect(
      handleListClassHistory(current, request("administrator", { ...data, limit: 12.5 })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      handleListClassHistory(current, request("administrator", { ...data, limit: "200" })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("leaves the range to the service instead of clamping it here", async () => {
    let requestedLimit = 0;
    const clamped = services({
      queryEvents: async (query) => {
        requestedLimit = query.limit;
        return [];
      },
    });
    await handleListClassHistory(clamped, request("administrator", { ...data, limit: 5000 }));
    expect(requestedLimit).toBe(1000);
  });

  it("hides the recorded address from an administrator", async () => {
    const page = await handleListClassHistory(current, adminRequest);
    expect(page.rows[0]?.actorIp).toBeNull();
  });

  it("shows the recorded address to the owner", async () => {
    const page = await handleListClassHistory(current, request("owner", data));
    expect(page.rows[0]?.actorIp).toBe("82.112.144.10");
  });

  it("records the read in the audit ledger", async () => {
    await handleListClassHistory(current, adminRequest);
    expect(current.auditedActions).toEqual(["class.history.read"]);
    expect(current.auditedDrafts[0]).toMatchObject({
      academyId,
      actorId: "administrator-1",
      purpose: "class-history-read",
      targetRef: `academies/${academyId}/studentRestrictedReadLimits/administrator-1`,
      result: "completed",
    });
  });

  it("writes a draft the audit ledger accepts", async () => {
    await handleListClassHistory(current, adminRequest);
    const draft = current.auditedDrafts[0];
    expect(draft === undefined ? null : parseAuditEventDraft(draft)).toMatchObject({ ok: true });
  });

  it("records a failed read as unavailable and hides the cause", async () => {
    const broken = services({
      queryEvents: async () => {
        throw new Error("index missing for academies/demo-academy/auditEvents");
      },
    });
    await expect(handleListClassHistory(broken, adminRequest)).rejects.toMatchObject({
      code: "unavailable",
      message: "The class history is unavailable",
    });
    expect(broken.auditedDrafts[0]).toMatchObject({ result: "unavailable" });
  });

  it("does not audit a read it refused", async () => {
    await expect(handleListClassHistory(current, coachRequest)).rejects.toThrow();
    expect(current.auditedActions).toEqual([]);
  });
});

describe("handleExportClassHistoryPdf", () => {
  it("returns the PDF as base64 with a dated file name", async () => {
    const result = await handleExportClassHistoryPdf(current, adminRequest);
    expect(result.fileName).toBe("class-history-2026-09-17.pdf");
    expect(result.pdfBase64.length).toBeGreaterThan(100);
    expect(Buffer.from(result.pdfBase64, "base64").subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });

  it("refuses a caller who is not an administrator", async () => {
    await expect(handleExportClassHistoryPdf(current, coachRequest)).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("audits the export as the same restricted read", async () => {
    await handleExportClassHistoryPdf(current, adminRequest);
    expect(current.auditedActions).toEqual(["class.history.read"]);
  });
});
