# T022 - Familias y relaciones autorizadas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implementar familias multi-child, un tutor único por menor y acceso guardian de solo lectura mediante relaciones explícitas y callables protegidos.

**Architecture:** `packages/domain` validará familias, relaciones y borradores de menores. `apps/functions` ejecutará comandos staff/admin y proyecciones guardian en transacciones Firestore, verificando usuarios/Auth existentes y el tenant. `apps/web` consumirá exclusivamente los callables desde `/admin/families` y `/account/family`; Rules seguirá deny-by-default.

**Tech Stack:** TypeScript 6, Firebase Admin Firestore/Auth, Firebase Functions v2, Next.js 16, React 19, Vitest 4, Testing Library y Firebase Emulator Suite.

## Global Constraints

- Solo `owner` y `administrator` escriben familias y relaciones.
- `guardian` solo consulta su propia familia y menores con relación vigente.
- Una familia puede tener varios menores.
- Cada menor pertenece a una sola familia y tiene exactamente un tutor.
- `primaryContactUserId` y `billingContactUserId` son el mismo tutor en T022.
- Un adulto no puede pertenecer a más de una familia.
- El tutor debe existir en `users` y Firebase Auth; T022 no crea cuentas Auth ni modifica claims.
- Firestore es la fuente canónica; el navegador no lee ni escribe directamente `families`, `students` o `relationships`.
- `familyId` en `students` es opcional para conservar T021, pero obligatorio para menores gestionados por T022.
- `participantType` de menores se deriva como `minor` usando el día del servidor.
- No se eliminan documentos; las bajas usan `active/status` y preservan historial.
- No se agregan salud, emergencia, safeguarding, waiver, documentos, membresías, pagos, asistencia, progreso ni transporte.
- La interfaz y los mensajes visibles están en inglés; los documentos técnicos internos pueden estar en español.
- Todas las pruebas usan datos sintéticos/sanitizados en emulador o staging separado; no hay migración, despliegue, commit ni push sin autorización explícita.

---

## File Map

- `packages/domain/src/families/family-contracts.ts`: enums, tipos, borradores y parsers estrictos.
- `packages/domain/src/families/family-contracts.test.ts`: pruebas hostiles de familia/relación/menor.
- `packages/domain/src/profiles/profile-contracts.ts`: ampliar el participante persistido para aceptar `familyId` opcional.
- `packages/domain/src/index.ts`, `packages/domain/package.json`, `packages/domain/tsconfig.runtime.json`: exports source/runtime.
- `apps/functions/src/families/family-service.ts`: store Firestore/Auth transaccional y proyecciones por rol.
- `apps/functions/src/families/family-service.test.ts`: fake transaction, invariantes e idempotencia.
- `apps/functions/src/families/family-callables.ts`: handlers autenticados y wrappers `onCall`.
- `apps/functions/src/families/family-callables.test.ts`: autorización, payloads y errores públicos.
- `apps/functions/src/index.ts`, `apps/functions/src/deploy-runtime.ts`: exports y runtime portable.
- `qa/integration/family-adapters.test.ts`: creación, lectura guardian y update contra Firestore Emulator.
- `qa/rules/client-data-boundary.test.ts`: cobertura explícita de `families` y `relationships` deny-by-default.
- `firestore.indexes.json`: índice compuesto para resolver relaciones guardian activas por adulto.
- `apps/web/src/lib/family-client.ts`: cliente callable y validación de proyecciones.
- `apps/web/src/lib/family-client.test.ts`: allowlist de payloads, proyecciones y errores seguros.
- `apps/web/src/app/admin/families/page.tsx`: alta/mantenimiento staff/admin.
- `apps/web/src/app/admin/families/page.test.tsx`: formulario multi-child, validación y permisos visuales.
- `apps/web/src/app/account/family/page.tsx`: consulta guardian de su familia.
- `apps/web/src/app/account/family/page.test.tsx`: carga, empty/error state y ausencia de acciones de escritura.
- `apps/web/src/app/account/page.tsx`, `apps/web/src/app/admin/admin-shell.tsx`: enlaces de navegación.
- `docs/data/firestore-data-model.md`: campos, índices y ownership T022.
- `tasks.md`, `Lista/Lista.js`: estado y evidencia del ledger.

---

## Task 1: Domain Contracts

**Files:**

- Create: `packages/domain/src/families/family-contracts.ts`
- Create: `packages/domain/src/families/family-contracts.test.ts`
- Modify: `packages/domain/src/profiles/profile-contracts.ts`
- Modify: `packages/domain/src/profiles/profile-contracts.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/package.json`
- Modify: `packages/domain/tsconfig.runtime.json`

**Interfaces:**

- Produces `familyStatuses = ["active", "inactive"]`, `relationshipStatuses`, `relationshipTypes = ["guardian"]`, and `familyPermissions = ["readProfile"]`.
- Produces `type FamilyRecord`, `type FamilyRelationship`, `type FamilyStudentDraft`, `type StaffFamilyProjection`, and `type GuardianFamilyProjection`.
- Produces `parseFamilyRecord(value)`, `parseFamilyRelationship(value)`, and `parseFamilyStudentDraft(value)` returning the existing `Result` type.
- Extends `StudentProfile` with optional `familyId` and keeps `parseStudentProfile` valid for T021 profiles without it.

- [ ] **Step 1: Write RED tests for contracts.**

  Cover valid active family, guardian relationship, one minor draft, optional `familyId` on existing T021 participant, duplicate/empty permissions, invalid status/type, wrong tenant-shaped IDs, unexpected enumerable/non-enumerable/symbol fields, and forbidden `medicalConditions`, `waiver`, `membershipId`, `belt`, `stripe`, and `userId` on minor drafts.

- [ ] **Step 2: Run the focused RED tests.**

  Run:

  ```text
  corepack pnpm exec vitest run --project node packages/domain/src/families/family-contracts.test.ts packages/domain/src/profiles/profile-contracts.test.ts
  ```

  Expected: FAIL because the family module and `familyId` extension do not exist.

- [ ] **Step 3: Implement exact immutable contracts.**

  Use plain-object checks, `Reflect.ownKeys`, exact allowlists, bounded text, ISO date-only validation, frozen arrays/objects, and no client authority fields in `FamilyStudentDraft`.

- [ ] **Step 4: Publish source/runtime exports.**

  Add `./families` to the domain package exports, export public types/functions from `src/index.ts`, and include `src/families/family-contracts.ts` in `tsconfig.runtime.json`.

- [ ] **Step 5: Verify the task.**

  Run:

  ```text
  corepack pnpm exec vitest run --project node packages/domain/src/families/family-contracts.test.ts packages/domain/src/profiles/profile-contracts.test.ts packages/domain/src/contracts.test.ts
  corepack pnpm --filter @bpt-jersey/domain typecheck
  corepack pnpm --filter @bpt-jersey/domain build:runtime
  ```

## Task 2: Firestore Family Store

**Files:**

- Create: `apps/functions/src/families/family-service.ts`
- Create: `apps/functions/src/families/family-service.test.ts`

**Interfaces:**

```ts
type CreateFamilyInput = Readonly<{
  academyId: string;
  actorId: string;
  tutorUserId: string;
  students: readonly FamilyStudentDraft[];
  now: string;
}>;

type UpdateFamilyInput = Readonly<{
  academyId: string;
  actorId: string;
  familyId: string;
  operation:
    | { kind: "replaceTutor"; tutorUserId: string }
    | { kind: "addStudent"; student: FamilyStudentDraft }
    | { kind: "deactivateRelationship"; studentId: string }
    | { kind: "deactivateFamily" };
  now: string;
}>;

type FamilyStore = Readonly<{
  createFamily(input: CreateFamilyInput): Promise<StaffFamilyProjection>;
  getStaffFamily(academyId: string, familyId: string): Promise<StaffFamilyProjection | undefined>;
  getGuardianFamily(
    academyId: string,
    adultUserId: string,
  ): Promise<GuardianFamilyProjection | undefined>;
  updateFamily(input: UpdateFamilyInput): Promise<StaffFamilyProjection>;
}>;
```

- [ ] **Step 1: Write fake-transaction RED tests.**

  Test atomic creation of one family plus two minors plus two relationships, preservation of creation provenance, stable deterministic relationship IDs, empty guardian lookup, same-tenant staff lookup, duplicate tutor/family rejection, minor already linked rejection, invalid Auth user rejection, tenant mismatch, replace-tutor propagation, relationship deactivation, family deactivation, and no writes to forbidden collections/fields.

- [ ] **Step 2: Run the RED store tests.**

  Run:

  ```text
  corepack pnpm exec vitest run --project node apps/functions/src/families/family-service.test.ts
  ```

  Expected: FAIL because the family service does not exist.

- [ ] **Step 3: Implement the transactional adapter.**

  Read the family, tutor, all target students, and all target relationships before any write. Use paths under `academies/{academyId}` only. Verify existing Firebase Auth user through an injected `getUser` service and verify the same-tenant `users` document is active. Create/update only `families`, `students`, and `relationships`; preserve `createdAt/createdBy`; derive minor `participantType`; and fail closed on duplicate active ownership.

- [ ] **Step 4: Implement role-specific projections.**

  Staff projection may include family, all linked students, and relationship status. Guardian projection must exclude relationships, actors, claims, audit fields, and unrelated records while returning exactly the linked family and students.

- [ ] **Step 5: Verify the store.**

  Run:

  ```text
  corepack pnpm exec vitest run --project node apps/functions/src/families/family-service.test.ts
  corepack pnpm --filter @bpt-jersey/functions typecheck
  ```

## Task 3: Protected Family Callables

**Files:**

- Create: `apps/functions/src/families/family-callables.ts`
- Create: `apps/functions/src/families/family-callables.test.ts`
- Modify: `apps/functions/src/index.ts`
- Modify: `apps/functions/src/deploy-runtime.ts`

**Interfaces:**

- Produces `createFamily`, `getFamily`, and `updateFamily` callable exports.
- Produces testable `createFamilyHandler(request, services)`, `getFamilyHandler(request, services)`, and `updateFamilyHandler(request, services)`.
- `createFamily` and `updateFamily` accept only staff/admin actor requests.
- `getFamily` accepts `{ familyId }` for staff/admin and `null` for guardian; guardian payloads containing `familyId` are rejected.

- [ ] **Step 1: Write authorization/payload RED tests.**

  Cover anonymous, malformed claims, owner/administrator success, headCoach/coach/adultStudent denial, guardian read-only success, guardian write denial, cross-tenant family ID, extra authority fields, forbidden domain fields, invalid minor draft, generic store error, and minimal role-specific response.

- [ ] **Step 2: Run callable RED tests.**

  Run:

  ```text
  corepack pnpm exec vitest run --project node apps/functions/src/families/family-callables.test.ts
  ```

  Expected: FAIL because the handlers do not exist.

- [ ] **Step 3: Implement handlers with backend authority.**

  Reuse `requireUserActor`, require administrative roles for writes, require `guardian` plus relationship resolution for guardian reads, strip all client authority fields, obtain server time/Auth identity through injected services, and map failures to generic `HttpsError` codes without logging raw payloads.

- [ ] **Step 4: Publish Functions exports and runtime mapping.**

  Export the three callables from `apps/functions/src/index.ts`; add any new domain subpath to `deploy-runtime.ts`; assert the portable deployment layout contains no workspace imports.

- [ ] **Step 5: Verify callable regressions.**

  Run:

  ```text
  corepack pnpm exec vitest run --project node apps/functions/src/families/family-callables.test.ts apps/functions/src/auth/user-authorization.test.ts apps/functions/src/deploy-runtime.test.ts
  corepack pnpm --filter @bpt-jersey/functions typecheck
  ```

## Task 4: Emulator and Rules Evidence

**Files:**

- Create: `qa/integration/family-adapters.test.ts`
- Modify: `qa/rules/client-data-boundary.test.ts`

**Interfaces:**

- Consumes the real `FamilyStore` adapter and callable handlers.
- Produces evidence for staff-created multi-child family, guardian projection, update/deactivation, same-tenant invariants, and no direct client access.

- [ ] **Step 1: Add integration RED cases.**

  Cover staff creation of two minors, guardian read returning exactly two linked minors, wrong guardian denial, tutor reassignment, deactivated relationship exclusion, duplicate child rejection, and preservation of original envelope fields.

- [ ] **Step 2: Add explicit Rules matrix entries.**

  Add `families` and `relationships` candidate/existing document reads, lists, creates, updates, and deletes to the existing deny-by-default matrix for anonymous, owner, administrator, headCoach, coach, guardian, and adultStudent.

- [ ] **Step 3: Run Emulator integration.**

  Run:

  ```text
  corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/family-adapters.test.ts qa/integration/firestore-adapters.test.ts"
  ```

  Expected: all family and existing Firestore adapter tests pass with synthetic data.

- [ ] **Step 4: Run Rules evidence.**

  Run `corepack pnpm test:rules` and require the family matrix to pass for all actors.

- [ ] **Step 5: Verify the required query index.**

  Add this entry to `firestore.indexes.json` and validate it against the guardian query:

  ```json
  {
    "collectionGroup": "relationships",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "adultUserId", "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" }
    ]
  }
  ```

  Do not apply it to production; the config change is additive and its rollback is removal of that index entry before deployment.

## Task 5: Staff and Guardian Web Flows

**Files:**

- Create: `apps/web/src/lib/family-client.ts`
- Create: `apps/web/src/lib/family-client.test.ts`
- Create: `apps/web/src/app/admin/families/page.tsx`
- Create: `apps/web/src/app/admin/families/page.test.tsx`
- Create: `apps/web/src/app/account/family/page.tsx`
- Create: `apps/web/src/app/account/family/page.test.tsx`
- Create: `qa/tests/family-relationships.spec.ts`
- Modify: `apps/web/src/app/account/page.tsx`
- Modify: `apps/web/src/app/admin/admin-shell.tsx`
- Modify: `apps/web/src/lib/login-flow.ts`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**

- `createFamily(input: CreateFamilyClientInput): Promise<StaffFamilyProjection>`.
- `getFamily(familyId?: string): Promise<StaffFamilyProjection | GuardianFamilyProjection | undefined>`.
- `updateFamily(input: UpdateFamilyClientInput): Promise<StaffFamilyProjection>`.
- Browser payloads contain only editable fields; response validators reject claims, audit, health, waiver, payment, and unrelated student data.

- [ ] **Step 1: Write client/UI RED tests.**

  Test callable allowlists and safe errors; staff form with existing tutor ID and two minor rows; add/remove draft row; required name/date/center/preferences validation; guardian view with two minors; signed-out guards; no guardian write controls; keyboard labels; responsive no-overflow assertions.

- [ ] **Step 2: Implement the callable client.**

  Use `httpsCallable` and `getFirebaseFunctions`; send only approved editable fields; validate staff/guardian projections with exact key checks and domain parsers; convert all failures into safe English messages.

- [ ] **Step 3: Implement `/admin/families`.**

  Reuse the existing admin auth gate and shell. Render a staff/admin-only family command form, multiple minor draft rows, explicit operation controls, pending/success/error states, and no fields outside T022.

- [ ] **Step 4: Implement `/account/family`.**

  Reuse `ClientAuthProvider`/`ClientAuthGate`; call `getFamily()` without a family ID; render the family and exactly its linked minors read-only; never render edit/delete controls or internal IDs.

- [ ] **Step 5: Add focused browser coverage.**

  In `qa/tests/family-relationships.spec.ts`, run the staff flow with the existing synthetic admin test gate and mocked callable responses, then run the guardian projection flow with a synthetic relationship response. Assert two minors, no staff-only relationship fields, no guardian write controls, no console errors, and no horizontal overflow at desktop/mobile viewports. Emulator tests remain the persistence/authorization evidence.

- [ ] **Step 6: Verify web behavior.**

  Run:

  ```text
  corepack pnpm exec vitest run --project web apps/web/src/lib/family-client.test.ts apps/web/src/app/admin/families/page.test.tsx apps/web/src/app/account/family/page.test.tsx apps/web/src/app/account/page.test.tsx
  corepack pnpm --filter @bpt-jersey/web typecheck
  corepack pnpm --dir qa test:e2e --grep "@family"
  ```

## Task 6: Documentation, Security Self-Critique and Gates

**Files:**

- Modify: `docs/data/firestore-data-model.md`
- Modify: `firestore.indexes.json`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`
- Review: all T022 files above

- [ ] **Step 1: Document the implemented fields and ownership.**

  Add the final field lists, relationship uniqueness rule, guardian projection, deny-by-default boundary, and additive rollback statement. Keep T023/T018/T024/T032/T083 ownership explicit.

- [ ] **Step 2: Run security self-critique.**

  Verify authentication/role checks, tenant derivation, existing-Auth-only tutor validation, duplicate-family prevention, exact payloads, projection redaction, no direct browser Firestore access, no PII in logs/tests, and the existing audit/rate-limit posture. Any critical finding blocks the task.

- [ ] **Step 3: Run the complete gates.**

  Run:

  ```text
  corepack pnpm test
  corepack pnpm test:rules
  corepack pnpm typecheck
  corepack pnpm lint
  corepack pnpm format:check
  corepack pnpm build
  git diff --check
  ```

- [ ] **Step 4: Run browser QA.**

  Run the focused staff/guardian E2E against the local synthetic environment at desktop and mobile viewports. Capture the HTML report in ignored `qa/reports/`; assert staff creates two minors, guardian reads both, cross-family access is denied, and no console errors or horizontal overflow occur.

- [ ] **Step 5: Update the ledger.**

  Move `T022` to `revisión` only after real evidence exists, record exact test counts and any non-critical dependency audit finding, and keep `T023`, `T024`, and `T018` pending.
