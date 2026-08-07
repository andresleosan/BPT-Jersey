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
export { userRoles } from "./actor-context";
export type {
  ActorContext,
  AnonymousActorContext,
  SystemActorContext,
  UserActorContext,
  UserRole,
} from "./actor-context";
export { domainErrorCodes } from "./errors";
export type {
  DomainError,
  DomainErrorCode,
  DomainResource,
  IntegrationArea,
  ValidationIssue,
} from "./errors";
