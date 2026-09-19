# Unified Login Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single BPT Jersey login entry at `/login` where people choose Administrator or Client, with Google/email authentication, client self-registration, invite-only admin access, and protected destinations.

**Architecture:** Keep Cloudflare Pages as the frontend target and Firebase Authentication as the browser identity provider. Extend the existing Firebase client boundary with explicit email/password, Google, reset-password, and client-registration operations; keep authorization in verified custom claims and existing Functions/Rules. Use a small role-aware login UI and reusable client session gate, while retaining the existing admin claims gate as the final authorization boundary.

**Tech Stack:** Next.js 16 static export, React 19, Firebase Web SDK 12, Firebase Functions v2, TypeScript strict mode, Vitest/Testing Library, Playwright.

## Global Constraints

- The selected role is UX context only and never grants permission.
- Administrator accounts are invite/provisioning-only; no public admin registration exists.
- Client checkout requires authentication; guest checkout is not implemented.
- Google and email/password are available to both roles.
- Admin authorization requires verified `academyId` plus `owner` or `administrator` claims.
- Return URLs accept only relative allowlisted paths: `/shop`, `/account`, and `/checkout`.
- Do not add Admin SDK, service accounts, passwords, tokens, cookies, or real user data to frontend code, tests, logs, screenshots, traces, or Git.
- Do not build catalog, inventory, cart, order, payment, or full invitation-management features in this plan.
- Publish only to `https://bptjersey.pages.dev` after explicit deployment approval; Firebase staging remains the backend test environment.

---

## File Map

- Create `apps/web/src/lib/auth-client.ts`: typed browser operations for email/password, Google, password reset, auth subscription, and sign-out.
- Modify `apps/web/src/lib/firebase-client.ts`: expose the existing Firebase Auth instance boundary to `auth-client.ts` without leaking SDK setup into UI components.
- Create `apps/web/src/lib/login-flow.ts`: pure role, destination, return-URL, and Firebase-error mapping functions.
- Create `apps/web/src/lib/client-auth.tsx`: signed-in client session provider and protected client-content gate.
- Modify `apps/web/src/lib/admin-auth.tsx`: preserve claims validation while consuming the shared auth operations and keeping stale-token protection.
- Create `apps/web/src/app/login/login-form.tsx`: accessible selector-first login/register form.
- Create `apps/web/src/app/login/page.tsx`: public metadata and page shell for `/login`.
- Create `apps/web/src/app/account/page.tsx`: minimal authenticated client destination, not a commerce implementation.
- Create `apps/web/src/app/shop/page.tsx`: minimal authenticated client destination that explains the future shop boundary.
- Modify `apps/web/src/app/page.tsx`: replace the landing header’s booking-only account entry with `Sign in` pointing to `/login`.
- Modify `apps/web/src/app/admin/admin-gate.tsx`: direct signed-out admin access links to `/login?role=administrator` instead of exposing a Google-only shortcut.
- Create `apps/web/src/lib/auth-client.test.ts`: mock Firebase SDK calls and verify method contracts/error normalization.
- Create `apps/web/src/lib/login-flow.test.ts`: verify role, allowlisted return URLs, destinations, and Firebase error mapping.
- Create `apps/web/src/lib/client-auth.test.tsx`: verify signed-out, signed-in, logout, stale event, and expired-session states.
- Create `apps/web/src/app/login/login-form.test.tsx`: verify role-specific controls, registration visibility, validation, loading, and generic errors.
- Modify `apps/web/src/lib/admin-auth.test.tsx`: update the direct signed-in entry expectation to the login route and preserve claims tests.
- Create `qa/tests/login-gateway.spec.ts`: desktop/mobile signed-out, selector, protected routes, and client/admin boundary E2E coverage.
- Modify `qa/README.md`: document the dedicated non-production Auth test-account mechanism without storing credentials.
- Modify `STACK.md`: record Cloudflare Pages as the frontend target, Firebase Auth/Functions as backend, and required OAuth/billing setup.

## Task 1: Auth Boundary And Pure Flow Contracts

**Files:**

- Create: `apps/web/src/lib/auth-client.ts`
- Modify: `apps/web/src/lib/firebase-client.ts`
- Create: `apps/web/src/lib/login-flow.ts`
- Test: `apps/web/src/lib/auth-client.test.ts`
- Test: `apps/web/src/lib/login-flow.test.ts`

**Interfaces:**

- `type LoginRole = "administrator" | "client"`.
- `type AuthDestination = "/admin" | "/account" | "/shop" | "/checkout"`.
- `signInWithEmail(email: string, password: string): Promise<UserCredential>`.
- `createClientWithEmail(email: string, password: string): Promise<UserCredential>`.
- `signInWithGoogle(): Promise<UserCredential>`.
- `sendPasswordReset(email: string): Promise<void>`.
- `subscribeToIdTokenChanges(listener: (user: User | null) => void): Unsubscribe`.
- `sanitizeReturnPath(value: string | null): AuthDestination | undefined`.
- `defaultDestination(role: LoginRole, returnPath?: AuthDestination): AuthDestination`.
- `toAuthMessage(error: unknown): string`.

- [ ] **Step 1: Write failing auth-boundary tests.** Mock `firebase/auth` and assert each public operation delegates to the correct Firebase method, trims email input, rejects blank credentials before SDK calls, and maps sign-out through the existing client boundary.
- [ ] **Step 2: Run the focused auth tests and confirm failure.**

Run: `node_modules/.bin/vitest.cmd run apps/web/src/lib/auth-client.test.ts apps/web/src/lib/login-flow.test.ts`

Expected: FAIL because the new auth boundary and pure flow functions do not exist.

- [ ] **Step 3: Implement the minimal auth boundary.** Keep Firebase initialization in `firebase-client.ts`; have `auth-client.ts` call `getAuth(getFirebaseClient())`, use `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `signInWithPopup(new GoogleAuthProvider())`, `sendPasswordResetEmail`, `onIdTokenChanged`, and existing `signOutFromFirebase`.
- [ ] **Step 4: Implement pure flow rules.** Accept only `/admin`, `/account`, `/shop`, and `/checkout` as return destinations; reject absolute URLs, protocol-relative URLs, query-injected external targets, and unknown paths. Map `auth/invalid-credential`, popup cancellation, network failure, and other SDK errors to generic user-facing messages without email-existence leakage.
- [ ] **Step 5: Run focused tests and verify they pass.**

Run: `node_modules/.bin/vitest.cmd run apps/web/src/lib/auth-client.test.ts apps/web/src/lib/login-flow.test.ts`

Expected: all new tests pass with no real Firebase project access.

## Task 2: Shared Client Session And Admin Entry Compatibility

**Files:**

- Create: `apps/web/src/lib/client-auth.tsx`
- Modify: `apps/web/src/lib/admin-auth.tsx`
- Modify: `apps/web/src/app/admin/admin-gate.tsx`
- Test: `apps/web/src/lib/client-auth.test.tsx`
- Modify: `apps/web/src/lib/admin-auth.test.tsx`

**Interfaces:**

- `type ClientSession = Readonly<{ uid: string; email: string; displayName: string }>`.
- `type ClientAuthStatus = "loading" | "signed-out" | "signed-in"`.
- `useClientSession(): { status: ClientAuthStatus; session?: ClientSession; signOut(): Promise<void> }`.
- `ClientAuthProvider` owns the `onIdTokenChanged` subscription and clears state on logout/expiry.
- `ClientAuthGate({ children, returnPath }): JSX.Element` renders children only for a signed-in user.

- [ ] **Step 1: Add failing client-session tests.** Cover initial loading, signed-out, signed-in user, sign-out, stale asynchronous user event, missing email, and auth subscription failure.
- [ ] **Step 2: Run the new client-session tests and confirm failure.**

Run: `node_modules/.bin/vitest.cmd run apps/web/src/lib/client-auth.test.tsx`

Expected: FAIL because the provider and gate do not exist.

- [ ] **Step 3: Implement `ClientAuthProvider`.** Reuse the auth boundary, normalize only safe user identity fields, and ignore stale token events using the same versioning approach already present in `AdminAuthProvider`.
- [ ] **Step 4: Update admin direct access.** Preserve `sessionFromUser` claims validation and stale-result protection. Replace the signed-out Google-only button in `admin-gate.tsx` with an accessible link to `/login?role=administrator`; keep denied users free of the admin shell and records.
- [ ] **Step 5: Run client and existing admin tests.**

Run: `node_modules/.bin/vitest.cmd run apps/web/src/lib/client-auth.test.tsx apps/web/src/lib/admin-auth.test.tsx apps/web/src/app/admin/page.test.tsx`

Expected: all client-session and existing admin claims tests pass.

## Task 3: Selector-First Login UI

**Files:**

- Create: `apps/web/src/app/login/login-form.tsx`
- Create: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Test: `apps/web/src/app/login/login-form.test.tsx`

**Interfaces:**

- `LoginForm({ initialRole, returnPath }: { initialRole: LoginRole; returnPath?: AuthDestination }): JSX.Element`.
- The form owns role, mode (`sign-in` or `create-client`), email, password, busy state, and sanitized error state.

- [ ] **Step 1: Write failing UI tests.** Assert `/login` renders both role controls, administrator hides `Create account`, client shows it, Google and email controls have accessible names, invalid fields block submit, loading disables duplicate actions, and generic errors render without raw Firebase codes.
- [ ] **Step 2: Run the focused UI tests and confirm failure.**

Run: `node_modules/.bin/vitest.cmd run apps/web/src/app/login/login-form.test.tsx`

Expected: FAIL because the login route and form do not exist.

- [ ] **Step 3: Implement the public page.** Add metadata for `BPT Jersey account access`, keep the route static-safe, and render the selector-first form with BPT purple/canvas/lime tokens, visible keyboard focus, labels, `aria-pressed`, `aria-live` errors, and responsive single-column mobile layout.
- [ ] **Step 4: Implement role behavior.** Administrator supports sign-in, Google, reset password, and link back to client. Client supports sign-in, Google, registration, reset password, and a clear account-required message for commerce entry. Use `defaultDestination` after successful auth and preserve only allowlisted return paths.
- [ ] **Step 5: Add the single landing CTA.** Change the public header to use one `Sign in` link to `/login`, without exposing separate admin/client links in the public navigation.
- [ ] **Step 6: Run focused UI tests and formatting.**

Run: `node_modules/.bin/vitest.cmd run apps/web/src/app/login/login-form.test.tsx && node node_modules/prettier/bin/prettier.cjs --check apps/web/src/app/login apps/web/src/app/page.tsx`

Expected: all login tests pass and the touched files are formatted.

## Task 4: Protected Client Destinations

**Files:**

- Create: `apps/web/src/app/account/page.tsx`
- Create: `apps/web/src/app/shop/page.tsx`
- Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/src/app/account/page.test.tsx`
- Test: `apps/web/src/app/shop/page.test.tsx`

**Interfaces:**

- Both pages use `ClientAuthProvider` and `ClientAuthGate`.
- `/account` shows the signed-in client’s safe display name/email and a sign-out action.
- `/shop` shows a protected commerce entry state; it does not create products, carts, orders, or payments.

- [ ] **Step 1: Write failing destination tests.** Assert signed-out users see an account-required state with a link to `/login?returnTo=/account` or `/login?returnTo=/shop`; signed-in users see the correct destination; no IP, admin claims, or synthetic records render.
- [ ] **Step 2: Run destination tests and confirm failure.**

Run: `node_modules/.bin/vitest.cmd run apps/web/src/app/account/page.test.tsx apps/web/src/app/shop/page.test.tsx`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement minimal protected surfaces.** Keep copy explicit that the shop is an authenticated client area and that catalog/cart features are a later task. Preserve BPT visual language and accessible heading hierarchy.
- [ ] **Step 4: Implement checkout boundary contract.** Add a reusable `requireClientSession(returnTo)` decision in `login-flow.ts` so future checkout can redirect to `/login?role=client&returnTo=/checkout` without duplicating open-redirect logic.
- [ ] **Step 5: Run focused tests and responsive formatting checks.**

Run: `node_modules/.bin/vitest.cmd run apps/web/src/app/account/page.test.tsx apps/web/src/app/shop/page.test.tsx && node node_modules/prettier/bin/prettier.cjs --check apps/web/src/app/account apps/web/src/app/shop apps/web/src/app/globals.css`

Expected: all destination tests pass and files are formatted.

## Task 5: Auth Configuration And Environment Boundaries

**Files:**

- Modify: `.env.example`
- Modify: `STACK.md`
- Modify: `qa/README.md`
- Optional deployment configuration: Cloudflare Pages project settings, not committed secrets

- [ ] **Step 1: Document public Firebase variables.** Add the six `NEXT_PUBLIC_FIREBASE_*` names to `.env.example` with no real values and explicitly state that values are environment-specific public web configuration, not Admin credentials.
- [ ] **Step 2: Document provider setup.** Record that Firebase Auth must enable Email/Password and Google; Google authorized domains must include the Cloudflare Pages domain and local QA origin; admin users must be provisioned with claims rather than self-registering.
- [ ] **Step 3: Document Cloudflare Pages build settings.** Use the existing static export: build command `next build` from `apps/web`, output directory `apps/web/out`, and staging public Firebase variables configured in Cloudflare Pages environment settings.
- [ ] **Step 4: Document test-account handling.** QA uses dedicated non-production client and pre-provisioned admin accounts through a local secret mechanism; no credentials appear in command arguments, repository files, screenshots, traces, or reports.
- [ ] **Step 5: Review the environment documentation.**

Run: `node node_modules/prettier/bin/prettier.cjs --check .env.example STACK.md qa/README.md`

Expected: formatting passes and the documentation contains no credential values.

## Task 6: E2E And Security Verification

**Files:**

- Create: `qa/tests/login-gateway.spec.ts`
- Modify: `qa/README.md` if the final test command needs a new local-only mode

- [ ] **Step 1: Write E2E coverage for the unauthenticated surface.** On desktop and Pixel 7, verify `/login` loads, both role buttons work, administrator has no public registration, client exposes registration, focus remains visible, and there are no console errors or horizontal overflow.
- [ ] **Step 2: Add protected-route checks without real credentials.** Verify `/account` and `/shop` redirect or render the account-required state when signed out; verify `/admin` links to the administrator login context and never renders records while signed out.
- [ ] **Step 3: Add dedicated local-auth execution hooks.** Use only an approved local secret mechanism for a real client account and a provisioned admin account; do not add credentials to Playwright config or tests. The live check must be opt-in and skipped by CI.
- [ ] **Step 4: Run the full verification set.**

Run:

```text
node_modules/.bin/vitest.cmd run --project web --project node
node_modules/.bin/eslint.cmd . --max-warnings 0
node node_modules/prettier/bin/prettier.cjs --check "{apps,packages,qa}/**/*.{ts,tsx,js,mjs,json,css}" "*.{json,mjs,ts,yaml,yml}"
```

Run the Next build from `apps/web`:

```text
node node_modules/next/dist/bin/next build
```

Run the remaining commands from the repository root:

```text
node_modules/.bin/playwright.cmd test --project=desktop-chromium --project=mobile-chromium
```

Expected: unit tests, lint, format, static build, and E2E pass with no security or browser-health findings.

- [ ] **Step 5: Run the self-critique security pass.** Verify selector-vs-claims separation, generic auth errors, allowlisted returns, no admin registration, no secrets in output, and no client access to admin callable data.

## Task 7: Staging Release And Operator Verification

**Files:**

- Release artifacts only; no new source file required.
- Update: `tasks.md` with command evidence and rollback notes.

- [ ] **Step 1: Build the static export with staging public Firebase configuration.** Confirm the build embeds only the staging web config and no service account material.
- [ ] **Step 2: Deploy only the approved Cloudflare Pages project.** Use the configured Pages deployment mechanism; do not deploy Firebase Hosting or production.
- [ ] **Step 3: Verify signed-out behavior at `https://bptjersey.pages.dev/login`.** Confirm the role selector, client registration link, admin no-registration rule, and protected destinations.
- [ ] **Step 4: Ask the operator to authenticate the dedicated staging client account.** Verify client account access and logout; do not request or record the password in chat.
- [ ] **Step 5: Ask the operator to authenticate the pre-provisioned staging administrator.** Verify `/admin` access, claims-derived role/academy, and absence of admin access for a client account.
- [ ] **Step 6: Record release and rollback evidence.** Rollback is the previous Cloudflare Pages deployment for frontend changes and the previous Functions revision for backend changes. Production remains untouched.

## Plan Self-Review

- **Spec coverage:** role selector and both providers are covered by Tasks 1 and 3; client registration and protected destinations by Tasks 2 and 4; admin claims by Tasks 2 and 6; checkout return boundary by Tasks 1 and 4; accessibility/responsive behavior by Tasks 3 and 6; Cloudflare/Firebase environment and rollback by Tasks 5 and 7.
- **Scope:** catalog, cart, orders, payments, inventory, and full invitation management remain explicitly outside this plan.
- **Security:** role selection is never used as authorization; admin registration is absent; returns are allowlisted; real credentials remain local-only.
- **No placeholders:** every task names files, interfaces, commands, expected results, and acceptance evidence.
