import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import type { UserActorContext } from "@bpt-jersey/domain";
import { parseStudentProfile } from "@bpt-jersey/domain/profiles";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { createFamilyStore, type FamilyStore } from "../families/family-service.js";
import { requireUserActor } from "../auth/user-authorization.js";
import {
  FinanceStoreError,
  createFinanceStore,
  type FinanceReadScope,
  type FinanceStore,
  type IssueManualInvoiceInput,
  type RecordManualPaymentInput,
  type VoidManualInvoiceInput,
} from "./finance-service.js";

type FinanceFamilyStore = Pick<FamilyStore, "getGuardianFamily">;

export type FinanceStudentScope = Readonly<{
  studentId: string;
  familyId: string;
  participantType: "adult" | "minor";
  active: boolean;
  status: "active" | "inactive" | "suspended";
}>;

export type FinanceCallableServices = Readonly<{
  store: FinanceStore;
  familyStore: FinanceFamilyStore;
  findStudentByUserId: (
    academyId: string,
    userId: string,
  ) => Promise<FinanceStudentScope | undefined>;
  isActorActive: (actor: UserActorContext) => Promise<boolean>;
}>;

export class FinanceCallableError extends HttpsError {
  public constructor(code: ConstructorParameters<typeof HttpsError>[0], message: string) {
    super(code, message);
    this.name = "FinanceCallableError";
  }
}

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

function invalidPayload(): never {
  throw new FinanceCallableError("invalid-argument", "Finance payload is invalid");
}

function permissionDenied(): never {
  throw new FinanceCallableError("permission-denied", "Finance access is not permitted");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  } catch {
    return false;
  }
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    return (
      keys.length === fields.length &&
      keys.every((key) => typeof key === "string" && fields.includes(key))
    );
  } catch {
    return false;
  }
}

function descriptorValue(value: Record<string, unknown>, field: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return invalidPayload();
    }
    return descriptor.value;
  } catch {
    return invalidPayload();
  }
}

function parseId(value: unknown): string {
  if (typeof value !== "string" || !safeIdPattern.test(value)) return invalidPayload();
  return value;
}

function parseReference(value: unknown): string {
  if (typeof value !== "string" || !referencePattern.test(value)) return invalidPayload();
  return value;
}

function parseAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return invalidPayload();
  }
  return value;
}

function parseDateTime(value: unknown): string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return invalidPayload();
  }
  return value;
}

function parseDescription(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return invalidPayload();
  }
  return value;
}

function parseManualInvoicePayload(
  value: unknown,
): Omit<IssueManualInvoiceInput, "academyId" | "actorId"> {
  const fields = [
    "familyId",
    "membershipId",
    "totalMinor",
    "dueAt",
    "chargeKind",
    "invoiceReference",
    "description",
  ] as const;
  if (!isPlainRecord(value) || !exactFields(value, fields)) return invalidPayload();
  const chargeKind = descriptorValue(value, "chargeKind");
  if (chargeKind !== "membership" && chargeKind !== "manual_adjustment") return invalidPayload();
  return Object.freeze({
    familyId: parseId(descriptorValue(value, "familyId")),
    membershipId: parseId(descriptorValue(value, "membershipId")),
    totalMinor: parseAmount(descriptorValue(value, "totalMinor")),
    dueAt: parseDateTime(descriptorValue(value, "dueAt")),
    chargeKind,
    invoiceReference: parseReference(descriptorValue(value, "invoiceReference")),
    description: parseDescription(descriptorValue(value, "description")),
  });
}

function parsePaymentPayload(
  value: unknown,
): Omit<RecordManualPaymentInput, "academyId" | "actorId"> {
  const fields = ["invoiceId", "amountMinor", "method", "manualReference", "occurredAt"] as const;
  if (!isPlainRecord(value) || !exactFields(value, fields)) return invalidPayload();
  const method = descriptorValue(value, "method");
  if (method !== "cash" && method !== "bank_transfer" && method !== "other")
    return invalidPayload();
  return Object.freeze({
    invoiceId: parseId(descriptorValue(value, "invoiceId")),
    amountMinor: parseAmount(descriptorValue(value, "amountMinor")),
    method,
    manualReference: parseReference(descriptorValue(value, "manualReference")),
    occurredAt: parseDateTime(descriptorValue(value, "occurredAt")),
  });
}

function parseInvoiceIdPayload(value: unknown): string {
  if (!isPlainRecord(value) || !exactFields(value, ["invoiceId"])) return invalidPayload();
  return parseId(descriptorValue(value, "invoiceId"));
}

function parseNoPayload(value: unknown): void {
  if (value !== null) invalidPayload();
}

async function requireActiveActor(
  request: CallableRequest<unknown>,
  services: FinanceCallableServices,
): Promise<UserActorContext> {
  const actor = requireUserActor(request);
  try {
    if (!(await services.isActorActive(actor))) permissionDenied();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new FinanceCallableError("failed-precondition", "Finance operation is not available");
  }
  return actor;
}

async function requireAdministrator(
  request: CallableRequest<unknown>,
  services: FinanceCallableServices,
): Promise<UserActorContext> {
  const actor = await requireActiveActor(request, services);
  if (actor.role !== "owner" && actor.role !== "administrator") permissionDenied();
  return actor;
}

async function readerScope(
  request: CallableRequest<unknown>,
  services: FinanceCallableServices,
): Promise<FinanceReadScope> {
  const actor = await requireActiveActor(request, services);
  if (actor.role === "owner" || actor.role === "administrator") {
    return Object.freeze({ academyId: actor.academyId });
  }
  if (actor.role === "guardian") {
    const projection = await services.familyStore.getGuardianFamily(actor.academyId, actor.userId);
    if (
      projection === undefined ||
      !projection.family.active ||
      projection.family.status !== "active"
    ) {
      permissionDenied();
    }
    return Object.freeze({ academyId: actor.academyId, familyIds: [projection.family.familyId] });
  }
  if (actor.role === "adultStudent") {
    const student = await services.findStudentByUserId(actor.academyId, actor.userId);
    if (student === undefined || !student.active || student.status !== "active") permissionDenied();
    return Object.freeze({
      academyId: actor.academyId,
      familyIds: [student.familyId],
      studentIds: [student.studentId],
    });
  }
  permissionDenied();
}

function mapStoreError(error: unknown, operation: "read" | "write"): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof FinanceCallableError) throw error;
  if (error instanceof FinanceStoreError) {
    if (error.code === "invalid")
      throw new FinanceCallableError("invalid-argument", "Finance payload is invalid");
    if (error.code === "tenant" || error.code === "not-found") permissionDenied();
    throw new FinanceCallableError(
      error.code === "conflict" || error.code === "precondition"
        ? "failed-precondition"
        : "internal",
      operation === "read" ? "Finance data is not available" : "Finance operation is not available",
    );
  }
  throw new FinanceCallableError(
    "internal",
    operation === "read" ? "Unable to load financial data" : "Unable to complete finance operation",
  );
}

export async function issueManualInvoiceHandler(
  request: CallableRequest<unknown>,
  services: FinanceCallableServices,
) {
  const actor = await requireAdministrator(request, services);
  const payload = parseManualInvoicePayload(request.data);
  try {
    return await services.store.issueManualInvoice({
      ...payload,
      academyId: actor.academyId,
      actorId: actor.userId,
    });
  } catch (error) {
    return mapStoreError(error, "write");
  }
}

export async function recordManualPaymentHandler(
  request: CallableRequest<unknown>,
  services: FinanceCallableServices,
) {
  const actor = await requireAdministrator(request, services);
  const payload = parsePaymentPayload(request.data);
  try {
    return await services.store.recordManualPayment({
      ...payload,
      academyId: actor.academyId,
      actorId: actor.userId,
    });
  } catch (error) {
    return mapStoreError(error, "write");
  }
}

export async function voidManualInvoiceHandler(
  request: CallableRequest<unknown>,
  services: FinanceCallableServices,
) {
  const actor = await requireAdministrator(request, services);
  const invoiceId = parseInvoiceIdPayload(request.data);
  try {
    const input: VoidManualInvoiceInput = {
      academyId: actor.academyId,
      actorId: actor.userId,
      invoiceId,
    };
    return await services.store.voidManualInvoice(input);
  } catch (error) {
    return mapStoreError(error, "write");
  }
}

export async function listFinancialAccountHandler(
  request: CallableRequest<unknown>,
  services: FinanceCallableServices,
) {
  parseNoPayload(request.data);
  try {
    return await services.store.listFinancialAccount(await readerScope(request, services));
  } catch (error) {
    return mapStoreError(error, "read");
  }
}

export async function getInvoiceHandler(
  request: CallableRequest<unknown>,
  services: FinanceCallableServices,
) {
  const invoiceId = parseInvoiceIdPayload(request.data);
  try {
    return await services.store.getInvoice(await readerScope(request, services), invoiceId);
  } catch (error) {
    return mapStoreError(error, "read");
  }
}

async function findStudentByUserId(
  academyId: string,
  userId: string,
): Promise<FinanceStudentScope | undefined> {
  const snapshot = await getFirestore()
    .collection(`academies/${academyId}/students`)
    .where("userId", "==", userId)
    .limit(2)
    .get();
  if (snapshot.docs.length !== 1) return undefined;
  const document = snapshot.docs[0];
  if (document === undefined) return undefined;
  const parsed = parseStudentProfile(document.data());
  if (!parsed.ok || document.id !== parsed.value.studentId) return undefined;
  const student = parsed.value;
  if (
    student.academyId !== academyId ||
    student.userId !== userId ||
    student.familyId === undefined
  ) {
    return undefined;
  }
  return {
    studentId: student.studentId,
    familyId: student.familyId,
    participantType: student.participantType,
    active: student.active,
    status: student.status,
  };
}

function financeCallableServices(): FinanceCallableServices {
  const firestore = getFirestore();
  return {
    store: createFinanceStore({
      firestore: firestore as unknown as Parameters<typeof createFinanceStore>[0]["firestore"],
      appendAudit: (transaction, ref, draft) =>
        appendAuditEventInTransaction(transaction, ref, draft as unknown as AuditEventDraft),
    }),
    familyStore: createFamilyStore({
      auth: {
        getUser: async (userId) => ({ uid: (await getAuth().getUser(userId)).uid }),
      },
      firestore: firestore as unknown as Parameters<typeof createFamilyStore>[0]["firestore"],
    }),
    findStudentByUserId,
    isActorActive: async (actor) => !(await getAuth().getUser(actor.userId)).disabled,
  };
}

export const financeCallableOptions = {
  enforceAppCheck: true,
  consumeAppCheckToken: true,
};

export const issueManualInvoice = onCall(financeCallableOptions, async (request) =>
  issueManualInvoiceHandler(request, financeCallableServices()),
);
export const recordManualPayment = onCall(financeCallableOptions, async (request) =>
  recordManualPaymentHandler(request, financeCallableServices()),
);
export const voidManualInvoice = onCall(financeCallableOptions, async (request) =>
  voidManualInvoiceHandler(request, financeCallableServices()),
);
export const listFinancialAccount = onCall(financeCallableOptions, async (request) =>
  listFinancialAccountHandler(request, financeCallableServices()),
);
export const getInvoice = onCall(financeCallableOptions, async (request) =>
  getInvoiceHandler(request, financeCallableServices()),
);
