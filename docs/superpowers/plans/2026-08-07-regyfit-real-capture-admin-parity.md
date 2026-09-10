# Regyfit Real Capture and Admin Parity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the authorized Regyfit data needed to reproduce its administrative behavior while keeping real records in private encrypted staging and producing only sanitized contracts for BPT implementation.

**Architecture:** Regyfit remains a read-only external source. The capture pipeline first probes official export/API capability, then uses a bounded Playwright/CDP adapter only for approved same-origin administrative modules. A private staging sink stores real records outside the repository; the versioned BPT artifacts contain only schemas, route metadata, field names, states, counts, hashes, and synthetic fixtures. Loading into BPT is a separate Emulator/staging plan and never targets production directly.

**Tech Stack:** TypeScript 6.0.3, pnpm 11.20.0, Vitest 4.1.10, Playwright 1.61.1, Node.js 24, `@bpt-jersey/domain`, Firebase Emulator Suite, Firestore and Cloudflare R2 contracts.

## Global Constraints

- Real Regyfit data is authorized only for a private encrypted staging location confirmed before the first capture run.
- No real names, emails, phones, addresses, health notes, payment values, documents, credentials, cookies, storage, screenshots or response bodies enter Git, GitHub, `Dev/`, `qa/`, `docs/`, logs or CI artifacts.
- Regyfit navigation is read-only; do not click submit, create, edit, save, delete, export, payment, message, approval, correction or equivalent mutating controls.
- Prefer an official export or documented API; browser automation is the fallback and must respect authorization, rate limits, anti-bot controls and CAPTCHA boundaries.
- The capture adapter refuses repository paths and requires an operator-confirmed private staging root before writing real records.
- Every captured record receives `sourceSystem: "regyfit"`, a stable `sourceId`, module identity, capture run identity and source timestamp when available.
- Every module has an independent checkpoint, count, hash, error state and resume key; a failed module stops that module without silently continuing its data.
- BPT Firestore remains canonical; real data first targets the `demo-bpt-jersey` Emulator and later an approved staging project, never production in this plan.
- Sensitive BPT domains remain restricted: minors, health, safeguarding, payments, documents, consents and audit history cannot be flattened into general records.
- UI copy remains English; technical migration documentation may remain Spanish.
- Do not stage or commit unrelated existing worktree changes. Do not create a commit unless the operator explicitly requests one.

---

## Scope Boundary

This plan produces a safe source-capture foundation and an evidence-backed administrative parity blueprint. It does not load records into Firestore, write to production, choose a payment provider, or implement every BPT screen.

Follow-on plans are intentionally separate:

1. Identity, families, students, staff and authorization implementation.
2. Programs, classes, bookings, check-in/out and attendance implementation.
3. Memberships, payments, invoices and reconciliation implementation.
4. CRM, communications, progress, documents, consents, audit and reporting implementation.
5. Synthetic import, Emulator/staging load, reconciliation, backup, rollback and cutover.

## File Map

- Create `packages/domain/src/migration/regyfit-capture-contracts.ts` for immutable run manifests, module checkpoints and source-record envelopes without source values in the versioned contract.
- Create `packages/domain/src/migration/regyfit-capture-contracts.test.ts` for manifest invariants, checkpoint transitions, source identity and prohibited payload properties.
- Modify `packages/domain/src/index.ts` to export the capture contract types and validators explicitly.
- Create `qa/src/regyfit/private-staging.ts` for staging-root policy, deterministic chunk paths and hash/count reporting; it must never log record contents.
- Create `qa/unit/private-staging.test.ts` for repository-path rejection, private-marker enforcement, deterministic paths and hash/count behavior using synthetic records only.
- Create `qa/src/regyfit/capability-probe.ts` for non-mutating export/API/page capability inspection.
- Create `qa/unit/capability-probe.test.ts` for synthetic pages with official-export links, API hints and no capability evidence.
- Modify `qa/tsconfig.json` to include `unit/**/*.test.ts` in QA typechecking.
- Create `qa/src/regyfit/source-capture.ts` for bounded same-origin module capture, row extraction through approved selectors, checkpointing and private-sink writes.
- Create `qa/unit/source-capture.test.ts` for selector safety, mutating-action rejection, source ID requirements and no-log-value guarantees.
- Create `qa/tests/regyfit-real-capture.spec.ts` for an opt-in live run that requires an operator-confirmed staging root and skips without all explicit environment gates.
- Modify `qa/README.md` with the private staging setup, live-run command, stop conditions and cleanup procedure.
- Modify `qa/package.json` if the capture code needs the workspace domain contract dependency.
- Create `docs/data/migrations/regyfit/private-staging-runbook.md` with encryption/access/retention/erasure gates and operator checkpoints.
- Modify `docs/data/migrations/regyfit/source-inventory.md` and `field-mapping.md` only with sanitized structural evidence.
- Create `docs/data/migrations/regyfit/discovery-manifest.observed.sanitized.json` from the already captured metadata-only evidence; it must contain no source rows or values.
- Modify `tasks.md` with command evidence and the status of this foundation; do not mark the migration as deployed or approved for production.

## Task 1: Define Capture Run Contracts

**Files:**

- Create: `packages/domain/src/migration/regyfit-capture-contracts.ts`
- Create: `packages/domain/src/migration/regyfit-capture-contracts.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces `RegyfitCaptureRunManifest`, `RegyfitModuleCheckpoint`, `RegyfitSourceRecordEnvelope`, `RegyfitCaptureStatus` and `validateRegyfitCaptureRunManifest(value: unknown)`.
- `RegyfitModuleCheckpoint` contains `moduleKey`, `route`, `status`, `recordCount`, `chunkCount`, `contentSha256`, metadata-only `resumeKey`, `startedAtUtc`, `completedAtUtc`, and `errorCode` only; it never contains a record, payload, source ID or raw error.
- `RegyfitSourceRecordEnvelope` is an internal capture boundary with `sourceSystem`, `sourceId`, `moduleKey`, `capturedAtUtc`, `sourceUpdatedAtUtc`, and `record`; the `record` is not part of any persisted versioned manifest.

- [ ] **Step 1: Write failing contract tests**

```ts
it("accepts a completed metadata-only run manifest", () => {
  expect(validateRegyfitCaptureRunManifest(validManifest).ok).toBe(true);
});

it("rejects payloads, credentials, duplicate modules and invalid transitions", () => {
  expect(validateRegyfitCaptureRunManifest({ ...validManifest, payload: ["x"] }).ok).toBe(false);
  expect(
    validateRegyfitCaptureRunManifest({
      ...validManifest,
      modules: [validCheckpoint, validCheckpoint],
    }).ok,
  ).toBe(false);
  expect(
    validateRegyfitCaptureRunManifest({
      ...validManifest,
      status: "completed",
      completedAtUtc: undefined,
    }).ok,
  ).toBe(false);
});
```

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run: `corepack pnpm exec vitest run packages/domain/src/migration/regyfit-capture-contracts.test.ts`

Expected: FAIL because the capture contracts and validator do not exist.

- [ ] **Step 3: Implement the minimal immutable contracts**

Use literal statuses `pending`, `running`, `completed`, `partial`, `failed`, `blocked`. Reject unknown properties, query/hash routes, empty identifiers, raw payload properties, credentials and record-value properties in the manifest. Freeze validated arrays and objects at runtime, matching the existing Regyfit contract style.

- [ ] **Step 4: Run the focused contract and domain checks**

Run: `corepack pnpm exec vitest run packages/domain/src/migration/regyfit-capture-contracts.test.ts`, `corepack pnpm --filter @bpt-jersey/domain typecheck`, and `corepack pnpm lint`.

Expected: all focused tests pass, domain typecheck exits 0 and lint exits 0 without warnings.

## Task 2: Establish the Private Staging Gate

**Files:**

- Create: `qa/src/regyfit/private-staging.ts`
- Create: `qa/unit/private-staging.test.ts`
- Create: `docs/data/migrations/regyfit/private-staging-runbook.md`

**Interfaces:**

- Produces `assertPrivateStagingRoot(rootPath, repositoryRoot): Promise<Result<PrivateStagingRoot, StagingIssue[]>>`.
- Produces `writePrivateCaptureChunk(root, runId, moduleKey, chunkIndex, records): Promise<PrivateChunkReceipt>`.
- `PrivateStagingRoot` contains only `absolutePath`, `markerPath` and `encryptionConfirmed: true`; `StagingIssue` contains a safe `code` and path category, never an absolute secret-bearing path.
- `PrivateChunkReceipt` contains only `relativePath`, `recordCount`, `byteCount`, `sha256` and `writtenAtUtc`.

- [ ] **Step 1: Write failing policy tests**

```ts
it("rejects the repository, project documentation and Analista paths", async () => {
  expect((await assertPrivateStagingRoot(repoRoot, repoRoot)).ok).toBe(false);
  expect((await assertPrivateStagingRoot(path.join(repoRoot, "docs"), repoRoot)).ok).toBe(false);
});

it("writes only deterministic chunk receipts for synthetic records", async () => {
  const receipt = await writePrivateCaptureChunk(privateRoot, "run-01", "students", 0, [
    syntheticRecord,
  ]);
  expect(receipt).toMatchObject({
    relativePath: "run-01/students/chunk-000000.jsonl",
    recordCount: 1,
  });
  expect(JSON.stringify(receipt)).not.toContain("Synthetic Student");
});
```

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run: `corepack pnpm --dir qa exec vitest run unit/private-staging.test.ts`

Expected: FAIL because the staging policy and sink do not exist.

- [ ] **Step 3: Implement the staging policy and sink**

Require an operator-created marker file named `.regyfit-private-staging` containing no credentials and an explicit `encryptionConfirmed: true` marker. Resolve paths, reject repository/project/Analista descendants, reject symlinked roots, create only the run/module directory beneath the approved root, serialize JSONL without console output, calculate SHA-256 from bytes, and return receipt metadata only. The code must not claim that the marker proves encryption; the runbook must require BitLocker/EFS or an equivalent approved encrypted volume.

- [ ] **Step 4: Document the operator gate**

Document access owner, encryption mechanism, retention duration, deletion command, backup policy, incident response, and the required pre-capture confirmation. State that a staging path on ordinary unencrypted temporary storage is rejected for real data.

- [ ] **Step 5: Run focused tests and static checks**

Run: `corepack pnpm exec vitest --config vitest.node.config.ts qa/unit/private-staging.test.ts`, `corepack pnpm --dir qa typecheck`, and `corepack pnpm lint`.

Expected: tests pass, typecheck exits 0 and lint exits 0.

## Task 3: Probe Official Export and API Capability

**Files:**

- Create: `qa/src/regyfit/capability-probe.ts`
- Create: `qa/unit/capability-probe.test.ts`
- Create or modify: `qa/src/regyfit/discovery.ts`

**Interfaces:**

- Produces `probeRegyfitCapabilities(page): Promise<RegyfitCapabilityObservation>`.
- `RegyfitCapabilityObservation` contains only `exportLinks`, `apiHints`, `moduleRoutes`, `hasFileDownloadControls`, `hasMutationControls`, and sanitized evidence paths; it never returns href query values, response bodies, tokens or cookies.

- [ ] **Step 1: Write failing probe tests**

```ts
it("finds capability labels without following or activating them", async () => {
  const observation = await probeRegyfitCapabilities(
    pageWithLinks([
      ["Download CSV", "/admin2/export.php?module=students"],
      ["API documentation", "/docs/api"],
    ]),
  );
  expect(observation.exportLinks).toEqual(["/admin2/export.php"]);
  expect(observation.apiHints).toEqual(["/docs/api"]);
});
```

- [ ] **Step 2: Run the focused test to verify failure**

Run: `corepack pnpm exec vitest run --config vitest.node.config.ts qa/unit/capability-probe.test.ts`

Expected: FAIL because the probe does not exist.

- [ ] **Step 3: Implement non-mutating capability detection**

Reuse the existing sanitized surface helper when present; otherwise implement the same structural-only helper in `qa/src/regyfit/discovery.ts`. Classify visible labels and route paths without navigation. Allow only metadata inspection; export controls are evidence, not permission to activate. Normalize paths and query-key names, and exclude links whose path or label is mutating.

- [ ] **Step 4: Run the capability probe tests**

Run: `corepack pnpm exec vitest run --config vitest.node.config.ts qa/unit/capability-probe.test.ts`.

Expected: all capability probe tests pass; no live credentials are required.

## Task 4: Implement Bounded Real Source Capture

**Files:**

- Create: `qa/src/regyfit/source-capture.ts`
- Create: `qa/unit/source-capture.test.ts`
- Create: `qa/tests/regyfit-real-capture.spec.ts`
- Modify: `qa/README.md`
- Modify: `packages/domain/src/migration/regyfit-capture-contracts.ts` and its test to add the metadata-only `resumeKey` field if it is not already present.

**Interfaces:**

- Produces `captureRegyfitModule(page, moduleDefinition, sink, checkpointStore): Promise<RegyfitModuleCheckpoint>`.
- `RegyfitModuleDefinition` requires `moduleKey`, `route`, `sourceIdSelector`, `fieldSelectors`, `readOnlyActionLabels`, and `mutatingActionPattern`; it cannot contain a submit selector.
- `PrivateCaptureSink` exposes `writeChunk(runId, moduleKey, chunkIndex, records)` and returns `PrivateChunkReceipt`; `CheckpointStore` exposes `load(runId, moduleKey)` and `save(checkpoint)`.
- `writePrivateCaptureChunk` is idempotent for an existing identical chunk: it returns the existing receipt after byte/hash comparison and rejects an existing chunk with different bytes.
- Resume uses a SHA-256 `resumeKey` of the last persisted source ID; if a prior checkpoint has an unreconciled write/checkpoint failure, the module stops instead of retrying and risking duplication.
- Produces no record content to the console, test output, Playwright report, screenshot, trace or exception message.

- [ ] **Step 1: Write failing safety tests**

```ts
const sink = createMemoryCaptureSink();
const store = createMemoryCheckpointStore();
const safeStudentsDefinition: RegyfitModuleDefinition = {
  moduleKey: "students",
  route: "/admin/students",
  sourceIdSelector: "[data-source-id]",
  fieldSelectors: { status: "[data-field=status]" },
  readOnlyActionLabels: ["search", "view"],
  mutatingActionPattern: /^(?:create|update|delete|save|new)$/i,
};

it("rejects a module definition without a stable source ID selector", async () => {
  await expect(
    captureRegyfitModule(page, { ...safeStudentsDefinition, sourceIdSelector: "" }, sink, store),
  ).rejects.toThrow("source_id_selector_required");
});

it("does not navigate to mutating routes or capture table values from non-approved modules", async () => {
  const checkpoint = await captureRegyfitModule(page, safeStudentsDefinition, sink, store);
  expect(checkpoint.status).not.toBe("completed");
  expect(sink.records).toEqual([]);
});
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `corepack pnpm --dir qa exec vitest run unit/source-capture.test.ts`

Expected: FAIL because the real capture adapter does not exist.

- [ ] **Step 3: Implement the bounded adapter**

Use explicit same-origin routes resolved against `page.url()` and verify the effective origin after navigation. Read only approved record nodes and field nodes, never global page text. Exclude credentials, payment-card fields, hidden inputs, script/style content and table rows without a configured field map, including unsafe descendants inside a selected container. Require `[data-source-id]`-backed stable IDs and keep only records belonging to the configured module. Reject duplicate source IDs in one capture result and require every source node to carry the configured `data-module` value before writing. Stop on login, authorization, rate-limit, CAPTCHA, UI mismatch or mutating control detection. Persist each chunk through `writePrivateCaptureChunk`, update `resumeKey` after every successful chunk, and use a finite retry count with exponential backoff only for transient navigation failures. Do not resume a module after an ambiguous chunk/checkpoint write.

- [ ] **Step 4: Add the opt-in live test**

Require `REGYFIT_CDP_ENDPOINT`, `REGYFIT_PRIVATE_STAGING_ROOT`, `REGYFIT_RUN_ID`, and `REGYFIT_OPERATOR_CONFIRMATION=real-data-private-staging-v1`. Skip unless all are present and the staging gate validates. The test must leave only a sanitized run manifest as a Playwright attachment and must not attach raw records, traces, screenshots or response bodies.

- [ ] **Step 5: Run offline and live-gate checks**

Run: `corepack pnpm exec vitest run --config vitest.node.config.ts qa/unit/source-capture.test.ts`, `corepack pnpm --dir qa exec playwright test tests/regyfit-real-capture.spec.ts`, and `corepack pnpm --dir qa typecheck`.

Expected: unit tests pass; the live test skips cleanly without all explicit gates; typecheck exits 0.

## Task 5: Produce the Administrative Parity Blueprint

**Files:**

- Create or modify: `docs/data/migrations/regyfit/source-inventory.md`
- Create or modify: `docs/data/migrations/regyfit/field-mapping.md`
- Modify: `docs/data/migrations/regyfit/README.md`
- Modify: `tasks.md`

**Interfaces:**

- Consumes sanitized module checkpoints and field metadata from the private run manifest.
- Produces one evidence row per observed screen/module with route, roles, actions, fields, states, filters, messages, source evidence reference, implementation batch and open decision.

- [ ] **Step 1: Add the parity table contract**

Add columns for `module`, `route`, `screen`, `roles`, `fields`, `filters`, `states`, `read-only actions`, `BPT target`, `evidence`, `status` and `next action`. Keep record counts and hashes as run metadata only; never paste real values into Markdown.

- [ ] **Step 2: Record only verified evidence**

Use `observed`, `not observed`, `provisional` and `blocked` consistently. Do not infer an entity from a label or route. Mark each unvisited module as `blocked: operator navigation required` rather than inventing fields.

- [ ] **Step 3: Map each observed field to the existing BPT domain model**

Use `direct`, `normalize`, `lookup`, `exclude` or `manual-review`. Exclude credentials and raw payment data. Mark unresolved relationships, state conflicts and restricted data for review.

- [ ] **Step 4: Record verification evidence in `tasks.md`**

Include the exact test/typecheck/lint commands, live-run status, module counts, blocked modules, security result, dependency audit result and the fact that no Emulator/staging load or production write occurred.

- [ ] **Step 5: Run artifact checks**

Run: `corepack pnpm test`, `corepack pnpm --dir qa typecheck`, `corepack pnpm lint`, `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check`, and `corepack pnpm audit --audit-level high`.

Expected: tests, typecheck and lint pass; diff check is empty; audit reports no high/critical vulnerabilities. Existing moderate transitive findings remain documented and are not silently changed by this plan.

## Security and Operational Gates

Before Task 4 is allowed to process a real record:

1. The operator confirms the encrypted staging root and its retention/deletion policy.
2. The browser session is authenticated by the operator; no password is entered or stored by the adapter.
3. The target route and selectors are explicitly classified read-only.
4. A dry-run against synthetic DOM fixtures passes the no-log-value tests.
5. A checkpoint manifest path exists outside the repository and contains metadata only.

Before any BPT load:

1. The source dictionary and target mapping are reviewed.
2. A synthetic Emulator import passes Rules, idempotency, duplicate and rollback tests.
3. Real-data staging has a verified backup, reconciliation report and rejection report outside Git.
4. A separate operator approval authorizes the staging load.

## Self-Review Checklist

- Spec coverage: the approved design's real-data authorization, private staging, official export/API preference, browser fallback, functional parity, source identity, checkpointing, reconciliation, rollback and production prohibition are assigned to Tasks 1-5 or the explicit pre-load gates.
- Placeholder scan: no `TBD`, `TODO`, unbounded "handle errors" instruction or unspecified test command appears in this plan.
- Type consistency: `RegyfitCaptureRunManifest`, `RegyfitModuleCheckpoint`, `PrivateStagingRoot`, `PrivateChunkReceipt`, `RegyfitCapabilityObservation` and `captureRegyfitModule` are defined before later tasks consume them.
- Scope: real capture and parity blueprint are one independently testable subproject; implementation of each BPT domain is deferred to separate plans.

## Final Hardening Gate

Before the next gate, the capture path must also enforce the approved private sink
at runtime, cap records/field/chunk/run sizes, fail closed on any visible mutation,
bind completed checkpoints to a configuration fingerprint, include `runId` in each
private source envelope, disable all live-run Playwright artifacts, and expose an
executable conversion from capability observations to the contractual capability
metadata used by the sanitized manifest. These hardening changes must remain
synthetic-tested; the real-data gate stays closed.
