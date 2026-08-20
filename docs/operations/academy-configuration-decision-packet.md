# T008 Academy Configuration Decision Packet

Status: awaiting academy/operator confirmation; no value in this packet is a production constraint.

Prepared: 2026-08-19

## Decision Rules

- Published website facts are evidence, not automatically approved operational rules.
- Values marked `Pending decision` must not drive billing, capacity, booking, attendance, notifications, or authorization.
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

The DOCX sources do **not** fix a timezone, exact Open Mat times, a waitlist limit, billing date,
freeze policy, overdue grace, trial duration, discounts, or refunds. Those remain genuinely open.

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
- Waitlist limit, credit/rescheduling behavior, and any rule beyond the approved one-hour cutoff and GBP 15 Town penalty.
- Membership billing date, freeze eligibility/limit/notice, overdue grace, trial duration, discounts, and refund approval workflow.
- Payment method, invoice/receipt minimums, and local tax treatment for the later manual-finance task. Provider selection remains T010.

## Promotion Gate

After confirmation, update the provisional source and this packet with approver/date/evidence, then review:

- `docs/data/firestore-data-model.md` and any affected indexes.
- Domain contracts, fixtures, Rules, callables, and dependent tests.
- T008 evidence in `tasks.md` and the matching `Lista/Lista.js` entry.

Do not mark T008 `aprobada` from this packet alone. T011 retention/residency/deletion, T010 provider selection, and T009 head-coach evaluation criteria remain separate decisions.
