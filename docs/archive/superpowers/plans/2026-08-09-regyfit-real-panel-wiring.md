# Regyfit Real Panel Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace the synthetic-only Regyfit panel data source with a secure authenticated callable backed by the staging Firestore collection.

**Architecture:** Firebase Functions exposes `listRegyfitAccessRecords` through a callable handler. The handler reuses the existing authorization and projection service, so tenant scope and IP filtering remain backend-owned. The web client calls the function after `AdminGate` authorizes the session; synthetic records remain available only when the explicit loopback E2E build flag is active.

**Tech Stack:** Firebase Functions v2 callable, Firebase Admin Firestore, Firebase Web SDK `httpsCallable`, React 19, Next.js 16, Vitest, Playwright.

## Global Constraints

- The browser never imports Firebase Admin, service-account credentials, private staging paths, or raw importer code.
- The callable accepts only `{}` and derives role/academy from verified Auth claims.
- `owner` may receive `ip`; `administrator` receives a projection without `ip`; other roles are denied.
- Synthetic data is allowed only with `NEXT_PUBLIC_ADMIN_E2E=true` and loopback hostname.
- No client writes, identity reconciliation, exports, or mutations are added.
- Real staging data remains in `bptjersey-f5a25`; production is not deployed or modified.

---

### Task 1: Expose the Authorized Callable

**Files:**
- Modify: `apps/functions/src/regyfit/access-records.ts`
- Modify: `apps/functions/src/regyfit/access-records.test.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**
- Add `listRegyfitAccessRecordsHandler(request, services)` for unit testing with injected Firestore services.
- Export `listRegyfitAccessRecords` as an `onCall` Firebase Function that delegates to the handler with Admin SDK Firestore.
- The handler must return the existing owner/safe projection and preserve existing controlled `HttpsError` responses.

- [ ] **Step 1: Add failing tests for callable registration behavior**

Test that an authorized owner receives the full projection, an administrator receives no `ip`, a coach is denied, non-empty request data is rejected, and the handler reads only the caller academy collection.

- [ ] **Step 2: Run the focused backend tests and verify the expected failure**

Run: `corepack pnpm exec vitest run apps/functions/src/regyfit/access-records.test.ts`

Expected: FAIL because the handler and exported callable do not exist.

- [ ] **Step 3: Implement the handler and callable export**

Delegate to `listRegyfitAccessWithServices(request, services)` and create the v2 callable wrapper without logging request data or documents.

- [ ] **Step 4: Run backend tests, typecheck, and Functions build**

Run: `corepack pnpm exec vitest run apps/functions/src/regyfit/access-records.test.ts`, `corepack pnpm --filter @bpt-jersey/functions typecheck`, and `corepack pnpm --filter @bpt-jersey/functions build`.

Expected: all commands exit 0.

---

### Task 2: Add the Web Callable Client and Emulator Routing

**Files:**
- Modify: `apps/web/src/lib/firebase-client.ts`
- Create: `apps/web/src/lib/regyfit-access-client.ts`
- Test: `apps/web/src/lib/regyfit-access-client.test.ts`

**Interfaces:**
- Add `getFirebaseFunctions(): Functions` with loopback emulator connection when `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`.
- Add `loadRegyfitAccessRecords(): Promise<readonly RegyfitAccessProjection[]>` that invokes `listRegyfitAccessRecords` with `{}` and returns callable data only.
- Map Firebase callable failures to a stable user-safe `Unable to load Regyfit access records.` error; never expose backend messages or payloads.

- [ ] **Step 1: Write failing client tests**

Test that the callable is invoked with `{}`, data is returned unchanged as a projection, and rejected calls produce the safe error without exposing the original error message.

- [ ] **Step 2: Run the client test and verify failure**

Run: `corepack pnpm exec vitest run apps/web/src/lib/regyfit-access-client.test.ts`

Expected: FAIL because the client module and Functions accessor do not exist.

- [ ] **Step 3: Implement the Functions client**

Use Firebase Web SDK `getFunctions`/`httpsCallable`; keep emulator connection one-time and preserve the existing Auth/Firestore emulator routing.

- [ ] **Step 4: Run client tests and web typecheck**

Run: `corepack pnpm exec vitest run apps/web/src/lib/regyfit-access-client.test.ts` and `corepack pnpm --filter @bpt-jersey/web typecheck`.

Expected: all tests and typecheck pass.

---

### Task 3: Replace Synthetic-Only Panel Loading

**Files:**
- Modify: `apps/web/src/app/admin/regyfit-access-records/page.tsx`
- Modify: `apps/web/src/app/admin/regyfit-access-records/page.test.tsx`
- Modify: `qa/tests/regyfit-access-records.spec.ts`

- [ ] **Step 1: Add failing UI tests for real loading states**

Add tests for loading, successful owner/administrator projection rendering, safe error state, and the rule that synthetic injection is used only when the explicit E2E flag is active.

- [ ] **Step 2: Run focused UI tests and verify failure**

Run: `corepack pnpm exec vitest run apps/web/src/app/admin/regyfit-access-records/page.test.tsx`

Expected: FAIL because the route always reads `readInjectedRegyfitRecordsForRole`.

- [ ] **Step 3: Implement the data boundary**

Use a client-side loading effect after `AdminGate` authorization. In E2E mode, return the injected synthetic records; otherwise call `loadRegyfitAccessRecords`. Guard unmounts, expose accessible `role=status` loading/error messages, and keep the existing table/detail component unchanged.

- [ ] **Step 4: Run focused UI tests and synthetic E2E**

Run: `corepack pnpm exec vitest run apps/web/src/app/admin/regyfit-access-records/page.test.tsx` and the admin/regyfit Playwright specs with the explicit E2E build flag.

Expected: synthetic desktop/mobile flows remain green and no restricted IP appears in administrator projections.

---

### Task 4: Verify Staging Callable and Document Scope

**Files:**
- Modify: `docs/data/migrations/regyfit/cronos-handoff.md`
- Modify: `docs/data/migrations/regyfit/README.md`
- Modify: `tasks.md`

- [ ] **Step 1: Run all local verification gates**

Run: `corepack pnpm test`, `corepack pnpm test:rules`, `corepack pnpm --dir qa typecheck`, `corepack pnpm lint`, `corepack pnpm format:check` for changed source files, and `corepack pnpm test:e2e` with the E2E build flag.

- [ ] **Step 2: Deploy only the approved staging Functions/web target if required**

Use the existing Firebase staging project `bptjersey-f5a25`; do not select production and do not deploy without confirming the exact staging target in the command output.

- [ ] **Step 3: Verify the real panel with an authenticated owner/administrator session**

Assert owner sees all 10 records including restricted IP, administrator sees the same 10 records without IP, and denied roles receive no records. Do not save screenshots, traces, response bodies, or raw values.

- [ ] **Step 4: Record sanitized evidence**

Document callable name, target project, count, projection checks, exit codes, and rollback scope. Keep Task 9 in `revisión`; do not mark production readiness.
