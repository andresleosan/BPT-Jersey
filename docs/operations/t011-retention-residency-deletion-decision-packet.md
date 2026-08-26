# T011 Retention, Residency And Deletion Decision Packet

Status: blocked; prepared for operator and applicable Jersey legal/advisory review.

Prepared: 2026-08-21

Updated: 2026-08-25 after operator approval of the T018/T054 synthetic-pilot scope; T011 remains blocked.

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

The operator must identify the academy decision owner and the applicable Jersey
legal/advisory reviewer. Each accepted decision must record the approver, date,
source, scope, conditions, and affected tasks. Until then, the status remains
`T011: bloqueada`.

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

## Official References Consulted

These public Jersey Office of the Information Commissioner pages are research
inputs for the operator/adviser review. They do not replace legal advice or
approve any project decision:

- `https://jerseyoic.org/` identifies the JOIC as the independent regulator for
  the Data Protection (Jersey) Law 2018.
- `https://jerseyoic.org/organisations` directs Jersey organisations to consider
  registration, breach reporting, and DPIA consultation for high-risk
  processing.
- `https://jerseyoic.org/guidance` links guidance on controller duties,
  data-protection principles and lawful bases, design and DPIAs, individual
  rights, and transfers outside Jersey.

The reviewer must verify the current guidance and determine which items apply
to BPT Jersey before recording any decision in this packet.

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

| Category (f) | Trigger (f) | Illustrative period (f) | Pilot handling (f) |
| --- | --- | --- | --- |
| Adult identity/Auth | Account closure | 30 days | Revoke access; retain synthetic references |
| Minor/family relationship | Relationship ended | 90 days | Deactivate projection; preserve synthetic audit link |
| Health/support | Support need closed | 30 days | Delete fixture payload after test run |
| Safeguarding case | Case closed | 365 days | Restricted synthetic fixture; no export |
| Consent/waiver/document | Consent superseded | 180 days | Keep versioned fixture; no production object |
| Membership/payment | Account closure | 730 days | Append-only synthetic ledger; no hard delete |
| Attendance/check-out | Session completed | 180 days | Keep aggregate fixture; omit PII |
| Audit event | Event created | 730 days | Append-only emulator record |
| Export/report | Download created | 7 days | Expire synthetic artifact automatically |
| CRM/communications | Lead inactive | 90 days | In-app synthetic record; no external delivery |
| Backup/restore artifact | Rehearsal completed | 14 days | Purge rehearsal fixture after checksum review |

Synthetic residency placeholder: keep fixtures in the local Emulator or a
dedicated staging project labelled `synthetic-only`; do not infer that this is an
approved Jersey, UK, or EU processing region. Synthetic transfer placeholder:
`none` — external providers and production backups remain disabled.

Before T011 can advance, replace every `(f)` value with a reviewed decision,
source, approver, date, scope, legal-hold rule, and rollback/deletion evidence.