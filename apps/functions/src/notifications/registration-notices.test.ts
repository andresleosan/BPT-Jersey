import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  classifyRegistrationNotice,
  initialNoticeState,
  noticeIdForAuditEvent,
  registrationNoticeHref,
  resolveRegistrationNotices,
} from "./registration-notices.js";

type Row = Record<string, unknown>;

function snapshot(id: string, row: Row | undefined) {
  return {
    id,
    exists: row !== undefined,
    data: () => row,
    get: (field: string) => row?.[field],
  };
}

/** Paths map to plain rows; audit events live under `academies/a/auditEvents/`. */
function fakeDb(rows: Record<string, Row>) {
  const ref = (path: string) => ({ path, get: async () => snapshot(path, rows[path]) });
  function query(prefix: string, field: string | null, value: unknown, limit: number) {
    return {
      where: (next: string, _op: string, nextValue: unknown) =>
        query(prefix, next, nextValue, limit),
      orderBy: () => query(prefix, field, value, limit),
      limit: (next: number) => query(prefix, field, value, next),
      get: async () => ({
        docs: Object.entries(rows)
          .filter(([path, row]) => path.startsWith(`${prefix}/`) && row[field!] === value)
          .sort(([, a], [, b]) => String(b.occurredAt).localeCompare(String(a.occurredAt)))
          .slice(0, limit)
          .map(([path, row]) => snapshot(path.slice(prefix.length + 1), row)),
      }),
    };
  }
  const db = {
    doc: ref,
    collection: (path: string) => query(path, null, null, Infinity),
    runTransaction: async (fn: (transaction: unknown) => Promise<void>) =>
      fn({
        get: async (target: { path: string }) => snapshot(target.path, rows[target.path]),
        update: (target: { path: string }, data: Row) => {
          rows[target.path] = { ...rows[target.path], ...data };
        },
      }),
  };
  return db as unknown as Firestore;
}

const T = "2026-10-23T10:00:00.000Z";
const AT = "2026-10-23T12:00:00.000Z";
const pathA = "academies/a/enrolmentRequests/rA";
const pathB = "academies/a/enrolmentRequests/rB";
const noticePath = (eventId: string) =>
  `academies/a/adminNotifications/${noticeIdForAuditEvent(eventId)}`;

describe("registration notices", () => {
  it("builds the request link only for actionable registration actions", () => {
    expect(
      registrationNoticeHref(
        "enrolment.request.submitted",
        "a",
        "academies/a/enrolmentRequests/r1",
        "/admin/members/requests",
      ),
    ).toBe("/admin/members/requests?request=r1");
    expect(
      registrationNoticeHref(
        "enrolment.request.approval.failed",
        "a",
        "academies/a/enrolmentRequests/r1",
        "/admin/members/requests",
      ),
    ).toBe("/admin/members/requests?request=r1");
    expect(
      registrationNoticeHref(
        "enrolment.request.approved",
        "a",
        "academies/a/enrolmentRequests/r1",
        "/admin/members/requests",
      ),
    ).toBe("/admin/members/requests");
    expect(
      registrationNoticeHref(
        "enrolment.request.submitted",
        "a",
        "academies/a/students/s1",
        "/admin/members/requests",
      ),
    ).toBe("/admin/members/requests");
    expect(
      registrationNoticeHref(
        "enrolment.request.submitted",
        "a",
        "academies/b/enrolmentRequests/r1",
        "/admin/members/requests",
      ),
    ).toBe("/admin/members/requests");
  });

  it("creates informational registration notices read and resolved", () => {
    for (const action of [
      "enrolment.request.approved",
      "enrolment.request.returned",
      "enrolment.request.withdrawn",
    ])
      expect(initialNoticeState({ action, createdAt: T, requestWaiting: null })).toEqual({
        readAt: T,
        resolvedAt: T,
      });
    expect(
      initialNoticeState({ action: "member.created", createdAt: T, requestWaiting: null }),
    ).toEqual({ readAt: null, resolvedAt: null });
  });

  it("creates an actionable notice resolved when the request is already decided", () => {
    expect(
      initialNoticeState({
        action: "enrolment.request.submitted",
        createdAt: T,
        requestWaiting: false,
      }),
    ).toEqual({ readAt: T, resolvedAt: T });
    expect(
      initialNoticeState({
        action: "enrolment.request.approval.failed",
        createdAt: T,
        requestWaiting: true,
      }),
    ).toEqual({ readAt: null, resolvedAt: null });
  });

  it("resolves only notices of the decided request path", async () => {
    const rows: Record<string, Row> = {
      "academies/a/auditEvents/e1": {
        action: "enrolment.request.submitted",
        targetRef: pathA,
        occurredAt: "1",
      },
      "academies/a/auditEvents/e2": {
        action: "enrolment.request.approval.failed",
        targetRef: pathA,
        occurredAt: "2",
      },
      "academies/a/auditEvents/e3": {
        action: "enrolment.request.submitted",
        targetRef: pathB,
        occurredAt: "3",
      },
      [noticePath("e1")]: { readAt: null, resolvedAt: null },
      [noticePath("e2")]: { readAt: T, resolvedAt: null },
      [noticePath("e3")]: { readAt: null, resolvedAt: null },
    };
    const count = await resolveRegistrationNotices(fakeDb(rows), {
      academyId: "a",
      targetRef: pathA,
      at: AT,
    });
    expect(count).toBe(2);
    expect(rows[noticePath("e1")]).toEqual({ readAt: AT, resolvedAt: AT });
    expect(rows[noticePath("e2")]).toEqual({ readAt: T, resolvedAt: AT });
    expect(rows[noticePath("e3")]).toEqual({ readAt: null, resolvedAt: null });
  });

  it("leaves already resolved and missing notices alone", async () => {
    const rows: Record<string, Row> = {
      "academies/a/auditEvents/e1": {
        action: "enrolment.request.submitted",
        targetRef: pathA,
        occurredAt: "1",
      },
      "academies/a/auditEvents/e2": {
        action: "enrolment.request.submitted",
        targetRef: pathA,
        occurredAt: "2",
      },
      [noticePath("e1")]: { readAt: T, resolvedAt: T },
    };
    const count = await resolveRegistrationNotices(fakeDb(rows), {
      academyId: "a",
      targetRef: pathA,
      at: AT,
    });
    expect(count).toBe(0);
    expect(rows[noticePath("e1")]).toEqual({ readAt: T, resolvedAt: T });
    expect(rows[noticePath("e2")]).toBeUndefined();
  });

  it("classifies backlog notices", () => {
    expect(
      classifyRegistrationNotice({
        title: "New registration awaiting approval",
        resolvedAt: null,
        requestWaiting: false,
      }),
    ).toBe("resolve");
    expect(
      classifyRegistrationNotice({
        title: "Registration approval needs attention",
        resolvedAt: null,
        requestWaiting: true,
      }),
    ).toBe("keep");
    for (const title of [
      "Registration approved",
      "Registration returned for changes",
      "Registration withdrawn",
    ])
      expect(classifyRegistrationNotice({ title, resolvedAt: null, requestWaiting: null })).toBe(
        "close-informational",
      );
    expect(
      classifyRegistrationNotice({
        title: "New registration awaiting approval",
        resolvedAt: T,
        requestWaiting: false,
      }),
    ).toBe("ignore");
    expect(
      classifyRegistrationNotice({ title: "Member added", resolvedAt: null, requestWaiting: null }),
    ).toBe("ignore");
  });
});
