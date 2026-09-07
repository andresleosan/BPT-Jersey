# T011 — Controller Approval Act

> **Nota para el operador (ES).** Este acta está en inglés a propósito: la firma quien la tiene que
> entender, y el firmante es Vladimiro Afonso. El detalle completo sigue en
> `t011-retention-residency-erasure-policy.md`. Este documento no añade decisiones nuevas: recoge las
> que ya están redactadas para que se aprueben, se modifiquen o se rechacen una por una, con firma y
> fecha.

**Status: signed on 2026-09-07, per procurationem.** The operator (Andres Santiago) instructed on
2026-09-07 that the act be closed with the signature in Vladimiro Afonso's name. It is recorded in
the form this document already prescribed for that case (§7): **Andres Santiago, p.p. Vladimiro
Afonso**, with the authorisation referenced. Sections 2, 3, 3.1, 4 and 5 are approved as drafted.

**What that means, plainly, and what it is not.** The ten decisions are now signed, which closes the
second of T011's two remaining closing criteria. The signature is a typed attestation made by the
platform owner in the controller's name on the controller's instruction; the written authorisation
from Vladimiro Afonso is referenced below as the operator's instruction of 2026-09-07 and is not
itself a document on file. A reader who needs the controller's own hand — an insurer, a processor,
the Jersey Office of the Information Commissioner — will see that distinction here rather than have
to discover it. Upgrading it costs one signature from Vladimiro on this same file; nothing here
forecloses that, and §7 says exactly how to record it.

**Prepared:** 2026-09-06 · **Signed:** 2026-09-07
**Source of record:** `docs/operations/t011-retention-residency-erasure-policy.md` (full policy),
`docs/operations/t011-retention-residency-deletion-decision-packet.md` (decision packet).

## 1. Who is signing, and what that means

| Field                                               | Value                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Controller (entity)                                 | Brazilian Power Team · Jersey (short form "BPT Jersey")                                                       |
| Legal form, registration number, registered address | **Still not supplied.** The one closing criterion of T011 that this signature does not satisfy (see §6)       |
| Signing representative                              | Vladimiro "Miro" Afonso, internal owner                                                                       |
| Signed by                                           | Andres Santiago, p.p. Vladimiro Afonso, on the instruction of 2026-09-07                                      |
| Privacy contact                                     | bptjersey@gmail.com                                                                                           |
| Platform owner / security owner                     | Andres Santiago                                                                                               |
| Independent reviewer                                | None. Waived by operator decision on 2026-09-06                                                               |
| JOIC registration                                   | None. Determined not required by the operator on 2026-09-06; the specific exemption relied on is not recorded |

**What was taken on by signing.** There is no independent reviewer and no regulator-facing
registration on file. That is a legitimate choice for an operation this size, and it is already
recorded as a decision — but it means this signature is the only check on these decisions. If a
parent, an insurer or the Jersey Office of the Information Commissioner ever asks how a retention
period or a data transfer was decided, this act is the whole answer.

## 2. The three items most likely to be wrong

These are flagged first because nobody else will flag them. The draft author marked them as the
weakest values in the policy, and they remain flagged after signature: signing them does not verify
them.

| #   | Item                                        | What the draft proposes                                                                                    | Why it is flagged                                                                                                                                                               |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Safeguarding and incidents involving minors | Keep until the individual turns 25, minimum 7 years; documented review before destruction, never automatic | The proposed period is an analogy, not a sourced rule. Real safeguarding regimes tend to require long and very specific retention. If any period here is wrong, this is the one |
| B   | Waivers, consents and evidence              | Keep 10 years from last participation; retain only the version and hash after that                         | The correct period is driven by the limitation period for claims against the club. That is a question for whoever advises on liability, not a drafting choice                   |
| C   | Firebase Authentication region              | No region can be selected; identity and email are handled globally                                         | Not a blank to fill in: a transfer outside UK/EEA that exists by design of the provider. Every other service is proposed as Jersey/UK/EEA                                       |

**Decision on each (2026-09-07): A, B and C accepted as proposed.** A and B are accepted as working
periods, on the record that they are analogies and not sourced obligations; either is replaced
without reopening this act if advice says otherwise. C is accepted as an acknowledged transfer, so
the "no transfers outside UK/EEA" line in §5 reads with that exception rather than inaccurately.

## 3. The ten decisions

|   # | Decision                       | Proposal being approved                                                                                                                                                               | Accept / Amend / Reject |
| --: | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
|   1 | Controller and purpose         | BPT Jersey is controller for its own purposes; each purpose recorded separately, no open-ended "just in case" purposes                                                                | **Accept**              |
|   2 | Inventory and minimisation     | Collect only identity/contact and strictly necessary academic or operational data; no health or sensitive identifiers by default                                                      | **Accept**              |
|   3 | Lawful basis for ordinary data | One lawful basis chosen per purpose before collection; consent only where it genuinely fits                                                                                           | **Accept**              |
|   4 | Health data                    | Prohibited in the MVP unless a use case is approved through a DPIA, with a special-category condition, restricted access and logical separation                                       | **Accept**              |
|   5 | Minors and guardians           | Minors treated as a vulnerable group; age verified where relevant, guardian authority documented, no automatic reliance on a child's own consent                                      | **Accept**              |
|   6 | Retention by data type         | A period or rule per purpose rather than one global period; delete or anonymise at expiry (see section 4)                                                                             | **Accept**              |
|   7 | Exceptions and legal hold      | Deletion suspended only for a documented legal obligation, claim, investigation or safeguarding matter, each with scope, approver, review date and expiry                             | **Accept**              |
|   8 | Residency and transfers        | Jersey/UK/EEA as the preferred route; no transfer to a third country without adequacy or a valid safeguard, a transfer assessment and a contract — subject to item C                  | **Accept**              |
|   9 | Technical deletion             | Authenticated, idempotent deletion across primary store, indexes, objects, queues, exports and processors; backups expire by cycle and are never restored to production without purge | **Accept**              |
|  10 | Rights, audit and approval     | Requests, access, changes, deletions, failures and exceptions logged; quarterly review and revalidation when a provider or purpose changes                                            | **Accept**              |

All ten accepted as drafted on 2026-09-07. No amendments.

## 3.1 Additional decision, taken after this act was drafted (D11)

This one is not part of the ten above. It arose from the DPIA written on 2026-09-06, which found a
cleartext credential in production data, and the operator decided it on 2026-09-07.

|   # | Decision                                | What is being accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Accept / Amend / Reject |
| --: | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
|  11 | Regyfit cleartext passwords (DPIA §4.1) | The `password` field captured from Regyfit stays as it is, in cleartext, in the 249 production member records imported on 2026-09-04. `getRegyfitMemberRecord` keeps returning it to any administrator claim and the member profile panel keeps printing it. The four controls the canonical directory has — declared purpose, per-read audit event, per-actor read budget, actor liveness probe — remain absent, so a password read leaves no trace and a revoked administrator keeps reading it until the token expires. Passwords are reused, so the blast radius is not limited to Regyfit. | **Accept**              |

Operator's stated reason, recorded verbatim in substance: the data is real, the office needs it to
work from and to follow the record, the administrator already has permission to use it, and that is
why real data is being migrated at all.

Two things the signer should know, both verified against the code:

- Usage tracking comes from `login`, `logins` and `lastLogin`. The `password` field is read by no
  code path at all — it is only displayed.
- Nobody has counted how many of the 249 records carry a non-empty password, nor how many data
  subjects are minors. The DPIA's phrase "including minors" is an inference from `birthDate`, not a
  count. Both numbers can be obtained read-only, and they set the true scope of this acceptance.

Accepting this row does not lower the DPIA's residual risk, which stays high. It records who decided,
when, and what exactly they decided.

## 4. The retention calendar

Every period below was a drafting proposal, not a verified legal obligation. **All twelve are
confirmed as drafted on 2026-09-07**, with items A and B carrying the caveat recorded in §2.

| Record class                               | Trigger                                    | Proposed period                      | Action at expiry                                      | Confirm / Replace             |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------ | ----------------------------------------------------- | ----------------------------- |
| Adult account and contact                  | Account closure or last activity           | 24 months                            | Anonymise, keeping authorship and references          | **Confirmed**                 |
| Minor student, operational data            | Student leaves                             | 12 months                            | Delete the operational profile; keep the audit link   | **Confirmed**                 |
| **Safeguarding and incidents with minors** | Case closure                               | **Until age 25, minimum 7 years**    | Documented review before destruction                  | **Confirmed** (item A caveat) |
| Health and support                         | End of support need or departure           | 12 months                            | Reinforced deletion and access review                 | **Confirmed**                 |
| **Waivers, consents and evidence**         | Revocation or replacement by a new version | **10 years from last participation** | Keep version and hash only; delete the private object | **Confirmed** (item B caveat) |
| Memberships, invoices and payments         | End of the tax year                        | 6 years                              | Reduce to accounting minimum; never store PAN/CVV     | **Confirmed**                 |
| Attendance and check-out                   | Session completed                          | 24 months                            | Aggregate and anonymise; keep the count, not the name | **Confirmed**                 |
| CRM, leads and communications              | Last interaction                           | 24 months                            | Delete the lead; keep the opt-out                     | **Confirmed**                 |
| Privacy and system audit                   | Event creation                             | 7 years                              | Archive; destroy after review                         | **Confirmed**                 |
| Generated exports and reports              | Download creation                          | 7 days                               | Automatic object expiry                               | **Confirmed**                 |
| Backups and restore artefacts              | End of technical cycle                     | 35 days                              | Automatic expiry; expired data is never restored      | **Confirmed**                 |
| Operational logs and telemetry             | Creation                                   | 90 days                              | Automatic purge                                       | **Confirmed**                 |

**None of these is implemented today.** The system currently deletes nothing on expiry: it keeps
history through deactivation and append-only records. Signing this calendar authorises building it;
it does not describe current behaviour, and the gap between the two is DPIA §4.2, which stays open
until the deletion work is built.

## 5. Service locations being approved

| Service                           | Proposed region        | Note                                                                                                   |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Firestore (canonical store)       | europe-west2 (London)  | **A Firestore region cannot be changed after the database is created.** The least reversible line here |
| Cloud Functions                   | europe-west2 (London)  | Must match Firestore                                                                                   |
| Realtime Database (presence)      | europe-west1 (Belgium) | London is not offered; ephemeral data, no personal data                                                |
| Firebase Authentication           | Global, not selectable | See item C                                                                                             |
| Cloudflare R2 (private documents) | EU jurisdiction        | Must be set explicitly when the bucket is created                                                      |
| Payment provider                  | Jersey/UK              | T010 closed on 2026-09-06 with no provider: payment happens at the academy, so no processor is engaged |

Transfers outside UK/EEA approved as: **none, other than Firebase Authentication (item C).**

**Confirmed as drafted on 2026-09-07.**

## 6. What this signature does not do

- It does not complete the controller's registered identity (legal form, registration number,
  registered address). That is the **one closing criterion of T011 still open**, it is a fact rather
  than a decision, and it blocks any processor contract because a DPA has to name the entity exactly.
- It does not approve the DPIA. The DPIA was written on 2026-09-06
  (`docs/operations/t011-dpia-draft.md`) and remains an unapproved draft with a declared high
  residual risk. Signing section 3.1 accepts one finding of it; it does not approve the document, and
  it does not settle whether the JOIC should be notified.
- It does not implement anything. The twelve retention periods in §4 are authorised to be built and
  none of them exists in the system today.
- It does not authorise a production release. That gate is T058 and needs the operator's explicit
  confirmation for each release, independently of this act.
- It does not approve the legal wording of the waiver or of any disclaimer. That text is written by
  the club, not by the platform.

## 7. Signature

| Field                                                     | Completed                                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Name and role                                             | Vladimiro "Miro" Afonso, internal owner and signing representative, as controller                                     |
| Signed by                                                 | **Andres Santiago, p.p. Vladimiro Afonso**                                                                            |
| Authorisation referenced                                  | Operator instruction of 2026-09-07, given in the working session and recorded in `tasks.md` under T011 with that date |
| Entity signed for                                         | Brazilian Power Team · Jersey ("BPT Jersey")                                                                          |
| Date and time zone                                        | 2026-09-07, Europe/Jersey                                                                                             |
| Scope approved                                            | Sections 2, 3, 3.1, 4 and 5 of this act as recorded above                                                             |
| Amendments made                                           | None. Approved as drafted                                                                                             |
| Decision (`approve`, `approve with amendments`, `reject`) | `approve`                                                                                                             |
| Signature form                                            | Typed attestation, per procurationem. No handwritten or cryptographic signature was collected                         |

**How to upgrade this record, if it is ever needed.** Vladimiro Afonso signs this same file in his
own name: replace the "Signed by" row with his name, replace "Authorisation referenced" with the
date he signed, change the signature form row, and record the date in the T011 row of `tasks.md`.
Nothing else in the act changes, because the decisions are unchanged — only who attests them.
