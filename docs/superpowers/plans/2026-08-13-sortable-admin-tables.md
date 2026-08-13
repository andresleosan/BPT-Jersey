# Sortable Admin Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every shared admin table sortable by clicking its column headers.

**Architecture:** Keep sorting inside `AdminDataTable`, which already owns table headers and receives generic rows/columns. Derive sortable values from each rendered cell's text while preserving the existing page contracts and backend ordering.

**Tech Stack:** React 19, TypeScript, Next.js 16, Vitest, React Testing Library, CSS.

## Global Constraints

- Apply to every consumer of `AdminDataTable`.
- Sort only currently loaded rows; do not change API filters, signed page tokens, or backend ordering.
- First click is ascending; second click on the same column is descending; another column starts ascending.
- Empty values sort after populated values ascending and before populated values descending.
- Preserve stable order for equal values and existing responsive table/card behavior.
- Expose direction through `aria-sort`, accessible button labels, and a visible arrow.

---

### Task 1: Add failing sorting tests

**Files:**

- Modify: `apps/web/src/app/admin/admin-ui.test.tsx`
- Test: `apps/web/src/app/admin/admin-ui.test.tsx`

- [ ] Add a small two-column table fixture with rows `Beta/10`, `Alpha/2`, and an empty value.
- [ ] Assert the first click on `Name` orders `Alpha`, `Beta`, empty value; second click orders empty value, `Beta`, `Alpha`.
- [ ] Assert `aria-sort` changes from `none` to `ascending` to `descending` and the button name includes the active direction.
- [ ] Run `corepack pnpm exec vitest run apps/web/src/app/admin/admin-ui.test.tsx` and confirm it fails because headers are not buttons.

### Task 2: Implement shared sorting

**Files:**

- Modify: `apps/web/src/app/admin/admin-ui.tsx`
- Modify: `apps/web/src/app/admin/admin.css`
- Test: `apps/web/src/app/admin/admin-ui.test.tsx`

- [ ] Add local sort state with the active column key and direction.
- [ ] Render each header with a button, `aria-sort`, direction label, and arrow indicator.
- [ ] Extract rendered cell text with `renderToStaticMarkup` or an equivalent safe text helper, normalize numbers/dates/text, and apply empty-value ordering.
- [ ] Use a stable indexed sort so equal values preserve original order.
- [ ] Keep the `rows` source unchanged and pass a sorted copy to the body.
- [ ] Add responsive CSS for header buttons, focus state, and compact arrows without changing the mobile table layout.
- [ ] Re-run focused tests and confirm they pass.

### Task 3: Regression verification

**Files:**

- No additional files expected.

- [ ] Run `corepack pnpm test:unit`.
- [ ] Run `corepack pnpm --filter @bpt-jersey/web typecheck` and `corepack pnpm lint`.
- [ ] Run `corepack pnpm format:check` and `corepack pnpm --filter @bpt-jersey/web build`.
- [ ] Build with `NEXT_PUBLIC_ADMIN_E2E=true` and run `corepack pnpm test:e2e:smoke`.
- [ ] Restore the normal build and verify it succeeds.
