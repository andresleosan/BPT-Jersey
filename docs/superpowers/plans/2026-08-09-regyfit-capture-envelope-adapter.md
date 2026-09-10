# Regyfit Capture Envelope Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Adapt the captured Regyfit envelope format into the approved BPT snapshot contract without inventing missing member numbers, then prove a ten-record staging import is safe before writing.

**Architecture:** The domain package will validate and normalize one captured envelope into a source row. The importer will parse concatenated JSON objects safely, apply the domain normalizer, and retain the existing deterministic transaction/audit flow. Firestore will store `memberNumber` as `null` when the source omitted it; local Regyfit login text will be converted from `Europe/Jersey` to canonical UTC.

**Tech Stack:** TypeScript 6, Node.js 24, pnpm, Vitest, Firebase Admin SDK, Cloud Firestore, Firebase staging project `bptjersey-f5a25`.

## Global Constraints

- Real data may be read only from `F:\BPT-Regyfit-Private-Staging`.
- No real values may appear in Git, source files, tests, logs, screenshots, traces, or command output.
- The only approved real-data target is staging project `bptjersey-f5a25`; never production or Emulator.
- Scope is `demo-academy`, run `regyfit-20260808-acessos-01`, module `alunos-acessos`, exactly 10 records.
- No identity reconciliation into `students` or `users`.
- `capturedAt` is the fixed approved value `2026-08-08T00:00:00.000Z`.
- Staging write requires a verified backup or baseline-appropriate rollback evidence before apply.
- A failed gate stops the workflow without writing.

---

### Task 1: Normalize the Real Capture Envelope

**Files:**
- Modify: `packages/domain/src/migration/regyfit-access.ts`
- Test: `packages/domain/src/migration/regyfit-access.test.ts`

**Interfaces:**
- Add `normalizeRegyfitAccessEnvelope(value: unknown, expected: { runId: string; moduleKey: string }): Result<RegyfitAccessSourceRow, ValidationIssue[]>`.
- Change `RegyfitAccessSourceRow.memberNumber` and `RegyfitAccessRecord.memberNumber` to `string | null`.
- Accept the captured shape `{runId, sourceSystem, sourceId, moduleKey, capturedAtUtc, record}` and reject unknown keys, wrong run/module/system, invalid source IDs, invalid IPs, malformed login counts, and unparseable dates.
- Normalize `record.logins` to `loginCount`, missing/blank `record.memberNumber` to `null`, and `record.lastLogin` from the observed English local format using `Europe/Jersey`.

- [ ] **Step 1: Write failing tests for envelope normalization**

Add tests for one valid envelope, missing `memberNumber` returning `null`, numeric login text conversion, `Europe/Jersey` summer-time conversion to UTC, wrong envelope metadata, invalid login text, and invalid local date.

- [ ] **Step 2: Run the focused domain test and verify the expected failure**

Run: `corepack pnpm exec vitest run packages/domain/src/migration/regyfit-access.test.ts`

Expected: FAIL because `normalizeRegyfitAccessEnvelope` does not exist and `memberNumber` is still required.

- [ ] **Step 3: Implement the minimal normalizer**

Use strict object-key checks, canonical UTC validation, `Intl.DateTimeFormat` with `Europe/Jersey` to resolve the local offset, and existing source-row validation helpers. Do not log or include input values in errors.

- [ ] **Step 4: Run the domain tests and typecheck**

Run: `corepack pnpm exec vitest run packages/domain/src/migration/regyfit-access.test.ts` and `corepack pnpm --filter @bpt-jersey/domain typecheck`

Expected: all domain tests pass and typecheck exits 0.

---

### Task 2: Parse and Import Captured Envelopes

**Files:**
- Modify: `apps/functions/src/regyfit/access-import.ts`
- Modify: `apps/functions/src/regyfit/access-import.test.ts`
- Modify: `qa/unit/regyfit-access-import.test.ts`
- Modify: `apps/functions/src/regyfit/access-records.ts`
- Modify: `apps/web/src/app/admin/regyfit-access-records/page.tsx`

**Interfaces:**
- Replace line-based parsing with a bounded JSON-object scanner that accepts the captured chunk format and never includes source content in errors.
- Apply `normalizeRegyfitAccessEnvelope` before `mapRegyfitAccessRow`; preserve synthetic flat rows only in existing synthetic tests.
- Firestore read schema accepts `memberNumber: null`; safe and restricted projections preserve the nullable field.
- The UI renders `Not observed` for a missing member number and excludes `null` from search terms.

- [ ] **Step 1: Add failing importer and projection tests**

Add a synthetic envelope fixture with the same key shape as staging but synthetic values. Assert ten normalized rows, `memberNumber: null` for missing values, normalized UTC login time, and a malformed object failure without raw payload text. Add function/UI tests for nullable member numbers.

- [ ] **Step 2: Run focused tests and verify they fail for the intended reason**

Run: `corepack pnpm exec vitest run apps/functions/src/regyfit/access-import.test.ts qa/unit/regyfit-access-import.test.ts apps/functions/src/regyfit/access-records.test.ts apps/web/src/app/admin/regyfit-access-records/page.test.tsx`

Expected: FAIL because the importer expects flat line-delimited rows and the projection/UI schema requires a string member number.

- [ ] **Step 3: Implement parsing, normalization, nullable projection, and UI rendering**

Keep the import transaction, deterministic document IDs, conflict detection, audit metadata, and target guards unchanged. The parser must enforce exactly ten objects and reject trailing non-whitespace or unbalanced JSON.

- [ ] **Step 4: Run focused tests, build, typecheck, lint, and syntax checks**

Run: `corepack pnpm exec vitest run apps/functions/src/regyfit/access-import.test.ts qa/unit/regyfit-access-import.test.ts apps/functions/src/regyfit/access-records.test.ts apps/web/src/app/admin/regyfit-access-records/page.test.tsx`, `corepack pnpm --filter @bpt-jersey/functions build`, `corepack pnpm --dir qa typecheck`, `corepack pnpm typecheck`, `corepack pnpm lint`, and `node --check qa/scripts/import-regyfit-access.mjs`.

Expected: all commands exit 0 with no raw data output.

---

### Task 3: Real Staging Dry-Run and Data-Quality Gate

**Files:**
- Modify: `qa/scripts/import-regyfit-access.mjs` only if runtime build paths require it.
- Modify: `tasks.md` only after evidence is captured.

- [ ] **Step 1: Build the runtime domain adapter and Functions**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime` and `corepack pnpm --filter @bpt-jersey/functions build`.

- [ ] **Step 2: Run the real dry-run with the approved environment**

Use project `bptjersey-f5a25`, target `staging`, private root, approved run/module/route/academy, operator confirmation `real-data-private-staging-v1`, and `REGYFIT_CAPTURED_AT=2026-08-08T00:00:00.000Z`. Use a transaction simulator so no Firestore write occurs.

- [ ] **Step 3: Verify sanitized dry-run invariants**

Accept only output containing `plannedCount=10`, `skippedCount=0`, one content hash, and the sanitized audit path. Stop if any value, path outside the approved category, or invalid row appears.

---

### Task 4: Apply and Verify Staging Import

**Files:**
- Modify: `docs/data/migrations/regyfit/README.md`
- Modify: `docs/data/migrations/regyfit/field-mapping.md`
- Modify: `docs/data/migrations/regyfit/source-inventory.md`
- Modify: `tasks.md`
- Do not modify: private staging JSONL, fixtures, screenshots, traces, or raw backups.

- [ ] **Step 1: Verify staging backup/baseline and rollback evidence**

Confirm the target project is not production, record a sanitized baseline for the scoped collection, and verify the available rollback procedure removes only documents with `importRunId=regyfit-20260808-acessos-01`. If a verified backup/restore prerequisite cannot be established, stop before writing.

- [ ] **Step 2: Run the guarded staging importer once**

Run `corepack pnpm --dir qa import:regyfit-access` with the approved environment. Capture only run ID, module, imported/skipped counts, hash, and sanitized audit path.

- [ ] **Step 3: Verify Firestore without printing records**

Use Admin SDK inspection to assert `count=10`, `distinctSourceIdCount=10`, `importRunIdCount=10`, `auditEventCount=1`, and no documents outside `academies/demo-academy/regyfitAccessRecords` plus its audit event.

- [ ] **Step 4: Verify role projections against staging**

Run owner and administrator/reception reads. Assert owner receives `ip`, safe projection omits `ip`, and all other roles are denied. Disable screenshots/traces and do not retain response bodies.

- [ ] **Step 5: Record sanitized evidence and rollback instructions**

Document target, run, counts, hash, fixed capturedAt, exit codes, audit metadata path category, backup reference, and retention/deletion date. Do not record names, numbers, dates, IPs, raw paths, or payloads.

---

### Task 5: Final Self-Critique Gate

- [ ] **Step 1: Run security review on modified code**

Check target fail-closed behavior, staging confirmation, parser bounds, strict envelope keys, no raw error output, nullable projections, owner-only IP access, and no identity reconciliation.

- [ ] **Step 2: Run fresh verification suites**

Run focused importer tests, `corepack pnpm test:rules`, relevant admin E2E, `corepack pnpm typecheck`, `corepack pnpm lint`, and `corepack pnpm format:check`.

- [ ] **Step 3: Scan diff hygiene**

Run `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check` and scan versioned changes for real member values, IPs, emails, staging paths, JSONL content, screenshots, traces, and credentials.

- [ ] **Step 4: Update task status only with evidence**

Keep the migration task at `revisión`; do not mark it `aprobada` or `desplegada` without the next operator checkpoint.
