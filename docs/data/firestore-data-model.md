# Firestore Data Model Contract

## Path and identity conventions

- Firestore root: `academies/{academyId}`.
- Direct subcollections: `users`, `families`, `students`, `studentAdminProfiles`, `studentIdentityKeys`, `studentRestrictedReadLimits`, `memberDirectoryCursorStates`, `memberDirectoryStates`, `memberDirectoryMigrations`, `memberDirectoryMigrationChunks`, `memberDirectoryApprovals`, `memberDirectoryApprovalConsumptions`, `memberDirectoryWriteReceipts`, `familyWriteReceipts`, `profileWriteReceipts`, `memberDirectoryImportReceipts`, `memberDirectoryImportSessions`, `staff`, `relationships`, `locations`, `programs`, `classes`, `sessions`, `plans`, `bookings`, `waitlistEntries`, `sessionCapacityStates`, `bookingQuotaStates`, `waitlistPositionStates`, `attendance`, `checkouts`, `memberships`, `invoices`, `payments`, `paymentEvents`, `assessments`, `studentLevelProgress`, `levelPromotions`, `recognitions`, `medicalLeaves`, `levelSystems`, `levelDefinitions`, `levelRequirements`, `levelCatalogManifests`, `leads`, `messages`, `deliveryEvents`, `notificationPreferences`, `healthProfiles`, `safeguardingCases`, `waiverVersions`, `consents`, `documents`, `auditEvents`, `exports`, `exportRateLimits`, and `regyfitAccessRecords`.
- Non-restorable control-plane exceptions: tenant-local `memberDirectoryImportSessions/{sessionId}`, top-level `memberDirectoryRestoreGuards/{academyId}` and its `events/{stateRevision}` subcollection, source-local `memberDirectoryRestoreAttestations/{attestationId}`, and source-local `memberDirectoryRestoreAttestationConsumptions/{attestationId}`. They are project/tenant-bound, backend-only and excluded from tenant backup/export. Guard state is updated atomically with directory state; attestations and their one-time consumptions are create-only proofs. Import sessions are short-lived coordination envelopes removed with their private PDF objects by their own bounded cleanup schedule.
- RTDB presence: `academies/{academyId}/presence/{sessionId}/{studentId}`.
- Booking document ID for new writes: `v2:{sessionId.length}:{sessionId}:{studentId.length}:{studentId}` after trimming both identifiers. Compatibility reads probe this canonical ID first and legacy `{sessionId}__{studentId}` second; divergent dual records fail closed.
- Waitlist document ID for new writes follows the same canonical v2 and legacy-read compatibility rule.
- Attendance document ID: `{sessionId}__{studentId}`.
- Mutable documents use `academyId`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, and `status` when applicable.
- Server timestamps and actor IDs are backend-owned; clients cannot choose them.

The deterministic attendance ID identifies only the canonical attendance
record. A correction is a separate document in `attendance` with a
backend-generated opaque `attendanceId`; its `correctionOf` points to the
canonical attendance record. The correction preserves the canonical record and
creates the required audit event.

All Firestore collections in this contract are direct subcollections of
`academies/{academyId}`. The path and the `academyId` field must identify the
same academy. A document ID is an opaque identifier unless this contract
explicitly defines a deterministic value. Authorization is enforced by the
backend and the Rules owned by `T016`; a path is not an authorization grant.

The RTDB path is only for expiring presence. A presence node may contain
`state`, `lastSeenAt`, and `sessionVersion`; it must never contain canonical
attendance, payments, memberships, progress, consent, audit, health, or
safeguarding data and must never restore Firestore.

## Scope and pending decisions

This document is the field-level contract for later backend modules, Rules,
fixtures, migrations, and query tests. It does not apply a migration and does
not approve operational values.

- `T008` remains `pendiente`. Capacities, schedules, locations, and other
  operational values not frozen by T032 remain configurable. T032 freezes the
  ten-plan catalogue and its documented prices and access rules below.
- Values marked `(f)` may describe stable relationships or examples as
  placeholders no productivos. They are not production enums, limits,
  eligibility rules, prices, or validation constraints.
- Decisions marked `Pending approval` remain open and configurable. This
  contract does not turn them into productive invariants.
- `T009` remains the owner of assessment and recognition criteria, weights,
  review ownership, and final sports rules.
- `T010` remains the owner of the payment provider, provider payload, webhook
  verification details, checkout behavior, refunds, and reconciliation.
- `T011` remains the owner of retention, residency, access, deletion, and
  restoration policy for restricted data.
- `T016` remains the owner of concrete Firestore and RTDB Rules.

## Classification and ownership

### Regyfit access records

`regyfitAccessRecords` is a source-specific `Restricted` snapshot collection at
`academies/{academyId}/regyfitAccessRecords/{sourceId}`. It is not canonical
identity data and must not be reconciled into `students` or `users` by this
contract. Documents contain the observed member display name, member number,
login count, last login, source identity, import run, capture time, and IP.

The backend/import command is the only writer. Firestore Rules deny every direct
client `get`, `list`, `create`, `update`, and `delete`. Authenticated owners use a
backend projection that includes `ip`; administrators use a safe backend projection
that omits `ip`. Rules do not grant either role direct reads.
`headCoach`, `coach`, `guardian`, and `adultStudent` have no access. Import audit entries store only
academy, actor, action, target, purpose, correlation, count, hash, and run
metadata; they never copy a source record or restricted field.

Classification applies during capture, transit, storage, caching, querying,
logging, export, backup, restore, and deletion. A record, payload, export, or
log that combines fields with different classifications inherits the highest
classification unless a documented, authorized projection explicitly removes
the restricted fields.

| Classification | Read owner                                                                                                            | Write owner                                                                                                 | Required handling                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Public`       | Unauthenticated public surface and authenticated users when the record is deliberately published.                     | Academy content backend or an explicitly authorized publishing workflow.                                    | No private person, access, payment, health, or safeguarding data; no public indexing unless intentionally approved.                                         |
| `Internal`     | Authenticated staff with an operational need.                                                                         | Academy, scheduling, or configuration backend.                                                              | Not public; access is still authenticated and scoped.                                                                                                       |
| `Confidential` | The data subject or linked family, plus staff with an active role, relationship, or assignment.                       | The owning domain backend through an authorized command.                                                    | Minimum privilege, scoped queries, audited sensitive changes, and restricted exports.                                                                       |
| `Restricted`   | An explicitly authorized subject relationship or staff role with a current purpose; system access is least-privilege. | Backend/system workflow or an approved user flow that records evidence; never an unrestricted client write. | Separate access checks, redacted logs, no general list queries, and no general exports. Every export requires purpose, scope, recipient, expiry, and audit. |

### Projection and query authorization

A mixed-classification collection is not a permission to return its full
document. Every client-facing or module-facing query declares a projection and
checks the current tenant, relationship, role, assignment, and purpose before
returning data. Fields classified as `Restricted` are excluded from the safe
projection even when the query has a valid compound index.

The payment-history and message-audience queries have the following mandatory
projections and authorization boundaries:

| Query                       | Safe scoped projection                                                                               | Authorization and excluded data                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payments` family history   | `paymentId`, `academyId`, `familyId`, `invoiceId`, `status`, `amountMinor`, `currency`, `occurredAt` | The backend verifies the same-academy path/field, the requested `familyId`, and either a current family relationship or an authorized finance scope. Exclude `providerReference`, provider evidence, reconciliation/correction evidence, actor details, and related restricted events. Those require a separate authorized finance/integration/audit query. |
| `messages` audience history | `messageId`, `academyId`, `audienceId`, `channel`, `templateKey`, `sentAt`, `status`                 | The backend verifies the same-academy path/field and the requester's access to the evaluated audience. Exclude message content, expanded recipients, guardian/minor details, provider payloads, and delivery evidence. Those require a separate authorized communication/guardian query.                                                                    |

The safe projections are scoped backend projections, not public data contracts;
the client may receive fewer fields. A query must not return the complete
Firestore document merely because its caller can run the query. An index never
grants access.

Restricted data never appears in a general student/family list or a general
export because list and export operations multiply exposure beyond the purpose
that justified the original read. A restricted read must be a separately
authorized, minimally scoped operation with a current relationship or staff
assignment. `exports` itself is `Restricted` and cannot lower the
classification of its source records.

## Common field conventions

The word `timestamps` in a collection contract expands to `createdAt`,
`createdBy`, `updatedAt`, and `updatedBy`. These are server-owned values. A
mutable collection also carries `schemaVersion` and `status` when applicable,
as stated in the path conventions. Event collections are append-only and use
their event time and actor/provider evidence rather than a client-controlled
mutable history.

- `academyId` is a tenant field and must equal the academy in the document
  path.
- References are same-academy document IDs or typed references validated by
  the owning backend. Clients cannot use a reference to widen their scope.
- `schemaVersion` identifies the persisted shape. It is not a product state
  and does not authorize a migration by itself.
- `status` is owned by the domain module. This contract does not freeze the
  status enum or transition graph while `T008-T011` remain open.
- `priceMinor`, `totalMinor`, and `amountMinor` represent integer monetary
  quantities in the currency recorded by `currency`; the contract does not
  choose a price, currency, provider, tax rule, or refund rule.
- Structured fields such as `eligibility`, `roleAssignments`, `permissions`,
  `dimensions`, `participants`, `actions`, `resolution`, and `scope` are
  validated by their owning module. They are not unbounded client JSON.
- A provider reference or idempotency key is minimal integration evidence; it
  is not a place for raw credentials, full provider payloads, or secrets.

## Collection groups and aggregate boundaries

| Group                   | Collections                                                                                                                                                                                                                                                                                                                                                                              | Ownership boundary                                                                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Academy                 | `locations`, `programs`, `classes`, `sessions`, `plans`                                                                                                                                                                                                                                                                                                                                  | Academy configuration, catalogue, scheduling templates, session instances, and membership plans. Pending operational values remain configurable.                                                                                                                       |
| Identity                | `users`, `families`, `students`, `studentAdminProfiles`, `studentIdentityKeys`, `staff`, `relationships`                                                                                                                                                                                                                                                                                 | Adult identity, family records, protected minor profiles, private administrative extensions, uniqueness reservations, staff assignments, and explicit tutor relationships.                                                                                             |
| Identity coordination   | `studentRestrictedReadLimits`, `memberDirectoryCursorStates`, `memberDirectoryStates`, `memberDirectoryMigrations`, `memberDirectoryMigrationChunks`, `memberDirectoryApprovals`, `memberDirectoryApprovalConsumptions`, `memberDirectoryWriteReceipts`, `profileWriteReceipts`, top-level `memberDirectoryRestoreGuards`, `memberDirectoryRestoreAttestations`, `memberDirectoryRestoreAttestationConsumptions` | Backend-only throttling/cursor, freeze, reader-version, approval-consumption and non-restorable restore proofs. Only cursor state may contain one Restricted legacy continuation ID; other receipts contain no source PII and never replace students or relationships. |
| Scheduling              | `bookings`, `waitlistEntries`                                                                                                                                                                                                                                                                                                                                                            | Reservation, roster, and recoverable waitlist intent. They reference, but do not duplicate, the session, student, or membership as sources of truth.                                                                                                                   |
| Scheduling coordination | `sessionCapacityStates`, `bookingQuotaStates`, `waitlistPositionStates`                                                                                                                                                                                                                                                                                                                  | Backend-only revision and monotonic-position locks. They serialize transactions but never replace sessions, bookings, memberships, plans, finance, or waitlist entries as sources of truth.                                                                            |
| Attendance              | `attendance`, `checkouts`                                                                                                                                                                                                                                                                                                                                                                | Canonical attendance, corrections, and child check-out state. Presence in RTDB is not part of this aggregate.                                                                                                                                                          |
| Commercial              | `memberships`, `invoices`, `payments`, `paymentEvents`                                                                                                                                                                                                                                                                                                                                   | Membership lifecycle, invoices, administrative payments, and minimal verified provider events. Card data is outside the platform.                                                                                                                                      |
| Development             | `assessments`, `studentLevelProgress`, `levelPromotions`, `recognitions`                                                                                                                                                                                                                                                                                                                 | Evidence, one current level/skill head per student, append-only formal promotion decisions and separate recognitions. No automatic belt or stripe grant.                                                                                                               |
| CRM and communication   | `leads`, `messages`, `notificationPreferences`, `deliveryEvents`                                                                                                                                                                                                                                                                                                                         | Prospects, audiences, notification consent/preferences, and delivery history. Communication involving a minor remains visible to the tutor.                                                                                                                            |
| Restricted governance   | `medicalLeaves`, `healthProfiles`, `safeguardingCases`, `consents`, `documents`, `auditEvents`, `exports`                                                                                                                                                                                                                                                                                | Minimum operational restricted data, versioned evidence, private object metadata, append-only audit, and controlled exports. These collections are not general directories.                                                                                            |

## Identity and relationship contracts

| Collection      | Required fields                                                                                                                                                                                                                                               | References                                                                                                                                                                               | Classification                                                        | Write authority                                                                                                             | Deletion/history rule                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`         | `userId`, `academyId`, `accountType`, `displayName`, `email`, `phoneNumber`, `active`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `status`                                                                                          | `userId` maps to the adult Firebase Auth identity. No minor account is implied.                                                                                                          | `Confidential`                                                        | Identity/account backend; profile changes use an authorized command. Auth provider state is not client-controlled.          | Deactivation/revocation and status history; no normal hard delete of an identity referenced by history. Final retention/deletion is `T011`.                                                                                       |
| `families`      | `familyId`, `academyId`, `primaryContactUserId`, `billingContactUserId`, `active`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                                                              | `primaryContactUserId` and `billingContactUserId` are the same existing active client `users` record in the same academy.                                                                | `Confidential`; a minor relationship is `Restricted` in exports/logs. | T022 family backend; only `owner`/`administrator` commands write. Guardian reads a redacted projection through `getFamily`. | Deactivation preserves family, students, relationships, and envelope history; no hard delete.                                                                                                                                     |
| `students`      | `studentId`, `academyId`, `familyId` (T022 minor), `fullName`, `dateOfBirth`, `phoneNumber`, `email`, `trainingCenter`, `trainingTimePreferences`, `participantType`, `active`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `status` | `userId` optionally references the adult Firebase Auth identity; T022 minors have no `userId`, and `familyId` references one same-academy family.                                        | `Restricted`                                                          | Identity backend; T022 derives `minor` and checks the current `relationships` record for guardian access.                   | Deactivation or approved retention workflow; no normal hard delete when referenced by attendance, progress, consent, or safeguarding history.                                                                                     |
| `staff`         | `staffId`, `academyId`, `userId`, `roleAssignments`, `active`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `status`                                                                                                                  | `userId` references `users`; `roleAssignments` may reference approved programs, classes, or locations.                                                                                   | `Confidential`                                                        | Staff/identity backend; role and assignment changes require an authorized backend actor.                                    | Deactivation revokes interactive access and effective assignments; preserve historical authorship and audit.                                                                                                                      |
| `relationships` | `relationshipId`, `academyId`, `familyId`, `studentId`, `adultUserId`, `relationshipType`, `permissions`, `validFrom`, optional `validTo`, `active`, `status`, `schemaVersion`, timestamps and actors                                                         | `familyId` -> `families`, `studentId` -> `students`, `adultUserId` -> `users`; all references must share `academyId`. `relationshipId` is the deterministic `familyId + studentId` pair. | `Confidential`; the tutor-minor link is `Restricted` in exports/logs. | T022 family backend; only `owner`/`administrator` commands write. `guardian` only reads its resolved family projection.     | Validity, tutor replacement, and `active/status` changes preserve history; no embedded arrays and no delete. Permissions is fixed to `readProfile` in T022 and grants no health, waiver, payment, attendance, or progress access. |

### T092 administrative participant extension and coordination

| Collection                                                                | Required fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Classification | Authority and history                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `studentAdminProfiles`                                                    | `studentId`, `academyId`, optional `membershipNumber`, `idCardNumber`, `vatNumber`, required `gender`, optional bounded `frequencyNote`, optional Confidential `emergencyContact` (`fullName`, `relationship`, `phoneNumber`, optional `alternatePhoneNumber`) and `postalAddress` (`line`, `postCode`) from the official waiver form (T106), optional `legacyMemberId`, `source`, optional `importRunId`/`migrationId`, literal `schemaVersion: "1"`, timestamps/actors                                                                                                                                                                                                                                        | `Restricted`   | Backend identity/directory only; ID equals an existing same-academy student. No direct access or normal hard delete. It deliberately has no `active` or `status`.                                                                                                                                                                                                                                                                   |
| `studentIdentityKeys`                                                     | `keyId`, `academyId`, `kind`, `digestVersion`, `secretVersion`, `ownerStudentId`, `schemaVersion`, timestamps/actors                                                                                                                                                                                                                                                                                                                                                                                       | `Restricted`   | Backend create-only immutable reservation in the identity transaction. Raw values are absent; reassignment/delete is forbidden and rotation/erasure belongs to T011.                                                                                                                                                                                                                                                                |
| `studentRestrictedReadLimits`                                             | `actorId`, `academyId`, `windowStartedAt`, `attemptCount`, `overLimitObserved`, `schemaVersion`, `updatedAt`                                                                                                                                                                                                                                                                                                                                                                                               | `Restricted`   | Backend-only shared rolling five-minute counter for exact lookup and sensitive detail, keyed by authenticated actorId. Direct access is denied; client time cannot reset it.                                                                                                                                                                                                                                                        |
| `memberDirectoryCursorStates`                                             | `cursorId`, `academyId`, `actorId`, `role`, literal rollback projection/order, `stateRevision`, `afterLegacyDocumentId`, `issuedAt`, `expiresAt`, `cursorSecretVersion`, `schemaVersion`                                                                                                                                                                                                                                                                                                                   | `Restricted`   | Backend-only five-minute rollback continuation state. The client receives only a random signed handle; the legacy ID never leaves this record. Excluded from backup/export and removed by bounded TTL cleanup.                                                                                                                                                                                                                      |
| `memberDirectoryStates`                                                   | `stateId: "current"`, `academyId`, `stateRevision`, `readerVersion`, `directoryWriteMode`, `globalLegacyReadEliminated`, `freezeStatus`, `operationPhase`, identity-key algorithm/secret/baseline MAC plus opaque artifact ID, rollback protocol/capacity/monotonic count, integer `lastCommittedChunkNo`, optional `preparedOperationId` or active operation/lease IDs and expiry/deadline, `schemaVersion`, timestamps/actors                                                                            | `Confidential` | Backend coordination only. Every writer reads the state in its own transaction. Only restore-prepared has preparedOperationId and no active operation/lease/deadline; every stable tuple requires lastCommittedChunkNo=0. Reader/freeze changes are versioned and audited.                                                                                                                                                          |
| `memberDirectoryMigrations`                                               | `operationId`, closed `operationType`, `academyId`, target/code/schema/effective/disposition versions, optional `authorityMode`, source/private-manifest/plan/proof/inventory MACs including `backupManifestMac` and `sourceStateEvidenceMac`, integrity/identity algorithm and secret versions, public code/schema hashes, classification counts, row/chunk budget, closed status, expiry, audit correlation, timestamps/actors                                                                           | `Confidential` | Metadata-only receipt: identity/MACs/hashes/counts are immutable; backend status transitions are versioned and audited. It contains no source PII and status alone never authorizes a participant.                                                                                                                                                                                                                                  |
| `memberDirectoryMigrationChunks`                                          | `chunkId`, `operationId`, `phase`, `chunkNo`, optional `sourceForwardChunkNo`, `academyId`, `previousStateRevision`, `committedStateRevision`, `leaseId`, `inputMac`, `outputSetMac`, expected/written counts, literal `status: committed`, audit correlation, timestamps/actors                                                                                                                                                                                                                           | `Confidential` | Metadata-only create receipt. Chunks are bounded/content-addressed; phase prevents forward/compensation collisions and divergent replay or missing documents block activation.                                                                                                                                                                                                                                                      |
| `memberDirectoryApprovals`                                                | `approvalId`, `operationId`, closed `approvalKind`, `authorizedTransition`, `expectedStateRevision`, optional `sourceProjectId`/`targetProjectId`/`restoreEpoch`/`authorityMode`, `academyId`, `projectId`, `planMac`, `reviewerActorId`, `approvedAt`, `expiresAt`, `schemaVersion`                                                                                                                                                                                                                       | `Confidential` | Auth + App Check backend creates an immutable approval for an active owner/administrator. Restore derives authority from source Auth and binds both projects; IDs/tenant/project/transition/revision/epoch/MAC/expiry are backend-owned. Direct access and overwrite are denied.                                                                                                                                                    |
| `memberDirectoryApprovalConsumptions`                                     | `approvalId`, `operationId`, `authorizedTransition`, closed `stage`, state revisions before/after, `approvalMac`, consumed timestamp/actor, plus stage-specific optional source/target project IDs, `restoreEpoch`, `authorityMode`, `targetStateAttestationMac`, `sourceHandoffMac`, `targetConsumptionMac`, handoff issued/expiry timestamps, `schemaVersion`                                                                                                                                            | `Confidential` | Backend create-only receipt. Local stage is atomic with its transition. Restore creates source-handoff atomically with source approval consumption, then target-transition atomically with target state change; reuse/divergence fails and restored receipts are inert evidence.                                                                                                                                                    |
| `memberDirectoryWriteReceipts`                                            | `receiptId` matching `write-{64 lowercase hex}`, `academyId`, `actorId`, `requestMac`, `studentId`, `auditEventId`, nonnegative integer `stateRevisionBefore`, positive integer `stateRevisionAfter = stateRevisionBefore + 1`, literal `status: "completed"`, UTC-millisecond `createdAt`, literal `schemaVersion: "1"`                                                                                                                                                                                   | `Confidential` | Backend-only, create-only, metadata-only receipt written atomically with the canonical student, admin profile, identity keys, state/guard head/event and audit event. It stores no raw request or administrative identifier. Exact replay verifies its request MAC and referenced records. No update or delete is allowed; retention remains blocked until T011. Backup v3 materializes it exactly as quarantined payload evidence. |
| `profileWriteReceipts`                                                    | `receiptId` matching `write-{64 lowercase hex}`, `academyId`, `actorId`, `requestMac`, `studentId`, auth identity `identityKeyId`, identity/integrity secret versions, `auditEventId`, state revisions before/after, `createdStudent`, literal completed status, UTC-millisecond `createdAt`, literal `schemaVersion: "1"`                                                                                                                                                                                      | `Confidential` | Backend-only, create-only, metadata-only idempotency receipt for adult self-service profile linking. It is atomic with user/student, auth identity reservation, control-plane revision and audit evidence; it stores no raw Auth ID, profile fields or identifier value. Backup v3 materializes it so a restored retry cannot become a new operation.                                                                                 |
| `memberDirectoryImportReceipts`                                           | Document ID equals `receiptId` matching `import-{64 lowercase hex}`. Exact fields: `receiptId`, `operationId`, `academyId`, `actorId`, `projectId`, `targetProjectClassification`, literal `codeVersion: "canonical-member-import-v1"`, literal `schemaVersion: "1"`, UTC-millisecond `operationWriteTime`/`expiresAt`, `sourceMac`, `privateManifestMac`, `planMac`, `outputSetMac`, literal `digestVersion: "hmac-sha256-v1"`, `identitySecretVersion`, literal `integrityMacVersion: "hmac-sha256-v1"`, `integritySecretVersion`, `identityKeyBaselineMac`, the nine closed `classificationCounts`, admitted/planned/post-cutover counts, unique closed `reportKeys`, literal `maximumApprovedRows: 50`, consecutive `stateRevisionBefore`/`stateRevisionAfter`, literal `status: "completed"`. | `Confidential` | Backend-only, create-only metadata receipt written in the same canonical transaction as students/profiles/identity keys, state/guard/event and shared audit evidence. It contains no source row, name, contact, administrative identifier or private manifest. Exact replay validates all MACs and materialized outputs. Backup v3 materializes the exact path and body. |
| `memberDirectoryImportSessions`                                           | Document ID equals `sessionId` matching `import-session-{64 lowercase hex}`. Every variant has exactly `sessionId`, UUIDv4 `operationId`, `academyId`, `actorId`, `actorRole` (`owner` or `administrator`), `projectId`, `targetProjectClassification`, `uploadManifestMac`, `sessionMac`, ordered `uploads[{objectKey,sizeBytes}]`, `trainingCenter`, unique `trainingTimePreferences`, UTC-millisecond `operationWriteTime`/`expiresAt`/`createdAt`/`updatedAt`, literal `schemaVersion: "1"`, and closed `status`. `uploading` has only the base fields; `previewed` additionally has `sourceUploadMac` and an exact metadata-only `preview` (`classifications[{rowMac,classification}]`, `confirmable`, signed planned receipt); `confirmed` additionally has exact `result{receiptId,created,matched}` and `completedAt`. | `Restricted` | Private backend coordination only. The path, ordered object keys/sizes and every immutable envelope field are covered by `sessionMac`; each read/transition verifies the HMAC and actor/tenant/project/operation/expiry binding before private-object I/O. The browser receives upload URLs only, classifications by row MAC and the signed receipt; it never receives object keys, raw rows or the private manifest. Sessions expire after at most ten minutes, are excluded before backup/restore, and a separate bounded schedule deletes every private object before the MAC-bound session. |
| top-level `memberDirectoryRestoreGuards/{academyId}`                      | `guardId`, `projectId`, `academyId`, `highestStateRevision`, `globalLegacyReadEverEliminated`, `highestRollbackEligibleStudentCount`, `restoreEpoch`, integrity versions, `lastEventId`, `lastEventMac`, `schemaVersion`, timestamps/actor; create-only child events bind previous/current revision/MAC, monotonic values, operation/transition and event MAC                                                                                                                                              | `Confidential` | Non-restorable control-plane head plus append-only HMAC chain. Every state revision updates state/head/event in one transaction; missing/divergent/decreasing data fails closed. Direct client access and backup/export are denied.                                                                                                                                                                                                 |
| top-level `memberDirectoryRestoreAttestations/{attestationId}`            | `attestationId`, source/target project IDs, `academyId`, target operation ID, completed target state revision/restore epoch, literal `authorityMode: "quarantined-no-auth"`, disposition/inventory versions, `backupManifestMac`, `sourceStateEvidenceMac`, `attestedReadTime`, payload/control/combined counts, bytes and roots, restore-complete approval ID, source handoff/target consumption MACs, `attestedTargetInventoryMac`, source integrity version/attestation MAC, timestamps/workload/schema | `Confidential` | Source-local create-only I4 proof. Its deterministic opaque HMAC ID makes exact replay idempotent; later verification uses a separate read time/MAC and must match every stable binding/root. It contains no participant paths or raw fields and is excluded from backup/export.                                                                                                                                                    |
| top-level `memberDirectoryRestoreAttestationConsumptions/{attestationId}` | `attestationId`, source global operation ID, state revisions before/after, `attestedReadTime`, `attestedTargetInventoryMac`, `verificationReadTime`, `verificationTargetInventoryMac`, attestation MAC, consumed timestamp/actor, `schemaVersion`                                                                                                                                                                                                                                                          | `Confidential` | Source-local create-only one-time consumption written atomically with the T097 marker, guard and event. Same-operation replay is a no-op; reuse or divergence fails. Direct client access and backup/export are denied.                                                                                                                                                                                                             |

`operationType` is exactly identity-key-bootstrap, identity-key-reconcile,
directory-forward, post-cutover-rollback, canonical-recovery,
member-directory-restore-recovery or global-legacy-elimination. Normal
operation status transitions are planned -> frozen -> applying -> verified ->
completed; frozen/applying/verified may fail, failed may resume applying for
the exact plan or enter compensating only for directory-forward, and
compensating reaches aborted only after exact prior-state proof.
completed/aborted are terminal. The sole additional failed transition is
identity-key-bootstrap failed -> aborted under preservation-only
failed-bootstrap-abandon. The sole short success transition is planned ->
completed for the atomic global-elimination marker.

`approvalKind` is exactly bootstrap-confirm, failed-bootstrap-abandon,
forward-confirm, failed-operation-compensate, post-cutover-rollback,
post-deadline-recovery,
canonical-recovery, identity-reconcile-confirm, restore-acquire,
restore-complete or global-legacy-eliminate. Operation/action/transition pairs
are fixed by the migration plan; kinds are never interchangeable and an
approval cannot outlive expiry, reviewer revocation before consumption or its
parent operation. Each same-project use creates a stage=local-transition
approval-consumption receipt in the state transition transaction. Restore
acquire, completion and post-deadline recovery instead use the source-handoff
-> target-transition saga below; acquire and completion remain distinct
approvals bound to the same restore epoch and their respective revisions.

Failed directory-forward compensation consumes failed-operation-compensate in the
failed-to-compensating transaction. That transaction changes the parent to
compensating, switches phase to compensation, resets lastCommittedChunkNo,
issues a fresh lease/deadline and advances state/guard/audit, but performs no
domain write. Zero committed chunks still require a separate exact proof before
compensating reaches aborted.

Failed identity-key-bootstrap is resume-or-abandon and never compensates or
deletes reservations. failed-bootstrap-abandon verifies every committed
bootstrap receipt and created immutable key, then atomically moves failed ->
aborted, preserves all keys/domain documents, returns to the stable legacy
tuple with incomplete coverage and lastCommittedChunkNo=0, and clears
operation/lease/deadline. A new bootstrap adopts compatible preserved keys;
ambiguity leaves the freeze in place.

`studentAdminProfiles.source` is immutable: `admin` forbids import/migration IDs,
and legacyMemberId; `member-pdf-import` requires `importRunId` and forbids
migrationId/legacyMemberId; `legacy-member-migration` requires migrationId plus
legacyMemberId and permits importRunId only when the forward receipt binds the
prior import MAC. No MVP callable/UI exposes provenance. `frequencyNote` is a
short imported label, not a place for health, safeguarding, finance, booking
rules, credentials or free-form case notes.

`membershipNumber`, `idCardNumber`, `vatNumber` and `legacyMemberId` are
Restricted identifiers. None appears in a general list, table, PDF, analytics
or export. An exact lookup by an approved public administrative value requires an
owner/administrator, a closed purpose, rate limit and append-only audit; the
response identifies the matching student without echoing the searched value.
The public lookupKind enum is exactly membership-number, id-card-number or
vat-number. legacy-member-id is runner/rollback-only and auth-user-id is
Auth-link-flow-only; either public input fails before key reads.
The exact general admin-directory row allowlist is `studentId`, `fullName`,
`trainingCenter`, `participantType`, `active`, `status` and an optional
backend-computed masked `membershipReference`; DOB, contacts, gender and every
admin-profile/provenance/actor field are absent.

`membershipReference` is omitted for normalized values shorter than eight
characters; otherwise it is the literal `****` plus the final four characters.
It is display-only and cannot be searched, sorted or exported.

The general admin directory requires verified Auth + App Check and a currently
active owner/administrator. Academy is claim-derived. Its only inputs are an
integer page size from 1 to 50 and an optional opaque five-minute cursor. The
authenticated cursor payload is exactly academyId, actorId, role,
projectionVersion=`admin-directory-v1`, order=`__name__:asc`, afterDocumentId,
issuedAt, expiresAt and cursorSecretVersion. The backend orders by document ID
ascending, applies startAfter only from the verified afterDocumentId, queries
limit+1, returns at most 50 rows and direct-gets at most 50 admin profiles. No
payload tenant/filter/order is accepted; unknown fields and forged, expired,
cross-tenant or cross-reader cursors fail before the query. The canonical list
never scans `members`; only the stable rollback adapter has a bounded exception.
That adapter uses projectionVersion=`legacy-rollback-directory-v1` and a signed
token containing only a random cursorId, fixed private order, actor/tenant/role,
stateRevision and expiry. Its Restricted `memberDirectoryCursorStates` record
stores the afterLegacyDocumentId; no legacy ID appears in the client token.

State, optional rollback cursor state, selected rows and every profile/key get
execute in one Firestore transaction/snapshot. The state read lock conflicts
with migration/restore acquisition or a chunk transition, so a retry reselects
the reader. legacy-v1 and every active operation fail before domain queries;
only canonical open/idle or stable rollback-readonly may return a page.

The single-student `member-record-maintenance` detail allowlist combines the editable
Student fields with membershipNumber, idCardNumber, vatNumber, gender and
frequencyNote. It excludes legacy/source/import/migration IDs, timestamps and
actors. Provenance remains private to the migration runner/approval receipt and
is not a callable/UI read purpose. The detail accepts exactly one studentId and
has no batch form; because that ID is listed, the detail uses the same Auth, App
Check, role, shared rate-limit, state lock and audit transaction as exact lookup
before returning bytes.

Exact identifier lookup requires verified Auth, App Check, owner/administrator
and one of the closed purposes. It permits 20 attempts per actor/academy in a
server-clock five-minute window. One transaction consumes the
`studentRestrictedReadLimits/{actorId}` quota, first validates
`memberDirectoryStates/current`, reads the key and authoritative current
profile/student, and appends the audit event before returning match/no-match.
An acquisition/chunk race retries into the new state and cannot return mixed
data. The first over-limit attempt sets
overLimitObserved/create-only audit without reading the blind key; later rejects
in that actor/window are read-only, so spam causes O(1) writes. Concurrent
attempt 21 cannot pass. Audit, logs and errors omit raw/normalized input,
digest/keyId and admin values.

Uniqueness and exact Restricted lookup are tenant-scoped through
`studentIdentityKeys/{kind}:{digest}` for `membership-number`, `id-card-number`,
`vat-number`, `legacy-member-id` and `auth-user-id`. `digest` is lowercase hex
HMAC-SHA-256 over a domain prefix plus unambiguous uint32-length-prefixed UTF-8
segments for academy, kind and normalized value. Administrative values use
NFKC + trim + uppercase, a bounded length and a closed ASCII alphabet; Firebase
UID comparison is exact. The raw value is never included in the key document.
The body includes `keyId`, `academyId`, algorithm `digestVersion`, non-secret
`secretVersion`, owner and server envelope. Missing or mismatched secret
versions fail closed.

Identity-key, migration-integrity and directory-cursor HMAC secrets are strict
unpadded base64url values decoding to 32-64 random bytes. They are pairwise
distinct, version-pinned and distinct across environments, with no default or
fallback. Remote runtimes obtain them from approved Secret Manager bindings;
explicit test material is accepted only for exact loopback Emulator bindings
`demo-bpt-jersey` and `demo-bpt-jersey-restore`, with distinct material per
purpose/project. Empty, malformed, short, placeholder, equal or
cross-environment-reused keys fail before source/Firestore reads, and equal
length MACs are compared in constant time.

T093 never changes the identity-key secretVersion. Identity reconciliation may
replace the exact baseline artifact only under that same secret. Rotation needs
a later explicit multi-version read/deny and single-write design so obsolete
immutable reservations continue blocking reuse; missing/changed versions fail
before reads or writes.

`memberDirectoryStates/current` must report exact algorithm/secret versions,
an `identityKeyCoverage` of `complete`, a verified `identityKeyBaselineMac` and
an opaque `identityKeyBaselineArtifactId` before a canonical identity writer or
directory cutover can proceed. The encrypted private artifact retains the exact
sorted baseline tuple set; verification, compensation and restore reopen it and
recompute the MAC because a root alone cannot prove absence. T093 bootstraps and
reconciles reservations for every existing student/user/admin identifier, not
only migrated legacy rows. A stale reservation can block reuse, but lookup must
also compare the authoritative current value in the same operation and return
no-match when an old key no longer represents it. Membership-number,
id-card-number, vat-number and legacy-member-id recheck
`studentAdminProfiles`; auth-user-id rechecks `students.userId`. The owning
create/link/change and recheck share one same-academy transaction.

T093 owns explicit single-field index exemptions for `studentAdminProfiles`
membershipNumber, idCardNumber, vatNumber, legacyMemberId and frequencyNote,
for `memberDirectoryCursorStates` afterLegacyDocumentId,
and for legacy `members` membershipNumber, fullName, email, idCardNumber,
vatNumber, birthDate, mobileNumber, frequency, source and importRunId.
Backend search uses only the blind-key document and direct profile/student gets;
the rollback adapter direct-gets legacy rows. Raw-value collection scans and
Firestore indexes are prohibited.

The coordination state uses closed reader versions `legacy-v1`, `canonical-v1`
and the emergency privacy-safe `legacy-rollback-v1`; directory write modes are
`legacy-v1`, `canonical-v1` or `blocked`. Freeze states are `open`/`frozen`,
stateRevision is monotonic and leases are bounded. Operation phases are idle,
bootstrap, identity-reconcile, forward, compensation, rollback-projection,
rollback-readonly, canonical-recovery, restore-prepared, restore-recovery or
restore-rehearsal-complete. Every normal identity
writer and every chunk reads the current state, revision and lease inside its
own transaction. Every canonical identity mutation advances stateRevision and
the non-restorable guard in that same transaction. Chunks advance revision and
lastCommittedChunkNo atomically.
An expired lease fails closed and requires audited recovery; it never unfreezes
itself. Initial operationDeadline is at most 30 minutes, or two hours only for
identity-reconcile-paged-v2. After either deadline, each fresh
post-deadline-recovery approval may issue exactly one new lease/deadline bounded
to 30 minutes from server now without changing plan, mode, phase, freeze or
domain data; every later lapse requires another non-replayable approval.

The stable rollback-readonly tuple is `legacy-rollback-v1/blocked/frozen` with
phase rollback-readonly, no active operation/lease/deadline and
lastCommittedChunkNo=0. Ephemeral `memberDirectoryCursorStates` may exist for a
five-minute rollback page but are not state-machine cursors. A separately
approved canonical-recovery operation acquires a fresh
lease directly from that tuple without opening legacy writes, even after a long
interval. Canonical identity reconciliation is valid only as
`canonical-v1/blocked/frozen/identity-reconcile` and preserves the global
marker. The only valid prepared restore tuple is
`canonical-v1/blocked/frozen/restore-prepared`, with preparedOperationId,
lastCommittedChunkNo=0 and no active operation/lease/deadline. One atomic target
transaction creates state, guard head/event, planned restore parent and audit;
restore acquisition clears preparedOperationId and enters restore-recovery with
a fresh operation and lease. Isolated restore recovery is always
canonical-v1/blocked/frozen regardless of the source marker. Any legacy reader
with marker=true and every unlisted tuple fail before domain reads.
The only terminal restore tuple is
`canonical-v1/blocked/frozen/restore-rehearsal-complete`; it has no active
operation/lease/deadline and lastCommittedChunkNo=0. Application bootstrap
rejects the restore-only project and the directory parser rejects prepared,
recovery and terminal restore phases.

While `globalLegacyReadEliminated=false`, rollbackProtocolVersion is exactly
`legacy-projection-v1`, rollbackCapacityLimit is 400 and
rollbackEligibleStudentCount is the monotonic number of identities admitted to
a stable canonical set. Existing pre-forward students form its baseline;
operation-private forward outputs do not increment it until atomic cutover, so
failed compensation never decrements it. In a stable false-marker tuple it
equals the student count because normal hard delete is forbidden. Every normal
student create increments it in the same transaction; the create after 400
fails with zero domain/key/audit writes. Forward receipt and pre-write recheck
bind pre-existing + planned-new = post-cutover <= 400. Global elimination sets
the protocol to disabled and retains the count as audit metadata.

The top-level restore-guard head and append-only event chain use the schema in
the T092 table. State initialization creates revision zero head/event. Every
state revision direct-gets and verifies head/state agreement, HMAC chain,
project, tenant, monotonic marker/count/epoch, then updates state/head and
creates the next event in one transaction. Missing/divergent evidence or an
event collision yields zero state/domain writes. Restore compare-and-swaps this
head and increments restoreEpoch; the global marker transaction advances it
with globalLegacyReadEverEliminated=true.

Pre-global identity reconciliation is bounded by rollback-v1. Post-global
`identity-reconcile-paged-v2` instead captures one state/guard revision, then
independently pages students and studentAdminProfiles by document ID in pages of 200. It rejects row 10,001 in either set, orphan/profile ID or tenant/version
mismatch, and any state/guard revision change between the initial and final
read. It binds both exact manifests before a planned receipt, processes at most
50 student bundles per chunk and has a two-hour initial deadline. Acquisition
rejects a stale inventory. Both protocols keep the same secretVersion and use
separate frozen/applying/verified/completed transactions.

Operation types are identity-key-bootstrap, identity-key-reconcile,
directory-forward, post-cutover-rollback, canonical-recovery,
member-directory-restore-recovery and global-legacy-elimination. Chunk phases
are bootstrap, identity-reconcile, forward, compensation, rollback-projection,
canonical-recovery and restore-recovery. Chunk receipts remain create-only
`committed`; parent success is always planned -> frozen -> applying -> verified
-> completed in separate audited transactions, except the atomic metadata-only
global marker. A crash resumes only the exact next transition and stable reader
state is never exposed before parent completion.

Only directory-forward has compensation chunks. A failed bootstrap either
resumes its exact plan or uses failed-bootstrap-abandon to preserve all
monotonic keys and terminate the parent without entering compensation.

Every T092 integrity value derived from a private source/path/body is a
domain-separated HMAC-SHA-256 MAC under a versioned migration-integrity secret
that is distinct per environment and distinct from the identity-key secret.
Receipts store only MACs, versions and counts. Plain SHA-256 is limited to
public code/schema artifacts without personal data. Remote use fails closed
unless both secret versions are available from approved backend secret
management.

### T021 profile registration projection

T021 implements the minimal adult registration projection in the canonical `users` and `students`
collections. `academies/{academyId}/users/{userId}` is written only for the authenticated adult;
`academies/{academyId}/students/{studentId}` is the participant record and carries `userId` only for
that adult participant. A minor has no Auth account and no `userId` in this contract. `familyId`,
guardian links, health/support data, consents, documents, memberships, belts, and stripes are not
created by T021; `T022`, `T023`, `T018`, `T024`, `T032`, and `T083` own those later aggregates.

The browser has no direct read or write path to either collection. `getClientProfile` and
`saveClientProfile` derive `academyId`, `userId`, actor fields, status, participant type, and
timestamps in the backend. Both documents are created or updated in one Firestore transaction, and
the update path preserves `createdAt` and `createdBy`. The registration was additive only at the
historical T021 boundary; no existing `members` records were migrated or reconciled by that task.
ADR-009/T092 now defines `students` as the sole participant identity and T093 owns the reversible
administrative-directory convergence.

### T092 canonical directory and legacy boundary

`academies/{academyId}/students/{studentId}` is the only operational participant identity.
Memberships, bookings, attendance, consents, progress and reports use that `studentId`;
`studentAdminProfiles` can never grant those capabilities. Commercial status is derived only from
`memberships`, `invoices` and `payments`.

The historical `members` collection is legacy-only and is not part of the canonical collection
list. T093 may switch the administrative directory reader only after normal writers to `members`
are gone. The cutover transaction sets the administrative reader/write mode to canonical and
releases the identity freeze after all chunks and identity-key coverage verify. Explicit
compatibility readers in Levels/reporting remain until T097 replaces them; the independent
`globalLegacyReadEliminated` marker remains false until then. A rollback compensator is the sole
exception: under freeze, exact receipt and separate authorization it may create a missing legacy
projection, but never overwrite an original document.

Every directory request reads `memberDirectoryStates/current`, cursor state and
domain/profile rows in one Firestore transaction/snapshot. A concurrent state
transition locks/retries the request before return. `legacy-v1` returns migration-required with zero
members/students queries because a legacy member ID cannot be exposed as a
student ID. Only the exact canonical open/idle tuple queries students. The exact
stable rollback-readonly tuple invokes the bounded privacy-safe adapter. Every
active bootstrap, forward, reconciliation, rollback projection, recovery or
restore tuple fails closed, so partially migrated students never become visible.

New migrated adults receive backend-generated opaque `studentId` values bound by the private
manifest MAC; `legacyMemberId` is never reused to create an identity. They are created with
`active: false` and the existing `status: "inactive"`. A later activation is a separate audited
canonical command. A legacy membership/payment label never activates the student or creates
access. A minor is eligible only through an explicit match to an existing same-academy student,
active family and active relationship; migration never creates that linkage. Normal operations
never auto-match by name, email or birth date.

Failure before cutover leaves the reader legacy and permits only exact-plan resume or receipt-bound
failed-forward compensation. Rollback after cutover first creates and verifies every missing legacy
directory projection, then switches the reader; it preserves canonical records. Generated legacy
projections use opaque `memberId=studentId`, `membershipStatus=inactive` and
`paymentStatus=unknown`, exact placeholder `fullName=Canonical student`, and no optional MemberRecord
field; they never become commercial authority. That emergency legacy view remains
read-only with directoryWriteMode=blocked/freezeStatus=frozen until a verified canonical forward
recovery; no permanent dual-write is reintroduced. Its adapter resolves an original legacy row
through the `legacy-member-id` blind key, verifies the current admin profile and emits only the
canonical studentId. Stale, missing or duplicate mappings fail closed and legacyMemberId is never
returned.

Backup/restore v3 must capture and validate `members`, `students`, `studentAdminProfiles`,
`studentIdentityKeys`, `studentRestrictedReadLimits`, `memberDirectoryStates`,
`memberDirectoryMigrations`, `memberDirectoryMigrationChunks`, `memberDirectoryApprovals`,
`memberDirectoryApprovalConsumptions` and their audit events as one consistent identity boundary,
plus direct progress/promotions/medical leaves and
the still-transitional nested Levels history. The manifest binds snapshot read time/revision/marker,
reader/write/freeze/phase, rollback protocol/count, code/schema versions, collection counts/roots,
the baseline MAC/artifact ID and exact secret versions. It does not copy encrypted private
artifacts, but the isolated rehearsal requires reopening and verifying each one. Retention,
anonymization and key release belong to T011; until that decision, there is no normal hard delete,
serving restore or real-data cutover.

`backupManifestMac` is a domain-separated source-integrity HMAC over the full canonical closed v3
manifest, including privateManifestMac. The exact source `memberDirectoryStates/current` is captured
by backup v3 as encrypted source-authority evidence, not as a target payload document. A separate
domain-separated `sourceStateEvidenceMac` covers its canonical path and full closed body and is bound
by the manifest, target restore parent and source-local I4
attestation and is reverified during planning, I2/I3 verification and I4. The target state is newly created
only in target-control; source state, guard, lease and approvals are never materialized as target
authority or written over that path.

Backup v3 binds `artifactDispositionVersion=member-directory-restore-v1`. The exact source state is
`verify-only-authority`; every other allowlisted direct/nested tenant artifact is
`materialize-exact`; cursor state, import sessions and top-level guards/attestations/consumptions are excluded before
backup; every other disposition/path is rejected. The backup root covers materialized plus
verify-only rows, the payload root covers only materialized rows, and sourceStateEvidenceMac covers
the sole verify-only row. Target-control is generated only by the rehearsal; v1 has no remap.

T097 sets `globalLegacyReadEliminated=true` only through a metadata-only
global-legacy-elimination operation. Its MAC binds the completed canonical cutover, state revision,
identity baseline, deployed code/schema, a zero legacy-dependency proof, backupManifestMac,
sourceStateEvidenceMac and the source-local create-only I4 restore attestation ID/MAC/attested read
time/inventory MAC/target project/revision/epoch/roots from a verified backup-v3 isolated rehearsal.
Before creating the source planned operation, the planner verifies that attestation, repeats target I4
through the dual-project preflight and binds its fresh verification read time/inventory MAC. One
approved transaction requires
canonical-v1/canonical-v1/open/idle with no lease,
direct-gets and create-only consumes the exact attestation, consumes the exact approval, increments
revision, advances the matching guard head/event with its
ever-eliminated marker true, completes the receipt and audits. It conflicts atomically with rollback
acquisition, is idempotent only for the exact completed receipt, never returns the marker to false
in v1 and never deletes `members`.

Owner role provisioning uses the backend-only deterministic lock path
`academies/{academyId}/adminRoleLocks/{uid}`. The lock carries a short numeric
lease and is acquired, checked, and released in Firestore transactions. Stale
leases may be replaced; malformed or active locks fail closed. Rules do not
grant clients access to this coordination collection.

The `family -> relationship -> student` chain is the source of truth for
tutor access. `families` does not embed all students, and `students` does not
embed a list of authorized adults. A query may use a relationship projection,
but the projection cannot replace the relationship document for authorization.

T022 creates a family and all supplied minor/relationship records in one
Firestore transaction after verifying the tutor in Firebase Auth and the same
academy `users` document. An adult may belong to only one family, each minor
has one active tutor relationship, and `primaryContactUserId` equals
`billingContactUserId`. The guardian projection returns only family status,
the guardian's own contact fields, and linked minor name, birth date, center,
preferences, and status. It excludes IDs for internal records, actors, claims,
relationships, health, waivers, documents, memberships, payments, attendance,
and progress. The browser never reads these collections directly; Firestore
Rules remain deny-by-default.

## Academy and scheduling contracts

| Collection               | Required fields                                                                                                                                                                                                                                                 | References                                                                                                                                                          | Classification                                                                                          | Write authority                                                                                                                                                             | Deletion/history rule                                                                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `locations`              | `locationId`, `academyId`, `name`, `address`, `timezone`, `active`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `status`                                                                                                               | No mandatory document reference; sessions and classes reference `locationId`.                                                                                       | `Internal`; an intentionally published address projection may be `Public`.                              | Academy configuration backend; operational values remain subject to `T008`.                                                                                                 | Deactivate rather than delete when referenced by classes, sessions, attendance, or audit. Preserve historical location references.                                                                                                      |
| `programs`               | `programId`, `academyId`, `name`, `ageBand`, `discipline`, `level`, `active`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `status`                                                                                                     | No mandatory document reference; classes and sessions reference `programId`.                                                                                        | `Internal`; a published programme projection may be `Public`.                                           | Academy/scheduling backend; `T008` owns final programmes, age bands, disciplines, and levels.                                                                               | Version or deactivate the programme; do not delete a programme referenced by classes, sessions, bookings, or progress.                                                                                                                  |
| `classes`                | `classId`, `academyId`, `programId`, `locationId`, `recurrenceRule`, `instructorIds`, `capacity`, `active`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `status`                                                                       | `programId` -> `programs`, `locationId` -> `locations`, `instructorIds` -> `staff`; same-academy references only.                                                   | `Internal`; becomes `Confidential` when a view includes assigned people or roster context.              | Scheduling/academy backend; capacity and recurrence rules are configurable and owned by `T008`.                                                                             | Deactivate/version the template; generated session and booking history remains intact.                                                                                                                                                  |
| `sessions`               | `sessionId`, `academyId`, `classId`, `programId`, `locationId`, `startAt`, `endAt`, `status`, `capacitySnapshot`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                                           | `classId` -> `classes`, `programId` -> `programs`, `locationId` -> `locations`; no participant array is canonical here.                                             | `Internal` for an unpopulated schedule; `Confidential` when linked to participants or staff assignment. | Scheduling backend; session status and snapshots are backend-owned.                                                                                                         | Preserve sessions referenced by bookings, attendance, checkouts, or audit; corrections update auditable state rather than deleting history.                                                                                             |
| `plans`                  | `planId`, `academyId`, `displayName`, `priceMinor`, `currency`, `billingPeriod`, `eligibleParticipantTypes`, `classSites`, `weeklyClassLimit`, `openMatSites`, `openMatFeeMinor`, `active`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy` | `planId` is the closed T032 catalogue ID and equals the document ID; `academyId` is the tenant. Arrays contain canonical participant types/sites and no duplicates. | `Confidential`; only an active, redacted catalogue projection may be `Public`.                          | Tenant-scoped membership/catalogue backend; all tenant, actor, timestamps, active state, and schema fields are server-owned. Browser direct access remains deny-by-default. | Explicit activation and soft deactivation; no hard delete. Preserve plans referenced by memberships and invoices; historical money records must not be rewritten by editing a current plan.                                             |
| `bookings`               | `bookingId`, `academyId`, `sessionId`, `studentId`, `membershipId`, `status`, `requestedAt`, `cancelledAt`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                                                 | `sessionId` -> `sessions`, `studentId` -> `students`, `membershipId` -> `memberships`; eligibility is recalculated, not copied as authority.                        | `Confidential`                                                                                          | Booking/scheduling backend transaction; client requests are validated server-side.                                                                                          | Status/cancellation history is preserved; retries are idempotent; no normal hard delete of a booking referenced by roster, attendance, payment, or audit.                                                                               |
| `waitlistEntries`        | `waitlistId`, `academyId`, `sessionId`, `studentId`, `membershipId`, `position`, `status`, `requestedAt`, nullable offer/accept/cancel timestamps, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                          | `sessionId` -> `sessions`, `studentId` -> `students`, `membershipId` -> `memberships`; session capacity and membership eligibility remain canonical elsewhere.      | `Confidential`                                                                                          | Waitlist/scheduling backend transaction only; direct Firestore access is denied and callables enforce tenant, RBAC, and student scope.                                      | New writes use the deterministic v2 ID; legacy IDs are read-only compatibility candidates and divergent dual records fail closed. Positions are historical and never renumbered. Preserve status history; cleanup/deletion awaits T011. |
| `sessionCapacityStates`  | `academyId`, `sessionId`, `revision`, `schemaVersion`, `updatedAt`, `updatedBy`                                                                                                                                                                                 | `sessionId` -> `sessions`; the session and confirmed bookings remain canonical.                                                                                     | `Internal`                                                                                              | Booking/waitlist backend transaction only; direct client access is denied.                                                                                                  | Coordination state is backed up with the tenant and never exposed as a business projection.                                                                                                                                             |
| `bookingQuotaStates`     | `academyId`, `quotaId`, `studentId`, `weekStart`, `revision`, `schemaVersion`, `updatedAt`, `updatedBy`                                                                                                                                                         | `quotaId` is `v2:{studentId.length}:{studentId}:10:{Jersey-weekStart-YYYY-MM-DD}`; bookings, sessions, and plans remain canonical.                                  | `Internal`                                                                                              | Booking/waitlist backend transaction only; direct client access is denied.                                                                                                  | Coordination state is backed up with the tenant and never exposed as a business projection.                                                                                                                                             |
| `waitlistPositionStates` | `academyId`, `sessionId`, `lastPosition`, `revision`, `schemaVersion`, `updatedAt`, `updatedBy`                                                                                                                                                                 | `sessionId` -> `sessions`; `lastPosition` is at least the historical maximum `waitlistEntries.position`.                                                            | `Internal`                                                                                              | Waitlist backend transaction only; direct client access is denied.                                                                                                          | `lastPosition` only increases and does not replace or renumber entry positions. It is backed up with the tenant.                                                                                                                        |

T060 implements manual FIFO issuance by `owner`/`administrator`, one active offer per session, a 30-minute TTL capped at one hour before session start, on-demand expiry, and atomic accept/decline. Acceptance revalidates the student, family-linked membership, session, capacity, plan quota, and T038 financial access before creating or restoring the confirmed booking. Queries are bounded and need no new compound index. Automatic promotion/schedulers, notifications, reordering, credits, recurrence, new payment collection, production migration/deployment, and cleanup remain outside this slice.

### T032 `plans` catalogue

The authoritative `BPT-memberships.docx` and `BRIEF.md` define these ten records.
Prices are integer GBP pence; `Pay as you go` is charged per session, including
Open Mat, and its arrears/blocking rule belongs to `T037`. Membership lifecycle
states belong to `T033`; payments, providers, invoices, receipts, balances and
refunds belong to `T034`-`T037`.

| `planId`           | `displayName`    | `priceMinor` | `currency` | `billingPeriod` | `eligibleParticipantTypes` | `classSites` | `weeklyClassLimit` | `openMatSites` |          `openMatFeeMinor` |
| ------------------ | ---------------- | -----------: | ---------- | --------------- | -------------------------- | ------------ | -----------------: | -------------- | -------------------------: |
| `payg`             | Pay as you go    |         1000 | GBP        | `per-session`   | adult, kids, teens         | Town, West   |             `null` | Town, West     | `null` (uses `priceMinor`) |
| `bpt-jersey-adult` | BPT Jersey Adult |        12500 | GBP        | `monthly`       | adult                      | Town, West   |             `null` | Town, West     |                     `null` |
| `west-kids-1x`     | West Kids 1x     |         9500 | GBP        | `monthly`       | kids                       | West         |                  1 | West           |                     `null` |
| `west-kids-2x`     | West Kids 2x     |        11500 | GBP        | `monthly`       | kids                       | West         |                  2 | Town           |                     `null` |
| `west-adult`       | West Adult       |         6500 | GBP        | `monthly`       | adult                      | West         |             `null` | Town, West     |                     `null` |
| `west-teens`       | West Teens       |         4500 | GBP        | `monthly`       | teens                      | West         |                  2 | West           |                        750 |
| `town-adult`       | Town Adult       |         8500 | GBP        | `monthly`       | adult                      | Town         |             `null` | Town           |                     `null` |
| `town-kids-1x`     | Town Kids 1x     |         9500 | GBP        | `monthly`       | kids                       | Town         |                  1 | Town           |                     `null` |
| `town-kids-2x`     | Town Kids 2x     |        13500 | GBP        | `monthly`       | kids                       | Town         |                  2 | Town           |                     `null` |
| `town-teens`       | Town Teens       |         4500 | GBP        | `monthly`       | teens                      | Town         |                  2 | Town           |                        750 |

No new compound index is required: catalogue reads are tenant-scoped with
simple active filtering and canonical catalogue ordering. The seed is
idempotent and is permitted only in the Emulator or isolated staging; its
rollback is deactivation or removal there, with no production migration or
deployment.

### T033 membership lifecycle

The canonical path is `academies/{academyId}/memberships/{membershipId}`. The
document has exactly these fields:

| Field                    | Contract                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `membershipId`           | Backend-generated safe ID; equal to the document ID.                                                                   |
| `academyId`              | Backend-derived tenant.                                                                                                |
| `familyId`               | Existing family in the same academy.                                                                                   |
| `studentId`              | Existing student in the same academy and referenced family.                                                            |
| `planId`                 | Existing active T032 plan in the same academy; T033 does not copy its price, currency, sites, limits, or access rules. |
| `status`                 | Exactly `trial`, `active`, `paused`, `overdue`, or `cancelled`.                                                        |
| `startsAt`               | Server-owned ISO timestamp.                                                                                            |
| `endsAt`                 | Server-owned ISO timestamp or `null`; set on cancellation when it was previously `null`.                               |
| `nextBillingAt`          | ISO timestamp or `null`; informational only and never a charge instruction.                                            |
| `schemaVersion`          | Literal `"1"`.                                                                                                         |
| `createdAt`, `createdBy` | Server-owned creation envelope.                                                                                        |
| `updatedAt`, `updatedBy` | Server-owned update envelope.                                                                                          |

Every family, student, and plan reference is checked for the same tenant, and
the student must belong to the referenced family. One student may have only one
current membership across `trial`, `active`, `paused`, and `overdue`. Cancelled
documents remain queryable as history and do not count as current; a later
membership requires a new backend-generated ID.

The only T033 transition table is:

| Current status | Allowed target statuses              |
| -------------- | ------------------------------------ |
| `trial`        | `active`, `cancelled`                |
| `active`       | `paused`, `overdue`, `cancelled`     |
| `paused`       | `active`, `cancelled`                |
| `overdue`      | `active`, `cancelled`                |
| `cancelled`    | None; terminal and not reactivatable |

Creation accepts only `trial` or `active`. Same-state retries are idempotent and
write neither a new membership state nor an audit event. Invalid transitions
fail without writes. T033 does not hard-delete or reactivate cancelled history.

All operations go through authenticated Functions with tenant and scope checks;
Firestore browser access remains deny-by-default for `get`, `list`, `create`,
`update`, and `delete`. `owner` and `administrator` may create and transition
valid memberships within their tenant. A `guardian` may read their family and
create only a `trial` for a related active minor. An `adultStudent` may read
their own memberships and create only their own `trial`. `headCoach` and `coach`
are denied all membership operations. Anonymous, cross-tenant, inactive, or
unrelated requests fail closed without revealing membership existence.

Effective creation and status changes append exactly one create-only audit event
in the same transaction: `membership.created` or
`membership.status.changed`. The event keeps only the tenant, actor, action,
target reference, purpose, correlation, and the writer-owned generated
`auditEventId`, `occurredAt`, `result: "completed"`, and `schemaVersion: 1`.
It never includes prices, payment/debt details, plan snapshots, payloads,
emails, phones, claims, tokens, medical data, or before/after records. T033
does not add an audit reader or UI.

T033 creates no prices, charges, payments, invoices, receipts, balances,
refunds, or debt documents. Manual finance, PAYG debt, and reservation blocking
belong to `T037`/`T038`; provider adapters, hosted checkout, and webhooks remain
separate in `T034`-`T036`. T033 adds no new compound index; any existing query
contract still requires its owning module and test, and an index never grants
authorization.

Rollback is limited to cleaning synthetic Emulator/isolated-staging documents
or leaving a membership in `cancelled`; no production migration, production
write, or deployment is part of T033.

## Attendance and check-out contracts

| Collection   | Required fields                                                                                                                                                             | References                                                                                                                         | Classification | Write authority                                                                                     | Deletion/history rule                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attendance` | `attendanceId`, `academyId`, `sessionId`, `studentId`, `state`, `occurredAt`, `correctionOf`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `status` | `sessionId` -> `sessions`, `studentId` -> `students`, `correctionOf` -> the canonical attendance record when this is a correction. | `Confidential` | Attendance backend; check-in methods are inputs, not authority.                                     | The canonical record uses the deterministic ID. A correction stays in `attendance` with a backend-generated opaque ID, points to the canonical record through `correctionOf`, preserves the original, and writes an `auditEvents` record. |
| `checkouts`  | `checkoutId`, `academyId`, `sessionId`, `studentId`, `adultUserId`, `method`, `checkedOutAt`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy` | `sessionId` -> `sessions`, `studentId` -> `students`, `adultUserId` -> `users` or a validated authorized-adult relationship.       | `Restricted`   | Check-out/attendance backend with an authorized staff or adult actor; no client-selected authority. | Preserve delivery evidence and status transitions. Corrections are audited; no normal hard delete of a child release record.                                                                                                              |

Attendance and check-out are canonical in Firestore. RTDB presence can make a
temporary operational view more responsive, but it cannot mark a student
present, close a checkout, or reconstruct either collection.

## Commercial and payment contracts

| Collection      | Required fields                                                                                                                                                                                                                                | References                                                                                                                                                       | Classification                                                                       | Write authority                                                                                                                                                                 | Deletion/history rule                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memberships`   | `membershipId`, `academyId`, `familyId`, `studentId`, `planId`, `status`, `startsAt`, `endsAt`, `nextBillingAt`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                           | `familyId` -> `families`, `studentId` -> `students`, `planId` -> `plans`; family, student, and plan references must be existing records in the same `academyId`. | `Confidential`                                                                       | Membership lifecycle backend; Auth actor, tenant, scope, status, timestamps, references, and envelope are server-owned. Transitions are explicit and never trust client status. | Preserve trial, active, paused, overdue, and cancelled history; cancellation is soft, terminal, and never hard-deleted or reactivated. A new membership uses a new ID. T033 does not duplicate plan prices/rules or create financial records. |
| `invoices`      | `invoiceId`, `academyId`, `familyId`, `membershipId`, `status`, `totalMinor`, `currency`, `dueAt`, `paidAt`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `chargeKind`, `sourceRef`, `invoiceReference`, `description` | `familyId` -> `families`, `membershipId` -> `memberships`; `sourceRef` is required and same-tenant for `payg_session`; payments reference the invoice.           | `Confidential`; refund and sensitive approval history may be `Restricted`.           | Billing/finance backend and approved staff workflow; T037 manual writers are owner/administrator only.                                                                          | Preserve invoice state, totals, due dates, payments, and corrections. `void` preserves an unpaid invoice; no normal hard delete or silent total rewrite.                                                                                      |
| `payments`      | `paymentId`, `academyId`, `familyId`, `invoiceId`, `status`, `amountMinor`, `currency`, `method`, `manualReference`, `providerReference`, `occurredAt`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                    | `familyId` -> `families`, `invoiceId` -> `invoices`; T037 sets `providerReference: null`; provider evidence belongs to T034-T036.                                | `Confidential`; provider evidence and sensitive correction history are `Restricted`. | Billing/payment backend and explicitly authorized finance workflow; browser access remains deny-by-default.                                                                     | Financial history is append-only in effect: create payments, derive balances/debt, and never silently overwrite or delete a payment.                                                                                                          |
| `paymentEvents` | `eventId`, `academyId`, `paymentId`, `provider`, `providerEventId`, `eventType`, `receivedAt`, `verifiedAt`, `idempotencyKey`, `schemaVersion`                                                                                                 | `paymentId` -> `payments`; `providerEventId` and `idempotencyKey` identify the verified provider event without storing a full payload.                           | `Restricted`                                                                         | Payment integration backend only after signature, timestamp, scope, and idempotency verification.                                                                               | Append-only. Interactive users cannot update or delete events; reconciliation adds a new event or audited correction rather than rewriting provider history.                                                                                  |

The application never stores full card numbers, CVV/CVC, PIN, track data,
passwords, MFA secrets, provider secrets, R2 keys, or service-account keys.
Provider-specific payment behavior remains behind `T010` and cannot alter the
canonical history without verified, idempotent reconciliation.

### T105 club shop catalog and collection orders

The club shop replicates the public `bptjersey.com/club-merchandise` showcase
(GIs, rashguards, shorts, backpacks, casual clothing) inside the platform. The
landing page shows a static category showcase; prices, sizes and ordering live
behind the authenticated client area, and the catalog is managed from
`/admin/shop`. There is no online checkout: an order is a collection request
paid at the academy, consistent with the manual finance boundary of `T037` and
the blocked payment provider decision of `T010`. Shop orders do not create
`invoices` or `payments`; if the academy needs a receipt it uses the manual
finance flow.

| Collection     | Required fields                                                                                                                                                                                                                                                                                                                                | References                                                                                                                                 | Classification                                              | Write authority                                                                                                                                                 | Deletion/history rule                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shopProducts` | `productId` (slug, document ID), `academyId`, `name`, `category`, `description`, `priceMinor`, `currency`, `sizes`, `imageUrl`, `stockStatus`, `sortOrder`, `active`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                                                                     | None. `imageUrl` is an `https:` URL or a `/shop/...` path served by the web app; no R2 upload is involved.                                 | `Internal` (public marketing data)                          | `saveShopProduct` / `setShopProductActive`, owner or administrator only, App Check enforced.                                                                    | Products are never hard-deleted; `active: false` hides them from clients while past orders keep their product snapshot. Every save and visibility change writes `auditEvents`.        |
| `shopOrders`   | `orderId` (`order-<requestId>`, document ID), `academyId`, `requestId`, `customerUserId`, `productId`, `productName`, `category`, `size`, `quantity`, `unitPriceMinor`, `totalMinor`, `currency`, `contactName`, `contactPhone`, `note`, `status`, `paymentStatus`, `staffNote`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy` | `customerUserId` -> `users` (Auth UID of the guardian or adult student), `productId` -> `shopProducts` (price and name are snapshotted). | `Confidential` (customer contact details and purchase data) | `placeShopOrder` for `guardian`/`adultStudent`; `updateShopOrder` for owner/administrator. Price, totals, tenant, customer and timestamps are server-owned.       | Append-only in effect: status moves `requested -> confirmed -> ready -> collected`, `cancelled` is terminal, and payment is toggled by staff. No hard delete; every change is audited. |

Idempotency: `orderId` derives from the client `requestId`, so a replay by the
same customer returns the stored order and a replay by another user is rejected.
Queries are single-field equality (`academyId`, `customerUserId`) with bounded
limits, so no new composite index is required. Firestore Rules deny direct
client access to both collections.

### T037 manual finance boundary

T037 uses `invoices` as the canonical charge source and `payments` as recorded
manual allocations. It does not create `balances` or `debts` collections. An
invoice adds the server-validated `chargeKind` (`membership`, `payg_session`,
or `manual_adjustment`), an opaque `sourceRef` when the kind is
`payg_session`, a tenant-scoped `invoiceReference`, and a bounded staff label.
`payg_session` invoices are created only by an internal service with validated
source context until the booking/session owner exists.

Invoice statuses are `open`, `partially_paid`, `paid`, and terminal `void`.
`paidAt` is server-owned and only set when the derived remaining balance reaches
zero. A void operation preserves an open invoice with no applied payment; it
does not delete, refund, reverse, or rewrite financial history. T037 does not
store or enforce an overdue policy.

Manual payments store only positive integer GBP minor units, `cash`,
`bank_transfer`, or `other`, an opaque tenant-scoped `manualReference`,
server-owned timestamps, and `providerReference: null`. Payment documents are
created only; correction/void workflows are outside T037. Invoice balance,
family account balance, PAYG debt, and a redacted receipt projection are read
models derived from invoices and recorded payments.

Only owner/administrator Functions commands write these collections. Guardians
read their linked family; adult students read their own membership-linked
financial scope; head coaches and coaches are denied. Browser access to both
collections remains deny-by-default. T037 adds no provider, checkout, webhook,
refund, discount, freeze, trial billing, automated renewal, UI, booking write,
production migration, or production write; T038 owns reservation blocking and
recovery.

## Development, CRM, and communication contracts

| Collection                | Required fields                                                                                                                                                                                                                             | References                                                                                                                                                                                                                                                            | Classification                                                                                          | Write authority                                                                                                                  | Deletion/history rule                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assessments`             | `assessmentId`, `academyId`, `studentId`, `coachStaffId`, `sessionId`, `dimensions`, `observedAt`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                            | `studentId` -> `students`, `coachStaffId` -> `staff`, `sessionId` -> `sessions`; dimensions are owned by `T009`.                                                                                                                                                      | `Confidential`                                                                                          | Development/assessment backend; assigned coach or authorized head coach workflow.                                                | Preserve the original assessment and correction author/moment; no normal hard delete. `T009` owns final review and weighting rules.                                                                                   |
| `studentLevelProgress`    | `studentId`, `academyId`, `systemId`, optional `currentDefinitionKey`/`currentLevelStartedAt`/`lastApprovedPromotionId`, bounded `skillSummary`, `state`, `schemaVersion`, timestamps/actors                                                | Document ID and `studentId` -> `students`; `systemId` -> one published `levelSystems`; promotion pointer -> `levelPromotions`.                                                                                                                                        | `Restricted` for a minor; otherwise `Confidential`                                                      | Development backend only. Assessment may update reviewed skill summary; an approved promotion updates the level head atomically. | One mutable, reconstructable head per student. Missing document means `uninitialized`, never an inferred white belt. Preserve audit and promotion history.                                                            |
| `levelPromotions`         | `promotionId`, `academyId`, `studentId`, `systemId`, optional `fromDefinitionKey`, `toDefinitionKey`, `decisionStatus`, `proposedBy`, `decidedBy`, `decidedAt`, optional `ceremonyDate`/`decisionNotes`, `schemaVersion`, timestamps/actors | `studentId` -> `students`; definition keys -> the exact immutable level system; staff references are same-academy.                                                                                                                                                    | `Restricted` for a minor; otherwise `Confidential`                                                      | Development backend; only `headCoach` may approve/reject. Owner cannot substitute the required technical decision.               | Append-only formal decision. Approval creates the promotion, updates `studentLevelProgress` and appends audit in one transaction; no automatic grant or hard delete.                                                  |
| `recognitions`            | `recognitionId`, `academyId`, `studentId`, `category`, `proposedBy`, `approvedBy`, `approvedAt`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                              | `studentId` -> `students`, `proposedBy` and `approvedBy` -> `staff`; approval must be a human head coach decision.                                                                                                                                                    | `Confidential`                                                                                          | Development backend; proposal and approval are separate authorized actions.                                                      | Preserve proposal, approval, rejection, and correction history; no automatic grant and no public child leaderboard.                                                                                                   |
| `leads`                   | `leadId`, `academyId`, `contactReference`, `source`, `ownerId`, `status`, `nextActionAt`, `consentState`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                               | `contactReference` may point to an adult/family record when linked; `ownerId` references an authorized `users` or `staff` identity.                                                                                                                                   | `Confidential`                                                                                          | CRM backend and assigned owner workflow; consent state is backend-validated.                                                     | Preserve status and activity history; deactivate or redact only through the future `T011` policy, not a casual delete.                                                                                                |
| `messages`                | `messageId`, `academyId`, `audienceId`, `channel`, `templateKey`, `sentAt`, `createdBy`, `status`, `schemaVersion`, `createdAt`, `updatedAt`, `updatedBy`                                                                                   | `audienceId` is a backend identifier for an evaluated audience, not a collection or path. It is evaluated from canonical `relationships`, `families`, `students`, `sessions`, and `programs`/`classes` as applicable; the message stores only this minimal reference. | `Confidential`; communication involving a minor is `Restricted`.                                        | Communication backend and authorized sender workflow; clients cannot create a private minor-coach channel.                       | Preserve sent message status and delivery linkage. Audience membership is recomputed/validated and is never authorized from `audienceId` alone; restricted content or recipients require a separate authorized query. |
| `deliveryEvents`          | `deliveryEventId`, `academyId`, `messageId`, `provider`, `providerEventId`, `status`, `occurredAt`, `idempotencyKey`, `schemaVersion`                                                                                                       | `messageId` -> `messages`; provider identifiers are minimal opaque evidence.                                                                                                                                                                                          | `Confidential`; classification inherits `Restricted` when the source audience or payload is restricted. | Communication integration backend after provider verification and idempotency checks.                                            | Append-only delivery history; retries do not duplicate events and interactive users cannot rewrite provider evidence.                                                                                                 |
| `notificationPreferences` | `preferenceId`, `academyId`, `audienceId`, `purpose`, `channel`, `enabled`, `consentState`, `updatedAt`                                                                                                                                     | `audienceId` is a backend identifier for an evaluated audience; it is not a path or authorization grant.                                                                                                                                                              | `Confidential`; consent state is privacy-sensitive.                                                     | Only `owner`/`administrator` backend callables; direct client reads/writes are denied by Rules.                                  | Upsert by deterministic preference identity; withdrawal/disable is retained as state and not hard-deleted.                                                                                                            |

`skillProgress` and the nested transitional paths
`students/{studentId}/evaluations` and `students/{studentId}/graduations` are not
additional canonical heads. T097 must migrate/adapt their history into
`assessments`, `studentLevelProgress` and `levelPromotions`, stop all new writes
to the transitional paths, and prove that Levels/reports never enumerate or
write `members` before setting the global legacy-read marker. Formal promotion
is head-coach-only. Absence of `studentLevelProgress` is rendered as
`uninitialized`; code must not substitute the first catalog definition.

Communication records never create a hidden one-to-one channel between a coach
and a minor. No new audience collection or audience path is introduced by this
contract. `audienceId` is a minimal backend identifier for an audience evaluated
from the existing canonical records `relationships`, `families`, `students`,
`sessions`, and `programs`/`classes` as applicable. Audience membership is not
canonical in that ID and is not authorized from that ID alone. Audience,
assignment, guardian visibility, provider event verification, and opt-out are
backend decisions.

## Restricted governance contracts

| Collection          | Required fields                                                                                                                                                                                                                                                      | References                                                                                                                                    | Classification                                                                      | Write authority                                                                                                                              | Deletion/history rule                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `medicalLeaves`     | `leaveId`, `academyId`, `studentId`, `startDate`, `endDate`, minimized `reasonCode`, `status`, `schemaVersion`, timestamps/actors                                                                                                                                    | `studentId` -> `students`; no general progress/directory projection may return the reason.                                                    | `Restricted`                                                                        | Restricted health/support backend; only a minimized authorized interval may pause an eligibility calculation.                                | Preserve the leave and audit history. Review, expiry and deletion await T011; no nested unbacked copy under a student after T097.                                                                                                                      |
| `healthProfiles`    | `healthProfileId`, `academyId`, `studentId`, `minimumOperationalSupport`, `reviewState`, `expiresAt`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                                                  | `studentId` -> `students`; references to documents, if needed, use `documents` and inherit `Restricted`.                                      | `Restricted`                                                                        | Restricted health/support backend and expressly authorized staff or guardian workflow.                                                       | Minimum operational data only; expire/review through status and the `T011` policy. Never store a full medical record or narrative here.                                                                                                                |
| `safeguardingCases` | `caseId`, `academyId`, `studentId`, `intakeReference`, `participants`, `actions`, `resolution`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                                                        | `studentId` -> `students`; `participants` and `intakeReference` use controlled references, not unrestricted narrative payloads.               | `Restricted`                                                                        | Safeguarding backend; intake and case reading have separate authorization scopes.                                                            | Preserve intake, actions, resolution, actor, and audit history. No normal hard delete, and no full safeguarding narrative in a general profile or log.                                                                                                 |
| `waiverVersions`    | `waiverVersionId`, `academyId`, `versionLabel`, `title`, `introduction`, four fixed `clauses`, `contentHash`, `effectiveAt`, `status`, `supersededAt`, `schemaVersion`, timestamps and actors                                                                        | One current `published` version per academy; the server hash covers only the normalized immutable content and effective timestamp.            | `Restricted` governance content; client receives an allowlisted current projection. | Owner/administrator callable only; direct Firestore access remains denied and no legal template is bundled.                                  | Publication creates a new immutable version. Supersession or withdrawal changes lifecycle metadata without deleting or rewriting the prior text.                                                                                                       |
| `consents`          | `consentId`, `academyId`, `subjectType`, `subjectId`, `waiverVersionId`, `versionLabel`, `waiverContentHash`, `signedBy`, `signatureMethod`, four `clauseResponses`, `signedAt`, `revokedAt`, `evidenceDocumentId`, `status`, `schemaVersion`, timestamps and actors | `subjectId` -> `students`; `waiverVersionId` -> `waiverVersions`; `signedBy` -> adult `users`; `evidenceDocumentId` -> `documents`.           | `Restricted`                                                                        | Consent backend; adult self or active guardian scope is revalidated against canonical records and authenticated claims.                      | One acceptance per subject/version. Revocation preserves the signed facts and evidence; renewal requires a later published version. No interactive hard delete.                                                                                        |
| `documents`         | `documentId`, `academyId`, `studentId`, `kind`, `objectKey`, `fileName`, `contentType`, `sizeBytes`, `sha256`, `signedAt`, `status`, `schemaVersion`, timestamps and actors                                                                                          | `studentId` -> `students`; `objectKey` references a tenant-scoped private R2 PDF, never a public URL.                                         | `Restricted`                                                                        | Document/R2 backend; access is issued only after current authorization and exact consent-document validation.                                | Metadata and blob are retained on consent revocation; status is updated non-destructively. Deletion/retention follows `T011`.                                                                                                                          |
| `auditEvents`       | `auditEventId`, `academyId`, `actorId`, `action`, `targetRef`, `purpose`, `correlationId`, `occurredAt`, `result`, `schemaVersion`; exact variant metadata for each approved action                                                                                  | `actorId` references a user/system actor; `targetRef` identifies the affected academy record without copying the full payload.                | `Restricted`                                                                        | Backend/system writer only; all current writers use transaction create-only; no interactive client or owner UI can mutate an existing event. | Append-only. Events are never updated or deleted by an interactive action; retention and archival await `T011`. Regyfit replay may accept one equivalent legacy event missing only `auditEventId`/`occurredAt`; no migration rewrites existing events. |
| `exports`           | `exportId`, `academyId`, `requestedBy`, `purpose`, `scope`, `classification`, `recipient`, `expiresAt`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                                                | `requestedBy` references an authorized actor; `scope` identifies approved source records and `recipient` is validated by the export workflow. | `Restricted` and inherits the highest classification of its source data.            | Export/reporting backend after separate authorization, purpose, scope, recipient, expiry, and audit checks.                                  | Export status and audit history are preserved. Downloadable content is not a canonical collection and expires; retention/deletion follows `T011`.                                                                                                      |
| `retentionAlerts`   | `alertId`, `academyId`, `studentId`, `kind`, `severity`, `status`, `reasonCode`, minimal `evidence`, `deduplicationKey`, `createdAt`, `schemaVersion`                                                                                                                | `studentId` -> `students`; derived from canonical attendance and membership records.                                                          | `Restricted` derived operational projection.                                        | Trusted retention backend only; all direct client access is denied. Owner/administrator receive only the minimized callable projection.      | Idempotent deterministic writes preserve existing evidence. No interactive delete; archive/deletion awaits `T011`. The projection is reconstructable from canonical sources.                                                                           |
| `exportRateLimits`  | `academyId`, `actorKey`, `startedAt`, `count`, `updatedAt`, `schemaVersion`                                                                                                                                                                                          | `actorKey` is a SHA-256 technical key derived from the tenant and requesting actor; it is not an authorization grant.                         | `Restricted` technical control state.                                               | Export backend only; direct client access remains denied.                                                                                    | One bounded record per tenant/actor is overwritten when its five-minute window advances. It contains no report content or person profile data.                                                                                                         |

### T062 retention alert projection

`retentionAlerts` is additive and is not a source of truth for attendance,
membership, identity, or contact data. The producer is internal, DI-only
composition through `createRetentionAlertProducer`; it is not exported from the
Functions runtime entry point and does not add a public producer callable,
scheduler, or trigger. Its Firestore source reads at most 200 current
`trial`/`active` memberships, their directly referenced `students`, and at most
5,000 recent `attendance` records. It accepts only active students in the same
academy. Attendance projections must carry schema version `1`, and canonical
records must use `{sessionId}__{studentId}`; opaque corrections must point back
to that exact canonical identity. The membership start is the inactivity
baseline when newer than the last attended event. Attendance before that start,
corrections, excused events, future events, and records outside the eligible
student set are ignored.

The producer canonicalizes `runDate` to a UTC calendar day, evaluates the
closed T062 policy, and produces at most 200 alerts. The trusted store rejects
cross-tenant input, unknown fields, invalid dates or identities, duplicate
alerts, over-limit batches, and divergent existing documents. One Firestore
transaction creates every missing
`academies/{academyId}/retentionAlerts/{alertId}` document together with the
create-only `academies/{academyId}/auditEvents/{auditEventId}` event whose
action is `retention.alerts.generated`. The audit metadata records the UTC run
date, fixed policy version and bounds, evaluated-student/generated-alert counts, and a SHA-256
hash of the minimized canonical source. An exact retry is a no-op replay;
missing or altered alerts behind an existing audit event, or any divergent
pre-existing alert, fail closed without partial writes.

`listRetentionAlerts` is the only wired T062 runtime surface in the current source. It remains
owner/administrator-only, read-only, and bounded to the newest 200 records. Its
`studentReference` field is currently exactly the opaque internal `studentId`;
it is not a pseudonymized identifier. Pseudonymizing that value and reconciling
the callable contract and tests is an explicit gate before T062 may be enabled
in production against real student data. The projection omits contact data,
financial and membership IDs, tenant fields, alert IDs, and deduplication keys.

T062 introduces no external delivery, migration, production enablement, or
cleanup. Rollback preserves the pre-existing callable/UI and removes only the
DI-only producer, the `commitProductionRun` transaction operation, and the
`retention.alerts.generated` audit variant; any derived documents remain inert.
Production retention or deletion requires T011 and explicit operator approval.

### T053 aggregate export profile

The controlled pilot exposes only `operational_and_progress_aggregates`, the
already-authorized aggregate projections from T051 and T052. It requires an
authenticated `owner` or `administrator`, derives academy and recipient from the
actor, accepts one of three closed purposes, limits the operational range to 31
days, and caps UTF-8 CSV output at 64 KiB. Names, emails, member rows, document
metadata, source record IDs, health, safeguarding, consent, and payment evidence
are outside this profile. Spreadsheet-leading formula characters are neutralized.

The backend returns the CSV inline only after one transaction creates the
`exports` journal and matching `report.export.prepared` audit event. The journal
uses `status: delivered_inline`, `classification: Confidential`, recipient
`actor:{requestedBy}`, a SHA-256 checksum in the audit event, and a ten-minute
authorization expiry. CSV bytes are never written to Firestore or R2.
`exportRateLimits` permits at most five preparation attempts per actor and academy
in five minutes and fails closed if its durable counter is malformed.

This is an additive schema change with no migration or production write. Rollback
is to remove/disable `prepareAggregateReportExport`; existing `exports`,
`auditEvents`, and technical rate-limit documents remain inert evidence/state and
require no rewrite. Applying cleanup or retention in production still requires
T011, a verified backup where applicable, and explicit operator approval.

Health and safeguarding records contain only the minimum operational data. Full
medical records and full safeguarding narratives do not belong in these
collections, general profiles, logs, or exports. Document blobs remain in
private R2; Firestore stores metadata and permissions only. `auditEvents` and
`paymentEvents` are append-only, consent evidence is versioned, and none of
these collections is exposed through a general student/family listing.

`auditEvents` uses the exact discriminated action allowlist in
`packages/domain/src/audit/audit-event.ts`, including the metadata-only
`report.export.prepared` and `retention.alerts.generated` variants.
`auditEventId`, `occurredAt`, `result: "completed"`, and `schemaVersion: 1` are
backend-owned. The retention variant accepts only its fixed system actor,
tenant target, purpose, run date, policy metadata, bounded counts, and source
hash; it does not copy student, membership, or attendance records. The backend
validates the discriminated metadata variant and appends with
`transaction.create`; there is no audit reader or UI in the pilot. Audit drafts
never contain emails, names, claims, tokens, IP addresses, raw records, or full
before/after snapshots. Regyfit and the T062 production run keep deterministic
IDs for replay, while the remaining administrative/member events use automatic
IDs. No migration, hash chain, or retention policy is implied by this
contract; those remain outside `T019` and depend on `T011`.

## Relationships, sources of truth, and module ownership

The following matrix describes the canonical record and the permitted module
boundary. "May read" means that the module can request a scoped read subject
to authorization; it does not grant a role or bypass `T016`.

| Relationship                             | Source of truth                                                                                                                                                                                                                                                            | Module that writes the record                                                                                                              | Modules that may read it                                                                                                                                        | Correction/history behavior                                                                                                                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `family -> relationship -> student`      | `families` owns family identity, `students` owns the protected minor profile, and `relationships` owns tutor identity, permissions, and validity.                                                                                                                          | Identity/family module writes family, student, and relationship records through separate authorized commands.                              | Identity, family access, scheduling, attendance, membership, communication, reporting, and restricted workflows read only the minimum fields for their purpose. | Change `validFrom`, `validTo`, or `status` with audit; do not replace the relationship with an embedded array or delete prior authorization evidence.                                                                                                         |
| `student -> admin profile/identity key`  | `students` owns participant identity; `studentAdminProfiles` owns only Restricted administrative metadata; `studentIdentityKeys` owns uniqueness reservations without raw values.                                                                                          | Identity/directory backend writes the student/profile and create-only reservations transactionally.                                        | General workflows read students only. Purpose-bound admin lookup may resolve one key/profile through a minimized audited command.                               | No normal hard delete. A correction reserves a new immutable key and preserves the prior claim; neither profile nor reservation can grant product access.                                                                                                     |
| `student -> progress/promotion`          | `studentLevelProgress` owns the current reviewed head; `assessments` own evidence; `levelPromotions` own formal decisions; `recognitions` remain separate.                                                                                                                 | Development backend writes evidence; only head coach approval atomically creates a promotion, updates the head and appends audit.          | Authorized student/family/staff/report projections read the minimum scope; no general minor ranking.                                                            | Missing head is uninitialized. Promotions/evidence are preserved; corrections never rewrite the decision history or infer a level from catalog order.                                                                                                         |
| `session -> program/class/location`      | `programs`, `classes`, and `locations` own their records; `sessions` owns the concrete date/time and capacity snapshot.                                                                                                                                                    | Academy/scheduling module writes configuration and session records.                                                                        | Scheduling, booking, attendance, checkout, staff assignment, and reporting read the relevant references.                                                        | A session correction updates auditable session state; it does not rewrite the programme, class template, or location source record.                                                                                                                           |
| `booking -> session/student/membership`  | `bookings` owns reservation status; `sessions`, `students`, and `memberships` remain authoritative for eligibility inputs.                                                                                                                                                 | Booking/scheduling module writes bookings in a transaction after verifying all references and eligibility.                                 | Scheduling, roster, attendance, membership, notifications, and reporting may read scoped booking data.                                                          | Cancellation/status changes are explicit and auditable. A retry reuses the deterministic ID and does not create a second booking.                                                                                                                             |
| `waitlist -> session/student/membership` | `waitlistEntries` owns recoverable queue intent, offer state, and historical position; sessions, students, memberships, plans, finance, and confirmed bookings remain authoritative eligibility inputs. The three scheduling lock collections only serialize transactions. | Waitlist/scheduling backend writes in a transaction after tenant, capacity, membership, plan, quota, student-family, and financial checks. | Authorized student/family callables receive a minimized self projection; staff callables receive a bounded operational projection.                              | Issue and response replay are idempotent without extending TTL. Accept creates/restores the deterministic booking atomically; decline is terminal; expiry is materialized on demand; historical positions are not renumbered.                                 |
| `attendance -> session/student`          | `attendance` owns the canonical attendance state and correction link.                                                                                                                                                                                                      | Attendance module writes the canonical record and backend-generated correction records in the same collection.                             | Attendance, dashboards, family views, reporting, and authorized coaches read scoped records.                                                                    | The deterministic ID belongs only to the canonical record; `correctionOf` points to it from an opaque correction ID. Preserve the original, append the correction, and write an audit event. Never treat RTDB presence as an attendance correction or source. |
| `checkout -> session/student/adult`      | `checkouts` owns the canonical release state and adult/staff evidence.                                                                                                                                                                                                     | Check-out/attendance module writes through a transaction after actor and authorization verification.                                       | Reception, authorized staff, family self-service, safeguarding, and reporting read scoped data.                                                                 | Maintain one active checkout per student/session; status corrections are auditable and do not erase delivery evidence.                                                                                                                                        |
| `payment -> invoice/membership`          | `invoices` owns invoice totals/due state, `payments` owns payment records, and `memberships` owns membership state.                                                                                                                                                        | Billing/payment module writes financial records; payment integration adds verified provider events.                                        | Billing, membership, owner/finance reporting, and authorized family views read minimum fields.                                                                  | Provider events are reconciled idempotently; no payment event silently rewrites financial history or membership state.                                                                                                                                        |

### T062 derived relationship

`students`, current `memberships`, and canonical `attendance` remain the
authoritative records for retention evaluation. The internal producer joins
them only after matching `academyId` and exact student references. Only
attendance without a correction parent and occurring on or after the current
membership start contributes to the derived state; corrections, excused events,
and future events do not. `retentionAlerts` is a
reconstructable inbox projection, while its matching `auditEvents` record is
append-only evidence of the bounded run. Neither the projection nor
`studentReference` becomes a new identity, membership, or attendance source of
truth.

## Consistency and integrity rules

- The path and field `academyId` of every document must match.
- Every cross-document reference must belong to the same academy.
- T062 validates the tenant and exact student identity across the membership,
  student, schema-v1 canonical attendance identity, derived alert, and audit
  target before writing.
- A T062 run derives alerts only from current `trial`/`active` memberships,
  active students, and canonical eligible attendance within its bounded policy.
- T062 creates missing alerts and the deterministic audit event atomically.
  Exact replay is a no-op; incomplete, altered, or cross-tenant replay fails
  closed without partial writes.
- A booking is eligible only after backend verification of the student, family relationship, active membership, program, and session.
- A booking uses the canonical injective v2 identity with explicit legacy compatibility reads; canonical attendance remains unique by `{sessionId}__{studentId}`. Retries are idempotent and divergent dual booking records fail closed.
- An attendance correction preserves the original record and writes an audit event.
- A checkout requires a valid staff or authorized-adult actor and one active checkout per student/session.
- Payment provider events are verified and idempotent; they do not silently rewrite financial history.
- Belts and stripes are never granted automatically by a stored assessment or progress document.
- Server timestamps, actor IDs, roles, permissions, financial states, and approval states are backend-owned.
- A client cannot use an arbitrary ID, `academyId`, status, amount, recipient, or reference to widen its authority.
- Normal interactive deletion cannot remove financial, membership, attendance, assessment, consent, safeguarding, or audit history. The eventual retention/deletion policy belongs to `T011`.

## Deterministic IDs and idempotency

The shared identities and T092 coordination IDs mandated directly by this
contract are listed below. Task-owned modules may define additional
deterministic IDs in their own approved sections, such as T062 retention,
notification preferences, catalogue plans and administrative locks.

| Record                      | Document ID                                                              | Purpose                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Booking                     | `v2:{sessionId.length}:{sessionId}:{studentId.length}:{studentId}`       | Enforces one injective booking identity per student and session; compatibility reads also probe legacy `{sessionId}__{studentId}`. |
| Waitlist entry              | `v2:{sessionId.length}:{sessionId}:{studentId.length}:{studentId}`       | Enforces one injective queue identity per student and session with the same explicit legacy-read compatibility rule.               |
| Canonical attendance        | `{sessionId}__{studentId}`                                               | Enforces one canonical attendance identity per student and session; T060 does not migrate attendance identity.                     |
| Family relationship         | `{familyId}--{studentId}`                                                | Enforces one T022 relationship record for a family/student pair; authorization still validates every same-tenant reference.        |
| Student admin profile       | `{studentId}`                                                            | Keeps the Restricted administrative extension one-to-one with the canonical participant.                                           |
| Current student progress    | `{studentId}`                                                            | Keeps one reconstructable reviewed progress head; absence means uninitialized.                                                     |
| Student identity key        | `{kind}:{digest}`                                                        | Reserves one HMAC blind index for an approved identifier kind without exposing the raw identifier.                                 |
| Restricted-read limit       | `{actorId}`                                                              | Serializes one backend-only rolling exact-lookup/sensitive-detail quota for an authenticated academy actor.                        |
| Restricted-read limit audit | `restricted-read-limit-v1:{actorId.length}:{actorId}:{windowStartEpoch}` | Coalesces all over-limit rejects for one server-derived five-minute actor window into one create-only audit event.                 |
| Member-directory state      | `current`                                                                | Serializes reader/directory-write mode, freeze lease and verified identity-key coverage for one academy.                           |
| Member-directory operation  | `{operationId}`                                                          | Stores a server-issued, receipt-bound bootstrap/forward/rollback/recovery operation identity.                                      |
| Member-directory chunk      | `{operationId}:{phase}:{chunkNo}`                                        | Separates phases and makes each ordered bounded chunk create-only and exactly replayable under the same plan.                      |
| Approval consumption        | `{approvalId}`                                                           | Makes one approved operation transition consumable exactly once; its create shares the transition transaction.                     |
| Restore-guard head          | top-level `{academyId}`                                                  | Keeps one non-restorable project/academy high-water outside tenant backup.                                                         |
| Restore-guard event         | `{stateRevision}` under the guard head                                   | Creates one HMAC-chained immutable event for every directory state revision.                                                       |

Member-directory approval IDs and all target/audit IDs not explicitly listed
as deterministic are backend-generated opaque values. A reviewer/client cannot
select an approval ID, actor, tenant, expiry or binding.

Attendance corrections remain in the `attendance` collection with
backend-generated opaque IDs. Their `correctionOf` points to the canonical
attendance document identified by `{sessionId}__{studentId}`; a correction does
not reuse that deterministic ID, replace the original, or become a second
canonical attendance record. It preserves the original history and writes an
`auditEvents` record.

T062 publishes two additional deterministic identities under the owning
academy path:

- Retention alert:
  `retention-v2__{academyId.length}_{academyId}__{kind.length}_{kind}__{studentId.length}_{studentId}__{runDate}`.
- Production audit event:
  `retention-production-v1__{academyId.length}_{academyId}__{runDate}`.

The corresponding alert deduplication key is
`v2:{kind.length}:{kind}:{studentId.length}:{studentId}:{runDate}`. Segment
lengths use the validated normalized values, and `runDate` is the canonical UTC
calendar date. The IDs and key make an exact same-day run replayable; they do
not authorize input or permit a divergent overwrite.

Lengths in v2 identifiers are calculated after trimming each segment. New writes use
the canonical v2 candidate. A compatibility read probes canonical first and legacy
second and fails closed if both records exist with divergent payloads.

For collections not covered here or in an owning-module section, IDs are
backend-generated opaque IDs. `providerEventId`, `deliveryEventId`, and
`idempotencyKey` provide integration idempotency but do not authorize a
client-chosen document ID. A deterministic ID must never contain raw personal
data, a reversible encoding, an unkeyed hash of personal data, secret material,
or a value marked `Pending approval`. The sole personal-identifier derivation
approved here is the T092 HMAC blind index: it uses a backend-only secret and a
normalized Restricted value, while neither the value nor the secret is stored
in the path or reservation body.

## Query contracts and index ownership

The following seventeen query contracts are the only compound-index ownership
claims in this model. Firestore single-field indexes remain available by
default. A new compound index requires a real owning module and a test or
query contract before it is added to `firestore.indexes.json`.

T062 adds no compound-index ownership claim. Its bounded source reads use the
single-field membership `status` index, direct student document reads, and an
attendance range ordered by that same `occurredAt` field. Its inbox read orders
only by `createdAt`. Consequently, T062 adds no entry to
`firestore.indexes.json`.

T092 adds no compound-index claim. An admin profile is fetched by exact
`studentId`; uniqueness/exact lookup uses the HMAC-derived
`studentIdentityKeys` document ID; migration/chunk receipts are fetched from an
exact bounded manifest. General scanning by ID-card, VAT, legacy ID or other
Restricted value is prohibited. T093 must add and test the explicit
single-field exemptions listed in the T092 identity section before cutover,
including `memberDirectoryCursorStates.afterLegacyDocumentId`.

| Collection      | Filters/order                                           | Owning module          | Index entry                                |
| --------------- | ------------------------------------------------------- | ---------------------- | ------------------------------------------ |
| `sessions`      | `status == ? ORDER BY startAt ASC`                      | Scheduling             | `status ASC, startAt ASC`                  |
| `sessions`      | `locationId == ? ORDER BY startAt ASC`                  | Scheduling             | `locationId ASC, startAt ASC`              |
| `sessions`      | `programId == ? ORDER BY startAt ASC`                   | Scheduling             | `programId ASC, startAt ASC`               |
| `bookings`      | `sessionId == ? AND status == ? ORDER BY createdAt ASC` | Scheduling/booking     | `sessionId ASC, status ASC, createdAt ASC` |
| `bookings`      | `studentId == ? ORDER BY createdAt DESC`                | Scheduling/booking     | `studentId ASC, createdAt DESC`            |
| `attendance`    | `studentId == ? ORDER BY occurredAt DESC`               | Attendance             | `studentId ASC, occurredAt DESC`           |
| `attendance`    | `sessionId == ? AND state == ?`                         | Attendance             | `sessionId ASC, state ASC`                 |
| `memberships`   | `studentId == ? AND status == ?`                        | Commercial/membership  | `studentId ASC, status ASC`                |
| `memberships`   | `status == ? ORDER BY nextBillingAt ASC`                | Commercial/membership  | `status ASC, nextBillingAt ASC`            |
| `invoices`      | `familyId == ? AND status == ? ORDER BY dueAt ASC`      | Commercial/billing     | `familyId ASC, status ASC, dueAt ASC`      |
| `payments`      | `familyId == ? ORDER BY occurredAt DESC`                | Commercial/billing     | `familyId ASC, occurredAt DESC`            |
| `leads`         | `status == ? ORDER BY nextActionAt ASC`                 | CRM                    | `status ASC, nextActionAt ASC`             |
| `leads`         | `ownerId == ? ORDER BY nextActionAt ASC`                | CRM                    | `ownerId ASC, nextActionAt ASC`            |
| `messages`      | `audienceId == ? ORDER BY sentAt DESC`                  | Communication          | `audienceId ASC, sentAt DESC`              |
| `auditEvents`   | `targetRef == ? ORDER BY occurredAt DESC`               | Audit/governance       | `targetRef ASC, occurredAt DESC`           |
| `auditEvents`   | `actorId == ? ORDER BY occurredAt DESC`                 | Audit/governance       | `actorId ASC, occurredAt DESC`             |
| `relationships` | `adultUserId == ? AND status == ?`                      | Family/identity (T022) | `adultUserId ASC, status ASC`              |

The T022 relationship index is additive and supports resolving active guardian
relationships. Query tests verify tenant scoping,
authorization, pagination/limits, and that a `Restricted` collection is never
silently substituted for a general list query.

The `payments` and `messages` query rows above must use the safe projections in
the projection rules. A query that needs provider evidence, sensitive payment
correction/reconciliation history, message content, expanded recipients, or
minor/guardian delivery details must use a separate authorized query. The
compound index supports filtering and ordering only; it never grants access or
widens the projection.

## Restrictions for restricted data

- `students`, `studentAdminProfiles`, `studentIdentityKeys`, `studentRestrictedReadLimits`, `medicalLeaves`,
  `checkouts`, `healthProfiles`, `safeguardingCases`, `consents`, `documents`,
  `auditEvents`, `exports`, minor progress/promotion records, and verified
  payment evidence are not general student/family directory data.
- `memberDirectoryStates`, migrations, chunks, approvals, consumptions,
  `memberDirectoryWriteReceipts`, `profileWriteReceipts` and
  restore guards/events/attestations/attestation consumptions are backend-only coordination. They contain metadata
  only; `memberDirectoryCursorStates` alone holds one Restricted legacy
  continuation ID, never returned to the client. None is exposed in Members UI.
- Firestore Rules deny direct get/list/create/update/delete for
  `studentAdminProfiles`, `studentIdentityKeys`, `studentRestrictedReadLimits`,
  `memberDirectoryCursorStates`, `memberDirectoryStates`,
  `memberDirectoryMigrations`, `memberDirectoryMigrationChunks`,
  `memberDirectoryApprovals`, `memberDirectoryApprovalConsumptions`,
  `memberDirectoryWriteReceipts`, `profileWriteReceipts`, legacy
  `members` and top-level restore guard heads/events, restore attestations and
  restore-attestation consumptions to unauthenticated,
  adultStudent, guardian, coach, headCoach, administrator and owner clients.
  Authorized behavior is callable/backend projection only; a role never grants
  a direct collection exception.
- ID card, VAT, legacy member and unmasked membership numbers are excluded from
  every general list/report/export. Exact administrative lookup is separately
  authorized, purpose-bound, rate-limited and audited without echoing the key.
- `retentionAlerts` is likewise restricted derived data. Its T062
  `studentReference` currently contains the opaque internal `studentId`; it is
  not a public or pseudonymized identifier and must be pseudonymized before the
  feature is enabled in production against real student data.
- Health data is limited to `minimumOperationalSupport`, review state, expiry,
  and the minimum additional fields later approved by `T011`; no full medical
  or diagnostic narrative is stored in the application contract.
- Safeguarding data keeps intake, participants, actions, and resolution under
  separate authorization scopes; no full safeguarding narrative is copied to
  a profile, message, log, query result, or export.
- Consent evidence is versioned and references private document metadata; it
  is not overwritten destructively.
- `documents` stores metadata and permissions only. Object blobs remain in
  private R2 and are delivered through short-lived, backend-authorized signed
  URLs with fixed object and method scope.
- `auditEvents`, `paymentEvents`, and provider delivery evidence are
  append-only, minimal, and free of secrets or complete provider payloads.
- No collection stores full card credentials, CVV/CVC, passwords, MFA secrets,
  R2 credentials, service-account keys, webhook secrets, or provider secrets.
- Restricted values are excluded from general list queries, caches, logs,
  analytics, fixtures, screenshots, and exports unless a separately authorized
  workflow explicitly requires them.
- Export records preserve purpose, scope, classification, recipient, expiry,
  status, and audit correlation. An export is not a new canonical source.

## Levels catalog (T083/T101)

`levelSystems`, `levelDefinitions`, `levelRequirements`, and
`levelCatalogManifests` are `Internal` reference collections at:

- `academies/{academyId}/levelSystems/{systemId}`: Published system summary, metadata, precedence, source hash, and embedded skill catalog (11 skills).
- `academies/{academyId}/levelDefinitions/{definitionKey}`: 171 immutable definitions (27 belts, 144 stripes) with merged DOCX criteria, observed criteria, visuals, and anomaly flags.
- `academies/{academyId}/levelRequirements/{requirementKey}`: 165 technique requirements linked to definition keys and skills.
- `academies/{academyId}/levelCatalogManifests/{systemId}`: immutable publication manifest
  binding the exact system, 171 definition IDs, 165 requirement IDs, aggregate catalog hash,
  publication operation/audit IDs, and both approved canonical JSON hashes:
  `1118e362ad02db54a8da1117e19a77f1bd05598aa770e53ca502bd18b8da6794`
  (observed source) and
  `209a46d2c9e13404601248ec7cfd82868058e567d91bb95946676d4f5fe0d98d`
  (business criteria).

The non-production seed (`apps/functions/scripts/seed-levels.mjs`) is the only writer. It resolves the two approved source files relative to the compiled module (never the working directory), verifies both approved hashes before touching Firestore, and loads `firebase-admin` from the deploy artifact dependency tree so the transactional audit sentinel serializes correctly (T101). Its preflight requires explicit target and academy, exact agreement among every discovered Firebase project ID, and the exact Emulator project/host pair. The production project is deny-listed and staging remains closed until T099 supplies an operator-approved positive allowlist. Direct client reads and writes are denied by default. The callable `listLevelCatalog` provides authenticated read access.

Publication uses one Firestore transaction with 339 writes: the 337 catalog documents
(1 system + 171 definitions + 165 requirements), one manifest, and one standard
`auditEvents` record. This remains below Firestore's 500-write transaction limit. A replay may
return `idempotent: true` only after verifying the complete stored system, both complete child
sets, the exact manifest hashes/counts, and the original publication audit record.

Rollback is limited to `ibjjf-v1`, loads the same approved sources, and uses a distinct staging
confirmation. In one transaction it verifies the manifest/catalog/publication audit, scans the
canonical reference collections, rejects any active system or definition reference, deletes the
337 catalog documents plus the manifest, and appends `level.catalog.rolled_back` to
`auditEvents`. Production and remote staging remain unauthorized.

## Technical library and lesson plans (T066)

T066 adds only additive, tenant-scoped collections under
academies/{academyId}. Libraries are versioned internal reference data; lesson
plans are operational records that must reference one exact library version.
No collection is public or client-writable in this slice.

| Collection         | Required fields                                                                                                       | Classification | Write authority                                | Read authority           | History/rollback                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| techniqueLibraries | academyId, libraryId, version, status, publishedAt, techniques, schemaVersion                                         | Internal       | Internal lesson-planning service               | No direct Firestore read | Immutable version key libraryId__version; divergent replay fails      |
| lessonPlans        | academyId, planId, title, libraryId, libraryVersion, status, activities, approvedByStaffId, approvedAt, schemaVersion | Internal       | Internal service; approval requires head_coach | No direct Firestore read | Idempotent by academy + plan ID; approved transition is transactional |

The store validates every library and plan against the domain contract before
writing. A plan cannot reference an unknown or inactive technique, and approval
cannot be repeated or performed with a non-head-coach role. The Firestore paths
are academies/{academyId}/techniqueLibraries/{libraryId}__{version} and
academies/{academyId}/lessonPlans/{planId}; the academy is taken from the
trusted backend call, never from a client override.

Rollback for this additive slice is to stop the internal service and remove
only T066 documents from an Emulator or approved test tenant. No production
migration or destructive delete is authorized by T066; any production
rollback requires a verified backup and explicit operator confirmation.
The local authenticated E2E, persisted approval audit event, and staff UI are
covered by T066. Definitive technique content, operational copy, and product
approval remain outside this slice.

## Family achievement catalog and snapshots (T067)

T067 adds only additive, tenant-scoped collections under
`academies/{academyId}`. The catalog is an internal source of definitions; the
snapshot is a derived, read-only projection. No collection is public or
client-writable.

| Collection                   | Required fields                                                                                                                         | Classification                                             | Write authority                                | Read authority                                                          | History/rollback                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `familyGoals`                | `academyId`, `goalId`, `label`, `metric`, `target`, `schemaVersion`                                                                     | Internal                                                   | Internal catalog seed only; no public callable | No direct Firestore read                                                | Idempotent by academy + goal ID; divergent replay fails                                 |
| `familyAchievements`         | `academyId`, `achievementId`, `label`, `metric`, `target`, `schemaVersion`                                                              | Internal                                                   | Internal catalog seed only; no public callable | No direct Firestore read                                                | Idempotent by academy + achievement ID; divergent replay fails                          |
| `familyAchievementSnapshots` | `academyId`, `familyId`, `generatedAt`, `members`, `adultComparison`, `schemaVersion`                                                   | Restricted when minors are present; otherwise Confidential | Internal generator only                        | `getFamilyAchievementSummary` for `owner`, `administrator`, `headCoach` | Append-only generated snapshots; latest valid snapshot is read; replay is deterministic |
| `auditEvents`                | Common audit envelope plus `familyId`, `snapshotId`, `memberCount`, `candidateCount`, `generatedAt` for `family.achievements.generated` | Confidential                                               | Backend transaction only                       | No direct Firestore read                                                | Append-only; never rewritten or deleted by this slice                                   |

The embedded `familyAchievementSnapshots.members` field contains only active
family participants and allowlisted goal/achievement candidates; it is not the
legacy `members` collection. `adultComparison` contains only active adults with
explicit opt-in; minors never appear there. The snapshot does not grant an
award, belt, stripe, promotion, prize, or public ranking.

The callable validates the academy from authenticated custom claims and the
family identifier from the payload. It never accepts an academy override,
arbitrary query filters, or a write payload. Firestore Rules explicitly deny
direct reads and writes to all T067 collections, including `auditEvents`.
Current reads are bounded and do not require a compound index. A future query
or scheduler must add an index and an approved cost/performance review before
changing this contract.

Rollback for this additive slice is to disable the callable/internal generator
and remove only T067 documents from an Emulator or approved test tenant. No
production migration or destructive delete is authorized by T067; a production
rollback requires a verified backup and explicit operator confirmation.

## Backup and restoration boundary (T054)

Tenant backups are operation artifacts, not a new canonical collection. Backup schema v2 includes `waitlistEntries` and the three backend-only scheduling coordination states. The allowlist, manifest schema, checksum, retention placeholder, excluded secrets, and operator confirmation gate live in `apps/functions/src/data/backup-contracts.ts` and `apps/functions/src/data/restore-runbook.md`. A backup is tenant-scoped under `academies/{academyId}` and must preserve the path/field `academyId` invariant.

Backup schema v2 is not sufficient for a member-directory cutover: its direct-collection allowlist
does not include the legacy `members` rollback source, T092 identity extensions/coordination,
`studentLevelProgress`, `levelPromotions`, or direct `medicalLeaves`, and it cannot capture the
current nested Levels history. T093 must introduce and test backup schema v3 containing `members`,
`students`, `studentAdminProfiles`, `studentIdentityKeys`, `studentRestrictedReadLimits`,
`memberDirectoryStates`, `memberDirectoryMigrations`, `memberDirectoryMigrationChunks`,
`memberDirectoryApprovals`, `memberDirectoryApprovalConsumptions`,
`memberDirectoryWriteReceipts`, `profileWriteReceipts`, their audit evidence, direct
progress/promotions/medical leaves and the current nested Levels history. Ephemeral
`memberDirectoryCursorStates`, top-level restore guards/events, source-local restore attestations and
their consumptions are expressly excluded.

Only a consistent source snapshot captured from legacy/open/idle, canonical/open/idle or stable
rollback-readonly is rehearsal-eligible; active-operation snapshots are evidence-only. Its manifest
binds source project/academy, read time, state revision/global marker, reader/write/freeze/phase,
rollback protocol/count, source guard revision/marker/count/epoch/event MAC, code/schema versions,
every direct/nested count/root, identity baseline/artifact, private-manifest MAC and exact secret
versions. All encrypted artifacts reopen and verify. The current source guard must not exceed the
snapshot revision/count and a false snapshot cannot be replayed after its source guard recorded true.

T092/T093 restore only from local Emulator project `demo-bpt-jersey` into the separate local project
`demo-bpt-jersey-restore`, with the same academyId, Firestore at `127.0.0.1:8080` and Auth at
`127.0.0.1:9099`. The target
must contain zero Auth users, Firestore documents at any depth, control-plane state or application
workloads. Restore uses the exact two named Admin apps and explicit source/target role flags; ambient
project variables may be absent or source-only. Same project, remote host, nonempty target or a
default/extra/swapped/ambiguous app fails before artifact/domain reads. The target remains unreachable
by application runtimes throughout rehearsal.

Initial Firestore emptiness is proven by versioned
`firestore-namespace-inventory-v1`. At one Emulator readTime it recursively
paginates ListCollectionIds and ListDocuments(showMissing=true, pageSize=200)
from the database root, validates each parent-pattern/collection-ID pair and
queues missing document references to discover their children. Only the exact
`academies/{academyId}` structural anchor may be missing; other missing parents,
unknown/wrong-depth collections, another academy and malformed pagination fail.
Every expected target document belongs to exactly one disjoint plan set. `payload` contains all
materialized v3 artifact documents, including non-state historical coordination evidence but
excluding source-authority evidence such as `memberDirectoryStates/current`, and permits
at most 10,000 real documents and 256 MiB canonical decoded path+body bytes.
`target-control` contains only this rehearsal's current state, restore operation,
chunks, target approval consumptions, guard/events and audits, and permits at
most 2,048 real documents and 32 MiB. Combined hard caps are 12,048 real
documents, 288 MiB and 12,049 visited document paths, with the final path reserved
only for the missing academy anchor. Separate payload/control counts, bytes and
HMAC roots plus a combined root are retained; overlap or unclassified content
fails. Auth listUsers(1) and direct state/guard gets are independent checks. I0
requires empty; I1 accepts the exact atomically prepared controls; I2/I3 accept
the complete planned sets; I4 authenticates the terminal set for a source-local
attestation. A fresh no-import emulators:exec with singleProjectMode=false and
one target writer is mandatory.

The runner verifies source artifacts/handoffs with source-project secrets and MACs target receipts
with distinct target-project material; exact `(role, project, purpose, version)` bindings are
plan-bound. Restore approval use is a saga: a source transaction revalidates current source
owner/administrator Auth + App Check and consumes the approval into an immutable stage=source-handoff
receipt, bound to both projects, academy, target operation/revision/epoch/transition and a maximum
60-second handoff MAC. A target transaction verifies it, create-only writes a
stage=target-transition receipt and atomically applies the target transition. Crash resumes only the
same unexpired handoff; expiry or CAS drift requires a new source approval. Revocation before handoff
blocks; after handoff it is non-retroactive. Acquire, complete and restore post-deadline recovery all
use this pattern; no contract assumes a cross-project transaction.

Firebase Auth objects and authority remain excluded. The encrypted authority inventory is evidence
only. To preserve valid family/minor and historical references, the logical Firestore contents of
`students.userId`, auth-user-id reservations, users, staff, families and relationships are restored
unchanged as quarantined evidence rather than rewritten into partial inactive records. The operation,
handoffs, target completion state and target-transition consumption bind
authorityMode=quarantined-no-auth. Those references grant no
authority because target Auth remains empty, the project is unserved, application bootstrap rejects
the restore-only project ID and directory paths reject restore phases. listUsers(1) is rechecked before acquisition, each chunk transition,
verification and completion. Relinking, target-key derivation or activation requires a future
operation and full referential/Auth revalidation.

Restore does not reinstall source state, guard, lease or approval as authority. Preparation verifies
the source artifact/guard, backupManifestMac/sourceStateEvidenceMac, exact Emulator pair,
quarantined-no-auth plan and I0-empty target, then one
target Firestore transaction create-only writes state, guard head/revision-zero event, planned restore
parent binding the disposition version and both evidence MACs, and audit. The state is
canonical-v1/blocked/frozen/restore-prepared with
preparedOperationId, lastCommittedChunkNo=0 and no active operation/lease/deadline. A pre-commit crash
leaves I0; a post-commit crash leaves the complete I1 set. Exact retry returns I1 and any divergence
fails. Restore-acquire is consumed through source-handoff -> target-transition while target
epoch/revision advances beyond the snapshot, preparedOperationId is cleared, an active operation and
lease are issued, and the parent enters canonical-v1/blocked/frozen/restore-recovery. The operation
allows at most 10,000 payload documents and 256 MiB canonical decoded payload bytes plus only the
exact 2,048-document/32-MiB target-control headroom, with a 30-minute deadline. Each create-only target
transaction handles at most 40 planned payload documents,
2,500 reads, 8 MiB decoded, 100 writes and 15 server seconds. Existing planned paths or planned
count/root drift fails before that chunk writes; the recursive inventory checkpoints catch unrelated or
nested drift before verification/completion. First/zero-row transitions and applying-to-verified
remain separate.

Restore-complete uses a fresh source handoff, binds target revision/epoch/logical roots and enters only
canonical-v1/blocked/frozen/restore-rehearsal-complete with no active operation/lease/deadline and
lastCommittedChunkNo=0. Application bootstrap and the directory parser reject it: completion proves isolated
reconstruction, not tenant activation. After completion the runner executes I4, MACs the exact target
inventory and submits only bounded evidence to an allowlisted source workload. A source transaction
reopens the matching completion handoff and create-only writes
`memberDirectoryRestoreAttestations/{attestationId}` under a deterministic opaque HMAC ID derived
from stable completion identity, backupManifestMac and sourceStateEvidenceMac. The attestation binds
both projects, academy, target operation/revision/epoch, authority mode, inventory version,
attestedReadTime, payload/control/combined counts, bytes and roots,
approval/handoff/target-consumption MACs, attestedTargetInventoryMac and sourceAttestationMac. Exact
retry validates the existing source document, then scans at a new verificationReadTime and computes
verificationTargetInventoryMac. The read time/MAC may differ, but all stable bindings, terminal
state/parent/consumption, counts/bytes/roots and manifest/state MACs must match. T097 binds both
attested and verification proofs before planning and atomically create-only writes
`memberDirectoryRestoreAttestationConsumptions/{attestationId}` with its marker/guard/event; reuse by
another operation fails. In-place overwrite or promotion requires a later ADR with a
tenant-wide domain-write fence or versioned namespace cutover and a non-restorable Auth/claims
revision shared by all provisioning/revocation paths, plus T011 and a new checkpoint. T097 must
remove/migrate nested paths. No remote restore, serving cutover or real-data claim is authorized.

Both target inventory MACs use the same domain-separated target HMAC schema over inventory version,
target project/academy/operation/revision/epoch, authority mode, their own read time, terminal
state/parent/consumption MACs and all payload/control/combined counts, bytes and roots.
sourceAttestationMac covers every closed attestation field except itself. An expired completion
handoff may support evidence only when its target transition proves consumption before expiry; it
cannot authorize another transition.

The backup scope excludes restorable Firebase Auth objects, RTDB `presence`, service credentials, tokens, passwords/MFA data, card data, and raw private object contents. The encrypted authority inventory described above is verification evidence only and cannot provision Auth or widen access. Waitlist records and locks remain excluded from aggregate user/report exports. The isolated reconstruction validates `waitlistPositionStates.lastPosition >= max(waitlistEntries.position)` for every session; a smaller value fails closed, while a larger value only preserves safe gaps. Backup and restore callables are owner/administrator-only, require App Check, reject arbitrary collection paths, and remain fail-closed until an approved private artifact store and production retention policy exist. The Emulator rehearsal writes create-only into the separate empty target project, verifies a synthetic failure leaves that target non-serving, and never rolls back or overwrites the source. No production backup, restore, migration, activation or deployment is implied by this contract.

## Versioning, migration, and rollback boundary

T066 and T067 are additive and have been implemented only through tenant-scoped
non-production stores, Rules, tests, protected callables, UI and local E2E. They do not
migrate existing data, add production indexes, or deploy resources.

Before a future production rollout uses this contract, its owner must document
the exact version and scope, an idempotent `up`, a tested `down` or compensating
procedure, dry-run results against synthetic emulator fixtures, and the
invariants and query checks at each checkpoint. A migration affecting existing
data requires a verified backup and restore test before production; destructive
operations require explicit operator confirmation. If a rollout fails, the
operator stops it, preserves evidence, and uses the documented rollback rather
than deleting documents manually from a console.

## Implementation ownership and review boundaries

| Concern                                                                         | Contract owner  | Not decided here                                                              |
| ------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| Collection fields, references, source of truth, and index claims                | T013 data model | Concrete TypeScript schemas, fixtures, and emulator tests                     |
| Authentication, roles, claims, and tenant/family/assignment Rules               | T014-T016       | Final claims, custom claims lifecycle, and Rules implementation               |
| Program, schedule, capacity, pricing, membership eligibility, and session rules | `T008`          | Every operational value and status transition still marked `Pending approval` |
| Assessment dimensions and recognition approval                                  | `T009`          | Final weights, thresholds, and reviewer policy                                |
| Payment provider, checkout, refunds, webhook evidence, and reconciliation       | `T010`          | Provider-specific fields, signatures, costs, and residency                    |
| Retention, residency, deletion, restoration, and restricted access policy       | `T011`          | Legal/operational deadlines and final deletion mechanisms                     |
| Rules and executable authorization                                              | `T016`          | Production access behavior until Rules and negative tests exist               |

Implementers must use this document as the collection and source-of-truth
contract, while keeping all pending decisions visible and configurable. No
`(f)` value or `Pending approval` decision is a productive invariant.
