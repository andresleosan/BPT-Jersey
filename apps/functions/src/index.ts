import { initializeApp } from "firebase-admin/app";

initializeApp();

export { sweepSessionQuorumsSchedule } from "./schedule/quorum-sweep-schedule.js";

export { signInStaffWithId, changeStaffIdPassword } from "./staff/staff-login-callables.js";

export {
  assertAcademyScope,
  getRegyfitProjectionScope,
  requireAdminActor,
} from "./auth/admin-authorization.js";
export type { AdminActor } from "./auth/admin-authorization.js";
export { bootstrapEmulatorOwner, provisionAdminRole } from "./auth/admin-provisioning.js";
export { registerShopperAccount } from "./auth/shopper-callables.js";
export { listRegyfitAccessRecords } from "./regyfit/access-records.js";
export { getRegyfitMemberRecord, listRegyfitMemberRecords } from "./regyfit/member-records.js";
export { cleanupExpiredMemberImportSessionsSchedule } from "./members/member-callables.js";
export {
  approveEnrolmentRequest,
  getEnrolmentRequestDetail,
  listEnrolmentRequests,
  listMyEnrolmentRequests,
  returnEnrolmentRequest,
  submitEnrolmentRequest,
  withdrawEnrolmentRequest,
} from "./members/enrolment-request-callables.js";
export {
  cleanupExpiredCanonicalMemberImportSessionsSchedule,
  confirmMemberPdfImport,
  createMemberPdfImportSession,
  previewMemberPdfImport,
  reviewMemberPdfImportMatches,
} from "./members/canonical-member-import-callables.js";
export {
  createCanonicalMember as createMember,
  getMemberDetail,
  initializeCanonicalMemberDirectory,
  listMembers,
  lookupMemberIdentity,
  revealRegyfitRecordField,
  updateCanonicalMember as updateMember,
} from "./members/member-directory-callables.js";
export {
  decideMemberMigration,
  listMemberMigrationQueue,
} from "./members/member-migration-callables.js";
export { listMemberNames } from "./members/member-names-callables.js";
export { getMemberProfile, searchMemberNames } from "./members/member-profile-callables.js";
export { exportClassHistoryPdf, listClassHistory } from "./audit/class-history-callables.js";
export { sweepClassIpRetentionSchedule } from "./audit/class-ip-retention-sweep.js";
export { getClientProfile, saveClientProfile } from "./profiles/profile-callables.js";
export { getGuardianProfile, saveGuardianProfile } from "./profiles/guardian-profile-callables.js";
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
  listManagedPlans,
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
  getFamilyFinancialAccount,
  getInvoice,
  issueManualInvoice,
  listFinancialAccount,
  listRecentPayments,
  savePaymentInstructions,
  recordManualPayment,
  voidManualInvoice,
} from "./finance/finance-callables.js";
export { getFinancialDashboard } from "./finance/financial-dashboard-callables.js";
export {
  approvePromotion,
  assignLevel,
  getStudentLevelHistory,
  getStudentProgressSummary,
  listGraduations,
  listLevelCatalog,
  listMedicalLeaves,
  listRecognitionCandidates,
  listStudentEvaluations,
  openStudentLevel,
  recordEvaluation,
  recordMedicalLeave,
  rejectPromotion,
  voidPromotion,
} from "./levels/level-callables.js";
export { getProgressReport } from "./levels/progress-report-callables.js";
export { getFamilyAchievementSummary } from "./levels/family-achievement-callables.js";
export { approveLessonPlan, getLessonPlan } from "./levels/lesson-planning-callables.js";
export { getOperationalReport } from "./reports/operational-report-callables.js";
export { prepareAggregateReportExport } from "./exports/aggregate-report-export-callables.js";
export {
  cancelBooking,
  cancelSession,
  checkIn,
  copyWeek,
  correctAttendance,
  deleteWeek,
  evaluateSessionMinimum,
  generateSessions,
  getDailyOperationsDashboard,
  getSessionOperationalView,
  getStudentCheckout,
  listAttendanceHistory,
  listClasses,
  listScheduleCatalog,
  listSessionAttendance,
  listSessionBookedCounts,
  listSessionBookings,
  listSessionCheckouts,
  listSessions,
  listStudentAttendance,
  listStudentBookings,
  previewWeek,
  reconcileSessionNoShows,
  reconcileSessionQuorum,
  recordCheckout,
  removeClass,
  requestBooking,
  saveClass,
  saveLocation,
  saveLocationGeofence,
  saveProgram,
  saveSession,
  selfCheckIn,
  updateClass,
  updateLocation,
  updateProgram,
  updateSession,
} from "./schedule/schedule-callables.js";
export {
  listNoShowPenalties,
  proposeNoShowPenalties,
  resolveNoShowPenalty,
} from "./penalties/no-show-penalty-callables.js";
export {
  acceptDisclaimer,
  getOutstandingDisclaimers,
  listDisclaimers,
  publishDisclaimer,
  withdrawDisclaimer,
  withdrawDisclaimerAcceptance,
} from "./consents/disclaimer-callables.js";
export {
  grantStaffPermission,
  listStaffPermissionGrants,
  revokeStaffPermission,
} from "./staff/permission-grant-callables.js";
export { listUpcomingBirthdays } from "./birthdays/upcoming-birthday-callables.js";
export { getPreClassView } from "./schedule/pre-class-callables.js";
export {
  acceptWaitlistOffer,
  cancelWaitlistEntry,
  declineWaitlistOffer,
  issueNextWaitlistOffer,
  joinWaitlist,
  listSessionWaitlist,
  listStudentWaitlist,
} from "./schedule/advanced-booking-callables.js";
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
export { listRetentionAlerts } from "./retention/retention-alert-callables.js";
export {
  listNotificationPreferences,
  saveNotificationPreference,
} from "./delivery/notification-preference-callables.js";
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
  listHealthReferences,
  saveHealthReferenceLabel,
} from "./health/health-callables.js";
export {
  createPrivateWaiverUpload,
  finalizePrivateWaiverUpload,
  getPrivateWaiverDownload,
  revokePrivateWaiver,
} from "./documents/private-document-callables.js";
export {
  acceptWaiver,
  getCurrentWaiverAdmin,
  getWaiverEvidenceDownload,
  getWaiverRegistration,
  publishWaiverVersion,
  revokeWaiverConsent,
  withdrawCurrentWaiver,
} from "./consents/consent-callables.js";
export {
  createCrmLead,
  listCrmLeads,
  updateCrmLead,
  transitionCrmLead,
  listCrmLeadTimeline,
} from "./crm/crm-callables.js";
export {
  listManagedShopProducts,
  listMyShopOrders,
  listPublicShopCatalog,
  listShopCatalog,
  listShopOrders,
  placeShopOrder,
  saveShopProduct,
  setShopProductActive,
  updateShopOrder,
} from "./shop/shop-callables.js";

// Member engagement features, one file per team (phase 0, T041V2).
export * from "./streak/streak-callables.js";
export * from "./competitors/competitors-callables.js";
export * from "./account-settings/account-settings-callables.js";
export {
  beginMemberRecovery,
  completeMemberRecovery,
  listMemberRecoveryRequests,
  getMemberRecoveryDetail,
  getMemberRecoveryHistory,
  reviewMemberRecovery,
} from "./members/member-recovery-callables.js";

export {
  listMemberSubscriptions,
  updateMemberSubscription,
} from "./memberships/subscription-admin-callables.js";
export {
  listAdminNotifications,
  updateAdminNotification,
} from "./notifications/admin-notification-callables.js";
export {
  subscriptionExpiryNoticeWritten,
  subscriptionExpiryNoticesSchedule,
  adminOperationalNotificationCreated,
} from "./notifications/admin-notification-triggers.js";

export {
  resolveMemberSubscriptionProfile,
  registerImportedMemberForOffice,
} from "./members/member-directory-callables.js";
export {
  manageMemberSubscription,
  listMemberSubscriptionBilling,
} from "./memberships/subscription-admin-callables.js";

export {
  assignMemberGuardian,
  setMemberDateOfBirth,
} from "./members/member-migration-callables.js";
export { listMemberClassRecords } from "./schedule/member-class-records-callables.js";

export {
  listTeamDirectory,
  changeTeamRole,
  createStaffInvitation,
  listStaffInvitations,
  cancelStaffInvitation,
  acceptStaffInvitation,
} from "./staff/team-access-callables.js";

export {
  uploadEnrolmentPaymentProof,
  getEnrolmentPaymentInstructions,
} from "./members/enrolment-payment-proof.js";

export { getStudentGroupAccess, saveStudentGroupAccess } from "./schedule/student-group-access-callables.js";

export { getMemberInventoryPage } from "./members/member-inventory-callables.js";

export { getMemberReconciliationCase, decideMemberReconciliation, closeMemberReconciliation, previewMemberIdentityAlias, approveMemberIdentityAlias } from "./members/member-reconciliation-callables.js";

export { getMemberHistory, reviewMemberHistoryEntry, saveMemberAttendanceBaseline } from "./members/member-history-callables.js";

export {
  getCourseSession,
  saveCourse,
  publishCourse,
  reviseCourseSession,
  saveCourseCandidate,
  reserveCourse,
  joinCourseWaitlist,
  cancelUnapprovedCourseEnrolment,
  uploadCourseProof,
  submitCoursePayment,
  getCourseProofUrl,
  approveCourseEnrolment,
  reviewCourseEnrolment,
  requestCourseWithdrawal,
  decideCourseWithdrawal,
  recordCourseRefund,
  resolveCoursePaymentIncident,
  listCourses,
  getCourse,
  listCourseEnrolments,
  getCourseEnrolment,
  listCourseParticipants,
  getCoursePaymentInstructions,
  listCourseNotices,
  markCourseNoticeRead,
  listCourseRefunds,
  listCoursePaymentIncidents,
  setCourseAbsence,
  courseSelfCheckIn,
  cancelCourse,
  retryCourseJob,
  listCourseJobs,
  getCourseEnrolmentDetail,
  listCourseSessionDates,
  listCourseCoaches,
  reviseCourseLocalSession,
  getCourseCalendar,
  listCourseRoster,
  exportCourseSubject
} from "./courses/course-callables.js";
export { coursePublic } from "./courses/course-public-http.js";
export { courseScheduler, courseProofCleanup } from "./courses/course-scheduler.js";

export { changeChildGuardian } from "./families/family-callables.js";

export { listMyMemberProfiles } from "./members/member-access-callables.js";
