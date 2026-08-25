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
export { getFinancialDashboard } from "./finance/financial-dashboard-callables.js";
export {
  approvePromotion,
  getStudentProgressSummary,
  listGraduations,
  listLevelCatalog,
  listMedicalLeaves,
  listRecognitionCandidates,
  listStudentEvaluations,
  recordEvaluation,
  recordMedicalLeave,
  rejectPromotion,
} from "./levels/level-callables.js";
export { getProgressReport } from "./levels/progress-report-callables.js";
export { getOperationalReport } from "./reports/operational-report-callables.js";
export { prepareAggregateReportExport } from "./exports/aggregate-report-export-callables.js";
export {
  cancelBooking,
  cancelSession,
  checkIn,
  correctAttendance,
  evaluateSessionMinimum,
  generateSessions,
  getDailyOperationsDashboard,
  getSessionOperationalView,
  getStudentCheckout,
  listAttendanceHistory,
  listClasses,
  listScheduleCatalog,
  listSessionAttendance,
  listSessionBookings,
  listSessionCheckouts,
  listSessions,
  listStudentAttendance,
  listStudentBookings,
  reconcileSessionNoShows,
  recordCheckout,
  requestBooking,
  saveClass,
  saveProgram,
  saveSession,
} from "./schedule/schedule-callables.js";
export {
  archiveAnnouncement,
  createAnnouncement,
  listAnnouncements,
  listGuardianNotices,
  markAnnouncementAsRead,
  markNoticeAsRead,
  publishAnnouncement,
  sendMinorNotice,
  updateAnnouncement,
} from "./announcements/announcement-callables.js";
export { listClientReminders } from "./reminders/reminder-callables.js";
export {
  createTenantBackup,
  prepareTenantRestore,
  verifyTenantBackup,
} from "./data/backup-callables.js";

export {
  getHealthProfile,
  saveHealthProfile,
  deactivateHealthProfile,
  createHealthProfileChangeRequest,
  cancelHealthProfileChangeRequest,
  reviewHealthProfileChangeRequest,
} from "./health/health-callables.js";
export {
  createPrivateWaiverUpload,
  finalizePrivateWaiverUpload,
  getPrivateWaiverDownload,
  revokePrivateWaiver,
} from "./documents/private-document-callables.js";
