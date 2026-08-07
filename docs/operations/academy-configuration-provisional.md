# BPT Jersey Academy Configuration (Provisional)

Status: provisional; T008 remains blocked pending academy approval.

Last website consultation: 2026-08-07.

`[Published]` = copied from the public website.
`(f)` = fictitious placeholder for modeling/testing only.
`Pending approval` = must be confirmed by the academy/operator.

No `(f)` value may reach production, billing, attendance, capacity enforcement, notifications, or authorization rules.

## Sources

Consulted on 2026-08-07:

- `https://bptjersey.com/`
- `https://bptjersey.com/classes`
- `https://bptjersey.com/contact-us`
- `https://bptjersey.com/privacy-policy`

The public privacy page currently says `Privacy Policy coming soon`; this does not resolve `T011`.

## Published Configuration

### Programs

Source: `https://bptjersey.com/` and `https://bptjersey.com/classes`.

- `[Published]` Brazilian Jiu-Jitsu.
- `[Published]` MMA.
- `[Published]` Self-defence.
- `[Published]` Kids self-defence based on Brazilian Jiu-Jitsu.
- `[Published]` Beginners-only Brazilian Jiu-Jitsu.
- `[Published]` No-Gi sessions.

### Locations

Source: `https://bptjersey.com/` and `https://bptjersey.com/contact-us`.

- `[Published]` Carrefour Metro, Grenville St, St Helier, Jersey JE2 4UF.
- `[Published]` Strive Health Club, L'Avenue de la Reine Elizabeth II, St Peter, Jersey JE3 7BP.
- `[Published]` Age Concern is referenced as the new Saturday kids location; its address is not published.

### Published Schedule

The public source does not publish a timezone, session identifiers, instructor assignment per session, or capacity.

| Program/session | Day/time | Location | Source state |
|---|---|---|---|
| Kids | Tuesday and Thursday, 17:30 | Strive Health Club | `[Published]` |
| Kids under 4-6 years | Saturday, 09:00-09:45 | Age Concern | `[Published]`; address `Pending approval` |
| Kids age 7-9 | Saturday, 10:00-10:45 | Age Concern | `[Published]`; address `Pending approval` |
| Kids age 10-12 | Saturday, 11:00-12:00 | Age Concern | `[Published]`; source text says `1100-1200am`, time `Pending approval` |
| Beginners BJJ | Monday and Wednesday, 18:30-19:30 | Carrefour Metro | `[Published]` |
| BJJ | Monday, 12:00-13:00 | Carrefour Metro | `[Published]` |
| BJJ | Friday, 13:15-14:15 | Carrefour Metro | `[Published]` |
| Open mat | Friday to Sunday | Carrefour Metro | `[Published]`; exact times `Pending approval` |
| Beginners BJJ | Tuesday and Thursday, 18:30-19:30 | Strive Health Club | `[Published]` |
| No-Gi | Tuesday and Thursday, 06:00-07:00 | Carrefour Metro | `[Published]` |

### Published Prices

Source: `https://bptjersey.com/`.

- `[Published]` Carrefour Metro: `£40/month`, available only to Carrefour Metro gym members; gym access packs are referenced.
- `[Published]` BPT West/Strive: `£10/session` or `£65/month`, with the page also saying `£8 class`.
- `[Published]` Kids: `£95` once a week for the current school term.

The public page also says kids classes are only available for Carrefour Metro gym members while publishing kids classes at Strive and Age Concern. This is a contradiction and remains `Pending approval`.

## Fictitious Placeholders

These values exist only for schema modeling, local fixtures, and future test design. Each value is explicitly marked `(f)` and must be replaced before operational use.

### Operating Defaults

- Timezone: `Europe/Jersey (f)`.
- Default session status: `scheduled (f)`.
- Default booking status: `requested (f)`.
- Default membership status: `trial (f)`.
- Default currency: `GBP (f)`.

### Capacity Placeholders

- Carrefour Metro BJJ/No-Gi session capacity: `24 (f)`.
- Strive adult session capacity: `20 (f)`.
- Strive kids session capacity: `16 (f)`.
- Age Concern Saturday age-group capacity: `12 (f)` per session.
- Open mat capacity: `30 (f)`.

These are not approved safety limits.

### Membership and Booking Placeholders

- Booking opens `14 days before session (f)`.
- Cancellation cutoff `12 hours before session (f)`.
- Waitlist limit `5 people (f)`.
- Monthly membership billing date `1st of each month (f)`.
- Freeze limit `2 months per membership year (f)`.
- Freeze notice `7 days before the next billing date (f)`.
- Overdue grace period `7 days (f)`.
- Trial duration `14 days (f)`.
- Refund rule `manual review required (f)`.

These are placeholders, not recommendations or approved business rules.

## Pending Approval Register

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

## Boundary for T013

`T013` may use this document to model stable concepts and relationships. It must not encode `(f)` values as production constraints or treat `Pending approval` items as final schema invariants. Once T008 is approved, only explicitly approved values may be promoted into the data model.

T013 remains paused until the operator decides whether this provisional record is sufficient for schema modeling and the academy confirms the operational values.

## Replacement Procedure

When the academy confirms a value:

1. Replace the `(f)` value with the approved value.
2. Remove `(f)` only from that confirmed value.
3. Record approver, date, source/evidence, and any affected task.
4. Recheck dependent indexes, invariants, Rules, fixtures, and tests before promotion.
5. Never silently reinterpret a fictitious value as real.
