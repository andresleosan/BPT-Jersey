# T016 Firestore Rules Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close direct client reads of Regyfit Firestore documents while preserving authorized Functions projections and default-deny RTDB rules.

**Architecture:** Firestore and RTDB remain deny-by-default for browser SDK access. `listRegyfitAccessRecords` remains the only read path for Regyfit data and continues applying claims, academy scope, document validation, and owner/administrator projections through Admin SDK.

**Tech Stack:** Firestore Rules v2, Firebase Emulator Suite, `@firebase/rules-unit-testing`, Vitest, Firebase Functions v2, TypeScript.

## Global Constraints

- Firestore does not allow `get`, `list`, `read`, `create`, `update`, or `delete` from the web SDK for `regyfitAccessRecords`.
- RTDB remains `.read: false` and `.write: false`.
- Owner has no direct exception for documents containing `IP`.
- `listRegyfitAccessRecords` remains the authorized Functions path and keeps owner/administrator projections.
- This task does not modify data, create indexes, or apply migrations.
- Fixtures are synthetic; Rules tests run only against `demo-bpt-jersey` emulators.
- No Admin SDK, service accounts, passwords, tokens, real records, or full claims are added to source, tests, logs, screenshots, traces, or Git.
- Rollback is restoring the previous Rules/test text; no data backup or data rollback is required because no documents change.

---

## File Map

- Modify `firestore.rules`: remove the owner direct-read exception for `regyfitAccessRecords` and leave the global fallback deny-by-default.
- Keep `database.rules.json` unchanged: RTDB remains fully closed.
- Modify `qa/rules/regyfit-access-records.test.ts`: replace the owner-success direct-read assertion with explicit owner denial and retain negative tenant/write cases.
- Keep `apps/functions/src/regyfit/access-records.test.ts` as the projection test for owner IP and administrator-safe output.
- Modify `tasks.md`: record T016 evidence, rollback, and verification state.

## Task 1: Enforce Direct Rules Denial

**Files:**

- Modify: `firestore.rules:5-15`
- Modify: `qa/rules/regyfit-access-records.test.ts:62-92`

**Interfaces:**

- Firestore rule behavior: every client read/write operation on `academies/{academyId}/regyfitAccessRecords/{recordId}` returns deny.
- Function behavior remains unchanged: `listRegyfitAccessRecordsHandler` continues returning `RegyfitAccessRecord` for owner and `Omit<RegyfitAccessRecord, "ip">` for administrator.

- [ ] **Step 1: Change the Rule test first.** Replace `allows only the academy owner to read the complete restricted document` with `rejects direct reads for owner and administrator`, asserting `assertFails(getDoc(...))` and `assertFails(getDocs(...))` for both roles. Keep the synthetic `IP` only in disabled-seeding data and never print it.
- [ ] **Step 2: Run the focused Rules test to verify the expected red failure.**

Run: `node_modules/.bin/vitest.cmd run --project rules qa/rules/regyfit-access-records.test.ts`

Expected: FAIL only because the current Rule still lets owner `getDoc` succeed.

- [ ] **Step 3: Remove the direct owner exception.** Delete the `isAcademyOwner` helper and the `allow get` clause for `regyfitAccessRecords`; retain `allow create, update, delete: if false` or rely on the global fallback, but do not add any positive direct rule.
- [ ] **Step 4: Run the focused Rules test to verify green.**

Run: `node_modules/.bin/vitest.cmd run --project rules qa/rules/regyfit-access-records.test.ts`

Expected: all direct reads, collection lists, cross-tenant reads, creates, updates, and deletes fail.

- [ ] **Step 5: Run the Functions projection tests.**

Run: `node_modules/.bin/vitest.cmd run apps/functions/src/regyfit/access-records.test.ts`

Expected: owner still receives `IP`, administrator does not, and invalid tenant/documents remain rejected through the Function boundary.

## Task 2: Full Rules Gate And Evidence

**Files:**

- Modify: `tasks.md` with the final evidence and rollback record.
- Verify unchanged: `database.rules.json`, `apps/functions/src/regyfit/access-records.ts`.

- [ ] **Step 1: Run the complete Rules emulator suite.**

Run: `node_modules/.bin/firebase.cmd emulators:exec --project demo-bpt-jersey --only auth,firestore,database "node_modules/.bin/vitest.cmd run --project rules"`

Expected: all Rules test files pass, including `default-deny`, T013 data-model, and Regyfit boundary tests; emulators shut down with exit code 0.

- [ ] **Step 2: Verify the Rules shape and RTDB lock.** Confirm `firestore.rules` contains no positive `allow read/get/list` clause for `regyfitAccessRecords`, `database.rules.json` remains `.read: false`/`.write: false`, and no browser source imports a Firestore client read for Regyfit.

Run: `node --input-type=module -e "import { readFile } from 'node:fs/promises'; const rules = await readFile('firestore.rules', 'utf8'); const rtdb = JSON.parse(await readFile('database.rules.json', 'utf8')); if (rules.includes('allow get:') || rules.includes('allow read:')) throw new Error('direct Firestore read rule remains'); if (rtdb.rules['.read'] !== false || rtdb.rules['.write'] !== false) throw new Error('RTDB is not deny-by-default'); console.log('rules-shape-ok');"`

Expected: `rules-shape-ok`, no sensitive values in output, and emulator evidence remains the authoritative behavior check.

- [ ] **Step 3: Run regression verification.**

Run:

```text
node_modules/.bin/vitest.cmd run --project web --project node
node_modules/.bin/tsc.cmd --noEmit -p apps/web/tsconfig.json
node_modules/.bin/eslint.cmd . --max-warnings 0
node node_modules/prettier/bin/prettier.cjs --check qa/rules tasks.md
```

Expected: unit tests, web typecheck, lint, and touched-file formatting pass. If the repository-wide historical `tasks.md` formatter warning remains, run a focused check for Rules files and record the limitation instead of rewriting unrelated history.

- [ ] **Step 4: Record T016 evidence.** Add to `tasks.md`: deny-by-default decision, Rules suite command/result, Functions projection regression result, unchanged RTDB lock, no migration/backup requirement, and textual rollback path. Keep T016 in `revisión` until operator approval.

- [ ] **Step 5: Run security self-critique.** Confirm no direct browser path can read raw Regyfit records, no role can write them, owner/admin projections still come only from Functions, and no credentials or real rows entered fixtures/logs/reports.

## Acceptance Checklist

- Owner direct Firestore `getDoc` fails.
- Administrator direct Firestore `getDoc` and `getDocs` fail.
- Anonymous and all non-admin roles fail direct reads.
- Cross-tenant and mismatched-document reads fail.
- All client writes fail.
- Functions projection tests still pass with owner `IP` and administrator without `IP`.
- RTDB remains fully deny-by-default.
- Rules emulator suite passes with synthetic data.
- Rollback is documented as restoring Rules/test text; no data migration occurred.

## Plan Self-Review

- Spec coverage: decision, Rules, tests, security, rollback, and acceptance criteria are mapped to Task 1 and Task 2.
- Scope: no data writes, indexes, migrations, Functions authorization changes, or production deployment are included.
- Type consistency: the existing `RegyfitAccessRecord`/safe projection contracts remain unchanged.
- No placeholders: every step has concrete paths, commands, expected outcomes, or a specific documented limitation.
