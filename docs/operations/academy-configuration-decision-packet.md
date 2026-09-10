# T008 Academy Configuration Decision Packet

Status: review; temporary synthetic placeholder awaiting academy/operator confirmation. No value
in this packet is a production constraint.

Prepared: 2026-08-19

Updated: 2026-08-25

## Decision Rules

- Published website facts are evidence, not automatically approved operational rules.
- Values marked `Pending decision` must not drive billing, capacity, booking, attendance, notifications, or authorization.
- Values marked `Proposed for synthetic pilot` are reversible defaults only. They become valid for
  that pilot only after the operator explicitly approves them.
- The approved DOCX sources govern the MVP membership catalogue and Town/West product rules; this packet does not override them.
- Once a value is confirmed, record approver, date, source, and affected tasks before promoting it into code or fixtures.

## Explicitly Fixed By The DOCX

- Operational premises: BPT West and BPT Town.
- Membership catalogue, prices, access sites, weekly limits, and open-mat charges: the ten plans in
  `BPT-memberships.docx`, reflected in `BRIEF.md` and `docs/data/firestore-data-model.md`.
- Booking/cancellation cutoff: one hour before the session, including Open Mats, per the final
  correction recorded in `BPTJ FUNCTIONS APP.docx` and `BRIEF.md`.
- Town no-show: manual auditable GBP 15 penalty; claims go to the office/Miro as specified by the
  DOCX wording.
- Class minimum: four booked members one hour before start; a coach may choose a higher minimum and
  booked members receive an in-app cancellation notification if it is not met.
- Capacity: the class creator chooses whether a class has a maximum and enters it when creating the
  class; the DOCX does not provide one fixed numeric capacity per room.
- PAYG arrears: the next booking requires payment for the new session and the unpaid prior session.
- Under-18 registration requires parent/legal-tutor contact data and disclaimer signature.

## Reconciled Facts From The Real DOCX Sources

Reviewed read-only on 2026-08-25:
F:\Proyectos\BPT Jersey\Varios\BPT-memberships.docx and F:\Proyectos\BPT Jersey\Varios\BPTJ FUNCTIONS APP.docx.

The membership DOCX fixes these real catalogue rules:

| Plan                            | Real price/rule from DOCX                                          |
| ------------------------------- | ------------------------------------------------------------------ |
| Pay as you go                   | GBP 10 per session                                                 |
| BPT Jersey Adults Monthly       | GBP 125/month; full access to Town and West classes/Open Mats      |
| West Kids school-term 1 class   | GBP 95/month; one class/week and West Open Mats; no Town Open Mats |
| West Kids school-term 2 classes | GBP 115/month; two classes/week and Town Open Mats                 |
| West Adults Monthly             | GBP 65/month; unlimited West classes/Open Mats and Town Open Mats  |
| West Teens Monthly              | GBP 45/month; two classes/week in adult class                      |
| Town Adults                     | GBP 85/month; unlimited Town classes/Open Mats                     |
| Town Kids 1 class               | GBP 95/month; one class/week                                       |
| Town Kids 2 classes             | GBP 135/month; two classes/week and unlimited Open Mats            |
| Town Teens Monthly              | GBP 45/month; two classes/week in adult class                      |
| Open Mat booking fee            | GBP 7.50 per session where the plan requires it                    |

The functions DOCX also fixes or describes: Town and West premises; one-hour booking/cancellation cutoff
including Open Mats; Town no-show penalty of GBP 15 on the next booking; four booked members one hour
before class with coach-selectable higher minimum; creator-selected maximum or no maximum capacity;
PAYG arrears paid with the next booking; parent/legal-tutor data and disclaimer for under-18 members;
medical/support text capped at 1000 characters; gym choice and training-time preferences; QR/manual
clock-in with a 50-metre proximity rule; coach curriculum notes; and the belt/stripe thresholds recorded
in the T009 packet. These facts are source-backed, not invented placeholders.

Source conflict to keep open: the functions DOCX routes Town no-show claims to Miro in one paragraph and
to the office in another. Do not encode either destination as an automated workflow until the operator
confirms the owner. The DOCX does not provide timezone, exact class/Open Mat times, instructor names,
concrete capacities, billing date, freeze/overdue/trial policy, discounts, refunds, or payment provider;
those missing values may use (f) placeholders only in isolated staging.

The DOCX sources do **not** fix a timezone, exact Open Mat times, a waitlist limit, billing date,
freeze policy, overdue grace, trial duration, discounts, or refunds. Those remain genuinely open.

## Pilot Scope Already Fixed By BRIEF

The following items do not need a numeric policy to run the controlled synthetic pilot:

- Waitlists, booking credits, and advanced rescheduling belong to v2. They are `not applicable` in
  the MVP pilot; the approved one-hour booking/cancellation cutoff remains the only cutoff.
- Online payments, provider checkout, payment webhooks, automated refunds, and tax automation are
  outside the MVP. The pilot records synthetic manual-finance scenarios only.
- No real customer payment, tax, invoice, receipt, or personal data is authorized by this packet.
- A real payment provider remains a separate post-pilot decision under `T010`.

## Non-Binding Website Facts Not Fixed By The DOCX

| Area               | Observed value                                                  | Treatment                                                                       |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Saturday kids site | Website names Age Concern but omits its full address            | Keep outside the DOCX contract until separately confirmed                       |
| Kids eligibility   | Website copy conflicts with its own location/membership wording | Use the explicit membership DOCX access rules; do not infer an Age Concern rule |
| Public price copy  | Website contains `£8 class` alongside other prices              | Ignore as non-binding; the membership DOCX governs the catalogue                |
| Open Mat           | Website mentions Friday-Sunday without exact times              | Do not invent times; configure them only after an operational decision          |
| Published schedule | Website lacks timezone and stable operational identifiers       | Do not convert it into backend constraints                                      |

## Remaining Operational Values To Confirm

Provide one value per item, or explicitly mark it `not applicable`:

- Timezone for all session times.
- Class/program names, age bands, skill levels, and instructor assignment policy.
- The numeric capacity entered for each concrete class; the DOCX only fixes that capacity is asked at class creation.
- Open Mat exact schedule; access eligibility is already fixed by the membership DOCX per plan.
- Membership billing date, freeze eligibility/limit/notice, overdue grace, trial duration, discounts, and refund approval workflow.
- Whether the synthetic-pilot commercial defaults below are acceptable.

## Proposed Reversible Defaults For The Synthetic Pilot

These values match the implemented boundaries and minimize irreversible policy. Their status is
`Proposed for synthetic pilot`, not approved:

| ID       | Proposed value                                                                                                                                                | Why this is the minimum safe route                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| T008-P01 | Use IANA timezone `Europe/Jersey` for Town, West, class recurrence, staff availability, and Playwright pilot runs.                                            | Handles Jersey daylight-saving changes and matches the current synthetic schedule runtime.                               |
| T008-P02 | Require at least one assigned instructor and a positive integer capacity on every concrete class/Open Mat; the academy supplies both values per row.          | The platform already enforces concrete capacity; a global room limit would invent a safety rule absent from the DOCX.    |
| T008-P03 | Use each membership's informational `nextBillingAt`; do not create a global billing day or automatic charge.                                                  | The MVP finance contract is manual and `nextBillingAt` is not a payment instruction.                                     |
| T008-P04 | Allow owner/administrator to move memberships manually through the existing audited `paused` and `overdue` states; apply no automatic freeze or grace period. | Exercises the implemented lifecycle without inventing entitlement periods or collection policy.                          |
| T008-P05 | Permit synthetic `trial` memberships with no automatic expiry; an owner/administrator explicitly activates or cancels them.                                   | Trial duration is not fixed and the existing state transition remains human-controlled.                                  |
| T008-P06 | Apply no discounts and execute no refunds in the synthetic pilot. Any later real workflow requires a separately approved rule and auditable implementation.   | Discounts/refunds are not implemented by the canonical manual-finance boundary and must not be simulated as real money.  |
| T008-P07 | For synthetic finance cases, use only the implemented methods `cash`, `bank_transfer`, or `other`, in GBP; make no tax or statutory receipt claim.            | Tests the manual ledger without selecting a provider, processing money, or making an unreviewed Jersey compliance claim. |

If these defaults are approved, they apply only to Emulator/isolated staging with synthetic or
sanitized data. Production and real financial operations remain unauthorized.

If `T008-P02` is rejected because an operational class must be unlimited, `T026` must return to
review: the current contract requires a positive capacity. Do not encode an artificial high number
as a substitute for an unlimited class.

## Operator Schedule And Capacity Response

Complete one row for every recurring class. Use one row per site/time combination. `Minimum` may
be left as `4`; enter a higher value only where the authorized coach has decided it.

| Site (Town/West) | Class/program name | Age band | Skill level | Instructor(s) | Day(s) | Local start-end | Capacity | Minimum if >4 |
| ---------------- | ------------------ | -------- | ----------- | ------------- | ------ | --------------- | -------- | ------------- |
|                  |                    |          |             |               |        |                 |          |               |

Complete Open Mats separately because their exact times and instructor assignment are not fixed:

| Site (Town/West) | Day | Local start-end | Instructor(s) | Capacity | Minimum if >4 |
| ---------------- | --- | --------------- | ------------- | -------- | ------------- |
|                  |     |                 |               |          |               |

### Fictitious Pilot Draft (replace before acceptance)

The following schedule is invented solely to unblock synthetic Emulator/isolated-staging scenarios.
Every value in this section is `(f)`; the instructor labels are not real staff identities and must
be replaced or removed before any operational use.

| Site | Class/program name (f)     | Age band | Skill level  | Instructor (f) | Day(s)  | Local start-end | Capacity (f) | Minimum |
| ---- | -------------------------- | -------- | ------------ | -------------- | ------- | --------------- | ------------ | ------- |
| Town | Adult BJJ Fundamentals (f) | adult    | fundamentals | Coach Alex (f) | Mon/Wed | 18:30-19:30     | 20           | 4       |
| Town | Adult BJJ Advanced (f)     | adult    | advanced     | Coach Maya (f) | Tue/Thu | 19:30-20:30     | 18           | 4       |
| Town | Teens BJJ (f)              | teens    | all-levels   | Coach Alex (f) | Sat     | 10:00-11:00     | 16           | 4       |
| Town | Kids BJJ 8-11 (f)          | kids     | all-levels   | Coach Maya (f) | Sat     | 11:30-12:30     | 16           | 4       |
| West | Kids BJJ 4-7 (f)           | kids     | all-levels   | Coach Maya (f) | Mon/Wed | 16:00-17:00     | 12           | 4       |
| West | Kids BJJ 8-11 (f)          | kids     | all-levels   | Coach Alex (f) | Tue/Thu | 17:00-18:00     | 16           | 4       |
| West | Adult BJJ Fundamentals (f) | adult    | fundamentals | Coach Alex (f) | Tue/Thu | 18:30-19:30     | 20           | 4       |
| West | Adult BJJ Advanced (f)     | adult    | advanced     | Coach Maya (f) | Sat     | 09:00-10:00     | 18           | 4       |

| Site | Session (f)  | Day | Local start-end | Instructor (f) | Capacity (f) | Minimum |
| ---- | ------------ | --- | --------------- | -------------- | ------------ | ------- |
| Town | Open Mat (f) | Sat | 12:00-13:00     | Coach Alex (f) | 24           | 4       |
| Town | Open Mat (f) | Sun | 10:00-11:00     | Coach Maya (f) | 24           | 4       |
| West | Open Mat (f) | Fri | 19:00-20:00     | Coach Alex (f) | 24           | 4       |
| West | Open Mat (f) | Sun | 11:00-12:00     | Coach Maya (f) | 24           | 4       |

The draft assumes `Europe/Jersey`, four as the minimum booking threshold, and the membership
eligibility already fixed in `BRIEF.md`. It does not approve a location, instructor, capacity,
schedule, or commercial policy; the operator must confirm or edit every row.

The membership catalogue already determines who may access each site's Open Mats and whether the
GBP 7.50 fee applies. Do not restate or change that eligibility in this table.

## Temporary Synthetic Placeholder

The operator requested invented values to keep the controlled synthetic pilot moving. T008-P01..T008-P07
and the (f) schedule above are provisionally usable only in Emulator/isolated staging with synthetic
or sanitized data. They may be changed or removed without a production migration. They are not real
academy data, staff identities, commercial approval, or authorization for the live academy, legal/HR
use, billing, or production deployment. Replace this block and the (f) rows with an explicit
operator/academy response before any operational promotion.

## Minimum Operator Reply

T008 can be closed for the synthetic pilot with one reply in this shape:

```text
Timezone: Europe/Jersey [approved / replace with ...]
Synthetic defaults T008-P01..T008-P07: [approved / list changes]
Classes:
- Town | <name> | <age band> | <level> | <instructor> | <day> | <start-end> | <capacity> | <minimum or 4>
Open Mats:
- West | <day> | <start-end> | <instructor> | <capacity> | <minimum or 4>
Approver/role: <name or operator role>
```

Add as many class and Open Mat rows as required. No credentials, customer names, payment details, or
other personal data should be included.

## Promotion Gate

After confirmation, update the provisional source and this packet with approver/date/evidence, then review:

- `docs/data/firestore-data-model.md` and any affected indexes.
- Domain contracts, fixtures, Rules, callables, and dependent tests.
- T008 evidence in `tasks.md` and the matching `Lista/Lista.js` entry.

Do not mark T008 `aprobada` from this packet alone. T011 retention/residency/deletion, T010 provider selection, and T009 head-coach evaluation criteria remain separate decisions.
