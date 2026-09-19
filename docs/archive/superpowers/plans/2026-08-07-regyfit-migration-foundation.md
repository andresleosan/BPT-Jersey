# Regyfit Migration Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only discovery and migration-contract foundation that will let BPT Jersey reproduce Regyfit functionality and map its historical data without importing real PII or modifying the source platform.

**Architecture:** This plan covers only the first independent sub-project: discovery metadata, source-to-target mapping contracts, sanitized browser discovery, and synthetic fixtures. Regyfit is treated as an external read-only source; BPT domain contracts remain the canonical target. Data capture, transformation/loading, and final cutover will each receive a separate plan after discovery identifies the actual source fields and export capability.

**Tech Stack:** TypeScript 6.0.3, pnpm 11.20.0, Vitest 4.1.10, Playwright 1.61.1, Next.js 16.3.0, Firebase Emulator Suite, Firestore, Cloud Functions, `@bpt-jersey/domain`.

## Global Constraints

- The first authenticated Regyfit interaction is read-only and only inventories screens, roles, fields, actions, and export/API capabilities.
- Prefer an official Regyfit export or documented API; use browser automation only when neither exists.
- Do not bypass CAPTCHA, anti-bot controls, authorization boundaries, rate limits, or provider restrictions.
- Passwords, authentication hashes, tokens, payment-card numbers, CVV, provider secrets, and raw credentials never enter source code, fixtures, logs, documentation, Git, or GitHub.
- Real student, minor, health, payment, document, and family data never enters the repository, CI artifacts, screenshots, or versioned fixtures.
- Real data is not loaded before the migration contract, dry-run, backup, staging validation, rollback evidence, and explicit operator approval exist.
- The first target is Firebase Emulator with project `demo-bpt-jersey`; production is not a valid target for this plan.
- Every source entity keeps `sourceSystem: "regyfit"` and a stable `sourceId` in future migration records.
- All visible BPT user-facing content remains English; technical migration documentation may remain Spanish.
- Do not modify or stage the existing unrelated changes in the BPT Jersey worktree.
- Do not traverse `Dev/.claude/skills/*` or `Dev/.agents/skills/*` symlinks during discovery.

---

## Scope Boundary

This plan produces a working, testable discovery contract. It does not implement a
real-data importer or a production cutover because the source export/API, field
names, record counts, attachment behavior, and target policy are still unknown.

The following plans are intentionally deferred until this plan is approved and
executed:

1. Regyfit source capture/export adapter after the discovery manifest identifies the available route.
2. Normalization, deduplication, and Firestore/R2 staging loader after the field mapping is reviewed.
3. Staging reconciliation, backup/restore, cutover, and credential rotation after the loader passes synthetic and staging validation.

## File Map

- `packages/domain/src/migration/regyfit-contracts.ts`: readonly TypeScript contracts and safe validation for discovery metadata and field mappings.
- `packages/domain/src/migration/regyfit-contracts.test.ts`: unit coverage for manifest invariants, prohibited values, uniqueness, and mapping strategies.
- `packages/domain/src/index.ts`: public exports for migration contracts.
- `docs/data/migrations/regyfit/README.md`: operational boundary and artifact handling for the migration workstream.
- `docs/data/migrations/regyfit/source-inventory.md`: sanitized inventory of Regyfit modules, routes, roles, fields, and observed actions.
- `docs/data/migrations/regyfit/field-mapping.md`: reviewed source-to-target mapping table with no real values.
- `docs/data/migrations/regyfit/discovery-manifest.example.json`: synthetic manifest shape used by tests and future discovery runs.
- `docs/data/migrations/regyfit/migration-run.example.yaml`: non-executable example of the existing migration-register contract.
- `packages/domain/src/migration/regyfit-fixture.test.ts`: validation of the synthetic manifest and migration-register example shape.
- `qa/src/regyfit/discovery.ts`: sanitized metadata extraction helpers used by local Playwright discovery.
- `qa/unit/regyfit-discovery.test.ts`: pure tests for redaction and metadata sanitization.
- `qa/tests/regyfit-discovery.spec.ts`: opt-in read-only Regyfit browser journey, skipped when discovery environment variables are absent.
- `qa/package.json`: workspace dependency on `@bpt-jersey/domain` for the discovery helper contracts.
- `qa/tsconfig.json`: include the new `qa/unit` tests alongside the existing QA paths.
- `qa/README.md`: local-only discovery command and prohibition on CI/live credentials.

## Task 1: Define Discovery and Mapping Contracts

**Files:**
- Create: `packages/domain/src/migration/regyfit-contracts.ts`
- Create: `packages/domain/src/migration/regyfit-contracts.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces `RegyfitDiscoveryManifest`, `RegyfitModuleSnapshot`, `RegyfitFieldSnapshot`, `RegyfitMapping`, `RegyfitEntityName`, `RegyfitSensitivity`, and `RegyfitMappingStrategy`.
- Produces `validateRegyfitDiscoveryManifest(manifest: unknown): Result<RegyfitDiscoveryManifest, ValidationIssue[]>`.
- Produces `validateRegyfitMapping(mapping: unknown): Result<RegyfitMapping, ValidationIssue[]>`.

- [ ] **Step 1: Write the failing contract tests**

Add tests that require these exact rules:

```ts
it("accepts a metadata-only discovery manifest", () => {
  const result = validateRegyfitDiscoveryManifest(validManifest);
  expect(result.ok).toBe(true);
});

it("rejects values that could contain live student data", () => {
  const result = validateRegyfitDiscoveryManifest({
    ...validManifest,
    modules: [{ ...validManifest.modules[0]!, values: ["real-looking value"] }],
  });
  expect(result.ok).toBe(false);
});

it("rejects duplicate module keys and source mapping pairs", () => {
  const duplicateManifest = { ...validManifest, modules: [validManifest.modules[0]!, validManifest.modules[0]!] };
  expect(validateRegyfitDiscoveryManifest(duplicateManifest).ok).toBe(false);
});

it("allows only explicit mapping strategies", () => {
  expect(validateRegyfitMapping({ ...validMapping, strategy: "direct" }).ok).toBe(true);
  expect(validateRegyfitMapping({ ...validMapping, strategy: "execute-code" as never }).ok).toBe(false);
});
```

The fixture must contain metadata only: module keys, labels, route paths without
query strings, roles, action names, field labels/types/sensitivity, and no table
rows, names, emails, phones, addresses, notes, medical text, payment values, or
authentication values.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run:

```powershell
corepack pnpm exec vitest run packages/domain/src/migration/regyfit-contracts.test.ts
```

Expected result: FAIL because the migration contracts and validators do not exist.

- [ ] **Step 3: Implement the minimal readonly contracts**

Define the contracts with these literal unions:

```ts
export const regyfitEntityNames = [
  "users",
  "families",
  "students",
  "staff",
  "programs",
  "classes",
  "bookings",
  "attendance",
  "memberships",
  "payments",
  "assessments",
  "leads",
  "communications",
  "documents",
  "consents",
  "audit",
] as const;

export type RegyfitMappingStrategy =
  | "direct"
  | "normalize"
  | "lookup"
  | "exclude"
  | "manual-review";
```

`RegyfitDiscoveryManifest` must include `schemaVersion: "1"`,
`sourceSystem: "regyfit"`, a branded `capturedAtUtc`, an immutable array of
module snapshots, export/API capability metadata, and sanitized notes. A module
snapshot includes a unique `key`, English `label`, route path without query or
hash, observed roles, allowed discovery actions, and field metadata. Field
metadata includes `name`, `label`, `dataType`, `sensitivity`, and `required`, but
never a value.

`RegyfitMapping` includes `sourceEntity`, `sourceField`, `targetPath`,
`strategy`, `sensitivity`, and a reason. `targetPath` must be a relative BPT
domain path and cannot contain credentials, payload values, or arbitrary code.

Validators return the existing `Result` type and `ValidationIssue[]`; they reject
unknown enum values, duplicate module keys, duplicate source mapping pairs,
query/hash routes, empty source/target names, payload/value properties, and
unredacted values. A source field named `password` or `token` is allowed only as
metadata with `strategy: "exclude"` and no value attached.

Export all public types and validators from `packages/domain/src/index.ts` without
adding a wildcard export.

- [ ] **Step 4: Run the focused tests and the domain checks**

Run:

```powershell
corepack pnpm exec vitest run packages/domain/src/migration/regyfit-contracts.test.ts
corepack pnpm --filter @bpt-jersey/domain typecheck
corepack pnpm lint
```

Expected result: focused contract tests pass, domain typecheck exits 0, and lint
exits 0 without warnings.

- [ ] **Step 5: Commit only this task's files after explicit operator approval**

Do not stage existing BPT changes. If a commit is requested, use:

```powershell
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" add packages/domain/src/index.ts packages/domain/src/migration/regyfit-contracts.ts packages/domain/src/migration/regyfit-contracts.test.ts
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" commit -m "feat: define Regyfit migration contracts"
```

## Task 2: Add Sanitized Migration Artifacts

**Files:**
- Create: `docs/data/migrations/regyfit/README.md`
- Create: `docs/data/migrations/regyfit/source-inventory.md`
- Create: `docs/data/migrations/regyfit/field-mapping.md`
- Create: `docs/data/migrations/regyfit/discovery-manifest.example.json`
- Create: `docs/data/migrations/regyfit/migration-run.example.yaml`
- Create: `packages/domain/src/migration/regyfit-fixture.test.ts`

**Interfaces:**
- The JSON example validates against `RegyfitDiscoveryManifest`.
- The YAML example follows the mandatory fields in `docs/data/migrations/README.md` but has `operatorApproval.status: "pending"` and no real project, academy, record, credential, or backup value.
- The Markdown tables are metadata contracts and may contain `not observed` until the live discovery phase populates them; they must never contain real PII.

- [ ] **Step 1: Write the synthetic manifest fixture**

Create `discovery-manifest.example.json` with synthetic modules for students,
families, classes, attendance, memberships, payments, assessments, CRM,
documents, and audit. Include one synthetic field per sensitivity class and one
example of each mapping action, but do not include row values or realistic
personal data.

- [ ] **Step 2: Add fixture validation tests**

Load the JSON fixture in `packages/domain/src/migration/regyfit-fixture.test.ts`
and assert that:

```ts
const migrationRegisterText = readFileSync(
  new URL("../../../../docs/data/migrations/regyfit/migration-run.example.yaml", import.meta.url),
  "utf8",
);

expect(manifest.sourceSystem).toBe("regyfit");
expect(validateRegyfitDiscoveryManifest(manifest).ok).toBe(true);
expect(JSON.stringify(manifest)).not.toMatch(/@|\+44|password|token|card|cvv/i);
expect(migrationRegisterText).toContain("migrationId:");
expect(migrationRegisterText).toContain('operatorApproval:');
```

Use synthetic labels such as `Student display name` rather than a person name.

- [ ] **Step 3: Document the artifact rules**

`README.md` must state that the directory stores contracts and sanitized
metadata, not exports; define the private external location requirement; link to
the existing Firestore migration runbook; explain `source-inventory.md`,
`field-mapping.md`, the manifest example, and the migration register example.

`source-inventory.md` must have columns for module, source route, roles, actions,
fields, sensitivity, evidence reference, and observation status.

`field-mapping.md` must have columns for source entity/field, target path,
strategy, sensitivity, transformation, validation rule, and approval status.

- [ ] **Step 4: Run document and fixture verification**

Run:

```powershell
corepack pnpm exec vitest run packages/domain/src/migration/regyfit-contracts.test.ts packages/domain/src/migration/regyfit-fixture.test.ts
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
```

Expected result: all fixture/contract tests pass and `git diff --check` has no
output. No existing modified file may appear in the staged diff.

- [ ] **Step 5: Commit only the new migration artifacts after explicit operator approval**

```powershell
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" add docs/data/migrations/regyfit packages/domain/src/migration/regyfit-fixture.test.ts
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" commit -m "docs: add Regyfit migration artifacts"
```

## Task 3: Implement Sanitized Browser Discovery

**Files:**
- Create: `qa/src/regyfit/discovery.ts`
- Create: `qa/tests/regyfit-discovery.spec.ts`
- Modify: `qa/package.json` to add the workspace dependency `@bpt-jersey/domain: workspace:*`.
- Modify: `qa/README.md`
- Modify: `qa/tsconfig.json` to include `unit/**/*.test.ts` alongside the existing QA paths.

**Interfaces:**
- `captureRegyfitPageMetadata(page): Promise<RawRegyfitPageMetadata>` reads only structural DOM metadata.
- `sanitizeRegyfitPageMetadata(raw): RegyfitModuleSnapshot` removes values and normalizes route/labels.
- `hasRegyfitDiscoveryEnvironment(env): boolean` requires `REGYFIT_BASE_URL`, `REGYFIT_EMAIL`, and `REGYFIT_PASSWORD` without printing their values.
- The Playwright spec writes only a `RegyfitDiscoveryManifest` attachment containing metadata, never raw HTML, response bodies, cookies, local storage, screenshots with rows, or table cell text.

Define `RawRegyfitPageMetadata` in `qa/src/regyfit/discovery.ts` as an internal
type with `route`, `title`, `roles`, `actions`, `fields`, `navigationLinks`, and
`tableHeaders`; it has no row, value, cookie, storage, response, or credential
property. `fields` contains only `name`, `label`, `dataType`, `sensitivity`, and
`required`.

- [ ] **Step 1: Write pure sanitization tests**

Add tests for `sanitizeRegyfitPageMetadata` that prove:

```ts
expect(sanitizeRegyfitPageMetadata({
  route: "/admin/students?search=secret",
  title: "Students",
  roles: ["admin"],
  actions: ["search", "view"],
  fields: [{ name: "email", label: "Email", dataType: "text", sensitivity: "restricted", required: false }],
})).toMatchObject({ route: "/admin/students", title: "Students" });
```

The output must contain no query string, hash, row values, input values, cookie,
storage, response payload, or credential. Emails, phone numbers, postcodes, and
URLs containing credentials must be removed or replaced with `[redacted]` before
the result is returned.

- [ ] **Step 2: Run the sanitization tests and verify the expected failure**

Run the focused checks for the touched files:

```powershell
corepack pnpm exec vitest run qa/unit/regyfit-discovery.test.ts
```

Expected result: FAIL because the discovery helper is not implemented.

- [ ] **Step 3: Implement metadata-only DOM extraction**

`captureRegyfitPageMetadata(page)` may collect only:

- current pathname without query/hash;
- document title;
- visible navigation labels and same-origin route paths;
- visible button names and accessible roles;
- form labels, input names, input hint text, select labels, and required markers;
- table column headers, never table cells;
- pagination/filter control labels, never filter values.

It must not attach `page.on("response")` payloads, read cookies or storage,
serialize `document.body.innerText`, capture input values, or write screenshots
by default. Any navigation outside the configured Regyfit origin is ignored.

- [ ] **Step 4: Implement the opt-in read-only Playwright journey**

The spec must call `test.skip` before creating a browser journey when any required
`REGYFIT_*` variable is absent. It must:

1. Navigate to `REGYFIT_BASE_URL`.
2. Authenticate using environment-provided values only.
3. Verify successful authentication without logging the response or page body.
4. Enumerate visible same-origin navigation targets and visit them serially.
5. Capture sanitized metadata with `captureRegyfitPageMetadata`.
6. Stop and report a module-level error on authentication, permission, or navigation failure.
7. Write a sanitized manifest attachment outside the repository only when the local operator explicitly requests saving it.

The journey must not click create, update, delete, export, payment, message,
attendance-correction, or approval actions. It must use a bounded navigation
list and a delay between requests so a changed UI cannot become an uncontrolled
crawler.

- [ ] **Step 5: Add local-only documentation and run the offline browser test**

Document that real discovery is never run in CI and that credentials are supplied
through a local secret mechanism, not command arguments or files. Add an offline
Playwright test using `page.setContent` to prove the metadata extractor captures
labels/headers/actions but not cell values.

Run:

```powershell
corepack pnpm --dir qa exec playwright test tests/regyfit-discovery.spec.ts --grep "offline metadata"
corepack pnpm exec vitest run qa/unit/regyfit-discovery.test.ts
corepack pnpm --dir qa typecheck
```

Expected result: offline browser test, unit tests, and QA typecheck pass. Do not
run the live Regyfit journey until the operator explicitly requests the
read-only discovery session in a controlled window.

- [ ] **Step 6: Commit only the discovery helper and tests after explicit operator approval**

```powershell
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" add qa/src/regyfit qa/tests/regyfit-discovery.spec.ts qa/README.md qa/package.json qa/tsconfig.json
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" commit -m "test: add sanitized Regyfit discovery"
```

## Task 4: Complete the Discovery Checkpoint

**Files:**
- Modify: `docs/data/migrations/regyfit/source-inventory.md`
- Modify: `docs/data/migrations/regyfit/field-mapping.md`
- Modify: `docs/data/migrations/regyfit/discovery-manifest.example.json` only for metadata schema changes, never real values.
- Create: `docs/data/migrations/regyfit/discovery-report.md`
- Modify: `tasks.md` only to add the approved migration-foundation tasks and evidence; do not change unrelated task states.

**Interfaces:**
- Produces an inventory report with module/route/role/action coverage.
- Produces a reviewed field mapping with `direct`, `normalize`, `lookup`, `exclude`, or `manual-review` for every observed source field.
- Produces a capability conclusion: official export found, documented API found, or panel-only capture required.

- [ ] **Step 1: Run the read-only discovery session with controlled credentials**

Set the three `REGYFIT_*` variables through the local secret mechanism and run
only the opt-in discovery spec. Never place their values in the command line,
`.env` committed to the repo, Playwright trace, screenshot, or report.

- [ ] **Step 2: Review and redact the generated metadata**

Confirm that the output contains only routes, labels, roles, actions, field
metadata, table headers, capability signals, timestamps, and sanitized errors.
Delete any artifact that contains a row, person, document, payment, cookie,
token, or response body before continuing.

- [ ] **Step 3: Complete the source inventory and mapping**

For each observed module, record the source route, role visibility, allowed
actions, field metadata, target BPT module, sensitivity, transformation strategy,
validation rule, and evidence reference. Mark behavior as `observed`,
`provisional`, or `approved`; do not turn an observation into a BPT invariant
without operator/academy approval.

- [ ] **Step 4: Run the checkpoint verification**

Run:

```powershell
corepack pnpm test:unit
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm exec prettier --check packages/domain/src/migration/regyfit-contracts.ts packages/domain/src/migration/regyfit-contracts.test.ts packages/domain/src/migration/regyfit-fixture.test.ts qa/src/regyfit/discovery.ts qa/unit/regyfit-discovery.test.ts qa/tests/regyfit-discovery.spec.ts
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
```

Expected result: existing project checks remain green, discovery contract tests
pass, the touched files pass Prettier, no real PII is present in versioned files,
and the report identifies the next adapter plan without starting a migration. If
the root `corepack pnpm format:check` is also run and fails only on the existing
unrelated `opencode.json` modification, record that environmental failure and do
not modify or stage `opencode.json`.

- [ ] **Step 5: Commit only the reviewed discovery metadata after explicit operator approval**

```powershell
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" add docs/data/migrations/regyfit/source-inventory.md docs/data/migrations/regyfit/field-mapping.md docs/data/migrations/regyfit/discovery-report.md tasks.md
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" commit -m "docs: record Regyfit discovery checkpoint"
```

## Handoff to Future Plans

After Task 4, stop and review the discovery checkpoint before creating a source
capture plan. The next plan must be selected from the observed capability:

- Official export: implement a file parser with schema validation, checksum,
  encryption boundary, dry-run, and synthetic fixtures.
- Documented API: implement a rate-limited client with bounded retries, cursor
  checkpoints, response-schema validation, redacted logs, and contract tests.
- Panel-only source: extend the sanitized browser runner into a bounded export
  adapter that reads only authorized records and stores raw data outside the repo.

No future plan may choose the adapter path by assumption. The discovery report
is the input that decides it.
