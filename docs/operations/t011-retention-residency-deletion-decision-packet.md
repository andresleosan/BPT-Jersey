# T011 Retention, Residency And Deletion Decision Packet

Status: blocked; prepared for operator and applicable Jersey legal/advisory review.

Prepared: 2026-08-21

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

| Category | Current classification/owner | Decisions required before production | Current safe handling |
| --- | --- | --- | --- |
| Adult identity and Auth state | `Confidential`; identity/Auth backend | Account closure, access revocation, retention trigger, Auth deletion, linked history | Deactivate/revoke; preserve authorship and references; no casual hard delete |
| Minors, families, and relationships | `Restricted`/`Confidential`; identity and family backend | Child-specific retention, guardian relationship expiry, erasure limits where history references remain | Scoped projections, deactivation and preserved relationship history |
| Health and support | `Restricted`; T023 | Minimum-data expiry/review, access expiry, legal hold, deletion of support artifacts | T023 remains blocked; no implementation or production storage decision |
| Safeguarding | `Restricted`; safeguarding workflow | Incident/case retention, restricted access expiry, legal hold, safe deletion and export limits | No general list/export; final policy remains open |
| Consents, waivers, and documents | `Restricted`; T018/T024/R2 adapter | Version/evidence retention, revocation effect, object and metadata deletion, backup treatment | Private object path, authorization checks, no final deletion rule |
| Memberships, invoices, and payments | `Confidential`/`Restricted`; finance backend | Financial record retention, correction/void history, account closure, backup and legal hold | Append-only-in-effect history and soft states; no destructive interactive deletion |
| Attendance and child check-out | `Confidential`/`Restricted`; attendance backend | Operational and safeguarding retention, correction history, access expiry, deletion limits | Canonical history and audited corrections; no casual delete |
| Audit events | `Restricted`; create-only backend writer | Audit retention/archive, legal hold, backup deletion, restoration evidence | Append-only; no update/delete API or UI |
| Exports and generated reports | `Restricted`; export backend | Download expiry, recipient retention, revocation, object deletion, backup treatment | Purpose/scope/recipient/expiry required; no general export |
| CRM and communications | `Confidential`; CRM/communication backend | Prospect consent/opt-out, inactive lead retention, message and delivery history, external transfer | Pilot communications in-app; external messaging is out of pilot |
| Regyfit restricted snapshots | `Restricted`; import backend | Source-specific retention, import-run deletion, IP handling, replay/audit relationship | Read-only source use, deny-by-default client access, no production import |
| Backups and restore artifacts | Inherits highest source classification; operations | Backup scope, region, encryption/keys, retention, purge verification, restore isolation and evidence | Backup/restore runbook remains a production gate under T054 |
| Operational logs and telemetry | Classification inherited from content; operations | PII/secret filtering, log retention, access, provider region, deletion and incident hold | No secrets or PII in application logs; final provider policy remains open |

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
- Keep `T023` blocked and `T018` pending until the external decision is recorded.

## Approval Gate

`T011` may move from `bloqueada` only after the operator and applicable reviewer
approve the matrix with dated evidence. The approval must then update the
classification/threat model, Firestore/R2 contracts, backup and restore runbook,
Rules/access expiry behavior, tests, and dependent task evidence. Production
still requires the separate deployment checklist and all other production gates.
