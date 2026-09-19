# T012 Domain Contracts Design

## Objective

Define the stable, technology-independent foundation of `@bpt-jersey/domain`: module names, nominal identifiers, time and pagination contracts, actor context, typed results, and serializable domain errors.

This task does not define complete business entities, persistence schemas, authorization decisions, or provider contracts.

## Module Boundaries

The package exposes this readonly module registry:

- `access`
- `people`
- `academy`
- `scheduling`
- `attendance`
- `memberships`
- `payments`
- `student-development`
- `safeguarding`
- `crm`
- `communications`
- `documents`
- `reporting`
- `audit`

`DomainModule` is derived from the registry instead of maintained as a duplicate union. T012 records names only; dependencies and concrete module APIs will be introduced when business rules are confirmed.

## Files

- `packages/domain/src/modules.ts`: module registry and `DomainModule`.
- `packages/domain/src/identifiers.ts`: generic nominal ID mechanism and entity ID aliases.
- `packages/domain/src/time.ts`: nominal UTC timestamp contract.
- `packages/domain/src/pagination.ts`: cursor request and page response contracts.
- `packages/domain/src/result.ts`: success/error discriminated union and constructors.
- `packages/domain/src/actor-context.ts`: anonymous, authenticated-user, and system actor contracts.
- `packages/domain/src/errors.ts`: serializable error union.
- `packages/domain/src/index.ts`: explicit public exports only.
- `packages/domain/src/modules.test.ts`: module registry tests.
- `packages/domain/src/contracts.test.ts`: identifiers, time, pagination, actor, and public export tests.
- `packages/domain/src/result.test.ts`: result behavior and narrowing tests.
- `packages/domain/src/errors.test.ts`: error exhaustiveness and serialization tests.

No new package or runtime dependency is required.

## Nominal Identifiers

Use a non-exported `unique symbol` brand and export `EntityId<Entity extends string>`. Export aliases for:

- `AcademyId`
- `UserId`
- `FamilyId`
- `StudentId`
- `StaffId`
- `ProgramId`
- `ClassId`
- `SessionId`
- `BookingId`
- `AttendanceId`
- `MembershipId`
- `PaymentId`
- `InvoiceId`
- `AssessmentId`
- `RecognitionId`
- `LeadId`
- `MessageId`
- `DocumentId`
- `AuditEventId`
- `SystemActorId`
- `CorrelationId`

The aliases prevent assigning one entity ID to another at compile time. T012 does not provide unsafe public cast helpers or claim runtime validation; adapters create validated IDs after parsing `unknown` input.

## Time and Pagination

`UtcDateTime` is a nominal string representing a validated ISO-8601 UTC instant. T012 exports the type only; parsing and normalization remain adapter responsibilities.

Pagination contracts:

```ts
type PageCursor = EntityId<"PageCursor">;

type PageRequest = Readonly<{
  cursor?: PageCursor;
  limit: number;
}>;

type Page<T> = Readonly<{
  items: readonly T[];
  nextCursor?: PageCursor;
}>;
```

The adapter must enforce the future endpoint-specific range for `limit`; a TypeScript number alone is not treated as runtime validation.

## Result Contract

Expected domain outcomes use a discriminated union:

```ts
type Ok<T> = Readonly<{ ok: true; value: T }>;
type Err<E> = Readonly<{ ok: false; error: E }>;
type Result<T, E> = Ok<T> | Err<E>;
```

`ok(value)` and `err(error)` return shallow-frozen objects so callers cannot mutate the envelope. Unexpected programmer or infrastructure defects may still throw and are translated at the outer boundary; expected validation, permission, conflict, and availability outcomes use `Result`.

## Actor Context

Roles are exposed through a shallow-frozen `userRoles` registry, with `UserRole` derived from it instead of maintained as a duplicate union:

- `owner`
- `administrator`
- `headCoach`
- `coach`
- `guardian`
- `adultStudent`

`ActorContext` is a union:

- `AnonymousActorContext`: `{ kind: "anonymous" }`.
- `UserActorContext`: `kind`, `academyId`, `userId`, and `role`.
- `SystemActorContext`: `kind`, `academyId`, `systemActorId`, and `correlationId`.

The context records who initiated an operation. It never grants permission by itself; authorization services introduced by later tasks must evaluate role, active status, relationship, assignment, purpose, and resource classification.

## Domain Errors

`DomainError` is a readonly discriminated union with these codes:

- `VALIDATION_FAILED`: non-retryable; contains readonly field issues with safe field paths and machine-readable issue codes.
- `UNAUTHENTICATED`: non-retryable.
- `FORBIDDEN`: non-retryable.
- `NOT_FOUND`: non-retryable; identifies only a safe resource category, never a personal value.
- `CONFLICT`: non-retryable.
- `PRECONDITION_FAILED`: non-retryable.
- `RATE_LIMITED`: retryable; may include a non-negative `retryAfterSeconds`.
- `INTEGRATION_UNAVAILABLE`: retryable; may identify a safe provider name.
- `INTERNAL`: non-retryable in the public contract.

Errors contain no `stack`, raw `cause`, credentials, provider payload, personal data, or user-facing prose. API/UI adapters map codes to safe English messages and appropriate transport status codes.

## Data Flow

1. An adapter receives `unknown` external input.
2. The adapter validates and normalizes it, including IDs, UTC timestamps, cursor, and numeric bounds.
3. A use case receives typed contracts and an `ActorContext`.
4. The use case returns `Result<Success, DomainError>` for expected outcomes.
5. The adapter maps the result to HTTP, Firebase callable, webhook, UI, or job-specific output without exposing internal causes.

The domain package does not import Firebase, React, Next.js, HTTP libraries, Zod, or provider SDKs.

## Testing

Vitest's existing `node` project discovers `packages/*/src/**/*.test.ts`. Tests must verify:

- The 14 module names are unique, complete, and runtime-frozen.
- `DomainModule` is inferred from the registry.
- Nominal ID aliases reject cross-entity assignment with `expectTypeOf`.
- Result helpers return frozen discriminated envelopes and narrow correctly.
- Actor contexts narrow by `kind`, and the frozen user-role registry is unique and exhaustive.
- Pagination items are readonly and cursor fields preserve their nominal type.
- Every domain error code has the intended retryability and survives `JSON.stringify`/`JSON.parse` without `stack`, `cause`, or extra sensitive fields.
- `index.ts` exposes the intended public API.

Run unit tests, typecheck, lint, formatting, dependency audit, and `git diff --check`. This task adds no external dependency and does not require Firebase emulators or browser E2E.

## Security Constraints

- Never accept unvalidated strings as proof of an entity ID or UTC timestamp.
- Never interpret `ActorContext.role` as sufficient authorization.
- Never place raw external errors inside `DomainError`.
- Do not include personal data in error details or test fixtures.
- Keep all exported contracts immutable at the type level; freeze runtime envelopes and registries created by this package.

## Acceptance Criteria

- All listed files and public contracts exist with no external dependency.
- Tests demonstrate module registry integrity, nominal type separation, result narrowing, actor discrimination, pagination contracts, and safe error serialization.
- Strict TypeScript, lint, formatting, unit tests, audit, and diff checks pass.
- No Firebase, storage, HTTP, UI, schema, entity DTO, or authorization implementation leaks into the package.
- `T012` evidence records the security review and exact test results before the task leaves `en-progreso`.
