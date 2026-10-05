# Age capacity and waitlist invitations implementation plan

> Execution: inline with superpowers:executing-plans. The user explicitly requested continuous implementation after approving the spec. Project instructions override worktree, test and approval defaults.

**Goal:** Add optional exact-age capacity and member-confirmed invitations to a follow-up session.
**Architecture:** Optional session fields, one shared transactional capacity reader, separate follow-up invitation records, existing booking confirmation. No automatic booking on invitation.
**Tech Stack:** TypeScript, Next.js/React, Firebase Functions and Firestore, existing CSS tokens.
**Spec:** `docs/superpowers/specs/2026-10-05-age-capacity-waitlist-design.md`

## Global constraints

- Work on main; preserve unrelated files; commit and push scoped work.
- No automated tests or routine builds/typechecks; compile only for an authorised deployment.
- Missing age capacities preserve existing behaviour. Omitted updates preserve fields; [] removes limits.
- Owner-only configuration; existing academy, guardian, membership and payment boundaries remain.
- Existing same-session waitlist offers retain their semantics. Invitations do not hold seats.
- DESIGN.md governs mobile below 48rem, existing fonts, controls and visual tokens.

## Review focus

- Race for the final age-specific seat: shared transaction and existing capacity lock.
- Missing date of birth, birthdays and aliases: use session-local date and canonical profile.
- Existing reservations during edits and series updates: reject incompatible updates.
- Retried follow-up creation/acceptance: stable operation key and atomic booking/response.
- Legacy records, offers, guardians and specialised sessions: optional fields and unchanged boundaries.

### Task 1: Capacity contracts and server enforcement

Files: domain `schedule/age-capacity.ts`, `schedule-contracts.ts`, package exports; Functions
`schedule/age-capacity.ts`, `booking-transaction-service.ts`, `advanced-booking-service.ts`,
`schedule-service.ts`, `weekly-session-service.ts`, `schedule-callables.ts`.

Interfaces: `AgeCapacity { age: number; capacity: number }`; `parseAgeCapacities(value, total)`;
`readAgeOccupancy(...)`; `assertAgeCapacity(...)`. Optional `ageCapacities` on session inputs/records.

- [x] Add validated optional fields, preserving omitted fields and rejecting duplicate ages.
- [x] Count active bookings and unexpired traditional offers by age inside the existing transaction.
- [x] Apply enforcement to booking, offer eligibility, joining waitlist and session/series edits.
- [x] Preserve limits in creation, copies and recurrence; restrict mutation to owners.
- [x] Inspect all capacity consumers and validate the scoped diff.

### Task 2: Follow-up operations and invitations

Files: domain `schedule/waitlist-invitations.ts`; Functions `schedule/waitlist-invitations.ts`,
`admin-waitlist-groups.ts`, exports; web `lib/waitlist-invitations-client.ts`.

Interfaces: create follow-up with `{ operationId, sourceSessionId, session }`; list personal
invitations scoped by student; respond with invitation ID, response and displayed session revision.

- [x] Create a stable follow-up session and one invitation per eligible pending source entry.
- [x] Expose owner history and personal invitations through authorised callables.
- [x] Atomically confirm existing booking flow and resolve original queue; preserve wait on decline/full.
- [x] Keep pending past-session queues accessible with bounded pagination.
- [x] Inspect idempotency, concurrent source offers, cancellation and stale invitation displays.

### Task 3: Admin and member interfaces

Files: `session-panel.tsx`, new age-limit editor, `admin/waitlists/page.tsx`, new follow-up form,
`account/page.tsx`, new invitations component, calendar repository/domain/session card, associated CSS.

- [x] Add optional owner-only age rows and occupancy availability to session editor/calendar.
- [x] Add create-next-class entry per source session with existing editor reuse.
- [x] Display member invitations with date/site, accept/decline, refresh and failure states.
- [x] Adapt layouts to phone and desktop with labelled controls, focus and loading states.
- [x] Inspect empty, error, full, stale and duplicate action paths without running browser suites.

### Task 4: Compatibility review and delivery

- [x] Review all changed interfaces against existing consumers and spec requirements.
- [x] Fresh whole-change code review as required by executing-plans; no tests or deployment.
- [x] Resolve material findings, update PRODUCT.md and this plan with actual scope and limitations.
- [x] Commit scoped implementation, push origin/main, verify local and remote SHA equality.

## Execution ledger

- Spec approved by user; continuous implementation explicitly requested.
- Ruling: no extra plan approval, worktree or TDD gate, following explicit user/project instructions.
- Pre-flight: Task 2 consumes Task 1 capacity enforcement; Task 3 consumes Tasks 1/2 contracts.

- Implemented optional validated age caps in session copies/series, shared booking and offer
  transactions, member calendar projections and owner editor. No-cap paths keep existing rules.
- Implemented separate idempotent follow-up operations, bounded invitation batches, current
  membership selection at acceptance, atomic booking/source resolution and actor/time history.
- Added owner history independent of pending queues and paginated past waiting lists.
- Independent reviewer found four issues: age-full FIFO head blocked other ages, historical
  membership on acceptance, unknown occupancy shown as zero, and history coupled to pending
  queues. All four were fixed; the reviewer re-inspected and found no new material issues.
- Kept intro/private/course/seminar restrictions and original waitlist record schema. Source
  age/level restrictions remain on follow-up classes. Acceptance links the booking ID.
- Frontend gate defaults off because main auto-publishes to Cloudflare while Functions and
  indexes publish separately. Coordinated activation is documented in the runbook; no production
  activation or backend deployment was performed.
- Verification: source inspection, independent review and scoped Git diff checks. No automated
  tests, browser tests, compilation, lint or typecheck, as instructed. These reviews do not
  establish absence of all regressions or verify rendered layouts.
- Delivery: scoped commit on main and push to origin/main; SHA evidence is reported in the
  final delivery response. Unrelated local review reports and QA files are preserved.
- Subsequent operator instruction authorised production deployment. Firebase artifact and web
  production compilation passed after adding the two domain runtime import mappings. The 27
  scoped functions and three indexes were published, then the web flag was enabled and Pages
  deployment `8ce1b534-8ff5-4f54-8935-9db4a479fbf5` became canonical. Public route HTTP checks passed.
  Exact release evidence and verification limits are recorded in the deployment runbook.
