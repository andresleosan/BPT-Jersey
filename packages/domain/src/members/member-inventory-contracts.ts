import { z } from "zod";

export const inventoryCollections = [
  "members", "regyfitMemberRecords", "students", "studentAdminProfiles", "users",
  "families", "relationships", "memberships", "regyfitOfficeLinks", "regyfitMemberLinks",
  "memberRecoverySourceLinks", "memberMigrationDecisions", "bookings", "attendance",
  "invoices", "payments",
] as const;
export const inventoryCollectionSchema = z.enum(inventoryCollections);
export type InventoryCollection = z.infer<typeof inventoryCollectionSchema>;
export const inventoryIssueCodes = [
  "invalid-record", "invalid-id", "tenant-mismatch", "identity-mismatch", "missing-version",
  "missing-date-of-birth", "guardian-review-required", "unlinked-source", "conflicting-links",
  "dangling-student", "dangling-family", "dangling-user", "dangling-membership",
  "dangling-session", "dangling-invoice", "archive-history-partial", "duplicate-review-required",
] as const;
export type InventoryIssueCode = (typeof inventoryIssueCodes)[number];
export const inventoryPageInputSchema = z.strictObject({
  collection: inventoryCollectionSchema,
  cursor: z.uuid().optional(),
});
export const inventoryRowSchema = z.strictObject({
  id: z.string().min(1).max(1500),
  version: z.string().min(1).max(160),
  issueCodes: z.array(z.enum(inventoryIssueCodes)).max(inventoryIssueCodes.length),
  canonicalStudentId: z.string().max(128).nullable(),
  capturedAt: z.string().max(40).nullable(),
  historyCoverage: z.enum(["partial", "unknown", "not-applicable"]),
});
export type InventoryRow = z.infer<typeof inventoryRowSchema>;
export const inventoryPageSchema = z.strictObject({
  collection: inventoryCollectionSchema,
  rows: z.array(inventoryRowSchema).max(100),
  nextCursor: z.uuid().nullable(),
  complete: z.boolean(),
  observedAt: z.iso.datetime(),
  counts: z.strictObject({
    documents: z.number().int().min(0).max(100),
    linkedDocuments: z.number().int().min(0).max(100),
    documentsRequiringReview: z.number().int().min(0).max(100),
  }),
}).refine((page) => page.complete === (page.nextCursor === null));
export type InventoryPage = z.infer<typeof inventoryPageSchema>;

/** Page counts are documents, never a claim of unique people or complete lifetime history. */
export interface MemberInventoryService {
  page(academyId: string, collection: InventoryCollection, cursor?: string): Promise<InventoryPage>;
}
