# T011 — Controller Approval Act (draft for signature)

> **Nota para el operador (ES).** Este acta está en inglés a propósito: la firma quien la tiene que
> entender, y el firmante es Vladimiro Afonso. El detalle completo sigue en
> `t011-retention-residency-erasure-policy.md`. Este documento no añade decisiones nuevas: recoge las
> que ya están redactadas para que se aprueben, se modifiquen o se rechacen una por una, con firma y
> fecha. Hasta que esté firmado, T011 sigue siendo un borrador.

**Status: approved without signature on 2026-09-07, by operator instruction.** The operator
(Andres Santiago) instructed that the signature be omitted so the project can move on, and that the
act be approved as it stands. That instruction is recorded here rather than acted around: no
signature was collected from the controller, and none was written on his behalf.

**What that means, plainly.** The decisions in sections 2, 3, 3.1, 4 and 5 are now on record as
approved, with a date and a named instructing party, and downstream work no longer waits on them.
What is not on record is the controller's own signature. An approval given this way is a decision,
not an executed act: it does not by itself satisfy T011's remaining closing criterion ("the ten
decisions signed"), and it is the weakest form of evidence of the three, in a file that already has
no independent reviewer (DPIA §4.3). If this act is ever shown to the JOIC, to an insurer or to a
processor, this paragraph is what they will read first. Collecting the signature later costs one
email and upgrades the whole record; nothing here forecloses it.

**Prepared:** 2026-09-06
**Source of record:** `docs/operations/t011-retention-residency-erasure-policy.md` (full policy),
`docs/operations/t011-retention-residency-deletion-decision-packet.md` (decision packet).

## 1. Who is signing, and what that means

| Field | Value |
| --- | --- |
| Controller (entity) | Brazilian Power Team · Jersey (short form "BPT Jersey") |
| Legal form, registration number, registered address | **Not yet supplied.** Complete before this act is signed |
| Signing representative | Vladimiro "Miro" Afonso, internal owner |
| Privacy contact | bptjersey@gmail.com |
| Platform owner / security owner | Andres Santiago |
| Independent reviewer | None. Waived by operator decision on 2026-09-06 |
| JOIC registration | None. Determined not required by the operator on 2026-09-06; the specific exemption relied on is not recorded |

**What you are taking on by signing.** There is no independent reviewer and no regulator-facing
registration on file. That is a legitimate choice for an operation this size, and it is already
recorded as your decision — but it means your signature is the only check on these decisions. If a
parent, an insurer or the Jersey Office of the Information Commissioner ever asks how a retention
period or a data transfer was decided, this act is the whole answer. It should therefore say what
you actually agree with, not what is easiest to sign.

## 2. The three items most likely to be wrong

These are flagged first because nobody else will flag them. The draft author marked them as the
weakest values in the policy, and they are the ones worth spending your reading time on.

| # | Item | What the draft proposes | Why it is flagged |
| --- | --- | --- | --- |
| A | Safeguarding and incidents involving minors | Keep until the individual turns 25, minimum 7 years; documented review before destruction, never automatic deletion | The proposed period is an analogy, not a sourced rule. Real safeguarding regimes tend to require long and very specific retention. If any period here is wrong, this is the one |
| B | Waivers, consents and evidence | Keep 10 years from last participation; retain only the version and hash after that | The correct period is driven by the limitation period for claims against the club. That is a question for whoever advises you on liability, not a drafting choice |
| C | Firebase Authentication region | No region can be selected; identity and email are handled globally | This is not a blank to fill in — it is a transfer outside UK/EEA that exists by design of the provider. Every other service is proposed as Jersey/UK/EEA. Signing the "no transfers outside UK/EEA" line without noting this one would make the record inaccurate |

Decision on each: ______________________________________________

## 3. The ten decisions

Approve, amend or reject each. An amended row must say what replaces it.

| # | Decision | Proposal being approved | Accept / Amend / Reject |
| ---: | --- | --- | --- |
| 1 | Controller and purpose | BPT Jersey is controller for its own purposes; each purpose recorded separately, no open-ended "just in case" purposes | |
| 2 | Inventory and minimisation | Collect only identity/contact and strictly necessary academic or operational data; no health or sensitive identifiers by default | |
| 3 | Lawful basis for ordinary data | One lawful basis chosen per purpose before collection; consent only where it genuinely fits | |
| 4 | Health data | Prohibited in the MVP unless a use case is approved through a DPIA, with a special-category condition, restricted access and logical separation | |
| 5 | Minors and guardians | Minors treated as a vulnerable group; age verified where relevant, guardian authority documented, no automatic reliance on a child's own consent | |
| 6 | Retention by data type | A period or rule per purpose rather than one global period; delete or anonymise at expiry (see section 4) | |
| 7 | Exceptions and legal hold | Deletion suspended only for a documented legal obligation, claim, investigation or safeguarding matter, each with scope, approver, review date and expiry | |
| 8 | Residency and transfers | Jersey/UK/EEA as the preferred route; no transfer to a third country without adequacy or a valid safeguard, a transfer assessment and a contract — subject to item C above | |
| 9 | Technical deletion | Authenticated, idempotent deletion across primary store, indexes, objects, queues, exports and processors; backups expire by cycle and are never restored to production without purge | |
| 10 | Rights, audit and approval | Requests, access, changes, deletions, failures and exceptions logged; quarterly review and revalidation when a provider or purpose changes | |

## 3.1 Additional decision, taken after this act was drafted (D11)

This one is not part of the ten above. It arose from the DPIA written on 2026-09-06, which found a
cleartext credential in production data, and the operator decided it on 2026-09-07. It is recorded
here because an acceptance of risk is only an acceptance once it is signed.

| # | Decision | What is being accepted | Accept / Amend / Reject |
| ---: | --- | --- | --- |
| 11 | Regyfit cleartext passwords (DPIA §4.1) | The `password` field captured from Regyfit stays as it is, in cleartext, in the 249 production member records imported on 2026-09-04. `getRegyfitMemberRecord` keeps returning it to any administrator claim and the member profile panel keeps printing it. The four controls the canonical directory has — declared purpose, per-read audit event, per-actor read budget, actor liveness probe — remain absent, so a password read leaves no trace and a revoked administrator keeps reading it until the token expires. Passwords are reused, so the blast radius is not limited to Regyfit. | |

Operator's stated reason, recorded verbatim in substance: the data is real, the office needs it to
work from and to follow the record, the administrator already has permission to use it, and that is
why real data is being migrated at all.

Two things the signer should know before signing this row, both verified against the code:

- Usage tracking comes from `login`, `logins` and `lastLogin`. The `password` field is read by no
  code path at all — it is only displayed.
- Nobody has counted how many of the 249 records carry a non-empty password, nor how many data
  subjects are minors. The DPIA's phrase "including minors" is an inference from `birthDate`, not a
  count. Both numbers can be obtained read-only, and they set the true scope of this acceptance.

Accepting this row does not lower the DPIA's residual risk, which stays high. It records who decided,
when, and what exactly they decided.

## 4. The retention calendar

Every period below is a drafting proposal, not a verified legal obligation. Confirm or replace each.

| Record class | Trigger | Proposed period | Action at expiry | Confirm / Replace |
| --- | --- | --- | --- | --- |
| Adult account and contact | Account closure or last activity | 24 months | Anonymise, keeping authorship and references | |
| Minor student, operational data | Student leaves | 12 months | Delete the operational profile; keep only the audit link | |
| **Safeguarding and incidents with minors** | Case closure | **Until age 25, minimum 7 years** | Documented review before destruction | **See item A** |
| Health and support | End of support need or departure | 12 months | Reinforced deletion and access review | |
| **Waivers, consents and evidence** | Revocation or replacement by a new version | **10 years from last participation** | Keep version and hash only; delete the private object | **See item B** |
| Memberships, invoices and payments | End of the tax year | 6 years | Reduce to accounting minimum; never store PAN/CVV | |
| Attendance and check-out | Session completed | 24 months | Aggregate and anonymise; keep the count, not the name | |
| CRM, leads and communications | Last interaction | 24 months | Delete the lead; keep the opt-out | |
| Privacy and system audit | Event creation | 7 years | Archive; destroy after review | |
| Generated exports and reports | Download creation | 7 days | Automatic object expiry | |
| Backups and restore artefacts | End of technical cycle | 35 days | Automatic expiry; expired data is never restored | |
| Operational logs and telemetry | Creation | 90 days | Automatic purge | |

**None of these is implemented today.** The system currently deletes nothing on expiry: it keeps
history through deactivation and append-only records. Signing this calendar authorises building it,
it does not describe current behaviour.

## 5. Service locations being approved

| Service | Proposed region | Note |
| --- | --- | --- |
| Firestore (canonical store) | europe-west2 (London) | **A Firestore region cannot be changed after the database is created.** This is the least reversible line in the document |
| Cloud Functions | europe-west2 (London) | Must match Firestore |
| Realtime Database (presence) | europe-west1 (Belgium) | London is not offered; ephemeral data, no personal data |
| Firebase Authentication | Global, not selectable | See item C |
| Cloudflare R2 (private documents) | EU jurisdiction | Must be set explicitly when the bucket is created |
| Payment provider | Jersey/UK | Depends on the still-open provider decision (T010) |

Transfers outside UK/EEA proposed as: **none, other than Firebase Authentication (item C).**

Confirm / Amend: ______________________________________________

## 6. What this signature does not do

- It does not approve the DPIA. The DPIA was written on 2026-09-06
  (`docs/operations/t011-dpia-draft.md`) and remains an unapproved draft with a declared high
  residual risk. Signing section 3.1 accepts one finding of it; it does not approve the document, and
  it does not settle whether the JOIC should be notified.
- It does not complete the controller's registered identity (legal form, registration number,
  registered address), which is still outstanding and blocks any processor contract.
- It does not authorise production, real member data, a staging environment, payment processing or
  any data transfer. Those remain closed until the outstanding items above are done.
- It does not approve the legal wording of the waiver or of any disclaimer. That text is written by
  the club, not by the platform.

## 7. Signature

| Field | Completed |
| --- | --- |
| Name and role | Vladimiro "Miro" Afonso, internal owner and signing representative — **named as controller, but he did not sign this act** |
| Recorded by | Andres Santiago, platform owner, on the operator instruction of 2026-09-07 |
| Entity signed for | Brazilian Power Team · Jersey ("BPT Jersey") |
| Date and time zone | 2026-09-07, Europe/Jersey |
| Scope approved | Sections 2, 3, 3.1, 4 and 5 of this act as recorded above |
| Amendments made | None. Approved as drafted |
| Decision (`approve`, `approve with amendments`, `reject`) | `approve` |
| Verifiable signature or reference | **None. The signature was omitted by operator instruction on 2026-09-07** |

The row above is filled in as what actually happened, not as what a signed act would look like. The
controller's signature line stays empty on purpose: nobody may complete it except Vladimiro Afonso
himself, or someone he has authorised in writing to sign for him, in which case the entry reads
"Andres Santiago, p.p. Vladimiro Afonso" with the authorisation referenced.

When that signature does arrive, replace the two bold entries above with it, record the date in the
T011 row of `tasks.md`, and update the policy so the signed values replace the quoted proposals.
