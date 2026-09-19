# Real Member PDF Import and Administrative Panel

## Context

The administrative Members page currently renders synthetic preview records. The
existing authenticated member import flow can parse uploaded PDFs and apply a
conflict-free preview, but it is limited to browser uploads and does not provide
an operational path for the eight approved PDFs already located at
`F:\Proyectos\BPT Jersey\Varios`.

The operator authorized importing those PDFs into Firebase staging project
`bptjersey-f5a25`, academy scope `demo-academy`. Production remains out of scope.

## Goals

- Parse the eight local Regyfit member reports with the existing parser and layout
  reconstruction.
- Produce a dry-run receipt before any Firestore write.
- Deduplicate the source rows using the approved `suspended` over `active`
  precedence rule.
- Persist only canonical structured member records under the existing academy
  member collection.
- Make the authenticated Members panel query the persisted records instead of
  synthetic fixtures.
- Preserve idempotency, tenant scope, metadata-only audit, and a non-destructive
  rollback procedure.

## Non-goals

- No production reads or writes.
- No copying or permanent storage of the source PDFs in the repository.
- No importing raw PDF text, source rows, credentials, cookies, or private staging
  paths into Firestore, logs, or UI.
- No identity reconciliation into users, families, or students.
- No implementation of real Groups, Activities, Attendance, Finance, Reports, or
  CRM persistence in this slice.

## Source and expected dry-run

The operational script receives an explicit source directory and an explicit
target. It accepts only the approved staging project and academy. It discovers
PDF files deterministically, orders them by filename, parses each report, and
passes the parsed reports to the existing deduplication function.

The current approved source inspection is expected to produce:

- 8 reports
- 797 source rows
- 243 canonical rows
- 554 duplicates after the approved status-precedence resolution
- 0 unresolved conflicts
- 96 canonical rows without a membership number
- Final statuses: 114 active, 128 inactive, 1 suspended

The script must stop before writing if the source set, parser result, conflict
count, or target guard does not match the explicit operator-approved run
configuration. A dry-run receipt contains counts, source hash, report keys, and
target metadata only.

## Data flow

1. The script validates source directory, PDF extension, file count, target,
   project ID, academy ID, and capture metadata.
2. It reads PDF bytes locally and extracts text with the existing coordinate-aware
   formatter.
3. It parses reports and deduplicates rows in memory.
4. It compares the canonical rows with the staging member collection using the
   existing import matching rules.
5. It emits a dry-run receipt without writing member records.
6. After an explicit `--confirm` invocation, it applies the import through the
   existing idempotent member store operation and audit event.
7. The web Members page calls the existing authenticated `searchMembers` callable
   and renders its safe member projection with loading, error, empty, and paging
   states.

The browser never receives a local path, PDF bytes, Admin SDK, service-account
material, or unrestricted Firestore access.

## Persistence and idempotency

Member writes remain in `academies/{academyId}/members`. The operation uses a
stable operation ID derived from the source hash and approved import run ID. A
repeated confirmed run returns the original result and does not duplicate
records. The existing append-only metadata audit event records academy, actor,
operation, counts, source hash, report keys, and schema version only.

The import must not overwrite a canonical member when matching is ambiguous or
when a non-status identity field conflicts. The existing service remains the
owner of mutation construction, limits, optimistic concurrency, and rollback on
partial failure.

## Panel contract

The Members route becomes a client boundary below the existing `AdminGate`. It
calls `searchMembers` with the current allowlisted filters and renders the
returned `MemberProjection` fields. It shows:

- `Staging import` as the source/status indicator when connected.
- A loading state while the callable is pending.
- A sanitized error state without backend details.
- An empty state when the scoped academy has no records.
- A next-page action when the signed page token is returned.

Synthetic fixtures remain available only for tests and unrelated preview modules;
they are not used by the connected Members route.

## Security and operational gates

- Only an explicitly allowlisted staging project and academy are accepted.
- The script refuses production, emulator, missing project identity, and source
  directories outside the approved local path unless the run configuration is
  explicitly changed and reviewed.
- Admin authorization remains server-side through existing claims and academy
  scope.
- Source hashes and counts are safe metadata; no PII is written to logs.
- PDF bytes are not retained after parsing.
- No deployment or migration is performed by this task.

Rollback is non-destructive: query only member documents carrying the approved
`source: "member-pdf-import"` and `importRunId`, verify the exact run receipt,
then delete only those newly imported documents. Updates are not deleted by the
rollback; they require a separately reviewed restoration from the pre-import
backup or captured values.

## Testing strategy

- TDD unit tests for source discovery, target guards, dry-run mismatch refusal,
  stable operation ID, and receipt sanitization.
- Existing parser/importer tests plus the real eight-file parsing check, with no
  raw source content committed.
- Firestore emulator integration test for idempotent writes, tenant scope, audit
  metadata, and rollback selection.
- Web tests for callable loading/error/empty/data/pagination states.
- Full unit, Rules, typecheck, lint, format, build, and synthetic browser smoke.
- A staging verification after confirmation that checks canonical count, unique
  source membership keys, operation/audit metadata, and the authenticated panel.

## Acceptance criteria

- Dry-run receipt matches the approved eight-report counts and has no conflicts.
- Confirmed staging import writes only the approved canonical member records and
  is idempotent on repetition.
- Firestore audit contains metadata only and is scoped to `demo-academy`.
- Members page no longer uses `previewData.members` and displays the staged
  records through the authenticated callable.
- Tests and build pass with fresh command evidence.
- Production remains untouched and the rollback command/procedure is recorded.
