import { createHash, randomUUID } from "node:crypto";
import {
  parseMembershipRecord,
  type MembershipRecord,
} from "@bpt-jersey/domain/memberships/lifecycle";

import {
  calculateAccountBalance,
  calculateInvoiceBalance,
  calculatePaygDebt,
  editPaymentReasonSchema,
  invoiceStatuses,
  parseInvoiceRecord,
  sameInvoicePayer,
  parseManualPaymentRecord,
  parsePaymentInstructionsRecord,
  paymentInstructionsSettingId,
  type InvoiceRecord,
  type InvoiceStatus,
  type ManualPaymentMethod,
  type ManualPaymentRecord,
  type PaymentInstructionsInput,
  type PaymentAuditEntry,
  type PaymentInstructionsRecord,
  type RecentPaymentRow,
} from "@bpt-jersey/domain/finance";

export type FinanceDocumentData = Readonly<Record<string, unknown>>;
export type FinanceDocumentReference = Readonly<{
  id: string;
  path: string;
  get: () => Promise<FinanceDocumentSnapshot>;
}>;
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
export type FinanceOrderedQuery = Readonly<{
  limit: (n: number) => Readonly<{ get: () => Promise<FinanceQuerySnapshot> }>;
}>;
export type FinanceCollectionReference = Readonly<{
  doc: (id?: string) => FinanceDocumentReference;
  get: () => Promise<FinanceQuerySnapshot>;
  where: (field: string, operator: "==", value: unknown) => FinanceQuery;
  orderBy: (field: string, direction: "asc" | "desc") => FinanceOrderedQuery;
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
  | "invoice.created"
  | "invoice.voided"
  | "payment.recorded"
  | "payment.edited"
  | "invoice.status.changed"
  | "membership.status.changed"
  | "academy.payment_instructions.saved";
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
  membershipId: string | null;
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

/** Office correction of a recorded payment. Omitted fields keep their stored value. */
export type EditManualPaymentStoreInput = Readonly<{
  academyId: string;
  actorId: string;
  actorName: string;
  paymentId: string;
  amountMinor?: number | undefined;
  method?: ManualPaymentMethod | undefined;
  manualReference?: string | undefined;
  occurredAt?: string | undefined;
  reason: string;
  requestId: string;
}>;

export type EditManualPaymentResult = Readonly<{
  paymentId: string;
  invoiceId: string;
  invoiceStatus: InvoiceStatus;
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
  /** How to pay, as office configured it; null until they do. Shown to every reader of the account. */
  paymentInstructions: PaymentInstructionsRecord | null;
}>;

export type FinanceStore = Readonly<{
  issueManualInvoice: (input: IssueManualInvoiceInput) => Promise<InvoiceRecord>;
  issuePaygInvoice: (input: IssuePaygInvoiceInput) => Promise<InvoiceRecord>;
  recordManualPayment: (input: RecordManualPaymentInput) => Promise<ManualPaymentRecord>;
  editManualPayment: (input: EditManualPaymentStoreInput) => Promise<EditManualPaymentResult>;
  voidManualInvoice: (input: VoidManualInvoiceInput) => Promise<InvoiceRecord>;
  listFinancialAccount: (scope: FinanceReadScope) => Promise<FinancialAccountView>;
  listRecentPayments: (academyId: string, limit: number) => Promise<readonly RecentPaymentRow[]>;
  getInvoice: (scope: FinanceReadScope, invoiceId: string) => Promise<InvoiceView>;
  savePaymentInstructions: (
    input: SavePaymentInstructionsInput,
  ) => Promise<PaymentInstructionsRecord>;
}>;

export type SavePaymentInstructionsInput = Readonly<{
  academyId: string;
  actorId: string;
  instructions: PaymentInstructionsInput;
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

function paymentInstructionsPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/settings/${paymentInstructionsSettingId}`;
}

function paymentEditReceiptPath(academyId: string, actorId: string, requestId: string): string {
  const key = createHash("sha256").update(`${actorId}:${requestId}`).digest("hex").slice(0, 40);
  return `academies/${pathSegment(academyId, "academy")}/paymentEditReceipts/edit-${key}`;
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
    !sameInvoicePayer(invoice, payment) ||
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
    membershipId:
      input.membershipId === null ? null : pathSegment(input.membershipId, "membership"),
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
  if (invoice.schemaVersion === 2) throw new FinanceStoreError("precondition", "Manage course payments in Courses & Seminars");
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
  if (invoice.membershipId === null) return scope.studentIds === undefined;
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

/** Null until office has configured how to pay; a malformed document is treated the same way. */
async function readPaymentInstructionsInTransaction(
  firestore: FinanceFirestore,
  transaction: FinanceTransaction,
  academyId: string,
): Promise<PaymentInstructionsRecord | null> {
  const snapshot = documentSnapshot(
    await transaction.get(firestore.doc(paymentInstructionsPath(academyId))),
  );
  if (!snapshot.exists) return null;
  const parsed = parsePaymentInstructionsRecord(snapshot.data());
  if (!parsed.ok || parsed.value.academyId !== academyId) return null;
  return parsed.value;
}

export async function readFinancialAccountInTransaction(input: {
  firestore: FinanceFirestore;
  transaction: FinanceTransaction;
  scope: FinanceReadScope;
}): Promise<FinancialAccountView> {
  const academy = pathSegment(input.scope.academyId, "academy");
  // Read first: the transaction must not read after it has written elsewhere, and the
  // instructions are the same for every scope.
  const paymentInstructions = await readPaymentInstructionsInTransaction(
    input.firestore,
    input.transaction,
    academy,
  );
  if (input.scope.familyIds?.length === 0 || input.scope.studentIds?.length === 0) {
    return Object.freeze({
      invoices: Object.freeze([]),
      balanceMinor: 0,
      paygDebtMinor: 0,
      paymentInstructions,
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
        input.scope.familyIds === undefined || (invoice.familyId !== null && input.scope.familyIds.includes(invoice.familyId)),
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
    paymentInstructions,
    balanceMinor: calculateAccountBalance(scopedInvoices, scopedPayments),
    // D16: only a class that has already taken place is a debt that blocks the next booking.
    paygDebtMinor: calculatePaygDebt(scopedInvoices, scopedPayments, new Date().toISOString()),
  });
}

export function createFinanceStore(dependencies: FinanceStoreDependencies): FinanceStore {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const generateInvoiceId = dependencies.generateInvoiceId ?? randomUUID;
  const generateAuditId = dependencies.generateAuditId ?? randomUUID;

  async function sourceRecords(
    transaction: FinanceTransaction,
    input: { academyId: string; familyId: string; membershipId: string | null },
  ): Promise<void> {
    const family = documentSnapshot(
      await transaction.get(
        dependencies.firestore.doc(familyPath(input.academyId, input.familyId)),
      ),
    );
    validFamilySource(family, input.academyId, input.familyId);
    if (input.membershipId === null) return;
    const membership = documentSnapshot(
      await transaction.get(
        dependencies.firestore.doc(membershipPath(input.academyId, input.membershipId)),
      ),
    );
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

  /**
   * A membership invoice that has just become paid brings an overdue subscription back to active,
   * unless another invoice of the same membership is still owed. Reads only: call before writing.
   */
  async function membershipToReactivate(
    transaction: FinanceTransaction,
    academyId: string,
    invoice: InvoiceRecord,
    actorId: string,
    current: string,
  ): Promise<MembershipRecord | null> {
    if (invoice.chargeKind !== "membership" || !invoice.membershipId) return null;
    const snapshot = documentSnapshot(
      await transaction.get(
        dependencies.firestore.doc(membershipPath(academyId, invoice.membershipId)),
      ),
    );
    const member = storedData(snapshot, "Membership");
    if (
      member.academyId !== academyId ||
      member.familyId !== invoice.familyId ||
      member.membershipId !== invoice.membershipId
    )
      throw new FinanceStoreError("tenant", "Membership scope is invalid");
    if (member.status !== "overdue") return null;
    const related = querySnapshot(
      await transaction.get(
        dependencies.firestore
          .collection(invoicesPath(academyId))
          .where("membershipId", "==", invoice.membershipId),
      ),
    );
    const anotherDebt = related.docs
      .map((doc) => parseScopedStoredInvoice(doc, academyId))
      .some(
        (other) =>
          other.invoiceId !== invoice.invoiceId &&
          (other.status === "open" || other.status === "partially_paid"),
      );
    if (anotherDebt) return null;
    const parsed = parseMembershipRecord({
      ...member,
      status: "active",
      updatedAt: current,
      updatedBy: actorId,
    });
    if (!parsed.ok) throw new FinanceStoreError("precondition", "Membership is invalid");
    return parsed.value;
  }

  function writeReactivation(
    transaction: FinanceTransaction,
    academyId: string,
    actorId: string,
    membership: MembershipRecord,
    correlationId: string,
  ): void {
    transaction.set(
      dependencies.firestore.doc(membershipPath(academyId, membership.membershipId)),
      membership,
    );
    dependencies.appendAudit(
      transaction,
      dependencies.firestore.doc(auditPath(academyId, generateAuditId())),
      {
        academyId,
        actorId,
        action: "membership.status.changed",
        targetRef: membershipPath(academyId, membership.membershipId),
        purpose: "activated subscription after outstanding membership invoices were paid",
        correlationId,
      },
    );
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
      if (invoice.schemaVersion === 2) throw new FinanceStoreError("precondition", "Manage course payments in Courses & Seminars");
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
      const activatedMembership =
        nextBalance === 0
          ? await membershipToReactivate(transaction, input.academyId, invoice, actorId, current)
          : null;
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
      if (activatedMembership) {
        writeReactivation(
          transaction,
          input.academyId,
          actorId,
          activatedMembership,
          input.manualReference,
        );
      }
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

  /**
   * Office corrects a recorded manual payment. The reason is mandatory and every edit appends one
   * entry to the payment's auditHistory, holding only the values it replaced; earlier entries are
   * copied as they are. The invoice status follows the corrected total, and a change that would
   * pay more than the invoice is refused. A repeated requestId answers from its receipt.
   */
  async function editManualPayment(
    input: EditManualPaymentStoreInput,
  ): Promise<EditManualPaymentResult> {
    const current = now();
    const academy = pathSegment(input.academyId, "academy");
    const actorId = pathSegment(input.actorId, "actor");
    const id = pathSegment(input.paymentId, "payment");
    const reason = editPaymentReasonSchema.safeParse(input.reason);
    if (!reason.success) throw new FinanceStoreError("invalid", "Invalid edit reason");
    const actorName = input.actorName.trim().slice(0, 160);
    if (actorName.length === 0 || /[\u0000-\u001f\u007f]/u.test(actorName)) {
      throw new FinanceStoreError("invalid", "Invalid editor name");
    }
    const requested = Object.freeze({
      paymentId: id,
      ...(input.amountMinor === undefined ? {} : { amountMinor: validAmount(input.amountMinor) }),
      ...(input.method === undefined ? {} : { method: input.method }),
      ...(input.manualReference === undefined
        ? {}
        : { manualReference: validReference(input.manualReference, "manual reference") }),
      ...(input.occurredAt === undefined
        ? {}
        : {
            occurredAt: new Date(
              validDateTime(input.occurredAt, "payment occurrence"),
            ).toISOString(),
          }),
      reason: reason.data,
    });
    const fingerprint = createHash("sha256").update(JSON.stringify(requested)).digest("hex");
    const receiptRef = dependencies.firestore.doc(
      paymentEditReceiptPath(academy, actorId, input.requestId),
    );
    return dependencies.firestore.runTransaction(async (transaction) => {
      const receipt = documentSnapshot(await transaction.get(receiptRef));
      if (receipt.exists) {
        const data = receipt.data();
        if (data?.fingerprint !== fingerprint) {
          throw new FinanceStoreError("conflict", "Request id was already used for another edit");
        }
        const stored: unknown = data.result;
        if (
          typeof stored !== "object" ||
          stored === null ||
          (stored as Record<string, unknown>).paymentId !== id ||
          !safePathSegmentPattern.test(String((stored as Record<string, unknown>).invoiceId)) ||
          !invoiceStatuses.includes(
            (stored as Record<string, unknown>).invoiceStatus as InvoiceStatus,
          )
        ) {
          throw new FinanceStoreError("invalid", "Stored payment edit receipt is invalid");
        }
        const { invoiceId, invoiceStatus } = stored as EditManualPaymentResult;
        return Object.freeze({ paymentId: id, invoiceId, invoiceStatus });
      }
      const payment = parseScopedStoredPayment(
        documentSnapshot(
          await transaction.get(dependencies.firestore.doc(paymentPath(academy, id))),
        ),
        academy,
      );
      if (payment.schemaVersion === 2) {
        throw new FinanceStoreError("precondition", "Manage course payments in Courses & Seminars");
      }
      const invoice = parseScopedStoredInvoice(
        documentSnapshot(
          await transaction.get(
            dependencies.firestore.doc(invoicePath(academy, payment.invoiceId)),
          ),
        ),
        academy,
      );
      if (invoice.schemaVersion === 2) {
        throw new FinanceStoreError("precondition", "Manage course payments in Courses & Seminars");
      }
      assertPaymentInvoiceScope(payment, invoice);
      if (invoice.status === "void") {
        throw new FinanceStoreError("precondition", "A payment on a void invoice cannot be edited");
      }
      const payments = await paymentsFor(transaction, academy, invoice);
      const previousValues: Record<string, unknown> = {};
      if (requested.amountMinor !== undefined && requested.amountMinor !== payment.amountMinor) {
        previousValues.amountMinor = payment.amountMinor;
      }
      if (requested.method !== undefined && requested.method !== payment.method) {
        previousValues.method = payment.method;
      }
      if (
        requested.manualReference !== undefined &&
        requested.manualReference !== payment.manualReference
      ) {
        previousValues.manualReference = payment.manualReference;
      }
      if (
        requested.occurredAt !== undefined &&
        Date.parse(requested.occurredAt) !== Date.parse(payment.occurredAt)
      ) {
        previousValues.occurredAt = payment.occurredAt;
      }
      if (Object.keys(previousValues).length === 0) {
        throw new FinanceStoreError("invalid", "The edit changes nothing");
      }
      if (previousValues.manualReference !== undefined) {
        const holder = await paymentByReference(transaction, academy, requested.manualReference!);
        if (holder !== undefined && holder.paymentId !== payment.paymentId) {
          throw new FinanceStoreError("conflict", "Payment reference is already used");
        }
      }
      const entry: PaymentAuditEntry = Object.freeze({
        editedAt: current,
        editedBy: actorId,
        editedByName: actorName,
        reason: reason.data,
        previousValues: Object.freeze(previousValues),
      });
      const edited = parseManualPaymentRecord({
        ...payment,
        amountMinor: requested.amountMinor ?? payment.amountMinor,
        method: requested.method ?? payment.method,
        manualReference: requested.manualReference ?? payment.manualReference,
        occurredAt: requested.occurredAt ?? payment.occurredAt,
        updatedAt: current,
        updatedBy: actorId,
        auditHistory: [...(payment.auditHistory ?? []), entry],
      });
      if (!edited.ok) throw new FinanceStoreError("invalid", "Invalid payment edit");
      const nextPayments = payments.map((candidate) =>
        candidate.paymentId === payment.paymentId ? edited.value : candidate,
      );
      const paidMinor = nextPayments.reduce(
        (total, candidate) => total + (candidate.status === "recorded" ? candidate.amountMinor : 0),
        0,
      );
      if (paidMinor > invoice.totalMinor) {
        throw new FinanceStoreError("precondition", "This change would overpay the invoice");
      }
      const balance = calculateInvoiceBalance(invoice, nextPayments);
      const invoiceStatus: InvoiceStatus =
        balance === 0 ? "paid" : paidMinor > 0 ? "partially_paid" : "open";
      const statusChanged = invoiceStatus !== invoice.status;
      // Only the paid direction touches the membership: a lowered amount leaves any overdue
      // marking to the overdue sweep, exactly as an unpaid invoice would.
      const activatedMembership =
        statusChanged && invoiceStatus === "paid"
          ? await membershipToReactivate(transaction, academy, invoice, actorId, current)
          : null;
      const updatedInvoice: InvoiceRecord = {
        ...invoice,
        status: invoiceStatus,
        paidAt: invoiceStatus === "paid" ? (invoice.paidAt ?? current) : null,
        updatedAt: current,
        updatedBy: actorId,
      };
      const result: EditManualPaymentResult = Object.freeze({
        paymentId: payment.paymentId,
        invoiceId: invoice.invoiceId,
        invoiceStatus,
      });
      transaction.set(
        dependencies.firestore.doc(paymentPath(academy, payment.paymentId)),
        edited.value,
      );
      transaction.set(
        dependencies.firestore.doc(invoicePath(academy, invoice.invoiceId)),
        updatedInvoice,
      );
      transaction.create(receiptRef, { fingerprint, result, createdAt: current });
      if (activatedMembership) {
        writeReactivation(transaction, academy, actorId, activatedMembership, input.requestId);
      }
      dependencies.appendAudit(
        transaction,
        dependencies.firestore.doc(auditPath(academy, generateAuditId())),
        {
          academyId: academy,
          actorId,
          action: "payment.edited",
          targetRef: paymentPath(academy, payment.paymentId),
          purpose: "manual payment edited",
          correlationId: input.requestId,
          amountMinor: edited.value.amountMinor,
          currency: "GBP",
          method: edited.value.method,
        },
      );
      if (statusChanged) {
        dependencies.appendAudit(
          transaction,
          dependencies.firestore.doc(auditPath(academy, generateAuditId())),
          {
            academyId: academy,
            actorId,
            action: "invoice.status.changed",
            targetRef: invoicePath(academy, invoice.invoiceId),
            purpose: "invoice status recalculated after a payment edit",
            correlationId: input.requestId,
            amountMinor: invoice.totalMinor,
            currency: "GBP",
          },
        );
      }
      return result;
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
      if (invoice.schemaVersion === 2) throw new FinanceStoreError("precondition", "Manage course refunds in Courses & Seminars");
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
      if (scope.familyIds !== undefined && (invoice.familyId === null || !scope.familyIds.includes(invoice.familyId))) {
        throw new FinanceStoreError("not-found", "Invoice not found");
      }
      if (!(await matchesStudentScope(transaction, scope, invoice))) {
        throw new FinanceStoreError("not-found", "Invoice not found");
      }
      return invoiceView(invoice, await paymentsFor(transaction, academy, invoice));
    });
  }

  /**
   * T010/T035: office records the academy's own bank details once. One document, overwritten in
   * place and audited each time, because there is exactly one answer to "where do I transfer".
   */
  async function savePaymentInstructions(
    input: SavePaymentInstructionsInput,
  ): Promise<PaymentInstructionsRecord> {
    const academy = pathSegment(input.academyId, "academy");
    const actorId = pathSegment(input.actorId, "actor");
    const record: PaymentInstructionsRecord = Object.freeze({
      ...input.instructions,
      academyId: academy,
      schemaVersion: 1 as const,
      updatedAt: now(),
      updatedBy: actorId,
    });
    const validated = parsePaymentInstructionsRecord(record);
    if (!validated.ok) throw new FinanceStoreError("invalid", "Invalid payment instructions");
    return dependencies.firestore.runTransaction(async (transaction) => {
      const ref = dependencies.firestore.doc(paymentInstructionsPath(academy));
      transaction.set(ref, record as unknown as FinanceDocumentData);
      dependencies.appendAudit(
        transaction,
        dependencies.firestore.doc(auditPath(academy, generateAuditId())),
        {
          academyId: academy,
          actorId,
          action: "academy.payment_instructions.saved",
          targetRef: ref.path,
          purpose: "finance-payment-instructions",
          correlationId: `payment-instructions-${academy}`,
        },
      );
      return record;
    });
  }

  async function listRecentPayments(
    academyId: string,
    limit: number,
  ): Promise<readonly RecentPaymentRow[]> {
    const academy = pathSegment(academyId, "academy");
    const snapshot = querySnapshot(
      await dependencies.firestore
        .collection(paymentsPath(academy))
        .orderBy("occurredAt", "desc")
        .limit(limit)
        .get(),
    );
    const payments = snapshot.docs.map((document) => parseScopedStoredPayment(document, academy));
    const invoiceIds = [...new Set(payments.map((payment) => payment.invoiceId))];
    const invoices = new Map<string, InvoiceRecord>();
    for (const invoiceId of invoiceIds) {
      const document = await dependencies.firestore.doc(invoicePath(academy, invoiceId)).get();
      invoices.set(invoiceId, parseScopedStoredInvoice(document, academy));
    }
    const names = new Map<string, string | null>();
    for (const invoice of invoices.values()) {
      if (invoice.membershipId === null || names.has(invoice.membershipId)) continue;
      const membership = await dependencies.firestore
        .doc(membershipPath(academy, invoice.membershipId))
        .get();
      const studentId = membership.exists ? membership.data()?.studentId : undefined;
      if (typeof studentId !== "string") {
        names.set(invoice.membershipId, null);
        continue;
      }
      const student = await dependencies.firestore
        .doc(`academies/${academy}/students/${pathSegment(studentId, "student")}`)
        .get();
      const fullName = student.exists ? student.data()?.fullName : undefined;
      names.set(
        invoice.membershipId,
        typeof fullName === "string" && fullName.trim() ? fullName.trim() : null,
      );
    }
    return Object.freeze(
      payments.map((payment) => {
        const invoice = invoices.get(payment.invoiceId)!;
        return Object.freeze({
          paymentId: payment.paymentId,
          occurredAt: payment.occurredAt,
          amountMinor: payment.amountMinor,
          method: payment.method,
          manualReference: payment.manualReference,
          invoiceReference: invoice.invoiceReference,
          description: invoice.schemaVersion === 2 ? `Course · ${invoice.description}`.slice(0, 200) : invoice.description,
          familyId: payment.familyId,
          memberName:
            invoice.membershipId === null ? null : (names.get(invoice.membershipId) ?? null),
        });
      }),
    );
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
    editManualPayment,
    voidManualInvoice,
    listFinancialAccount,
    listRecentPayments,
    getInvoice,
    savePaymentInstructions,
  });
}
