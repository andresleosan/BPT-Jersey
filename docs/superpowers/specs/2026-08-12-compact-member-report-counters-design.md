# Compact Member Report Counters

## Goal

Reduce the vertical space used by the eight member report counters on the member search page without changing report data, download behavior, or access rules.

## Design

- Replace the current tall card layout with compact horizontal rows.
- Each row contains the count, report name, and a small `Download` button.
- Keep all eight reports visible at once.
- Preserve the full report-specific accessible button name, such as `Download active members report`.
- Keep the existing loading state and disable behavior while a report is being prepared.
- On narrow screens, rows may wrap cleanly without horizontal overflow; controls retain usable touch targets.
- Reuse the existing BPT visual language: Mat Ink separators, BPT Purple actions, compact uppercase metadata, and no decorative elements.

## Scope

- Update `ReportCounters` markup in `apps/web/src/app/admin/members/search/page.tsx`.
- Add or adjust report-counter styles in the existing admin stylesheet.
- Update focused tests to assert compact row semantics and preserved accessible download names.
- Do not change callable contracts, report counts, filtering, or download implementation.

## Verification

- Focused member search tests.
- Full unit test suite.
- Web typecheck and lint.
- Static web build.
- Existing E2E smoke coverage, including mobile viewport and overflow checks.
