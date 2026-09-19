# Backup And Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define a verified full data backup and controlled restoration path without exposing an unsafe database restore button in the first panel release.

**Architecture:** Functional imports/exports remain in the Members and Store plans. This plan covers only a complete tenant backup, manifest, verification, retention, and restoration rehearsal in an isolated environment. Production restoration remains an explicit operator-gated operation.

**Tech Stack:** Firebase Admin SDK, Firestore export/import or the repository-approved backup mechanism, Firebase Storage, Functions, Vitest, emulator suite, checksum verification.

## Global Constraints

- No production backup or restore is executed by implementation tasks.
- Any destructive restore requires an explicit operator confirmation immediately before execution.
- A recent verified backup must exist before any restore or destructive data operation.
- Every operation has a rollback procedure documented and tested in an isolated environment.
- Backup files are encrypted/ACL-protected by the approved hosting mechanism and never committed to Git.
- Logs contain operation IDs, counts, hashes, and status only; never raw member rows, tokens, or credentials.
- Restore is tenant-scoped and rejects arbitrary browser-provided collection paths.

---

## File Map

- Create `apps/functions/src/data/backup-contracts.ts`: manifest, operation status, and verification types.
- Create `apps/functions/src/data/backup-callables.ts`: admin-only backup manifest and verification boundaries.
- Test `apps/functions/src/data/backup-callables.test.ts`.
- Create `apps/functions/src/data/restore-runbook.md`: manual rollback and restore procedure.
- Modify `docs/data/firestore-data-model.md`: backup scope, retention, and excluded secrets.
- Create `qa/tests/backup-restore.spec.ts`: emulator-only rehearsal.

## Task 1: Define Backup Contract And Scope

**Interfaces:**

- `createTenantBackup() -> { operationId, manifestPath, expiresAt }`.
- `verifyTenantBackup({ operationId }) -> { operationId, documentCounts, checksum, verified }`.
- `prepareTenantRestore({ operationId, confirmationToken }) -> { restoreId, rollbackManifestPath }`.

- [ ] **Step 1: Write failing contract tests.** Cover tenant scope, excluded secrets, manifest fields, checksum mismatch, and invalid confirmation tokens.
- [ ] **Step 2: Run focused tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/functions/src/data/backup-callables.test.ts`

Expected: FAIL because the backup contracts do not exist.

- [ ] **Step 3: Implement immutable contracts and manifest validation.** Include schema version, academy scope, collection counts, created timestamp, checksum, and rollback reference.
- [ ] **Step 4: Run tests and domain/Functions typecheck.**

Run: `corepack pnpm exec vitest run apps/functions/src/data/backup-callables.test.ts && corepack pnpm typecheck`

Expected: all pass.

## Task 2: Implement Verified Backup

- [ ] **Step 1: Add failing service tests.** Cover backup authorization, deterministic scope, incomplete export, checksum verification, retry idempotency, and cleanup of expired artifacts.
- [ ] **Step 2: Implement backend backup operation.** Create a manifest, execute the approved export mechanism, write the checksum, verify counts, and mark the operation `verified` only after all checks pass.
- [ ] **Step 3: Document retention and rollback.** `restore-runbook.md` must state the exact backup ID, verification check, rollback artifact, and operator confirmation gate.
- [ ] **Step 4: Run focused tests and emulator rehearsal.**

Run: `corepack pnpm exec vitest run apps/functions/src/data/backup-callables.test.ts && corepack pnpm test:rules`

Expected: backup verification passes and no real project is contacted.

## Task 3: Rehearse Restore Without Production

- [ ] **Step 1: Create sanitized emulator fixtures.** Include members, groups, HR profiles, access requests, products, variants, and orders without real identities.
- [ ] **Step 2: Implement restore rehearsal.** Restore into a disposable emulator namespace, compare counts/checksums, exercise rollback from `rollbackManifestPath`, and assert consistent state after failure.
- [ ] **Step 3: Add Playwright/QA evidence.** Verify that the normal admin panel does not expose restore controls without the explicit operational gate.
- [ ] **Step 4: Run full verification.**

Run: `corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format:check`

Expected: all pass; no production backup, restore, migration, or deployment occurs.
