# T083 IBJJF Levels Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and expose the complete 171-definition IBJJF Levels catalog through protected read-only backend projections and the `/admin/levels`, `/coach/levels`, and `/account/progress` surfaces.

**Architecture:** A strict domain contract parses the sanitized Regyfit inventory and the DOCX-derived business-criteria artifact. An explicit, idempotent seed writes immutable versioned documents to `academies/{academyId}/levelSystems`, `levelDefinitions`, and `levelRequirements`; Functions derive the academy from authenticated claims and return a safe catalog projection. Firestore Rules remain deny-by-default, and all three UIs consume the same validated client projection without write controls.

**Tech Stack:** TypeScript 6, pnpm workspaces, Firebase Functions v2 callable handlers, Firebase Admin Firestore, Firestore Emulator Suite, Next.js 16 App Router, React 19, Vitest, React Testing Library, Playwright.

## Global Constraints

- All user-facing UI, navigation, messages, and generated content remain in English.
- The catalog must contain exactly 171 definitions, 27 belts, 144 stripes, and 11 skills.
- `BPTJ FUNCTIONS APP.docx` and `BPT-memberships.docx` govern age, class, and time criteria.
- `docs/data/ibjjf-levels-observed.sanitized.json` governs observed hierarchy, order, colors, stripe count, and skills.
- Regyfit remains read-only; no synchronization, credential use, token/cookie storage, member data, or personal data is added.
- No browser write operation, level evaluation, student progress mutation, belt/stripe promotion, or automatic recognition is included.
- Backend requests derive `academyId` from authenticated claims; clients cannot submit an academy scope.
- Firestore Rules remain direct-client deny-by-default; the backend is the only read path for the catalog.
- Seed and rollback are allowed only in Emulator or explicitly isolated staging; production writes and deployment are out of scope.
- Existing `T009` assessment/promotion ownership is unchanged; `studentLevelProgress` and `levelPromotions` are not created by T083.
- Do not add a new package or dependency; use existing workspace contracts and test tooling.

---

## File Map

Create these focused files:

- `docs/data/ibjjf-levels-business-criteria.sanitized.json`: DOCX-derived, non-personal canonical age/class/time criteria keyed by the 171 observed level keys.
- `packages/domain/src/levels/level-contracts.ts`: immutable types, enums, exact-field parsers, source merge validation, and catalog projection contracts.
- `packages/domain/src/levels/level-contracts.test.ts`: parser, counts, precedence, and malformed-source tests.
- `apps/functions/src/levels/level-source.ts`: source normalization from the two checked-in sanitized artifacts.
- `apps/functions/src/levels/level-source.test.ts`: source merge and exact inventory tests.
- `apps/functions/src/levels/level-service.ts`: Firestore adapter, catalog reads, idempotent seed, and non-production rollback.
- `apps/functions/src/levels/level-service.test.ts`: adapter isolation, immutable versioning, seed retry, and rollback tests.
- `apps/functions/src/levels/level-callables.ts`: authenticated `listLevelCatalog` callable and role projection.
- `apps/functions/src/levels/level-callables.test.ts`: payload, actor, tenant, role, and safe-projection tests.
- `apps/functions/src/levels/level-seed.ts`: explicit seed entry point with environment guard.
- `apps/functions/src/levels/level-seed.test.ts`: production refusal and emulator/staging seed tests.
- `apps/functions/scripts/seed-levels.mjs`: post-build operator command that forwards only explicit non-production seed arguments.
- `apps/web/src/lib/levels-client.ts`: callable client and strict response validation.
- `apps/web/src/lib/levels-client.test.ts`: client validation and safe error tests.
- `apps/web/src/app/levels/levels-browser.tsx`: shared read-only catalog browser and filters.
- `apps/web/src/app/levels/levels-browser.test.tsx`: shared UI behavior and no-write assertions.
- `apps/web/src/app/levels/levels.css`: responsive catalog presentation, belt SVG styling, and empty/error/loading states.
- `apps/web/src/app/admin/levels/page.tsx`: owner/administrator/head-coach administrative catalog surface.
- `apps/web/src/app/admin/levels/page.test.tsx`: administrative surface tests.
- `apps/web/src/app/coach/layout.tsx`: staff access boundary for coach routes.
- `apps/web/src/app/coach/levels/page.tsx`: coach/head-coach catalog surface.
- `apps/web/src/app/coach/levels/page.test.tsx`: coach surface tests.
- `apps/web/src/app/account/progress/page.tsx`: authenticated guardian/adult-student catalog surface without fabricated progress.
- `apps/web/src/app/account/progress/page.test.tsx`: account surface tests.
- `apps/web/src/lib/staff-auth.tsx`: role-aware staff session gate for `headCoach` and `coach`.
- `apps/web/src/lib/staff-auth.test.tsx`: allowed and denied staff roles.
- `qa/integration/level-catalog.test.ts`: Firestore Emulator seed/read/rollback integration tests.
- `qa/rules/level-catalog-boundary.test.ts`: direct client read/write denial tests.
- `qa/tests/levels.spec.ts`: desktop/mobile Playwright read-only coverage for the three surfaces.

Modify these existing files:

- `packages/domain/package.json`: add the `./levels` export.
- `packages/domain/tsconfig.runtime.json`: include `src/levels/level-contracts.ts` in runtime output.
- `packages/domain/src/index.ts`: export level contracts and parser symbols.
- `apps/functions/src/index.ts`: export `listLevelCatalog`; do not export the seed as a deployed callable.
- `apps/web/src/app/admin/admin-shell.tsx`: add the Levels navigation item and hide unrelated items for head coach sessions.
- `apps/web/src/app/admin/admin-gate.tsx`: allow `headCoach` only for `/admin/levels`; preserve denial for unrelated admin routes.
- `apps/web/src/lib/admin-auth.tsx`: preserve the existing owner/administrator session while supporting the restricted head-coach Levels route.
- `apps/web/src/app/account/page.tsx`: add the English link to `/account/progress`.
- `docs/data/firestore-data-model.md`: document the three catalog collections, fields, classification, and rollback boundary.
- `tasks.md` and `Lista/Lista.js`: update T083 status and evidence only after all verification passes.

---

## Task 1: Freeze the Source and Domain Contract

**Files:**

- Create: `docs/data/ibjjf-levels-business-criteria.sanitized.json`
- Create: `packages/domain/src/levels/level-contracts.ts`
- Create: `packages/domain/src/levels/level-contracts.test.ts`
- Modify: `packages/domain/package.json`
- Modify: `packages/domain/tsconfig.runtime.json`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/levels/level-contracts.test.ts`

**Interfaces:**

- Produces `LevelSystemRecord`, `LevelDefinitionRecord`, `LevelRequirementRecord`, `LevelCatalogProjection`, `parseLevelCatalogSource`, `parseLevelCatalogProjection`, `levelDefinitionKinds`, and `levelRequirementInheritanceModes`.
- `parseLevelCatalogSource` accepts the observed JSON object and the DOCX-derived criteria object and returns `Result<CanonicalLevelCatalog, readonly ValidationIssue[]>`.
- Every persisted record carries `academyId`, `schemaVersion: 1`, `systemId`, and a version/source hash; no client-controlled actor or timestamp fields are part of the seed input.

- [x] **Step 1: Transcribe the DOCX criteria artifact**

Create `ibjjf-levels-business-criteria.sanitized.json` with this exact top-level shape:

```json
{
  "schemaVersion": 1,
  "sourceDocuments": ["BPTJ FUNCTIONS APP.docx", "BPT-memberships.docx"],
  "precedence": "DOCX",
  "levels": {
    "white-belt-kids-4-5-and-5-7-yo": {
      "minAge": null,
      "maxAge": 7,
      "minClasses": 4,
      "minimumTime": { "years": 0, "months": 0, "days": 30 }
    }
  }
}
```

Transcribe all 171 observed keys from the approved DOCX sources using the same object shape. Keep unavailable values as `null`; do not infer missing ages or convert Regyfit anomalies into business rules. Add a computed SHA-256 for the complete payload to the implementation evidence after the file is complete.

- [x] **Step 2: Write failing domain tests**

Add tests that require:

```ts
const catalog = parseLevelCatalogSource(observedJson, businessCriteriaJson);

expect(catalog.ok).toBe(true);
if (catalog.ok) {
  expect(catalog.value.definitions).toHaveLength(171);
  expect(catalog.value.definitions.filter((level) => level.kind === "belt")).toHaveLength(27);
  expect(catalog.value.definitions.filter((level) => level.kind === "stripe")).toHaveLength(144);
  expect(catalog.value.skills).toHaveLength(11);
  expect(catalog.value.requirements).toHaveLength(165);
}
```

Also test duplicate keys, orphan `parentKey`, missing DOCX criteria keys, invalid color values, invalid rating values, unexpected properties, and a Regyfit `observedCriteria` conflict where the returned canonical `criteria` equals the DOCX value while the observed value remains in `observedCriteria`.

- [x] **Step 3: Run the focused RED test**

Run:

```bash
corepack pnpm exec vitest run --project node packages/domain/src/levels/level-contracts.test.ts
```

Expected: FAIL because the Levels contract and parser do not exist yet.

- [x] **Step 4: Implement the exact contract and parser**

Use immutable records and exact-field validation consistent with `finance-contracts.ts`. The canonical definition shape must include `definitionKey`, `systemId`, `kind`, `parentDefinitionKey`, `name`, `sequence`, `stripeNumber`, `criteria`, `observedCriteria`, `visual`, `observedSkillRequirementSetKey`, `observedSkillRequirementsState`, and `anomalyFlags`. A requirement must include `requirementKey`, `definitionKey`, `skillKey`, `minimumRating`, and `inheritance: "inherit" | "replace" | "none"`.

Use `DOCX` criteria for `criteria`, preserve Regyfit values under `observedCriteria`, and reject any source graph that is not exactly 27 roots plus 144 children. Preserve the 11 skills as a small immutable catalog embedded in the system record; do not create an unplanned fourth collection.

- [x] **Step 5: Export the contract**

Add the `./levels` package export, runtime compilation entry, root exports, and tests proving `@bpt-jersey/domain/levels` and `@bpt-jersey/domain` expose the same parser/types.

- [x] **Step 6: Run the focused GREEN test**

Run:

```bash
corepack pnpm exec vitest run --project node packages/domain/src/levels/level-contracts.test.ts packages/domain/src/contracts.test.ts
corepack pnpm --filter @bpt-jersey/domain typecheck
```

Expected: all focused tests pass and the domain package typecheck exits 0.

---

## Task 2: Normalize, Persist, Seed, and Roll Back the Catalog

**Files:**

- Create: `apps/functions/src/levels/level-source.ts`
- Create: `apps/functions/src/levels/level-source.test.ts`
- Create: `apps/functions/src/levels/level-service.ts`
- Create: `apps/functions/src/levels/level-service.test.ts`
- Create: `apps/functions/src/levels/level-seed.ts`
- Create: `apps/functions/src/levels/level-seed.test.ts`
- Create: `apps/functions/scripts/seed-levels.mjs`
- Modify: `docs/data/firestore-data-model.md`
- Test: `qa/integration/level-catalog.test.ts`

**Interfaces:**

- `normalizeLevelCatalogSource(observed: unknown, businessCriteria: unknown): CanonicalLevelCatalog`.
- `createLevelCatalogStore({ firestore }): LevelCatalogStore`.
- `LevelCatalogStore.listPublished(academyId): Promise<LevelCatalogProjection>`.
- `LevelCatalogStore.seed(input): Promise<LevelSeedResult>`.
- `LevelCatalogStore.rollbackSeed(input): Promise<LevelSeedResult>`.
- `seedLevelCatalog(input): Promise<LevelSeedResult>` refuses `production` before opening Firestore.

- [x] **Step 1: Write failing source and store tests**

Test that normalization returns the exact counts, stores only sanitized source metadata, and never returns `source.url`. Test that `seed` writes:

```text
academies/{academyId}/levelSystems/ibjjf-v1
academies/{academyId}/levelDefinitions/{definitionKey}
academies/{academyId}/levelRequirements/{requirementKey}
```

The system document must include `sourceHash`, `seedRunId`, `status: "published"`, `definitionCount: 171`, `beltCount: 27`, `stripeCount: 144`, and `skillCount: 11`. A second seed with the same `systemId` and `sourceHash` returns the same counts without duplicating or changing documents. A different hash for the same immutable `systemId` fails closed.

- [x] **Step 2: Run the focused RED tests**

Run:

```bash
corepack pnpm exec vitest run --project node apps/functions/src/levels/level-source.test.ts apps/functions/src/levels/level-service.test.ts apps/functions/src/levels/level-seed.test.ts
```

Expected: FAIL because the source adapter, store, and seed guard do not exist.

- [x] **Step 3: Implement the source adapter**

Keep file reading outside the callable runtime. The adapter accepts parsed JSON values, invokes the domain parser, and returns the canonical records plus source hash. The explicit seed entry point reads only `docs/data/ibjjf-levels-observed.sanitized.json` and `docs/data/ibjjf-levels-business-criteria.sanitized.json`; Functions never contact Regyfit.

- [x] **Step 4: Implement the Firestore store**

Use the existing adapter style from `membership-service.ts`. Validate every path segment, assert that document `academyId` matches the path, parse every document before returning it, and sort definitions by `sequence` and requirements by `skillKey`. Use one Firestore batch per seed because 337 catalog documents are below the 500-write batch limit. Do not delete an older immutable version when a new system is introduced.

> Corrección posterior T101 (2026-09-03): la revisión de cierre comprobó que el store actual escribe de forma secuencial y puede declarar un replay idempotente después de un fallo parcial. Staging permanece bloqueado hasta implementar publicación atómica o por estados verificables, manifest de integridad y rollback con referencias comprobadas.

> Cierre T101 (2026-09-04): la publicación es una única transacción (337 documentos + manifest + auditoría), el replay solo es idempotente tras verificar sistema, hijos, manifest y auditoría, las fuentes se resuelven desde el módulo con hashes aprobados y el rollback exige manifest íntegro, cero referencias y auditoría. El CLI carga `firebase-admin` desde el artefacto `.firebase-functions` porque mezclar dos copias del SDK impedía serializar `FieldValue.serverTimestamp()`. Evidencia en `tasks.md`.

The read projection must omit `source.url`, raw source payloads, cookies, tokens, actor IDs, and server timestamps. It may include sanitized `anomalyFlags` and the source-precedence labels required by the UI.

- [x] **Step 5: Implement explicit seed and rollback guards**

Accept only `target: "emulator" | "staging"` and reject `target: "production"` or an absent target before any Admin SDK call. `--target` and `--academy-id` are always explicit. Seed rejects `--system-id` because the approved source defines it; rollback requires `--rollback --system-id=ibjjf-v1`. Staging requires `confirmation: "T083-LEVELS-SEED"` for seed and `confirmation: "T083-LEVELS-ROLLBACK"` for rollback.

The post-build command must accept only `--target`, `--academy-id`, `--system-id`, `--confirmation`, and the boolean `--rollback` flag, reject unknown flags, and call the guarded module directly. The documented local invocation is:

```bash
node apps/functions/scripts/build-deploy-artifact.mjs
node apps/functions/scripts/seed-levels.mjs --target=emulator --academy-id=demo-academy
node apps/functions/scripts/seed-levels.mjs --target=emulator --academy-id=demo-academy --rollback --system-id=ibjjf-v1
```

The runner consumes `.firebase-functions/lib`, so the deploy-artifact build is mandatory. It binds Emulator to `demo-bpt-jersey` plus `127.0.0.1:8080`, requires all discovered project IDs to agree, deny-lists the production project explicitly, and keeps staging closed until T099 adds one operator-approved project ID. No command in this plan authorizes production.

The command must not be exported from `apps/functions/src/index.ts`, so Firebase cannot treat it as a deployed callable.

- [x] **Step 6: Document the data model and rollback**

Add a `Levels catalog` section to `docs/data/firestore-data-model.md` covering:

```text
levelSystems: systemId, academyId, displayName, version, status, sourceHash,
              precedence, counts, skillCatalog, schemaVersion, seedRunId
levelDefinitions: definitionKey, academyId, systemId, kind, parentDefinitionKey,
                  name, sequence, stripeNumber, criteria, observedCriteria,
                  visual, anomalyFlags, schemaVersion
levelRequirements: requirementKey, academyId, systemId, definitionKey, skillKey,
                   minimumRating, inheritance, schemaVersion
```

Classify the published catalog as `Internal`, state that direct client reads/writes remain denied, state that seed is the only writer, and document the non-production delete-by-system rollback procedure. No production migration is applied.

- [x] **Step 7: Run adapter and Emulator GREEN tests**

Run the emulator-backed integration test with the existing command:

```bash
corepack pnpm test:rules
corepack pnpm exec vitest run --project node qa/integration/level-catalog.test.ts
corepack pnpm exec vitest run --project node apps/functions/src/levels/level-source.test.ts apps/functions/src/levels/level-service.test.ts apps/functions/src/levels/level-seed.test.ts
```

Expected: exact counts pass, same-hash seed retry is idempotent, rollback removes only the selected synthetic system, and production guard tests pass.

---

## Task 3: Expose the Protected Read Contract

**Files:**

- Create: `apps/functions/src/levels/level-callables.ts`
- Create: `apps/functions/src/levels/level-callables.test.ts`
- Create: `apps/web/src/lib/levels-client.ts`
- Create: `apps/web/src/lib/levels-client.test.ts`
- Modify: `apps/functions/src/index.ts`
- Test: `qa/rules/level-catalog-boundary.test.ts`

**Interfaces:**

- Callable name: `listLevelCatalog`.
- Request payload: exactly `null`; any object, array, string, or extra field returns `invalid-argument`.
- Response: `LevelCatalogProjection` with one published system, 171 definitions, 11 skills, and 165 requirements.
- Client function: `getLevelCatalog(): Promise<LevelCatalogProjection>`.

- [x] **Step 1: Write failing handler tests**

Cover this matrix:

```text
owner          read: academy scope
administrator  read: academy scope
headCoach      read: academy scope
coach          read: academy scope
guardian       read: published catalog only
adultStudent   read: published catalog only
anonymous      unauthenticated
malformed      permission-denied or invalid-argument as applicable
```

Use a fake store and active-actor dependency like the existing membership callable tests. Assert that the handler ignores any client academy field and that a store record from another academy is never projected.

- [x] **Step 2: Run the focused RED tests**

Run:

```bash
corepack pnpm exec vitest run --project node apps/functions/src/levels/level-callables.test.ts
corepack pnpm exec vitest run --project web apps/web/src/lib/levels-client.test.ts
```

Expected: FAIL because the callable and client validator do not exist.

- [x] **Step 3: Implement the callable**

Require `requireUserActor`, verify the actor is active, allow only the six authenticated roles above, parse `null`, call `listPublished(actor.academyId)`, verify every returned record has the same academy, and map unexpected store errors to the existing safe `failed-precondition` pattern. Export only `listLevelCatalog`; do not export create/update/delete catalog callables.

- [x] **Step 4: Implement the client validator**

Use `httpsCallable<null, unknown>` and validate exact known fields, counts, enum values, bounded strings, valid hex colors, and non-negative ratings before returning data. On any failure throw the user-safe message `Unable to load the Levels catalog. Please try again.` without logging payloads.

- [x] **Step 5: Verify direct Rules denial**

Add Rules tests proving authenticated and unauthenticated clients cannot `get`, `list`, `create`, `update`, or `delete` any of the three catalog collections. Keep `firestore.rules` deny-by-default; do not add a permissive rule to make the UI work.

- [x] **Step 6: Run the focused GREEN tests**

Run:

```bash
corepack pnpm exec vitest run --project node apps/functions/src/levels/level-callables.test.ts
corepack pnpm exec vitest run --project web apps/web/src/lib/levels-client.test.ts
corepack pnpm test:rules
corepack pnpm --filter @bpt-jersey/functions typecheck
```

Expected: all role, tenant, validator, and direct-access tests pass.

---

## Task 4: Add Role-Bounded Navigation and Read-Only UI

**Files:**

- Create: `apps/web/src/lib/staff-auth.tsx`
- Create: `apps/web/src/lib/staff-auth.test.tsx`
- Create: `apps/web/src/app/levels/levels-browser.tsx`
- Create: `apps/web/src/app/levels/levels-browser.test.tsx`
- Create: `apps/web/src/app/levels/levels.css`
- Create: `apps/web/src/app/admin/levels/page.tsx`
- Create: `apps/web/src/app/admin/levels/page.test.tsx`
- Create: `apps/web/src/app/coach/layout.tsx`
- Create: `apps/web/src/app/coach/levels/page.tsx`
- Create: `apps/web/src/app/coach/levels/page.test.tsx`
- Create: `apps/web/src/app/account/progress/page.tsx`
- Create: `apps/web/src/app/account/progress/page.test.tsx`
- Modify: `apps/web/src/app/admin/admin-shell.tsx`
- Modify: `apps/web/src/app/admin/admin-gate.tsx`
- Modify: `apps/web/src/lib/admin-auth.tsx`
- Modify: `apps/web/src/app/account/page.tsx`

**Interfaces:**

- `LevelsBrowser({ catalog, surface }: { catalog: LevelCatalogProjection; surface: "admin" | "coach" | "account" })` renders no mutation controls.
- `StaffAuthGate({ allowedRoles, children })` admits only active authenticated staff roles.
- All surfaces call `getLevelCatalog()` and show loading, safe error, empty, and populated states.

- [x] **Step 1: Write failing browser component tests**

Use a small fixture containing one belt, two stripes, and two skills. Require:

```ts
expect(screen.getByRole("heading", { name: "IBJJF Levels" })).toBeVisible();
expect(screen.getByRole("combobox", { name: "Level type" })).toBeVisible();
expect(screen.getByRole("combobox", { name: "Age band" })).toBeVisible();
expect(screen.queryByRole("button", { name: /promote|edit|delete|evaluate/i })).toBeNull();
```

Select `Stripes` and verify the belt row disappears; select a skill and verify the requirement detail is filtered. Verify anomaly/source precedence text is sanitized and that no source URL is rendered.

- [x] **Step 2: Run the focused RED tests**

Run:

```bash
corepack pnpm exec vitest run --project web apps/web/src/app/levels/levels-browser.test.tsx apps/web/src/lib/staff-auth.test.tsx
```

Expected: FAIL because the shared browser and staff gate do not exist.

- [x] **Step 3: Implement the shared browser**

Build one semantic browser used by all three routes:

- Header: `IBJJF Levels`, published version, and counts.
- Filter row: `Level type`, `Age band`, `Belt`, and `Skill`.
- Ordered belt/stripe cards with an own SVG belt visual, not copied Regyfit HTML.
- Expandable requirement details using native `<details>` with a visible summary.
- Anomaly/source note that says `Business criteria: BPT Jersey functional documents` and `Observed hierarchy and visuals: sanitized read-only inventory`.
- No controls that write, evaluate, award, promote, reorder, or delete.

Keep filtering derived from current state without default `useMemo`/`useCallback`; preserve keyboard focus and responsive layout. Add an accessible `<caption>` or heading for each repeated catalog group and ensure 320px-wide layouts do not overflow.

- [x] **Step 4: Implement role boundaries**

`/admin/levels` accepts `owner`, `administrator`, and `headCoach`; `headCoach` is admitted only on this route and sees no unrelated administrative navigation. `/coach/levels` accepts `headCoach` and `coach`. `/account/progress` uses the existing client auth gate and relies on the backend projection for `guardian`/`adultStudent` scope. A signed-out or disallowed user sees the existing safe access state rather than the catalog.

- [x] **Step 5: Implement all three routes**

Use the shared browser and the existing visual language:

- `/admin/levels`: administrative eyebrow and full catalog copy.
- `/coach/levels`: coaching eyebrow and technical requirements copy.
- `/account/progress`: client eyebrow, `Your Levels`, catalog guide copy, and explicit text that personal progress will appear when assessment records exist; do not render fake scores, streaks, belt status, or promotion eligibility.

Add `/account/progress` to the account page and `Levels` to admin navigation. Keep all visible text English.

- [x] **Step 6: Run focused UI GREEN tests**

Run:

```bash
corepack pnpm exec vitest run --project web apps/web/src/app/levels/levels-browser.test.tsx apps/web/src/app/admin/levels/page.test.tsx apps/web/src/app/coach/levels/page.test.tsx apps/web/src/app/account/progress/page.test.tsx apps/web/src/lib/staff-auth.test.tsx
corepack pnpm --filter @bpt-jersey/web typecheck
```

Expected: all three routes render the same catalog contract, filters work, role boundaries hold, and no mutation control is present.

---

## Task 5: Integration, E2E, Security, and Ledger Evidence

**Files:**

- Create: `qa/integration/level-catalog.test.ts`
- Create: `qa/rules/level-catalog-boundary.test.ts`
- Create: `qa/tests/levels.spec.ts`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`

- [x] **Step 1: Add Emulator integration coverage**

Seed a unique synthetic academy and assert the three collection counts, the 171 ordered definitions, the 165 requirements, same-hash retry idempotency, cross-academy isolation, and non-production rollback. Delete only the unique synthetic `systemId` and academy records in `afterAll`.

- [x] **Step 2: Add Playwright coverage**

Run each surface in desktop and mobile projects. Assert:

```text
/admin/levels       loads 171 definitions for owner/administrator and headCoach
/coach/levels       loads the catalog for coach/headCoach
/account/progress   loads the catalog for guardian/adultStudent
anonymous          sees the existing access state
all surfaces        have no horizontal overflow, console errors, page errors, or mutation buttons
```

Use only synthetic bootstrap data. Do not use live Regyfit, real credentials, real member data, or production Firebase.

- [x] **Step 3: Run the complete verification gates**

Run, capturing exit codes and relevant counts:

```bash
corepack pnpm test:unit
corepack pnpm test:rules
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm format:check
corepack pnpm build
corepack pnpm test:e2e -- --grep Levels
git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check
```

Expected: all commands pass; E2E reports clean console/page errors and responsive behavior. If any command fails, fix the root cause and rerun the affected command before continuing.

- [x] **Step 4: Run the security self-review**

Inspect modified files for direct Firestore client access, client academy overrides, source URLs, credentials, cookies, tokens, raw HTML, unsafe casts, unbounded arrays, production seed paths, and accidental write controls. Confirm Rules remain deny-by-default and that the callable has no mutation sibling.

- [x] **Step 5: Update the persistent ledger**

Only after all verification passes, update `tasks.md` and `Lista/Lista.js` with T083 status `revisión`, exact test commands/results, catalog counts, seed target used, rollback evidence, and the statement that no production migration/deployment occurred. Keep the prior T083 discovery history intact.

- [x] **Step 6: Final review checkpoint**

Review the complete diff and confirm the implementation matches `BRIEF.md`, `STACK.md`, the Firestore data model, and the approved read-only scope. Do not mark T083 `aprobada` or `desplegada`; those states require the project’s later human/release gates.

## Verification Checklist

- [x] Domain parser rejects malformed or incomplete source artifacts.
- [x] DOCX criteria override observed criteria without deleting observed evidence.
- [x] Counts are exactly 171 / 27 / 144 / 11 / 165.
- [x] Seed is explicit, idempotent, immutable by version, and non-production guarded.
- [x] Rollback is documented, tested, and scoped to a synthetic system version.
- [x] Callable derives tenant from claims and returns a safe projection.
- [x] Firestore direct access remains denied for every role.
- [x] `/admin/levels`, `/coach/levels`, and `/account/progress` are read-only and responsive.
- [x] No progress, evaluation, belt, stripe, or promotion values are fabricated.
- [x] Unit, Rules, integration, lint, typecheck, format, build, E2E, and diff checks have real passing evidence.
