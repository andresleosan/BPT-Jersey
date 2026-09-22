import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { buildBookingId, type BookingRecord } from "@bpt-jersey/domain/schedule";
import type { R2Client } from "../storage/r2-client.js";

/**
 * The finance store owns its own Firestore transactions; these tests cover the PAYG booking
 * decisions around it, so the store is a recorder, exactly as the finance callable tests do.
 */
const finance = vi.hoisted(() => ({
  /** Set by `fakeFirestore`, so the mocked store persists into the same documents the code reads. */
  docs: new Map<string, Record<string, unknown>>(),
  issued: [] as Record<string, string | number>[],
  voided: [] as Record<string, string>[],
  seq: 0,
}));

vi.mock("../finance/finance-service.js", () => ({
  createFinanceStore: () => ({
    issuePaygInvoice: async (input: Record<string, string | number>) => {
      finance.issued.push(input);
      const root = `academies/${input.academyId}`;
      // The real store returns whatever invoice already holds this reference, void or not.
      for (const [path, value] of finance.docs) {
        if (path.startsWith(`${root}/invoices/`) && value.invoiceReference === input.invoiceReference) {
          return value;
        }
      }
      finance.seq += 1;
      const stamp = "2026-09-22T09:00:00.000Z";
      const invoice = {
        invoiceId: `invoice-${finance.seq}`,
        academyId: input.academyId,
        familyId: input.familyId,
        membershipId: input.membershipId,
        status: "open",
        totalMinor: input.totalMinor,
        currency: "GBP",
        dueAt: input.dueAt,
        paidAt: null,
        schemaVersion: 1,
        createdAt: stamp,
        createdBy: input.actorId,
        updatedAt: stamp,
        updatedBy: input.actorId,
        chargeKind: "payg_session",
        sourceRef: input.sourceRef,
        invoiceReference: input.invoiceReference,
        description: input.description,
      };
      finance.docs.set(`${root}/invoices/${invoice.invoiceId}`, invoice);
      return invoice;
    },
    voidManualInvoice: async (input: Record<string, string>) => {
      finance.voided.push(input);
      const path = `academies/${input.academyId}/invoices/${input.invoiceId}`;
      const voided = { ...finance.docs.get(path), status: "void" };
      finance.docs.set(path, voided);
      return voided;
    },
  }),
}));

import { attachPaygBookingPayment, voidUnpaidPaygInvoice } from "./payg-booking-payment";
import { paygProofKey } from "./payg-class-payment";

type Doc = Record<string, unknown>;

function fakeFirestore(initial: Record<string, Doc>, reads: string[]) {
  const records = new Map(Object.entries(initial));
  finance.docs = records;
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const query = (path: string, filters: { field: string; value: unknown }[] = []) => ({
    where(field: string, _operator: string, value: unknown) {
      return query(path, [...filters, { field, value }]);
    },
    async get() {
      const docs = [...records.entries()]
        .filter(
          ([key, value]) =>
            parentOf(key) === path && filters.every(({ field, value: expected }) => value[field] === expected),
        )
        .map(([key, value]) => ({ id: idOf(key), exists: true, data: () => value }));
      return { docs, size: docs.length };
    },
  });
  const db = {
    doc(path: string) {
      return {
        id: idOf(path),
        path,
        async get() {
          const value = records.get(path);
          return {
            id: idOf(path),
            exists: value !== undefined,
            data: () => value,
            get: (field: string) => value?.[field],
          };
        },
        async update(patch: Doc) {
          reads.push(`update:${path}`);
          const value = records.get(path);
          if (value === undefined) throw new Error("missing document");
          records.set(path, { ...value, ...patch });
        },
      };
    },
    collection(path: string) {
      return query(path);
    },
  };
  return { db: db as unknown as Firestore, records };
}

function fakeStorage(objects: Record<string, Uint8Array>, reads: string[]): R2Client {
  return {
    readObject: async (objectKey: string) => {
      reads.push(`read:${objectKey}`);
      const value = objects[objectKey];
      if (!value) throw new Error("not found");
      return value;
    },
    putObject: async () => undefined,
    deleteObject: async () => undefined,
    createPdfUploadUrl: async () => "https://example.invalid/upload",
    createPdfDownloadUrl: async () => "https://example.invalid/download",
  } as unknown as R2Client;
}

const academyId = "academy-1";
const actorId = "user-1";
const now = "2026-09-20T08:00:00.000Z";
const sessionStart = "2026-09-25T18:00:00.000Z";
const root = `academies/${academyId}`;
const sourceRef = `${root}/sessions/session-1`;
const bookingId = buildBookingId("session-1", "student-1");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const proofId = createHash("sha256").update(png).digest("hex");

function planDoc(planId: string) {
  const plan = PLAN_CATALOG.find((item) => item.planId === planId)!;
  return {
    ...plan,
    academyId,
    active: true,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "admin-1",
    updatedAt: now,
    updatedBy: "admin-1",
  };
}

function membershipDoc(planId: string) {
  return {
    membershipId: "membership-1",
    academyId,
    familyId: "family-1",
    studentId: "student-1",
    planId,
    status: "active",
    startsAt: now,
    endsAt: null,
    nextBillingAt: null,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "admin-1",
    updatedAt: now,
    updatedBy: "admin-1",
  };
}

const booking = Object.freeze({
  bookingId,
  academyId,
  sessionId: "session-1",
  studentId: "student-1",
  membershipId: "membership-1",
  status: "confirmed",
  requestedAt: now,
  cancelledAt: null,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: now,
  createdBy: actorId,
  updatedAt: now,
  updatedBy: actorId,
}) as BookingRecord;

function seed(planId: string) {
  return {
    [`${root}/memberships/membership-1`]: membershipDoc(planId),
    [`${root}/plans/${planId}`]: planDoc(planId),
    [`${root}/sessions/session-1`]: { sessionId: "session-1", academyId, startAt: sessionStart },
    [`${root}/bookings/${bookingId}`]: { ...booking } as Doc,
  };
}

function invoiceDoc(overrides: Doc = {}) {
  return {
    invoiceId: "invoice-open",
    academyId,
    familyId: "family-1",
    membershipId: "membership-1",
    status: "open",
    totalMinor: 1000,
    currency: "GBP",
    dueAt: sessionStart,
    paidAt: null,
    schemaVersion: 1,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
    chargeKind: "payg_session",
    sourceRef,
    invoiceReference: "payg-reference-1",
    description: "PAYG class: 2026-09-25",
    ...overrides,
  };
}

beforeEach(() => {
  finance.issued.length = 0;
  finance.voided.length = 0;
  finance.docs = new Map();
  finance.seq = 0;
});

function liveInvoices(records: Map<string, Doc>) {
  return [...records.entries()]
    .filter(([path]) => path.startsWith(`${root}/invoices/`))
    .map(([, value]) => value)
    .filter((invoice) => invoice.status !== "void");
}

describe("attachPaygBookingPayment", () => {
  it("records an at-venue choice and issues the class invoice", async () => {
    const order: string[] = [];
    const { db, records } = fakeFirestore(seed("payg"), order);

    await attachPaygBookingPayment(db, null, {
      academyId,
      actorId,
      booking,
      paygPayment: { method: "at_venue" },
    });

    expect(finance.issued).toHaveLength(1);
    expect(finance.issued[0]).toMatchObject({
      academyId,
      actorId,
      familyId: "family-1",
      membershipId: "membership-1",
      totalMinor: 1000,
      dueAt: sessionStart,
      chargeKind: "payg_session",
      sourceRef,
    });
    // `updatedAt` must not advance on its own: the booking says who last touched it.
    expect(records.get(`${root}/bookings/${bookingId}`)).toMatchObject({
      paygPayment: { method: "at_venue" },
      updatedBy: actorId,
    });
    expect(records.get(`${root}/bookings/${bookingId}`)!.updatedAt).not.toBe(now);
    // No proof to check, so nothing at all is read from private storage.
    expect(order.filter((entry) => entry.startsWith("read:"))).toEqual([]);
  });

  it("reuses an open class invoice instead of charging the member twice", async () => {
    const { db } = fakeFirestore(
      { ...seed("payg"), [`${root}/invoices/invoice-open`]: invoiceDoc() },
      [],
    );

    await attachPaygBookingPayment(db, null, {
      academyId,
      actorId,
      booking,
      paygPayment: { method: "at_venue" },
    });

    expect(finance.issued).toEqual([]);
  });

  it("refuses a payment choice on a monthly plan", async () => {
    const { db, records } = fakeFirestore(seed("bpt-jersey-adult"), []);

    await expect(
      attachPaygBookingPayment(db, null, {
        academyId,
        actorId,
        booking,
        paygPayment: { method: "at_venue" },
      }),
    ).rejects.toThrow(/does not pay per class/);
    expect(finance.issued).toEqual([]);
    expect(records.get(`${root}/bookings/${bookingId}`)).not.toHaveProperty("paygPayment");
  });

  it("rejects a transfer whose proof is missing or mismatched", async () => {
    const objectKey = paygProofKey(academyId, actorId, bookingId, proofId);
    const order: string[] = [];
    const missing = fakeFirestore(seed("payg"), order);

    await expect(
      attachPaygBookingPayment(missing.db, fakeStorage({}, order), {
        academyId,
        actorId,
        booking,
        paygPayment: { method: "bank_transfer", proofId, reference: "BPT-1" },
      }),
    ).rejects.toThrow(/Payment evidence is unavailable/);

    const mismatched = fakeFirestore(seed("payg"), order);
    await expect(
      attachPaygBookingPayment(
        mismatched.db,
        fakeStorage({ [objectKey]: Buffer.from([255, 216, 255, 9, 9]) }, order),
        {
          academyId,
          actorId,
          booking,
          paygPayment: { method: "bank_transfer", proofId, reference: "BPT-1" },
        },
      ),
    ).rejects.toThrow(/Payment evidence is unavailable/);

    // The proof is read before anything is charged or written.
    expect(order).toEqual([`read:${objectKey}`, `read:${objectKey}`]);
    expect(finance.issued).toEqual([]);
    expect(missing.records.get(`${root}/bookings/${bookingId}`)).not.toHaveProperty("paygPayment");
  });

  it("accepts a transfer whose proof matches and stores the reference", async () => {
    const objectKey = paygProofKey(academyId, actorId, bookingId, proofId);
    const order: string[] = [];
    const { db, records } = fakeFirestore(seed("payg"), order);

    await attachPaygBookingPayment(db, fakeStorage({ [objectKey]: png }, order), {
      academyId,
      actorId,
      booking,
      paygPayment: { method: "bank_transfer", proofId, reference: "BPT-1" },
    });

    expect(finance.issued).toHaveLength(1);
    expect(records.get(`${root}/bookings/${bookingId}`)).toMatchObject({
      paygPayment: { method: "bank_transfer", proofId, reference: "BPT-1" },
    });
    expect(order[0]).toBe(`read:${objectKey}`);
  });
});

describe("attachPaygBookingPayment · household proofs and booking shape", () => {
  it("accepts the guardian's screenshot for a booking the teen requested", async () => {
    // Both accounts may book for this student, so either may have paid for the class.
    const household = { ...booking, createdBy: "guardian-1", updatedBy: "guardian-1" } as BookingRecord;
    const objectKey = paygProofKey(academyId, "guardian-1", bookingId, proofId);
    const order: string[] = [];
    const { db, records } = fakeFirestore(
      { ...seed("payg"), [`${root}/bookings/${bookingId}`]: { ...household } as Doc },
      order,
    );

    await attachPaygBookingPayment(db, fakeStorage({ [objectKey]: png }, order), {
      academyId,
      actorId: "teen-1",
      booking: household,
      paygPayment: { method: "bank_transfer", proofId, reference: "BPT-1" },
    });

    expect(records.get(`${root}/bookings/${bookingId}`)).toMatchObject({
      paygPayment: { method: "bank_transfer", proofId, reference: "BPT-1" },
      updatedBy: "teen-1",
    });
    // The requester's own key is tried first, the guardian's second.
    expect(order.filter((entry) => entry.startsWith("read:"))).toEqual([
      `read:${paygProofKey(academyId, "teen-1", bookingId, proofId)}`,
      `read:${objectKey}`,
    ]);
  });

  it("names the booking, not the plan, when the booking is the wrong shape", async () => {
    const { db } = fakeFirestore(seed("payg"), []);
    const course = { ...booking, schemaVersion: "2", membershipId: null } as unknown as BookingRecord;

    await expect(
      attachPaygBookingPayment(db, null, {
        academyId,
        actorId,
        booking: course,
        paygPayment: { method: "at_venue" },
      }),
    ).rejects.toThrow(/regular class booking is required/);
    expect(finance.issued).toEqual([]);
  });
});

describe("book, cancel, re-book", () => {
  it("leaves exactly one live payable invoice after the class is re-booked", async () => {
    const { db, records } = fakeFirestore(seed("payg"), []);
    const choice = { academyId, actorId, booking, paygPayment: { method: "at_venue" } } as const;

    await attachPaygBookingPayment(db, null, choice);
    await voidUnpaidPaygInvoice(db, {
      academyId,
      actorId,
      sessionId: "session-1",
      membershipId: "membership-1",
    });
    expect(finance.voided).toHaveLength(1);

    // The voided invoice still holds the first reference, so a re-book must not be handed it back.
    await expect(attachPaygBookingPayment(db, null, choice)).resolves.toBeUndefined();

    const live = liveInvoices(records);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ status: "open", totalMinor: 1000, chargeKind: "payg_session" });
    expect(finance.issued).toHaveLength(2);
    expect(finance.issued[1]!.invoiceReference).not.toBe(finance.issued[0]!.invoiceReference);

    // And the new reference stays idempotent: asking again reuses the live invoice.
    await attachPaygBookingPayment(db, null, choice);
    expect(finance.issued).toHaveLength(2);
    expect(liveInvoices(records)).toHaveLength(1);
  });

  it("derives one reference for two re-bookings racing after the same void", async () => {
    const { db, records } = fakeFirestore(seed("payg"), []);
    const choice = { academyId, actorId, booking, paygPayment: { method: "at_venue" } } as const;

    await attachPaygBookingPayment(db, null, choice);
    await voidUnpaidPaygInvoice(db, {
      academyId,
      actorId,
      sessionId: "session-1",
      membershipId: "membership-1",
    });
    await Promise.all([
      attachPaygBookingPayment(db, null, choice),
      attachPaygBookingPayment(db, null, choice),
    ]);

    expect(new Set(finance.issued.slice(1).map((input) => input.invoiceReference)).size).toBe(1);
    expect(liveInvoices(records)).toHaveLength(1);
  });
});

describe("voidUnpaidPaygInvoice", () => {
  it("voids an open unpaid class invoice on cancellation and keeps a paid one", async () => {
    const { db } = fakeFirestore(
      {
        ...seed("payg"),
        [`${root}/invoices/invoice-open`]: invoiceDoc(),
        [`${root}/invoices/invoice-paid`]: invoiceDoc({
          invoiceId: "invoice-paid",
          status: "paid",
          paidAt: now,
        }),
        [`${root}/invoices/invoice-settled-part`]: invoiceDoc({ invoiceId: "invoice-settled-part" }),
        [`${root}/payments/payment-1`]: {
          paymentId: "payment-1",
          academyId,
          familyId: "family-1",
          invoiceId: "invoice-settled-part",
          status: "recorded",
          amountMinor: 400,
          currency: "GBP",
          method: "cash",
          manualReference: "payg-part-1",
          providerReference: null,
          occurredAt: now,
          schemaVersion: 1,
          createdAt: now,
          createdBy: "admin-1",
          updatedAt: now,
          updatedBy: "admin-1",
        },
      },
      [],
    );

    await voidUnpaidPaygInvoice(db, {
      academyId,
      actorId,
      sessionId: "session-1",
      membershipId: "membership-1",
    });

    expect(finance.voided).toEqual([{ academyId, actorId, invoiceId: "invoice-open" }]);
  });
});
