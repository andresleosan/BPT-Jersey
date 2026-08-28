# T011 Retention, Residency And Deletion Decision Packet

Status: blocked; prepared for operator and applicable Jersey legal/advisory review.

Prepared: 2026-08-21

Updated: 2026-08-28 after official-source revalidation and staging gate definition; T011 remains blocked.

## Purpose

This packet collects the decisions required before the platform can define final
retention, residency, access expiry, deletion, backup, or restoration behavior.
It is not legal advice, a compliance certification, or a production policy.

No retention period, legal basis, provider region, transfer mechanism, or deletion
deadline is proposed by this packet.

## Binding Boundaries

- `BRIEF.md` requires the retention, residency, and deletion policy to be
  validated for Jersey and information about minors.
- `STACK.md` keeps this as a production gate and does not authorize production
  until the policy, backups, budgets, alerts, and monitoring are resolved.
- `docs/security/data-classification-threat-model-access-matrix.md` defines
  current classifications and minimum-principle controls, but explicitly does
  not fix legal retention periods.
- `docs/data/firestore-data-model.md` preserves history and assigns final
  retention/deletion ownership to `T011`.

## Decision Owners

On 2026-08-28, the operator confirmed that neither the academy decision owner nor
the applicable Jersey legal/advisory reviewer has been designated. The selection
and engagement package is available at
`docs/operations/t011-reviewer-engagement-brief.md`; it has not been sent and no
fees or external access have been authorized.

Each accepted decision must record the approver, date, source, scope, conditions,
and affected tasks. Until both roles are designated and the required decisions
are approved, the status remains `T011: bloqueada`.

## Decision Matrix

For every row, the reviewer must decide the retention trigger and period or rule,
legal hold behavior, residency and transfer treatment, access expiry, deletion or
irreversible de-identification method, backup treatment, restore behavior, and
audit evidence. Empty decisions are not production authorization.

| Category                            | Current classification/owner                             | Decisions required before production                                                                   | Current safe handling                                                                                                            |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Adult identity and Auth state       | `Confidential`; identity/Auth backend                    | Account closure, access revocation, retention trigger, Auth deletion, linked history                   | Deactivate/revoke; preserve authorship and references; no casual hard delete                                                     |
| Minors, families, and relationships | `Restricted`/`Confidential`; identity and family backend | Child-specific retention, guardian relationship expiry, erasure limits where history references remain | Scoped projections, deactivation and preserved relationship history                                                              |
| Health and support                  | `Restricted`; T023                                       | Minimum-data expiry/review, access expiry, legal hold, deletion of support artifacts                   | Synthetic-pilot implementation approved and fail-closed; no production storage decision                                          |
| Safeguarding                        | `Restricted`; safeguarding workflow                      | Incident/case retention, restricted access expiry, legal hold, safe deletion and export limits         | No general list/export; final policy remains open                                                                                |
| Consents, waivers, and documents    | `Restricted`; T018/T024/R2 adapter                       | Version/evidence retention, revocation effect, object and metadata deletion, backup treatment          | Synthetic-pilot implementation approved; private object path and authorization verified; no final legal wording or deletion rule |
| Memberships, invoices, and payments | `Confidential`/`Restricted`; finance backend             | Financial record retention, correction/void history, account closure, backup and legal hold            | Append-only-in-effect history and soft states; no destructive interactive deletion                                               |
| Attendance and child check-out      | `Confidential`/`Restricted`; attendance backend          | Operational and safeguarding retention, correction history, access expiry, deletion limits             | Canonical history and audited corrections; no casual delete                                                                      |
| Audit events                        | `Restricted`; create-only backend writer                 | Audit retention/archive, legal hold, backup deletion, restoration evidence                             | Append-only; no update/delete API or UI                                                                                          |
| Exports and generated reports       | `Restricted`; export backend                             | Download expiry, recipient retention, revocation, object deletion, backup treatment                    | Purpose/scope/recipient/expiry required; no general export                                                                       |
| CRM and communications              | `Confidential`; CRM/communication backend                | Prospect consent/opt-out, inactive lead retention, message and delivery history, external transfer     | Pilot communications in-app; external messaging is out of pilot                                                                  |
| Regyfit restricted snapshots        | `Restricted`; import backend                             | Source-specific retention, import-run deletion, IP handling, replay/audit relationship                 | Read-only source use, deny-by-default client access, no production import                                                        |
| Backups and restore artifacts       | Inherits highest source classification; operations       | Backup scope, region, encryption/keys, retention, purge verification, restore isolation and evidence   | T054 rehearsal approved for the synthetic pilot; backup/restore production policy remains open under T011                        |
| Operational logs and telemetry      | Classification inherited from content; operations        | PII/secret filtering, log retention, access, provider region, deletion and incident hold               | No secrets or PII in application logs; final provider policy remains open                                                        |

## Required Residency And Transfer Decisions

The reviewer must record the approved location and transfer treatment for each
service that can hold or process project data, including Firebase Auth,
Firestore, Realtime Database, Cloud Functions logs, Cloudflare R2, backups,
observability, and any future external provider. Provider marketing regions are
not treated as evidence of an approved legal or operational arrangement.

The decision must identify whether data may leave Jersey, the permitted
jurisdictions or regions, subprocessors, contractual or technical safeguards,
and the owner responsible for reviewing provider changes. No production region
or transfer allowance is selected by this packet.

## Official Baseline Revalidated 2026-08-28

This is a decision aid, not legal advice or a compliance certification.

- The academy/controller identity and JOIC registration status must be recorded. JOIC states that controllers and processors established in Jersey that process personal data must register, subject to the applicable registration framework.
- A lawful basis must be selected before each processing activity. Health data also needs a valid special-category condition; consent is not assumed as a universal fallback.
- The DPJL storage-limitation principle does not provide one universal retention period. Each category needs a purpose, trigger, justified period, action at expiry, legal-hold treatment and owner. Live data, backups, logs and exported artifacts must be covered.
- Controller/processor roles must be assessed per activity. Each processor needs a written contract covering instructions, confidentiality, security, sub-processors, rights/breach assistance and deletion/return at termination.
- A DPIA screening is required for this project before real processing because it combines minors, health/support, finance, attendance and access control. If likely high risk remains unmitigated, JOIC must be consulted before processing begins.
- Every service location, remote-access country, processor and onward transfer must be mapped. Adequacy, appropriate safeguards or a narrow exception must be documented; where appropriate safeguards are needed, JOIC guidance points small organisations to SCCs plus the Jersey Addendum and a Transfer Impact Assessment.
- Staging may use only synthetic data until this matrix is approved. A synthetic-only staging run does not decide the lawful basis, retention, deletion, residency or transfer treatment for production.

## Inputs Required From Operator And Reviewer

| Decision                                    | Required evidence                                                                                         | Current state                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Legal controller and academy decision owner | Legal/organisational identity, accountable person and contact                                             | Not designated; operator response 2026-08-28         |
| JOIC registration                           | Registration status/number or documented applicability determination                                      | Missing                                              |
| Applicable reviewer                         | Named Jersey legal/data-protection adviser or DPO reviewer                                                | Not designated; engagement brief prepared 2026-08-28 |
| Processing inventory and lawful bases       | Purpose-by-purpose basis for identity, minors, health, finance, attendance, safeguarding, CRM and audit   | Missing                                              |
| Special-category conditions                 | Separate condition and safeguards for health/support and any other special-category data                  | Missing                                              |
| Retention schedule                          | Trigger, period/rule, expiry action, owner, legal hold and backup treatment for every matrix row          | Missing                                              |
| Processor/sub-processor register            | Firebase/Google Cloud, Cloudflare and future providers with contracts, regions and deletion terms         | Missing                                              |
| Transfer assessment                         | Receiver, country, adequacy/safeguard, TIA/SCC/Jersey Addendum where applicable, onward transfers         | Missing                                              |
| DPIA                                        | Screening, risks, mitigations, residual risk and JOIC consultation decision                               | Missing                                              |
| Rights and incident operations              | Access, correction, erasure/restriction, guardian authority, breach triage and 72-hour assessment process | Missing                                              |

No row may be completed with an invented default. The operator and applicable reviewer must record approver, date, source, scope and conditions.

## Official References Consulted

- Current Data Protection (Jersey) Law 2018: https://www.jerseylaw.je/laws/current/l_3_2018
- JOIC organisation duties, registration, breach and DPIA entry points: https://www.jerseyoic.org/organisations
- JOIC data-protection principles, lawful bases, special categories and storage limitation: https://jerseyoic.org/guidance/data-protection/definitions-principles-and-lawful-bases/definitions-the-data-protection-principles-and-lawful-bases
- JOIC controller/processor duties and contract requirements: https://jerseyoic.org/guidance/data-protection/data-controller-processor-duties/your-duties-and-responsibilities-as-a-data-controller
- JOIC DPIA guidance/submission: https://portal.jerseyoic.org/dpia
- JOIC international-transfer guidance, TIA and Jersey Addendum: https://jerseyoic.org/guidance/data-protection/international-transfers/transferring-personal-data-outside-jersey

These official sources are research inputs for the operator/adviser review. They do not replace legal advice or approve any project decision.

## Provisional Pilot Controls

- Use only synthetic or sanitized data in emulators and any isolated staging.
- Do not write to production, import real member data, or connect production as
  staging or emulator.
- Do not implement destructive deletion based on this packet.
- Preserve history through deactivation, status, correction, or append-only
  records where current contracts require history.
- Keep secrets, credentials, tokens, raw provider payloads, and PII out of logs.
- Treat emulator cleanup as test-fixture cleanup, not as the final legal deletion
  mechanism.
- Keep all T023/T024/T018 production paths disabled while T011 and final legal wording remain unresolved; their synthetic-pilot implementations are approved only behind `BPT_SYNTHETIC_PILOT`.

## Safe Advancement Route For The Pilot

This route separates implementation and automated verification from production
authorization. It is an operational proposal, not a retention policy or legal
approval.

1. The operator accepted this route on 2026-08-25. T023/T024/T018/T054 may be implemented and tested only against emulators or isolated staging with synthetic/sanitized fixtures.
2. Any production path for health/support, waivers, or private documents must be
   fail-closed while T011 is unresolved: no write, import, upload, or read of
   real data.
3. T023 remains limited to the approved minimum-data design: coded support
   needs, condition summary capped at 1000 characters, staff label capped at 25
   characters, no diagnosis/medication/medical-history fields, and no files.
4. T024 may validate private-object authorization, signed-URL expiry, hashes,
   and rollback with fixtures only. It must not establish a final retention,
   deletion, residency, or backup policy.
5. Before any real data or production deployment, the operator must identify
   the academy decision owner and applicable Jersey reviewer, complete the
   matrix above, and record approver, date, source, scope, and conditions.

The operator explicitly accepted the technical pilot route on 2026-08-25 and approved T018/T054 for that scope. This acceptance does not approve T011, final legal wording, real data, production services, migrations, backups/restores, or deployment.

## Approval Gate

`T011` may move from `bloqueada` only after the operator and applicable reviewer
approve the matrix with dated evidence. The approval must then update the
classification/threat model, Firestore/R2 contracts, backup and restore runbook,
Rules/access expiry behavior, tests, and dependent task evidence. Production
still requires the separate deployment checklist and all other production gates.

## Synthetic planning appendix (f) — not a policy

The following values are invented planning defaults for Emulator or isolated
staging fixtures only. They are included to make the decision review concrete;
they do not establish a legal basis, Jersey residency, a transfer mechanism, a
retention obligation, or an approval to store real data.

| Category (f)              | Trigger (f)         | Illustrative period (f) | Pilot handling (f)                                   |
| ------------------------- | ------------------- | ----------------------- | ---------------------------------------------------- |
| Adult identity/Auth       | Account closure     | 30 days                 | Revoke access; retain synthetic references           |
| Minor/family relationship | Relationship ended  | 90 days                 | Deactivate projection; preserve synthetic audit link |
| Health/support            | Support need closed | 30 days                 | Delete fixture payload after test run                |
| Safeguarding case         | Case closed         | 365 days                | Restricted synthetic fixture; no export              |
| Consent/waiver/document   | Consent superseded  | 180 days                | Keep versioned fixture; no production object         |
| Membership/payment        | Account closure     | 730 days                | Append-only synthetic ledger; no hard delete         |
| Attendance/check-out      | Session completed   | 180 days                | Keep aggregate fixture; omit PII                     |
| Audit event               | Event created       | 730 days                | Append-only emulator record                          |
| Export/report             | Download created    | 7 days                  | Expire synthetic artifact automatically              |
| CRM/communications        | Lead inactive       | 90 days                 | In-app synthetic record; no external delivery        |
| Backup/restore artifact   | Rehearsal completed | 14 days                 | Purge rehearsal fixture after checksum review        |

Synthetic residency placeholder: keep fixtures in the local Emulator or a
dedicated staging project labelled `synthetic-only`; do not infer that this is an
approved Jersey, UK, or EU processing region. Synthetic transfer placeholder:
`none` — external providers and production backups remain disabled.

Before T011 can advance, replace every `(f)` value with a reviewed decision,
source, approver, date, scope, legal-hold rule, and rollback/deletion evidence.
