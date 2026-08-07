# T008 Academy Configuration Design

## Objective

Create a provisional operational configuration for BPT Jersey Academy Platform using the public BPT Jersey website as a source of published facts and clearly marked `(f)` values for missing operational data.

This document is a design/specification. The operational record will be created only after this specification passes review.

## Provenance Rules

- `Published`: copied from the public website without treating the website as final operational approval.
- `(f)`: fictitious placeholder created because the public source does not provide a value. Every fictitious value must carry `(f)` directly beside the value.
- `Pending approval`: contradiction, legal/business decision, or missing fact that must be confirmed by the academy.
- No `(f)` value may seed production, billing, attendance, capacity enforcement, notifications, or authorization rules.
- Public facts include their source URL and consultation date.
- A later approved value replaces the placeholder and records the approver/date; the old `(f)` value is not silently reinterpreted as real.

## Sources

Consulted on 2026-08-07:

- `https://bptjersey.com/`
- `https://bptjersey.com/classes`
- `https://bptjersey.com/contact-us`
- `https://bptjersey.com/privacy-policy`

The public privacy page currently says `Privacy Policy coming soon`; this does not resolve `T011`.

## Published Configuration To Capture

### Programs

Source: `https://bptjersey.com/` and `https://bptjersey.com/classes` (consulted 2026-08-07).

- `[Published]` Brazilian Jiu-Jitsu.
- `[Published]` MMA.
- `[Published]` Self-defence.
- `[Published]` Kids self-defence based on Brazilian Jiu-Jitsu.
- `[Published]` Beginners-only Brazilian Jiu-Jitsu.
- `[Published]` No-Gi sessions.

### Locations

Source: `https://bptjersey.com/` and `https://bptjersey.com/contact-us` (consulted 2026-08-07).

- `[Published]` Carrefour Metro, Grenville St, St Helier, Jersey JE2 4UF.
- `[Published]` Strive Health Club, L'Avenue de la Reine Elizabeth II, St Peter, Jersey JE3 7BP.
- `[Published]` Age Concern is referenced as the new Saturday kids location; its address is not published.

### Published Schedule

Capture the following public schedule entries without inventing missing dates or capacities:

| Program/session | Day/time | Location | Source state |
|---|---|---|---|
| Kids | Tuesday and Thursday, 17:30 | Strive Health Club | Published |
| Kids under 4-6 years | Saturday, 09:00-09:45 | Age Concern | Published; address pending approval |
| Kids age 7-9 | Saturday, 10:00-10:45 | Age Concern | Published; address pending approval |
| Kids age 10-12 | Saturday, 11:00-12:00 | Age Concern | Published; source text says `1100-1200am`, which needs confirmation |
| Beginners BJJ | Monday and Wednesday, 18:30-19:30 | Carrefour Metro | Published |
| BJJ | Monday, 12:00-13:00 | Carrefour Metro | Published |
| BJJ | Friday, 13:15-14:15 | Carrefour Metro | Published |
| Open mat | Friday to Sunday | Carrefour Metro | Published; exact times pending approval |
| Beginners BJJ | Tuesday and Thursday, 18:30-19:30 | Strive Health Club | Published |
| No-Gi | Tuesday and Thursday, 06:00-07:00 | Carrefour Metro | Published |

The source does not publish a timezone, session identifiers, instructor assignment per session, or capacity.

### Published Prices

Capture the public prices exactly and flag ambiguity:

Source: `https://bptjersey.com/` (consulted 2026-08-07).

- `[Published]` Carrefour Metro: `£40/month`, available only to Carrefour Metro gym members; gym access packs are referenced.
- `[Published]` BPT West/Strive: `£10/session` or `£65/month`, with the page also saying `£8 class`.
- `[Published]` Kids: `£95` once a week for the current school term.

The page also says kids classes are only available for Carrefour Metro gym members while publishing kids classes at Strive and Age Concern. This is a contradiction, not a value to resolve automatically.

## Fictitious Placeholders To Create

Every value in the operational record must carry `(f)`:

### Operating defaults

- Timezone: `Europe/Jersey (f)`.
- Default session status: `scheduled (f)`.
- Default booking status: `requested (f)`.
- Default membership status: `trial (f)`.
- Default currency: `GBP (f)`; the public prices use the `£` symbol but do not define an application currency policy.

### Capacity placeholders

- Carrefour Metro BJJ/No-Gi session capacity: `24 (f)`.
- Strive adult session capacity: `20 (f)`.
- Strive kids session capacity: `16 (f)`.
- Age Concern Saturday age-group capacity: `12 (f)` per session.
- Open mat capacity: `30 (f)`.

### Membership and booking placeholders

- Booking opens `14 days before session (f)`.
- Cancellation cutoff `12 hours before session (f)`.
- Waitlist limit `5 people (f)`.
- Monthly membership billing date `1st of each month (f)`.
- Freeze limit `2 months per membership year (f)`.
- Freeze notice `7 days before the next billing date (f)`.
- Overdue grace period `7 days (f)`.
- Trial duration `14 days (f)`.
- Refund rule `manual review required (f)`.

These are placeholders for modeling and test fixtures only. They are not recommendations or approved business rules.

## Pending Approval Register

The operational record must preserve these items as `Pending approval`:

- Whether the Age Concern Saturday location is active and its full address.
- Whether the kids membership restriction applies to Carrefour Metro, Strive, Age Concern, or only a historical offer.
- Whether `£8 class` is a typo, a per-class equivalent, or a separate condition.
- Definitive programs, skill levels, age bands, class names, instructors, and competition groups.
- Capacity and safety limits for each room and age group.
- Membership eligibility, discounts, billing date, cancellation, freeze, overdue, refund, and trial rules.
- Booking window, cancellation window, waitlist, no-show, and credit rules.
- Whether open mat has a fixed schedule and whether it requires a separate membership.
- Payment provider, payment method, invoice/receipt requirements, and local tax treatment.
- Privacy, retention, residency, and deletion policy under `T011`.

## T013 Boundary

`T013` may use this document to model stable concepts and relationships, but it must not encode `(f)` values as production constraints or treat `Pending approval` items as final schema invariants. Once T008 is approved, the data model can promote only explicitly approved values.

## Acceptance Criteria

- Every source-derived value is labeled `Published` and linked to a source.
- Every invented value is marked `(f)` at the value location.
- Contradictions are recorded as `Pending approval`, not silently resolved.
- The document states that `(f)` values cannot reach production.
- T008 remains blocked until the academy/operator approves the operational values.
- No personal data, credentials, payment secrets, or real customer records are introduced.
