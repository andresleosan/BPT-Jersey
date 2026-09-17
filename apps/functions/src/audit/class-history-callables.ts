import { randomUUID } from "node:crypto";

import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import type { AcademyId, CorrelationId, UserId } from "@bpt-jersey/domain";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  isClassHistoryRegistrationType,
  type ClassHistoryFilterSummary,
  type ListClassHistoryInput,
} from "@bpt-jersey/domain/audit/class-history";

import {
  assertAcademyScope,
  requireAdminActor,
  type AdminActor,
} from "../auth/admin-authorization.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { appendAuditEventInTransaction } from "./audit-writer.js";
import { createClassHistoryStore } from "./class-history-firestore.js";
import { buildClassHistoryPdf } from "./class-history-pdf.js";
import {
  classHistoryMinimumLimit,
  readClassHistory,
  type ClassHistoryPage,
  type ClassHistoryStore,
} from "./class-history-service.js";

/**
 * The class registrations log, as the admin panel reads it. Only an administrative actor inside
 * their own academy gets here, and every listing - on screen or as a PDF - is recorded as a
 * restricted read before it is answered: the log names members and, for an owner, the address the
 * booking came from.
 */
export type ClassHistoryExport = Readonly<{
  pdfBase64: string;
  fileName: string;
}>;

export type ClassHistoryCallableServices = Readonly<{
  storeFor: (academyId: string) => ClassHistoryStore;
  recordRead: (draft: AuditEventDraft) => Promise<void>;
  now?: () => string;
  correlationId?: () => string;
}>;

type ClassHistoryReadResult = "completed" | "unavailable";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const inputFields = Object.freeze([
  "academyId",
  "since",
  "actorId",
  "registrationType",
  "limit",
  "cursor",
] as const);

const jerseyDateParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function invalidRequest(): never {
  throw new HttpsError("invalid-argument", "Class history request is invalid");
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" && timestampPattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

function optionalIdentifier(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !identifierPattern.test(value)) invalidRequest();
  return value;
}

/**
 * Hand-rolled because functions never parse with zod. The limit is checked for being a whole
 * number and nothing more: the range belongs to the service, which clamps it, and a second clamp
 * here would be a second place to get it wrong.
 */
function parseListInput(data: unknown): ListClassHistoryInput {
  if (typeof data !== "object" || data === null || Array.isArray(data)) invalidRequest();
  const record = data as Record<string, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !inputFields.includes(key as (typeof inputFields)[number])) {
      invalidRequest();
    }
  }

  const academyId = record.academyId;
  if (typeof academyId !== "string" || !identifierPattern.test(academyId)) invalidRequest();
  const since = record.since;
  if (!isTimestamp(since)) invalidRequest();

  const registrationTypeValue = record.registrationType ?? "all";
  if (!isClassHistoryRegistrationType(registrationTypeValue)) invalidRequest();

  const limitValue = record.limit ?? classHistoryMinimumLimit;
  if (typeof limitValue !== "number" || !Number.isInteger(limitValue)) invalidRequest();

  const cursorValue = record.cursor ?? null;
  if (cursorValue !== null && !isTimestamp(cursorValue)) invalidRequest();

  return Object.freeze({
    academyId,
    since,
    actorId: optionalIdentifier(record.actorId),
    registrationType: registrationTypeValue,
    limit: limitValue,
    cursor: cursorValue,
  });
}

function filterSummary(input: ListClassHistoryInput): ClassHistoryFilterSummary {
  return Object.freeze({
    since: input.since,
    actorId: input.actorId,
    registrationType: input.registrationType,
    limit: input.limit,
  });
}

function nowIso(services: ClassHistoryCallableServices): string {
  return services.now?.() ?? new Date().toISOString();
}

/** The generation day in Jersey, so a PDF made at 00:30 BST is not filed under the day before. */
function jerseyDay(generatedAt: string): string {
  const parts = new Map(
    jerseyDateParts.formatToParts(new Date(generatedAt)).map((part) => [part.type, part.value]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new HttpsError("internal", "Unable to export the class history");
  }
  return `${year}-${month}-${day}`;
}

/**
 * The ledger entry points at the reader's own restricted-read budget, never at what was read:
 * exactly as the member record reads do, so the log states that somebody spent a restricted read
 * without repeating the Confidential material in a second place.
 */
function readAuditDraft(
  actor: AdminActor,
  result: ClassHistoryReadResult,
  correlationId: string,
): AuditEventDraft {
  return {
    academyId: actor.academyId as AcademyId,
    actorId: actor.uid as UserId,
    action: "class.history.read",
    targetRef: `academies/${actor.academyId}/studentRestrictedReadLimits/${actor.uid}`,
    purpose: "class-history-read",
    correlationId: correlationId as CorrelationId,
    result,
  };
}

async function recordRead(
  services: ClassHistoryCallableServices,
  actor: AdminActor,
  result: ClassHistoryReadResult,
): Promise<void> {
  const correlationId = services.correlationId?.() ?? `class-history-${randomUUID()}`;
  try {
    await services.recordRead(readAuditDraft(actor, result, correlationId));
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Unable to record the class history read");
  }
}

async function auditedRead(
  services: ClassHistoryCallableServices,
  actor: AdminActor,
  input: ListClassHistoryInput,
): Promise<ClassHistoryPage> {
  let page: ClassHistoryPage;
  try {
    page = await readClassHistory(services.storeFor(input.academyId), input, {
      uid: actor.uid,
      academyId: actor.academyId,
      role: actor.role,
    });
  } catch {
    // The attempt is recorded before the caller is told anything: a read that failed is still a
    // read that was tried, and the message carries no personal data.
    await recordRead(services, actor, "unavailable");
    throw new HttpsError("unavailable", "The class history is unavailable");
  }
  await recordRead(services, actor, "completed");
  return page;
}

export async function handleListClassHistory(
  services: ClassHistoryCallableServices,
  request: CallableRequest<unknown>,
): Promise<ClassHistoryPage> {
  const actor = requireAdminActor(request);
  const input = parseListInput(request.data);
  assertAcademyScope(actor, input.academyId);
  return await auditedRead(services, actor, input);
}

export async function handleExportClassHistoryPdf(
  services: ClassHistoryCallableServices,
  request: CallableRequest<unknown>,
): Promise<ClassHistoryExport> {
  const actor = requireAdminActor(request);
  const input = parseListInput(request.data);
  assertAcademyScope(actor, input.academyId);
  const page = await auditedRead(services, actor, input);
  const generatedAt = nowIso(services);
  const bytes = await buildClassHistoryPdf({
    rows: page.rows,
    filters: filterSummary(input),
    generatedAt,
  });
  return Object.freeze({
    pdfBase64: Buffer.from(bytes).toString("base64"),
    fileName: `class-history-${jerseyDay(generatedAt)}.pdf`,
  });
}

function callableServices(): ClassHistoryCallableServices {
  return {
    storeFor: (academyId) => createClassHistoryStore(getFirestore(), academyId),
    recordRead: async (draft) => {
      const firestore = getFirestore();
      await firestore.runTransaction(async (transaction) => {
        const reference = firestore.collection(`academies/${draft.academyId}/auditEvents`).doc();
        appendAuditEventInTransaction(transaction, reference, draft);
      });
    },
  };
}

export const listClassHistory = onCall(browserAdminCallableOptions, (request) =>
  handleListClassHistory(callableServices(), request),
);

export const exportClassHistoryPdf = onCall(browserAdminCallableOptions, (request) =>
  handleExportClassHistoryPdf(callableServices(), request),
);
