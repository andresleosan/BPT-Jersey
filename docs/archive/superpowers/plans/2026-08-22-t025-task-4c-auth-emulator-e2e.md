# T025 Task 4C Auth Emulator E2E Implementation Plan

> **For agentic workers:** Execute this plan inline. Git commits are explicitly prohibited for this task.

**Goal:** Verify the staff browser flow through the real email/password login against Firebase Auth Emulator with emulator-only admin claims.

**Architecture:** A QA-only Node seed uses the existing `firebase-admin` dependency and refuses to run unless `FIREBASE_AUTH_EMULATOR_HOST` is set. The Playwright spec uses the visible login form and keeps the existing callable harness for staff data, so authentication is real while no production database or Functions data is touched.

**Tech Stack:** Firebase Auth Emulator, Firebase Admin SDK already present in QA, Next.js static export, Playwright, PowerShell/Node runner scripts.

## Global Constraints

- No production Firebase project, real credentials, Git operations, commits, or new dependencies.
- `NEXT_PUBLIC_ADMIN_E2E` must be unset for the real-auth build and test.
- Claims are `{ academyId: "synthetic-academy", role: "owner" }` and are written only through Auth Emulator.
- Desktop Chromium and mobile Chromium both execute the real login test.

### Task 1: Add Auth Emulator Seed

**Files:**
- Create: `qa/scripts/seed-auth-emulator.mjs`

- [x] Validate `FIREBASE_AUTH_EMULATOR_HOST` before initializing Admin SDK.
- [x] Create or update one synthetic email/password user and set owner claims.
- [x] Run the seed against Auth Emulator and confirm it exits successfully.

### Task 2: Add Browser Regression

**Files:**
- Create: `qa/tests/staff-auth-emulator.spec.ts`
- Modify: `qa/tests/staff-management.spec.ts` only if a shared harness is extracted.

- [x] Install the existing staff callable harness without mocking Auth.
- [x] Submit the real administrator login form with emulator-only credentials.
- [x] Verify `/admin`, navigate to `/admin/staff`, and assert the staff workspace.
- [x] Assert no console/page errors and no direct Firestore/RTDB requests.

### Task 3: Wire Local Runner

**Files:**
- Modify: `qa/run-e2e.mjs`
- Modify: `tasks.md`
- Modify: `.superpowers/sdd/2026-08-21-t025-staff-lifecycle-plan/task-4c-report.md`

- [x] Propagate only local emulator variables and synthetic test credentials.
- [x] Run the emulator wrapper, static server, seed, and browser test for desktop/mobile.
- [x] Record exact commands, results, and limitations without changing the synthetic suite.
