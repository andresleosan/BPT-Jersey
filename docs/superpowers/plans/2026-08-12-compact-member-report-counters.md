# Compact Member Report Counters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tall member report cards with compact horizontal rows while preserving report counts, download behavior, accessible names, and mobile usability.

**Architecture:** Keep `ReportCounters` and its existing props unchanged. Change only its rendered structure and add dedicated CSS classes in the existing admin stylesheet; extend the current member search test to assert the compact row contract.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Vitest, React Testing Library.

## Global Constraints

- Do not change callable contracts, report counts, filtering, or download implementation.
- Keep all eight reports visible at once.
- Preserve full report-specific accessible button names such as `Download active members report`.
- Rows must wrap cleanly on narrow screens without horizontal overflow.
- Controls must retain usable touch targets, visible focus, and the existing BPT visual language.

---

### Task 1: Define the compact report-row contract

**Files:**

- Modify: `apps/web/src/app/admin/members/search/page.test.tsx:46-65`
- Test: `apps/web/src/app/admin/members/search/page.test.tsx`

**Interfaces:**

- Consumes: the existing `SearchMembersPage` render and `memberReportKeys` fixture.
- Produces: assertions that each report is rendered as a compact row with one visible `Download` label and its existing full accessible name.

- [ ] **Step 1: Add a failing semantic assertion**

Update the existing report-counter test to assert that the eight report rows use a dedicated `member-report-row` test id/class hook and that the first row exposes:

```tsx
expect(screen.getAllByTestId("member-report-row")).toHaveLength(8);
expect(screen.getByTestId("member-report-row-total")).toHaveTextContent("243");
expect(screen.getByRole("button", { name: "Download total members report" })).toHaveTextContent(
  "Download",
);
```

Keep the existing count and button-count assertions so the behavior contract remains covered.

- [ ] **Step 2: Run the focused test and verify it fails for the missing row hook**

Run:

```bash
corepack pnpm exec vitest run apps/web/src/app/admin/members/search/page.test.tsx
```

Expected: FAIL because the current cards do not expose `member-report-row` hooks.

### Task 2: Implement compact report rows

**Files:**

- Modify: `apps/web/src/app/admin/members/search/page.tsx:190-227`
- Modify: `apps/web/src/app/admin/admin.css:284-331`
- Test: `apps/web/src/app/admin/members/search/page.test.tsx`

**Interfaces:**

- Consumes: `ReportCounters` props `counts`, `busyReport`, and `onDownload`.
- Produces: eight compact rows with count, report title, and small download action; no changes to download callbacks or loading state.

- [ ] **Step 1: Replace the card markup with compact row markup**

Keep the section heading and map over `memberReportKeys`, but render each item using a row structure equivalent to:

```tsx
<article className="member-report-row" data-testid="member-report-row">
  <p className="member-report-count" data-testid={`member-report-row-${report}`}>
    {String(counts[report] ?? "-")}
  </p>
  <h4>{reportLabels[report]}</h4>
  <button
    aria-label={`Download ${reportLabels[report].toLowerCase()} report`}
    className="member-report-download"
    disabled={busyReport !== undefined}
    onClick={() => onDownload(report)}
    type="button"
  >
    {busyReport === report ? "Preparing..." : "Download"}
  </button>
</article>
```

Use the existing report-specific accessible name behavior; the visible label should stay short.

- [ ] **Step 2: Add compact responsive styles**

Add dedicated styles that:

- Use a single-column list of short rows with a bottom separator.
- Align count, title, and action horizontally on desktop.
- Use compact padding and remove the tall-card minimum height/empty space.
- Keep the button small visually while preserving at least a 44px minimum height.
- Allow title/action wrapping on mobile with no horizontal overflow.
- Preserve the existing purple action color and visible keyboard focus.

The mobile media query should change the row grid to a two-column layout where the title spans the available row width and the action remains aligned without forcing a fixed width.

- [ ] **Step 3: Run focused tests and verify they pass**

Run:

```bash
corepack pnpm exec vitest run apps/web/src/app/admin/members/search/page.test.tsx
```

Expected: all tests in the focused file pass, including eight rows, eight accessible download buttons, and the existing download interaction test.

### Task 3: Run regression verification

**Files:**

- No additional files expected.

**Interfaces:**

- Consumes: the compact `ReportCounters` implementation.
- Produces: verified web build and regression evidence.

- [ ] **Step 1: Run the full unit suite**

```bash
corepack pnpm test:unit
```

Expected: all test files and tests pass.

- [ ] **Step 2: Run web typecheck and lint**

```bash
corepack pnpm --filter @bpt-jersey/web typecheck
corepack pnpm lint
```

Expected: both commands exit 0 with no lint warnings.

- [ ] **Step 3: Run formatting and static build**

```bash
corepack pnpm format:check
corepack pnpm --filter @bpt-jersey/web build
```

Expected: formatting passes and Next.js generates the static web output successfully.

- [ ] **Step 4: Run the existing E2E smoke checks**

```bash
corepack pnpm test:e2e:smoke
```

Expected: desktop and mobile smoke flows pass, including no horizontal overflow.
