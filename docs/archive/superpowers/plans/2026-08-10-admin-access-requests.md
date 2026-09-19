# Admin Access Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure administrator-access request workflow while keeping client access immediate and keeping all administrator roles equal.

**Architecture:** Firebase Auth remains the source of identity and custom claims. Firestore stores one current request per requester under the academy tenant, while callable Cloud Functions create, list, approve, reject, and audit requests. The browser never writes claims or request status; the admin UI consumes backend projections and the existing MFA-protected admin boundary.

**Tech Stack:** TypeScript strict, pnpm monorepo, Firebase Functions v2, Firebase Admin SDK, Cloud Firestore, Zod, Next.js 16/React 19, Vitest, Firebase Rules emulator, Playwright.

## Global Constraints

- New administrator access is granted only by a callable backend operation after an authenticated Google account is reviewed.
- Every administrative callable requires verified `academyId` scope and Firebase TOTP evidence; every client callable response is a minimal projection.
- Existing `owner` claims remain a legacy administrative alias during rollout, but new requests always grant `role=administrator`, both roles have equal approval authority, and neither role receives Regyfit IP.
- Rejected administrator requests enforce a server-side 60-second cooldown before reopening; cooldown responses are `resource-exhausted` and perform no write or audit.
- Client `/account`, `/shop`, and `/checkout` flows remain free of administrator approval; they still require the normal client authentication session.
- Firestore request documents are backend-only; Rules remain deny-by-default for direct client reads and writes.
- All timestamps, actor IDs, tenant IDs, claims, status fields, and audit fields are server-owned.
- All tests must be written before production code and must demonstrate the expected failure before implementation.
- No production deploy, live claim migration, or destructive data operation is performed without explicit operator approval.
- No credentials, tokens, cookies, MFA secrets, real user records, or raw Auth payloads may enter source, tests, logs, screenshots, or reports.

---

## File Map

**Domain and contracts**

- Modify `packages/domain/src/auth/admin-contracts.ts`: preserve legacy administrative claim parsing, add request status/decision contracts, and make restricted IP unavailable to application roles.
- Modify `packages/domain/src/actor-context.ts`: keep `owner` as a legacy value only while treating it identically to `administrator`.
- Modify `packages/domain/src/index.ts`: export the new request contract types/constants.
- Modify `packages/domain/src/auth/admin-contracts.test.ts` and `packages/domain/src/actor-context` tests: lock down equal administrator authority and safe projection behavior.

**Backend and data**

- Create `apps/functions/src/auth/academy-config.ts`: validate the configured tenant identifier used for unclaimed administrator requests.
- Create `apps/functions/src/auth/admin-access-requests.ts`: callable handlers, service contracts, strict parsing, safe projections, and request/review transitions.
- Modify `apps/functions/src/auth/admin-provisioning.ts`: remove the owner-only gate from administrator role management and expose the reusable role-mutation boundary needed by request approval.
- Modify `apps/functions/src/index.ts`: export the three callable Functions.
- Create `apps/functions/src/auth/admin-access-requests.test.ts`: unit and service-level security tests.
- Modify `apps/functions/src/auth/admin-provisioning.test.ts` and `apps/functions/src/auth/admin-authorization.test.ts`: verify all approved administrators can manage roles while legacy owner claims remain equivalent.
- Modify `firestore.indexes.json`: add the status/requestedAt query index if the final Firestore query requires it.
- Modify `docs/data/firestore-data-model.md`: document `adminAccessRequests`, its classification, fields, ownership, and audit relationship.
- Create `qa/rules/admin-access-requests.test.ts`: prove anonymous and authenticated clients cannot read or write the request collection.

**Web client and UI**

- Modify `apps/web/src/lib/auth-client.ts`: expose typed request/status/list/review callable wrappers.
- Create `apps/web/src/lib/admin-access-requests-client.ts`: sanitized client boundary for the callable contracts.
- Modify `apps/web/src/lib/admin-auth.tsx`: distinguish pending/rejected request state from generic denied access.
- Modify `apps/web/src/app/login/login-form.tsx`: invoke the request Function in the existing Administrator Google flow.
- Modify `apps/web/src/app/admin/admin-gate.tsx`: render pending/rejected states without `AdminShell`.
- Create `apps/web/src/app/admin/admin-access-requests/page.tsx`: responsive request panel with loading, empty, error, filter, approval, rejection, and retry states.
- Modify `apps/web/src/app/admin/page.tsx`: place the request panel in the authenticated overview.
- Modify `apps/web/src/app/admin/admin-shell.tsx`: add the `Admin Access Requests` navigation anchor and normalize legacy owner display to administrator access.
- Modify `apps/web/src/app/admin/admin.css`: style the panel using the existing BPT Design DNA, focus rules, mobile card layout, and reduced-motion behavior.
- Create/modify focused web tests adjacent to each changed file and extend `apps/web/src/app/admin/page.test.tsx` and `apps/web/src/app/admin/regyfit-access-records/page.test.tsx` where shared shell behavior changes.

**QA and documentation**

- Modify `qa/tests/admin-auth.spec.ts`: cover pending/rejected gate states and remove owner-specific UI expectations.
- Modify `qa/tests/admin-shell.spec.ts`: assert the new navigation item, equal administrator display, and absence of IP.
- Create `qa/tests/admin-access-requests.spec.ts`: synthetic desktop/mobile request review flow.
- Modify `qa/src/admin-test-bootstrap.ts` and its tests: inject only synthetic request fixtures and emulate safe local panel decisions.
- Modify `STACK.md`: document equal administrator authority, request Functions, configured academy ID, and no-IP projection.
- Modify `tasks.md`: record the implementation evidence only after all verification commands pass.

---

## Task 1: Freeze Domain Roles And Request Contracts

**Files:**

- Modify: `packages/domain/src/actor-context.ts`
- Modify: `packages/domain/src/auth/admin-contracts.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/auth/admin-contracts.test.ts`
- Test: `packages/domain/src/actor-context.test.ts` or the existing role contract test file

**Interfaces:**

- Produces `AdminAccessRequestStatus = "pending" | "approved" | "rejected"`.
- Produces `AdminAccessDecision = "approve" | "reject"`.
- Preserves `AdminRole = "owner" | "administrator"` only as a legacy claim union during rollout.
- Makes `canReadRestrictedIp` return `false` for every application role.

- [ ] **Step 1: Write failing domain tests.** Add assertions that `administrator` is the only newly granted role, `owner` and `administrator` are both accepted as legacy administrative claims, and `canReadRestrictedIp("owner")` and `canReadRestrictedIp("administrator")` are false.

```ts
it("treats legacy owner and administrator as equal administrative claims", () => {
  expect(administrativeRoles).toEqual(["owner", "administrator"]);
  expect(parseAdminClaims({ academyId: "academy-1", role: "owner" }).ok).toBe(true);
  expect(parseAdminClaims({ academyId: "academy-1", role: "administrator" }).ok).toBe(true);
  expect(canReadRestrictedIp("owner")).toBe(false);
  expect(canReadRestrictedIp("administrator")).toBe(false);
});
```

- [ ] **Step 2: Run the focused domain tests and verify the intended failure.**

Run: `corepack pnpm exec vitest run packages/domain/src/auth/admin-contracts.test.ts packages/domain/src/actor-context.test.ts`

Expected: FAIL because the new request contracts and no-IP behavior are not present yet.

- [ ] **Step 3: Implement the minimal domain contracts.** Add the two literal unions, export them from `packages/domain/src/index.ts`, preserve legacy claim parsing for rollout compatibility, and remove the owner-only restricted projection capability without changing unrelated domain modules.

- [ ] **Step 4: Run focused tests and the domain typecheck.**

Run: `corepack pnpm exec vitest run packages/domain/src/auth/admin-contracts.test.ts packages/domain/src/actor-context.test.ts`

Expected: all focused tests pass.

Run: `corepack pnpm --filter @bpt-jersey/domain typecheck`

Expected: exit 0.

---

## Task 2: Define Tenant Configuration And Firestore Contract

**Files:**

- Create: `apps/functions/src/auth/academy-config.ts`
- Test: `apps/functions/src/auth/academy-config.test.ts`
- Modify: `docs/data/firestore-data-model.md`
- Modify: `firestore.indexes.json` only if the implementation query requires the composite index
- Test: `qa/rules/admin-access-requests.test.ts`

**Interfaces:**

- Produces `getConfiguredAcademyId(): string`, which reads the server-only `BPT_ACADEMY_ID`, validates `^[A-Za-z0-9_-]{1,128}$`, and throws a sanitized `failed-precondition` when missing or malformed.
- Defines the Firestore path `academies/{academyId}/adminAccessRequests/{requesterUid}` and the fields from the approved specification.

- [ ] **Step 1: Write failing configuration tests.** Cover a valid tenant, missing environment configuration, malformed tenant, and whitespace rejection without printing the configured value.

- [ ] **Step 2: Run the focused configuration test and verify it fails for the missing function.**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/academy-config.test.ts`

Expected: FAIL because `academy-config.ts` does not exist.

- [ ] **Step 3: Implement configuration validation.** Read only `process.env.BPT_ACADEMY_ID`; do not add a fallback tenant in production code. Tests may set and restore the variable locally.

- [ ] **Step 4: Add the data contract documentation.** Document classification as confidential, backend-only write/read authority, deterministic requester UID, retry semantics, append-only audit events, and no direct Rules access. Do not claim a production migration was applied.

- [ ] **Step 5: Add Rules denial coverage.** Use synthetic Auth contexts to assert that unauthenticated, client-authenticated, and administrator-authenticated Firestore clients cannot read or write `adminAccessRequests`. Keep the global deny fallback intact; do not create a positive client rule.

- [ ] **Step 6: Run configuration and Rules tests.**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/academy-config.test.ts`

Expected: all configuration tests pass.

Run: `corepack pnpm exec firebase.cmd emulators:exec --project demo-bpt-jersey --only auth,firestore,database "node node_modules/vitest/vitest.mjs run --project rules qa/rules/admin-access-requests.test.ts"`

Expected: all request collection reads/writes are denied.

---

## Task 3: Add Idempotent Administrator Request Creation

**Files:**

- Create: `apps/functions/src/auth/admin-access-requests.ts`
- Test: `apps/functions/src/auth/admin-access-requests.test.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**

- Produces `requestAdminAccessWithServices(request, services): Promise<AdminAccessRequestResult>` for tests.
- Produces callable `requestAdminAccess`.
- `AdminAccessRequestResult` exposes only `{ status, requiresReauthentication }`.
- `services.auth.getUser(uid)` returns the server-side Firebase Auth record; Firestore services support `doc`, `collection`, and `runTransaction`.

- [ ] **Step 1: Write failing service tests.** Cover unauthenticated requests, missing email, non-Google provider, first request, duplicate pending request, rejected request reopening with incremented `attemptCount`, and no client-controlled `academyId`/email/status.

```ts
it("rejects client-controlled request fields", async () => {
  const services = createSyntheticRequestServices({
    authUser: googleUser("requester-1"),
    request: rejectedRequest("requester-1", "academy-1"),
  });

  await expect(
    requestAdminAccessWithServices(
      callableRequest("requester-1", { academyId: "attacker-academy", email: "fake@example.test" }),
      services,
    ),
  ).rejects.toMatchObject({ code: "invalid-argument" });
});
```

- [ ] **Step 2: Run the focused backend test and verify it fails because the handler is absent.**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/admin-access-requests.test.ts`

Expected: FAIL with the missing handler/module, not a fixture or syntax error.

- [ ] **Step 3: Implement strict request parsing and server-owned identity.** Require `request.auth.uid`, call `getUser`, require `google.com` and a non-empty email, obtain the configured academy ID, and ignore all request payload fields except an empty strict object.

- [ ] **Step 4: Implement the transaction.** Create one request document per requester, preserve existing timestamps on idempotent pending calls, increment attempts on rejected retries, clear reviewer fields when reopening, and write exactly one `admin.access.requested` audit event per new attempt.

- [ ] **Step 5: Enforce the rejected-request cooldown.** Store `retryAfterAt` as a server-owned timestamp when rejecting, compare it against server time when reopening, return `resource-exhausted` without a write/audit during the 60-second window, and remove the field when a retry is accepted.

- [ ] **Step 6: Export the callable from `apps/functions/src/index.ts`.** Keep the callable wrapper thin and delegate to the tested service handler.

- [ ] **Step 7: Run focused tests and Functions typecheck.**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/admin-access-requests.test.ts`

Expected: all request creation tests pass.

Run: `corepack pnpm --filter @bpt-jersey/functions typecheck`

Expected: exit 0.

---

## Task 4: List And Review Requests With Equal Administrator Authority

**Files:**

- Modify: `apps/functions/src/auth/admin-access-requests.ts`
- Modify: `apps/functions/src/auth/admin-provisioning.ts`
- Modify: `apps/functions/src/auth/admin-authorization.ts` only if the shared authority predicate needs a focused helper
- Test: `apps/functions/src/auth/admin-access-requests.test.ts`
- Test: `apps/functions/src/auth/admin-provisioning.test.ts`
- Test: `apps/functions/src/auth/admin-authorization.test.ts`

**Interfaces:**

- Produces `listAdminAccessRequestsWithServices(request, services, filter): Promise<readonly AdminAccessRequestProjection[]>`.
- Produces `reviewAdminAccessRequestWithServices(request, services): Promise<{ status: "approved" | "rejected" }>`.
- Exposes callables `listAdminAccessRequests` and `reviewAdminAccessRequest`.
- Review input is exactly `{ requestId: string, decision: "approve" | "reject" }`.

- [ ] **Step 1: Write failing authorization and review tests.** Cover administrator and legacy owner equivalence for list/review, coach/client denial before Firestore access, missing/invalid MFA denial, cross-academy isolation, invalid filters, invalid request IDs, duplicate decisions, reject-without-claims, approve-with-claims, and no-IP projection.

- [ ] **Step 2: Run the focused test file and verify the new behavior fails.**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/admin-access-requests.test.ts apps/functions/src/auth/admin-authorization.test.ts`

Expected: FAIL because list/review callables and equal authority are not implemented.

- [ ] **Step 3: Replace the owner-only role-management gate with an administrative-role gate.** Preserve legacy `owner` claims as an accepted alias, but make the required condition `role === "owner" || role === "administrator"`; all new grants use `administrator`.

- [ ] **Step 4: Implement the safe list projection.** Validate an allowlisted status filter, query only the configured academy, order by `requestedAt` descending, cap results at the fixed limit, and return requester UID, display name, email, status, attempt count, requested/reviewed timestamps, and reviewer ID only where the admin panel needs it.

- [ ] **Step 5: Implement review locking and rejection.** Use the existing target role-lock/fencing pattern, require the request to be `pending`, atomically mark rejection and write `admin.access.rejected`, and make a second decision fail with a conflict without a second audit event.

- [ ] **Step 6: Implement approval with compensation.** Load the Auth user by request UID, verify the current Google provider and email, set `{ academyId, role: "administrator" }` while preserving permitted non-administrative claims, persist the user/request/audit transaction, and restore prior claims if persistence fails.

- [ ] **Step 7: Run the full backend focused suite.**

Run: `corepack pnpm exec vitest run apps/functions/src/auth/admin-access-requests.test.ts apps/functions/src/auth/admin-provisioning.test.ts apps/functions/src/auth/admin-authorization.test.ts`

Expected: all tests pass, including concurrency and compensation cases.

Run: `corepack pnpm --filter @bpt-jersey/functions typecheck`

Expected: exit 0.

---

## Task 5: Wire The Login And Admin Gate States

**Files:**

- Create: `apps/web/src/lib/admin-access-requests-client.ts`
- Modify: `apps/web/src/lib/auth-client.ts`
- Modify: `apps/web/src/lib/admin-auth.tsx`
- Modify: `apps/web/src/app/login/login-form.tsx`
- Modify: `apps/web/src/app/admin/admin-gate.tsx`
- Test: `apps/web/src/lib/admin-access-requests-client.test.ts`
- Test: `apps/web/src/lib/admin-auth.test.tsx`
- Test: `apps/web/src/app/login/login-form.test.tsx`

**Interfaces:**

- `requestAdminAccess(): Promise<{ status: "pending" | "approved"; requiresReauthentication: boolean }>`.
- `loadMyAdminAccessRequest(): Promise<AdminAccessRequestStatus | undefined>`.
- `AdminSessionStatus` becomes `"loading" | "signed-out" | "authorized" | "pending" | "rejected" | "denied"`.
- `AdminAuthProvider` uses the own-status callable only after a signed-in user fails administrative claim validation.

- [ ] **Step 1: Write failing client boundary tests.** Assert exact callable names/payloads, sanitized errors, and that no client-provided identity or academy field is sent.

- [ ] **Step 2: Write failing login/gate tests.** Assert administrator Google login invokes request creation, pending state shows the approved copy and sign-out action, rejected state does not render `AdminShell`, approved claims still require MFA, and client account behavior is unchanged.

- [ ] **Step 3: Run focused web tests and verify expected failures.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/lib/admin-access-requests-client.test.ts apps/web/src/lib/admin-auth.test.tsx apps/web/src/app/login/login-form.test.tsx`

Expected: FAIL only on the new request/pending/rejected expectations.

- [ ] **Step 4: Implement the Firebase callable boundary.** Use `httpsCallable` with typed empty payloads, map all backend failures to stable generic UI errors, and never expose callable payloads, claims, or raw Firebase messages.

- [ ] **Step 5: Wire the login flow.** After Google authentication in administrator context, call `requestAdminAccess()` before navigation. Route pending/re-authentication outcomes to `/admin`; do not bypass the existing `AdminGate`.

- [ ] **Step 6: Extend `AdminAuthProvider` and `AdminGate`.** Preserve stale-event protection, query only the signed-in user's request status, render pending/rejected states without shell or records, and keep signed-out access unchanged.

- [ ] **Step 7: Run focused web tests and web typecheck.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/lib/admin-access-requests-client.test.ts apps/web/src/lib/admin-auth.test.tsx apps/web/src/app/login/login-form.test.tsx`

Expected: all focused web tests pass.

Run: `corepack pnpm --filter @bpt-jersey/web typecheck`

Expected: exit 0.

---

## Task 6: Build The Administrator Request Panel

**Files:**

- Create: `apps/web/src/app/admin/admin-access-requests/page.tsx`
- Modify: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/app/admin/admin-shell.tsx`
- Modify: `apps/web/src/app/admin/admin.css`
- Test: `apps/web/src/app/admin/admin-access-requests/page.test.tsx`
- Test: `apps/web/src/app/admin/page.test.tsx`

**Interfaces:**

- `AdminAccessRequestsContent` renders only inside an authorized `AdminGate` session.
- The component consumes `loadAdminAccessRequests(filter)` and `reviewAdminAccessRequest(requestId, decision)` from the client boundary.
- The UI never receives or renders IP, Auth claims, tokens, or raw provider data.

- [ ] **Step 1: Write failing component tests.** Cover pending count, all-state filter, empty/error states, requester name/email/date/attempt, accessible approve/reject buttons, disabled action while pending, successful refresh, conflict error, and mobile card semantics.

- [ ] **Step 2: Run the focused component test and verify it fails because the panel is absent.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/admin-access-requests/page.test.tsx apps/web/src/app/admin/page.test.tsx`

Expected: FAIL because the component and navigation item do not exist.

- [ ] **Step 3: Implement the panel state machine.** Use explicit `loading`, `ready`, `error`, and `mutating` states; keep filters allowlisted; update the local list only after the callable confirms the decision; display a stable success message.

- [ ] **Step 4: Add the panel to the overview and navigation.** Add `Admin Access Requests` to the existing anchor navigation and render it after the overview modules. Normalize the visible role label to `Administrator access` for both current `owner` and `administrator` legacy claims.

- [ ] **Step 5: Style responsive and accessible states.** Reuse the existing BPT Purple/Mat Ink/Canvas tokens, rectangular borders, Source Sans 3 body copy and Barlow Condensed headings. Add visible focus, keyboard operation, 4.5:1 text contrast, mobile card layout, and reduced-motion handling.

- [ ] **Step 6: Run focused component tests, web lint, and format.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/admin-access-requests/page.test.tsx apps/web/src/app/admin/page.test.tsx`

Expected: all focused component tests pass.

Run: `corepack pnpm lint`

Expected: exit 0 with zero warnings.

Run: `corepack pnpm exec prettier --check apps/web/src/app/admin apps/web/src/lib/admin-access-requests-client.ts apps/web/src/lib/admin-auth.tsx apps/web/src/app/login/login-form.tsx`

Expected: all listed files use Prettier formatting.

---

## Task 7: Preserve No-IP Projection And Update Contracts

**Files:**

- Modify: `apps/functions/src/regyfit/access-records.ts`
- Modify: `apps/functions/src/regyfit/access-records.test.ts`
- Modify: `apps/web/src/app/admin/regyfit-access-records/page.tsx` only if role-specific IP branches remain
- Modify: `apps/web/src/lib/admin-test-bootstrap.ts` only if synthetic owner fixtures remain
- Modify: `STACK.md`
- Modify: `tasks.md` after verification only

- [ ] **Step 1: Write failing regression assertions.** Assert both legacy owner and administrator receive projections without `ip`, and no admin page body contains the synthetic IP.

- [ ] **Step 2: Run the focused Regyfit tests and verify the legacy owner IP assertion fails.**

Run: `corepack pnpm exec vitest run apps/functions/src/regyfit/access-records.test.ts apps/web/src/app/admin/regyfit-access-records/page.test.tsx`

Expected: FAIL on the old owner-restricted projection expectation.

- [ ] **Step 3: Make the smallest projection change.** Remove the restricted owner branch from application-facing reads, return the safe projection for every administrative role, and keep the stored IP field inaccessible through the callable and UI.

- [ ] **Step 4: Update stack documentation.** Replace owner-specific authority language with equal administrator authority, legacy claim compatibility, backend-only requests, and no-IP projections. Document `BPT_ACADEMY_ID` as a non-secret runtime configuration value required by Functions.

- [ ] **Step 5: Run focused regression tests.**

Run: `corepack pnpm exec vitest run apps/functions/src/regyfit/access-records.test.ts apps/web/src/app/admin/regyfit-access-records/page.test.tsx`

Expected: all tests pass and no IP appears in the returned administrator projections.

---

## Task 8: Add Synthetic E2E Coverage And Final Verification

**Files:**

- Modify: `qa/src/admin-test-bootstrap.ts`
- Modify: `qa/tests/admin-auth.spec.ts`
- Modify: `qa/tests/admin-shell.spec.ts`
- Create: `qa/tests/admin-access-requests.spec.ts`
- Modify: `qa/README.md` if the synthetic fixture contract changes
- Modify: `tasks.md` with fresh evidence only after all commands pass

**Interfaces:**

- Synthetic request fixtures contain only fake UIDs, fake names, fake emails, statuses, attempts, and ISO timestamps.
- Synthetic review actions mutate only in-memory test state; no staging or production callable is contacted.

- [ ] **Step 1: Add failing Playwright assertions.** Cover client access without approval, administrator pending state without shell, approved administrator request panel, approve/reject transitions, retry after rejection, no IP, no claims/tokens in body, console health, and no horizontal overflow on desktop and Pixel 7.

- [ ] **Step 2: Run the focused E2E test against the existing local build and verify the new tests fail because the route/panel is absent.**

Run: `corepack pnpm --dir qa exec playwright test tests/admin-access-requests.spec.ts --project=desktop-chromium --project=mobile-chromium`

Expected: FAIL with missing request panel or expected pending state, not a browser startup error.

- [ ] **Step 3: Implement only the synthetic fixture adapter needed by the tests.** Gate it behind the existing loopback E2E build flag, reject non-loopback hosts, and never include the adapter in normal production behavior.

- [ ] **Step 4: Run the focused E2E suite.**

Run: `corepack pnpm --dir qa exec playwright test tests/admin-access-requests.spec.ts --project=desktop-chromium --project=mobile-chromium`

Expected: all new desktop/mobile request tests pass with empty browser error collections.

- [ ] **Step 5: Run full verification.**

Run: `corepack pnpm exec vitest run --project web --project node`

Expected: all unit/web/node tests pass.

Run: `corepack pnpm lint`

Expected: exit 0 with no warnings.

Run: `corepack pnpm typecheck`

Expected: exit 0 for all workspaces, or document an existing unrelated wrapper limitation without masking it.

Run: `corepack pnpm exec prettier --check "{apps,packages,qa}/**/*.{ts,tsx,js,mjs,json,css}" "*.{json,mjs,ts,yaml,yml}"`

Expected: all relevant files pass; pre-existing unrelated format warnings remain explicitly identified if present.

Run: `corepack pnpm test:rules`

Expected: all Rules suites pass, including request denial coverage.

Run: `corepack pnpm --filter @bpt-jersey/web build`

Expected: static build succeeds with `/admin` and `/login` generated.

- [ ] **Step 6: Run security checks.**

Run: `corepack pnpm audit --audit-level high`

Expected: no high/critical vulnerabilities; any already-registered moderate transitives remain documented.

Run: `git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check`

Expected: no whitespace errors.

- [ ] **Step 7: Update `tasks.md` with evidence and stop before deployment.** Record focused tests, full tests, Rules, build, E2E, security result, rollback procedure, and the fact that no live claim normalization or deployment occurred. Do not mark production deployed.

---

## Task 9: Operational Rollout Checkpoint

**Files:**

- Modify: `STACK.md` only for confirmed runtime configuration.
- Modify: `tasks.md` with operator-approved rollout evidence.
- No production data migration file is created.

- [ ] **Step 1: Verify the live Functions runtime has `BPT_ACADEMY_ID=demo-academy` configured without printing its value.** If absent, stop and request the operator's deployment configuration approval; do not guess a tenant.

- [ ] **Step 2: Confirm at least one existing administrator can authenticate with MFA and reach the request panel.** Use a dedicated non-production account for live verification; do not place credentials in the repository or test arguments.

- [ ] **Step 3: Obtain explicit operator approval before deploying Functions/frontend or normalizing any legacy `owner` claim.**

- [ ] **Step 4: After approval only, deploy the prepared artifacts and verify request, approval, re-login, rejection, and retry with controlled accounts.** Record deployment IDs and rollback targets without recording credentials or raw user data.

---

## Self-Review Checklist

- Spec coverage: request creation, idempotency, rejection retry, equal administrator approval, no-owner business authority, no-IP projection, client no-approval access, MFA, tenant isolation, audit, concurrency, compensation, responsive UI, E2E, rollback, and deployment checkpoint each have an explicit task.
- Placeholder scan: no `TODO`, `TBD`, or unspecified implementation step is required; the only runtime value is the explicitly named `BPT_ACADEMY_ID`, whose absence is a tested fail-closed condition.
- Type consistency: domain statuses feed backend results; backend result shapes feed `admin-access-requests-client.ts`; the client boundary feeds login/gate/panel; synthetic fixtures use the same status and decision literals.
- Safety boundary: legacy `owner` claims are compatibility-only, all new grants are `administrator`, and all application admins receive safe Regyfit projections without IP.
