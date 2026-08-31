import { createHash, randomUUID } from "node:crypto";

import {
  calculateAccountBalance,
  calculateInvoiceBalance,
  calculatePaygDebt,
  parseInvoiceRecord,
  parseManualPaymentRecord,
  type InvoiceRecord,
  type ManualPaymentMethod,
  type ManualPaymentRecord,
} from "@bpt-jersey/domain/finance";

export type FinanceDocumentData = Readonly<Record<string, unknown>>;
export type FinanceDocumentReference = Readonly<{ id: string; path: string }>;
export type FinanceDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => FinanceDocumentData | undefined;
}>;
export type FinanceQuerySnapshot = Readonly<{
  docs: readonly FinanceDocumentSnapshot[];
}>;
export type FinanceQuery = Readonly<{
  path: string;
  field: string;
  value: unknown;
}>;
export type FinanceCollectionReference = Readonly<{
  doc: (id?: string) => FinanceDocumentReference;
  get: () => Promise<FinanceQuerySnapshot>;
  where: (field: string, operator: "==", value: unknown) => FinanceQuery;
}>;
export type FinanceTransaction = Readonly<{
  get: (
    target: FinanceDocumentReference | FinanceQuery,
  ) => Promise<FinanceDocumentSnapshot | FinanceQuerySnapshot>;
  create: (ref: FinanceDocumentReference, data: FinanceDocumentData) => FinanceTransaction;
  set: (ref: FinanceDocumentReference, data: FinanceDocumentData) => FinanceTransaction;
}>;
export type FinanceFirestore = Readonly<{
  doc: (path: string) => FinanceDocumentReference;
  collection: (path: string) => FinanceCollectionReference;
  runTransaction: <T>(callback: (transaction: FinanceTransaction) => Promise<T>) => Promise<T>;
}>;

export type FinanceAuditAction =
  "invoice.created" | "invoice.voided" | "payment.recorded" | "invoice.status.changed";
export type FinanceAuditDraft = Readonly<{
  academyId: string;
  actorId: string;
  action: FinanceAuditAction;
  targetRef: string;
  purpose: string;
  correlationId: string;
  amountMinor?: number;
  currency?: "GBP";
  method?: ManualPaymentMethod;
}>;

export type FinanceAuditWriter = (
  transaction: FinanceTransaction,
  ref: FinanceDocumentReference,
  draft: FinanceAuditDraft,
) => void;

export type IssueManualInvoiceInput = Readonly<{
  academyId: string;
  actorId: string;
  familyId: string;
  membershipId: string;
  totalMinor: number;
  dueAt: string;
  chargeKind: "membership" | "manual_adjustment";
  invoiceReference: string;
  description: string;
}>;

export type IssuePaygInvoiceInput = Readonly<{
  academyId: string;
  actorId: string;
  familyId: string;
  membershipId: string;
  totalMinor: number;
  dueAt: string;
  chargeKind: "payg_session";
  sourceRef: string;
  invoiceReference: string;
  description: string;
}>;

export type RecordManualPaymentInput = Readonly<{
  academyId: string;
  actorId: string;
  invoiceId: string;
  amountMinor: number;
  method: ManualPaymentMethod;
  manualReference: string;
  occurredAt: string;
}>;

export type VoidManualInvoiceInput = Readonly<{
  academyId: string;
  actorId: string;
  invoiceId: string;
}>;

export type FinanceReadScope = Readonly<{
  academyId: string;
  familyIds?: readonly string[];
  studentIds?: readonly string[];
}>;

export type InvoiceView = Readonly<{
  invoice: InvoiceRecord;
  payments: readonly ManualPaymentRecord[];
  balanceMinor: number;
}>;
export type FinancialAccountView = Readonly<{
  invoices: readonly InvoiceView[];
  balanceMinor: number;
  paygDebtMinor: number;
}>;

export type FinanceStore = Readonly<{
  issueManualInvoice: (input: IssueManualInvoiceInput) => Promise<InvoiceRecord>;
  issuePaygInvoice: (input: IssuePaygInvoiceInput) => Promise<InvoiceRecord>;
  recordManualPayment: (input: RecordManualPaymentInput) => Promise<ManualPaymentRecord>;
  voidManualInvoice: (input: VoidManualInvoiceInput) => Promise<InvoiceRecord>;
  listFinancialAccount: (scope: FinanceReadScope) => Promise<FinancialAccountView>;
  getInvoice: (scope: FinanceReadScope, invoiceId: string) => Promise<InvoiceView>;
}>;

export type FinanceStoreDependencies = Readonly<{
  firestore: FinanceFirestore;
  now?: () => string;
  generateInvoiceId?: () => string;
  appendAudit: FinanceAuditWriter;
  generateAuditId?: () => string;
}>;

export class FinanceStoreError extends Error {
  public readonly code:
    "invalid" | "tenant" | "conflict" | "not-found" | "precondition" | "transaction";

  public constructor(code: FinanceStoreError["code"], message: string) {
    super(message);
    this.name = "FinanceStoreError";
    this.code = code;
  }
}

const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sourceReferencePattern = /^academies\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\/[A-Za-z0-9._:/-]+$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function pathSegment(value: unknown, label: string): string {
  if (typeof value !== "string" || !safePathSegmentPattern.test(value)) {
    throw new FinanceStoreError("tenant", `Invalid ${label}`);
  }
  return value;
}

function validDateTime(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new FinanceStoreError("invalid", `Invalid ${label}`);
  }
  return value;
}

function validAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new FinanceStoreError("invalid", "Invalid amount");
  }
  return value;
}

function validReference(value: unknown, label: string): string {
  if (typeof value !== "string" || !referencePattern.test(value)) {
    throw new FinanceStoreError("invalid", `Invalid ${label}`);
  }
  return value;
}

function validDescription(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new FinanceStoreError("invalid", "Invalid description");
  }
  return value;
}

function invoicesPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/invoices`;
}

function invoicePath(academyId: string, invoiceId: string): string {
  return `${invoicesPath(academyId)}/${pathSegment(invoiceId, "invoice")}`;
}

function paymentsPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/payments`;
}

function paymentPath(academyId: string, paymentId: string): string {
  return `${paymentsPath(academyId)}/${pathSegment(paymentId, "payment")}`;
}

function familyPath(academyId: string, familyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/families/${pathSegment(familyId, "family")}`;
}

function membershipPath(academyId: string, membershipId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/memberships/${pathSegment(
    membershipId,
    "membership",
  )}`;
}

function auditPath(academyId: string, auditId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/auditEvents/${pathSegment(
    auditId,
    "audit event",
  )}`;
}

function isQuerySnapshot(
  value: FinanceDocumentSnapshot | FinanceQuerySnapshot,
): value is FinanceQuerySnapshot {
  return "docs" in value;
}

function documentSnapshot(
  value: FinanceDocumentSnapshot | FinanceQuerySnapshot,
): FinanceDocumentSnapshot {
  if (isQuerySnapshot(value)) throw new FinanceStoreError("invalid", "Expected document snapshot");
  return value;
}

function querySnapshot(
  value: FinanceDocumentSnapshot | FinanceQuerySnapshot,
): FinanceQuerySnapshot {
  if (!isQuerySnapshot(value)) throw new FinanceStoreError("invalid", "Expected query snapshot");
  return value;
}

function storedData(snapshot: FinanceDocumentSnapshot, resource: string): FinanceDocumentData {
  if (!snapshot.exists) throw new FinanceStoreError("not-found", `${resource} not found`);
  const data = snapshot.data();
  if (data === undefined) throw new FinanceStoreError("invalid", `Invalid ${resource}`);
  return data;
}

function sourceBelongsToAcademy(sourceRef: string, academyId: string): void {
  if (
    !sourceReferencePattern.test(sourceRef) ||
    sourceRef.includes("..") ||
    sourceRef.includes("//") ||
    !sourceRef.startsWith(`academies/${academyId}/`)
  ) {
    throw new FinanceStoreError("tenant", "Invalid financial source");
  }
}

function sourceFamilyId(sourceRef: string): string | undefined {
  const match = /^academies\/[^/]+\/families\/([^/]+)(?:\/|$)/u.exec(sourceRef);
  return match?.[1];
}

function parseStoredInvoice(snapshot: FinanceDocumentSnapshot): InvoiceRecord {
  const parsed = parseInvoiceRecord(storedData(snapshot, "Invoice"));
  if (!parsed.ok) throw new FinanceStoreError("invalid", "Stored invoice is invalid");
  if (parsed.value.invoiceId !== snapshot.id)
    throw new FinanceStoreError("invalid", "Invoice identity is invalid");
  return parsed.value;
}

function parseStoredPayment(snapshot: FinanceDocumentSnapshot): ManualPaymentRecord {
  const parsed = parseManualPaymentRecord(storedData(snapshot, "Payment"));
  if (!parsed.ok) throw new FinanceStoreError("invalid", "Stored payment is invalid");
  if (parsed.value.paymentId !== snapshot.id)
    throw new FinanceStoreError("invalid", "Payment identity is invalid");
  return parsed.value;
}

function parseScopedStoredInvoice(
  snapshot: FinanceDocumentSnapshot,
  academyId: string,
): InvoiceRecord {
  const invoice = parseStoredInvoice(snapshot);
  if (invoice.academyId !== academyId) {
    throw new FinanceStoreError("tenant", "Invoice scope is invalid");
  }
  return invoice;
}

function parseScopedStoredPayment(
  snapshot: FinanceDocumentSnapshot,
  academyId: string,
): ManualPaymentRecord {
  const payment = parseStoredPayment(snapshot);
  if (payment.academyId !== academyId) {
    throw new FinanceStoreError("tenant", "Payment scope is invalid");
  }
  return payment;
}

function assertPaymentInvoiceScope(payment: ManualPaymentRecord, invoice: InvoiceRecord): void {
  if (
    payment.academyId !== invoice.academyId ||
    payment.familyId !== invoice.familyId ||
    payment.invoiceId !== invoice.invoiceId
  ) {
    throw new FinanceStoreError("tenant", "Payment invoice scope is invalid");
  }
}

function validFamilySource(
  snapshot: FinanceDocumentSnapshot,
  academyId: string,
  familyId: string,
): void {
  const data = storedData(snapshot, "Family");
  if (snapshot.id !== familyId || data.familyId !== familyId || data.academyId !== academyId) {
    throw new FinanceStoreError("tenant", "Family scope is invalid");
  }
  if (data.active !== true) throw new FinanceStoreError("precondition", "Family is inactive");
}

function validMembershipSource(
  snapshot: FinanceDocumentSnapshot,
  academyId: string,
  familyId: string,
  membershipId: string,
): void {
  const data = storedData(snapshot, "Membership");
  if (
    snapshot.id !== membershipId ||
    data.membershipId !== membershipId ||
    data.academyId !== academyId ||
    data.familyId !== familyId
  ) {
    throw new FinanceStoreError("tenant", "Membership scope is invalid");
  }
  if (data.status === "cancelled")
    throw new FinanceStoreError("precondition", "Membership is cancelled");
}

function invoicePayload(
  input: IssueManualInvoiceInput | IssuePaygInvoiceInput,
  invoiceId: string,
  now: string,
): InvoiceRecord {
  const record: InvoiceRecord = {
    invoiceId,
    academyId: pathSegment(input.academyId, "academy"),
    familyId: pathSegment(input.familyId, "family"),
    membershipId: pathSegment(input.membershipId, "membership"),
    status: "open",
    totalMinor: validAmount(input.totalMinor),
    currency: "GBP",
    dueAt: validDateTime(input.dueAt, "due date"),
    paidAt: null,
    schemaVersion: 1,
    createdAt: now,
    createdBy: pathSegment(input.actorId, "actor"),
    updatedAt: now,
    updatedBy: pathSegment(input.actorId, "actor"),
    chargeKind: input.chargeKind,
    sourceRef: input.chargeKind === "payg_session" ? input.sourceRef : null,
    invoiceReference: validReference(input.invoiceReference, "invoice reference"),
    description: validDescription(input.description),
  };
  const parsed = parseInvoiceRecord(record);
  if (!parsed.ok) throw new FinanceStoreError("invalid", "Invalid invoice input");
  return parsed.value;
}

function paymentId(academyId: string, manualReference: string): string {
  return `payment-${createHash("sha256").update(`${academyId}:${manualReference}`).digest("hex").slice(0, 40)}`;
}

function paymentPayload(
  input: RecordManualPaymentInput,
  invoice: InvoiceRecord,
  id: string,
  now: string,
): ManualPaymentRecord {
  const record: ManualPaymentRecord = {
    paymentId: id,
    academyId: invoice.academyId,
    familyId: invoice.familyId,
    invoiceId: invoice.invoiceId,
    status: "recorded",
    amountMinor: validAmount(input.amountMinor),
    currency: "GBP",
    method: input.method,
    manualReference: validReference(input.manualReference, "manual reference"),
    providerReference: null,
    occurredAt: validDateTime(input.occurredAt, "payment occurrence"),
    schemaVersion: 1,
    createdAt: now,
    createdBy: pathSegment(input.actorId, "actor"),
    updatedAt: now,
    updatedBy: pathSegment(input.actorId, "actor"),
  };
  const parsed = parseManualPaymentRecord(record);
  if (!parsed.ok) throw new FinanceStoreError("invalid", "Invalid payment input");
  return parsed.value;
}

function samePaymentRequest(
  payment: ManualPaymentRecord,
  input: RecordManualPaymentInput,
): boolean {
  return (
    payment.invoiceId === input.invoiceId &&
    payment.amountMinor === input.amountMinor &&
    payment.method === input.method &&
    payment.occurredAt === input.occurredAt
  );
}

function invoiceView(
  invoice: InvoiceRecord,
  payments: readonly ManualPaymentRecord[],
): InvoiceView {
  return Object.freeze({
    invoice,
    payments: Object.freeze([...payments]),
    balanceMinor: calculateInvoiceBalance(invoice, payments),
  });
}

async function matchesStudentScopeInTransaction(
  firestore: FinanceFirestore,
  transaction: FinanceTransaction,
  scope: FinanceReadScope,
  invoice: InvoiceRecord,
): Promise<boolean> {
  if (scope.studentIds === undefined) return true;
  const membership = documentSnapshot(
    await transaction.get(firestore.doc(membershipPath(scope.academyId, invoice.membershipId))),
  );
  const data = storedData(membership, "Membership");
  if (
    membership.id !== invoice.membershipId ||
    data.academyId !== scope.academyId ||
    data.familyId !== invoice.familyId ||
    typeof data.studentId !== "string"
  ) {
    throw new FinanceStoreError("tenant", "Membership scope is invalid");
  }
  return scope.studentIds.includes(data.studentId);
}

export async function readFinancialAccountInTransaction(input: {
  firestore: FinanceFirestore;
  transaction: FinanceTransaction;
  scope: FinanceReadScope;
}): Promise<FinancialAccountView> {
  const academy = pathSegment(input.scope.academyId, "academy");
  if (input.scope.familyIds?.length === 0 || input.scope.studentIds?.length === 0) {
    return Object.freeze({
      invoices: Object.freeze([]),
      balanceMinor: 0,
      paygDebtMinor: 0,
    });
  }
  const familyId = input.scope.familyIds?.length === 1 ? input.scope.familyIds[0] : undefined;
  const invoices = querySnapshot(
    await input.transaction.get(
      input.firestore
        .collection(invoicesPath(academy))
        .where(familyId === undefined ? "academyId" : "familyId", "==", familyId ?? academy),
    ),
  )
    .docs.map((document) => parseScopedStoredInvoice(document, academy))
    .filter(
      (invoice) =>
        input.scope.familyIds === undefined || input.scope.familyIds.includes(invoice.familyId),
    );
  const scopedInvoices: InvoiceRecord[] = [];
  for (const invoice of invoices) {
    if (
      await matchesStudentScopeInTransaction(
        input.firestore,
        input.transaction,
        input.scope,
        invoice,
      )
    ) {
      scopedInvoices.push(invoice);
    }
  }
  const payments = querySnapshot(
    await input.transaction.get(
      input.firestore
        .collection(paymentsPath(academy))
        .where(familyId === undefined ? "academyId" : "familyId", "==", familyId ?? academy),
    ),
  ).docs.map((document) => parseScopedStoredPayment(document, academy));
  const scopedPayments = payments.filter((payment) => {
    const invoice = scopedInvoices.find((candidate) => candidate.invoiceId === payment.invoiceId);
    if (invoice === undefined) return false;
    assertPaymentInvoiceScope(payment, invoice);
    return true;
  });
  const views = scopedInvoices.map((invoice) =>
    invoiceView(
      invoice,
      scopedPayments.filter((payment) => payment.invoiceId === invoice.invoiceId),
    ),
  );
  return Object.freeze({
    invoices: Object.freeze(views),
    balanceMinor: calculateAccountBalance(scopedInvoices, scopedPayments),
    paygDebtMinor: calculatePaygDebt(scopedInvoices, scopedPayments),
  });
}

export function createFinanceStore(dependencies: FinanceStoreDependencies): FinanceStore {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const generateInvoiceId = dependencies.generateInvoiceId ?? randomUUID;
  const generateAuditId = dependencies.generateAuditId ?? randomUUID;

  async function sourceRecords(
    transaction: FinanceTransaction,
    input: { academyId: string; familyId: string; membershipId: string },
  ): Promise<void> {
    const family = documentSnapshot(
      await transaction.get(
        dependencies.firestore.doc(familyPath(input.academyId, input.familyId)),
      ),
    );
    const membership = documentSnapshot(
      await transaction.get(
        dependencies.firestore.doc(membershipPath(input.academyId, input.membershipId)),
      ),
    );
    validFamilySource(family, input.academyId, input.familyId);
    validMembershipSource(membership, input.academyId, input.familyId, input.membershipId);
  }

  async function paymentsFor(
    transaction: FinanceTransaction,
    academyId: string,
    invoice: InvoiceRecord,
  ): Promise<ManualPaymentRecord[]> {
    const snapshot = querySnapshot(
      await transaction.get(
        dependencies.firestore
          .collection(paymentsPath(academyId))
          .where("invoiceId", "==", invoice.invoiceId),
      ),
    );
    return snapshot.docs.map((document) => {
      const payment = parseScopedStoredPayment(document, academyId);
      assertPaymentInvoiceScope(payment, invoice);
      return payment;
    });
  }

  async function paymentByReference(
    transaction: FinanceTransaction,
    academyId: string,
    manualReference: string,
  ): Promise<ManualPaymentRecord | undefined> {
    const snapshot = querySnapshot(
      await transaction.get(
        dependencies.firestore
          .collection(paymentsPath(academyId))
          .where("manualReference", "==", manualReference),
      ),
    );
    if (snapshot.docs.length > 1) {
      throw new FinanceStoreError("conflict", "Payment reference is duplicated");
    }
    const document = snapshot.docs[0];
    return document === undefined ? undefined : parseScopedStoredPayment(document, academyId);
  }

  async function matchesStudentScope(
    transaction: FinanceTransaction,
    scope: FinanceReadScope,
    invoice: InvoiceRecord,
  ): Promise<boolean> {
    return matchesStudentScopeInTransaction(dependencies.firestore, transaction, scope, invoice);
  }

  async function issueInvoice(
    input: IssueManualInvoiceInput | IssuePaygInvoiceInput,
  ): Promise<InvoiceRecord> {
    const recordId = generateInvoiceId();
    const current = now();
    return dependencies.firestore.runTransaction(async (transaction) => {
      await sourceRecords(transaction, input);
      if (input.chargeKind === "payg_session") {
        sourceBelongsToAcademy(input.sourceRef, input.academyId);
        const sourceFamily = sourceFamilyId(input.sourceRef);
        if (sourceFamily !== undefined && sourceFamily !== input.familyId) {
          throw new FinanceStoreError("tenant", "Financial source family is invalid");
        }
      }
      const existingSnapshot = querySnapshot(
        await transaction.get(
          dependencies.firestore
            .collection(invoicesPath(input.academyId))
            .where("invoiceReference", "==", input.invoiceReference),
        ),
      );
      if (existingSnapshot.docs.length > 1)
        throw new FinanceStoreError("conflict", "Invoice reference is duplicated");
      if (existingSnapshot.docs.length === 1) {
        const existing = parseScopedStoredInvoice(existingSnapshot.docs[0]!, input.academyId);
        const requested = invoicePayload(input, existing.invoiceId, current);
        if (
          existing.familyId !== requested.familyId ||
          existing.membershipId !== requested.membershipId ||
          existing.totalMinor !== requested.totalMinor ||
          existing.dueAt !== requested.dueAt ||
          existing.chargeKind !== requested.chargeKind ||
          existing.sourceRef !== requested.sourceRef ||
          existing.description !== requested.description
        ) {
          throw new FinanceStoreError(
            "conflict",
            "Invoice reference conflicts with existing invoice",
          );
        }
        return existing;
      }
      const invoice = invoicePayload(input, recordId, current);
      transaction.create(
        dependencies.firestore.doc(invoicePath(input.academyId, invoice.invoiceId)),
        invoice,
      );
      dependencies.appendAudit(
        transaction,
        dependencies.firestore.doc(auditPath(input.academyId, generateAuditId())),
        {
          academyId: input.academyId,
          actorId: input.actorId,
          action: "invoice.created",
          targetRef: invoicePath(input.academyId, invoice.invoiceId),
          purpose: "manual invoice created",
          correlationId: input.invoiceReference,
          amountMinor: invoice.totalMinor,
          currency: "GBP",
        },
      );
      return invoice;
    });
  }

  async function issueManualInvoice(input: IssueManualInvoiceInput): Promise<InvoiceRecord> {
    return issueInvoice(input);
  }

  async function issuePaygInvoice(input: IssuePaygInvoiceInput): Promise<InvoiceRecord> {
    return issueInvoice(input);
  }

  async function recordManualPayment(
    input: RecordManualPaymentInput,
  ): Promise<ManualPaymentRecord> {
    const current = now();
    const id = paymentId(input.academyId, input.manualReference);
    const actorId = pathSegment(input.actorId, "actor");
    return dependencies.firestore.runTransaction(async (transaction) => {
      const invoice = parseScopedStoredInvoice(
        documentSnapshot(
          await transaction.get(
            dependencies.firestore.doc(invoicePath(input.academyId, input.invoiceId)),
          ),
        ),
        input.academyId,
      );
      const existingByReference = await paymentByReference(
        transaction,
        input.academyId,
        input.manualReference,
      );
      if (existingByReference !== undefined) {
        if (!samePaymentRequest(existingByReference, input)) {
          throw new FinanceStoreError(
            "conflict",
            "Payment reference conflicts with existing payment",
          );
        }
        return existingByReference;
      }
      const payments = await paymentsFor(transaction, input.academyId, invoice);
      if (invoice.status === "void" || invoice.status === "paid") {
        throw new FinanceStoreError("precondition", "Invoice cannot receive a payment");
      }
      const payment = paymentPayload(input, invoice, id, current);
      const remaining = calculateInvoiceBalance(invoice, payments);
      if (payment.amountMinor > remaining)
        throw new FinanceStoreError("conflict", "Payment exceeds invoice balance");
      const nextBalance = remaining - payment.amountMinor;
      const updatedInvoice: InvoiceRecord = {
        ...invoice,
        status: nextBalance === 0 ? "paid" : "partially_paid",
        paidAt: nextBalance === 0 ? current : null,
        updatedAt: current,
        updatedBy: actorId,
      };
      transaction.create(
        dependencies.firestore.doc(paymentPath(input.academyId, payment.paymentId)),
        payment,
      );
      transaction.set(
        dependencies.firestore.doc(invoicePath(input.academyId, invoice.invoiceId)),
        updatedInvoice,
      );
      dependencies.appendAudit(
        transaction,
        dependencies.firestore.doc(auditPath(input.academyId, generateAuditId())),
        {
          academyId: input.academyId,
          actorId: input.actorId,
          action: "payment.recorded",
          targetRef: paymentPath(input.academyId, payment.paymentId),
          purpose: "manual payment recorded",
          correlationId: input.manualReference,
          amountMinor: payment.amountMinor,
          currency: "GBP",
          method: payment.method,
        },
      );
      if (nextBalance === 0) {
        dependencies.appendAudit(
          transaction,
          dependencies.firestore.doc(auditPath(input.academyId, generateAuditId())),
          {
            academyId: input.academyId,
            actorId: input.actorId,
            action: "invoice.status.changed",
            targetRef: invoicePath(input.academyId, invoice.invoiceId),
            purpose: "invoice paid by manual payment",
            correlationId: input.manualReference,
            amountMinor: invoice.totalMinor,
            currency: "GBP",
          },
        );
      }
      return payment;
    });
  }

  async function voidManualInvoice(input: VoidManualInvoiceInput): Promise<InvoiceRecord> {
    const current = now();
    const actorId = pathSegment(input.actorId, "actor");
    return dependencies.firestore.runTransaction(async (transaction) => {
      const invoice = parseScopedStoredInvoice(
        documentSnapshot(
          await transaction.get(
            dependencies.firestore.doc(invoicePath(input.academyId, input.invoiceId)),
          ),
        ),
        input.academyId,
      );
      const payments = await paymentsFor(transaction, input.academyId, invoice);
      if (invoice.status !== "open" || payments.length > 0) {
        throw new FinanceStoreError("precondition", "Invoice cannot be voided");
      }
      const voided: InvoiceRecord = {
        ...invoice,
        status: "void",
        updatedAt: current,
        updatedBy: actorId,
      };
      transaction.set(
        dependencies.firestore.doc(invoicePath(input.academyId, invoice.invoiceId)),
        voided,
      );
      dependencies.appendAudit(
        transaction,
        dependencies.firestore.doc(auditPath(input.academyId, generateAuditId())),
        {
          academyId: input.academyId,
          actorId: input.actorId,
          action: "invoice.voided",
          targetRef: invoicePath(input.academyId, invoice.invoiceId),
          purpose: "manual invoice voided",
          correlationId: invoice.invoiceReference,
          amountMinor: invoice.totalMinor,
          currency: "GBP",
        },
      );
      return voided;
    });
  }

  async function getInvoice(scope: FinanceReadScope, invoiceId: string): Promise<InvoiceView> {
    const academy = pathSegment(scope.academyId, "academy");
    const invoiceIdSafe = pathSegment(invoiceId, "invoice");
    return dependencies.firestore.runTransaction(async (transaction) => {
      const invoice = parseScopedStoredInvoice(
        documentSnapshot(
          await transaction.get(dependencies.firestore.doc(invoicePath(academy, invoiceIdSafe))),
        ),
        academy,
      );
      if (scope.familyIds !== undefined && !scope.familyIds.includes(invoice.familyId)) {
        throw new FinanceStoreError("not-found", "Invoice not found");
      }
      if (!(await matchesStudentScope(transaction, scope, invoice))) {
        throw new FinanceStoreError("not-found", "Invoice not found");
      }
      return invoiceView(invoice, await paymentsFor(transaction, academy, invoice));
    });
  }

  async function listFinancialAccount(scope: FinanceReadScope): Promise<FinancialAccountView> {
    return dependencies.firestore.runTransaction((transaction) =>
      readFinancialAccountInTransaction({
        firestore: dependencies.firestore,
        transaction,
        scope,
      }),
    );
  }

  return Object.freeze({
    issueManualInvoice,
    issuePaygInvoice,
    recordManualPayment,
    voidManualInvoice,
    listFinancialAccount,
    getInvoice,
  });
}
