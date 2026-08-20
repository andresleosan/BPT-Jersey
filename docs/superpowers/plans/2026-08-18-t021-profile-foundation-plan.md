# T021 - Fundamentos de perfiles de participantes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implementar perfiles adultos/participantes para que el registro del DOCX tenga persistencia canónica, callable protegido y UI responsive sin mezclar tutoría, salud, waiver, membresías ni Levels.

**Architecture:** `packages/domain` define y valida los contratos inmutables de `UserProfile` y `StudentProfile`. `apps/functions` expone `getClientProfile` y `saveClientProfile`, deriva el actor/tenant desde Auth y persiste `users` y `students` en una transacción Firestore. `apps/web` consume solo esos callables desde `/account/profile`; ningún SDK cliente lee Firestore directamente.

**Tech Stack:** TypeScript 6, Zod 4, Firebase Functions v2, Firebase Admin Auth/Firestore, Next.js 16, React 19, Vitest 4, React Testing Library y Firebase Emulator Suite.

## Global Constraints

- Firestore es la fuente canónica; RTDB no participa.
- Menores no tienen cuentas Firebase Auth.
- `academyId`, actores, estados, IDs sensibles y timestamps son server-owned.
- Las Rules de Firestore y RTDB permanecen deny-by-default para clientes.
- `members` y sus imports existentes no se migran ni se reescriben.
- T021 no agrega salud, emergencia, tutoría, waiver/PDF, membresía, belt ni stripe.
- Sede: únicamente `Town` o `West`.
- Preferencias: una o más entre `morning`, `afternoon`, `evening`, sin duplicados.
- Fechas: ISO date-only válida; `participantType` se deriva en backend usando el día del servidor.
- UI, mensajes y contenido visible permanecen en inglés; documentación interna en español.
- El piloto usa solo emulador o staging separado con datos sintéticos/sanitizados.
- No ejecutar migraciones, escrituras productivas, despliegues, commits ni push sin autorización explícita.

## File Map

- `packages/domain/src/profiles/profile-contracts.ts`: contratos, constantes y parsers estrictos de perfiles.
- `packages/domain/src/profiles/profile-contracts.test.ts`: pruebas de dominio y entradas hostiles.
- `packages/domain/src/index.ts`, `packages/domain/package.json`, `packages/domain/tsconfig.runtime.json`: exports source/runtime.
- `apps/functions/src/profiles/profile-service.ts`: store Firestore y transacción de perfiles.
- `apps/functions/src/profiles/profile-service.test.ts`: pruebas de store con fake transaccional.
- `apps/functions/src/profiles/profile-callables.ts`: handlers y wrappers callable autenticados.
- `apps/functions/src/profiles/profile-callables.test.ts`: autorización, payload y respuestas.
- `apps/functions/src/index.ts`, `apps/functions/src/deploy-runtime.ts`: exports y packaging portable.
- `qa/integration/profile-adapters.test.ts`: creación/actualización/tenant en Firestore Emulator.
- `apps/web/src/lib/profile-client.ts`: cliente callable y validación de respuesta.
- `apps/web/src/lib/profile-client.test.ts`: contrato de respuesta y errores seguros.
- `apps/web/src/app/account/profile/page.tsx`: formulario de perfil responsive.
- `apps/web/src/app/account/profile/page.test.tsx`: carga, validación, guard, éxito y error.
- `apps/web/src/app/account/page.tsx`: enlace al perfil desde el área autenticada.
- `docs/data/firestore-data-model.md`: filas canónicas de `users`/`students` y ownership.
- `qa/rules/client-data-boundary.test.ts`: cobertura explícita de `users`/`students` deny-by-default.
- `tasks.md`, `Lista/Lista.js`: evidencia y sincronización del WIP.

---

### Task 1: Contratos de dominio de perfiles

**Files:**
- Create: `packages/domain/src/profiles/profile-contracts.ts`
- Create: `packages/domain/src/profiles/profile-contracts.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/package.json`
- Modify: `packages/domain/tsconfig.runtime.json`

**Interfaces:**
- Produces `trainingCenters`, `trainingTimePreferences`, `participantTypes`.
- Produces `type UserProfile`, `type StudentProfile`, `type ClientProfileProjection`.
- Produces `parseUserProfile(value: unknown): Result<UserProfile, readonly ValidationIssue[]>`.
- Produces `parseStudentProfile(value: unknown): Result<StudentProfile, readonly ValidationIssue[]>`.
- Produces `deriveParticipantType(dateOfBirth: string, today: string): "adult" | "minor"`.

- [ ] **Step 1: Write the failing domain tests**

  Cover a valid adult profile, a valid minor participant without `userId`, exact allowed enums,
  invalid date-only values, future birth dates, duplicate/empty preferences, invalid `Town`/`West`,
  unexpected enumerable/non-enumerable/symbol keys, missing/invalid server-owned fields, and forbidden
  domain-mixing fields such as `medicalConditions`, `guardian`, `waiver`, `belt`, or `stripe`.

- [ ] **Step 2: Run the RED tests**

  Run:
  `corepack pnpm exec vitest run --project node packages/domain/src/profiles/profile-contracts.test.ts`

  Expected: FAIL because the profiles module and public exports do not exist.

- [ ] **Step 3: Implement strict immutable contracts**

  Use exact key allowlists, plain-object checks, bounded text, ISO date-only validation and frozen
  arrays/objects. Keep `UserProfile` and `StudentProfile` persistence types separate from input drafts;
  server-owned fields must not be accepted by client draft parsers.

- [ ] **Step 4: Publish source and runtime exports**

  Add the `./profiles` package subpath, export it from the domain entrypoint, and include the runtime
  file in `tsconfig.runtime.json`. Add the public-entrypoint assertion to `packages/domain/src/contracts.test.ts`.

- [ ] **Step 5: Verify the domain task**

  Run:
  `corepack pnpm exec vitest run --project node packages/domain/src/profiles/profile-contracts.test.ts packages/domain/src/contracts.test.ts`

  Then run `corepack pnpm --filter @bpt-jersey/domain typecheck` and
  `corepack pnpm --filter @bpt-jersey/domain build:runtime`.

### Task 2: Firestore profile store

**Files:**
- Create: `apps/functions/src/profiles/profile-service.ts`
- Create: `apps/functions/src/profiles/profile-service.test.ts`

**Interfaces:**
- Consumes `UserProfile`, `StudentProfile`, `parseUserProfile`, `parseStudentProfile`.
- Produces `type ProfileStore` with `getClientProfile(userId, academyId)` and
  `saveClientProfile(input: SaveClientProfileInput): Promise<ClientProfileProjection>`.
- Produces `type SaveClientProfileInput` with `academyId`, `userId`, `email`, `displayName`,
  `fullName`, `dateOfBirth`, `phoneNumber`, `trainingCenter`, `trainingTimePreferences`, `now`,
  and `studentId`/`userId` generated or resolved only by the service.

- [ ] **Step 1: Write fake-transaction RED tests**

  Test empty profile lookup, atomic creation of `users` plus `students`, update preserving
  `createdAt`/`createdBy`, tenant path mismatch, duplicate profile identity, and rejection when
  the transaction attempts to write forbidden fields.

- [ ] **Step 2: Run the RED tests**

  Run:
  `corepack pnpm exec vitest run --project node apps/functions/src/profiles/profile-service.test.ts`

  Expected: FAIL because the profile store does not exist.

- [ ] **Step 3: Implement bounded transaction persistence**

  Read both canonical documents inside one transaction. Derive the academy path from the authenticated
  input supplied by the callable, create a backend ID for a missing student, derive `participantType`
  from server `now`, and write only allowlisted profile fields. Never touch `members`, `families`,
  `relationships`, `healthProfiles`, `consents` or `documents`.

- [ ] **Step 4: Verify store behavior**

  Run the store test file and `corepack pnpm --filter @bpt-jersey/functions typecheck`.

### Task 3: Protected profile callables

**Files:**
- Create: `apps/functions/src/profiles/profile-callables.ts`
- Create: `apps/functions/src/profiles/profile-callables.test.ts`
- Modify: `apps/functions/src/index.ts`
- Modify: `apps/functions/src/deploy-runtime.ts`

**Interfaces:**
- Produces `getClientProfile` callable and `saveClientProfile` callable.
- Produces testable handlers `getClientProfileHandler(request, services)` and
  `saveClientProfileHandler(request, services)`.
- Request payload for save is strict and contains only `fullName`, `dateOfBirth`, `phoneNumber`,
  `trainingCenter`, and `trainingTimePreferences`.
- Response is `ClientProfileProjection` with only user/student profile fields.

- [ ] **Step 1: Write authorization and payload RED tests**

  Cover unauthenticated requests, malformed claims, non-client role, extra `academyId`/`userId`/
  `createdBy`/timestamp fields, invalid date/center/preferences, same-tenant success, repeated save,
  and generic public errors. Assert that no response contains claims, medical data, waiver fields,
  family relations or full Auth records.

- [ ] **Step 2: Run the RED tests**

  Run:
  `corepack pnpm exec vitest run --project node apps/functions/src/profiles/profile-callables.test.ts`

  Expected: FAIL because handlers and callable exports do not exist.

- [ ] **Step 3: Implement handlers with backend authority**

  Reuse `requireUserActor`, require an authenticated client actor, obtain the canonical Auth email
  through the injected Auth service, parse the strict payload, call the profile store, and map failures
  to `unauthenticated`, `permission-denied`, `invalid-argument`, or `failed-precondition` without
  exposing internal details.

- [ ] **Step 4: Publish Functions exports and deploy mapping**

  Export the two callable functions from `apps/functions/src/index.ts`. Add any new domain runtime
  subpath to `apps/functions/src/deploy-runtime.ts` and assert the portable layout has no workspace import.

- [ ] **Step 5: Verify callable regression**

  Run the profile callable tests plus:
  `corepack pnpm exec vitest run --project node apps/functions/src/auth/user-authorization.test.ts apps/functions/src/profiles/profile-callables.test.ts`

### Task 4: Firestore Emulator and Rules evidence

**Files:**
- Create: `qa/integration/profile-adapters.test.ts`
- Modify: `qa/rules/client-data-boundary.test.ts`

**Interfaces:**
- Consumes `getClientProfile`/`saveClientProfile` handlers and the real Firestore adapter.
- Produces emulator evidence for `users` and `students` tenant paths with no direct client access.

- [ ] **Step 1: Add integration RED cases**

  Test create/update round trip, server-owned fields, adult `userId`, minor `studentId` contract,
  wrong academy path, repeated save, and no direct client read/create/update/delete.

- [ ] **Step 2: Run with the Firestore Emulator**

  Run:
  `corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/profile-adapters.test.ts qa/integration/firestore-adapters.test.ts"`

  Expected: all profile and existing adapter tests pass with synthetic data only.

- [ ] **Step 3: Verify Rules deny-by-default**

  Add `users` and `students` paths to the existing negative matrix and run `corepack pnpm test:rules`.

### Task 5: Client API and profile UI

**Files:**
- Create: `apps/web/src/lib/profile-client.ts`
- Create: `apps/web/src/lib/profile-client.test.ts`
- Create: `apps/web/src/app/account/profile/page.tsx`
- Create: `apps/web/src/app/account/profile/page.test.tsx`
- Modify: `apps/web/src/app/account/page.tsx`

**Interfaces:**
- `getClientProfile(): Promise<ClientProfileProjection | undefined>`.
- `saveClientProfile(input: ProfileFormInput): Promise<ClientProfileProjection>`.
- The client validates the response shape and converts callable failures to safe English messages.

- [ ] **Step 1: Write client and UI RED tests**

  Test callable payload allowlisting, malformed response rejection, signed-out redirect, loading state,
  required full name/date/center/preference validation, successful save, generic failure, keyboard labels,
  and mobile form layout without horizontal overflow.

- [ ] **Step 2: Implement the callable client**

  Use the existing Firebase Functions client, send only editable fields, validate the returned projection,
  and never read Firestore directly from the browser.

- [ ] **Step 3: Implement `/account/profile`**

  Reuse `ClientAuthProvider`/`ClientAuthGate`, render the English responsive form, disable duplicate
  submits, announce errors through the existing accessible patterns, and link it from `/account`.

- [ ] **Step 4: Verify web behavior**

  Run:
  `corepack pnpm exec vitest run --project web apps/web/src/lib/profile-client.test.ts apps/web/src/app/account/profile/page.test.tsx apps/web/src/app/account/page.test.tsx`

  Then run `corepack pnpm --filter @bpt-jersey/web typecheck`.

### Task 6: Documentation, self-critique and gates

**Files:**
- Modify: `docs/data/firestore-data-model.md`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`
- Review: all files from Tasks 1-5

- [ ] **Step 1: Document `users` and `students`**

  Add fields, ownership, classification, no-minor-Auth rule, client deny-by-default and the additive
  rollback statement. Link the T021 spec and record that T022/T023/T018/T024 own the excluded domains.

- [ ] **Step 2: Run security self-critique**

  Verify strict payloads, tenant derivation, no direct client Firestore access, no PII in logs/tests,
  no secrets, and no writes outside emulator/staging. A critical finding blocks closure.

- [ ] **Step 3: Run focused verification**

  Run domain, Functions, integration, Rules and UI commands from Tasks 1-5 plus
  `corepack pnpm --filter @bpt-jersey/functions build` and the portable deploy-runtime test.

- [ ] **Step 4: Run global gates**

  Run `corepack pnpm test:unit`, `corepack pnpm test:rules`, `corepack pnpm lint`,
  `corepack pnpm typecheck`, `corepack pnpm build`, `corepack pnpm audit --audit-level high`,
  `corepack pnpm format:check` and `git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check`.

- [ ] **Step 5: Close T021 evidence**

  Record commands/results in `tasks.md`, keep `T021` as the only WIP until all gates pass, synchronize
  `Lista/Lista.js`, and do not commit, push, migrate or deploy.
