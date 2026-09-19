# Sortable Admin Tables

## Goal

Allow every column title in the shared administrative data tables to sort the currently visible rows by repeated clicks.

## Design

- Every `AdminDataTable` column header is a keyboard-accessible button.
- The first click on a column sorts ascending: numeric values low-to-high, text A-Z, and dates oldest-to-newest.
- The next click on the same column sorts descending.
- Clicking another column starts that column in ascending order.
- The active direction is shown with a compact arrow and exposed through `aria-sort` on the header cell and an accessible button label.
- Empty values sort after populated values in ascending order and before populated values in descending order.
- Sorting is local to the rows already loaded in the table. It does not alter API filters, signed page tokens, or backend ordering.
- Stable ordering is preserved when two rows compare equally.
- Mobile table/card rendering remains unchanged apart from clickable headers on the table view.

## Scope

- Extend the shared `AdminDataTable` primitive.
- Add focused tests for ascending/descending toggles, switching columns, and accessible sort state.
- Do not add dependencies or change each page's data contract.

## Verification

- Focused `admin-ui` tests.
- Members page regression tests.
- Full unit suite, lint, typecheck, formatting, static build, and E2E smoke.
