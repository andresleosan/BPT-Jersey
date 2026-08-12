# Visible Administrative Panel Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder admin overview with a client-presentable BPT Jersey operational panel that preserves the replicated member fields and filters while adding real dashboard, groups, activities, attendance, finance, reports, and quick-action routes.

**Architecture:** Keep the existing authenticated Next.js admin shell and server-owned member boundaries. Add a focused frontend preview layer with typed synthetic fixtures and reusable operational components; route screens consume fixtures through explicit module view models so later Firebase callables can replace the source without redesigning the UI. Existing Members search/add/import contracts remain intact.

**Tech Stack:** Next.js 16.3.0, React 19, TypeScript strict mode, CSS modules via the existing `admin.css` stylesheet, Vitest, React Testing Library, Playwright CLI, Firebase Emulator Suite for existing Rules/integration checks.

## Global Constraints

- All visible UI copy remains in English.
- Preserve the approved Members fields and eleven filters exactly.
- Synthetic fixtures are local preview data and must never look like imported production data.
- No real PDF import, payment provider, card capture, production data, migration, or deployment in this plan.
- Existing authentication, tenant scope, callable validation, Firestore Rules, and audit boundaries remain authoritative.
- Responsive layout, keyboard focus, accessible names, reduced-motion support, and no horizontal overflow are required.
- Use BPT Purple `#2F2483`, Mat Ink `#1A1A18`, Gi White `#FFFFFF`, Canvas `#F2F1ED`, Barlow Condensed, and Source Sans 3 from `STACK.md`.
- Run focused tests after each task and the full verification gates before handoff.

---

### Task 1: Typed Preview Data And Operational UI Primitives

**Files:**
- Create: `apps/web/src/app/admin/preview-data.ts`
- Create: `apps/web/src/app/admin/admin-icons.tsx`
- Create: `apps/web/src/app/admin/admin-ui.tsx`
- Modify: `apps/web/src/app/admin/admin.css`
- Test: `apps/web/src/app/admin/admin-ui.test.tsx`

**Interfaces:**
- Produces typed synthetic view models for dashboard, groups, activities, attendance, finance, and reports.
- Produces `AdminIconButton`, `AdminSectionHeader`, `AdminStatusBadge`, `AdminMetric`, `AdminDataTable`, and `AdminFilterBar` components.
- All primitives accept accessible labels and render stable semantic elements that later route screens can reuse.

- [ ] **Step 1: Write failing tests for the primitives and fixture safety.**

```tsx
it("renders icon actions with accessible labels and tooltips", () => {
  render(<AdminIconButton label="Add new member" icon="member-add" onClick={() => undefined} />);
  expect(screen.getByRole("button", { name: "Add new member" })).toHaveAttribute(
    "title",
    "Add new member",
  );
});

it("marks preview data as synthetic and contains no production identifiers", () => {
  expect(previewData.environment).toBe("synthetic-preview");
  expect(JSON.stringify(previewData)).not.toMatch(/real member|production|serviceAccount|bearer/i);
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the primitives do not exist.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/admin-ui.test.tsx`

Expected: FAIL with missing module/component errors.

- [ ] **Step 3: Implement the typed fixtures, SVG icon map, semantic primitives, and CSS states.**

Use readonly TypeScript types. Keep icons inline SVG with `aria-hidden="true"`; expose the label on the button and `title`. Keep status colors paired with text, not color alone. Use table markup on desktop and the existing responsive table/card strategy on mobile.

- [ ] **Step 4: Run the focused test and formatting check.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/admin-ui.test.tsx`

Expected: PASS.

Run: `corepack pnpm exec prettier --check apps/web/src/app/admin/admin-ui.tsx apps/web/src/app/admin/admin-icons.tsx apps/web/src/app/admin/preview-data.ts apps/web/src/app/admin/admin-ui.test.tsx`

Expected: all files use Prettier style.

---

### Task 2: Real Admin Navigation And Client-Visible Dashboard

**Files:**
- Create: `apps/web/src/app/admin/overview/page.tsx`
- Modify: `apps/web/src/app/admin/admin-shell.tsx`
- Modify: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/app/admin/admin.css`
- Modify: `apps/web/src/app/admin/page.test.tsx`
- Create: `apps/web/src/app/admin/overview/page.test.tsx`
- Modify: `qa/tests/admin-shell.spec.ts`

**Interfaces:**
- `AdminShell` exposes all Phase 1 routes and a compact quick-action toolbar.
- `/admin` renders `OverviewPage` through the existing `AdminGate`.
- Dashboard consumes `previewData.dashboard` and links to `/admin/members/add`, `/admin/members/search`, `/admin/groups`, `/admin/activities`, `/admin/attendance`, `/admin/finance`, and `/admin/reports`.

- [ ] **Step 1: Write failing tests for navigation and dashboard content.**

```tsx
it("exposes the operational modules and quick actions", () => {
  renderAuthenticatedPreview();
  const navigation = screen.getByRole("navigation", { name: "Admin navigation" });
  expect(within(navigation).getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/admin");
  expect(within(navigation).getByRole("link", { name: "Groups / Teams" })).toHaveAttribute("href", "/admin/groups");
  expect(screen.getByRole("link", { name: "Add new member" })).toHaveAttribute("href", "/admin/members/add");
});

it("renders operational dashboard metrics and today's class queue", () => {
  render(<OverviewPage />);
  expect(screen.getByRole("heading", { name: "Today's academy view" })).toBeVisible();
  expect(screen.getByText("8 classes today")).toBeVisible();
  expect(screen.getByRole("table", { name: "Today's classes" })).toBeVisible();
});
```

- [ ] **Step 2: Run the focused tests and verify the current placeholder fails the new contract.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/page.test.tsx apps/web/src/app/admin/overview/page.test.tsx`

Expected: FAIL on missing navigation links and dashboard headings.

- [ ] **Step 3: Replace placeholder module navigation with the real route list and quick-action strip.**

Keep `aria-current` route detection. Use links for navigation and actions, not buttons that only look like links. Add the dark compact action strip from the replicated page language, with visible hover/focus states and mobile wrapping.

- [ ] **Step 4: Implement the dashboard route using the synthetic preview view model.**

Render metrics, attendance pulse, today's classes, payment attention, and recent actions. Include empty/error/loading presentation components even though the preview source is synchronous, so later callable wiring does not change the layout.

- [ ] **Step 5: Run focused unit tests, typecheck, and Playwright admin shell smoke.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/page.test.tsx apps/web/src/app/admin/overview/page.test.tsx`

Expected: PASS.

Run: `corepack pnpm typecheck`

Expected: exit 0.

Run: build with `NEXT_PUBLIC_ADMIN_E2E=true`, then `corepack pnpm --dir qa test:e2e --grep @smoke`, then rebuild without the flag.

Expected: dashboard and navigation are visible on desktop and mobile with no console errors or overflow.

---

### Task 3: Members Landing View With Replicated Fields And Filters

**Files:**
- Create: `apps/web/src/app/admin/members/page.tsx`
- Create: `apps/web/src/app/admin/members/page.test.tsx`
- Modify: `apps/web/src/app/admin/members/search/page.tsx`
- Modify: `apps/web/src/app/admin/members/search/page.test.tsx`
- Modify: `apps/web/src/app/admin/admin-shell.tsx`
- Modify: `apps/web/src/app/admin/admin.css`

**Interfaces:**
- `/admin/members` is the visible Members landing screen.
- `/admin/members/search` remains the full 11-filter search screen and existing callable contract.
- `/admin/members/add` remains the existing validated create flow.
- Landing view consumes `previewData.members` until the existing `searchMembers` callable is connected to the default table.

- [ ] **Step 1: Write failing tests for the visible Members landing screen.**

```tsx
it("shows member rows with the replicated fields and direct actions", () => {
  render(<MembersPage />);
  expect(screen.getByRole("heading", { name: "Members" })).toBeVisible();
  expect(screen.getByRole("table", { name: "Member directory" })).toBeVisible();
  expect(screen.getByText("Membership number")).toBeVisible();
  expect(screen.getByRole("link", { name: "Add new member" })).toHaveAttribute("href", "/admin/members/add");
  expect(screen.getByRole("link", { name: "Search members" })).toHaveAttribute("href", "/admin/members/search");
});
```

- [ ] **Step 2: Run the focused test and verify the route/component is missing.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/members/page.test.tsx`

Expected: FAIL with missing module/route behavior.

- [ ] **Step 3: Implement the Members landing view with synthetic rows and direct action links.**

Use all approved displayed fields from the replicated page: membership number, name, email, ID card number, VAT number, birth date, mobile number, frequency, payment/status, gender, and training center. Label preview data as `Synthetic preview` in the page status, not in every cell.

- [ ] **Step 4: Preserve and visually integrate the existing search screen.**

Do not remove or rename any of the eleven controls. Add a clear route header and return link to Members. Keep existing pagination, counters, download behavior, generic errors, and asynchronous `findByRole` test waits.

- [ ] **Step 5: Run focused Members tests and the existing add/import client tests.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/members/page.test.tsx apps/web/src/app/admin/members/search/page.test.tsx apps/web/src/app/admin/members/add/page.test.tsx apps/web/src/app/admin/members/import/page.test.tsx`

Expected: all selected files pass.

---

### Task 4: Groups And Activities Operational Screens

**Files:**
- Create: `apps/web/src/app/admin/groups/page.tsx`
- Create: `apps/web/src/app/admin/groups/page.test.tsx`
- Create: `apps/web/src/app/admin/activities/page.tsx`
- Create: `apps/web/src/app/admin/activities/page.test.tsx`
- Modify: `apps/web/src/app/admin/preview-data.ts`
- Modify: `apps/web/src/app/admin/admin.css`

**Interfaces:**
- `/admin/groups` renders group/team list, filters, member count, coach, capacity, and direct create/manage actions.
- `/admin/activities` renders activity/class list, date/program/coach filters, capacity, location, status, and create/manage actions.
- Both routes consume readonly synthetic view models and expose stable labels for later callable integration.

- [ ] **Step 1: Write failing tests for groups and activities content and filters.**

```tsx
it("renders groups with program, coach, capacity, and filters", () => {
  render(<GroupsPage />);
  expect(screen.getByRole("heading", { name: "Groups / Teams" })).toBeVisible();
  expect(screen.getByLabelText("Program")).toBeVisible();
  expect(screen.getByLabelText("Coach")).toBeVisible();
  expect(screen.getByRole("table", { name: "Groups and teams" })).toBeVisible();
});

it("renders activities with schedule, location, capacity, and status", () => {
  render(<ActivitiesPage />);
  expect(screen.getByRole("heading", { name: "Activities" })).toBeVisible();
  expect(screen.getByLabelText("Activity status")).toBeVisible();
  expect(screen.getByRole("table", { name: "Academy activities" })).toBeVisible();
});
```

- [ ] **Step 2: Run focused tests and verify they fail before implementation.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/groups/page.test.tsx apps/web/src/app/admin/activities/page.test.tsx`

Expected: FAIL because the routes and components do not exist.

- [ ] **Step 3: Implement Groups / Teams with filters and action states.**

Include name, program, coach, age/skill band, schedule, capacity, member count, training center, and active/archived status. Add visible `Create group`, `View members`, and `Manage` affordances without persisting data.

- [ ] **Step 4: Implement Activities with list/calendar toggle presentation.**

Include activity name, program, coach, date/time, location, capacity, booked count, status, and actions. The calendar toggle may be a presentation state backed by the same fixture collection; no third-party calendar dependency is allowed in this phase.

- [ ] **Step 5: Run focused tests, typecheck, and mobile layout checks.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/groups/page.test.tsx apps/web/src/app/admin/activities/page.test.tsx`

Expected: PASS.

Run: `corepack pnpm typecheck`

Expected: exit 0.

---

### Task 5: Attendance And Finance Screens

**Files:**
- Create: `apps/web/src/app/admin/attendance/page.tsx`
- Create: `apps/web/src/app/admin/attendance/page.test.tsx`
- Create: `apps/web/src/app/admin/finance/page.tsx`
- Create: `apps/web/src/app/admin/finance/page.test.tsx`
- Modify: `apps/web/src/app/admin/preview-data.ts`
- Modify: `apps/web/src/app/admin/admin.css`

**Interfaces:**
- `/admin/attendance` renders sessions, roster states, filters, and check-in/correction affordances.
- `/admin/finance` renders revenue, active memberships, overdue balances, recent payments, and status filters.
- Both screens remain presentation-only in this phase; no card data, payment provider, or destructive correction is introduced.

- [ ] **Step 1: Write failing tests for attendance and finance contracts.**

```tsx
it("shows attendance states and session filters", () => {
  render(<AttendancePage />);
  expect(screen.getByRole("heading", { name: "Attendance" })).toBeVisible();
  expect(screen.getByLabelText("Attendance state")).toBeVisible();
  expect(screen.getByText("Present")).toBeVisible();
  expect(screen.getByText("No-show")).toBeVisible();
});

it("shows finance summary and payment status filters without card data", () => {
  render(<FinancePage />);
  expect(screen.getByRole("heading", { name: "Finance" })).toBeVisible();
  expect(screen.getByLabelText("Payment status")).toBeVisible();
  expect(screen.getByText("Outstanding balance")).toBeVisible();
  expect(screen.queryByText(/card number|cvv|cvc/i)).toBeNull();
});
```

- [ ] **Step 2: Run focused tests and verify they fail before implementation.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/attendance/page.test.tsx apps/web/src/app/admin/finance/page.test.tsx`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement Attendance with explicit state badges and operational filters.**

Show selected date, sessions, group, coach, student, check-in time, and state. Use text plus badge styling for present, late, absent, and no-show. Add `Review correction` and `Check in` UI affordances as non-persisting actions with safe feedback.

- [ ] **Step 4: Implement Finance with safe summaries and transaction list.**

Show revenue summary, active memberships, overdue balances, recent payments, invoice/receipt links as disabled preview actions, and payment status filters. Explicitly omit raw card fields.

- [ ] **Step 5: Run focused tests and build the routes.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/attendance/page.test.tsx apps/web/src/app/admin/finance/page.test.tsx`

Expected: PASS.

Run: `corepack pnpm --filter @bpt-jersey/web build`

Expected: exit 0 with `/admin/attendance` and `/admin/finance` listed in the route output.

---

### Task 6: Reports Screen And Final Client Demo Flow

**Files:**
- Create: `apps/web/src/app/admin/reports/page.tsx`
- Create: `apps/web/src/app/admin/reports/page.test.tsx`
- Modify: `apps/web/src/app/admin/admin-shell.tsx`
- Modify: `apps/web/src/app/admin/admin.css`
- Modify: `qa/tests/admin-shell.spec.ts`
- Create: `qa/tests/admin-modules.spec.ts`

**Interfaces:**
- `/admin/reports` renders report cards for members, attendance, memberships, finance, CRM, and progress.
- Existing member report counters/download actions remain available from `/admin/members/search`.
- Playwright smoke navigates through dashboard, members, groups, activities, attendance, finance, and reports.

- [ ] **Step 1: Write failing tests for Reports and end-to-end module navigation.**

```tsx
it("renders report categories and safe preview actions", () => {
  render(<ReportsPage />);
  expect(screen.getByRole("heading", { name: "Reports" })).toBeVisible();
  expect(screen.getByRole("article", { name: "Attendance report" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Prepare attendance report" })).toBeVisible();
});
```

- [ ] **Step 2: Run focused tests and verify they fail before implementation.**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/reports/page.test.tsx`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement Reports and route-aware navigation state.**

Use report categories and filters relevant to each module. Preview actions show a safe status message and never fabricate a downloadable production file.

- [ ] **Step 4: Add Playwright navigation and responsive assertions.**

The E2E flow must verify route headings, quick-action links, no horizontal overflow, no browser errors, visible accessible names, and no raw secrets/card data in the document text.

- [ ] **Step 5: Run the complete verification suite.**

Run, sequentially where emulators are involved:

```text
corepack pnpm test
corepack pnpm test:rules
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts"
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm format:check
corepack pnpm build
corepack pnpm audit --audit-level high
```

Then build with `NEXT_PUBLIC_ADMIN_E2E=true`, run `corepack pnpm --dir qa test:e2e:smoke`, and rebuild without the flag. Expected: all required checks pass; audit may retain only the two already-documented moderate transitive vulnerabilities.

---

## Handoff Checkpoints

- After Task 2: show the client-visible dashboard, navigation, and quick-action toolbar.
- After Task 3: show the Members landing screen, the replicated fields, and all eleven filters.
- After Task 5: show the complete core operational panel.
- After Task 6: perform the final browser walkthrough before any future backend wiring or store work.

## Out Of Scope For This Plan

- Real Regyfit PDF import.
- Production deployment.
- Payment provider integration or card capture.
- Virtual store catalog, cart, checkout, orders, and payment webhooks. The store receives a separate plan after the administrative panel is demonstrable.
