import { describe, expect, it } from "vitest";

import { buildBookingId } from "@bpt-jersey/domain/schedule";
import {
  createBookingTransactionService,
  type BookingFirestore,
} from "./booking-transaction-service";
import { requestIntroBooking } from "./intro-booking-service";
import { isClassPaymentSettled } from "./payg-attendance";
import {
  bookPrivateLesson,
  cancelPrivateLessonBooking,
  type PrivateLessonBookingCommand,
} from "./private-lesson-booking-service";

const academyId = "academy-1";
const now = "2026-09-26T10:00:00.000Z";
const base = `academies/${academyId}`;
type Document = Record<string, unknown>;
type Filter = Readonly<{ field: string; value: unknown }>;

/**
 * Optimistic transactions like Firestore's: every transaction reads without waiting, and a commit
 * whose reads (documents or query results) changed underneath it is retried. Two bookings started
 * together therefore really race for the same credit.
 */
function createFirestore() {
  const records = new Map<string, { value: Document; version: number }>();
  let generated = 0;
  let clock = 0;
  const split = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const matches = (collectionPath: string, filters: readonly Filter[], maximum: number) =>
    [...records.entries()]
      .filter(
        ([path]) =>
          path.startsWith(`${collectionPath}/`) &&
          !path.slice(collectionPath.length + 1).includes("/"),
      )
      .filter(([, record]) => filters.every(({ field, value }) => record.value[field] === value))
      .slice(0, maximum);
  const query = (collectionPath: string, filters: readonly Filter[], maximum = Infinity) => ({
    collectionPath,
    filters,
    maximum,
    where(field: string, _operator: string, value: unknown) {
      return query(collectionPath, [...filters, { field, value }], maximum);
    },
    limit(count: number) {
      return query(collectionPath, filters, count);
    },
    doc(id?: string) {
      const documentId = id ?? `generated-${++generated}`;
      return { id: documentId, path: `${collectionPath}/${documentId}` };
    },
  });
  let commits = 0;
  let retries = 0;
  const firestore = {
    doc: (path: string) => ({ id: split(path), path }),
    collection: (path: string) => query(path, []),
    async runTransaction<T>(update: (transaction: never) => Promise<T>): Promise<T> {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const seen = new Map<string, number>();
        const queries: { key: string; run: () => string }[] = [];
        const writes: { path: string; value: Document; create: boolean }[] = [];
        const transaction = {
          async get(target: {
            path?: string;
            collectionPath?: string;
            filters?: readonly Filter[];
            maximum?: number;
          }) {
            await Promise.resolve();
            if (target.collectionPath) {
              const run = () =>
                matches(target.collectionPath!, target.filters ?? [], target.maximum ?? Infinity)
                  .map(([path, record]) => `${path}@${record.version}`)
                  .join(",");
              queries.push({ key: run(), run });
              const docs = matches(
                target.collectionPath,
                target.filters ?? [],
                target.maximum ?? Infinity,
              ).map(([path, record]) => ({
                id: split(path),
                exists: true,
                data: () => structuredClone(record.value),
              }));
              return { docs };
            }
            const record = records.get(target.path!);
            seen.set(target.path!, record?.version ?? 0);
            return {
              id: split(target.path!),
              exists: record !== undefined,
              data: () => (record ? structuredClone(record.value) : undefined),
            };
          },
          create(reference: { path: string }, value: Document) {
            writes.push({ path: reference.path, value, create: true });
          },
          set(reference: { path: string }, value: Document) {
            writes.push({ path: reference.path, value, create: false });
          },
        };
        const result = await update(transaction as never);
        const stale =
          [...seen].some(([path, version]) => (records.get(path)?.version ?? 0) !== version) ||
          queries.some((entry) => entry.run() !== entry.key) ||
          writes.some((write) => write.create && records.has(write.path));
        if (stale) {
          retries += 1;
          continue;
        }
        for (const write of writes) {
          records.set(write.path, { value: structuredClone(write.value), version: ++clock });
        }
        commits += 1;
        return result;
      }
      throw new Error("Transaction contention");
    },
  };
  return {
    db: firestore as unknown as BookingFirestore,
    seed(path: string, value: Document) {
      records.set(path, { value, version: ++clock });
    },
    get(path: string) {
      return records.get(path)?.value;
    },
    documents(collection: string) {
      return matches(collection, [], Infinity).map(([, record]) => record.value);
    },
    stats: () => ({ commits, retries }),
  };
}

function session(sessionId: string, over: Document = {}): Document {
  return {
    sessionId,
    academyId,
    status: "scheduled",
    startAt: "2026-09-28T18:00:00.000Z",
    endAt: "2026-09-28T19:00:00.000Z",
    capacity: 1,
    locationId: "town",
    programId: "program-1",
    accessMode: "private-lesson",
    ...over,
  };
}

function purchase(over: Document = {}): Document {
  return {
    academyId,
    purchaseId: "purchase-1",
    studentId: "student-1",
    accountUid: "member-uid",
    optionId: "single",
    priceMinor: 6500,
    creditsGranted: 1,
    creditsRemaining: 1,
    status: "approved",
    source: "member",
    method: "bank_transfer",
    proofId: "proof-1",
    bankReference: "BPT 1",
    submittedAt: "2026-09-01T10:00:00.000Z",
    decidedAt: "2026-09-01T12:00:00.000Z",
    decidedBy: "office-uid",
    decisionReason: null,
    expiresAt: "2026-12-01T12:00:00.000Z",
    invoiceId: "invoice-1",
    schemaVersion: "1",
    ...over,
  };
}

function setup(options: { credits?: number; expiresAt?: string } = {}) {
  const store = createFirestore();
  store.seed(`${base}/sessions/session-1`, session("session-1"));
  store.seed(
    `${base}/sessions/session-2`,
    session("session-2", {
      startAt: "2026-09-29T18:00:00.000Z",
      endAt: "2026-09-29T19:00:00.000Z",
    }),
  );
  store.seed(
    `${base}/sessions/regular`,
    session("regular", { accessMode: "membership", capacity: 20 }),
  );
  store.seed(`${base}/students/student-1`, {
    studentId: "student-1",
    academyId,
    fullName: "Synthetic Adult",
    active: true,
    status: "active",
  });
  store.seed(
    `${base}/privateLessonPurchases/purchase-1`,
    purchase({
      creditsRemaining: options.credits ?? 1,
      ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    }),
  );
  return store;
}

const office = (over: Partial<PrivateLessonBookingCommand> = {}): PrivateLessonBookingCommand => ({
  academyId,
  actorId: "office-uid",
  actorRole: "administrator",
  actorIp: null,
  studentId: "student-1",
  sessionId: "session-1",
  now,
  ...over,
});

describe("bookPrivateLesson", () => {
  it("confirms the booking and consumes one credit", async () => {
    const store = setup();
    const booking = await bookPrivateLesson(store.db, office());
    const bookingId = buildBookingId("session-1", "student-1");
    expect(booking).toMatchObject({
      bookingId,
      status: "confirmed",
      schemaVersion: "4",
      membershipId: null,
      source: { kind: "private-lesson", purchaseId: "purchase-1" },
      createdBy: "office-uid",
    });
    expect(store.get(`${base}/bookings/${bookingId}`)).toMatchObject({ status: "confirmed" });
    expect(store.get(`${base}/privateLessonPurchases/purchase-1`)).toMatchObject({
      creditsRemaining: 0,
    });
    expect(store.get(`${base}/privateLessonCreditUses/${bookingId}`)).toMatchObject({
      purchaseId: "purchase-1",
      studentId: "student-1",
      sessionId: "session-1",
      state: "consumed",
      consumedAt: now,
      restoredAt: null,
    });
  });

  it("refuses without a usable credit", async () => {
    const store = setup({ credits: 0 });
    await expect(bookPrivateLesson(store.db, office())).rejects.toThrow(
      "No private lesson credit available.",
    );
    const expired = setup({ expiresAt: "2026-09-25T00:00:00.000Z" });
    await expect(bookPrivateLesson(expired.db, office())).rejects.toThrow(
      "No private lesson credit available.",
    );
  });

  it("spends a single credit once when the office books two sessions at the same time", async () => {
    const store = setup();
    const results = await Promise.allSettled([
      bookPrivateLesson(store.db, office({ sessionId: "session-1" })),
      bookPrivateLesson(store.db, office({ sessionId: "session-2" })),
    ]);
    const confirmed = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result) => result.status === "rejected");
    expect(confirmed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason.message).toBe(
      "No private lesson credit available.",
    );
    expect(store.get(`${base}/privateLessonPurchases/purchase-1`)).toMatchObject({
      creditsRemaining: 0,
    });
    expect(store.documents(`${base}/privateLessonCreditUses`)).toHaveLength(1);
    expect(
      store.documents(`${base}/bookings`).filter((booking) => booking.status === "confirmed"),
    ).toHaveLength(1);
    // The race was real: one transaction had to retry after the other spent the credit.
    expect(store.stats().retries).toBeGreaterThan(0);
  });

  it("refuses a session that is not a private lesson", async () => {
    const store = setup();
    await expect(bookPrivateLesson(store.db, office({ sessionId: "regular" }))).rejects.toThrow(
      "This session is not a private lesson.",
    );
  });

  it("refuses a coach", async () => {
    const store = setup();
    await expect(
      bookPrivateLesson(store.db, office({ actorId: "coach-uid", actorRole: "coach" })),
    ).rejects.toMatchObject({ code: "tenant" });
    expect(store.documents(`${base}/bookings`)).toHaveLength(0);
  });

  it("records the human who booked in the class log", async () => {
    const store = setup();
    await bookPrivateLesson(store.db, office());
    const events = store.documents(`${base}/auditEvents`);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "booking.created",
      actorId: "office-uid",
      actorRole: "administrator",
    });
  });
});

describe("member booking routes", () => {
  it("refuse private lesson sessions on the membership route", async () => {
    const store = setup();
    const service = createBookingTransactionService({ firestore: store.db, now: () => now });
    await expect(
      service.requestBooking(
        academyId,
        { sessionId: "session-1", studentId: "student-1", membershipId: "membership-1" },
        "office-uid",
        { ip: null, role: "administrator" },
      ),
    ).rejects.toThrow("Private lessons are arranged by the office.");
  });

  it("refuse private lesson sessions on the intro route", async () => {
    const store = setup();
    await expect(
      requestIntroBooking(store.db, {
        academyId,
        actorId: "office-uid",
        actorRole: "administrator",
        actorIp: null,
        studentId: "student-1",
        sessionId: "session-1",
        now,
      }),
    ).rejects.toThrow("Private lessons are arranged by the office.");
  });

  it("refuse the generic cancellation of a private lesson booking", async () => {
    const store = setup();
    await bookPrivateLesson(store.db, office());
    const service = createBookingTransactionService({ firestore: store.db, now: () => now });
    await expect(
      service.cancelBooking(
        academyId,
        { sessionId: "session-1", studentId: "student-1", reason: "Changed plans" },
        "office-uid",
        true,
        { ip: null, role: "administrator" },
      ),
    ).rejects.toThrow("Private lessons are arranged by the office.");
    expect(store.get(`${base}/privateLessonPurchases/purchase-1`)).toMatchObject({
      creditsRemaining: 0,
    });
  });
});

describe("cancelPrivateLessonBooking", () => {
  const bookingId = buildBookingId("session-1", "student-1");
  const cancel = (over: Document = {}) => ({
    academyId,
    actorId: "office-uid",
    actorRole: "administrator" as const,
    actorIp: null,
    bookingId,
    reason: "Coach unavailable",
    now: "2026-09-27T10:00:00.000Z",
    ...over,
  });

  it("gives the credit back while the purchase is still valid", async () => {
    const store = setup();
    await bookPrivateLesson(store.db, office());
    const result = await cancelPrivateLessonBooking(store.db, cancel());
    expect(result.creditRestored).toBe(true);
    expect(result.booking).toMatchObject({
      status: "cancelled",
      cancellationReason: "Coach unavailable",
    });
    expect(store.get(`${base}/privateLessonPurchases/purchase-1`)).toMatchObject({
      creditsRemaining: 1,
    });
    expect(store.get(`${base}/privateLessonCreditUses/${bookingId}`)).toMatchObject({
      state: "restored",
      restoredAt: "2026-09-27T10:00:00.000Z",
    });
  });

  it("cancels but keeps the credit consumed once the purchase has expired", async () => {
    const store = setup({ expiresAt: "2026-09-27T00:00:00.000Z" });
    await bookPrivateLesson(store.db, office());
    const result = await cancelPrivateLessonBooking(store.db, cancel());
    expect(result.creditRestored).toBe(false);
    expect(result.booking.status).toBe("cancelled");
    expect(store.get(`${base}/bookings/${bookingId}`)).toMatchObject({ status: "cancelled" });
    expect(store.get(`${base}/privateLessonPurchases/purchase-1`)).toMatchObject({
      creditsRemaining: 0,
    });
    expect(store.get(`${base}/privateLessonCreditUses/${bookingId}`)).toMatchObject({
      state: "consumed",
      restoredAt: null,
    });
  });

  it("does not restore twice when the cancellation is repeated", async () => {
    const store = setup();
    await bookPrivateLesson(store.db, office());
    await cancelPrivateLessonBooking(store.db, cancel());
    const again = await cancelPrivateLessonBooking(store.db, cancel());
    expect(again.booking.status).toBe("cancelled");
    expect(store.get(`${base}/privateLessonPurchases/purchase-1`)).toMatchObject({
      creditsRemaining: 1,
    });
  });

  it("refuses a coach", async () => {
    const store = setup();
    await bookPrivateLesson(store.db, office());
    await expect(
      cancelPrivateLessonBooking(store.db, cancel({ actorId: "coach-uid", actorRole: "coach" })),
    ).rejects.toMatchObject({ code: "tenant" });
  });

  it("records the human who cancelled in the class log", async () => {
    const store = setup();
    await bookPrivateLesson(store.db, office());
    await cancelPrivateLessonBooking(store.db, cancel());
    const events = store.documents(`${base}/auditEvents`);
    expect(events.map((event) => event.action)).toEqual(["booking.created", "booking.cancelled"]);
    expect(events[1]).toMatchObject({ actorId: "office-uid" });
  });
});

describe("attendance", () => {
  it("treats a private lesson booking as paid, so the coach can take attendance", async () => {
    const booking = {
      id: "b",
      exists: true,
      data: () => ({ status: "confirmed", schemaVersion: "4" }),
    };
    await expect(
      isClassPaymentSettled({} as never, {} as never, academyId, "session-1", [booking]),
    ).resolves.toBe(true);
  });
});
