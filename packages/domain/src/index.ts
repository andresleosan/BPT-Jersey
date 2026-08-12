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
} from "./auth/admin-contracts";
export type { AdminClaims, AdminRole } from "./auth/admin-contracts";
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
