# Visible Administrative Panel Delivery Design

## Goal

Replace the current data-free administrative placeholder with a visible, navigable
administrative workspace that reflects the replicated legacy page and the requested BPT
Jersey operational modules. This phase prioritizes a client-presentable frontend vertical
slice. Existing backend security and member contracts remain in place, but no real member
data is imported as part of this phase.

## Source Of Truth

- The replicated legacy page defines the member fields, search filters, report actions, and
  quick-action concepts.
- `BRIEF.md` defines the academy operations scope and English UI requirement.
- Existing member contracts and tests define the already-approved member data boundary.
- The screenshots define the visual interaction language: compact dark toolbar, icon actions
  with tooltips, dense operational tables, and direct actions.

## Phase 1 Scope

### Administrative Shell

- Keep the BPT Jersey identity, responsive layout, keyboard navigation, and authenticated gate.
- Replace placeholder-only navigation with real routes:
  - `Overview`
  - `Members`
  - `Groups / Teams`
  - `Activities`
  - `Attendance`
  - `Reports`
  - `CRM`
  - `Finance`
  - `Regyfit Access Records`
- Add a compact quick-action toolbar matching the replicated page concepts:
  - `Add new member`
  - `Search members`
  - `Groups / teams`
  - `Create / manage activities`
  - `Attendance`
  - `Finance`
  - `Reports`
- Every icon action has a visible accessible label and tooltip. Icons use SVG or existing image
  assets, never emoji glyphs.

### Overview

- Show a real dashboard composition rather than empty module cards.
- Include synthetic clearly-labelled operational data for:
  - Today's classes and capacity.
  - Present, late, absent, and no-show attendance.
  - Active members and memberships needing attention.
  - Outstanding payments.
  - Recent operational actions.
- Include primary actions linking to the corresponding modules.

### Members

- Preserve the replicated member fields:
  - Membership number.
  - Name.
  - Email.
  - ID card number.
  - VAT number.
  - Birth date.
  - Mobile number.
  - Frequency.
  - Payment/status.
  - Gender.
  - Training center.
- Preserve all eleven approved search controls:
  - Membership number.
  - Name.
  - Email.
  - ID card number.
  - VAT number.
  - Mobile number.
  - Frequency.
  - Payment or status.
  - Gender.
  - Training center.
  - Order by.
- Preserve pagination, report counters, report download actions, loading, empty, and error
  states.
- Add a visible member list landing state with synthetic rows, filters, and a member detail
  drawer/page. Synthetic data must not be presented as imported production data.
- Keep `Add member` as a separate real route with the existing validation contract.
- Keep PDF import available as a separate workflow, paused from the visible dashboard flow.

### Groups / Teams

- List groups with name, program, coach, age/skill band, schedule, capacity, and member count.
- Provide visible actions for create, view, edit, and assign members using synthetic state.
- Include filters for program, coach, status, and training center.

### Activities

- Provide list and calendar-oriented views for classes/activities.
- Show activity name, program, coach, date/time, location, capacity, booked count, and status.
- Provide create/manage action with fields for schedule, coach, capacity, location, and status.

### Attendance

- Show the selected day's sessions and roster.
- Support visible states for present, late, absent, and no-show.
- Include search/filter by session, group, coach, and attendance state.
- Preserve a clear operational path to check-in and correction review; no silent data mutation.

### Finance

- Provide a visible finance dashboard at `/admin/finance`.
- Show membership revenue summary, active memberships, overdue balances, recent payments, and
  payment status filters.
- Include invoices/receipts and payment history as presentation-ready states.
- Do not implement a payment provider or charge a card in this phase.

### Reports

- Provide report cards for members, attendance, memberships, finance, CRM, and progress.
- Preserve existing member report counters/download behavior.
- Show filter and export affordances with safe synthetic previews where backend data is not yet
  connected.

## Deferred From Phase 1

- Real import of the eight Regyfit PDFs.
- Production member data.
- Payment provider selection, card capture, hosted checkout, and webhooks.
- Destructive operations and production deployment.
- Full CRM persistence and automated communications.
- Full backend persistence for groups, activities, attendance, finance, and reports. These are
  designed with contracts and mockable service boundaries so they can be connected incrementally.

## Visual Direction

- Preserve the existing BPT purple, mat-ink, white, and canvas palette in `STACK.md`.
- Keep Barlow Condensed for display headings and Source Sans 3 for controls and dense data.
- Use a dark compact action strip inspired by the replicated page, with tooltips and clear focus
  states.
- Use asymmetric operational panels and dense tables instead of a grid of empty generic cards.
- Avoid gradients, placeholder-only cards, decorative metric mosaics, and invented product data.
- Responsive behavior must remain usable at desktop and mobile widths.

## Data And Safety

- Synthetic fixtures are local to the UI preview and labelled in code/tests as synthetic.
- No secrets, real PDFs, real member records, or production identifiers enter fixtures, logs,
  screenshots, or the repository.
- Existing authentication, tenant scope, callable boundaries, server validation, and Firestore
  Rules remain authoritative.
- Any future write action must use a server-owned contract and explicit confirmation for sensitive
  operations.

## Acceptance Criteria

- `/admin` visibly renders a usable dashboard with operational content and no `Not yet imported`
  placeholder modules as the primary experience.
- The sidebar and quick-action toolbar expose every Phase 1 module and route.
- Members preserves the eleven approved filters and all replicated fields.
- Groups, Activities, Attendance, Finance, and Reports each have a real screen with appropriate
  controls, tables/cards, states, and navigation.
- The existing member add/search/import contracts remain covered and do not regress.
- Keyboard navigation, accessible names, focus states, responsive layout, and reduced-motion
  behavior are tested.
- Unit tests, typecheck, lint, format, build, Rules, and Playwright smoke pass before handoff.
