# Cronos Handoff: Regyfit Real Capture

## Estado

El primer run real autorizado terminó el 2026-08-08 mediante Playwright sobre la sesión CDP
autenticada. El contenido real no está en Git, Markdown, logs ni artefactos de QA.

- Run: `regyfit-20260808-acessos-01`
- Module: `alunos-acessos`
- Source route: `/admin2/modulos/alunos/acessos_alunos.php`
- Records: `10`
- Chunks: `1`
- Status: `captured-and-imported-to-staging`
- Retention/deletion date: `2026-08-22`
- Baseline: scoped staging collection and audit count were both `0` before apply
- Import receipt: `importedCount=10`, `skippedCount=0`, then repeat `importedCount=0`, `skippedCount=10`
- Content hash: `a351dd5e8372e7100ca82b9b5e238d5265b3f091aca596039efb8356aee51c02`
- Raw location: private encrypted staging outside the checkout, resolved by the operator-approved
  `REGYFIT_PRIVATE_STAGING_ROOT`

## Observed Shape

The source table has six columns:

1. Blank action column
2. `Member`
3. `Member Nº`
4. `Logins`
5. `Last Login`
6. `IP`

All ten data rows exposed stable DOM `id` values. The capture adapter used those IDs as source IDs,
kept the five data columns, and excluded the blank action column. Raw values remain only in the
private staging chunk.

## Approved Staging Mapping

Status: **approved for staging only; production and identity reconciliation remain out of scope**.

Do not force these rows into `students` or `users`: the captured screen does not prove whether each
member is an adult student, a minor, or an authentication identity. Use a source-specific restricted
snapshot until identity reconciliation is approved.

- Target collection: `academies/{academyId}/regyfitAccessRecords`
- Document ID: deterministic `sourceId` from the Regyfit row
- Required fields: `academyId`, `sourceSystem`, `sourceId`, `memberDisplayName`, `memberNumber` (nullable when absent in source),
  `loginCount`, `lastLoginAt`, `ip`, `importRunId`, `capturedAt`, `schemaVersion`
- Classification: `Restricted`, because the record contains IP and login history
- Migration write: `system/integration` only, through the backend/import command
- Raw read: `owner` only
- Safe projection: `administrator/reception` may read member number, login count and last login only;
  raw IP is excluded
- Other roles: `head coach`, `coach`, `parent/guardian` and `adult student` have no access
- Client writes: prohibited
- Audit: append-only `auditEvents` entry with run ID, count, hash, actor and purpose; never copy raw
  records into the audit event

The administrative panel should initially expose this as a read-only `Regyfit Access Records` view.
The IP column must be hidden or masked for every role except the explicitly authorized owner view.
Identity reconciliation into canonical `students` or `users` is a separate reviewed migration step.

## Import and Rollback

- Read the JSONL only from `REGYFIT_PRIVATE_STAGING_ROOT`.
- Import idempotently by `sourceId` and `importRunId`.
- Load only local/emulator or explicitly approved application staging; never production.
- Reconcile count and checkpoint hash without logging record values.
- Roll back a non-production import by removing only documents with the matching `importRunId`.
- Verified post-import invariants: 10 documents, 10 distinct source IDs, 10 matching run IDs, one metadata-only audit event, no unexpected fields.
- Delete the private staging root and derived copies by 2026-08-22.

## Unverified Exports

`but_excel2`, `but_excel3` and `but_pdf` were observed on read-only report screens but were not
activated. Their output scope remains unverified and no download was created.
