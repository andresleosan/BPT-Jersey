import { beforeEach, describe, expect, it, vi } from "vitest";

type Data = Record<string, unknown>;

const store = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  /** Every write in order: `create <path>`, `update <path>` or `delete <path>`. */
  const log: string[] = [];
  let autoId = 0;
  const read = (data: Record<string, unknown> | undefined, field: string): unknown =>
    field
      .split(".")
      .reduce<unknown>(
        (value, key) =>
          value !== null && typeof value === "object"
            ? (value as Record<string, unknown>)[key]
            : undefined,
        data,
      );
  const ref = (path: string) => ({
    path,
    id: path.split("/").at(-1)!,
    get: async () => snapshot(path),
  });
  const snapshot = (path: string) => {
    const data = docs.get(path);
    return {
      id: path.split("/").at(-1)!,
      ref: ref(path),
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => read(data, field),
    };
  };
  type Filter = [field: string, op: string, value: unknown];
  const query = (collection: string, filters: Filter[] = [], limit = Infinity) => ({
    where: (field: string, op: string, value: unknown) =>
      query(collection, [...filters, [field, op, value]], limit),
    limit: (count: number) => query(collection, filters, count),
    doc: (id?: string) => ref(`${collection}/${id ?? `auto-${(autoId += 1)}`}`),
    get: async () => {
      const found = [...docs.keys()]
        .filter((path) => path.startsWith(`${collection}/`))
        .filter((path) => !path.slice(collection.length + 1).includes("/"))
        .sort()
        .map(snapshot)
        .filter((document) =>
          filters.every(([field, op, value]) => {
            const actual = document.get(field);
            if (op === "==") return actual === value;
            if (op === "array-contains") return Array.isArray(actual) && actual.includes(value);
            throw new Error(`Unsupported operator ${op}`);
          }),
        )
        .slice(0, limit);
      return { docs: found, size: found.length, empty: found.length === 0 };
    },
  });
  type Ref = ReturnType<typeof ref>;
  const write = {
    create(target: Ref, data: Record<string, unknown>) {
      if (docs.has(target.path)) throw new Error(`Already exists: ${target.path}`);
      docs.set(target.path, data);
      log.push(`create ${target.path}`);
    },
    update(target: Ref, data: Record<string, unknown>) {
      const current = docs.get(target.path);
      if (!current) throw new Error(`No document to update: ${target.path}`);
      docs.set(target.path, { ...current, ...data });
      log.push(`update ${target.path}`);
    },
    delete(target: Ref) {
      docs.delete(target.path);
      log.push(`delete ${target.path}`);
    },
  };
  /** Paths whose 30-day copy the backup writer refuses. */
  const uncopyable = new Set<string>();
  const firestore = {
    doc: ref,
    collection: (path: string) => query(path),
    getAll: async (...refs: Ref[]) => refs.map((target) => snapshot(target.path)),
    // Like a BulkWriter: writes commit in parallel, so a delete can land before a copy queued
    // earlier (here copies land a macrotask after deletes); a failed write shows only in its own
    // promise, and close() waits for every write without failing.
    bulkWriter: () => {
      const pending: Promise<unknown>[] = [];
      const queue = (apply: () => void, slow: boolean) => {
        const written = new Promise<void>((resolve, reject) => {
          const run = () => {
            try {
              apply();
              resolve();
            } catch (error) {
              reject(error);
            }
          };
          if (slow) setTimeout(run, 0);
          else queueMicrotask(run);
        });
        pending.push(written.catch(() => undefined));
        return written;
      };
      return {
        create: (target: Ref, data: Record<string, unknown>) =>
          queue(() => {
            if (uncopyable.has(String(data.path))) throw new Error(`Copy refused: ${data.path}`);
            write.create(target, data);
          }, true),
        delete: (target: Ref) => queue(() => write.delete(target), false),
        close: async () => {
          await Promise.all(pending);
        },
      };
    },
    runTransaction: async <T>(callback: (transaction: unknown) => Promise<T>) =>
      callback({
        get: (target: { get: () => Promise<unknown> }) => target.get(),
        ...write,
      }),
  };
  return {
    docs,
    log,
    uncopyable,
    firestore,
    reset() {
      docs.clear();
      log.length = 0;
      uncopyable.clear();
      autoId = 0;
    },
  };
});

const auth = vi.hoisted(() => ({
  getUser: async (uid: string) => ({ uid, customClaims: { role: "adultStudent" } }),
  deleteUser: async () => undefined,
}));

vi.mock("firebase-admin/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase-admin/firestore")>()),
  getFirestore: () => store.firestore,
}));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => auth }));
// The real cancellation lives in the booking transaction; this stand-in writes what it leaves
// behind for a member: the cancelled booking and the exclusion that stops a group re-booking.
vi.mock("../schedule/schedule-service.js", () => ({
  createFirestoreScheduleStore: () => ({
    cancelBooking: async (
      academyId: string,
      input: { sessionId: string; studentId: string; reason: string },
    ) => {
      const root = `academies/${academyId}`;
      const bookingPath = `${root}/bookings/${input.sessionId}__${input.studentId}`;
      store.docs.set(bookingPath, { ...store.docs.get(bookingPath), status: "cancelled" });
      store.docs.set(`${root}/groupSessionExclusions/${input.sessionId}__${input.studentId}`, {
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
      });
    },
  }),
}));

import { deleteMemberAccountHandler } from "./member-delete-callables.js";

const academy = "academies/academy-1";
const owner = { academyId: "academy-1", userId: "owner-1", role: "owner" };
const input = { studentId: "member-1", requestId: "8f0e5c1a-3b2d-4c5e-9f60-718293a4b5c6" };

function seed(path: string, data: Data) {
  store.docs.set(`${academy}/${path}`, { academyId: "academy-1", ...data });
}

/** Records keyed like the ones the delete used to miss, one set per member. */
function seedMissedRecords(studentId: string, login: string, familyId: string) {
  const owned = { studentId };
  seed(`adminNotifications/notice-${studentId}`, { ...owned, membershipId: null });
  seed(`groupSessionExclusions/session-past__${studentId}`, owned);
  seed(`groupRegistrationResults/group-1__session-past__${studentId}`, owned);
  seed(`bookingQuotaStates/v2-${studentId}-2026-10-12`, owned);
  seed(`waitlistEntries/session-full__${studentId}`, { ...owned, status: "waiting" });
  seed(`waitlistClassInvitations/operation-1-${studentId}`, owned);
  seed(`waitlistInvitationHistory/history-${studentId}`, owned);
  seed(`assessments/evaluation-${studentId}`, owned);
  seed(`medicalLeaves/leave_${studentId}_1`, owned);
  seed(`levelPromotions/graduation-${studentId}`, owned);
  seed(`levelHistoryEdits/edit-${studentId}`, owned);
  seed(`attendanceVoids/session-past__${studentId}`, owned);
  seed(`introConversionIssues/intro-${studentId}`, owned);
  seed(`memberPlanRequests/approved-${studentId}`, { ...owned, requestedBy: "guardian-9" });
  seed(`memberPlanRequests/pending-by-${login}`, { studentId: null, requestedBy: login });
  seed(`healthProfileChangeRequests/health-request-${studentId}`, owned);
  seed(`retentionAlerts/alert-${studentId}`, owned);
  seed(`healthProfiles/${studentId}`, owned);
  seed(`teenAccess/${studentId}`, { ...owned, uid: login });
  seed(`membershipAdministration/membership-${studentId}`, {
    invoiceId: null,
    complimentary: true,
  });
  seed(`memberNotifications/intro-${login}`, { recipientUid: login });
  seed(`voidedPayments/voided-${familyId}`, { payment: { paymentId: "p", familyId } });
}

/** Records the delete already covered before 2026-10-22. */
function seedCoveredRecords(studentId: string, login: string, familyId: string) {
  seed(`students/${studentId}`, { studentId, userId: login, familyId });
  seed(`bookings/session-future__${studentId}`, {
    studentId,
    sessionId: "session-future",
    status: "confirmed",
  });
  seed(`memberships/membership-${studentId}`, { studentId });
  seed(`attendance/session-past__${studentId}`, { studentId });
  seed(`studentAdminProfiles/${studentId}`, { studentId });
  seed(`studentIdentityKeys/key-${studentId}`, { ownerStudentId: studentId });
  seed(`families/${familyId}`, { familyId });
  seed(`invoices/invoice-${familyId}`, { familyId });
  seed(`payments/payment-${familyId}`, { familyId });
  seed(`users/${login}`, { userId: login });
}

/** Audit, evidence, receipts, control-plane state and shared records that name member-1. */
function seedKeptRecords() {
  const named = { studentId: "member-1" };
  seed("auditEvents/event-old", { targetRef: `${academy}/students/member-1` });
  seed("progressChanges/change-1", { ...named, by: "owner-1", summary: "Added a class" });
  seed("memberManualAttendance/manual-member-1", { ...named, date: "2026-10-02" });
  seed("checkouts/session-past__member-1", { ...named, authorizedAdultName: "Synthetic" });
  seed("consents/consent-member-1", { subjectId: "member-1", evidenceDocumentId: "waiver-1" });
  seed("documents/waiver-1", { ...named, kind: "waiver", sha256: "0".repeat(64) });
  seed("memberDirectoryWriteReceipts/receipt-1", named);
  seed("memberDirectoryCursorStates/cursor-1", named);
  seed("memberDirectoryStates/current", { stateRevision: 7 });
  seed("memberDirectoryRestoreGuards/current", { lastEventId: "event-1" });
  seed("profileWriteReceipts/profile-receipt-1", named);
  seed("familyWriteReceipts/family-receipt-1", { familyId: "family-1" });
  seed("levelProgressMigrationReceipts/member-1", named);
  seed("levelProgressMigrationAudits/audit-1", named);
  seed("membershipChanges/request-1", { result: { studentId: "member-1" } });
  seed("paymentVoidReceipts/void-1", { result: { familyId: "family-1" } });
  seed("memberGuardianDecisions/decision-1", named);
  seed("memberMigrationDecisions/legacy-1", named);
  seed("sessionCapacityStates/session-future", { sessionId: "session-future" });
  seed("leaderboards/adults", { entries: [{ studentId: "member-1" }] });
  seed("memberGroups/group-1", { studentIds: ["member-1", "member-2"], revision: 1 });
}

const backups = () =>
  [...store.docs.entries()]
    .filter(([path]) => path.startsWith(`${academy}/deletedMemberBackups/`))
    .map(([, backup]) => backup as { path: string; data: Data; studentId: string });

/** Every document stored under `academies/academy-1` whose path contains `fragment`. */
const pathsWith = (fragment: string) =>
  [...store.docs.keys()].filter(
    (path) => path.includes(fragment) && !path.includes("/deletedMemberBackups/"),
  );

beforeEach(() => {
  store.reset();
  seedMissedRecords("member-1", "login-1", "family-1");
  seedCoveredRecords("member-1", "login-1", "family-1");
  seedMissedRecords("member-2", "login-2", "family-2");
  seedCoveredRecords("member-2", "login-2", "family-2");
  seedKeptRecords();
  // Sent by member-1's login but it created member-2: it stays with member-2.
  seed("memberPlanRequests/request-member-2-from-first-login", {
    studentId: "member-2",
    requestedBy: "login-1",
  });
});

describe("deleteMemberAccountHandler", () => {
  it("backs up, then deletes, every record the member owns", async () => {
    const before = new Map(store.docs);
    const owned = [...before.keys()].filter(
      (path) => /member-1|login-1|family-1/u.test(path) && !isKept(path),
    );
    // Written by the cancellation of the future booking, after the delete started.
    const exclusion = `${academy}/groupSessionExclusions/session-future__member-1`;

    await expect(deleteMemberAccountHandler(owner, input, null)).resolves.toEqual({
      studentId: "member-1",
      cancelledBookings: 1,
      removedMemberships: 1,
    });

    const copies = backups();
    expect(copies.map((copy) => copy.path).sort()).toEqual([...owned, exclusion].sort());
    for (const copy of copies) {
      expect(copy.studentId).toBe("member-1");
      if (copy.path !== exclusion && !copy.path.includes("/bookings/"))
        expect(copy.data).toEqual(before.get(copy.path));
    }
    for (const path of [...owned, exclusion]) expect(store.docs.has(path)).toBe(false);
    const order = store.log.map((entry) =>
      entry.startsWith("delete ")
        ? "delete"
        : entry.includes("/deletedMemberBackups/")
          ? "copy"
          : "",
    );
    expect(order.indexOf("copy")).toBeGreaterThan(-1);
    expect(order.lastIndexOf("copy")).toBeLessThan(order.indexOf("delete"));
    // The member's own record goes last, so a run that stops half-way can run again.
    expect(store.log.filter((entry) => entry.startsWith("delete ")).at(-1)).toBe(
      `delete ${academy}/students/member-1`,
    );
    expect(pathsWith("/auditEvents/").map((path) => store.docs.get(path)?.action)).toContain(
      "member.account.deleted",
    );
  });

  it("deletes nothing when a 30-day copy fails, and a second run finishes", async () => {
    const owned = [...store.docs.keys()].filter(
      (path) => /member-1|login-1|family-1/u.test(path) && !isKept(path),
    );
    store.uncopyable.add(`${academy}/adminNotifications/notice-member-1`);

    await expect(deleteMemberAccountHandler(owner, input, null)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(store.log.filter((entry) => entry.startsWith("delete "))).toEqual([]);
    for (const path of owned) expect(store.docs.has(path)).toBe(true);

    store.uncopyable.clear();
    await expect(deleteMemberAccountHandler(owner, input, null)).resolves.toMatchObject({
      studentId: "member-1",
    });
    for (const path of owned) expect(store.docs.has(path)).toBe(false);
  });

  it("keeps audit and evidence records, receipts, control-plane state and records shared with others", async () => {
    const kept = [...store.docs.entries()].filter(([path]) => isKept(path));

    await deleteMemberAccountHandler(owner, input, null);

    const copied = new Set(backups().map((copy) => copy.path));
    for (const [path, data] of kept) {
      expect(copied.has(path)).toBe(false);
      if (path.endsWith("/memberGroups/group-1"))
        expect(store.docs.get(path)).toMatchObject({ studentIds: ["member-2"], revision: 2 });
      else expect(store.docs.get(path)).toEqual(data);
    }
    // The same run did delete what the member owns in the collections it used to miss.
    expect(copied).toContain(`${academy}/adminNotifications/notice-member-1`);
    expect(store.docs.has(`${academy}/adminNotifications/notice-member-1`)).toBe(false);
  });

  it("leaves another member's records untouched", async () => {
    const others = [...store.docs.entries()].filter(([path]) =>
      /member-2|login-2|family-2/u.test(path),
    );
    expect(others.length).toBeGreaterThan(30);

    await deleteMemberAccountHandler(owner, input, null);

    const copied = new Set(backups().map((copy) => copy.path));
    for (const [path, data] of others) {
      expect(copied.has(path)).toBe(false);
      expect(store.docs.get(path)).toEqual(data);
    }
    expect(store.docs.has(`${academy}/healthProfiles/member-1`)).toBe(false);
    expect(store.docs.has(`${academy}/medicalLeaves/leave_member-1_1`)).toBe(false);
  });

  it("keeps what the login sent or received, and the family billing, while someone else uses them", async () => {
    seed("students/member-3", { studentId: "member-3", userId: "login-1", familyId: "family-1" });
    const shared = [
      `${academy}/users/login-1`,
      `${academy}/memberNotifications/intro-login-1`,
      `${academy}/memberPlanRequests/pending-by-login-1`,
      `${academy}/families/family-1`,
      `${academy}/invoices/invoice-family-1`,
      `${academy}/payments/payment-family-1`,
      `${academy}/voidedPayments/voided-family-1`,
    ];

    await deleteMemberAccountHandler(owner, input, null);

    for (const path of shared) expect(store.docs.has(path)).toBe(true);
    // Records keyed by the member itself still go.
    expect(store.docs.has(`${academy}/memberPlanRequests/approved-member-1`)).toBe(false);
    expect(store.docs.has(`${academy}/teenAccess/member-1`)).toBe(false);
  });
});

function isKept(path: string): boolean {
  return [
    "/auditEvents/",
    "/progressChanges/",
    "/memberManualAttendance/",
    "/checkouts/",
    "/consents/",
    "/documents/",
    "/memberDirectoryWriteReceipts/",
    "/memberDirectoryCursorStates/",
    "/memberDirectoryStates/",
    "/memberDirectoryRestoreGuards/",
    "/profileWriteReceipts/",
    "/familyWriteReceipts/",
    "/levelProgressMigrationReceipts/",
    "/levelProgressMigrationAudits/",
    "/membershipChanges/",
    "/paymentVoidReceipts/",
    "/memberGuardianDecisions/",
    "/memberMigrationDecisions/",
    "/sessionCapacityStates/",
    "/leaderboards/",
    "/memberGroups/",
  ].some((fragment) => path.includes(fragment));
}
