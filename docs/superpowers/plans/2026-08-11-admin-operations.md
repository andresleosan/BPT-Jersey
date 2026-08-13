# Admin Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the clean admin shell, Groups / Teams, Human Resources, and the separate Admin Access Requests tab without MFA or legacy owner UI.

**Architecture:** The web panel is a thin route and component layer. Functions own authorization, group mutations, HR identity operations, and request approval. The parked access-request work is reviewed and ported by contract, not copied as UI or coupled to placeholder modules.

**Tech Stack:** Next.js 16, React 19, Firebase Auth, Firebase Functions v2, Firestore, Zod, Vitest, React Testing Library, Playwright.

## Global Constraints

- The panel has exactly the five approved sections, with no legacy placeholder links.
- `Create / Manage` contains `Human Resources` and `Admin Access Requests` tabs.
- No MFA is implemented in this version.
- No business `owner` role is shown; all approved administrators are equivalent.
- No password is stored, returned, rendered, or logged.
- Direct browser writes to groups, HR, and access requests remain denied.
- Every backend mutation validates authenticated actor and academy scope.
- No production claims migration or deployment is included.

---

## File Map

**Authorization and backend**

- Modify `apps/functions/src/auth/admin-authorization.ts`: normal authenticated admin authorization without MFA gating, retaining academy scope checks.
- Create `apps/functions/src/groups/group-contracts.ts` and test.
- Create `apps/functions/src/groups/group-callables.ts` and test.
- Create `apps/functions/src/human-resources/hr-callables.ts` and test.
- Port or create `apps/functions/src/auth/admin-access-requests.ts` and test from the parked capability, reviewed against the approved request contract.
- Modify `apps/functions/src/index.ts`: export the approved callables.
- Modify rules source and `docs/data/firestore-data-model.md`.

**Web**

- Modify `apps/web/src/app/admin/admin-shell.tsx`: five navigation entries and neutral administrator label.
- Modify `apps/web/src/app/admin/admin-gate.tsx`: no MFA state; signed-out, denied, pending, rejected, and authorized states.
- Create `apps/web/src/app/admin/groups/page.tsx` and test.
- Create `apps/web/src/app/admin/human-resources/page.tsx` and test.
- Create `apps/web/src/app/admin/admin-access-requests/page.tsx` and test.
- Create `apps/web/src/lib/groups-client.ts` and test.
- Create `apps/web/src/lib/human-resources-client.ts` and test.
- Create `apps/web/src/lib/admin-access-requests-client.ts` and test.

**QA**

- Create `qa/tests/admin-operations.spec.ts`.
- Modify existing admin auth and shell tests to remove MFA and owner-specific UI expectations.

---

## Task 1: Normalize Admin Authorization Without MFA

**Files:**

- Modify: `apps/functions/src/auth/admin-authorization.ts`
- Test: `apps/functions/src/auth/admin-authorization.test.ts`
- Modify: `apps/web/src/lib/admin-auth.tsx`
- Test: `apps/web/src/lib/admin-auth.test.tsx`
- Modify: `apps/web/src/app/admin/admin-gate.tsx`
- Test: existing admin gate/auth tests

**Interfaces:**

- `requireAdminActor(request): AdminActor` validates auth, `academyId`, and administrative role; it does not require TOTP.
- `AdminSessionStatus` remains `loading | signed-out | authorized | pending | rejected | denied`.

- [ ] **Step 1: Write failing tests.** Assert an authenticated administrator without MFA reaches authorization, clients remain denied, legacy technical claims do not display as owner, and pending/rejected access never renders `AdminShell`.
- [ ] **Step 2: Run focused tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/admin-authorization.test.ts apps/web/src/lib/admin-auth.test.tsx`

Expected: FAIL because the current boundary requires or renders MFA/legacy behavior.

- [ ] **Step 3: Implement the smallest no-MFA boundary.** Remove only MFA enforcement from this flow; preserve tenant validation, role validation, and fail-closed errors.
- [ ] **Step 4: Run tests and typechecks.**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/admin-authorization.test.ts apps/web/src/lib/admin-auth.test.tsx && corepack pnpm --filter @bpt-jersey/functions typecheck && corepack pnpm --filter @bpt-jersey/web typecheck`

Expected: all tests pass and both typechecks exit 0.

---

## Task 2: Rebuild The Admin Shell

**Files:**

- Modify: `apps/web/src/app/admin/admin-shell.tsx`
- Modify: `apps/web/src/app/admin/admin.css`
- Modify: `apps/web/src/app/admin/page.tsx`
- Test: `apps/web/src/app/admin/page.test.tsx`

- [ ] **Step 1: Write failing tests.** Assert exactly five navigation entries, no CRM/Finance/Regyfit placeholder cards, neutral administrator label, accessible focus, and responsive navigation.
- [ ] **Step 2: Run focused test and verify failure.**

Run: `corepack pnpm exec vitest run apps/web/src/app/admin/page.test.tsx`

Expected: FAIL because the current page renders placeholder modules and old navigation.

- [ ] **Step 3: Implement the shell and route links.** Keep navigation labels stable, use module routes rather than hash-only placeholders, and remove uncaptured module rendering.
- [ ] **Step 4: Run tests, lint, and format.**

Run: `corepack pnpm exec vitest run apps/web/src/app/admin/page.test.tsx && corepack pnpm lint && corepack pnpm format:check`

Expected: all pass.

---

## Task 3: Implement Groups / Teams

**Files:**

- Create: `apps/functions/src/groups/group-contracts.ts`
- Create: `apps/functions/src/groups/group-callables.ts`
- Test: `apps/functions/src/groups/group-callables.test.ts`
- Create: `apps/web/src/lib/groups-client.ts`
- Test: `apps/web/src/lib/groups-client.test.ts`
- Create: `apps/web/src/app/admin/groups/page.tsx`
- Test: `apps/web/src/app/admin/groups/page.test.tsx`

**Interfaces:**

- `createGroup({ name, abbreviation }) -> { groupId }`.
- `updateGroup({ groupId, name, abbreviation }) -> { groupId }`.
- `deleteGroup({ groupId }) -> { deleted: true }`.
- `listGroups({ search, pageToken }) -> { groups, nextPageToken }`.
- `listGroupMembers({ groupId }) -> { members }`.
- `setGroupMembership({ groupId, memberIds }) -> { groupId, memberCount }`.

- [ ] **Step 1: Write failing backend and web tests.** Cover strict payloads, academy scope, empty/search states, duplicate actions, member assignment, and delete confirmation.
- [ ] **Step 2: Run focused tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/functions/src/groups/group-callables.test.ts apps/web/src/app/admin/groups/page.test.tsx`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement backend contracts and callables.** Use transactions for membership updates and reject group IDs outside the actor academy.
- [ ] **Step 4: Implement the responsive page.** Render table desktop/cards mobile, keyboard-safe dialogs, and clear loading/error/empty states.
- [ ] **Step 5: Run focused tests and typechecks.**

Run: `corepack pnpm exec vitest run apps/functions/src/groups/group-callables.test.ts apps/web/src/app/admin/groups/page.test.tsx && corepack pnpm typecheck`

Expected: all pass.

---

## Task 4: Implement Human Resources Without Password Storage

**Files:**

- Create: `apps/functions/src/human-resources/hr-callables.ts`
- Test: `apps/functions/src/human-resources/hr-callables.test.ts`
- Create: `apps/web/src/lib/human-resources-client.ts`
- Test: `apps/web/src/lib/human-resources-client.test.ts`
- Create: `apps/web/src/app/admin/human-resources/page.tsx`
- Test: `apps/web/src/app/admin/human-resources/page.test.tsx`

**Interfaces:**

- `createHumanResource({ title, workPosition, name, email, phone }) -> { resourceId, invitationSent: boolean }`.
- `updateHumanResource({ resourceId, title, workPosition, name, email, phone, accountStatus }) -> { resourceId }`.
- `deleteHumanResource({ resourceId }) -> { deleted: true }`.
- `listHumanResources({ search, pageToken }) -> { resources, nextPageToken }`.

- [ ] **Step 1: Write failing tests.** Assert no input/output field named password, strict email/phone validation, admin-only access, academy scope, create/update/delete/list, and generic error messages.
- [ ] **Step 2: Run tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/functions/src/human-resources/hr-callables.test.ts apps/web/src/app/admin/human-resources/page.test.tsx`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement Auth invitation and Firestore profile.** Create or link the Firebase Auth identity through the server boundary; never accept a password from the browser and never return Auth secrets.
- [ ] **Step 4: Implement the table/form UI.** Include search, pagination, edit, delete confirmation, account status, and invitation result.
- [ ] **Step 5: Run tests, typecheck, lint, and format.**

Run: `corepack pnpm exec vitest run apps/functions/src/human-resources/hr-callables.test.ts apps/web/src/app/admin/human-resources/page.test.tsx && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format:check`

Expected: all pass.

---

## Task 5: Port And Finish Admin Access Requests

**Files:**

- Create/modify: `apps/functions/src/auth/admin-access-requests.ts`
- Test: `apps/functions/src/auth/admin-access-requests.test.ts`
- Modify: `apps/functions/src/index.ts`
- Create: `apps/web/src/lib/admin-access-requests-client.ts`
- Test: `apps/web/src/lib/admin-access-requests-client.test.ts`
- Create: `apps/web/src/app/admin/admin-access-requests/page.tsx`
- Test: `apps/web/src/app/admin/admin-access-requests/page.test.tsx`
- Modify: `apps/web/src/app/login/login-form.tsx` and its test

**Interfaces:**

- `requestAdminAccess({}) -> { status, requiresReauthentication }`.
- `getMyAdminAccessRequest({}) -> { status: "pending" | "approved" | "rejected" | null }`.
- `listAdminAccessRequests({ status? }) -> readonly AdminAccessRequestProjection[]`.
- `reviewAdminAccessRequest({ requestId, decision: "approve" | "reject" }) -> { status }`.

- [ ] **Step 1: Write failing backend tests.** Cover exact payloads, Google identity requirement, idempotency, rejected retry cooldown, approval claims, rejection, tenant isolation, concurrent decisions, and no MFA requirement.
- [ ] **Step 2: Run focused backend tests and verify failure.**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/admin-access-requests.test.ts`

Expected: FAIL in the clean branch until the port is implemented.

- [ ] **Step 3: Implement the backend boundary.** Preserve fail-closed authorization, role-lock/compensation behavior, audit events, and read-only status lookup. Never include IP, password, token, or raw Auth payload.
- [ ] **Step 4: Write failing web tests.** Assert pending/rejected views, exact review payload, disabled action while pending, generic errors, and admin Google request flow.
- [ ] **Step 5: Implement the tab and login state.** Keep the tab inside `Create / Manage`, show no shell for pending/rejected users, and require logout/login after approval.
- [ ] **Step 6: Run focused tests, typechecks, lint, and format.**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/admin-access-requests.test.ts apps/web/src/lib/admin-access-requests-client.test.ts apps/web/src/app/admin/admin-access-requests/page.test.tsx apps/web/src/app/login/login-form.test.tsx && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format:check`

Expected: all pass.

---

## Task 6: Verify Admin Operations

**Files:**

- Create: `qa/tests/admin-operations.spec.ts`
- Modify: existing admin shell/auth tests.
- Modify: Rules tests for groups, HR, and requests.

- [ ] **Step 1: Add synthetic Playwright flows.** Cover navigation, group CRUD, HR create/edit/delete without passwords, pending request, approve/reject, logout/relogin, and no legacy sections.
- [ ] **Step 2: Add Rules tests.** Prove direct clients cannot read/write groups, HR, or access requests.
- [ ] **Step 3: Run verification.**

Run: `corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format:check`

Expected: all pass with no production credentials or real member data.
