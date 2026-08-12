# Real Members And Responsive Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan inline on `main` with a fresh verification cycle after each task. Do not create feature branches or worktrees.

**Goal:** Replace the administrative Members fixture with confirmed Regyfit PDF data and make the admin shell behave as a responsive SPA with a logo-led navigation drawer.

**Architecture:** Keep Firestore direct access denied from the browser. Reuse the existing callable import pipeline (`PDF -> private R2 session -> validated preview -> explicit confirmation -> Firestore`) and expose the confirmed Members projection through the existing `searchMembers` callable. Move `AdminGate` and `AdminShell` into an admin route layout, use `next/link` for client-side transitions, and make the shell's desktop sidebar/mobile drawer a single responsive component.

**Tech Stack:** Next.js 16.3 App Router, React 19.2, TypeScript 6, Firebase Auth/Cloud Functions/Firestore Emulator, Cloudflare R2 adapter, Vitest, Testing Library, Playwright CLI, pnpm 11.

## Global Constraints

- All visible UI text remains English.
- All code changes happen directly on `main`; commit and push after every completed task.
- Never copy, commit, log, or bundle PDFs or real member PII.
- Firestore Rules keep direct browser access to `academies/{academyId}/members` denied.
- Import starts only from an explicit administrator action; never during `next build` or page load.
- Backend validates Auth, admin claims, academy scope, payload shape, row limits, conflict state, and rate limits.
- `owner` remains the only role allowed to grant or revoke administrative access.
- Mobile layout must support keyboard focus, `Escape`, outside-click close, visible focus, reduced motion, and touch targets of at least 44px.
- Verification commands run from `F:\Proyectos\BPT Jersey\Dev` and use `corepack pnpm`.

---

### Task 1: Persist The Admin App Shell

**Files:**
- Create: `apps/web/src/app/admin/layout.tsx`
- Modify: `apps/web/src/app/admin/admin-shell.tsx`
- Modify: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/app/admin/regyfit-access-records/page.tsx` only if the new layout exposes a duplicate `AdminGate`
- Test: `apps/web/src/app/admin/page.test.tsx`
- Test: `qa/tests/admin-auth.spec.ts`

**Interfaces:**
- `AdminLayout({ children }: Readonly<{ children: React.ReactNode }>)` owns one `AdminGate` for all `/admin/*` routes.
- `AdminShell` receives the existing `session`, optional `onSignOut`, and renders children without wrapping another gate.
- Every admin page exports page content that can render inside the layout without a second `AdminGate`.

- [ ] **Step 1: Write the failing navigation test**

Add a unit assertion that the admin layout owns the gate once and the shell is rendered around a child page. Add an E2E assertion that navigating `/admin` to `/admin/members` with `page.getByRole("link", { name: "Members" }).click()` keeps the authenticated shell visible and does not perform a full document navigation.

The E2E test must record `page.on("request", ...)` and count document requests. The expected count after the initial page load is zero additional document requests when the Members link is clicked.

- [ ] **Step 2: Run the focused tests and verify the current failure**

Run:

```text
corepack pnpm exec vitest run apps/web/src/app/admin/page.test.tsx
corepack pnpm --dir qa test:e2e --grep "client-side admin navigation"
```

Expected: the new contract fails because the current shell uses plain `<a>` links and each admin page owns its own `AdminGate`.

- [ ] **Step 3: Implement the persistent layout**

Create `apps/web/src/app/admin/layout.tsx`:

```tsx
import type { ReactNode } from "react";

import { AdminGate } from "./admin-gate";

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AdminGate>{children}</AdminGate>;
}
```

Remove the route-level `AdminGate` wrappers from admin pages so the layout is the only gate. Keep test-only direct page exports where existing unit tests require them.

- [ ] **Step 4: Convert shell navigation to App Router links**

Import `Link` from `next/link` in `admin-shell.tsx`. Replace navigation `<a href={item.href}>` with `<Link href={item.href}>`. Convert the shell Home link and any admin quick-action links that still use plain anchors. Preserve `aria-current="page"`, the existing route matching, accessible labels, and the current focus order.

- [ ] **Step 5: Run focused verification**

Run:

```text
corepack pnpm exec vitest run apps/web/src/app/admin/page.test.tsx apps/web/src/app/admin/members/page.test.tsx
corepack pnpm lint
corepack pnpm typecheck
```

Expected: all focused tests pass, lint has zero warnings, and typecheck exits 0.

- [ ] **Step 6: Commit and push**

```text
git add apps/web/src/app/admin/layout.tsx apps/web/src/app/admin/admin-shell.tsx apps/web/src/app/admin/page.tsx apps/web/src/app/admin/*/page.tsx apps/web/src/app/admin/page.test.tsx qa/tests/admin-auth.spec.ts
git commit -m "feat: persist admin navigation between sections"
git push origin main
```

Do not stage PDFs, generated output, or unrelated pre-existing untracked files.

---

### Task 2: Build The Logo-Led Responsive Drawer

**Files:**
- Modify: `apps/web/src/app/admin/admin-shell.tsx`
- Modify: `apps/web/src/app/admin/admin.css`
- Modify: `apps/web/src/app/admin/page.test.tsx`
- Create or modify: `apps/web/src/app/admin/admin-icons.tsx` only if a menu/close icon is missing
- Test: `apps/web/src/app/admin/admin-ui.test.tsx` if drawer primitives are extracted
- Test: `qa/tests/admin-shell.spec.ts`

**Interfaces:**
- `AdminShell` owns `navigationOpen: boolean` and renders one mobile menu button, one drawer, and one backdrop.
- The menu button has `aria-expanded`, `aria-controls="admin-mobile-navigation"`, and an accessible label that changes between `Open admin navigation` and `Close admin navigation`.
- The drawer uses the existing `navigationItems` and closes after selecting a route.

- [ ] **Step 1: Write failing responsive interaction tests**

Add unit tests that verify:

```tsx
expect(screen.getByRole("button", { name: "Open admin navigation" })).toHaveAttribute(
  "aria-expanded",
  "false",
);
await user.click(screen.getByRole("button", { name: "Open admin navigation" }));
expect(screen.getByRole("dialog", { name: "Admin navigation" })).toBeVisible();
expect(screen.getByRole("button", { name: "Close admin navigation" })).toHaveAttribute(
  "aria-expanded",
  "true",
);
await user.keyboard("{Escape}");
expect(screen.getByRole("dialog", { name: "Admin navigation" })).not.toBeVisible();
```

Add Playwright checks at mobile width for the logo, drawer, backdrop, route selection, no horizontal overflow, and no console/page errors. Add a desktop check that the persistent sidebar remains visible and the mobile button is hidden by CSS.

- [ ] **Step 2: Run tests to verify RED**

Run:

```text
corepack pnpm exec vitest run apps/web/src/app/admin/page.test.tsx apps/web/src/app/admin/admin-ui.test.tsx
corepack pnpm --dir qa test:e2e --grep "responsive admin navigation"
```

Expected: the tests fail because no mobile drawer/menu contract exists.

- [ ] **Step 3: Implement the drawer behavior**

Add a client-side `navigationOpen` state in `AdminShell`. When open:

- Render a `<div className="admin-mobile-backdrop" />` with a button or click handler that closes the drawer.
- Render a `<nav id="admin-mobile-navigation" aria-label="Admin navigation" role="dialog">` using the same links as desktop.
- Focus the close/menu control when opening/closing; use a `useEffect` keydown listener for `Escape`.
- Close the drawer from a `Link` click.
- Keep the desktop `<aside>` and mobile drawer semantically separate so responsive CSS controls visibility without browser measurement.

The drawer header must contain the official `/bpt-jersey-logo.png`, a short `BPT Jersey` wordmark, active section name, and close button. Do not introduce emoji icons.

- [ ] **Step 4: Implement responsive CSS**

Use the existing purple/ink/white design DNA. Keep the desktop grid at `minmax(15rem, 18rem) minmax(0, 1fr)`. At the existing mobile breakpoint:

- Set `.admin-shell` to one column.
- Hide `.admin-sidebar` visually and expose `.admin-mobile-menu-button`.
- Position `.admin-mobile-navigation` fixed below the header, above the workspace, with a high stacking context.
- Add a visible backdrop and `prefers-reduced-motion` override.
- Ensure drawer links and button min-height are `44px` or larger.
- Prevent body/content horizontal overflow.

- [ ] **Step 5: Verify interaction and accessibility**

Run:

```text
corepack pnpm exec vitest run apps/web/src/app/admin/page.test.tsx apps/web/src/app/admin/admin-ui.test.tsx
corepack pnpm --dir qa test:e2e --grep "responsive admin navigation|admin shell"
corepack pnpm lint
corepack pnpm typecheck
```

- [ ] **Step 6: Commit and push**

```text
git add apps/web/src/app/admin/admin-shell.tsx apps/web/src/app/admin/admin.css apps/web/src/app/admin/page.test.tsx apps/web/src/app/admin/admin-ui.test.tsx qa/tests/admin-shell.spec.ts
git commit -m "feat: add responsive logo navigation drawer"
git push origin main
```

---

### Task 3: Validate The Real PDF Batch Without Versioning It

**Files:**
- Modify: `apps/web/src/app/admin/members/import/page.tsx` only for safe batch guidance/status copy
- Modify: `apps/functions/src/members/member-callables.ts` only if the real batch exposes a validated contract gap
- Modify: `apps/functions/src/members/member-pdf-import.ts` only if parsing a real report format exposes a validated gap
- Test: `apps/functions/src/members/member-pdf-import.test.ts`
- Test: `apps/functions/src/members/member-callables.test.ts`
- Test: `apps/web/src/app/admin/members/import/page.test.tsx`
- External input: `F:\Proyectos\BPT Jersey\Varios\Active.pdf`, `Activos Regularizados.pdf`, `COM NÚMERO DE SÓCIO.pdf`, `Inactive.pdf`, `No number.pdf`, `Regularizados.pdf`, `Suspensos.pdf`, `Total.pdf`

**Interfaces:**
- Keep `createMemberImportSession`, `uploadMemberImportFiles`, `previewMemberImport`, and `confirmMemberImport` unchanged unless a failing real-format test proves a contract change is required.
- Use `MemberImportPreview` as the only confirmation input; no client-generated member records are accepted.
- The real batch must produce a deterministic report of additions, updates, duplicates, and conflicts before confirmation.

- [ ] **Step 1: Inspect the real PDFs outside Git**

Use the existing local PDF parsing path or a temporary non-versioned script under `C:\Users\USER\AppData\Local\Temp\opencode` to inspect metadata and text shape. Do not copy PDFs to the repository, do not print full PII rows in tool output, and do not add filenames containing personal data to tests.

Record only aggregate facts: file count, page count, parser layout classification, row count, missing identifier count, and conflict count.

- [ ] **Step 2: Add a sanitized regression fixture from the real layout**

If the real files reveal a layout not covered by current tests, add a synthetic fixture that preserves the same column/header structure but replaces every name, number, email, phone, VAT, and date with values such as `Layout Member A` and `ID-TEST-001`. Add a failing parser test for the discovered layout before changing production code.

- [ ] **Step 3: Run the parser test RED, then implement the smallest parser change**

Run:

```text
corepack pnpm exec vitest run apps/functions/src/members/member-pdf-import.test.ts
```

Expected: the new layout test fails first. Implement only the normalization/header mapping required for that layout, preserving existing limits, canonical field names, and safe error behavior.

- [ ] **Step 4: Verify the real PDFs through the existing preview flow**

Run the local emulator/import flow with the eight PDFs, using a synthetic/emulator academy and an explicit preview request. Capture only aggregate output. Do not confirm writes until the preview has no unresolved conflicts and the operator has reviewed the aggregate counts.

- [ ] **Step 5: Confirm the import only after aggregate review**

After preview review, use the existing explicit confirmation action. Verify with emulator queries that all writes are scoped to the synthetic academy, each document has server-owned timestamps/actor/source/schema fields, repeated confirmation is idempotent, and no PDF object or raw report text is exposed to the client.

- [ ] **Step 6: Commit and push parser/import changes**

```text
git add apps/functions/src/members/member-pdf-import.ts apps/functions/src/members/member-pdf-import.test.ts apps/functions/src/members/member-callables.ts apps/functions/src/members/member-callables.test.ts apps/web/src/app/admin/members/import/page.tsx apps/web/src/app/admin/members/import/page.test.tsx
git commit -m "feat: validate real member report import flow"
git push origin main
```

Never stage files under `F:\Proyectos\BPT Jersey\Varios`.

---

### Task 4: Replace Members Fixture With Callable Data

**Files:**
- Modify: `apps/web/src/app/admin/members/page.tsx`
- Modify: `apps/web/src/app/admin/members/page.test.tsx`
- Modify: `apps/web/src/lib/members-client.ts` only if the current response validator needs a focused correction
- Test: `apps/web/src/app/admin/members/page.test.tsx`
- Test: `apps/functions/src/members/member-callables.test.ts`
- Test: `qa/tests/admin-shell.spec.ts` or a new `qa/tests/admin-members-real.spec.ts`

**Interfaces:**
- Members page calls `searchMembers({}, pageToken?)` through `apps/web/src/lib/members-client.ts`.
- It consumes `MemberSearchResult` and renders `MemberSearchProjection` only.
- Loading, empty, error, populated, and pagination states are explicit and accessible.

- [ ] **Step 1: Write the failing page contract**

Mock only the callable client boundary in the unit test. Assert that the page calls `searchMembers({})`, renders the returned real projection, does not render `previewData.members`, shows `Connected source`, and exposes a loading/empty/error state.

- [ ] **Step 2: Run the focused test RED**

Run:

```text
corepack pnpm exec vitest run apps/web/src/app/admin/members/page.test.tsx
```

Expected: the test fails because `MembersPage` currently renders `previewData.members` synchronously.

- [ ] **Step 3: Implement the client data state**

Convert `MembersPage` to a client component with:

```ts
const [result, setResult] = useState<MemberSearchResult>();
const [loading, setLoading] = useState(true);
const [error, setError] = useState("");
```

Load the first page in `useEffect` only after the authenticated shell is present. Use a local active flag to ignore stale results after unmount. Keep `Add new member` and `Search members` links as `next/link` links. Render `Connected source` only when data came from the callable response.

- [ ] **Step 4: Add pagination and empty states**

When `result.nextPageToken` exists, render `Load more members` and request the next page through the same `searchMembers` function. Append only validated projections. When no Members exist, show `No members imported yet` and a link to `/admin/members/import`.

- [ ] **Step 5: Verify the real projection and security boundaries**

Run:

```text
corepack pnpm exec vitest run apps/web/src/app/admin/members/page.test.tsx apps/functions/src/members/member-callables.test.ts
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only auth,firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts"
```

Assert no direct Firestore browser read is introduced, no raw PDF content appears in the DOM, and cross-academy records are excluded.

- [ ] **Step 6: Verify E2E navigation plus Members**

Build the synthetic admin E2E target and run desktop/mobile tests that navigate from Overview to Members without a document request, open the responsive drawer, and verify the Members page displays connected-source/empty/real emulator data as configured by the test.

- [ ] **Step 7: Commit and push**

```text
git add apps/web/src/app/admin/members/page.tsx apps/web/src/app/admin/members/page.test.tsx apps/web/src/lib/members-client.ts apps/functions/src/members/member-callables.test.ts qa/tests/admin-members-real.spec.ts
git commit -m "feat: connect members directory to Firestore projection"
git push origin main
```

---

### Task 5: Full Verification And Phase Handoff

**Files:**
- Modify: `tasks.md`
- Modify: `BRIEF.md` or `STACK.md` only if verified operational facts changed
- No real PDF files added or modified

- [ ] **Step 1: Run the complete gates on `main`**

```text
corepack pnpm test
corepack pnpm test:rules
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm build
corepack pnpm audit --audit-level high
```

- [ ] **Step 2: Run browser verification**

Use the approved local synthetic build flag only for protected admin E2E:

```text
$env:NEXT_PUBLIC_ADMIN_E2E='true'; corepack pnpm --filter @bpt-jersey/web build
corepack pnpm --dir qa test:e2e:smoke
corepack pnpm --dir qa test:e2e --grep "client-side admin navigation|responsive admin navigation|real members"
```

Restore a normal build afterward:

```text
corepack pnpm build
```

- [ ] **Step 3: Perform the security self-review**

Confirm no real PDF, PII, secret, signed URL, or generated artifact is staged. Confirm direct Firestore access remains denied, callable authorization remains enforced, import confirmation is explicit, and rate limits cover search/report/summary/import operations as applicable.

- [ ] **Step 4: Update evidence and commit**

Append actual command results and aggregate import counts to the relevant `tasks.md` evidence section. Do not record individual member names or sensitive fields.

```text
git add tasks.md BRIEF.md STACK.md
git commit -m "chore: verify real members and responsive admin phase"
git push origin main
```

## Self-Review

- Spec coverage: persistent admin layout is Task 1; logo-led drawer and responsive behavior are Task 2; real PDF source, preview, conflicts, idempotency and privacy are Task 3; callable-backed Members are Task 4; complete gates and handoff are Task 5.
- Placeholder scan: no implementation step depends on an unspecified file, route, API name, or environment variable.
- Type consistency: `MemberSearchResult`, `MemberSearchProjection`, `searchMembers(filters, pageToken?)`, `MemberImportPreview`, and the existing import callable names match the current repository contracts.
- Scope: Classes/groups, memberships/payments, roles/audit, and CRM/communications remain later phases as approved; this plan does not pretend they are connected by the Members import.
