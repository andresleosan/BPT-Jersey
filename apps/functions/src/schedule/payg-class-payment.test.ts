import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { buildBookingId } from "@bpt-jersey/domain/schedule";

type Doc = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  /** Replaced per test; the mocked Firestore, finance store and R2 client all read this map. */
  docs: new Map<string, Record<string, unknown>>(),
  objects: new Map<string, Uint8Array>(),
  getUser: vi.fn(),
  scope: vi.fn(),
  payments: [] as Record<string, string | number>[],
  issued: [] as Record<string, string | number>[],
  signed: [] as Record<string, string | number>[],
  puts: [] as { objectKey: string; bytes: Uint8Array }[],
  reads: [] as string[],
  seq: 0,
}));

function invoiceBalance(invoiceId: string): number {
  const invoice = [...mocks.docs.values()].find((value) => value.invoiceId === invoiceId)!;
  const paid = mocks.payments
    .filter((payment) => payment.invoiceId === invoiceId)
    .reduce((total, payment) => total + Number(payment.amountMinor), 0);
  return Number(invoice.totalMinor) - paid;
}

vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ getUser: mocks.getUser }) }));

vi.mock("firebase-admin/firestore", () => {
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const snapshot = (path: string) => {
    const value = mocks.docs.get(path);
    return {
      id: idOf(path),
      path,
      exists: value !== undefined,
      data: () => value,
      get: (field: string) => value?.[field],
    };
  };
  const query = (path: string, filters: { field: string; value: unknown }[] = []) => ({
    where(field: string, _operator: string, value: unknown) {
      return query(path, [...filters, { field, value }]);
    },
    async get() {
      const docs = [...mocks.docs.entries()]
        .filter(
          ([key, value]) =>
            parentOf(key) === path &&
            filters.every(({ field, value: expected }) => value[field] === expected),
        )
        .map(([key, value]) => ({ id: idOf(key), exists: true, data: () => value }));
      return { docs, size: docs.length };
    },
  });
  return {
    getFirestore: () => ({
      doc: (path: string) => ({ ...snapshot(path), get: async () => snapshot(path) }),
      collection: (path: string) => query(path),
      getAll: async (...refs: { path: string }[]) => refs.map((ref) => snapshot(ref.path)),
    }),
  };
});

vi.mock("../storage/r2-client.js", () => ({
  createPrivateStorageR2Client: () => ({
    readObject: async (objectKey: string) => {
      mocks.reads.push(objectKey);
      const value = mocks.objects.get(objectKey);
      if (!value) throw new Error("not found");
      return value;
    },
    putObject: async (objectKey: string, bytes: Uint8Array) => {
      mocks.puts.push({ objectKey, bytes });
      mocks.objects.set(objectKey, bytes);
    },
    createPrivateImageUrl: async (input: Record<string, string | number>) => {
      mocks.signed.push(input);
      return "https://private.invalid/signed";
    },
  }),
}));

vi.mock("./canonical-client-student-scope.js", () => ({
  createFirestoreCanonicalClientStudentScopeResolver: () => mocks.scope,
}));

vi.mock("../finance/finance-service.js", () => ({
  createFinanceStore: () => ({
    issuePaygInvoice: async (input: Record<string, string | number>) => {
      mocks.issued.push(input);
      const root = `academies/${input.academyId}`;
      for (const [path, value] of mocks.docs) {
        if (
          path.startsWith(`${root}/invoices/`) &&
          value.invoiceReference === input.invoiceReference
        ) {
          return value;
        }
      }
      mocks.seq += 1;
      const stamp = "2026-09-22T09:00:00.000Z";
      const invoice = {
        invoiceId: `invoice-${mocks.seq}`,
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
      mocks.docs.set(`${root}/invoices/${invoice.invoiceId}`, invoice);
      return invoice;
    },
    getInvoice: async (_scope: unknown, invoiceId: string) => ({
      invoice: [...mocks.docs.values()].find((value) => value.invoiceId === invoiceId),
      payments: mocks.payments.filter((payment) => payment.invoiceId === invoiceId),
      balanceMinor: invoiceBalance(invoiceId),
    }),
    recordManualPayment: async (input: Record<string, string | number>) => {
      // The real store refuses a reused reference whose request differs; mirroring that is what
      // makes the double-confirm assertion meaningful.
      const clash = mocks.payments.find(
        (payment) =>
          payment.manualReference === input.manualReference && payment.invoiceId !== input.invoiceId,
      );
      if (clash) throw new Error("Payment reference conflicts with existing payment");
      mocks.payments.push(input);
      return input;
    },
    voidManualInvoice: async () => undefined,
  }),
}));

import {
  confirmPaygClassPayment,
  getPaygClassProofUrl,
  paygProofKey,
  uploadPaygClassProof,
} from "./payg-class-payment.js";

const academyId = "academy-1";
const now = "2026-09-20T08:00:00.000Z";
const sessionStart = "2026-09-25T18:00:00.000Z";
const root = `academies/${academyId}`;
const bookingId = buildBookingId("session-1", "student-1");
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 7, 7, 7, 7]);
const proofId = createHash("sha256").update(png).digest("hex");

function request(role: string, uid: string, data: unknown, app = true) {
  return {
    data,
    ...(app ? { app: { appId: "app-1" } } : {}),
    auth: { uid, token: { academyId, role, auth_time: 1758000000 } },
  } as never;
}

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

function seed(overrides: { paygPayment?: Doc; createdBy?: string; updatedBy?: string } = {}) {
  mocks.docs = new Map<string, Doc>([
    [
      `${root}/memberships/membership-1`,
      {
        membershipId: "membership-1",
        academyId,
        familyId: "family-1",
        studentId: "student-1",
        planId: "payg",
        status: "active",
        startsAt: now,
        endsAt: null,
        nextBillingAt: null,
        schemaVersion: "1",
        createdAt: now,
        createdBy: "admin-1",
        updatedAt: now,
        updatedBy: "admin-1",
      },
    ],
    [`${root}/plans/payg`, planDoc("payg")],
    [`${root}/sessions/session-1`, { sessionId: "session-1", academyId, startAt: sessionStart }],
    [
      `${root}/bookings/${bookingId}`,
      {
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
        createdBy: overrides.createdBy ?? "member-1",
        updatedAt: now,
        updatedBy: overrides.updatedBy ?? "member-1",
        ...(overrides.paygPayment ? { paygPayment: overrides.paygPayment } : {}),
      },
    ],
  ]);
}

beforeEach(() => {
  mocks.objects = new Map();
  mocks.payments.length = 0;
  mocks.issued.length = 0;
  mocks.signed.length = 0;
  mocks.puts.length = 0;
  mocks.reads.length = 0;
  mocks.seq = 0;
  mocks.getUser.mockReset();
  mocks.scope.mockReset();
  seed();
});

const classInput = { sessionId: "session-1", studentId: "student-1" };

describe("confirmPaygClassPayment", () => {
  it("refuses every non-staff role and never touches the money", async () => {
    for (const role of ["guardian", "adultStudent", "teenStudent", "shopper"]) {
      await expect(
        confirmPaygClassPayment.run(request(role, "member-1", classInput)),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }
    expect(mocks.payments).toEqual([]);
    expect(mocks.issued).toEqual([]);
  });

  it("settles the class in cash for a pay-at-venue booking and only once", async () => {
    seed({ paygPayment: { method: "at_venue" } });

    expect(await confirmPaygClassPayment.run(request("coach", "coach-1", classInput))).toEqual({
      status: "paid",
    });
    expect(mocks.payments).toHaveLength(1);
    expect(mocks.payments[0]).toMatchObject({
      academyId,
      actorId: "coach-1",
      amountMinor: 1000,
      method: "cash",
      invoiceId: "invoice-1",
    });
    // The reference the idempotency argument rests on: the invoice's own reference plus the method.
    expect(mocks.payments[0]!.manualReference).toBe(
      `${mocks.issued[0]!.invoiceReference}-cash`,
    );
    expect(String(mocks.payments[0]!.manualReference)).toMatch(
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
    );

    // A second confirmation finds a nil balance and settles nothing further.
    expect(await confirmPaygClassPayment.run(request("owner", "owner-1", classInput))).toEqual({
      status: "paid",
    });
    expect(mocks.payments).toHaveLength(1);
  });

  it("records a transfer when the member said they had sent one", async () => {
    seed({ paygPayment: { method: "bank_transfer", proofId, reference: "BPT-1" } });

    await confirmPaygClassPayment.run(request("headCoach", "head-1", classInput));

    expect(mocks.payments[0]).toMatchObject({ method: "bank_transfer" });
    expect(mocks.payments[0]!.manualReference).toBe(
      `${mocks.issued[0]!.invoiceReference}-transfer`,
    );
  });

  it("issues the class invoice when the booking never carried a choice", async () => {
    await confirmPaygClassPayment.run(request("administrator", "admin-1", classInput));

    expect(mocks.issued).toHaveLength(1);
    expect(mocks.payments[0]).toMatchObject({ method: "cash", amountMinor: 1000 });
  });

  it("refuses a booking that is not a confirmed regular class", async () => {
    mocks.docs.delete(`${root}/bookings/${bookingId}`);

    await expect(
      confirmPaygClassPayment.run(request("owner", "owner-1", classInput)),
    ).rejects.toThrow(/regular class booking is required/);
    expect(mocks.payments).toEqual([]);
  });
});

describe("uploadPaygClassProof", () => {
  const upload = { ...classInput, contentType: "image/png" as const, base64: png.toString("base64") };

  beforeEach(() => {
    mocks.getUser.mockResolvedValue({
      disabled: false,
      emailVerified: true,
      customClaims: { academyId, role: "guardian" },
    });
  });

  it("stores the screenshot under the member's own key once the scope allows it", async () => {
    mocks.scope.mockResolvedValue(true);

    expect(await uploadPaygClassProof.run(request("guardian", "member-1", upload))).toEqual({
      proofId,
    });
    expect(mocks.puts).toHaveLength(1);
    expect(mocks.puts[0]!.objectKey).toBe(
      paygProofKey(academyId, "member-1", bookingId, proofId),
    );
    expect(mocks.scope).toHaveBeenCalledWith(
      expect.objectContaining({ academyId, actorUserId: "member-1", requestedStudentId: "student-1" }),
    );
  });

  it("refuses to upload against another member's student and writes nothing", async () => {
    mocks.scope.mockResolvedValue(false);

    await expect(
      uploadPaygClassProof.run(request("guardian", "intruder-1", { ...upload, studentId: "student-9" })),
    ).rejects.toMatchObject({ code: "permission-denied", message: "Access denied for this student" });
    expect(mocks.puts).toEqual([]);
    expect(mocks.objects.size).toBe(0);
  });

  it("refuses a caller who is not a member account", async () => {
    mocks.scope.mockResolvedValue(true);

    await expect(
      uploadPaygClassProof.run(request("coach", "coach-1", upload)),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(mocks.puts).toEqual([]);
  });

  it("refuses bytes that are not a real PNG or JPEG", async () => {
    mocks.scope.mockResolvedValue(true);

    await expect(
      uploadPaygClassProof.run(
        request("guardian", "member-1", { ...upload, base64: Buffer.from("not an image").toString("base64") }),
      ),
    ).rejects.toThrow(/PNG or JPEG/);
    expect(mocks.puts).toEqual([]);
  });
});

describe("getPaygClassProofUrl", () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({
      disabled: false,
      customClaims: { academyId, role: "owner" },
    });
  });

  it("signs a 60-second view of the screenshot the guardian uploaded for the teen's booking", async () => {
    // The guardian paid; the teen made the booking. Both may act for this student.
    seed({
      paygPayment: { method: "bank_transfer", proofId, reference: "BPT-1" },
      createdBy: "teen-1",
      updatedBy: "teen-1",
    });
    const objectKey = paygProofKey(academyId, "guardian-1", bookingId, proofId);
    mocks.objects.set(objectKey, png);
    mocks.docs.set(`${root}/bookings/${bookingId}`, {
      ...mocks.docs.get(`${root}/bookings/${bookingId}`)!,
      createdBy: "guardian-1",
    });

    const result = await getPaygClassProofUrl.run(request("owner", "owner-1", classInput));

    expect(result).toMatchObject({ url: "https://private.invalid/signed" });
    expect(mocks.signed[0]).toMatchObject({
      objectKey,
      expiresInSeconds: 60,
      contentType: "image/png",
    });
  });

  it("refuses a booking with no transfer on it without looking in storage at all", async () => {
    for (const paygPayment of [{ method: "at_venue" }, undefined]) {
      seed(paygPayment ? { paygPayment } : {});

      await expect(
        getPaygClassProofUrl.run(request("owner", "owner-1", classInput)),
      ).rejects.toThrow(/Payment evidence is unavailable/);
      expect(mocks.signed).toEqual([]);
      // The method gate decides this, so no private object is ever probed for.
      expect(mocks.reads).toEqual([]);
    }
  });

  it("refuses a coach, who is not office", async () => {
    seed({ paygPayment: { method: "bank_transfer", proofId, reference: "BPT-1" } });

    await expect(
      getPaygClassProofUrl.run(request("coach", "coach-1", classInput)),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(mocks.signed).toEqual([]);
  });
});
