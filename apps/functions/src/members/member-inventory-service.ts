import { matchesProvisionedMemberDirectoryActor } from "./member-directory-actor-authorization.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parseMemberRecord } from "@bpt-jersey/domain/members";
import { studentAdminProfileSchema } from "@bpt-jersey/domain/members/directory";
import { parseStoredRegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import { memberMigrationDecisionRecordSchema } from "@bpt-jersey/domain/members/migration";
import { parseStudentProfileAt, parseUserProfile } from "@bpt-jersey/domain/profiles";
import { parseFamilyRecord, parseFamilyRelationship } from "@bpt-jersey/domain/families";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import { parseInvoiceRecord, parseManualPaymentRecord } from "@bpt-jersey/domain/finance";
import {
  inventoryPageInputSchema, inventoryPageSchema,
  type InventoryCollection, type InventoryIssueCode, type InventoryRow, type MemberInventoryService,
} from "@bpt-jersey/domain/members/inventory";
import { bookingStatuses, attendanceStates, checkInMethods } from "@bpt-jersey/domain/schedule";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import type { CanonicalMemberDirectoryActor } from "./canonical-member-directory-service.js";
import {
  runRestricted, CanonicalMemberDirectoryReadError,
  type CanonicalMemberDirectoryReadDependencies, type CanonicalDirectoryReadTransaction,
  type DirectoryReadDocument,
} from "./canonical-member-directory-read-service.js";

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const storedId = z.string().min(1).max(1500);
const instant = z.iso.datetime();
const recordAudit = {
  academyId: z.string().regex(identifier), schemaVersion: z.literal("1"),
  createdAt: instant, createdBy: storedId, updatedAt: instant, updatedBy: storedId,
};
// Schedule records have no exported stored-record parser. Validate their persisted fields here.
const bookingSchema = z.object({ ...recordAudit, bookingId: storedId, sessionId: storedId,
  studentId: storedId, membershipId: storedId, status: z.enum(bookingStatuses),
  requestedAt: instant, cancelledAt: instant.nullable(), cancellationReason: z.string().nullable(),
});
const attendanceSchema = z.object({ ...recordAudit, attendanceId: storedId, sessionId: storedId,
  studentId: storedId, method: z.enum(checkInMethods),
  state: z.enum(attendanceStates), occurredAt: instant,
  notes: z.string().nullable(), correctionOf: z.string().nullable(),
});
const linkSchema = z.object({ academyId: z.string().regex(identifier), recordId: storedId,
  studentId: z.string().regex(identifier), schemaVersion: z.literal("1"),
});
const cursorSchema = z.strictObject({ kind: z.literal("member-inventory-v1"),
  academyId: z.string(), actorId: z.string(), role: z.enum(["owner", "administrator"]),
  collection: inventoryPageInputSchema.shape.collection, afterDocumentId: storedId,
  issuedAt: instant, expiresAt: instant,
});

function validRecord(collection: InventoryCollection, value: Record<string, unknown>, today: string): boolean {
  switch (collection) {
    case "members": return parseMemberRecord(value).ok;
    case "regyfitMemberRecords": return parseStoredRegyfitMemberRecord(value).ok;
    case "students": return parseStudentProfileAt(value, today).ok;
    case "studentAdminProfiles": return studentAdminProfileSchema.safeParse(value).success;
    case "users": return parseUserProfile(value).ok ||
      ((value.adminRole === "owner" || value.adminRole === "administrator") && typeof value.userId === "string" && typeof value.academyId === "string" &&
        matchesProvisionedMemberDirectoryActor(value, { actorId: value.userId, academyId: value.academyId, role: value.adminRole }));
    case "families": return parseFamilyRecord(value).ok;
    case "relationships": return parseFamilyRelationship(value).ok;
    case "memberships": return parseMembershipRecord(value).ok;
    case "invoices": return parseInvoiceRecord(value).ok;
    case "payments": return parseManualPaymentRecord(value).ok;
    case "memberMigrationDecisions": return memberMigrationDecisionRecordSchema.safeParse(value).success;
    case "bookings": return bookingSchema.safeParse(value).success;
    case "attendance": return attendanceSchema.safeParse(value).success;
    default: return linkSchema.safeParse(value).success;
  }
}
const identityFields: Record<InventoryCollection, string> = {
  members: "memberId", regyfitMemberRecords: "recordId", students: "studentId",
  studentAdminProfiles: "studentId", users: "userId", families: "familyId",
  relationships: "relationshipId", memberships: "membershipId", regyfitOfficeLinks: "recordId",
  regyfitMemberLinks: "recordId", memberRecoverySourceLinks: "recordId",
  memberMigrationDecisions: "legacyMemberId", bookings: "bookingId", attendance: "attendanceId",
  invoices: "invoiceId", payments: "paymentId",
};

async function inspectRow(
  transaction: CanonicalDirectoryReadTransaction, academyId: string, collection: InventoryCollection,
  document: DirectoryReadDocument, now: string,
): Promise<InventoryRow> {
  const raw = document.data ?? {};
  const issues = new Set<InventoryIssueCode>();
  if (!document.exists || !validRecord(collection, raw, dateKeyInJersey(new Date(now)))) issues.add("invalid-record");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,1499}$/u.test(document.id)) issues.add("invalid-id");
  if (!document.version) issues.add("missing-version");
  if (raw.academyId !== undefined && raw.academyId !== academyId) issues.add("tenant-mismatch");
  // Recovery link document IDs are opaque request/source hashes, not source record IDs.
  if (collection !== "memberRecoverySourceLinks" && raw[identityFields[collection]] !== document.id) {
    issues.add("identity-mismatch");
  }
  const reference = async (field: string, target: string, issue: InventoryIssueCode) => {
    const id = raw[field];
    if (id === undefined || id === null) return;
    if (typeof id !== "string" || !identifier.test(id)) { issues.add(issue); return; }
    const linked = await transaction.get(`academies/${academyId}/${target}/${id}`);
    if (!linked.exists || !linked.data ||
        (linked.data.academyId !== undefined && linked.data.academyId !== academyId)) issues.add(issue);
  };
  let studentId = typeof raw.studentId === "string" && identifier.test(raw.studentId) ? raw.studentId : null;
  if (collection !== "students") await reference("studentId", "students", "dangling-student");
  if (collection !== "families") await reference("familyId", "families", "dangling-family");
  if (collection !== "users") await reference("userId", "users", "dangling-user");
  if (collection === "relationships") await reference("adultUserId", "users", "dangling-user");
  if (collection !== "memberships") await reference("membershipId", "memberships", "dangling-membership");
  if (collection === "bookings" || collection === "attendance") await reference("sessionId", "sessions", "dangling-session");
  if (collection === "payments") await reference("invoiceId", "invoices", "dangling-invoice");
  if (collection === "students") {
    if (!raw.dateOfBirth) issues.add("missing-date-of-birth");
    if (raw.guardianStatus === "pending") issues.add("guardian-review-required");
  }
  if (collection === "regyfitMemberRecords" && identifier.test(document.id)) {
    const links = await Promise.all(["regyfitOfficeLinks", "regyfitMemberLinks"].map((name) =>
      transaction.get(`academies/${academyId}/${name}/${document.id}`)));
    if (links.some((link) => link.exists &&
        (!linkSchema.safeParse(link.data).success || link.data?.academyId !== academyId || link.data?.recordId !== document.id))) {
      issues.add("conflicting-links");
    }
    const linkedIds = new Set(links.filter((link) => link.exists).map((link) => link.data?.studentId));
    if (linkedIds.size === 0) issues.add("unlinked-source");
    if (linkedIds.size > 1 || linkedIds.has(undefined)) issues.add("conflicting-links");
    const candidate = [...linkedIds][0];
    studentId = linkedIds.size === 1 && typeof candidate === "string" && identifier.test(candidate) ? candidate : null;
    if (studentId) {
      const linked = await transaction.get(`academies/${academyId}/students/${studentId}`);
      if (!linked.exists) issues.add("dangling-student");
    }
    issues.add("archive-history-partial");
  }
  if (collection === "members" && identifier.test(document.id)) {
    const decision = await transaction.get(`academies/${academyId}/memberMigrationDecisions/${document.id}`);
    const candidate = decision.data?.studentId;
    studentId = typeof candidate === "string" && identifier.test(candidate) ? candidate : null;
    if (!studentId && decision.data?.kind !== "skip") issues.add("unlinked-source");
  }
  return {
    id: document.id, version: document.version ?? "unavailable", issueCodes: [...issues],
    canonicalStudentId: issues.has("conflicting-links") || issues.has("dangling-student") ? null : studentId,
    capturedAt: typeof raw.capturedAt === "string" && instant.safeParse(raw.capturedAt).success ? raw.capturedAt : null,
    historyCoverage: collection === "regyfitMemberRecords" ? "partial" : "not-applicable",
  };
}

/** Reads source metadata only; the only writes are the existing read budget/audit and opaque cursors. */
export function createMemberInventoryService(
  dependencies: CanonicalMemberDirectoryReadDependencies, actor: CanonicalMemberDirectoryActor,
  now: () => string = () => new Date().toISOString(),
): MemberInventoryService {
  return {
    async page(academyId, collection, cursor) {
      if (academyId !== actor.academyId) throw new CanonicalMemberDirectoryReadError("unauthorized", "Academy mismatch");
      const input = inventoryPageInputSchema.safeParse({ collection, ...(cursor ? { cursor } : {}) });
      if (!input.success) throw new CanonicalMemberDirectoryReadError("invalid", "Invalid inventory request");
      const time = now();
      return runRestricted({ command: { actor, value: input.data, now: time }, dependencies,
        action: "member.inventory.read", purpose: "member-inventory-review", requiresCanonicalReader: false,
        operation: async (transaction) => {
          if (!transaction.listCollection) throw new CanonicalMemberDirectoryReadError("unavailable", "Inventory is unavailable");
          let afterDocumentId: string | undefined;
          if (cursor) {
            const stored = await transaction.get(`academies/${academyId}/memberDirectoryCursorStates/${cursor}`);
            const parsed = cursorSchema.safeParse(stored.data);
            if (!parsed.success || parsed.data.academyId !== academyId || parsed.data.actorId !== actor.actorId ||
                parsed.data.role !== actor.role || parsed.data.collection !== collection ||
                Date.parse(parsed.data.expiresAt) <= Date.parse(time) || Date.parse(parsed.data.issuedAt) > Date.parse(time)) {
              throw new CanonicalMemberDirectoryReadError("invalid", "Invalid or expired inventory cursor");
            }
            afterDocumentId = parsed.data.afterDocumentId;
          }
          const documents = await transaction.listCollection({ academyId, collection, limit: 101,
            ...(afterDocumentId === undefined ? {} : { afterDocumentId }) });
          const selected = documents.slice(0, 100);
          const rows = await Promise.all(selected.map((doc) => inspectRow(transaction, academyId, collection, doc, time)));
          const complete = documents.length <= 100;
          const nextCursor = complete ? null : randomUUID();
          if (nextCursor) transaction.create(`academies/${academyId}/memberDirectoryCursorStates/${nextCursor}`, {
            kind: "member-inventory-v1", academyId, actorId: actor.actorId, role: actor.role, collection,
            afterDocumentId: selected[selected.length - 1]!.id, issuedAt: time,
            expiresAt: new Date(Date.parse(time) + 30 * 60_000).toISOString(),
          });
          const value = inventoryPageSchema.parse({ collection, rows, nextCursor, complete, observedAt: time,
            counts: { documents: rows.length, linkedDocuments: rows.filter((row) => row.canonicalStudentId !== null).length,
              documentsRequiringReview: rows.filter((row) => row.issueCodes.length > 0).length } });
          return { kind: "success", value, auditResult: "completed" };
        },
      });
    },
  };
}
