# Real Member PDF Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Import the eight approved member PDFs into Firebase staging and make the authenticated Members panel display the resulting Firestore records instead of synthetic fixtures.

**Architecture:** Add a standalone operational runner that reads the approved local PDF directory, reuses the existing parser/deduplication/service contracts, and supports dry-run plus explicit confirmed staging apply. Update the Members route to use the existing authenticated `searchMembers` callable and preserve synthetic data only for unrelated preview modules and tests. Keep all writes tenant-scoped, idempotent, audited, and rollback-selectable by import run.

**Tech Stack:** TypeScript, Node.js 22, pnpm, Firebase Admin/Firestore, existing `pdf-parse` coordinate formatter, Next.js 16, React 19, Vitest, Firebase Emulator Suite, Playwright.

## Global Constraints

- Production reads and writes are forbidden.
- The only live target is Firebase staging project `bptjersey-f5a25`, academy `demo-academy`.
- Source PDFs come from `F:\Proyectos\BPT Jersey\Varios`; they are never copied into the repository or retained in Firestore.
- No raw PDF text, source rows, credentials, cookies, staging paths, or PII may appear in logs, fixtures, receipts, or UI.
- The approved source result is 8 reports, 797 source rows, 243 canonical rows, 554 duplicates, 0 conflicts, 96 rows without membership number, and final statuses active 114, inactive 128, suspended 1.
- `suspended` wins over `active` only for `membershipStatus`; identity conflicts remain blocking.
- The Members route must use authenticated `searchMembers`; browser code must not access Firestore directly.
- Every production code change follows TDD: failing test, observed failure, minimal implementation, passing test.
- Live staging writes happen only after a fresh dry-run receipt matches the approved result and the operator explicitly runs the confirmed command.

## File Map

- Create `apps/functions/src/members/member-pdf-import-runner.ts`: source discovery, target guards, dry-run plan, stable operation ID, sanitized receipt, and apply orchestration contracts.
- Create `apps/functions/src/members/member-pdf-import-runner.test.ts`: unit tests for runner guards and receipts.
- Create `qa/scripts/import-member-pdfs.mjs`: explicit CLI entry point for dry-run and confirmed staging execution.
- Modify `apps/functions/src/members/member-service.ts`: persist/query the bounded backend-owned `importRunId` on imported member records and pass the stable operation ID into import mutations.
- Modify `packages/domain/src/members/member-contracts.ts`: add optional bounded `importRunId` metadata to `MemberRecord` and validate it as a non-empty string with a maximum length.
- Modify `apps/functions/src/members/member-service.test.ts`: verify import-run metadata, idempotent application, and that ordinary admin-created members do not receive import metadata.
- Create `qa/integration/member-pdf-import.test.ts`: verify staging-shaped Firestore import invariants, tenant isolation, metadata-only audit, idempotency, and rollback selection against emulator fixtures.
- Modify `apps/web/src/app/admin/members/page.tsx`: replace synthetic rows with authenticated callable state and pagination.
- Modify `apps/web/src/app/admin/members/page.test.tsx`: test loading, connected rows, empty state, errors, and next-page action.
- Modify `apps/web/src/lib/members-client.ts` only if a response validator or callable contract needs correction.
- Modify `tasks.md`: record the implementation and fresh verification evidence without marking live staging import complete before it runs.
- Create `docs/data/migrations/member-pdf-import-run-2026-08-12.yaml`: concrete staging run record after the dry-run, with exact receipt/hash/counts and rollback reference; do not write this before the dry-run produces those values.

---

### Task 1: Define the Operational Import Contract

**Files:**
- Create: `apps/functions/src/members/member-pdf-import-runner.test.ts`
- Create: `apps/functions/src/members/member-pdf-import-runner.ts`
- Modify: `packages/domain/src/members/member-contracts.ts`
- Modify: `apps/functions/src/members/member-service.ts`
- Modify: `apps/functions/src/members/member-service.test.ts`

**Interfaces:**
- Consumes: `ParsedMemberReport`, `deduplicateMemberRows`, `createMemberService`, `MemberService`, and the existing coordinate-aware PDF extraction behavior.
- Produces: `discoverMemberPdfFiles(sourceRoot): readonly string[]`, `validateMemberPdfImportTarget(input): void`, `buildMemberPdfImportPlan(input): Promise<MemberPdfImportPlan>`, `stableMemberPdfImportOperationId(runId, sourceHash): string`, and `sanitizeMemberPdfImportReceipt(plan): MemberPdfImportReceipt`.

- [ ] **Step 1: Write failing tests for deterministic discovery and target guards**

```ts
it("orders exactly the approved PDF files and rejects non-PDF files", async () => {
  const files = await discoverMemberPdfFiles(approvedRoot);
  expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b)));
  expect(files).toHaveLength(8);
});

it("rejects every target except the allowlisted staging project and academy", () => {
  expect(() => validateMemberPdfImportTarget({
    target: "production",
    projectId: "bptjersey-f5a25",
    academyId: "demo-academy",
  })).toThrow("Member PDF import target is not allowed");
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/members/member-pdf-import-runner.test.ts`

Expected: FAIL because the runner module and its exported functions do not exist yet.

- [ ] **Step 3: Implement the minimal runner boundary**

Implement strict inputs for source root, target, project ID, academy ID, run ID, and capture timestamp. Resolve the source root, enumerate only regular `.pdf` files, sort by filename, and reject anything other than the exact approved staging target. Do not log file names or PDF contents from the runner.

- [ ] **Step 4: Add failing tests for plan counts, operation ID, and receipt redaction**

```ts
it("builds the approved eight-report plan without exposing rows in the receipt", async () => {
  const plan = await buildMemberPdfImportPlan({
    sourceRoot: approvedRoot,
    target: "staging",
    projectId: "bptjersey-f5a25",
    academyId: "demo-academy",
    runId: "member-pdf-20260812-01",
    capturedAt: "2026-08-12T12:00:00.000Z",
  });
  expect(plan.reports).toHaveLength(8);
  expect(plan.sourceRows).toBe(797);
  expect(plan.canonicalRows).toBe(243);
  expect(plan.conflicts).toBe(0);
  expect(plan.statusCounts).toEqual({ active: 114, inactive: 128, suspended: 1 });
  expect(JSON.stringify(sanitizeMemberPdfImportReceipt(plan))).not.toMatch(/Jordan|@|\+44|ID-/u);
});

it("derives the same operation ID for the same run and source hash", () => {
  expect(stableMemberPdfImportOperationId("run-1", "a".repeat(64)))
    .toBe(stableMemberPdfImportOperationId("run-1", "a".repeat(64)));
});
```

- [ ] **Step 5: Run the focused tests and verify they fail for missing implementation**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/members/member-pdf-import-runner.test.ts`

Expected: FAIL at the new plan/receipt assertions, not because of malformed test setup.

- [ ] **Step 6: Implement parsing, deduplication, plan construction, and redacted receipt**

Read bytes only in memory, use the existing PDF text formatter/parser, call `deduplicateMemberRows`, reject nonzero conflicts, calculate source hash from ordered report hashes, count statuses, and expose counts/hash/report keys only in the receipt. Use a stable operation ID derived from run ID and source hash.

- [ ] **Step 7: Run focused tests and existing importer tests**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/members/member-pdf-import-runner.test.ts apps/functions/src/members/member-pdf-import.test.ts apps/functions/src/members/member-pdf-text.test.ts`

Expected: all focused tests pass, including the eight-file source check, with no raw source output.

- [ ] **Step 8: Inspect the contract and runner diff**

Run `git diff --check` and inspect the changed files. Do not stage or commit local PDFs, receipts containing PII, `.env` files, or generated build output. Commit only if the operator later requests it explicitly.

### Task 2: Add Dry-Run and Explicit Staging Apply CLI

**Files:**
- Create: `qa/scripts/import-member-pdfs.mjs`
- Create: `docs/data/migrations/member-pdf-import-run-2026-08-12.yaml` only after the dry-run receipt exists
- Modify: `apps/functions/src/members/member-pdf-import-runner.ts`
- Modify: `apps/functions/src/members/member-pdf-import-runner.test.ts`

**Interfaces:**
- Consumes: the runner plan and receipt from Task 1, Firebase Admin credentials supplied by the authorized environment, and the existing member service/store.
- Produces: CLI modes `--dry-run` and `--confirm`, fail-closed target validation, a metadata-only receipt, and explicit rollback selection by `importRunId`.

- [ ] **Step 1: Write failing tests for CLI mode and write gate behavior**

```ts
it("does not call the Firestore apply operation in dry-run mode", async () => {
  const services = createFakeImportServices();
  const result = await executeMemberPdfImport({ ...approvedConfig, mode: "dry-run" }, services);
  expect(result.mode).toBe("dry-run");
  expect(services.applyCalls).toBe(0);
});

it("requires explicit confirmation for staging writes", async () => {
  await expect(executeMemberPdfImport({ ...approvedConfig, mode: "confirm", confirm: false }, services))
    .rejects.toThrow("Explicit confirmation is required");
});
```

- [ ] **Step 2: Run focused tests and observe the failure**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/members/member-pdf-import-runner.test.ts`

Expected: FAIL because execution orchestration and write gate are not implemented.

- [ ] **Step 3: Implement CLI orchestration**

Require explicit `--target staging`, `--project-id bptjersey-f5a25`, `--academy-id demo-academy`, `--source-root "F:\Proyectos\BPT Jersey\Varios"`, and `--run-id`. Make `--dry-run` the default only when explicitly supplied; reject ambiguous/no-mode invocations. Permit Firestore writes only for `--confirm` plus a fresh matching dry-run receipt and `--yes-confirm-staging`. Never accept a production target.

- [ ] **Step 4: Add bounded apply and rollback metadata**

Pass the plan rows through the existing idempotent member service. Persist `importRunId` on imported records if the contract supports it; otherwise add the smallest schema field required for exact rollback and update the parser/fixtures/tests. Create one metadata-only audit record and write a migration run record containing exact counts, source hash, staging project, academy, dry-run timestamp, confirmation timestamp, and rollback procedure. Do not include member names or source paths beyond the approved source-root label.

- [ ] **Step 5: Run emulator integration tests before any live staging write**

Run: `corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/member-pdf-import.test.ts"`

Expected: emulator-only tests pass for idempotency, tenant isolation, metadata-only audit, bounded writes, and rollback selection.

- [ ] **Step 6: Run a fresh real dry-run only**

Run the CLI with `--dry-run` and the approved source/target arguments. Capture only the sanitized receipt. Expected: 8 reports, 797 source rows, 243 canonical rows, 554 duplicates, 0 conflicts, and statuses 114/128/1. If any value differs, stop without writing and report the mismatch.

- [ ] **Step 7: Create the concrete migration record from the dry-run**

Write `docs/data/migrations/member-pdf-import-run-2026-08-12.yaml` with the actual source hash, counts, exact staging scope, emulator evidence, rollback selection query, and operator approval scope. Do not include PII or raw paths.

- [ ] **Step 8: Run the explicit confirmed staging import only after the dry-run matches**

Run the CLI with the same configuration, the matching receipt reference, and `--confirm --yes-confirm-staging`. Expected: the result reports only counts and operation metadata. Do not deploy, migrate production, or alter unrelated collections.

- [ ] **Step 9: Verify staging invariants and repeat idempotently**

Run the staging verification command/script to check 243 canonical member records in `demo-academy`, unique source keys, one matching operation/audit event, no unexpected fields, and no records outside the academy. Repeat the same confirmed operation and verify zero duplicate creations and the same idempotent result.

- [ ] **Step 10: Inspect only code and sanitized documentation**

Run `git diff --check` and inspect the complete diff. Do not stage or commit PDFs, receipts containing PII, `.env` files, or generated output. Commit only if the operator later requests it explicitly.

### Task 3: Connect the Members Panel to Firestore

**Files:**
- Modify: `apps/web/src/app/admin/members/page.tsx`
- Modify: `apps/web/src/app/admin/members/page.test.tsx`
- Modify: `apps/web/src/lib/members-client.ts` only when the existing response validator fails the connected callable contract; the current contract is expected to remain unchanged.

**Interfaces:**
- Consumes: `searchMembers(filters, pageToken?)`, `MemberSearchProjection`, `AdminGate` session boundary, and the existing `AdminDataTable`.
- Produces: a connected client page with safe loading/error/empty/data/pagination states and no `previewData.members` usage.

- [ ] **Step 1: Write failing tests for connected states**

```tsx
it("loads and renders records returned by the authenticated member callable", async () => {
  mockSearchMembers.mockResolvedValue({ members: [memberProjection], nextPageToken: "next" });
  render(<MembersPage />);
  expect(await screen.findByText("Real Staging Member")).toBeVisible();
  expect(screen.getByText("Staging import")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next page" })).toBeVisible();
});

it("renders a sanitized error when the member callable fails", async () => {
  mockSearchMembers.mockRejectedValue(new Error("Unable to search members. Please try again."));
  render(<MembersPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load member records.");
});
```

- [ ] **Step 2: Run the focused page test and verify the failure**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/members/page.test.tsx`

Expected: FAIL because the page currently renders `previewData.members` and does not call `searchMembers`.

- [ ] **Step 3: Implement the client page with a bounded callable query**

Use a client component state machine for `loading`, `ready`, `empty`, and `error`. Call `searchMembers({ orderBy: "name" })` on mount and when paging. Use `startTransition` for page changes. Render the existing 12 member fields with `—` for absent values, source badge `Staging import`, and a next-page button using the signed token. Never print callable error details or member data to logs.

- [ ] **Step 4: Run page tests and related member client tests**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/members/page.test.tsx apps/web/src/lib/members-client.test.ts`

Expected: connected page tests and existing client contract tests pass.

- [ ] **Step 5: Run the protected synthetic browser smoke**

Build with the existing local E2E flag, run `corepack pnpm --dir qa test:e2e:smoke`, then restore and verify the normal protected build. The synthetic E2E environment must mock/bootstrap data only through existing test boundaries; it must not embed real staging member data.

- [ ] **Step 6: Commit the panel connection**

```bash
git add apps/web/src/app/admin/members/page.tsx apps/web/src/app/admin/members/page.test.tsx apps/web/src/lib/members-client.ts
git commit -m "feat: connect members panel to staged records"
```

### Task 4: Self-Critique, Documentation, and Final Verification

**Files:**
- Modify: `tasks.md`
- Modify: `.cronos/gaps-detectados.md` only if a new repeated capability gap is discovered
- Modify: `docs/data/migrations/member-pdf-import-run-2026-08-12.yaml` only with verified evidence

**Interfaces:**
- Consumes: all code, tests, dry-run receipt, staging verification, and rollback reference from Tasks 1-3.
- Produces: fresh evidence, task state `revisión`, and a factual report distinguishing local tests, staging verification, and what remains outside scope.

- [ ] **Step 1: Run the security baseline over changed code**

Check target guards, authentication boundary, academy scoping, input validation, absence of secrets/PII in logs and receipts, dependency audit, and exact rollback selection. Any critical finding blocks completion.

- [ ] **Step 2: Run full unit and integration verification**

Run: `corepack pnpm test`

Run: `corepack pnpm test:rules`

Run: `corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts"`

Expected: all suites pass with fresh output; environment collisions are resolved by sequential rerun rather than ignored.

- [ ] **Step 3: Run typecheck, lint, format, build, and audit**

Run: `corepack pnpm typecheck`

Run: `corepack pnpm lint`

Run: `corepack pnpm format:check`

Run: `corepack pnpm build`

Run: `corepack pnpm audit --audit-level high`

Expected: no new high/critical findings; pre-existing moderate advisories remain explicitly documented.

- [ ] **Step 4: Run authenticated panel/browser verification**

Run the existing synthetic admin smoke against the local build and inspect for console errors, overflow, loading/error/empty/data states, and pagination. Then verify the staging panel manually with the authorized administrative session, without recording PII in repository artifacts.

- [ ] **Step 5: Verify rollback selection without deleting staging data**

Run the rollback planner in dry-run mode. Expected: it selects only documents with the exact approved academy and import run ID, reports counts, and performs no deletion. Do not execute rollback unless a separate operator request requires it.

- [ ] **Step 6: Update `tasks.md` with evidence and state**

Record the commands, counts, staging project/academy scope, idempotent repeat result, browser evidence, security result, and residual limitations. Keep the related task in `revisión` until the operator explicitly approves it; do not claim production readiness.

- [ ] **Step 7: Final diff and secret/PII scan**

Run `git diff --check`, inspect the complete diff, confirm no PDFs or environment files are staged, and scan changed files for raw member names, email addresses, phone numbers, IDs, tokens, and service-account material.
