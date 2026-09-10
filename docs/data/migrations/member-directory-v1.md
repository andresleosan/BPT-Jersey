# Member directory v1 - convergence plan

Status: designed, not executed
Owner task: T092; implementation belongs to T093
Decision: docs/adr/ADR-009-students-canonical-member-directory.md

## Objective

Converge the administrative Members directory onto students without guessing identities, changing
production, deleting legacy records, or treating imported commercial labels as authoritative.

The plan is intentionally split into a local/Emulator implementation, a future isolated staging
rehearsal, and a separately authorized production operation.

## Canonical ownership

| Data                             | Canonical collection                 |
| -------------------------------- | ------------------------------------ |
| Participant identity and contact | students                             |
| Adult Auth account               | users plus students.userId           |
| Minor family and guardian        | families plus relationships          |
| Administrative member metadata   | studentAdminProfiles                 |
| Membership lifecycle             | memberships                          |
| Financial state                  | invoices plus payments               |
| Booking and attendance           | bookings plus attendance             |
| Assessment evidence              | assessments                          |
| Current level and skill summary  | studentLevelProgress                 |
| Formal promotion decisions       | levelPromotions                      |
| Non-promotion recognition        | recognitions                         |
| Historical PDF record            | members, read-only during transition |

studentAdminProfiles is an extension keyed by studentId. It cannot authorize membership, booking,
payment, attendance, consent, health access or progression.

The full admin-profile document is Restricted. The exact allowlist for a general administrative
directory row is studentId, fullName, trainingCenter, participantType, active, status and an
optional backend-computed masked membershipReference. General lists, tables, PDFs and exports do
not include DOB, contact fields, gender, membershipNumber, idCardNumber, vatNumber, frequencyNote,
legacy/source IDs or actor IDs. A detail command addressed by studentId has a separate purpose-bound
allowlist. Exact lookup by an approved public administrative kind requires owner/administrator, a
closed purpose, a rate limit and an append-only audit event; the result returns the minimized
directory row without echoing the queried value. Legacy/Auth kinds remain internal-only.

The general administrative list itself requires verified Auth + App Check and a currently active
owner or administrator; guardian, adultStudent, coach and headCoach use their existing
purpose-specific projections and cannot invoke it. The backend derives academyId from claims and
accepts only pageSize (an integer from 1 to 50) plus an optional opaque backend-issued cursor bound
to academyId, actorId, actor role, projection version, cursorSecretVersion and a five-minute expiry
and authenticated with the directory-cursor HMAC secret. The authenticated cursor payload is exactly
academyId, actorId, role, projectionVersion=`admin-directory-v1`,
order=`__name__:asc`, afterDocumentId, issuedAt, expiresAt and cursorSecretVersion. The backend uses
`orderBy(documentId ASC)`, applies `startAfter(afterDocumentId)` only from that verified token and
queries limit+1. It returns at most 50 rows, direct-gets at most those 50 admin profiles to compute the
mask and emits a next cursor only from the last returned document when row 51 exists. Payload
academy/filter/order/cursor-position overrides, forged/expired/cross-tenant cursors, invalid document
IDs and unknown keys fail before the directory query. The canonical list never enumerates members;
the sole bounded exception is the explicit rollback adapter below.

The rollback adapter never places a legacy document ID in a client-readable token. Its signed token
payload is exactly academyId, actorId, role, projectionVersion=`legacy-rollback-directory-v1`,
order=`legacy-adapter-private`, an opaque random cursorId, stateRevision, issuedAt, expiresAt and
cursorSecretVersion. The backend direct-gets the matching Restricted
memberDirectoryCursorStates/{cursorId}; that five-minute server-owned record binds the same fields
plus afterLegacyDocumentId. It is not exportable, is excluded from backup, expires fail-closed and is
deleted only by bounded TTL cleanup. A missing/divergent cursor state or any legacy ID in the returned
token fails before the legacy query.

Every directory page is selected by a validated memberDirectoryStates/current snapshot before any
domain query. State, cursor state, the selected students or bounded legacy rows, and every direct
profile/key read execute in one Firestore transaction/snapshot. Its state read lock conflicts with an
acquisition or chunk transition; retry must reselect the reader from the new tuple. In legacy-v1, the
public directory fails closed with migration-required and performs zero members/students queries
because a legacy memberId cannot be exposed as studentId. In the exact
canonical-v1/canonical-v1/open/idle tuple it queries students as described above. In the stable
legacy-rollback-v1/blocked/frozen/rollback-readonly tuple it invokes only the privacy-safe rollback
adapter; that adapter may enumerate bounded legacy rows solely to map them to canonical studentId.
Every active bootstrap/forward/reconcile, rollback-projection, canonical-recovery, restore-prepared or
restore-recovery tuple, plus restore-rehearsal-complete, fails closed for list/detail before the collection query. Invalid state, a cursor for another
reader/version and marker=true with any legacy reader fail before all domain reads. Therefore
students created by a forward chunk are never visible until the atomic administrative cutover; T097
later removes the rollback adapter itself.

membershipReference is omitted unless the normalized membershipNumber has at least eight
characters; otherwise it is exactly `****` plus its final four characters. It is display-only and
cannot be used for filtering, sorting, lookup or export.

For purpose `member-record-maintenance`, the single-student detail allowlist is studentId, fullName,
dateOfBirth, optional phoneNumber/email, trainingCenter, trainingTimePreferences, participantType,
active, status, optional membershipNumber/idCardNumber/vatNumber, gender and optional frequencyNote.
It excludes legacyMemberId, source/import/migration IDs, timestamps and actors. Provenance is exposed
only to the private migration runner and never to the ordinary Members UI or an MVP callable.
`member-identity-lookup` and `member-record-maintenance` are the only closed read-purpose values;
unknown/free-text purposes fail before reads.

Because studentId is visible in the minimized list, sensitive detail is never a bare document get.
It requires the same verified Auth + App Check, role, server-derived academy, shared Restricted-read
rate limit and append-only audit transaction as exact identifier lookup. It accepts exactly one
studentId, has no batch endpoint and returns bytes only after quota/audit commit.

Exact identifier lookup derives academy/actor/role from verified Auth plus App Check and accepts no
client academyId. Its public lookupKind enum is exactly membership-number, id-card-number or
vat-number. legacy-member-id is runner/rollback-only and auth-user-id is Auth-link-flow-only; either
public value fails before a blind-key read. The limit is 20 accepted attempts per actor and academy
in a server-clock five-minute window. In one Firestore transaction the backend first validates
memberDirectoryStates/current, then reads the actor's studentRestrictedReadLimits record, blind key
and current authoritative profile/student as allowed, increments the counter and creates exactly one
append-only audit event before returning match or no-match. The state lock makes an
acquisition/chunk race retry and then fail closed or use the new stable tuple; no key/profile result
crosses a directory-state transition. If
the limit is exceeded, it does not read the blind key. The first rejection sets an immutable
overLimitObserved flag and creates one deterministic create-only audit event for that actor/window;
later rejections in the same window perform no writes. The callable rejects only after the first
audit commit or the later read-only check. Concurrent attempt 21 cannot pass, and rejection spam is
O(1) writes per window. The window start is the server epoch second floored to 300 seconds; the audit
ID is `restricted-read-limit-v1:{actorId.length}:{actorId}:{windowStartEpoch}`.

Audit/log/error data contains action, closed purpose, actor, academy, correlation, result and time;
it never contains the input, normalized value, kind:digest/keyId, admin identifier or echoed match
field. Match and stale/missing-key no-match share the same minimized response shape. Direct access to
studentRestrictedReadLimits is denied, its document ID is the authenticated actorId under the academy
path, and client time never selects or resets a window.

studentAdminProfiles has no active or status field; the student owns lifecycle. source and
provenance are immutable: admin forbids import/migration IDs, member-pdf-import requires importRunId,
and legacy-member-migration requires migrationId plus legacyMemberId. Public callable parameters
named memberId become compatibility aliases for studentId and never accept legacyMemberId.

The provenance combinations are exact:

| source                  | importRunId                                     | migrationId | legacyMemberId |
| ----------------------- | ----------------------------------------------- | ----------- | -------------- |
| admin                   | forbidden                                       | forbidden   | forbidden      |
| member-pdf-import       | required                                        | forbidden   | forbidden      |
| legacy-member-migration | optional only with a bound prior-import receipt | required    | required       |

For legacy-member-migration, an importRunId is accepted only when the forward receipt binds the
same prior member import operation and its MAC. No callable/UI exposes provenance in the MVP;
member-migration-review is a private runner/approval workflow, not a read purpose. Self, guardian and
ordinary admin profile payloads cannot set or mutate source/provenance fields.

## Required invariants

1. Academy path and academyId are equal.
2. students document ID equals studentId.
3. studentAdminProfiles document ID equals studentId.
4. Every admin profile references an existing student in the same academy.
5. membershipNumber, idCardNumber, vatNumber and legacyMemberId are unique when present through
   studentIdentityKeys.
6. One userId maps to at most one student through the same reservation mechanism.
7. No automatic match uses name, email or date of birth alone.
8. A minor requires an active family and relationship in the same academy.
9. Migration never invents Auth users, guardians, families, relationships or memberships.
10. Missing date of birth or training center prevents conversion to a student.
11. trainingCenter accepts Town or West only; no silent default.
12. participantType is derived server-side from date of birth and an effective date fixed in the
    operation receipt.
13. Legacy membershipStatus and paymentStatus never grant access.
14. Tenant, IDs, source, actors, timestamps and status fields are server-owned.
15. Reads and writes are bounded.
16. Identical replay converges; a divergent replay fails closed.
17. The forward operation never deletes or overwrites members.
18. Logs and receipts contain no names, contacts, tax/card identifiers or raw source values.
19. Direct client access to studentAdminProfiles and migration state is denied.
20. A concurrent updatedAt change aborts the affected operation before writes.
21. Progress, recognition and reports do not read or write members after the global T097 cutover.
22. Destructive cleanup is forbidden until retention, backup and reference checks are approved.
23. New migrated students have active=false and status=inactive; legacy membership/payment labels
    never activate a participant or create commercial access. Human review and activation are a
    later, separate audited canonical command.
24. A general projection never contains idCardNumber, vatNumber or frequencyNote.
25. Canonical progress uses direct assessments, studentLevelProgress and levelPromotions paths; no
    post-global-cutover read or write may touch members or nested evaluations/graduations.
26. Only headCoach can approve/reject a formal promotion; owner has no equivalent authority.
27. Missing studentLevelProgress is uninitialized and never defaults to white belt/catalog order.
28. A newly created studentId is backend-generated and opaque. legacyMemberId is retained only in
    the Restricted admin profile/key and is never reused as a new operational identity.
29. Canonical identity writers and directory cutover fail closed until every existing canonical
    user/admin identifier has a verified reservation at the exact configured key versions.
30. A studentIdentityKeys document ID equals keyId; the singleton state ID is current; an operation
    receipt ID equals operationId and a chunk ID equals `{operationId}:{phase}:{chunkNo}` with
    chunkNo starting at 1 per phase and increasing without gaps.

## Uniqueness reservations

studentIdentityKeys uses document IDs `{kind}:{digest}` where kind is membership-number,
id-card-number, vat-number, legacy-member-id or auth-user-id. digest is 64 lowercase hexadecimal
characters from HMAC-SHA-256 with a versioned backend secret. Its message is the UTF-8 domain prefix
`bpt-student-identity-v1`, followed by academyId, kind and normalized value as independent UTF-8
segments, each prefixed with an unsigned 32-bit big-endian byte length. No delimiter concatenation,
raw identifier, reversible encoding or unkeyed personal-data hash is allowed in a path, receipt,
log or reservation body.

membershipNumber, idCardNumber, vatNumber and legacyMemberId use Unicode NFKC, trim and uppercase;
then they must match `[A-Z0-9][A-Z0-9 ./-]{0,63}` exactly. Firebase userId is compared exactly and
must satisfy the existing safe path-segment contract. The reservation body contains only keyId,
academyId, kind, digestVersion=`hmac-sha256-v1`, non-secret secretVersion, ownerStudentId,
schemaVersion and server-owned timestamps/actors. A new reservation and the student/admin-profile
mutation occur in one Firestore transaction. Reservations are immutable and never reassigned or
deleted interactively; a corrected value creates a second reservation for the same student. A
reservation owned by another student, a missing referenced student or a divergent replay aborts
with zero writes.

An exact lookup that resolves a reservation re-reads the current admin profile or student in the
same operation and recomputes the digest for its current value. A preserved key for an old value
returns no-match and does not reveal ownerStudentId. Before new canonical writers are enabled, T093
backfills/reconciles all existing students, userId links and admin identifiers. It then records in
memberDirectoryStates/current the digestVersion, secretVersion, identityKeyBaselineMac and
identityKeyCoverage=complete. Writers reject missing, incomplete or mismatched coverage.

The authoritative recheck is exact by kind: membership-number, id-card-number, vat-number and
legacy-member-id read studentAdminProfiles; auth-user-id reads students.userId. The recheck and any
owning create/link/change share the same transaction and same academy. No administrative profile can
validate or mutate an Auth UID reservation.

The identity-key, migration-integrity and directory-cursor HMAC secrets use strict base64url without
padding and must decode to 32-64 cryptographically random bytes. They are pairwise distinct, have no
default/fallback value, use different material in every environment and are fetched by exact version
from approved Secret Manager bindings for remote use. Empty, malformed, short, placeholder, equal or
cross-environment-reused material fails before a source/Firestore read. Explicit test keys are
accepted only when the full Emulator binding is target=emulator, the projectId is exactly
demo-bpt-jersey or demo-bpt-jersey-restore and the host is 127.0.0.1:8080. Material remains distinct
per purpose and project; test keys fail in every remote/staging mode. MACs are
length-checked and compared in constant time. Missing/unknown versions fail closed. Key rotation
needs an explicit multi-version read/deny plus single-write migration plan that keeps every
historical reservation effective; it is not implicit in T093.

## Dry-run classifications

Every legacy row receives exactly one non-PII classification:

| Classification                  | Meaning                                                  | Write eligibility              |
| ------------------------------- | -------------------------------------------------------- | ------------------------------ |
| same-id-compatible              | Same ID points to a compatible student                   | Explicit review, then eligible |
| explicit-existing-student-match | Approved manifest maps legacy to an existing student     | Eligible                       |
| createable-adult                | Complete adult record with no collision                  | Eligible                       |
| minor-requires-family-match     | Minor cannot be safely created without family linkage    | Ineligible                     |
| missing-required-fields         | Date of birth, center or other required value is missing | Ineligible                     |
| identity-conflict               | Existing identity or Auth link conflicts                 | Ineligible                     |
| duplicate-membership-number     | Administrative number is not unique                      | Ineligible                     |
| cross-tenant                    | Any reference crosses academy scope                      | Ineligible                     |
| invalid-record                  | Shape, enum, date or server-owned field is invalid       | Ineligible                     |

Any conflict makes the confirmation fail closed. Partial best-effort writes are not allowed.

The forward dry-run also reads at most 401 existing canonical students and binds
preExistingAdmittedStudentCount, plannedNewStudentCount (createable-adult only) and
postCutoverAdmittedStudentCount. It requires the first count to equal the current state/guard count
and `preExisting + plannedNew = postCutover <= rollbackCapacityLimit=400`. Thus 399 existing plus two
creates, 400 plus one, or row 401 is rejected before a planned confirmable operation, freeze or domain
write; source-row count alone is never treated as capacity.

For a plan larger than one conservative transaction, "no partial writes" means no partially
activated directory. Chunks may create only active=false/status=inactive students, previously
absent admin profiles, reservations and metadata receipts while the legacy reader remains active
and an academy-scoped freeze blocks identity mutations. A final transaction switches the reader and
write mode only after all chunks, identity-key coverage and MACs verify. Failure keeps the reader
legacy and the freeze active until exact-plan resume or verified failed-forward compensation.

## Receipt

The dry-run receipt contains only:

- operationId and academyId; for directory-forward the same operationId is the immutable migrationId
  stored in migrated admin profiles;
- target project classification;
- code and schema versions;
- effective date and expiry;
- sourceMac, privateManifestMac and planMac;
- identity-key digest/secret versions, identityKeyBaselineMac and expected outputSetMac roots;
- counts per classification plus pre-existing, planned-new and post-cutover admitted students;
- expected updatedAt/version plus source-record MACs;
- maximum approved rows;
- actor and metadata-only audit correlation.

The receipt never contains a name, email, phone, address, date of birth, membership number, ID card,
VAT number or reversible source payload.

Every MAC derived from a private path, source row, manifest, plan or document body uses
HMAC-SHA-256 with a migration-integrity secret that is distinct from the identity-key and
directory-cursor secrets. The stored metadata includes
`integrityMacVersion=hmac-sha256-v1` and a non-secret
`integritySecretVersion`; output is 64 lowercase hexadecimal characters. Messages use separate
domain prefixes and the same uint32-length-prefixed UTF-8 encoding as identity keys. Plain SHA-256
is allowed only for public code/schema artifacts that contain no personal data. Missing, reused
across environments or unknown integrity secret versions fail closed.

For outputSetMac, each private target leaf is a MAC over
`bpt-member-directory-output-leaf-v1`, target path and RFC 8785 canonical JSON bytes. The 32-byte
leaf outputs are sorted lexicographically; the root is a MAC over
`bpt-member-directory-output-root-v1`, operationId, phase, chunkNo and their concatenated bytes. The
empty set has its own domain-separated root. identityKeyBaselineMac and source/manifest/plan MACs use
distinct domain prefixes. T093 must publish golden vectors for encoding, canonicalization, leaf
ordering and roots.

The server creates one RFC 3339 UTC millisecond `operationWriteTime`, all opaque target/audit IDs and
all actor fields before finalizing planMac; the receipt expires within the operation window. Every
create uses those exact backend-owned values. `FieldValue.serverTimestamp()` and post-plan random IDs
are forbidden for an outputSetMac target because they cannot be prebound. For a string timestamp,
canonical JSON contains the normalized UTC string; for an existing Firestore Timestamp used as an
input version, the private plan canonicalizes it as `{seconds,nanoseconds}` with exact integer bounds.
Mixed timestamp representations, unresolved transforms or fields absent from the private plan fail
before writes. Thus the MAC covers the entire stored document, including schema, provenance,
timestamps and actors, rather than excluding a volatile envelope.

## Private reviewed manifest

The reconciliation manifest is a separate Restricted input artifact. It is never stored in
memberDirectoryMigrations/chunks, audit details or logs; only its privateManifestMac and bounded
counts appear there. Schema v1 binds operationId, academyId, target/code/schema versions, preparedAt,
expiresAt and a one-to-one row list. Each row binds the source legacy ID and exact source version/MAC
to one classification and either an existing studentId or one backend-generated opaque
targetStudentId. Explicit matches record the reviewed reason; minor matches additionally bind the
already-existing familyId and relationshipId.

Duplicate source IDs, duplicate target IDs, one source mapped twice, an expired manifest, a changed
source MAC or an unreviewed same-ID coincidence rejects the
whole manifest. `same-id-compatible` is only for a student document that already had that ID before
the operation; it never authorizes generating a studentId from legacyMemberId. The private output
plan also binds every expected target path, prior-absence/version assertion and canonical content
MAC. Each chunk receipt stores only outputSetMac and counts, so compensation
can rederive and verify targets without putting IDs or PII in Firestore metadata.

Local/Emulator manifests contain only synthetic fixtures under the approved input root and are
removed after rehearsal. Any remote run requires an approved encrypted artifact store with least
privilege, access logs, restore evidence and T011 retention through the rollback window. Backup v3
binds the privateManifestMac and required secret versions; it does not copy the private artifact into
Firestore, and cutover/rollback fail unless the exact artifact is readable.

## Authenticated approval receipt

A reviewer name inside a file is not authority. Any remote confirm, compensation, rollback,
post-deadline recovery or global-legacy elimination requires a create-only
memberDirectoryApprovals/{approvalId} receipt produced by an Auth + App Check backend action. The
backend derives reviewerActorId/academyId from claims, requires a currently active owner or
administrator, direct-gets the operation, and binds approvalKind, projectId, operationId, planMac,
authorizedTransition, expectedStateRevision, approvedAt and expiresAt; restore approvals also bind
the exact sourceProjectId, targetProjectId and restoreEpoch. approvalId is backend-generated opaque; the client cannot choose actor,
tenant, project, role, hashes, transition, revision, epoch or expiry.

approvalKind is a closed, non-interchangeable enum: `bootstrap-confirm`,
`failed-bootstrap-abandon`, `forward-confirm`, `failed-operation-compensate`,
`post-cutover-rollback`, `post-deadline-recovery`,
`canonical-recovery`, `identity-reconcile-confirm`, `restore-acquire`, `restore-complete` or
`global-legacy-eliminate`. The operation/action pair must be exact:
identity-key-bootstrap accepts bootstrap-confirm, failed-bootstrap-abandon or
post-deadline-recovery; directory-forward accepts forward-confirm, failed-operation-compensate or
post-deadline-recovery; post-cutover-rollback accepts post-cutover-rollback or
post-deadline-recovery; canonical-recovery accepts canonical-recovery or post-deadline-recovery;
identity-key-reconcile accepts identity-reconcile-confirm or post-deadline-recovery;
member-directory-restore-recovery accepts restore-acquire only for planned -> frozen,
restore-complete only for verified -> completed, or post-deadline-recovery for the exact failed
resume transition;
global-legacy-elimination accepts only global-legacy-eliminate.

Except for the explicitly dual-project restore saga below, every authorized transition consumes its
approval by transaction.create on
memberDirectoryApprovalConsumptions/{approvalId}. The create-only receipt binds approval/operation,
authorizedTransition, stateRevisionBefore/After, restoreEpoch when present, approvalMac,
stage=`local-transition`, consumedAt/actor and schemaVersion. It is written in the same transaction as the state/operation
transition. Existing/divergent consumption, cross-stage use and a revision/epoch mismatch fail with
zero state/domain writes; exact completed-operation replay may only return the already committed
result.

Directory-forward compensation acquisition is itself an authorized state transition. One transaction
requires the failed parent and exact private plan/output receipts, consumes a
failed-operation-compensate approval
bound to authorizedTransition=failed-to-compensating, moves failed -> compensating, changes the
state phase to compensation, resets lastCommittedChunkNo to 0, issues a fresh lease/deadline,
advances state/guard revision and appends audit evidence. It performs no domain write. If the failed
operation committed zero output chunks, a separate zero-domain-write verification proves the exact
preOperationSetMac and then moves compensating -> aborted while releasing the freeze; otherwise the
first reverse chunk starts at the highest committed source chunk.

Failed identity-key-bootstrap never enters compensation and never deletes a monotonic reservation for
a pre-existing student/profile. A `failed-bootstrap-abandon` approval authorizes only
failed-to-aborted. One metadata-only transaction reopens the exact plan and every committed bootstrap
receipt, verifies every key created by those receipts is still immutable, same-tenant, owned by the
planned student and either still current or a safely obsolete reservation, then moves the parent
failed -> aborted, returns state to legacy-v1/legacy-v1/open/idle with
identityKeyCoverage=incomplete, sets lastCommittedChunkNo=0, clears operation/lease/deadline fields
and advances guard/audit. It preserves every key and all domain documents. A malformed, reassigned or
unattributable key keeps the bootstrap frozen for exact-plan recovery. A later bootstrap must adopt
every compatible preserved key as already present and can publish a new complete baseline only after
re-inventorying the whole current set.

For a local transition or source-side restore handoff, the runner receives only approvalId, re-reads
the receipt and current actor/role, and rejects role
revocation, cross-tenant/project data, wrong operation/kind/transition/revision/epoch/MAC, reuse,
replay after completion or expiry.
guardian, adultStudent, coach and headCoach cannot approve. The remote workload identity executing
the runner must also be allowlisted; approval never substitutes the operation-specific confirmation
token or environment binding. Emulator injects an explicitly synthetic approval adapter.
Approval/consumption receipts and audits contain no manifest rows or administrative identifiers and
are included in backup v3 only as inert historical evidence.

## Coordination state machine

memberDirectoryStates/current uses exact closed values:

- readerVersion: legacy-v1, canonical-v1 or legacy-rollback-v1;
- directoryWriteMode: legacy-v1, canonical-v1 or blocked;
- freezeStatus: open or frozen;
- stateRevision: a monotonically increasing safe integer;
- globalLegacyReadEliminated: a monotonic boolean constrained by the valid tuple;
- identityKeyCoverage: incomplete or complete, plus digestVersion, secretVersion and
  identityKeyBaselineMac plus opaque identityKeyBaselineArtifactId;
- rollbackProtocolVersion: legacy-projection-v1 while the global marker is false, otherwise
  disabled; rollbackCapacityLimit=400 and rollbackEligibleStudentCount is the monotonic number of
  stable canonical identities admitted before global elimination. Operation-private forward outputs
  are excluded until atomic cutover;
- operationPhase: idle, bootstrap, identity-reconcile, forward, compensation,
  rollback-projection, rollback-readonly, canonical-recovery, restore-prepared, restore-recovery or
  restore-rehearsal-complete;
- every valid state has integer lastCommittedChunkNo. An active phase initializes it to 0 and then
  advances it without gaps; every stable tuple fixes it at 0. Only an active operation has
  activeOperationId, leaseId, leaseOwner, leaseExpiresAt and operationDeadline. The stable
  rollback-readonly tuple is frozen and blocked but has none of those operation/lease fields.
  restore-prepared alone has preparedOperationId and no active/lease/deadline fields; every other
  tuple forbids preparedOperationId.

Only these state tuples are valid:

| State                | readerVersion      | directoryWriteMode | freezeStatus | operationPhase             | globalLegacyReadEliminated |
| -------------------- | ------------------ | ------------------ | ------------ | -------------------------- | -------------------------- |
| Pre-cutover baseline | legacy-v1          | legacy-v1          | open         | idle                       | false                      |
| Bootstrap/forward    | legacy-v1          | blocked            | frozen       | bootstrap or forward       | false                      |
| Failed compensation  | legacy-v1          | blocked            | frozen       | compensation               | false                      |
| Canonical            | canonical-v1       | canonical-v1       | open         | idle                       | false or true              |
| Identity reconcile   | canonical-v1       | blocked            | frozen       | identity-reconcile         | false or true              |
| Rollback projection  | canonical-v1       | blocked            | frozen       | rollback-projection        | false                      |
| Rollback read-only   | legacy-rollback-v1 | blocked            | frozen       | rollback-readonly          | false                      |
| Canonical recovery   | legacy-rollback-v1 | blocked            | frozen       | canonical-recovery         | false                      |
| Restore prepared     | canonical-v1       | blocked            | frozen       | restore-prepared           | false or true              |
| Restore rehearsal    | canonical-v1       | blocked            | frozen       | restore-recovery           | false or true              |
| Isolated rehearsal   | canonical-v1       | blocked            | frozen       | restore-rehearsal-complete | false or true              |

Any other combination, including rollback-readonly with a lease or active operation, fails parsing
and cannot authorize reads or writes. T093 code treats the
legacy baseline as read compatibility, not permission for a new normal members writer. Every normal
bootstrap, reconcile, forward or rollback acquisition is one transaction from an open tuple to its
corresponding frozen operation tuple, sets directoryWriteMode=blocked and increments stateRevision.
There are exactly two already-frozen acquisition exceptions. Canonical recovery starts from stable
rollback-readonly, creates a new operation/lease and enters canonical-recovery without briefly
opening writes; it remains valid after an arbitrarily long read-only interval. Restore acquire starts
from the exact restore-prepared tuple and atomically clears preparedOperationId while entering
restore-recovery with its active operation/lease. Neither exception permits an expired prior lease.
globalLegacyReadEliminated=true normally requires the canonical/open/idle row with no active
operation/lease/deadline and lastCommittedChunkNo=0. The only exceptions are the explicitly listed
canonical identity-reconcile tuple, isolated restore-prepared tuple, post-global restore-recovery
tuple and terminal rehearsal tuple. Restore-prepared has only preparedOperationId and no active
operation/lease/deadline; restore-recovery has a fresh operation/lease. All keep
readerVersion=canonical-v1 and writes blocked and never serve application reads or writes. Any legacy
reader with marker=true is invalid before all reads. While the
marker is false, rollbackProtocolVersion must be legacy-projection-v1, its
capacity is exactly 400 and rollbackEligibleStudentCount is the non-decreasing number of identities
admitted to a stable canonical set. Existing pre-forward students establish the baseline; private
forward outputs do not increment it until successful cutover and their failed compensation therefore
does not decrement it. In any stable false-marker tuple it equals the canonical student count because
normal hard delete is forbidden. With marker=true the protocol is disabled and the final count is
retained only as audit metadata. The marker disables every legacy reader/rollback path and is
immutable in v1.

### Non-restorable restore guard

The control-plane head is the top-level document
memberDirectoryRestoreGuards/{academyId}, outside every tenant backup root. Its closed schema is
guardId=`academyId`, projectId, academyId, highestStateRevision,
globalLegacyReadEverEliminated, highestRollbackEligibleStudentCount, restoreEpoch,
integrityMacVersion/SecretVersion, lastEventId, lastEventMac, schemaVersion=`1` and server-owned
timestamps/actor. Its create-only event chain is
memberDirectoryRestoreGuards/{academyId}/events/{stateRevision}; each event binds project/academy,
previous/current revision, previousEventMac, monotonic marker/count/epoch, operationId,
transitionKind, occurredAt/actor and eventMac. eventMac is a domain-separated migration-integrity
HMAC over every field.

State initialization creates revision zero head/event atomically. Thereafter every transaction that
increments memberDirectoryStates.stateRevision -- including every canonical identity mutation,
lease/recovery transition and the global marker -- also direct-gets the matching guard head, requires
head/state revision and monotonic fields to agree, creates the next event and advances the head in
the same Firestore transaction. No code may write directory state directly. Missing/divergent guard,
event collision, wrong project/tenant/MAC, count decrease or true-to-false marker fails with zero
state/domain writes. The global marker and its guard evidence therefore cannot diverge after a crash.
Restore acquisition compare-and-swaps this same head, increments restoreEpoch and chooses a state
revision greater than current, snapshot and guard high-water. The head/events are backend-only,
excluded from backup/export and direct get/list/create/update/delete is denied to every client role.

Each memberDirectoryMigrations receipt has operationType `identity-key-bootstrap`,
`identity-key-reconcile`, `directory-forward`, `post-cutover-rollback`, `canonical-recovery`,
`member-directory-restore-recovery` or `global-legacy-elimination`. Its closed status values are planned, frozen, applying, verified,
completed, failed, compensating and aborted. Normal success transitions are only
`planned -> frozen -> applying -> verified -> completed`; frozen, applying or verified may become
failed; failed may become applying only for an exact-plan resume, or compensating for the same-plan
directory-forward reverse path; compensating may become aborted after exact prior-state
verification. A failed compensation remains compensating/frozen and resumes at its first missing
exact receipt. completed and aborted are terminal. The only additional failed transition is the
metadata-only identity-key-bootstrap `failed -> aborted` abandonment described above; it preserves
all keys and domain documents. The only short success transition is `planned -> completed` for
global-legacy-elimination, atomically with its marker/state revision/audit and all proof checks.
Identity, versions, MACs and counts are
immutable; each status transition and state transition shares one transaction with an append-only
audit event.

Chunk receipts are create-only with status=committed and phase `bootstrap`, `identity-reconcile`,
`forward`, `compensation`, `rollback-projection`, `canonical-recovery` or `restore-recovery`. Their ID is
`{operationId}:{phase}:{chunkNo}`. A phase starts at chunk 1. Entering another phase resets the
state's phase-local lastCommittedChunkNo to 0 in an audited transition; the value never decrements
within a phase and prior receipts remain immutable. A compensation receipt also binds the descending
sourceForwardChunkNo it reverses.

A lease lasts 120 server-clock seconds. The receipt fixes a maximum 30-minute initial
operationDeadline, except identity-reconcile-paged-v2 whose initial maximum is two hours. Only the
same operation/owner may renew before lease expiry, in a transaction that revalidates binding, plan
MAC, state and last chunk, increments stateRevision and audits the renewal. A live lease cannot be
stolen. An expired lease never unfreezes automatically: an audited recovery command must verify the
exact operation, receipts and state before issuing a new lease within the current operationDeadline.
If that deadline passed, recovery requires a distinct post-deadline-recovery confirmation, a fresh
Auth+App Check approval and full two-stage environment preflight. One transaction consumes that
approval, preserves the exact plan/mode/phase/freeze and issues a new lease plus a recovery deadline
no later than 30 minutes after server now. This applies to paged-v2 as well: its two-hour bound limits
the unextended run, while every later 30-minute attempt needs another non-replayable approval. The
transaction changes no domain document; it only advances state/guard/audit evidence. This escape
hatch prevents a permanent freeze without making expiry an authorization bypass.

Every T093 writer reads the state inside the same transaction as its domain changes, requires the
expected open canonical tuple plus complete matching identity-key baseline, and reserves every
present/new key. It increments stateRevision and advances the non-restorable guard atomically, even
after the global marker; a new student also increments the admitted rollback count while that marker
is false. This includes saveClientProfile, adult Auth linking, family/minor creation, admin create/edit
and PDF import. Self/guardian inputs reject all administrative/provenance fields; admin commands
require owner/administrator plus App Check and server-derived academy; the migration runner is not a
callable. State/guard absent, malformed or frozen, wrong mode/version or incomplete baseline aborts
with zero writes. Every migration/compensation chunk requires the exact frozen tuple, operation,
phase, revision, lease/deadline and last chunk, then advances stateRevision/lastCommittedChunkNo
atomically. Exact receipt replay may no-op only when receipt and advanced state match.

## Identity-key bootstrap and baseline semantics

Identity-key bootstrap is a separate operation that must complete before directory-forward:

1. After the environment preflight, dry-run independently reads at most 401 students and 401
   studentAdminProfiles ordered by document ID. It joins both sets, rejects every orphan/profile-ID
   mismatch, and direct-validates each same-tenant reference. More than 400 in either set, a duplicate
   current identifier or an invalid record rejects v1 without domain writes. The private plan freezes
   the exact ordered IDs, document versions and expected key tuples; receipt metadata contains only
   counts/MACs.
2. Confirmation acquires the bootstrap tuple/lease and moves the parent planned -> frozen, then
   repeats the bounded 401-document query under the freeze. Any added, removed or changed
   student/profile compared with the plan aborts before the first key write.
3. The plan partitions at most 50 students per bootstrap chunk. Each chunk direct-gets its planned
   students/profiles and all expected keys, creates only missing compatible keys plus its
   phase=bootstrap receipt/audit, and advances the state. Resume starts at the first missing exact
   receipt; it never uses a mutable live-query cursor. The first committed chunk moves the parent
   frozen -> applying in the same transaction; a zero-row plan uses an audited no-domain-write
   frozen -> applying transition before verification.
4. After all at most eight chunks, verification recomputes the expected current reservation tuples
   `(kind,keyId,ownerStudentId,digestVersion,secretVersion)` in canonical lexical order and produces
   identityKeyBaselineMac with its own integrity-MAC domain. Preserved obsolete keys may exist but
   are not part of this current-value baseline; any expected key missing or owned by another student
   fails closed.
5. One verification transaction re-reads every committed chunk, operation/state/revision/lease and
   the encrypted exact baseline artifact, recomputes the root, then moves only the parent applying ->
   verified and audits; state stays blocked/frozen with coverage incomplete.
6. One completion transaction requires that verified parent and exact same proof, writes
   identityKeyCoverage=complete, identityKeyBaselineMac, opaque identityKeyBaselineArtifactId,
   baseline counts/versions/completedAt, moves the parent verified -> completed and returns to the
   valid pre-cutover tuple while clearing lease fields. The artifact retains the exact sorted tuple
   set and private plan through the rollback window. A crash after verification resumes only this
   exact completion transaction; a crash cannot expose stable state with a non-completed parent.
   A failed bootstrap is resume-or-abandon: exact-plan resume continues at the first missing receipt;
   failed-bootstrap-abandon follows the preservation-only transition above and a later bootstrap
   reuses every compatible monotonic key.

identityKeyBaselineMac is deliberately a frozen proof of identities that predated writer
activation; it is not a global accumulator and normal writes never recompute it. Once coverage is
complete, each normal create/link/change transaction proves its affected old/current keys and
creates every new key atomically, so later identities are covered by their write receipts rather
than the baseline MAC. The receipt is the tenant document
`academies/{academyId}/memberDirectoryWriteReceipts/{receiptId}`, where the document ID equals
`receiptId` and matches `write-{64 lowercase hex}`. Its closed schema is exactly `receiptId`,
`academyId`, `actorId`, `requestMac`, `studentId`, `auditEventId`, nonnegative integer
`stateRevisionBefore`, positive integer `stateRevisionAfter=stateRevisionBefore+1`, literal
`status="completed"`, UTC-millisecond `createdAt` and literal `schemaVersion="1"`. It is backend-only, create-only and
metadata-only, and is written in the same canonical identity transaction as the student, admin
profile, keys, state/guard head/event and audit event. It never contains the raw request or a raw
membership/ID/VAT value. Replay verifies the request MAC and every referenced record; no update or
delete is permitted. Retention and deletion remain blocked until T011 defines and authorizes them.
Restore or a reconciliation alarm first freezes writers, sets coverage
incomplete and requires a new versioned reconciliation before reopening. T093 never changes the
identity-key secretVersion: safe rotation requires an independently approved multi-version
read/deny plus single-write protocol that preserves every historical reservation, and is outside v1.

After administrative cutover, `identity-key-reconcile` is the only operation that may replace an
identity baseline, always under the same secretVersion. Its approved acquisition transaction starts from the exact
canonical/open/idle tuple, preserves globalLegacyReadEliminated, sets write mode blocked, freeze,
phase=identity-reconcile and coverage=incomplete, issues a fresh lease and moves its parent planned ->
frozen. While the global marker is false, protocol `identity-reconcile-bounded-v1` uses the same
at-most-401 scan and at-most-400 identities as bootstrap. After the marker is true, protocol
`identity-reconcile-paged-v2` is independent of rollback capacity. It first reads the same
state/guard revision, then independently enumerates students and studentAdminProfiles by document ID
in pages of 200. Row 10,001 in either collection fails. It joins every profile to the same-ID student,
rejects an orphan, tenant/version/ID mismatch or invalid current identifier, and binds exact ordered
manifests, counts/roots, starting stateRevision and the unchanged secretVersion. It finally re-reads
state/guard; any revision/MAC change during either paged scan discards the plan before a planned
receipt exists. Acquisition rechecks that same revision before freeze. It then uses at most 50
student bundles per chunk (at most 200 chunks) and a two-hour initial operation deadline; crossing a
count/byte/deadline bound requires a later protocol and fails before freeze or key writes.

Both protocols use first-chunk frozen -> applying (or an audited zero-row transition), an applying ->
verified transaction and a separate verified -> completed transaction. Completion binds a new exact
baseline artifact/MAC under the unchanged secret, and atomically restores canonical-v1/open/idle; if
the global marker was true it remains true and no legacy reader is enabled. Failure stays frozen for
exact-plan resume. Pre-cutover legacy state uses identity-key-bootstrap instead; rollback-readonly
must complete canonical-recovery before reconciliation. Every lookup and new reservation continues
to use the unchanged secret, so an obsolete immutable key still blocks reuse of its old raw value.

Every canonical transaction that creates a new student while the global marker is false also checks
rollbackProtocolVersion/capacity/count and increments rollbackEligibleStudentCount in that same
transaction. Deactivation or other mutations never decrement it. At count 400, the next create fails
with zero student/profile/key/audit writes until T097 atomically disables legacy rollback or a new
approved rollback-v2 replaces the protocol. Two concurrent creates at 399 serialize on state: one
may reach 400 and the other fails. This preserves executable rollback-v1 throughout the reversible
window rather than silently exceeding its plan bound.

## Environment guards

The runner has two disjoint preflight algorithms; code cannot fall through from one to the other.
Every non-restore operation inherits the single-project two-stage binding proven by T100:

1. Parse a strict CLI before importing/initializing Firebase Admin or reading source files. Require
   explicit project, academyId and operation; reject unknown, duplicate, empty or conflicting flags.
2. Gather project IDs from the explicit argument, GCLOUD_PROJECT, GOOGLE_CLOUD_PROJECT and
   FIREBASE_CONFIG. Every discovered ID must be present and equal. Reject bptjersey-f5a25 exactly
   plus production-like classifications.
3. Emulator requires project demo-bpt-jersey and FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 exactly.
   Staging remains fail-closed because its positive project allowlist is empty until T099 and an
   operator checkpoint.
4. Validate the source root without reading it: reject symlinks/reparse points or resolved paths
   outside the approved input directory. Secrets/credentials are never CLI arguments.
5. After dynamically importing Firebase Admin, inspect every initialized app. Missing project IDs,
   multiple values or disagreement with stage 1 reject before any Firestore get/query/store/source
   read. Re-run the complete binding immediately before the first Firestore operation.

Restore-rehearsal instead uses this exact dual-app algorithm:

1. Before Firebase imports or artifact reads, require distinct `--source-project=demo-bpt-jersey`
   and `--target-project=demo-bpt-jersey-restore`, one explicit academyId and restore operation. A
   generic project/target flag, duplicate, empty, swapped or third project value is invalid.
2. GCLOUD_PROJECT, GOOGLE_CLOUD_PROJECT and FIREBASE_CONFIG are global source context only: each may
   be absent, but every project ID they contain must equal demo-bpt-jersey. A target, production or
   third ID in those variables is ambiguous and fails. The two CLI role IDs are intentionally not
   compared for equality with each other.
3. Require FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 and
   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 exactly, and reject staging/remote configuration before
   any Firebase or artifact I/O. `demo-bpt-jersey-restore` is allowlisted only inside this runner;
   web, Functions and every other application/bootstrap path must hard-deny that project ID.
4. Validate every artifact/input path without reading it using the same no-reparse-point approved-root
   rule.
5. Dynamically import Admin and require getApps() to be empty. Initialize exactly two non-default
   named apps, `member-directory-restore-source` and `member-directory-restore-target`, with explicit
   projectId values matching their CLI roles. Inspect the exact two-app set and each options.projectId;
   any default, extra, preinitialized, missing or swapped app fails. Every Auth/Firestore handle is
   created from its named app, never ambient getAuth()/getFirestore(). Re-run app, host and role
   binding before the first source read and before the first target read/write.
6. Resolve test secrets only by the exact tuple `(role, projectId, purpose, version)` through the
   injected Emulator secret adapter. Source/target and identity/integrity/cursor material are all
   distinct, no ambient/global fallback exists, and any substitution fails before artifact/domain
   reads.

Mutating operations use distinct exact confirmation tokens for bootstrap, bootstrap abandonment,
forward, failed-forward compensation, post-cutover rollback and expired-deadline recovery. A token
for one operation cannot authorize another.

## Forward phases

### Phase 0 - implementation

- Add strict domain contracts and server-owned parsers.
- Add canonical directory readers and writers behind dependency injection.
- Add HMAC-backed uniqueness reservations and academy-scoped freeze/cutover state.
- Add deny-direct Rules, raw admin-field single-index exemptions and backup coverage.
- Add tests before production behavior.
- Do not export or run a migration command against remote Firebase.

### Phase 1 - Emulator rehearsal

1. Seed only synthetic members, students, families, memberships and finance.
2. Run dry-run and preserve the metadata-only receipt.
3. Verify every classification and zero writes.
4. Confirm only an all-eligible synthetic plan.
5. Verify students and studentAdminProfiles atomically.
6. Verify search, membership, booking, attendance, promotion and report use one studentId.
7. Exercise replay, divergence, concurrency, orphan and cross-tenant failures.
8. Exercise functional rollback.
9. Remove emulator fixtures.

### Phase 2 - isolated staging

This phase is blocked until T011, T057, T098 and T101 are closed and the operator approves creating
and using a separate Firebase project.

1. Verify project identity, budget alerts, access, retention and backup destination.
2. Use controlled synthetic or explicitly approved sanitized fixtures only.
3. Repeat the Emulator rehearsal with real Auth, Functions and Firestore boundaries.
4. Verify cleanup and rollback.
5. Do not copy Regyfit member PII.

### Phase 3 - production

Not authorized by T092. It requires a new explicit checkpoint, a verified backup, an approved
retention policy, an approved reconciliation manifest and a fresh dry-run.

## Confirmation algorithm

1. Acquire memberDirectoryStates/current in one transaction with a bounded lease and exact initial
   stateRevision/count/guard. Recompute the receipt equation and reject an over-capacity/stale plan
   with zero writes. Otherwise set the forward frozen tuple, consume the exact approval and move the
   parent planned -> frozen; the administrative reader remains legacy-v1.
2. Revalidate target, allowlist, receipt/manifest expiry, MACs/public hashes, reviewer/actor, lease and freeze
   state before any domain write. While frozen, enumerate at most 401 current students and every
   planned create target; require the exact pre-existing/final counts again. A mismatch leaves zero
   domain writes and enters the documented exact-plan abort/recovery path.
3. Re-read every legacy row, existing student/admin profile, family/relationship used by a minor and
   current identity-key candidate. Compare the private manifest fingerprints and reject the whole
   plan if any input changed, mapping is ambiguous or row is no longer eligible.
4. Verify the separately completed identity-key bootstrap receipt/baseline, then re-check every
   current key touched by the forward plan. Any missing baseline, duplicate owner or unknown key
   version aborts; directory-forward never silently performs bootstrap work.
5. For a createable adult, use the backend-generated opaque targetStudentId already bound in the
   reviewed private manifest. Create active=false/status=inactive. Never derive or reuse
   legacyMemberId as a new document ID.
6. For an explicit match, keep the reviewed existing studentId and create an admin profile only when
   absent and compatible. A minor is eligible only when that existing student, active family and
   active relationship all match the manifest. No existing student/profile is overwritten.
7. Process at most 50 rows per transaction. Each transaction first reads current state, exact
   revision/lease/expiry/migration/last chunk, every referenced document, every uniqueness key and
   every create target. It then creates only additive documents, a metadata-only receipt containing
   inputMac/outputSetMac plus previousStateRevision/committedStateRevision, one append-only audit
   event, and advances stateRevision/lastCommittedChunkNo atomically. The first committed chunk also
   moves the parent frozen -> applying; a zero-row plan uses the same audited no-domain-write
   transition.
8. After every chunk, re-read its trusted output plan and documents and reconcile exact paths,
   canonical content MACs, versions, counts, state revision and receipt root. A receipt replay is a
   no-op only when every value matches.
9. Do not create users, families, relationships, memberships, invoices, payments or progress.
10. One verification transaction re-reads every committed chunk, output, total planMac, complete
    identity-key baseline artifact/MAC/version, exact student count and current lease/revision, then
    moves only the parent applying -> verified and audits while state remains legacy/blocked/frozen.
11. One completion transaction requires the verified parent and unchanged proof, sets readerVersion
    and directoryWriteMode to canonical-v1, globalLegacyReadEliminated=false,
    rollbackProtocolVersion=legacy-projection-v1, rollbackCapacityLimit=400 and
    rollbackEligibleStudentCount to the receipt's postCutoverAdmittedStudentCount (at most 400), moves the parent verified ->
    completed, releases freeze/lease and appends member-directory.cutover. A crash after verification
    resumes only this exact transaction; partial Students remain invisible until it commits. T097
    alone may later set the global marker after proving zero members dependencies.

The 50-row budget assumes the worst current row writes student + admin profile + five uniqueness
reservations plus chunk receipt/audit/state (353 writes), below Firestore's 500-write transaction
limit and leaving size headroom. T093 must calculate the actual serialized byte/read/transform budget,
reject 51 rows or byte budget + 1 before writes, and never increase this constant without fresh
Emulator/load evidence. A single chunk failure cannot be skipped or retried with different content
under the same receipt. One operation accepts at most 400 rows/eight chunks; a larger source requires
member-directory-v2 design and fails before freeze, source reads or writes. Multiple migration IDs
must never split one v1 cutover. The current sanitized PDF run records 243 members, so the v1 bound
covers that known source without claiming anything about a future Regyfit export.

## Reference closure for failed-forward compensation

T093 owns a versioned `member-directory-reference-closure-v1` registry. CI fails when the data model
adds a student reference without updating this registry/MAC. Runtime compensation first verifies the
exact registry/code version and enumerates the academy's direct/nested collection names; an unknown
collection or schema version blocks deletion.

For each candidate student bundle, the registry direct-gets studentLevelProgress and performs
same-academy `studentId == target LIMIT 1` checks for relationships, memberships, bookings,
waitlistEntries, bookingQuotaStates, attendance, checkouts, assessments, levelPromotions,
recognitions, medicalLeaves, healthProfiles, safeguardingCases, consents, documents and
retentionAlerts. It also checks the transitional evaluations, graduations and medicalLeaves
collection groups with validated tenant paths. Typed/embedded references in messages,
notificationPreferences, deliveryEvents, familyAchievementSnapshots, exports and auditEvents use a
bounded at-most-401 document scan per collection; 401 blocks compensation rather than assuming zero.
Migration audit targetRef points to the operation, not an individual student.

Compensation processes exactly one student bundle per transaction because every closure read occurs
before writes. A transaction has hard caps of 2,500 document reads, 8 MiB of decoded document bytes
and 15 seconds of server elapsed time, leaving margin below Firestore's 20-second lock deadline;
crossing any cap aborts before the first write and preserves the freeze. Any reference hit preserves
the entire affected student/profile/key bundle. All
reference queries, byte/read/time bounds and the closure registry are exercised against Emulator; a
new reference cannot be treated as harmless by default.

## Failed-forward containment before cutover

A failed chunk is not the same operation as rollback after a live cutover:

1. Keep readerVersion=legacy-v1, directoryWriteMode=blocked and freezeStatus=frozen. Record the
   failure without changing the reader.
2. Permit only an exact-plan resume, or a separately confirmed compensation using the same private
   manifest/plan MAC. A divergent retry needs a new operation ID after this operation reaches
   aborted; it cannot run while frozen.
3. Acquire compensation using the approval-consumption transaction defined above. It moves only the
   failed parent to compensating, switches phase/resets lastCommittedChunkNo, issues the lease and
   writes state/guard/audit evidence before any reverse-domain chunk. Zero committed chunks use the
   explicit proof-only compensating -> aborted path.
4. Compensate completed chunks in reverse order. Every transaction re-reads the current
   stateRevision, active operation/phase, lease/expiry/deadline and chunk receipt before any target.
5. Recompute each target path and canonical document MAC from the protected output plan; require
   its prior-absence assertion, receipt outputSetMac, unchanged current content/update version and
   a bounded zero-reference scan. Never infer ownership from a document ID or migrationId alone.
6. Delete only targets created by this failed operation that satisfy every proof. A reservation may
   be removed only when the same operation created it, the pre-operation plan proves prior absence,
   and the runner reopens the exact baseline artifact, recomputes identityKeyBaselineMac and proves
   by canonical sorted-set lookup that its tuple is absent. Content/owner/identifier must be unchanged
   and no later writer or reference can be proven. The identifier-bearing profile or newly created
   student is removed in the same transaction, so no surviving document points at the deleted
   reservation. The pre-existing complete baseline marker/MAC is unchanged. This exception is exercised with synthetic
   Emulator data in T093; any remote use additionally requires T011 policy, verified backup and a
   separate operator checkpoint. Migration/chunk receipts and audit events are never deleted.
7. If any proof is missing, preserve every uncertain document and the freeze for operator review.
   If compensation restores the exact preOperationSetMac, counts and identity baseline, mark the
   migration aborted, release the lease/freeze and preserve migration/chunk/audit receipts.

## Functional rollback after administrative cutover

Post-cutover rollback is projection-first, non-destructive and available only while
globalLegacyReadEliminated=false and the tested privacy-safe legacy-rollback-v1 adapter remains
deployed:

1. After environment/approval guards, generate a zero-write private plan by reading at most 401
   canonical students and mapped original/projection members. More than 400 is outside rollback-v1
   and fails before freeze/writes. Verify the exact cutover receipt, code/schema version and a
   verified backup-v3 isolated-rehearsal I4 attestation. Use a confirmation token distinct from
   failed-forward compensation.
2. After the zero-domain-write dry-run, create the metadata-only planned operation receipt. Only then
   may Auth + App Check mint the exact post-cutover-rollback approval. Its acquisition transaction
   consumes that approval, checks state/guard/plan, moves the parent planned -> frozen, acquires a new
   bounded lease, freezes canonical member-directory mutations and sets
   directoryWriteMode=blocked/operationPhase=rollback-projection. Re-read the exact planned sets; any
   addition, removal, version change or divergent memberId collision aborts before projections, and
   originals are never overwritten.
3. Partition at most 50 projections into at most eight transactions. Each verifies state/lease,
   performs all reads first, creates projections plus a phase=rollback-projection receipt/audit and
   advances state. The first committed chunk also moves the parent frozen -> applying; a zero-row
   projection uses an audited no-domain-write frozen -> applying transaction. Exact resume starts at
   the first missing receipt; lease renewal follows the shared protocol and a failed chunk leaves
   readerVersion=canonical-v1.
4. The persisted canonical-rollback-projection allowlist is exactly memberId=studentId, academyId,
   fullName=`Canonical student`, paymentStatus=unknown, gender=unknown,
   membershipStatus=inactive, inactiveAt/createdAt/updatedAt=operationWriteTime,
   createdBy/updatedBy=`member-directory-rollback`, source=`canonical-rollback-projection` and
   schemaVersion=`1`. Every optional MemberRecord field is absent. The adapter reads current Student
   data for display; the legacy document never duplicates DOB, contact, membership/ID/VAT,
   frequency or provenance data. Direct Rules access remains denied and T093 removes single-field
   indexes for those raw legacy fields before cutover.
5. Re-read every original/projection and verify exact counts, MACs, exact-field/parser compatibility
   and the legacy-rollback-v1 directory result. For an original member row, the adapter derives its
   legacy-member-id blind key, verifies the current admin-profile value and returns the mapped
   ownerStudentId as the public studentId. For a canonical-rollback-projection row, it verifies
   memberId directly against the canonical student. It fails closed on missing, stale or duplicate
   mappings and never returns legacyMemberId. One transaction verifies every create-only chunk
   receipt still has status=committed and matches the plan/output, then moves only the parent
   operation receipt from applying to verified; chunk receipts never change status.
6. Only with the parent operation verified and every chunk still committed, switch readerVersion to
   legacy-rollback-v1 in one transaction, keep directoryWriteMode=blocked/freezeStatus=frozen, clear
   activeOperationId/lease/deadline, reset lastCommittedChunkNo=0, move the parent to completed and append the
   rollback audit event. This is the stable rollback-readonly tuple. Canonical students, admin
   profiles and identity keys are never deleted by this rollback.
7. The degraded legacy view remains read-only until a separately approved canonical-recovery
   operation acquires from the stable rollback-readonly tuple, creates a fresh lease and moves its
   parent planned -> frozen. It revalidates every projection/mapping in bounded
   phase=canonical-recovery chunks; the first committed chunk moves the parent frozen -> applying.
8. A verification transaction checks every committed recovery chunk and current canonical record,
   moves only the parent applying -> verified and keeps the directory blocked/frozen. A separate
   completion transaction requires that proof, moves verified -> completed, restores
   readerVersion/directoryWriteMode=canonical-v1, open/idle, clears the lease and preserves
   globalLegacyReadEliminated=false plus the exact rollback protocol/count.
9. A crash resumes the first missing exact chunk, verification or completion transition. Legacy
   projections remain read-only rollback material and are not deleted by recovery. An extended
   writable legacy mode would require a new approved compatibility design; T092 does not silently
   reintroduce permanent dual-write.

A destructive down operation is prohibited unless a separate review proves each target was created
by the migration, remains unchanged, has zero references, has a verified backup, satisfies T011 and
has explicit operator approval.

## Backup v3 isolated restore-rehearsal semantics

Backup v3 is an authenticated consistent snapshot. A rehearsal-eligible artifact must have been
captured from one exact stable source tuple: legacy/open/idle, canonical/open/idle or stable
rollback-readonly. A snapshot taken during bootstrap, forward, reconcile, compensation, rollback
projection, recovery or restore is evidence-only and cannot be replayed. Its manifest binds source
project/academy, snapshotReadTime, state revision/global marker, reader/write/freeze/phase values,
rollback protocol/count, source guard revision/marker/count/epoch/event MAC, code/schema versions,
all direct/nested collection counts and roots, identityKeyBaselineMac/ArtifactId and required secret
versions. `backupManifestMac` is a domain-separated source-integrity HMAC over the canonical closed
v3 manifest, including privateManifestMac and every field above. The exact source
`memberDirectoryStates/current` is captured inside the encrypted artifact
but classified as source-authority evidence, never as a target payload document. Its canonical
path and full closed body are covered by a separate domain-separated `sourceStateEvidenceMac`, which
is bound by the v3 manifest, target restore parent and final source-local I4
attestation; planning, I2/I3 verification and I4 reopen it and compare every snapshot-state field before any
transition. The target creates its own state only in target-control, so no path is overwritten or
double-classified. The encrypted artifact store retains exact baseline/reconciliation manifests
separately; the rehearsal must reopen and verify every bound artifact.

The manifest binds literal `artifactDispositionVersion=member-directory-restore-v1` and this closed
source-path disposition table; v1 performs no remap:

| Source artifact path class                                           | Disposition             | Target plan set |
| -------------------------------------------------------------------- | ----------------------- | --------------- |
| Exact `academies/{academyId}/memberDirectoryStates/current`          | `verify-only-authority` | none            |
| `academies/{academyId}/memberDirectoryWriteReceipts/{receiptId}`     | `materialize-exact`     | payload         |
| Every other allowlisted direct/nested v3 tenant path                 | `materialize-exact`     | payload         |
| Cursor state and top-level guard/attestation/attestation-consumption | `exclude-before-backup` | none            |
| Any unlisted path, disposition or target-control source document     | reject                  | none            |

The backup manifest count/root covers both materializable documents and the verify-only state; the
payload count/root is derived only from materialize-exact rows, while sourceStateEvidenceMac covers
the one verify-only row. Their counts must reconcile exactly or planning fails. Write receipts are
restored at the identical tenant path as quarantined identity evidence; they never become Auth,
writer or target-control authority. Target-control is generated solely by the rehearsal and can
never be sourced from the artifact.

T092/T093 authorize restore only between two exact local Emulator project namespaces: source
projectId=demo-bpt-jersey and targetProjectId=demo-bpt-jersey-restore, both with Firestore and Auth on
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 and FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099, different
project IDs and the same academyId. The exact dual-app algorithm in Environment guards applies; the
single-project project-ID equality rule does not. The target must have zero Auth users, zero Firestore
documents at any depth, no prior control-plane head and no application workload or claims pointing to
it. Same-project, remote host, nonempty target or ambiguous/extra Admin app fails before source
artifact/domain reads. The target remains isolated from every web/Functions runtime for the whole
rehearsal.

The authoritative emptiness/exact-set proof is `firestore-namespace-inventory-v1`, an Emulator-only
recursive database inventory. It obtains one snapshotReadTime, then starts at
`projects/{targetProjectId}/databases/(default)/documents`. For every queued parent it paginates
ListCollectionIds at that readTime, validates `(parentPattern, collectionId)` against a closed
versioned registry, and paginates ListDocuments with `showMissing=true`, the same readTime and
pageSize=200. Every real document joins the canonical path/count/root set. A missing document
reference is also recorded and queued so its child collection IDs are discovered; it is invalid
unless it is the single declared structural anchor `academies/{academyId}`. Thus an unknown
collection, a second academy, and a subcollection beneath a missing parent are all visible.

Every expected target document belongs to exactly one of two disjoint plan sets. `payload` contains
all materialized documents reconstructed from the v3 artifact, including non-state historical tenant
coordination evidence but excluding source-authority evidence such as `memberDirectoryStates/current`;
it is capped at 10,000 real documents and 256 MiB canonical decoded path+body bytes. `target-control`
contains only state, current restore operation/chunks, target approval consumptions, guard head/events
and restore audits generated by this rehearsal; it is capped at 2,048 real documents and 32 MiB.
Before every control write the runner proves the new exact set remains within that budget. The
inventory hard caps are therefore 12,048 real documents, 288 MiB and 12,049 visited document paths,
the last value allowing only the single missing structural academy anchor. It calculates separate
payload/control counts, byte counts and HMAC roots plus a combined root. Overlap, an unclassified
document or another missing parent fails immediately.

The inventory also rejects a repeated page token, duplicate/out-of-project/out-of-parent path,
malformed response, unsupported readTime/showMissing behavior, collection at the wrong parent
pattern or depth beyond the registry. Exact ordered paths live only in an encrypted private artifact;
receipts retain version, counts and HMAC roots. Calls use only the literal loopback host, `(default)`
database, allowlisted demo project and a local synthetic credential; there is no ADC/TLS/remote
fallback. listUsers(maxResults=1) and direct guard/state gets remain independent additional checks.

Checkpoint I0 runs before artifact bodies and requires the initial target inventory to contain no
real document and only the optional empty structural academy anchor. I1 after preparation accepts
only the operation-bound control-plane set. A retry must match the exact operationId/planMac,
state/guard/receipts and expected created set/root for its last committed chunk. I2 before applying
-> verified and I3 immediately before verified -> completed require the complete expected logical
and control-plane set/root. I4 after completion authenticates the terminal set/root for the separate
source attestation defined below. It never restarts as a new prepare over a partial
target. Per-chunk transactions still direct-get every planned path and remain create-only; unrelated
concurrent drift cannot pass the next inventory checkpoint or make the target serving.

The rehearsal runs under one fresh `emulators:exec` process with no import and Emulator
`singleProjectMode=false`; the runner is the only target writer. This isolation plus I0-I4 is a local
test guarantee, not a production fence.

The dual-app runner uses the source project's versioned integrity secret only to verify the source
artifact/guard and source handoff, and a distinct target-project secret to MAC target
state/operation/chunk/consumption receipts. The two secrets and versions are bound in the plan and
cannot be substituted. Source identity-key material restored as quarantined evidence is verified with
its bound source identity-key version; it is never treated as target-project writer authority.

Because target Auth is empty, restore-acquire, restore-complete and restore post-deadline approvals
originate from a currently active source owner/administrator using source Auth + App Check. They use
an explicit two-transaction saga, never a cross-project Firestore transaction:

1. A source Firestore transaction revalidates the reviewer role and approval, then create-only writes
   memberDirectoryApprovalConsumptions/{approvalId} with stage=`source-handoff`. It binds both
   project IDs, academyId, target operation/plan/revision/epoch, authorityMode, exact transition, a
   source-verified target-state attestation, issuedAt, expiresAt no more than 60 seconds later and a
   source HMAC handoffMac. This consumes the source approval without mutating target state.
2. The target transaction verifies every handoff binding/MAC/expiry against its current target state,
   then create-only writes the same approvalId under target
   memberDirectoryApprovalConsumptions with stage=`target-transition`, sourceHandoffMac and its own
   target MAC while applying the exact target state/operation/guard transition atomically. Existing
   target consumption, revision drift, wrong stage/project/epoch/transition or expiry causes zero
   target writes.

A crash after source-handoff may resume only that exact unexpired handoff; the target receipt makes
target-transition application exactly-once. If it expires or target CAS fails, the consumed source handoff remains inert
and a new source approval/handoff is required. Role revocation before source-handoff blocks issuance;
revocation after it does not retroactively revoke the already consumed 60-second capability. A
target-authenticated approval, cross-project reuse or an attempt to reuse one handoff for another
stage fails. This saga applies equally to acquire, complete and restore post-deadline recovery.

The source non-restorable guard is the snapshot high-water proof. Planning re-reads and verifies its
head/event chain; snapshot revision/count must be at least that current head and its marker cannot be
lower. A pre-global false snapshot after a true source marker is evidence-only. The target creates a
fresh revision-zero guard during preparation and restore acquisition advances it beyond the snapshot
revision. No source guard/state/lease/approval is copied as authority.

Firebase Auth objects and authority are never restored. V3 may bind a separately encrypted inventory
of referenced UID, creationTime, disabled/token-valid-after metadata and selected claims, without
credentials, tokens, passwords or MFA secrets. To keep family/minor and historical referential
invariants exact, the rehearsal preserves the logical Firestore contents of students.userId,
auth-user-id reservations, users, staff, families and relationships as quarantined evidence; it does
not force active records into an invalid partial inactive projection. The restore operation, both
handoff stages, target completion state and target-transition consumption bind literal
authorityMode=`quarantined-no-auth`.

Those Firestore references grant no authority: target Auth must remain empty, every application
runtime rejects the restore-only project ID at bootstrap, directory readers reject every prepared,
active and terminal restore phase, and no workload targets that project. listUsers(1) is rechecked before acquisition, every chunk transition, verification and
completion; any user blocks progress. A UID created after a check still cannot activate the blocked,
unserved target and is detected by the next check. Relinking, target-key rederivation or promotion to
a serving tenant is a separate future operation that must revalidate every family/relationship and
Auth binding; it can never reuse the quarantined receipt as activation authority.

Preparation verifies the stable source backup, backupManifestMac/sourceStateEvidenceMac, source guard,
exact Emulator pair, private artifacts, quarantined-no-auth plan and I0-empty target. It then executes
one target Firestore transaction that
create-only writes memberDirectoryStates/current, the top-level guard head, its revision-zero event,
the metadata-only planned member-directory-restore-recovery parent binding disposition version and
both evidence MACs, and
preparation audit. The exact
prepared state is canonical-v1/blocked/frozen/restore-prepared, lastCommittedChunkNo=0,
preparedOperationId set, no active operation/lease/deadline and authorityMode quarantined in the
parent. A crash before commit leaves I0; a crash after commit leaves the complete I1 set. Exact retry
returns that I1 result and any missing/divergent member fails rather than reparing a partial target.

Only after I1 may a fresh restore-acquire approval bind that prepared operation, target revision and
next restoreEpoch. The source-handoff/target-transition saga consumes it; its target transaction
compare-and-swaps the target guard, advances target event/epoch/revision beyond the snapshot, moves
planned -> frozen, clears preparedOperationId, sets activeOperationId, issues a lease and enters
canonical-v1/blocked/frozen/restore-recovery. It creates no restored payload document.

The full operation accepts at most 10,000 restorable payload documents and 256 MiB canonical decoded
payload bytes, plus only the exact target-control headroom defined above, and has a 30-minute initial
deadline. Each transaction direct-gets at most 40 planned payload documents, reads
at most 2,500 documents total, decodes at most 8 MiB, performs at most 100 writes and runs at most 15
server seconds. It uses create-only writes into the isolated target; any existing planned target,
planned count/root drift or exceeded bound aborts before that chunk writes. The first chunk moves
frozen -> applying; zero rows use an audited no-domain-write transition. Verification scans the
still-isolated target in ID pages of 200, matches inventory I2, recomputes every
logical root/count and the quarantined source identity baseline, then moves applying -> verified.

A distinct restore-complete approval/handoff is bound to the verified
revision/epoch/logical roots. Its target transaction moves the parent verified -> completed and enters only
canonical-v1/blocked/frozen/restore-rehearsal-complete with no active operation, lease or deadline and
lastCommittedChunkNo=0. Application bootstrap rejects that target project and the directory parser
rejects the terminal tuple; completed
means the artifact was reconstructed and verified, never that a serving tenant was activated. A
crash resumes only the exact next transition.

Completion is not itself the immutable cross-project proof. The attestationId is a deterministic
opaque source HMAC over stable completion identity: both projects, academy, target operation,
completed revision/epoch, restore-complete approval/consumption, backupManifestMac and
sourceStateEvidenceMac. Before creation the source workload direct-gets that ID. If absent, the runner
executes I4 at one attestedReadTime, verifies the exact terminal state, completed parent,
target-transition consumption and payload/control/combined roots, and computes
attestedTargetInventoryMac with the target integrity secret. The allowlisted source workload submits
only that bounded evidence; one source transaction reopens the matching stage=source-handoff
completion consumption and create-only writes
`memberDirectoryRestoreAttestations/{attestationId}` plus a metadata-only audit.

Both attestedTargetInventoryMac and verificationTargetInventoryMac use the same domain-separated
target HMAC schema over inventory version, target project/academy/operation/revision/epoch,
authorityMode, their own readTime, terminal state/parent/consumption MACs and all three
counts/bytes/roots. sourceAttestationMac is a source-integrity HMAC over every closed attestation
field except itself. Attestation creation may reference an expired source handoff only after proving
its target-transition consumption occurred before handoff expiry; expiry never reauthorizes a new
target transition.

The create-only attestation binds sourceProjectId, targetProjectId, academyId, targetOperationId,
target completed stateRevision/restoreEpoch, authorityMode, artifactDispositionVersion, backupManifestMac,
sourceStateEvidenceMac, inventoryVersion, attestedReadTime, payload/control/combined counts, byte
counts and roots, target restore-complete approvalId, sourceHandoffMac, targetConsumptionMac,
attestedTargetInventoryMac, source integrity version, sourceAttestationMac, createdAt/workload and
schemaVersion. It contains no participant path or raw field and is backend-only, non-restorable and
excluded from tenant backup/export.

An exact retry first validates the existing sourceAttestationMac, then runs a fresh target inventory
at a new verificationReadTime. It returns the existing attestation only when disposition/inventory versions,
projects/academy, operation/revision/epoch, authority mode, terminal state/parent/consumption,
manifest/state-evidence MACs, counts, bytes and roots still match. It computes a separate
verificationTargetInventoryMac; a different readTime and therefore a different valid inventory MAC
are expected and never overwrite the attested fields. Missing or divergent stable evidence fails. A
crash before create reruns I4; a crash after commit discovers and verifies the existing document.

T097 performs that same fresh verification before creating its source global operation. Its planMac
binds the attestation ID/sourceAttestationMac/attestedReadTime/attestedTargetInventoryMac, all stable
roots and bindings, plus verificationReadTime/verificationTargetInventoryMac and expected source
revision. The global marker transaction then direct-gets it and create-only writes
`memberDirectoryRestoreAttestationConsumptions/{attestationId}` with source global operation, state
revisions before/after, both read times/inventory MACs, attestation MAC and timestamp in the same
source transaction as marker/guard/event. Exact same-operation replay is a no-op; any reuse or
divergence fails. This is the only meaning of consuming restore proof; neither the mutable target
parent nor an approval receipt is called the terminal attestation.

In-place overwrite or promotion to a serving tenant is not designed or authorized here. It requires
a later ADR with a tenant-wide domain-write fence/versioned namespace cutover and a non-restorable
Auth/claims authority revision shared by every provisioning/revocation path, plus T011, verified
backup, cost/retention decisions and a new operator checkpoint. T093 must not implement or imply that
activation path.

## Required proof before directory cutover

- Domain contracts and malicious-input tests.
- Store atomicity, tenant isolation, uniqueness, bounded-query and replay tests.
- Firebase Emulator integration and Firestore Rules get/list/create/update/delete denial.
- Member import classification, privacy projection and zero-write conflict tests.
- Metadata-only logs/receipts and backup v3 restore rehearsal, including rejection when the exact
  identity-key digest/secret versions are unavailable after restore.

The directory reader may switch only when all normal `members` writers are gone. Compatibility
readers in Levels/reporting remain explicitly registered and globalLegacyReadEliminated stays false.

## Required proof before global legacy-read elimination

T097 creates a metadata-only planned memberDirectoryMigrations receipt with
operationType=global-legacy-elimination. Its planMac binds the exact canonical cutover operation,
stateRevision, identity baseline/version, deployed code/schema hashes, the versioned dependency
registry and zeroDependencyProofMac, backupManifestMac/sourceStateEvidenceMac plus the source-local
create-only I4 attestation ID/MAC/attested read time and inventory MAC/target
project/revision/epoch/roots, fresh verification read time and inventory MAC, test evidence hashes and
a short expiry. Before creating this source planned operation, the planner verifies the attestation
and repeats target inventory I4 through the dual-project preflight. The source plan then carries that
authenticated proof, so the marker transaction never assumes a cross-project Firestore transaction.
It contains no source row or participant identifier.

The marker transaction is authorized only from the exact
canonical-v1/canonical-v1/open/idle tuple with globalLegacyReadEliminated=false, no active operation,
lease or deadline and lastCommittedChunkNo=0, complete matching identity baseline, completed directory-forward,
verified backup-v3 isolated-rehearsal attestation and an unexpired exact global-legacy-eliminate approval. The
zero-dependency proof must cover code/static imports, runtime direct and collection-group inventory,
all callables/jobs/UI routes and completed migration/adaptation of nested evaluations, graduations
and medical leaves. Every count is zero except the preserved legacy documents themselves.

One source Firestore transaction direct-gets and revalidates state, guard head/event MAC, operation,
approval, bound restore attestation and dependency proof; it consumes the approval and create-only
writes the matching memberDirectoryRestoreAttestationConsumptions receipt, increments stateRevision,
creates/advances the matching guard event/head with its ever-eliminated marker true, sets
globalLegacyReadEliminated=true, moves only this operation from planned to completed, sets
rollbackProtocolVersion=disabled while retaining the final student count, and appends the audit
event. Because rollback acquisition writes
the same state document, either rollback or elimination wins; the loser retries into a forbidden
tuple and performs zero writes. An exact replay of the same completed operation is a no-op, while a
different operation, state revision, proof/MAC/hash or attestation is rejected. The marker never returns
to false in v1, disables the legacy rollback adapter and still does not delete members; retention or
destructive cleanup remains a separately approved T011 operation.

Required evidence is: domain/malicious-input, store atomicity, tenant, uniqueness, bounds and replay;
Firebase Emulator; explicit Rules denial; import conflict tests; Levels/promotion/report regressions;
authenticated desktop/mobile golden path; metadata-only telemetry; synthetic load; backup-v3
restore/rollback rehearsal; and verify:mvp with no skipped golden-path test.

## Required RED matrix for T093/T097

T093 must capture these failures before implementation:

- reject academy/path mismatch, document ID mismatch, client-owned envelope fields and unknown keys;
- reject every invalid source/provenance combination and any admin profile without a same-tenant
  student;
- reject a minor without an explicit same-tenant family and active relationship, with zero writes;
- prove NFKC/trim/case normalization, tenant separation, missing HMAC key/version, same-key replay,
  unambiguous length encoding, all five key kinds, different-owner collision and concurrent
  reservation races;
- reject empty, malformed, shorter-than-32-byte, placeholder, equal-purpose and cross-project/
  environment identity/integrity/cursor secrets; accept explicit distinct test keys only under the
  exact loopback demo-bpt-jersey or demo-bpt-jersey-restore Emulator binding and use constant-time
  equal-length MAC comparison;
- prove bootstrap covers every existing students.userId/current admin identifier, rejects duplicate
  owners and keeps normal writers/cutover fail-closed until the exact coverage marker verifies;
- prove bootstrap/reconcile finalization reopens the encrypted exact baseline artifact, recomputes
  its MAC, binds its opaque ID and rejects missing/divergent artifacts before verified/completed or
  compensation non-membership proof;
- inject failure into student/profile/key/audit creation and prove zero partial writes;
- prove general list, table, PDF, CSV, logs and errors omit membership number, ID card, VAT,
  frequency note, DOB/contact fields, gender, legacy/source IDs and actor IDs; prove the row contains
  no field outside its exact allowlist;
- prove the general list requires verified Auth + App Check and active owner/administrator, derives
  tenant from claims, performs limit+1 but returns at most 50 rows, direct-gets at most 50 profiles,
  and rejects guardian/adultStudent/coach/headCoach, payload academy/filter/order, unknown fields and
  forged, expired or cross-tenant cursors before the directory query;
- prove a cursor authenticates fixed document-ID order and afterDocumentId; position/order/actor/
  version tampering, row-boundary replay and using a cursor under another reader fail before queries;
  the rollback token exposes no legacy ID and resolves only an exact server-side Restricted cursor
  state. Legacy/active-operation states expose no partial Students and only stable legacy-rollback
  invokes its bounded adapter;
- race list/detail/exact lookup against operation acquisition and a restore/forward chunk; the single
  state+domain transaction may return only a complete prior stable projection or retry/fail closed,
  never a mixed revision;
- prove exact Restricted lookup rejects wrong role, missing/unknown purpose, over-limit requests and
  cross-tenant keys; its public kind accepts only membership-number/id-card-number/vat-number and
  rejects legacy-member-id/auth-user-id before key reads. Success emits one audit and does not echo
  the searched value; an obsolete preserved admin key rechecks studentAdminProfiles while an
  auth-user-id key rechecks students.userId, and both return no-match on divergence;
- race 21 concurrent exact lookups and prove at most 20 accepted attempts, one committed
  counter/audit per accepted attempt, server-clock windows, App Check, and zero raw/digest/keyId
  data in audit/log/error projections;
- send thousands of additional over-limit requests and prove zero blind-key/profile reads, one
  create-only over-limit audit and O(1) total writes for the actor/window;
- enumerate 21 listed studentIds against the detail command and prove the same shared limit, one-ID
  request shape, role/App Check/audit gates and no provenance/envelope fields in responses;
- prove Firestore config exempts every raw Restricted admin lookup field from indexing and no code
  scans/queries studentAdminProfiles by those values;
- prove dry-run writes nothing and its receipt contains only approved metadata/counts/MACs; forward
  rejects existing+new capacity cases 399+2 and 400+1 before freeze/domain writes and rechecks exact
  counts under freeze before the first chunk;
- prove the single-project T100-style preflight precedes Firebase/source loading; separately prove
  restore requires the exact two named source/target apps, treats ambient project variables only as
  source context and rejects defaults, extras, swaps, missing/ambiguous IDs, wrong hosts, production
  and unopened staging with zero source/Firestore/artifact reads and zero writes;
- prove bootstrap, bootstrap-abandon, forward, failed-forward compensation and post-cutover rollback tokens are exact and
  non-interchangeable; prove post-deadline recovery needs its own fresh approval/preflight, extends
  only lease/deadline by at most 30 minutes and cannot mutate reader/phase/plan/domain data; cross
  the normal 30-minute and paged-v2 two-hour deadlines, require another approval per attempt and
  reject every replay;
- parameterize every approvalKind/action pair and reject wrong kind, operation, project, tenant,
  transition, stateRevision, restoreEpoch, planMac, expiry, revoked reviewer before local consumption
  or source-handoff, consumption reuse, non-allowlisted workload, terminal replay and a
  manifest-supplied reviewer; restore-acquire cannot complete and restore-complete cannot acquire.
  guardian/adultStudent/coach/headCoach can never mint an approval;
- for restore acquire, complete and post-deadline recovery, inject crashes after source-handoff and
  before target-transition; prove only the exact unexpired handoff resumes once, expiry/target CAS
  drift needs a new source approval, target consumption is atomic with its transition, revocation
  before handoff blocks, revocation after handoff has the documented non-retroactive semantics, and
  no test assumes a cross-project transaction;
- reject 51 rows in one chunk, row 401, byte/read budget + 1, expired/stolen lease, wrong
  stateRevision or last chunk, changed source version, missing/divergent chunk, reused migration ID
  with another planMac and activation before every receipt/identityKeyBaselineMac verifies;
- prove new adults receive prebound opaque IDs rather than legacy IDs; reject duplicate/expired
  reviewed manifests and unreviewed same-ID/minor matches;
- inject a later-chunk failure, keep the legacy reader/freeze, compensate only unchanged unreferenced
  create-only documents whose private output plan and receipt root prove prior absence/ownership, and
  fail closed if any target, reference, lease or MAC cannot be proven; prove a forward-created key
  absent from the pre-existing baseline is removed atomically with its identifier-bearing owner while
  any baseline, changed or subsequently referenced/written key is preserved;
- prove post-cutover rollback creates/parses/verifies every missing inactive/unknown legacy
  projection before switching the reader, maps original rows back to canonical studentId without
  exposing legacy IDs, fails on ambiguous/stale mappings, never overwrites originals, preserves
  canonical records and leaves identity writes blocked until a verified canonical forward recovery;
- prove public memberId aliases studentId only, no normal writer touches members, and backup v3
  reconstructs the legacy rollback source and canonical identity documents while capturing the exact
  source state/key versions. Source `memberDirectoryStates/current` is evidence-only: it is excluded
  from payload, never materialized over target state and its MAC is reverified from the encrypted
  artifact before planning, verification and I4. Exercise the complete disposition table and exact
  count/root reconciliation; reject another disposition version, state classified as payload, any
  source-supplied target-control row, excluded path in the artifact, remap or unlisted path;
- parameterize saveClientProfile, adult Auth linking, family/minor creation, admin create/edit and PDF
  import against absent/malformed/frozen state, wrong reader/write mode/version and incomplete or
  mismatched baseline; each must make zero writes on failure and reserve every affected key in its
  successful domain transaction. Race two different writer kinds for one identifier: exactly one
  commits and the loser makes zero domain, key or audit writes;
- parameterize unauthenticated, adultStudent, guardian, coach, headCoach, administrator and owner
  against direct get/list/create/update/delete on studentAdminProfiles, studentIdentityKeys,
  studentRestrictedReadLimits, memberDirectoryCursorStates, memberDirectoryStates,
  memberDirectoryMigrations, memberDirectoryMigrationChunks, memberDirectoryApprovals,
  memberDirectoryApprovalConsumptions, legacy members, the top-level restore guard/head events,
  memberDirectoryRestoreAttestations and memberDirectoryRestoreAttestationConsumptions;
  every operation is denied by Firestore Rules;
- inspect deployed index configuration and prove single-field indexing is disabled for every raw
  Restricted identifier, including memberDirectoryCursorStates.afterLegacyDocumentId; an attempted
  raw-value query has no supported index/query path;
- reject every invalid state tuple/status transition, cross-phase chunk collision and divergent
  replay; prove rollback chunk receipts remain committed while only the parent reaches verified, the
  stable rollback-readonly tuple has no lease, and a newly approved canonical recovery can acquire a
  fresh lease after an arbitrarily long interval;
- prove bootstrap, forward, identity-reconcile, rollback, canonical-recovery and restore-recovery
  each perform planned -> frozen, frozen -> applying (including zero rows), separate applying ->
  verified and verified -> completed transactions; inject a crash between them and resume only the
  exact next transition without exposing a stable reader early;
- prove failed directory-forward compensation consumes its exact approval while moving failed ->
  compensating, switches phase/resets lastCommittedChunkNo and issues its lease before reverse
  chunks; zero committed chunks use a separate proof-only compensating -> aborted transaction;
- fail bootstrap after one or more committed chunks, then prove failed-bootstrap-abandon verifies and
  preserves every monotonic key, deletes no domain data, returns to legacy/open/idle with incomplete
  coverage and lastCommittedChunkNo=0, and lets a new bootstrap adopt compatible keys; a malformed,
  reassigned or unattributable key must preserve the freeze;
- create concurrently at rollbackEligibleStudentCount=399 and prove exactly one student reaches 400;
  every later create fails with zero domain/key/audit writes while marker=false, whereas the atomic
  T097 gate disables rollback capacity without lowering its audit count;
- after the global gate, create more than 400 students and prove identity-reconcile-paged-v2 processes
  exact separately paged student/profile inventories under the same secret; row 10,001 in either,
  orphan profile and any state/guard race between pages fail before a planned receipt or freeze. A
  requested secret change fails before reads/writes, and an obsolete same-secret reservation still
  blocks reuse;
- prove every stateRevision/identity mutation and the global marker atomically advances the exact
  guard head/create-only event; reject missing head, bad chain/MAC, wrong project/tenant, stale event,
  count/marker decrease, event collision, direct client access and a simulated crash/race with zero
  state/guard divergence;
- prove backup-v3 rehearsal rejects non-stable snapshots, missing/stale source guard, stale
  revision/count, pre-global false snapshot after a true high-water marker, absent private artifact,
  same-project/remote/nonempty target, any target Auth user/workload, restored authority receipt and
  restore-acquire reuse at completion;
- prove initial target emptiness uses firestore-namespace-inventory-v1 with one readTime, paginated
  ListCollectionIds plus ListDocuments(showMissing=true), count/root zero, listUsers(1) and exact
  state/guard gets. Inject `students/ghost/evaluations/e1`, unknown `students/ghost/secrets/x`, a
  known ID under a wrong parent, second academy, unknown top-level collection and a page-2 orphan;
  all must be detected. Reject unsupported readTime/showMissing, repeated token, duplicate or
  out-of-project path and depth + 1. Accept each exact boundary, then reject payload document 10,001,
  payload byte 256 MiB + 1, target-control document 2,049, control byte 32 MiB + 1, combined document
  12,049, combined byte 288 MiB + 1 and visited path 12,050. Reject overlap, unclassified content and
  any second missing parent;
- prove I0-I4 accept only their exact operation/plan/state/guard/created path set and inventory root.
  Inject nested writes between checkpoints, expected-document removal and allowed-path content drift;
  none may produce the terminal attestation. Reject a second prepare over partial state,
  source/target secret substitution, target-authenticated approval and cross-project handoff reuse;
- crash immediately before and after the single preparation transaction; prove it leaves exactly I0
  or the complete I1 set, never a partial target. Verify the only prepared tuple has
  canonical-v1/blocked/frozen/restore-prepared, preparedOperationId, lastCommittedChunkNo=0 and no
  active operation/lease/deadline; exact retry returns I1, divergence fails, and acquire atomically
  clears preparedOperationId while entering restore-recovery;
- prove its exact 10,000-payload-document/256-MiB payload limit plus only the exact
  2,048-control-document/32-MiB headroom and the 40-document/2,500-read/8-MiB/100-write/15-second
  chunk limits. Inject planned-path drift before a chunk and prove zero chunk writes; inject unrelated
  nested drift and prove the next inventory checkpoint blocks verification/completion and the target
  never becomes serving;
- prove the quarantined restore preserves Firestore user/student/family/relationship and auth-user-id
  references without restoring any Auth object or breaking family/minor invariants. Inject a target
  Auth user before every checkpoint and prove progress blocks; inject one after a check and prove the
  next check catches it while application bootstrap rejects the restore-only project and the
  directory parser rejects restore phases. Successful
  rehearsal increments target revision/epoch, preserves source marker/count evidence, consumes a
  fresh restore-complete handoff and ends only in the restore-rehearsal-complete tuple.
- crash before and after I4 attestation creation; prove the deterministic stable ID discovers the
  same source-local create-only document after commit. A fresh verification readTime and corresponding
  verificationTargetInventoryMac are allowed and expected to differ without mutating attestedReadTime or
  attestedTargetInventoryMac; it passes only when stable inventory version, projects, operation,
  revision/epoch, terminal state/parent/consumption, backupManifestMac, sourceStateEvidenceMac,
  counts/bytes/roots and authority mode match. Changed stable root/content/binding or invalid MAC
  fails. Verify the closed schema, no participant path/raw field, non-restorable status and
  direct-client denial. Before planning, T097 repeats this fresh verification and binds both proofs;
  marker commit creates exactly one attestation consumption atomically with marker/guard/event, while
  cross-operation reuse and divergence fail;
- verify the global-elimination planner uses the source-local I4 attestation before creating its
  source operation, binds backupManifestMac/sourceStateEvidenceMac, attestation ID/MAC/attested read
  time/inventory MAC, target project/revision/epoch/roots and fresh verification read time/inventory
  MAC in source planMac, and rejects divergence without relying on a cross-project transaction.

T097 must capture these failures before the global marker can change:

- no Levels/progress/report path may enumerate or write members or nested evaluation/graduation
  paths;
- missing studentLevelProgress renders uninitialized, never the first/white-belt definition;
- owner cannot approve/reject a promotion; headCoach approval atomically writes levelPromotions,
  studentLevelProgress and audit under one studentId;
- nested history and medical leaves are migrated/adapted into backed-up direct collections without
  widening minor/health projections;
- reject every global-marker precondition independently: wrong canonical tuple, active/stale lease,
  incomplete or mismatched baseline, missing/non-completed forward, backup v3 or restore proof,
  nonzero/stale dependency proof, code/schema/hash divergence, expired/wrong approval and changed
  stateRevision; each leaves marker/revision/operation/audit untouched;
- race approved rollback acquisition against global elimination and prove exactly one transaction
  commits. Exact same-operation replay is a no-op; different/divergent replay fails; the marker never
  returns to false, rollbackProtocolVersion becomes disabled, its final count is retained and no
  members document is deleted.

## Out of scope

- Deleting members.
- Matching real people automatically.
- Importing Regyfit members.
- Creating Auth accounts during migration.
- Activating online payments or external messaging.
- Any production read, write, deployment or migration.
