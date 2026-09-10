# T012 Domain Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Cronos executes the plan inline and must not delegate to subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the technology-independent domain contract foundation for `@bpt-jersey/domain` with nominal IDs, module boundaries, actor context, pagination, typed results, and safe serializable errors.

**Architecture:** Keep `packages/domain` as TypeScript-only code with no Firebase, React, HTTP, Zod, storage, or provider imports. Each contract concern has one focused source file, while `index.ts` exposes the deliberate public API. Runtime immutability is limited to registries and `Result` envelopes; validation of external `unknown` input remains at adapters.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.10, Node.js 22-24, pnpm 11.20.0, strict ESM workspace configuration.

## Global Constraints

- Do not define complete business entities, persistence schemas, authorization decisions, or provider contracts.
- Do not add a runtime or development dependency.
- Do not import Firebase, React, Next.js, HTTP libraries, Zod, or provider SDKs into `packages/domain`.
- Treat all external IDs and timestamps as unvalidated until an adapter parses and normalizes them.
- `ActorContext.role` records actor identity but never grants permission by itself.
- `DomainError` must not contain `stack`, raw `cause`, credentials, provider payloads, personal data, or user-facing prose.
- Exported contracts are readonly at the type level; module and role registries and `Result` envelopes are frozen at runtime.
- Do not commit changes unless the operator explicitly requests a commit.
- Keep `T012` in `en-progreso` until all implementation and verification evidence exists; move it to `revisión`, not `aprobada`, at the end of execution.

---

## File Map

- Create `packages/domain/src/modules.ts`: frozen 14-entry module registry and `DomainModule` union.
- Create `packages/domain/src/identifiers.ts`: generic nominal ID brand and all entity ID aliases.
- Create `packages/domain/src/time.ts`: nominal `UtcDateTime` string type.
- Create `packages/domain/src/pagination.ts`: `PageCursor`, `PageRequest`, and `Page<T>`.
- Create `packages/domain/src/result.ts`: `Ok`, `Err`, `Result`, `ok()`, and `err()`.
- Create `packages/domain/src/actor-context.ts`: frozen role registry and actor-context union.
- Create `packages/domain/src/errors.ts`: frozen error-code registry and safe `DomainError` union.
- Modify `packages/domain/src/index.ts`: explicit public exports only.
- Create `packages/domain/src/modules.test.ts`: module registry behavior and inferred union tests.
- Create `packages/domain/src/contracts.test.ts`: nominal IDs, UTC time, pagination, actor context, and public API tests.
- Create `packages/domain/src/result.test.ts`: result narrowing and runtime immutability tests.
- Create `packages/domain/src/errors.test.ts`: exhaustive code, retryability, and safe serialization tests.
- Modify `tasks.md:27` and the evidence section: task state and exact verification evidence.

---

### Task 1: Establish module, ID, time, and pagination contracts

**Files:**
- Modify: `tasks.md:27` (`T012` state only)
- Create: `packages/domain/src/modules.test.ts`
- Create: `packages/domain/src/contracts.test.ts`
- Create: `packages/domain/src/modules.ts`
- Create: `packages/domain/src/identifiers.ts`
- Create: `packages/domain/src/time.ts`
- Create: `packages/domain/src/pagination.ts`

**Interfaces:**
- Produces `domainModules: readonly ["access", "people", "academy", "scheduling", "attendance", "memberships", "payments", "student-development", "safeguarding", "crm", "communications", "documents", "reporting", "audit"]`.
- Produces `DomainModule = (typeof domainModules)[number]`.
- Produces `EntityId<Entity extends string>`, all 21 named entity-ID aliases, `UtcDateTime`, `PageCursor`, `PageRequest`, and `Page<T>`.

- [ ] **Step 1: Mark T012 as active**

Change only the T012 row in `tasks.md` from `pendiente` to `en-progreso`:

```markdown
| T012 | Definir módulos de dominio, contratos base y errores tipados | T002,T007 | en-progreso | Pruebas unitarias de contratos |
```

- [ ] **Step 2: Write the failing module and contract tests**

Create `packages/domain/src/modules.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from "vitest";

import { domainModules } from "./modules";
import type { DomainModule } from "./modules";

const expectedModules = [
  "access",
  "people",
  "academy",
  "scheduling",
  "attendance",
  "memberships",
  "payments",
  "student-development",
  "safeguarding",
  "crm",
  "communications",
  "documents",
  "reporting",
  "audit",
] as const;

describe("domain module registry", () => {
  it("contains every module once and is frozen", () => {
    expect(domainModules).toEqual(expectedModules);
    expect(new Set(domainModules).size).toBe(expectedModules.length);
    expect(Object.isFrozen(domainModules)).toBe(true);
  });

  it("derives the exact module union", () => {
    expectTypeOf<DomainModule>().toEqualTypeOf<(typeof expectedModules)[number]>();
  });
});
```

Create `packages/domain/src/contracts.test.ts` with compile-time and runtime checks:

```ts
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  AcademyId,
  FamilyId,
  StudentId,
} from "./identifiers";
import type { Page, PageCursor, PageRequest } from "./pagination";
import type { UtcDateTime } from "./time";

describe("base domain contracts", () => {
  it("keeps entity IDs nominally distinct", () => {
    expectTypeOf<AcademyId>().not.toEqualTypeOf<StudentId>();
    expectTypeOf<FamilyId>().not.toEqualTypeOf<StudentId>();
    expectTypeOf<AcademyId>().toMatchTypeOf<string>();
  });

  it("keeps time and pagination contracts readonly and typed", () => {
    expectTypeOf<UtcDateTime>().toMatchTypeOf<string>();
    expectTypeOf<PageCursor>().toMatchTypeOf<string>();

    const request: PageRequest = { limit: 25 };
    const page: Page<string> = { items: ["student-1"] };

    expect(request.limit).toBe(25);
    expect(page.items).toEqual(["student-1"]);
    expectTypeOf(page.items).toEqualTypeOf<readonly string[]>();
  });
});
```

- [ ] **Step 3: Run the focused tests and confirm they fail for missing contracts**

Run:

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/modules.test.ts packages/domain/src/contracts.test.ts
```

Expected: FAIL because the source modules and exports do not exist yet. Do not continue if the tests pass before implementation.

- [ ] **Step 4: Implement the frozen module registry**

Create `packages/domain/src/modules.ts`:

```ts
export const domainModules = Object.freeze([
  "access",
  "people",
  "academy",
  "scheduling",
  "attendance",
  "memberships",
  "payments",
  "student-development",
  "safeguarding",
  "crm",
  "communications",
  "documents",
  "reporting",
  "audit",
] as const);

export type DomainModule = (typeof domainModules)[number];
```

- [ ] **Step 5: Implement nominal identifiers**

Create `packages/domain/src/identifiers.ts`:

```ts
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
```

Do not add a public cast function or parser. The adapter layer will be responsible for validating raw strings in later tasks.

- [ ] **Step 6: Implement time and pagination contracts**

Create `packages/domain/src/time.ts`:

```ts
declare const utcDateTimeBrand: unique symbol;

export type UtcDateTime = string & {
  readonly [utcDateTimeBrand]: "UtcDateTime";
};
```

Create `packages/domain/src/pagination.ts`:

```ts
import type { EntityId } from "./identifiers";

export type PageCursor = EntityId<"PageCursor">;

export type PageRequest = Readonly<{
  cursor?: PageCursor;
  limit: number;
}>;

export type Page<T> = Readonly<{
  items: readonly T[];
  nextCursor?: PageCursor;
}>;
```

Do not enforce a numeric range here; future endpoint adapters own runtime validation.

- [ ] **Step 7: Run the focused tests and typecheck**

Run:

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/modules.test.ts packages/domain/src/contracts.test.ts
corepack pnpm --filter @bpt-jersey/domain typecheck
```

Expected: module/contract tests pass and the domain package typecheck exits 0.

---

### Task 2: Implement `Result` and actor context

**Files:**
- Create: `packages/domain/src/result.test.ts`
- Create: `packages/domain/src/result.ts`
- Create: `packages/domain/src/actor-context.ts`
- Modify: `packages/domain/src/contracts.test.ts`

**Interfaces:**
- Consumes: `AcademyId`, `UserId`, `SystemActorId`, `CorrelationId` from `identifiers.ts`.
- Produces `Ok<T>`, `Err<E>`, `Result<T, E>`, `ok<T>(value): Ok<T>`, `err<E>(error): Err<E>`, `userRoles`, `UserRole`, `AnonymousActorContext`, `UserActorContext`, `SystemActorContext`, and `ActorContext`.

- [ ] **Step 1: Write failing result tests**

Create `packages/domain/src/result.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from "vitest";

import { err, ok } from "./result";
import type { Result } from "./result";

describe("Result", () => {
  it("creates frozen success and failure envelopes", () => {
    const success = ok({ count: 2 });
    const failure = err({ code: "CONFLICT" as const });

    expect(success).toEqual({ ok: true, value: { count: 2 } });
    expect(failure).toEqual({ ok: false, error: { code: "CONFLICT" } });
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(true);
  });

  it("narrows the discriminated union", () => {
    const result: Result<number, { code: "FAILED" }> = ok(3);
    if (result.ok) {
      expectTypeOf(result.value).toEqualTypeOf<number>();
    } else {
      expectTypeOf(result.error).toEqualTypeOf<{ code: "FAILED" }>();
    }
  });
});
```

- [ ] **Step 2: Run the result test to verify failure**

Run:

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/result.test.ts
```

Expected: FAIL because `result.ts` does not exist.

- [ ] **Step 3: Implement frozen result envelopes**

Create `packages/domain/src/result.ts`:

```ts
export type Ok<T> = Readonly<{
  ok: true;
  value: T;
}>;

export type Err<E> = Readonly<{
  ok: false;
  error: E;
}>;

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return Object.freeze({ ok: true as const, value });
}

export function err<E>(error: E): Err<E> {
  return Object.freeze({ ok: false as const, error });
}
```

Only the envelope is frozen; the type parameter remains the caller's value and is not cloned.

- [ ] **Step 4: Add actor-context tests**

Append to `packages/domain/src/contracts.test.ts`:

```ts
import { userRoles } from "./actor-context";
import type { ActorContext, UserRole } from "./actor-context";

it("keeps roles frozen and actor contexts discriminated", () => {
  expect(userRoles).toEqual([
    "owner",
    "administrator",
    "headCoach",
    "coach",
    "guardian",
    "adultStudent",
  ]);
  expect(Object.isFrozen(userRoles)).toBe(true);
  expectTypeOf<UserRole>().toEqualTypeOf<(typeof userRoles)[number]>();

  const actor: ActorContext = { kind: "anonymous" };
  if (actor.kind === "anonymous") {
    expect(actor.kind).toBe("anonymous");
  }
});
```

The final test file must place all imports at the top; the snippet shows the assertions to add, not a second import block.

- [ ] **Step 5: Implement the frozen role registry and actor union**

Create `packages/domain/src/actor-context.ts`:

```ts
import type {
  AcademyId,
  CorrelationId,
  SystemActorId,
  UserId,
} from "./identifiers";

export const userRoles = Object.freeze([
  "owner",
  "administrator",
  "headCoach",
  "coach",
  "guardian",
  "adultStudent",
] as const);

export type UserRole = (typeof userRoles)[number];

export type AnonymousActorContext = Readonly<{
  kind: "anonymous";
}>;

export type UserActorContext = Readonly<{
  kind: "user";
  academyId: AcademyId;
  userId: UserId;
  role: UserRole;
}>;

export type SystemActorContext = Readonly<{
  kind: "system";
  academyId: AcademyId;
  systemActorId: SystemActorId;
  correlationId: CorrelationId;
}>;

export type ActorContext =
  | AnonymousActorContext
  | UserActorContext
  | SystemActorContext;
```

The `kind` values are fixed as `anonymous`, `user`, and `system`; later authorization code must not infer authorization from `kind` or `role` alone.

- [ ] **Step 6: Run result and actor tests**

Run:

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/result.test.ts packages/domain/src/contracts.test.ts
corepack pnpm --filter @bpt-jersey/domain typecheck
```

Expected: all focused tests pass and typecheck exits 0.

---

### Task 3: Implement safe serializable domain errors

**Files:**
- Create: `packages/domain/src/errors.ts`
- Create: `packages/domain/src/errors.test.ts`

**Interfaces:**
- Consumes: no runtime dependency; `DomainError` is independent of providers.
- Produces `domainErrorCodes`, `DomainErrorCode`, `DomainResource`, `IntegrationArea`, `ValidationIssue`, and `DomainError`.

- [ ] **Step 1: Write the failing error tests**

Create `packages/domain/src/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { domainErrorCodes } from "./errors";
import type { DomainError } from "./errors";

const errors: readonly DomainError[] = [
  {
    code: "VALIDATION_FAILED",
    retryable: false,
    issues: [{ path: ["email"], code: "invalid_format" }],
  },
  { code: "UNAUTHENTICATED", retryable: false },
  { code: "FORBIDDEN", retryable: false },
  { code: "NOT_FOUND", retryable: false, resource: "student" },
  { code: "CONFLICT", retryable: false },
  { code: "PRECONDITION_FAILED", retryable: false },
  { code: "RATE_LIMITED", retryable: true, retryAfterSeconds: 10 },
  { code: "INTEGRATION_UNAVAILABLE", retryable: true, integration: "payments" },
  { code: "INTERNAL", retryable: false },
];

describe("DomainError", () => {
  it("defines every code once", () => {
    expect(domainErrorCodes).toHaveLength(9);
    expect(new Set(domainErrorCodes).size).toBe(domainErrorCodes.length);
    expect(errors.map(({ code }) => code)).toEqual(domainErrorCodes);
  });

  it("serializes only the safe public contract", () => {
    for (const error of errors) {
      const serialized = JSON.parse(JSON.stringify(error)) as Record<string, unknown>;

      expect(serialized).not.toHaveProperty("stack");
      expect(serialized).not.toHaveProperty("cause");
      expect(serialized).not.toHaveProperty("password");
      expect(serialized).not.toHaveProperty("token");
    }
  });
});
```

- [ ] **Step 2: Run the error test to verify failure**

Run:

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/errors.test.ts
```

Expected: FAIL because `errors.ts` does not exist.

- [ ] **Step 3: Implement the error-code and safe error contracts**

Create `packages/domain/src/errors.ts`:

```ts
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

type NonRetryableError<Code extends Exclude<DomainErrorCode, "VALIDATION_FAILED" | "NOT_FOUND" | "RATE_LIMITED" | "INTEGRATION_UNAVAILABLE">> = Readonly<{
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
```

`NonRetryableError` is an internal type alias and must not be exported. The error union contains no constructors that accept arbitrary `Error` values.

- [ ] **Step 4: Run error tests and typecheck**

Run:

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/errors.test.ts
corepack pnpm --filter @bpt-jersey/domain typecheck
```

Expected: all error tests pass and typecheck exits 0.

---

### Task 4: Expose the public API and verify package isolation

**Files:**
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/contracts.test.ts`

**Interfaces:**
- Consumes: all source contracts from Tasks 1-3.
- Produces: the only supported import surface for `@bpt-jersey/domain`.

- [ ] **Step 1: Add public-export assertions**

Update `contracts.test.ts` so its runtime imports come from `./index` rather than deep files for the public values:

```ts
import {
  domainErrorCodes,
  domainModules,
  err,
  ok,
  userRoles,
} from "./index";
import type {
  AcademyId,
  ActorContext,
  DomainError,
  DomainModule,
  Page,
  PageRequest,
  Result,
  UserRole,
  UtcDateTime,
} from "./index";
```

Keep the existing assertions and make the test compile only if `index.ts` exports every required public type/value.

- [ ] **Step 2: Implement explicit exports**

Replace the empty `packages/domain/src/index.ts` with explicit value/type exports:

```ts
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
```

No wildcard export is allowed; the public API must remain reviewable.

- [ ] **Step 3: Run package-level tests**

Run:

```powershell
corepack pnpm exec vitest run --project node packages/domain/src
corepack pnpm --filter @bpt-jersey/domain typecheck
```

Expected: all domain tests pass and the package typecheck exits 0.

- [ ] **Step 4: Verify dependency and platform isolation**

Run:

```powershell
Select-String -Path packages/domain/src/*.ts -Pattern 'firebase|react|next|zod|http|@aws-sdk|cloudflare|stripe|paypal' -CaseSensitive:$false
```

Expected: no output. If the command is unavailable in a future shell, use OpenCode's `grep` with the same pattern and include `*.ts` under `packages/domain/src`.

---

### Task 5: Run the full gate, security review, and record T012 evidence

**Files:**
- Modify: `tasks.md:27` and append under `Evidencia del ciclo de autocrítica`.
- Review: `packages/domain/src/*.ts`
- Review: `docs/superpowers/specs/2026-08-06-t012-domain-contracts-design.md`

**Interfaces:**
- Consumes: the complete domain contract package from Tasks 1-4.
- Produces: fresh verification evidence and T012 in `revisión`.

- [ ] **Step 1: Run the complete relevant gates**

Run these commands exactly:

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm audit --audit-level high
```

Expected: formatting, lint, typecheck and unit tests exit 0; audit reports no high/critical vulnerabilities; diff check produces no output. Firebase emulator Rules and browser E2E are not required for this package-only task, but must not regress if run separately.

- [ ] **Step 2: Apply the security-baseline review**

Inspect all new domain files and confirm:

- There are no endpoints, credentials, provider SDKs, logs, raw external errors, personal test fixtures, or Firebase imports.
- Error variants expose only safe categories and machine-readable validation metadata.
- No role is treated as an authorization decision.
- No public helper creates an ID or timestamp from an unvalidated string.
- Runtime-frozen objects are limited to registries and result envelopes and do not create hidden mutable global state.

- [ ] **Step 3: Record exact evidence and move T012 to review**

Append a dated section under `Evidencia del ciclo de autocrítica` in `tasks.md` containing actual counts from the fresh commands, the package-isolation scan result, and the statement that no external dependency was added. Change only T012 from `en-progreso` to `revisión`:

```markdown
### T012 - 2026-08-06

- Implementación: ...
- Seguridad: ...
- QA: ...
- Dependencias: ...
- Pruebas avanzadas: contratos interservicio, carga y E2E no aplican a esta base de contratos sin endpoints; sus gates permanecen en las tareas funcionales y `T055`.
```

Do not invent counts or claim a gate passed if its command failed. If any gate fails, leave T012 `en-progreso`, document the failure, and return to the smallest responsible task.

- [ ] **Step 4: Stop for operator review**

Present the changed files, exact test evidence, and any residual concerns. Do not move T012 from `revisión` to `aprobada` until the operator explicitly accepts the implementation.
