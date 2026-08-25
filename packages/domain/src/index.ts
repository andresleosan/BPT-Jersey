export { domainModules } from "./modules";
export type { DomainModule } from "./modules";

export type {
  AcademyId,
  AssessmentId,
  AttendanceId,
  AuditEventId,
  BookingId,
  ClassId,
  CorrelationId,
  DocumentId,
  EntityId,
  FamilyId,
  InvoiceId,
  LeadId,
  MembershipId,
  MessageId,
  PaymentId,
  ProgramId,
  RecognitionId,
  SessionId,
  StaffId,
  StudentId,
  SystemActorId,
  UserId,
} from "./identifiers";

export type { UtcDateTime } from "./time";
export type { Page, PageCursor, PageRequest } from "./pagination";
export { err, ok } from "./result";
export type { Err, Ok, Result } from "./result";
export { administrativeRoles, userRoles } from "./actor-context";
export type {
  ActorContext,
  AnonymousActorContext,
  SystemActorContext,
  UserActorContext,
  UserRole,
} from "./actor-context";
export {
  canReadRegyfitAccess,
  canReadRestrictedIp,
  parseAdminClaims,
  parseUserClaims,
} from "./auth/admin-contracts";
export type { AdminClaims, AdminRole, UserClaims } from "./auth/admin-contracts";
export { auditActions, parseAuditEventDraft } from "./audit/audit-event";
export type { AuditAction, AuditEventDraft } from "./audit/audit-event";
export {
  accessDenialReasons,
  accessOperations,
  accessScopes,
  dataClassifications,
  evaluateAccess,
} from "./authorization/access-policy";
export type {
  AccessDenialReason,
  AccessEvaluationInput,
  AccessFacts,
  AccessGrant,
  AccessOperation,
  AccessRequirement,
  AccessResource,
  AccessScope,
  ApprovalAccessEvidence,
  AssignmentAccessEvidence,
  DataClassification,
  FamilyAccessEvidence,
  ValidityWindow,
} from "./authorization/access-policy";
export { domainErrorCodes } from "./errors";
export type {
  DomainError,
  DomainErrorCode,
  DomainResource,
  IntegrationArea,
  ValidationIssue,
} from "./errors";

export {
  regyfitEntityNames,
  regyfitMappingStrategies,
  regyfitSensitivities,
  validateRegyfitDiscoveryManifest,
  validateRegyfitMapping,
} from "./migration/regyfit-contracts";
export type {
  RegyfitCapabilityMetadata,
  RegyfitDiscoveryManifest,
  RegyfitEntityName,
  RegyfitFieldSnapshot,
  RegyfitMapping,
  RegyfitMappingStrategy,
  RegyfitModuleSnapshot,
  RegyfitSensitivity,
} from "./migration/regyfit-contracts";

export {
  assertUniqueSourceIds,
  mapRegyfitAccessRow,
  normalizeRegyfitAccessEnvelope,
  toRestrictedRegyfitAccessProjection,
  toSafeRegyfitAccessProjection,
} from "./migration/regyfit-access";
export type { RegyfitAccessRecord, RegyfitAccessSourceRow } from "./migration/regyfit-access";

export {
  matchesMemberReport,
  memberGenders,
  memberOrderByValues,
  memberReportKeys,
  membershipStatuses,
  parseMemberImportPreview,
  parseMemberRecord,
  parseMemberSearchFilters,
  paymentStatuses,
} from "./members/member-contracts";
export type {
  MemberAuditMetadata,
  MemberGender,
  MemberImportChange,
  MemberImportPreview,
  MemberImportSourceReport,
  MemberOrderBy,
  MemberRecord,
  MemberReportKey,
  MemberSearchFilters,
  MembershipStatus,
  PaymentStatus,
} from "./members/member-contracts";

export {
  deriveParticipantType,
  parseStudentProfile,
  parseUserProfile,
  participantTypes as profileParticipantTypes,
  trainingCenters,
  trainingTimePreferences,
} from "./profiles/profile-contracts";
export {
  PLAN_CATALOG,
  billingPeriods,
  evaluatePlanAccess,
  parsePlanDraft,
  parsePlanRecord,
  participantTypes,
  planIds,
  sessionTypes,
  siteValues,
} from "./memberships/plan-contracts";
export type {
  BillingPeriod,
  ParticipantType,
  PlanAccessDecision,
  PlanAccessInput,
  PlanDraft,
  PlanId,
  PlanRecord,
  SessionType,
  Site,
} from "./memberships/plan-contracts";

export {
  canTransitionMembership,
  currentMembershipStatuses,
  membershipStatuses as membershipLifecycleStatuses,
  membershipTransitionTargets,
  parseMembershipDraft,
  parseMembershipRecord,
} from "./memberships/membership-contracts";
export type {
  CurrentMembershipStatus,
  MembershipCreateInput,
  MembershipDraft,
  MembershipRecord,
  MembershipStatus as MembershipLifecycleStatus,
  MembershipTransitionInput,
} from "./memberships/membership-contracts";

export {
  familyPermissions,
  familyStatuses,
  parseFamilyRecord,
  parseFamilyRelationship,
  parseFamilyStudentDraft,
  relationshipStatuses,
  relationshipTypes,
} from "./families/family-contracts";
export type {
  FamilyPermission,
  FamilyRecord,
  FamilyRelationship,
  FamilyStatus,
  FamilyStudentDraft,
  GuardianFamilyProjection,
  RelationshipStatus,
  RelationshipType,
  StaffFamilyProjection,
} from "./families/family-contracts";
export type {
  ClientProfileProjection,
  ParticipantType as ProfileParticipantType,
  StudentProfile,
  TrainingCenter,
  TrainingTimePreference,
  UserProfile,
} from "./profiles/profile-contracts";

export {
  parseStaffAvailabilityWindow,
  parseStaffProfile,
  parseStaffRoleAssignment,
  staffAssignmentTargetTypes,
  staffRoles,
  staffStatuses,
} from "./staff/staff-contracts";
export type {
  StaffAssignmentTargetType,
  StaffAvailabilityWindow,
  StaffProfile,
  StaffRole,
  StaffRoleAssignment,
  StaffStatus,
} from "./staff/staff-contracts";

export {
  calculateAccountBalance,
  calculateInvoiceBalance,
  calculatePaygDebt,
  chargeKinds,
  invoiceStatuses,
  manualPaymentMethods,
  parseInvoiceRecord,
  parseManualPaymentRecord,
} from "./finance/finance-contracts";
export type {
  ChargeKind,
  InvoiceRecord,
  InvoiceStatus,
  ManualPaymentMethod,
  ManualPaymentRecord,
} from "./finance/finance-contracts";
export { evaluateFinancialAccess } from "./finance/financial-access";
export type {
  FinancialAccessDecision,
  FinancialAccessDenialCode,
  FinancialAccessInput,
} from "./finance/financial-access";

export {
  buildEvaluationId,
  buildGraduationId,
  buildStudentProgressSummary,
  calculateAttendanceStreak,
  evaluationScores,
  generateRecognitionCandidates,
  levelDefinitionKinds,
  levelRequirementInheritanceModes,
  parseApprovePromotionInput,
  parseLevelCatalogProjection,
  parseLevelCatalogSource,
  parseRecordEvaluationInput,
  parseRecordMedicalLeaveInput,
  parseRejectPromotionInput,
} from "./levels/level-contracts";
export type {
  ApprovePromotionInput,
  AttendanceStreak,
  CanonicalLevelCatalog,
  EvaluationRecord,
  EvaluationScore,
  GraduationRecord,
  LevelCatalogProjection,
  LevelCriteria,
  LevelDefinitionKind,
  LevelDefinitionRecord,
  LevelRequirementInheritanceMode,
  LevelRequirementRecord,
  LevelSystemRecord,
  LevelVisual,
  MedicalLeaveRecord,
  ProgressCriteriaSummary,
  PromotionDecisionStatus,
  RecognitionCandidate,
  RecordEvaluationInput,
  RecordMedicalLeaveInput,
  RejectPromotionInput,
  SkillChecklistItem,
  SkillDefinition,
  StudentProgressSummary,
} from "./levels/level-contracts";

export {
  ageBands,
  classLevels,
  daysOfWeek,
  disciplines,
  locationIds,
  parseCreateClassInput,
  parseCreateSessionInput,
  parseListSessionsQuery,
  parseRecurrenceRule,
  sessionStatuses,
} from "./schedule/schedule-contracts";
export type {
  AgeBand,
  CancelSessionInput,
  ClassLevel,
  ClassRecord,
  ClassRecurrenceRule,
  CreateClassInput,
  CreateSessionInput,
  DayOfWeek,
  Discipline,
  ListSessionsQuery,
  LocationId,
  LocationRecord,
  ProgramRecord,
  SessionRecord,
  SessionStatus,
  UpdateClassInput,
} from "./schedule/schedule-contracts";

export {
  announcementAuthorRoles,
  announcementChannels,
  announcementPriorities,
  announcementStatuses,
  buildAnnouncementId,
  parseCreateAnnouncementInput,
  parseUpdateAnnouncementInput,
} from "./announcements/announcement-contracts";
export type {
  AnnouncementAuthorRole,
  AnnouncementChannel,
  AnnouncementPriority,
  AnnouncementRecord,
  AnnouncementStatus,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from "./announcements/announcement-contracts";

export {
  buildNoticeId,
  filterGuardianAnnouncements,
  noticeCategories,
  parseSendMinorNoticeInput,
  resolveSafeguardedRecipient,
} from "./announcements/safeguarding-contracts";

export type {
  NoticeCategory,
  RecipientResolution,
  SafeguardingNoticeRecord,
  SendMinorNoticeInput,
} from "./announcements/safeguarding-contracts";

export { buildInAppReminders, reminderKinds } from "./reminders/reminder-contracts";
export type {
  BuildInAppRemindersInput,
  FinancialAccountSummary,
  InAppReminderRecord,
  ReminderAttendanceEntry,
  ReminderKind,
} from "./reminders/reminder-contracts";

export {
  buildDeliveryEventId,
  buildDeliveryHistoryRecord,
  deliveryChannels,
  deliveryStatuses,
  parseDeliveryHistoryRecord,
  parseExternalDeliveryRequest,
} from "./delivery/delivery-contracts";
export type {
  DeliveryChannel,
  DeliveryHistoryRecord,
  DeliveryProviderResult,
  DeliveryStatus,
  ExternalDeliveryRequest,
} from "./delivery/delivery-contracts";
export {
  minimumOperationalSupportCodes,
  healthReviewStates,
  healthProfileStatuses,
  healthChangeRequestStatuses,
  parseHealthProfile,
  parseHealthProfileSaveInput,
  parseHealthProfileChangeRequestInput,
  parseHealthProfileChangeRequest,
  toHealthProfileProjection,
} from "./health/health-contracts";
export type {
  HealthProfile,
  HealthProfileChangeRequest,
  HealthProfileSaveInput,
  HealthProfileChangeRequestInput,
  HealthProfileRedactedProjection,
  HealthProfileStaffProjection,
  HealthProfileAdminProjection,
  HealthReviewState,
  HealthProfileStatus,
  HealthChangeRequestStatus,
  MinimumOperationalSupportCode,
} from "./health/health-contracts";

export {
  privateDocumentKinds,
  privateDocumentStatuses,
  MAX_PRIVATE_DOCUMENT_BYTES,
  buildPrivateDocumentId,
  buildPrivateDocumentObjectKey,
  parsePrivateDocumentUploadInput,
  parsePrivateDocumentRecord,
  toPrivateDocumentProjection,
} from "./documents/document-contracts";
export type {
  PrivateDocumentKind,
  PrivateDocumentStatus,
  PrivateDocumentRecord,
  PrivateDocumentUploadInput,
  PrivateDocumentProjection,
} from "./documents/document-contracts";
