declare const entityIdBrand: unique symbol;

export type EntityId<Entity extends string> = string & {
  readonly [entityIdBrand]: Entity;
};

export type AcademyId = EntityId<"Academy">;
export type UserId = EntityId<"User">;
export type FamilyId = EntityId<"Family">;
export type StudentId = EntityId<"Student">;
export type StaffId = EntityId<"Staff">;
export type ProgramId = EntityId<"Program">;
export type ClassId = EntityId<"Class">;
export type SessionId = EntityId<"Session">;
export type BookingId = EntityId<"Booking">;
export type AttendanceId = EntityId<"Attendance">;
export type MembershipId = EntityId<"Membership">;
export type PaymentId = EntityId<"Payment">;
export type InvoiceId = EntityId<"Invoice">;
export type AssessmentId = EntityId<"Assessment">;
export type RecognitionId = EntityId<"Recognition">;
export type LeadId = EntityId<"Lead">;
export type MessageId = EntityId<"Message">;
export type DocumentId = EntityId<"Document">;
export type AuditEventId = EntityId<"AuditEvent">;
export type SystemActorId = EntityId<"SystemActor">;
export type CorrelationId = EntityId<"Correlation">;
