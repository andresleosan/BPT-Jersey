import { HttpsError } from "firebase-functions/v2/https";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  parseInvoiceRecord,
  parseManualPaymentRecord,
  type LegacyInvoiceRecord,
  type LegacyManualPaymentRecord,
  type ManualPaymentMethod,
} from "@bpt-jersey/domain/finance";
import { participantBandAt } from "@bpt-jersey/domain/memberships";
import {
  PRIVATE_LESSON_OPTIONS,
  listMyPrivateLessonsInputSchema,
  listPrivateLessonPurchasesInputSchema,
  privateLessonExpiry,
  privateLessonProofUrlInputSchema,
  privateLessonPurchaseSchema,
  recordPrivateLessonPurchaseInputSchema,
  reviewPrivateLessonPurchaseInputSchema,
  submitPrivateLessonPurchaseInputSchema,
  summarisePrivateLessonCredits,
  type MyPrivateLessons,
  type PrivateLessonOptionId,
  type PrivateLessonProofUrl,
  type PrivateLessonPurchase,
  type PrivateLessonPurchaseRow,
  type PrivateLessonPurchaseStatus,
} from "@bpt-jersey/domain/private-lessons";

export type PrivateLessonActor = Readonly<{ academyId: string; userId: string; role: string }>;

/** Only the student facts this feature needs; the adapter checks tenant and identity. */
export type PrivateLessonStudent = Readonly<{
  studentId: string;
  fullName: string | null;
  dateOfBirth: string | null;
  familyId: string | null;
  active: boolean;
}>;

export type PrivateLessonTransaction = Readonly<{
  canAccessStudent: (userId: string, studentId: string) => Promise<boolean>;
  readStudent: (studentId: string) => Promise<PrivateLessonStudent | null>;
  readPurchase: (purchaseId: string) => Promise<PrivateLessonPurchase | null>;
  readStudentPurchases: (studentId: string) => Promise<readonly PrivateLessonPurchase[]>;
  writePurchase: (purchase: PrivateLessonPurchase) => void;
  writeInvoice: (invoice: LegacyInvoiceRecord, payment: LegacyManualPaymentRecord) => void;
  appendAudit: (draft: AuditEventDraft) => void;
}>;

/** Ports scoped to one academy. */
export type PrivateLessonStore = Readonly<{
  runTransaction: <T>(update: (tx: PrivateLessonTransaction) => Promise<T>) => Promise<T>;
  listByStatus: (status: PrivateLessonPurchaseStatus) => Promise<readonly PrivateLessonPurchase[]>;
  listForStudent: (studentId: string) => Promise<readonly PrivateLessonPurchase[]>;
  studentNames: (studentIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  canAccessStudent: (userId: string, studentId: string) => Promise<boolean>;
  verifyProof: (
    input: Readonly<{ userId: string; requestId: string; proofId: string }>,
  ) => Promise<void>;
  newId: () => string;
  /** Short-lived signed URL for the member's uploaded transfer proof. */
  proofUrl: (
    input: Readonly<{ userId: string; requestId: string; proofId: string }>,
  ) => Promise<PrivateLessonProofUrl>;
}>;

const officeRoles = new Set(["owner", "administrator"]);
const manualReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function assertOffice(actor: PrivateLessonActor): void {
  if (!officeRoles.has(actor.role)) {
    throw new HttpsError("permission-denied", "Administrator access is required.");
  }
}

function parse<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  raw: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpsError("invalid-argument", message);
  return parsed.data as T;
}

function assertEligibleStudent(
  student: PrivateLessonStudent | null,
  now: string,
): PrivateLessonStudent {
  if (!student || !student.active) {
    throw new HttpsError("failed-precondition", "Member profile is unavailable.");
  }
  if (participantBandAt({ dateOfBirth: student.dateOfBirth, onIso: now }) !== "adult") {
    throw new HttpsError("failed-precondition", "Private lessons are for members aged 16 or over.");
  }
  return student;
}

function hasActiveMonthly(
  purchases: readonly PrivateLessonPurchase[],
  now: string,
  except: string,
): boolean {
  return purchases.some(
    (purchase) =>
      purchase.purchaseId !== except &&
      purchase.optionId === "monthly" &&
      purchase.status === "approved" &&
      purchase.expiresAt !== null &&
      Date.parse(purchase.expiresAt) > Date.parse(now),
  );
}

function purchaseRef(academyId: string, purchaseId: string): string {
  return `academies/${academyId}/privateLessonPurchases/${purchaseId}`;
}

/** Approval stages the paid invoice, its payment and the audit event in the caller's transaction. */
function approve(
  tx: PrivateLessonTransaction,
  actor: PrivateLessonActor,
  purchase: PrivateLessonPurchase,
  student: PrivateLessonStudent,
  purchases: readonly PrivateLessonPurchase[],
  method: ManualPaymentMethod,
  reference: string | null,
  now: string,
): PrivateLessonPurchase {
  if (purchase.optionId === "monthly" && hasActiveMonthly(purchases, now, purchase.purchaseId)) {
    throw new HttpsError(
      "failed-precondition",
      "This member already has an active monthly private lesson plan.",
    );
  }
  if (!student.familyId) {
    throw new HttpsError("failed-precondition", "Register the member's billing account first.");
  }
  const invoiceId = `private_lesson_invoice_${purchase.purchaseId}`;
  const common = {
    academyId: actor.academyId,
    familyId: student.familyId,
    currency: "GBP" as const,
    schemaVersion: 1 as const,
    createdAt: now,
    createdBy: actor.userId,
    updatedAt: now,
    updatedBy: actor.userId,
  };
  const invoice: LegacyInvoiceRecord = {
    ...common,
    invoiceId,
    membershipId: null,
    status: "paid",
    totalMinor: purchase.priceMinor,
    dueAt: now,
    paidAt: now,
    chargeKind: "private-lesson",
    sourceRef: purchaseRef(actor.academyId, purchase.purchaseId),
    invoiceReference: invoiceId,
    description: PRIVATE_LESSON_OPTIONS[purchase.optionId].displayName,
  };
  const payment: LegacyManualPaymentRecord = {
    ...common,
    paymentId: `private_lesson_payment_${purchase.purchaseId}`,
    invoiceId,
    status: "recorded",
    amountMinor: purchase.priceMinor,
    method,
    // The ledger only takes identifier-shaped references; free text stays on the purchase.
    manualReference:
      reference !== null && manualReferencePattern.test(reference)
        ? reference
        : purchase.purchaseId,
    providerReference: null,
    occurredAt: now,
  };
  if (!parseInvoiceRecord(invoice).ok || !parseManualPaymentRecord(payment).ok) {
    throw new HttpsError("internal", "The private lesson payment could not be recorded.");
  }
  const result = privateLessonPurchaseSchema.parse({
    ...purchase,
    status: "approved",
    creditsRemaining: purchase.creditsGranted,
    decidedAt: now,
    decidedBy: actor.userId,
    decisionReason: null,
    expiresAt: privateLessonExpiry(purchase.optionId, now),
    invoiceId,
  });
  tx.writeInvoice(invoice, payment);
  tx.writePurchase(result);
  tx.appendAudit({
    academyId: actor.academyId,
    actorId: actor.userId,
    action: "payment.recorded",
    targetRef: purchaseRef(actor.academyId, purchase.purchaseId),
    purpose: "private-lesson-purchase",
    correlationId: purchase.purchaseId,
  } as AuditEventDraft);
  return result;
}

function newPurchase(input: {
  purchaseId: string;
  studentId: string;
  accountUid: string | null;
  optionId: PrivateLessonOptionId;
  source: "member" | "office";
  method: ManualPaymentMethod;
  proofId: string | null;
  bankReference: string | null;
  now: string;
}): PrivateLessonPurchase {
  const option = PRIVATE_LESSON_OPTIONS[input.optionId];
  return privateLessonPurchaseSchema.parse({
    purchaseId: input.purchaseId,
    studentId: input.studentId,
    accountUid: input.accountUid,
    optionId: input.optionId,
    priceMinor: option.priceMinor,
    creditsGranted: option.credits,
    creditsRemaining: 0,
    status: "pending",
    source: input.source,
    method: input.method,
    proofId: input.proofId,
    bankReference: input.bankReference,
    submittedAt: input.now,
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    expiresAt: null,
    invoiceId: null,
    schemaVersion: "1",
  });
}

export async function submitPrivateLessonPurchase(
  store: PrivateLessonStore,
  actor: PrivateLessonActor,
  raw: unknown,
  now: string,
): Promise<PrivateLessonPurchase> {
  const input = parse(
    submitPrivateLessonPurchaseInputSchema,
    raw,
    "Invalid private lesson request",
  );
  // The proof lives in R2: read it before the transaction so a contention retry never repeats it.
  await store.verifyProof({
    userId: actor.userId,
    requestId: input.requestId,
    proofId: input.proofId,
  });
  const purchaseId = `private-lesson-${input.requestId}`;
  return store.runTransaction(async (tx) => {
    if (!(await tx.canAccessStudent(actor.userId, input.studentId))) {
      throw new HttpsError("permission-denied", "Member profile is unavailable.");
    }
    const existing = await tx.readPurchase(purchaseId);
    if (existing) {
      if (existing.accountUid === actor.userId && existing.studentId === input.studentId)
        return existing;
      throw new HttpsError("already-exists", "This private lesson request was already used.");
    }
    assertEligibleStudent(await tx.readStudent(input.studentId), now);
    const purchase = newPurchase({
      purchaseId,
      studentId: input.studentId,
      accountUid: actor.userId,
      optionId: input.optionId,
      source: "member",
      method: "bank_transfer",
      proofId: input.proofId,
      bankReference: input.bankReference,
      now,
    });
    tx.writePurchase(purchase);
    return purchase;
  });
}

export async function listMyPrivateLessons(
  store: PrivateLessonStore,
  actor: PrivateLessonActor,
  raw: unknown,
  now: string,
): Promise<MyPrivateLessons> {
  const input = parse(listMyPrivateLessonsInputSchema, raw, "Invalid private lesson request");
  if (!(await store.canAccessStudent(actor.userId, input.studentId))) {
    throw new HttpsError("permission-denied", "Member profile is unavailable.");
  }
  const purchases = [...(await store.listForStudent(input.studentId))].sort((a, b) =>
    b.submittedAt.localeCompare(a.submittedAt),
  );
  return { purchases, ...summarisePrivateLessonCredits(purchases, now) };
}

export async function listPrivateLessonPurchases(
  store: PrivateLessonStore,
  actor: PrivateLessonActor,
  raw: unknown,
): Promise<{ purchases: PrivateLessonPurchaseRow[] }> {
  assertOffice(actor);
  const input = parse(listPrivateLessonPurchasesInputSchema, raw, "Invalid private lesson query");
  const purchases = [...(await store.listByStatus(input.status))].sort((a, b) =>
    b.submittedAt.localeCompare(a.submittedAt),
  );
  const names = await store.studentNames([
    ...new Set(purchases.map((purchase) => purchase.studentId)),
  ]);
  return {
    purchases: purchases.map((purchase) => ({
      ...purchase,
      studentName: names.get(purchase.studentId) ?? null,
    })),
  };
}

export async function reviewPrivateLessonPurchase(
  store: PrivateLessonStore,
  actor: PrivateLessonActor,
  raw: unknown,
  now: string,
): Promise<PrivateLessonPurchase> {
  assertOffice(actor);
  const input = parse(reviewPrivateLessonPurchaseInputSchema, raw, "Invalid review decision");
  return store.runTransaction(async (tx) => {
    const purchase = await tx.readPurchase(input.purchaseId);
    if (!purchase) throw new HttpsError("not-found", "Private lesson purchase is unavailable.");
    if (purchase.status !== "pending") {
      throw new HttpsError("failed-precondition", "This purchase has already been reviewed.");
    }
    if (input.decision === "reject") {
      const rejected = privateLessonPurchaseSchema.parse({
        ...purchase,
        status: "rejected",
        decidedAt: now,
        decidedBy: actor.userId,
        decisionReason: input.reason || null,
      });
      tx.writePurchase(rejected);
      return rejected;
    }
    const student = await tx.readStudent(purchase.studentId);
    const purchases = await tx.readStudentPurchases(purchase.studentId);
    return approve(
      tx,
      actor,
      purchase,
      assertEligibleStudent(student, purchase.submittedAt),
      purchases,
      purchase.method,
      purchase.bankReference,
      now,
    );
  });
}

export async function recordPrivateLessonPurchase(
  store: PrivateLessonStore,
  actor: PrivateLessonActor,
  raw: unknown,
  now: string,
): Promise<PrivateLessonPurchase> {
  assertOffice(actor);
  const input = parse(
    recordPrivateLessonPurchaseInputSchema,
    raw,
    "Invalid private lesson purchase",
  );
  const purchaseId = `private-lesson-${store.newId()}`;
  return store.runTransaction(async (tx) => {
    const student = assertEligibleStudent(await tx.readStudent(input.studentId), now);
    const purchases = await tx.readStudentPurchases(input.studentId);
    const pending = newPurchase({
      purchaseId,
      studentId: input.studentId,
      accountUid: null,
      optionId: input.optionId,
      source: "office",
      method: input.method,
      proofId: null,
      bankReference: input.reference,
      now,
    });
    return approve(tx, actor, pending, student, purchases, input.method, input.reference, now);
  });
}

const memberPurchaseIdPattern =
  /^private-lesson-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;

/** The proof key is rebuilt from the stored purchase: its owner, its request id and its proof id. */
export async function getPrivateLessonProofUrl(
  store: PrivateLessonStore,
  actor: PrivateLessonActor,
  raw: unknown,
): Promise<PrivateLessonProofUrl> {
  assertOffice(actor);
  const input = parse(privateLessonProofUrlInputSchema, raw, "Invalid private lesson request");
  const purchase = await store.runTransaction((tx) => tx.readPurchase(input.purchaseId));
  if (!purchase) throw new HttpsError("not-found", "Private lesson purchase is unavailable.");
  const requestId = memberPurchaseIdPattern.exec(purchase.purchaseId)?.[1];
  if (
    purchase.source !== "member" ||
    purchase.accountUid === null ||
    purchase.proofId === null ||
    requestId === undefined
  ) {
    throw new HttpsError("failed-precondition", "Payment evidence is unavailable.");
  }
  return store.proofUrl({
    userId: purchase.accountUid,
    requestId,
    proofId: purchase.proofId,
  });
}
