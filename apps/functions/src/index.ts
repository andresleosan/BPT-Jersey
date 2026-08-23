import { initializeApp } from "firebase-admin/app";

initializeApp();

export {
  assertAcademyScope,
  getRegyfitProjectionScope,
  requireAdminActor,
} from "./auth/admin-authorization.js";
export type { AdminActor } from "./auth/admin-authorization.js";
export { bootstrapEmulatorOwner, provisionAdminRole } from "./auth/admin-provisioning.js";
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
export { getClientProfile, saveClientProfile } from "./profiles/profile-callables.js";
export { createFamily, getFamily, updateFamily } from "./families/family-callables.js";
export {
  createStaffProfile,
  listStaffProfiles,
  replaceStaffAssignments,
  replaceStaffAvailability,
  setStaffActive,
  updateStaffProfile,
} from "./staff/staff-callables.js";
export {
  activatePlan,
  deactivatePlan,
  getPlan,
  listPlans,
  savePlan,
} from "./memberships/plan-callables.js";
export {
  cancelMembership,
  createMembership,
  getMembership,
  listMemberships,
  transitionMembership,
} from "./memberships/membership-callables.js";
export {
  getInvoice,
  issueManualInvoice,
  listFinancialAccount,
  recordManualPayment,
  voidManualInvoice,
} from "./finance/finance-callables.js";
export {
  getStudentProgressSummary,
  listLevelCatalog,
  listStudentEvaluations,
  recordEvaluation,
} from "./levels/level-callables.js";
export {
  cancelBooking,
  cancelSession,
  checkIn,
  evaluateSessionMinimum,
  generateSessions,
  listClasses,
  listScheduleCatalog,
  listSessionAttendance,
  listSessionBookings,
  listSessions,
  listStudentAttendance,
  listStudentBookings,
  requestBooking,
  saveClass,
  saveProgram,
  saveSession,
} from "./schedule/schedule-callables.js";
