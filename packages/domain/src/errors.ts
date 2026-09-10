export const domainErrorCodes = Object.freeze([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "RATE_LIMITED",
  "INTEGRATION_UNAVAILABLE",
  "INTERNAL",
] as const);

export type DomainErrorCode = (typeof domainErrorCodes)[number];

export type DomainResource =
  | "user"
  | "family"
  | "student"
  | "session"
  | "membership"
  | "payment"
  | "document"
  | "report"
  | "message"
  | "auditEvent";

export type IntegrationArea = "identity" | "payments" | "communications" | "storage";

export type ValidationIssue = Readonly<{
  path: readonly (string | number)[];
  code: string;
}>;

type NonRetryableError<
  Code extends Exclude<
    DomainErrorCode,
    "VALIDATION_FAILED" | "NOT_FOUND" | "RATE_LIMITED" | "INTEGRATION_UNAVAILABLE"
  >,
> = Readonly<{
  code: Code;
  retryable: false;
}>;

export type DomainError =
  | Readonly<{
      code: "VALIDATION_FAILED";
      retryable: false;
      issues: readonly ValidationIssue[];
    }>
  | NonRetryableError<"UNAUTHENTICATED">
  | NonRetryableError<"FORBIDDEN">
  | Readonly<{
      code: "NOT_FOUND";
      retryable: false;
      resource: DomainResource;
    }>
  | NonRetryableError<"CONFLICT">
  | NonRetryableError<"PRECONDITION_FAILED">
  | Readonly<{
      code: "RATE_LIMITED";
      retryable: true;
      retryAfterSeconds?: number;
    }>
  | Readonly<{
      code: "INTEGRATION_UNAVAILABLE";
      retryable: true;
      integration?: IntegrationArea;
    }>
  | NonRetryableError<"INTERNAL">;
