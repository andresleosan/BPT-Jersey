import { initializeApp } from "firebase-admin/app";

initializeApp();

export {
  assertAcademyScope,
  getRegyfitProjectionScope,
  requireAdminActor,
} from "./auth/admin-authorization.js";
export type { AdminActor } from "./auth/admin-authorization.js";
export {
  bootstrapEmulatorOwner,
  provisionAdminRole,
  writeImportAuditEvent,
} from "./auth/admin-provisioning.js";
export type { AuditEventMetadata } from "./auth/admin-provisioning.js";
export { listRegyfitAccessRecords } from "./regyfit/access-records.js";
export {
  cleanupExpiredMemberImportSessions,
  cleanupExpiredMemberImportSessionsSchedule,
  confirmMemberPdfImport,
  createMember,
  createMemberPdfImportSession,
  getMemberReport,
  getMemberReportPdf,
  getMemberReportSummary,
  previewMemberPdfImport,
  searchMembers,
} from "./members/member-callables.js";
