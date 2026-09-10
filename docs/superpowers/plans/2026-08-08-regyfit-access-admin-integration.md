# Regyfit Access Admin Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir primero la base administrativa autenticada de BPT y después importar, en Emulator/staging autorizado, los diez registros reales de `alunos-acessos` como snapshots aislados y auditados.

**Architecture:** Firebase Auth/Google autentica usuarios administrativos. Firestore Rules mantiene default-deny y permite únicamente las lecturas explícitas; los datos con `IP` se leen mediante backend/proyección, nunca mediante una supuesta regla por campo. El importador backend lee `REGYFIT_PRIVATE_STAGING_ROOT`, rechaza producción, escribe documentos deterministas por `sourceId` y solo registra metadatos en `auditEvents`.

**Tech Stack:** TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, Firebase Web SDK 12.16.0, Firebase Admin 14.2.0, Firebase Functions 7.3.2, Firestore Emulator, Vitest 4.1.10, React Testing Library, Playwright 1.61.1 y pnpm 11.20.0.

## Global Constraints

- Toda interfaz y copy visible se escribe en inglés.
- El proyecto usa pnpm y Node.js `>=22.13 <25`.
- El primer gate es Firebase Auth con Google, roles administrativos, claims y aislamiento por academia.
- Playwright valida la UI con cuentas/estados de prueba; no crea cuentas de Regyfit ni ejecuta acciones mutantes allí.
- La importación real no comienza hasta que Auth, Rules, backend y panel sintético pasen sus pruebas.
- El run real es `regyfit-20260808-acessos-01`; el módulo es `alunos-acessos`; el conteo esperado es `10`.
- El JSONL se lee solo mediante `REGYFIT_PRIVATE_STAGING_ROOT` y nunca se copia al checkout, Git, Markdown, fixtures, logs, screenshots, traces o CI.
- Los destinos permitidos son Firebase Emulator o un proyecto de staging explícitamente autorizado; el importador rechaza IDs de producción.
- La colección destino es `academies/{academyId}/regyfitAccessRecords/{sourceId}`.
- `Member Nº` es un campo de origen y nunca un ID canónico de `students` o `users`.
- `owner` puede recibir `IP`; `administrator/reception` solo recibe la proyección sin `IP`; `head coach`, `coach`, `guardian` y `adultStudent` no tienen acceso.
- Los clientes no escriben snapshots ni auditoría; solo backend/importador escribe.
- No se ejecuta despliegue a producción, exportación Regyfit, reconciliación de identidad ni borrado del staging desde la aplicación.
- No se hacen commits automáticos; cualquier commit requiere solicitud explícita del operador.
- Los locks de provisioning usan fase obligatoria, lease finito renovable con `leaseDeadline` absoluto y fencing por `lockId`; ningún proceso puede renovar indefinidamente ni dejar un bloqueo permanente.

---

## File Map

- Modify `packages/domain/src/actor-context.ts` only if role aliases are required to represent `administrator/reception` without weakening existing canonical role names.
- Create `packages/domain/src/migration/regyfit-access.ts` for the validated access-record contract, source mapping, projections and import invariants.
- Create `packages/domain/src/migration/regyfit-access.test.ts` for parser, mapping, duplicate and projection tests using synthetic records only.
- Modify `packages/domain/src/index.ts` to export the access contract explicitly.
- Create `apps/web/src/lib/firebase-client.ts` for browser Firebase initialization and emulator-safe configuration.
- Create `apps/web/src/lib/admin-auth.tsx` for Google sign-in, session state and role-aware admin context.
- Create `apps/web/src/app/admin/page.tsx` for the authenticated administrative shell and first empty state.
- Create `apps/web/src/app/admin/regyfit-access-records/page.tsx` for the read-only module surface.
- Create `apps/web/src/app/admin/admin.css` for admin-only responsive layout styles, reusing BPT tokens from `globals.css`.
- Create `apps/web/src/lib/admin-auth.test.tsx` and `apps/web/src/app/admin/regyfit-access-records/page.test.tsx` for UI/auth behavior with mocked Firebase boundaries and synthetic data.
- Create `apps/functions/src/auth/admin-authorization.ts` for custom-claims/role validation and academy scoping.
- Create `apps/functions/src/auth/admin-provisioning.ts` for owner-only admin role grants and emulator bootstrap.
- Modify `apps/functions/package.json` and `pnpm-lock.yaml` to declare the existing `@bpt-jersey/domain` workspace dependency when Functions consumes the shared contracts.
- Create `apps/functions/src/regyfit/access-records.ts` for backend read projections and privileged import use cases.
- Create `apps/functions/src/regyfit/access-records.test.ts` for owner/admin projections, denied roles, academy isolation and idempotency boundary behavior.
- Create `apps/functions/src/auth/admin-provisioning.test.ts` for owner-only grants, same-academy checks and role revocation.
- Modify `apps/functions/src/index.ts` to expose only the authenticated backend handlers required by the panel and importer.
- Modify `firestore.rules` for authenticated owner/admin reads, explicit client-write denial and tenant isolation.
- Create `qa/rules/regyfit-access-records.test.ts` for unauthenticated, role, tenant and client-write negatives using the Emulator Suite.
- Create `qa/unit/regyfit-access-import.test.ts` for synthetic JSONL parsing, run/count gates and safe audit metadata.
- Create `qa/src/regyfit/access-import.ts` only if the process entry point needs a QA-side local runner; it must delegate mapping and writes to the backend module and never contain a second data model.
- Create `qa/scripts/import-regyfit-access.mjs` as a local/emulator-only entry point that requires explicit environment gates and prints metadata only.
- Create `qa/tests/admin-auth.spec.ts` and `qa/tests/regyfit-access-records.spec.ts` for Playwright desktop/mobile flows with controlled test state and no real records in fixtures.
- Modify `qa/run-e2e.mjs` only if an explicit local admin test server/bootstrap hook is required; preserve current process cleanup and loopback-only behavior.
- Modify `docs/data/firestore-data-model.md` with the sanitized collection contract and projection boundary.
- Modify `docs/data/migrations/regyfit/field-mapping.md` with the approved status and no source values.
- Modify `docs/data/migrations/regyfit/source-inventory.md` only with sanitized implementation evidence.
- Modify `docs/data/migrations/regyfit/README.md` with the phased gate and private-data warning.
- Modify `tasks.md` with command evidence and task states after the real import validation.

---

### Task 1: Define Administrative Identity Contracts

**Files:**
- Modify: `packages/domain/src/actor-context.ts`
- Create: `packages/domain/src/auth/admin-contracts.ts`
- Create: `packages/domain/src/auth/admin-contracts.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- `AdminRole = "owner" | "administrator"`.
- `AdminClaims = Readonly<{ academyId: AcademyId; role: AdminRole }>`.
- `parseAdminClaims(value: unknown): Result<AdminClaims, ValidationIssue[]>`.
- `canReadRegyfitAccess(role: UserRole): boolean` and `canReadRestrictedIp(role: UserRole): boolean`.

- [ ] **Step 1: Write failing tests for role and claim invariants**

```ts
it("accepts only an academy-scoped owner or administrator claim", () => {
  expect(parseAdminClaims({ academyId: "academy-demo", role: "owner" }).ok).toBe(true);
  expect(parseAdminClaims({ academyId: "academy-demo", role: "coach" }).ok).toBe(false);
});

it("does not grant Regyfit access to non-administrative roles", () => {
  expect(canReadRegyfitAccess("owner")).toBe(true);
  expect(canReadRegyfitAccess("administrator")).toBe(true);
  expect(canReadRegyfitAccess("coach")).toBe(false);
  expect(canReadRestrictedIp("administrator")).toBe(false);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `corepack pnpm exec vitest run packages/domain/src/auth/admin-contracts.test.ts`

Expected: FAIL because the admin contract module does not exist.

- [ ] **Step 3: Implement the minimal immutable contract**

Validate non-empty academy IDs, exact role enums and no unknown claim fields. Keep existing canonical `UserRole` names unless a separate display label is needed; do not create a second role vocabulary for Firestore Rules.

- [ ] **Step 4: Run focused tests and static checks**

Run: `corepack pnpm exec vitest run packages/domain/src/auth/admin-contracts.test.ts`, `corepack pnpm --filter @bpt-jersey/domain typecheck`, `corepack pnpm lint`.

Expected: focused tests pass, domain typecheck exits 0 and lint has no warnings.

---

### Task 2: Add Firebase Google Authentication and Admin Session Boundary

**Files:**
- Create: `apps/web/src/lib/firebase-client.ts`
- Create: `apps/web/src/lib/admin-auth.tsx`
- Create: `apps/web/src/lib/admin-auth.test.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/package.json` only if a dependency already present in the lockfile is required by the existing Firebase SDK setup.

**Interfaces:**
- `getFirebaseClient(): FirebaseApp`.
- `signInWithGoogle(): Promise<UserCredential>`.
- `AdminSession = Readonly<{ uid: string; email: string; displayName: string; academyId: string; role: AdminRole }>`.
- `AdminAuthProvider` and `useAdminSession(): { status: "loading" | "signed-out" | "authorized" | "denied"; session?: AdminSession; signIn: () => Promise<void>; signOut: () => Promise<void> }`.

- [ ] **Step 1: Write failing tests for signed-out, authorized and denied states**

Mock the Firebase client boundary, not Firebase internals. Assert that no admin content is rendered while signed out, an owner claim reaches the authorized state, and a non-admin claim reaches denied.

- [ ] **Step 2: Run the focused web tests and verify failure**

Run: `corepack pnpm exec vitest run --project web apps/web/src/lib/admin-auth.test.tsx`

Expected: FAIL because the provider and hook do not exist.

- [ ] **Step 3: Implement emulator-safe Firebase initialization**

Read public Firebase configuration from `NEXT_PUBLIC_FIREBASE_*` variables only. Connect Auth/Firestore emulators only when an explicit local flag is set. Never put Admin SDK credentials or staging paths in browser code. Use `GoogleAuthProvider` for the production/staging sign-in path and a controlled emulator adapter for local E2E.

- [ ] **Step 4: Implement the session boundary**

Subscribe to `onIdTokenChanged`, parse only claims returned by the backend/claims contract, require a non-empty academy ID, and fail closed for missing/unknown roles. Keep auth state out of URL parameters and logs.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `corepack pnpm exec vitest run --project web apps/web/src/lib/admin-auth.test.tsx`, `corepack pnpm --filter @bpt-jersey/web typecheck`, `corepack pnpm lint`.

Expected: all auth tests pass and no production credentials are referenced.

---

### Task 3: Implement Backend Authorization, Rules and Audit Contract

**Files:**
- Create: `apps/functions/src/auth/admin-authorization.ts`
- Create: `apps/functions/src/auth/admin-authorization.test.ts`
- Create: `apps/functions/src/auth/admin-provisioning.ts`
- Create: `apps/functions/src/auth/admin-provisioning.test.ts`
- Modify: `apps/functions/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/functions/src/index.ts`
- Modify: `firestore.rules`
- Create: `qa/rules/regyfit-access-records.test.ts`
- Modify: `docs/data/firestore-data-model.md`

**Interfaces:**
- `requireAdminActor(request: CallableRequest): AdminActor`.
- `assertAcademyScope(actor: AdminActor, academyId: string): void`.
- `getRegyfitProjectionScope(role: AdminRole): "safe" | "restricted"`.
- `provisionAdminRole(request: CallableRequest, target: { uid: string; email: string; role: AdminRole }): Promise<void>`.
- `bootstrapEmulatorOwner(input: { uid: string; email: string; academyId: string }): Promise<void>`; this function rejects non-emulator targets.
- `AuditEventMetadata = Readonly<{ academyId: string; actorId: string; action: string; targetRef: string; purpose: string; correlationId: string; recordCount: number; contentSha256: string; importRunId: string }>`.
- `writeImportAuditEvent(db: Firestore, event: AuditEventMetadata): Promise<void>`.

- [ ] **Step 1: Write failing unit and Rules tests**

Cover missing auth, missing claims, wrong academy, owner full-read, administrator safe-read only through backend, all non-admin roles denied, unauthenticated access denied, and every client write denied.

- [ ] **Step 2: Run Rules tests and verify the expected failures**

Run: `corepack pnpm exec vitest run --project rules qa/rules/regyfit-access-records.test.ts`

Expected: new authorization tests fail against the current default-deny rules until the explicit rules are implemented.

- [ ] **Step 3: Implement backend authorization and metadata-only audit writes**

Reject absent/invalid claims and mismatched academy IDs. Use Admin SDK only inside Functions. Construct audit events from counts and hashes; do not accept a raw record, IP, member name, member number or login timestamp as an audit-event argument.

- [ ] **Step 4: Implement owner-only role provisioning**

Allow only an existing owner in the same academy to grant or revoke `owner`/`administrator` claims for a Google-authenticated Firebase UID. Persist the matching `users/{uid}` metadata with provider `google`, academy, active state and audit evidence. Do not create a Firebase Auth account from an email address, do not accept client-selected claims, and do not grant roles based only on a display name. The first owner is bootstrapped only through a local Emulator/staging operator gate.

- [ ] **Step 5: Implement Firestore Rules**

Keep direct owner read limited to the exact academy path and collection. Do not allow administrator direct reads of mixed documents containing `ip`; the administrator projection will be backend-only. Deny all client writes, deletes and reads for non-authorized roles. Validate `academyId` equals the path where Rules can safely do so.

- [ ] **Step 6: Run focused security checks**

Run: `corepack pnpm exec vitest run --project rules`, `corepack pnpm exec vitest run apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/admin-provisioning.test.ts`, `corepack pnpm --filter @bpt-jersey/functions typecheck`, `corepack pnpm lint`.

Expected: all authorization negatives pass; no client write path exists.

---

### Task 3A: Harden Renewable Role-Lease Recovery

**Files:**
- Modify: `apps/functions/src/auth/admin-provisioning.ts`
- Modify: `apps/functions/src/auth/admin-provisioning.test.ts`
- Modify: `tasks.md` only when recording the verified blocker resolution.

**Interfaces:**
- Persisted role locks require `lockId`, finite positive `expiresAt`, finite future `leaseDeadline`, and explicit `phase`.
- `renewRoleLock(services: AdminProvisioningServices, lock: RoleLock): Promise<void>` extends only the matching unexpired lease and never beyond `leaseDeadline`.
- A fenced `mutating` phase is finite and renewable; acquisition may recover a valid expired lease only through a new lock ID and the old operation must fail its fencing check.

- [x] **Step 1: Write failing recovery tests**

Cover required phase, valid expired `active` lease replacement, renewal before mutation, renewal during a delayed operation, rejection of stale lock IDs, and recovery of expired `mutating`/`compensating` leases without permanent blocking.

- [x] **Step 2: Run focused tests and verify the expected failures**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/admin-provisioning.test.ts`

Expected: FAIL because phase is currently optional and the fenced mutation does not renew its lease.

- [x] **Step 3: Implement minimal renewable fencing**

Require `phase` and `leaseDeadline` in the Zod lock schema. Add a bounded renewal operation that verifies the current `lockId`, phase, unexpired lease and deadline before extending `expiresAt` without exceeding `leaseDeadline`. Renew immediately before the Auth mutation and while asynchronous persistence/compensation is in progress. Stop and await in-flight renewal during cleanup. Permit replacement only for structurally valid expired locks and ensure every old operation fails closed when its lock ID is replaced. Keep recovery auditable and do not allow a stale process to delete a newer lock.

- [x] **Step 4: Run focused security checks**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/admin-provisioning.test.ts`, `corepack pnpm --filter @bpt-jersey/functions typecheck`, `corepack pnpm lint`, `corepack pnpm exec prettier --check apps/functions/src/auth/admin-provisioning.ts apps/functions/src/auth/admin-provisioning.test.ts`.

Expected: focused tests, typecheck, lint and format pass; no permanent lock path remains.

Verification: `corepack pnpm exec vitest run apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/admin-provisioning.test.ts` -> 2 files/32 tests passed; `corepack pnpm --filter @bpt-jersey/functions typecheck` -> exit 0; `corepack pnpm lint` -> exit 0; `corepack pnpm exec prettier --check apps/functions/src/auth/admin-provisioning.ts apps/functions/src/auth/admin-provisioning.test.ts` -> all files use Prettier style. Root `corepack pnpm test` -> 14 files/83 tests passed. `corepack pnpm audit --audit-level high` remains clear of high/critical findings and reports the two previously registered moderate advisories.

---

### Task 4: Build the Administrative Shell Before Real Data

**Files:**
- Create: `apps/web/src/app/admin/page.tsx`
- Create: `apps/web/src/app/admin/admin.css`
- Create: `apps/web/src/app/admin/page.test.tsx`
- Create: `qa/tests/admin-shell.spec.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/globals.css` only for shared focus/skip-link tokens if required.

**Interfaces:**
- `AdminShell({ children, session }: { children: ReactNode; session: AdminSession }): JSX.Element`.
- Navigation labels: `Overview`, `Members`, `Attendance`, `Reports`, `CRM`, `Finance`, `Regyfit Access Records`.
- Uncaptured modules render `Not yet imported` and never fabricate records.

- [x] **Step 1: Write failing RTL tests**

Assert English labels, authenticated shell landmarks, active navigation, mobile-safe content, `Not yet imported` states and no IP/member values in the empty state.

- [x] **Step 2: Run the focused test and verify failure**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/page.test.tsx`

Expected: FAIL because the admin shell does not exist.

- [x] **Step 3: Implement the responsive shell**

Reuse BPT purple, mat ink, canvas, Barlow Condensed and Source Sans 3. Use semantic navigation, skip link, visible focus, keyboard-accessible controls and a desktop sidebar that collapses without horizontal overflow on mobile. Keep this phase data-free.

- [x] **Step 4: Run web tests, typecheck, lint and E2E shell smoke**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/page.test.tsx`, `corepack pnpm --filter @bpt-jersey/web typecheck`, `corepack pnpm lint`, `corepack pnpm --dir qa exec node run-e2e.mjs tests/admin-shell.spec.ts --project=desktop-chromium --project=mobile-chromium`.

Expected: shell tests pass with no real data or auth secrets.

Verification: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/page.test.tsx` -> 1 file/5 tests passed; `corepack pnpm --filter @bpt-jersey/web typecheck` -> exit 0; `corepack pnpm --dir qa typecheck` -> exit 0; `corepack pnpm lint` -> exit 0; `corepack pnpm exec prettier --check apps/web/src/app/admin/page.tsx apps/web/src/app/admin/page.test.tsx apps/web/src/app/admin/admin.css qa/tests/admin-shell.spec.ts` -> all files use Prettier style; `corepack pnpm --filter @bpt-jersey/web build` -> static `/admin` generated; `corepack pnpm --dir qa exec node run-e2e.mjs tests/admin-shell.spec.ts --project=desktop-chromium --project=mobile-chromium` -> 2/2 passed with focus, data-free and document/body overflow checks. Review: Spec compliance PASS; Task quality PASS with the static-server route rewrite documented as a residual minor.

---

### Task 5: Define the Regyfit Access Snapshot and Safe Projections

**Files:**
- Create: `packages/domain/src/migration/regyfit-access.ts`
- Create: `packages/domain/src/migration/regyfit-access.test.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/functions/src/regyfit/access-records.ts`
- Create: `apps/functions/src/regyfit/access-records.test.ts`

**Interfaces:**
- `RegyfitAccessSourceRow = Readonly<{ sourceId: string; member: string; memberNumber: string; loginCount: number; lastLogin: string | null; ip: string }>`.
- `RegyfitAccessRecord = Readonly<{ academyId: string; sourceSystem: "regyfit"; sourceId: string; memberDisplayName: string; memberNumber: string; loginCount: number; lastLoginAt: UtcDateTime | null; ip: string; importRunId: string; capturedAt: UtcDateTime; schemaVersion: "1" }>`.
- `mapRegyfitAccessRow(row: unknown, context: { academyId: string; importRunId: string; capturedAt: UtcDateTime }): Result<RegyfitAccessRecord, ValidationIssue[]>`.
- `toSafeRegyfitAccessProjection(record: RegyfitAccessRecord): Omit<RegyfitAccessRecord, "ip">`.
- `toRestrictedRegyfitAccessProjection(record: RegyfitAccessRecord): RegyfitAccessRecord`.
- `assertUniqueSourceIds(records: readonly RegyfitAccessRecord[]): void`.

- [x] **Step 1: Write failing mapping/projection tests**

Use synthetic rows such as `Synthetic Member`, `source-demo-1`, `42`, a fixed UTC timestamp and `203.0.113.10`. Assert exact field mapping, date normalization, rejected invalid types, rejected empty IDs, duplicate source IDs and absence of `ip` from the safe projection.

- [x] **Step 2: Run the focused tests and verify failure**

Run: `corepack pnpm exec vitest run packages/domain/src/migration/regyfit-access.test.ts apps/functions/src/regyfit/access-records.test.ts`

Expected: FAIL because the access contract and backend projection functions do not exist.

- [x] **Step 3: Implement the pure mapper and projection functions**

Treat source IDs as opaque non-empty strings. Preserve `Member Nº` as `memberNumber`; do not derive `userId`, `studentId` or an Auth identity. Reject credentials, malformed IP strings and raw unexpected object fields. Keep validated objects immutable.

- [x] **Step 4: Implement backend query/projection functions**

Query only the current academy collection, require the actor scope from Task 3, return full records only to owner and strip `ip` for administrator/reception. Return a typed forbidden result for all other roles. Do not expose a generic collection endpoint.

- [x] **Step 5: Run focused checks**

Run: `corepack pnpm exec vitest run packages/domain/src/migration/regyfit-access.test.ts apps/functions/src/regyfit/access-records.test.ts`, `corepack pnpm --filter @bpt-jersey/domain typecheck`, `corepack pnpm --filter @bpt-jersey/functions typecheck`, `corepack pnpm lint`.

Expected: mapping, projection and backend authorization tests pass.

Verification: focused mapper/projection tests -> 2 files/17 tests passed; root `corepack pnpm test:unit` -> 17 files/105 tests passed; domain/functions typechecks -> exit 0; `corepack pnpm lint` -> exit 0; targeted Prettier -> all five Task 5 files use the configured style; `corepack pnpm audit --audit-level high` -> no high/critical findings, with the two registered moderate advisories remaining. Review: Spec compliance ADDRESSED; Task quality ADDRESSED. Minor residuals: infrastructure read failures are not wrapped locally and the typed mapper context is not runtime-checked for plain prototype; neither exposes records or secrets.

---

### Task 6: Implement the Read-only Regyfit Access Records Panel

**Files:**
- Create: `apps/web/src/app/admin/regyfit-access-records/page.tsx`
- Create: `apps/web/src/app/admin/regyfit-access-records/page.test.tsx`
- Modify: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/app/admin/admin.css`

**Interfaces:**
- `RegyfitAccessRecordsPage({ records, role }: { records: readonly SafeRegyfitAccessProjection[]; role: AdminRole }): JSX.Element`.
- Search is case-insensitive over `memberDisplayName`, `memberNumber` and `sourceId`.
- Filters are `all`, `active`, `inactive` based only on observed login data; no unobserved business status is invented.
- Detail view shows the safe projection for administrator/reception and adds `IP` only for owner.

- [x] **Step 1: Write failing component tests**

Assert table/card rendering, search, no-results state, filter changes, detail selection, owner-only IP rendering and administrator omission of IP. Use synthetic values only.

- [x] **Step 2: Run the focused web test and verify failure**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/regyfit-access-records/page.test.tsx`

Expected: FAIL because the module page does not exist.

- [x] **Step 3: Implement the panel**

Use a client boundary only for local search/filter/detail state. Fetch records through the typed backend boundary; never import Firebase Admin or staging readers in `apps/web`. Mark restricted IP visibly, keep actions read-only, and provide accessible labels and responsive table-to-card behavior.

- [x] **Step 4: Run unit, type and lint checks**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/regyfit-access-records/page.test.tsx`, `corepack pnpm --filter @bpt-jersey/web typecheck`, `corepack pnpm lint`.

Expected: UI tests pass and the client bundle contains no staging-root or Admin SDK reference.

Verification: focused panel + shell -> 2 files/13 tests passed; full web project -> 5 files/23 tests passed; `corepack pnpm --filter @bpt-jersey/web typecheck` -> exit 0; `corepack pnpm lint` -> exit 0; targeted Prettier -> all four Task 6 files use the configured style; web build -> `/admin` and `/admin/regyfit-access-records` prerendered. Review: Spec compliance ADDRESSED; Task quality ADDRESSED. Authentication/backend loading and browser E2E remain deliberately assigned to Task 7; minor notes include the broad internal projection alias and owner preview role in the shell.

---

### Task 7: Add Controlled Admin Test Bootstrap and Playwright Coverage

**Files:**
- Create: `qa/tests/admin-auth.spec.ts`
- Create: `qa/tests/regyfit-access-records.spec.ts`
- Create: `qa/src/admin-test-bootstrap.ts` if the E2E server needs a controlled auth/data adapter.
- Create: `apps/web/src/app/admin/admin-gate.tsx`
- Create: `apps/web/src/app/admin/admin-shell.tsx` if the authenticated shell needs a client boundary.
- Create: `apps/web/src/lib/admin-test-bootstrap.ts` for the compile-time guarded synthetic E2E boundary.
- Modify: `apps/web/src/app/admin/page.tsx` to apply the authenticated gate.
- Modify: `apps/web/src/app/admin/regyfit-access-records/page.tsx` so its direct route uses the same gate.
- Modify: `apps/web/src/app/admin/page.test.tsx` only for the authenticated preview test boundary.
- Modify: `apps/web/src/app/admin/admin.css` for authenticated/denied states if required.
- Modify: `apps/web/src/lib/admin-auth.tsx` only for the explicit emulator/test boundary.
- Modify: `qa/playwright.config.ts` only for explicit local admin test flags.
- Modify: `qa/run-e2e.mjs` only to pass the existing loopback-safe test environment.

**Interfaces:**
- Test-only roles: `owner`, `administrator`, `coach`, `guardian`, `adultStudent`.
- Test-only synthetic records must use a `synthetic-*` source ID and never the real run ID.
- The test bootstrap must reject `production` project IDs and must not read `REGYFIT_PRIVATE_STAGING_ROOT`.
- The web test boundary is active only when `NEXT_PUBLIC_ADMIN_E2E=true` is baked into the test build; production builds must not activate it.

- [x] **Step 1: Write failing E2E tests**

Cover signed-out redirect/denial, owner access with IP, administrator safe projection without IP, coach/guardian/adult-student denial, search/filter/detail, desktop and Pixel 7 viewports, no console errors and no horizontal overflow.

- [x] **Step 2: Run the focused E2E tests and verify failure**

Run: `corepack pnpm --dir qa exec playwright test tests/admin-auth.spec.ts tests/regyfit-access-records.spec.ts`

Expected: FAIL because the admin route and controlled bootstrap do not exist.

- [x] **Step 3: Implement the authenticated route and controlled test bootstrap**

Apply `AdminAuthProvider` at the `/admin` route so signed-out and denied states fail closed. For the browser suite, use an explicitly mocked typed boundary guarded by `NEXT_PUBLIC_ADMIN_E2E=true`, query-selected test roles, and synthetic records only; production builds must never read that boundary. Do not use Google credentials in CI, do not create real user accounts, and do not attach screenshots/traces containing real data.

- [x] **Step 4: Implement E2E assertions and run focused projects**

Run: `$env:NEXT_PUBLIC_ADMIN_E2E="true"; corepack pnpm --filter @bpt-jersey/web build`, then `corepack pnpm --dir qa exec node run-e2e.mjs tests/admin-auth.spec.ts tests/regyfit-access-records.spec.ts --project=desktop-chromium --project=mobile-chromium`.

Expected: all admin E2E tests pass on both viewports with no unauthorized IP exposure.

Verification: normal web build with `NEXT_PUBLIC_ADMIN_E2E` unset -> exit 0 and generated admin HTML/chunks contain no synthetic records/IP; E2E web build with the flag -> exit 0; focused admin RTL/bootstrap -> 35/35; root `corepack pnpm test` -> 19 files/129 tests; web/QA typechecks -> exit 0; lint and targeted Prettier -> pass; Playwright -> 24/24 desktop Chromium + Pixel 7 with signed-out/denied gates, owner/admin projections, console/page errors and overflow checks; audit -> no high/critical, two registered moderate advisories. Review: Spec compliance ADDRESSED; Task quality ADDRESSED. `importRunId` remains visible to administrator because the approved safe projection omits only `ip`.

---

### Task 8: Implement the Emulator-only Idempotent Importer

**Files:**
- Create: `qa/unit/regyfit-access-import.test.ts`
- Create: `qa/scripts/import-regyfit-access.mjs`
- Create: `apps/functions/src/regyfit/access-import.ts`
- Create: `apps/functions/src/regyfit/access-import.test.ts`
- Modify: `apps/functions/src/index.ts` only if the importer needs a backend-internal export.
- Modify: `qa/package.json` with `import:regyfit-access` only after the command is implemented.

**Interfaces:**
- `ImportConfig = Readonly<{ privateStagingRoot: string; runId: string; moduleKey: "alunos-acessos"; sourceRoute: string; academyId: string; target: "emulator" | "staging" }>`.
- `ImportReceipt = Readonly<{ runId: string; moduleKey: string; importedCount: number; skippedCount: number; contentSha256: string; auditEventPath: string }>`.
- `importRegyfitAccessRecords(config: ImportConfig, db: Firestore, now: UtcDateTime): Promise<ImportReceipt>`.
- `assertImportTargetIsSafe(config: ImportConfig, projectId: string): void`.

- [x] **Step 1: Write failing synthetic importer tests**

Test exact run/module/route gates, expected count `10`, malformed JSONL rejection before writes, duplicate `sourceId` rejection, production-target rejection, metadata-only audit event and repeat import resulting in exactly one document per source ID.

- [x] **Step 2: Run the focused importer tests and verify failure**

Run: `corepack pnpm exec vitest run apps/functions/src/regyfit/access-import.test.ts qa/unit/regyfit-access-import.test.ts`

Expected: FAIL because the importer and runner do not exist.

- [x] **Step 3: Implement private staging reader**

Resolve the JSONL path only from `REGYFIT_PRIVATE_STAGING_ROOT` plus the fixed run/module/chunk segments. Reject repository descendants, missing private marker, missing file, wrong line count and non-object JSON. Never include a raw line, path with private-root detail, or source field in an exception or console message.

- [x] **Step 4: Implement idempotent backend writes**

Map every row through `mapRegyfitAccessRow`, reject duplicate IDs, compute the content hash from canonical serialized records, and write the deterministic document path. If an existing document with the same `sourceId` has the same canonical record and run, count it as skipped; if it conflicts, abort rather than overwrite. Write one metadata-only `auditEvents` document after all writes succeed.

- [x] **Step 5: Implement explicit target guards**

Require `REGYFIT_RUN_ID`, `REGYFIT_MODULE_KEY`, `REGYFIT_SOURCE_ROUTE`, `REGYFIT_ACADEMY_ID`, `REGYFIT_IMPORT_TARGET`, `REGYFIT_CAPTURED_AT` and `FIRESTORE_EMULATOR_HOST` for emulator mode. Reject `GCLOUD_PROJECT`/`FIREBASE_CONFIG` values known to be production and reject staging mode unless an explicit operator staging confirmation variable is present. Do not make a production code path.

- [x] **Step 6: Run focused importer checks**

Run: `corepack pnpm exec vitest run apps/functions/src/regyfit/access-import.test.ts qa/unit/regyfit-access-import.test.ts`, `corepack pnpm --filter @bpt-jersey/functions typecheck`, `corepack pnpm --dir qa typecheck`, `corepack pnpm lint`.

Expected: synthetic importer tests pass and no real staging data is read.

Verification: focused importer -> 2 files/16 tests; `corepack pnpm test:unit` -> 21 files/145 tests; Functions/QA typechecks -> exit 0; lint, targeted Prettier and `node --check qa/scripts/import-regyfit-access.mjs` -> pass; audit -> no high/critical, two registered moderate advisories. Direct target guards run before staging/Firestore access; the runner requires fixed canonical `REGYFIT_CAPTURED_AT`. Review: Spec compliance ADDRESSED; Task quality ADDRESSED. Minor residual: intermediate symlink coverage is implemented by `realpath` but not separately fixture-tested.

---

### Task 9: Run the Real Import Only After All Previous Gates

**Files:**
- Modify: `docs/data/migrations/regyfit/field-mapping.md`
- Modify: `docs/data/migrations/regyfit/source-inventory.md`
- Modify: `docs/data/migrations/regyfit/README.md`
- Modify: `tasks.md`
- Do not create or modify: JSONL, fixtures, screenshots, traces, CI artifacts or private staging files.

- [ ] **Step 1: Verify prerequisites immediately before import**

Run the existing sanitised staging check with `REGYFIT_PRIVATE_STAGING_ROOT` and verify marker, fixed run, fixed module and exactly ten lines without printing records. Run all prior focused tests, `corepack pnpm test:rules`, and the admin E2E suite. Abort if any gate fails.

- [ ] **Step 2: Start only the local Emulator Suite**

Run: `corepack pnpm firebase:emulators` with `GCLOUD_PROJECT=demo-bpt-jersey`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and the explicit `REGYFIT_IMPORT_TARGET=emulator` gate. Confirm the process is loopback-only before importing.

- [ ] **Step 3: Execute the real import through the guarded runner**

Run the new `corepack pnpm --dir qa import:regyfit-access` command with `REGYFIT_PRIVATE_STAGING_ROOT` set in the process environment, `REGYFIT_RUN_ID=regyfit-20260808-acessos-01`, `REGYFIT_MODULE_KEY=alunos-acessos`, the documented source route, `REGYFIT_ACADEMY_ID=demo-academy` for the emulator tenant, `REGYFIT_IMPORT_TARGET=emulator`, and an operator-approved fixed `REGYFIT_CAPTURED_AT` canonical UTC timestamp.

Expected output contains only run ID, module key, imported/skipped counts, hash and sanitized audit path. It must report `importedCount + skippedCount = 10` and no record values.

- [ ] **Step 4: Verify exactly ten records and no duplicate source IDs**

Use Admin SDK/emulator inspection in a test script that prints only `count`, `distinctSourceIdCount`, `importRunIdCount` and `auditEventCount`. Assert `count = 10`, `distinctSourceIdCount = 10`, and one audit event for the run. Do not attach raw snapshots or query output.

- [ ] **Step 5: Verify real-data permissions through the panel**

Run owner and administrator flows against the local/emulated dataset. Assert owner can see the restricted IP field, administrator/reception cannot, and all other roles are denied. Do not store screenshots or traces from this run if they contain real values; configure Playwright artifacts off for the real-data check.

- [ ] **Step 6: Record only sanitized evidence**

Update the migration docs and `tasks.md` with run ID, module, count, distinct-ID count, hash, target environment, command exit codes, audit metadata path category and staging deletion date. Do not write names, member numbers, login timestamps, IPs or raw paths.

---

### Task 10: Full Verification and Self-Critique Gate

**Files:**
- Modify: `tasks.md` only after every verification command passes.
- No production files or deployment configuration may be changed.

- [ ] **Step 1: Run unit and integration suites**

Run: `corepack pnpm test`, `corepack pnpm test:rules`, `corepack pnpm --dir qa typecheck`.

- [ ] **Step 2: Run lint, typecheck, format and dependency audit**

Run: `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm format:check`, `corepack pnpm audit --audit-level high`.

Expected: no lint/type errors, formatter clean, and no high/critical vulnerabilities. Existing documented moderate transitives must remain unchanged or be explicitly documented.

- [ ] **Step 3: Run Playwright E2E**

Run: `corepack pnpm test:e2e` and repeat the admin smoke if needed with `corepack pnpm --dir qa exec playwright test tests/admin-auth.spec.ts tests/regyfit-access-records.spec.ts --project=desktop-chromium --project=mobile-chromium`.

Expected: desktop/mobile admin flows pass without console errors, overflow or permission leakage.

- [ ] **Step 4: Run diff hygiene and sensitive-artifact scans**

Run: `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check` and scan the diff for JSONL paths, real member values, IP addresses, emails, screenshots, traces and staging-root contents. The scan must report no real values in versioned files.

- [ ] **Step 5: Perform security self-review**

Verify: client cannot write/import, owner-only IP exposure, admin projection omits IP, tenant path/field match, production guard, no raw audit payload, no staging path in logs, no Regyfit mutation/export controls, and no identity reconciliation.

- [ ] **Step 6: Update task evidence without claiming production readiness**

Record fresh command output and the emulator-only import result in `tasks.md`. Set only the scoped implementation task to `revisión` after security and QA pass; do not mark it `aprobada` or `desplegada` without the required operator checkpoint.

## Execution Notes

The implementation must stop at the first failed gate. The real-data import is intentionally the last implementation task, not a fixture source for earlier UI work. If the Google OAuth configuration is unavailable locally, use the Firebase Auth Emulator/test adapter for automated verification and keep the real Google path behind environment configuration; do not introduce credentials or bypass authentication.
