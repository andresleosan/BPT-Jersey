# Firestore Data Model Contract

## Path and identity conventions

- Firestore root: `academies/{academyId}`.
- Direct subcollections: `users`, `families`, `students`, `staff`, `relationships`, `locations`, `programs`, `classes`, `sessions`, `plans`, `bookings`, `waitlistEntries`, `sessionCapacityStates`, `bookingQuotaStates`, `waitlistPositionStates`, `attendance`, `checkouts`, `memberships`, `invoices`, `payments`, `paymentEvents`, `assessments`, `skillProgress`, `recognitions`, `leads`, `messages`, `deliveryEvents`, `healthProfiles`, `safeguardingCases`, `waiverVersions`, `consents`, `documents`, `auditEvents`, `exports`, `exportRateLimits`, and `regyfitAccessRecords`.
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

| Group                   | Collections                                                                              | Ownership boundary                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Academy                 | `locations`, `programs`, `classes`, `sessions`, `plans`                                  | Academy configuration, catalogue, scheduling templates, session instances, and membership plans. Pending operational values remain configurable.                                            |
| Identity                | `users`, `families`, `students`, `staff`, `relationships`                                | Adult identity, family records, protected minor profiles, staff assignments, and explicit tutor relationships. Relationships are documents, not unbounded embedded arrays.                  |
| Scheduling              | `bookings`, `waitlistEntries`                                                            | Reservation, roster, and recoverable waitlist intent. They reference, but do not duplicate, the session, student, or membership as sources of truth.                                        |
| Scheduling coordination | `sessionCapacityStates`, `bookingQuotaStates`, `waitlistPositionStates`                  | Backend-only revision and monotonic-position locks. They serialize transactions but never replace sessions, bookings, memberships, plans, finance, or waitlist entries as sources of truth. |
| Attendance              | `attendance`, `checkouts`                                                                | Canonical attendance, corrections, and child check-out state. Presence in RTDB is not part of this aggregate.                                                                               |
| Commercial              | `memberships`, `invoices`, `payments`, `paymentEvents`                                   | Membership lifecycle, invoices, administrative payments, and minimal verified provider events. Card data is outside the platform.                                                           |
| Development             | `assessments`, `skillProgress`, `recognitions`                                           | Evidence-based assessment, skill progress, and human-reviewed recognition. No automatic belt or stripe grant.                                                                               |
| CRM and communication   | `leads`, `messages`, `deliveryEvents`                                                    | Prospects, audiences, messages, and delivery history. Communication involving a minor remains visible to the tutor.                                                                         |
| Restricted governance   | `healthProfiles`, `safeguardingCases`, `consents`, `documents`, `auditEvents`, `exports` | Minimum operational restricted data, versioned evidence, private object metadata, append-only audit, and controlled exports. These collections are not general student/family directories.  |

## Identity and relationship contracts

| Collection      | Required fields                                                                                                                                                                                                                                               | References                                                                                                                                                                               | Classification                                                        | Write authority                                                                                                             | Deletion/history rule                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`         | `userId`, `academyId`, `accountType`, `displayName`, `email`, `phoneNumber`, `active`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `status`                                                                                          | `userId` maps to the adult Firebase Auth identity. No minor account is implied.                                                                                                          | `Confidential`                                                        | Identity/account backend; profile changes use an authorized command. Auth provider state is not client-controlled.          | Deactivation/revocation and status history; no normal hard delete of an identity referenced by history. Final retention/deletion is `T011`.                                                                                       |
| `families`      | `familyId`, `academyId`, `primaryContactUserId`, `billingContactUserId`, `active`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`                                                                                              | `primaryContactUserId` and `billingContactUserId` are the same existing active client `users` record in the same academy.                                                                | `Confidential`; a minor relationship is `Restricted` in exports/logs. | T022 family backend; only `owner`/`administrator` commands write. Guardian reads a redacted projection through `getFamily`. | Deactivation preserves family, students, relationships, and envelope history; no hard delete.                                                                                                                                     |
| `students`      | `studentId`, `academyId`, `familyId` (T022 minor), `fullName`, `dateOfBirth`, `phoneNumber`, `email`, `trainingCenter`, `trainingTimePreferences`, `participantType`, `active`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `status` | `userId` optionally references the adult Firebase Auth identity; T022 minors have no `userId`, and `familyId` references one same-academy family.                                        | `Restricted`                                                          | Identity backend; T022 derives `minor` and checks the current `relationships` record for guardian access.                   | Deactivation or approved retention workflow; no normal hard delete when referenced by attendance, progress, consent, or safeguarding history.                                                                                     |
| `staff`         | `staffId`, `academyId`, `userId`, `roleAssignments`, `active`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `status`                                                                                                                  | `userId` references `users`; `roleAssignments` may reference approved programs, classes, or locations.                                                                                   | `Confidential`                                                        | Staff/identity backend; role and assignment changes require an authorized backend actor.                                    | Deactivation revokes interactive access and effective assignments; preserve historical authorship and audit.                                                                                                                      |
| `relationships` | `relationshipId`, `academyId`, `familyId`, `studentId`, `adultUserId`, `relationshipType`, `permissions`, `validFrom`, optional `validTo`, `active`, `status`, `schemaVersion`, timestamps and actors                                                         | `familyId` -> `families`, `studentId` -> `students`, `adultUserId` -> `users`; all references must share `academyId`. `relationshipId` is the deterministic `familyId + studentId` pair. | `Confidential`; the tutor-minor link is `Restricted` in exports/logs. | T022 family backend; only `owner`/`administrator` commands write. `guardian` only reads its resolved family projection.     | Validity, tutor replacement, and `active/status` changes preserve history; no embedded arrays and no delete. Permissions is fixed to `readProfile` in T022 and grants no health, waiver, payment, attendance, or progress access. |

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
the update path preserves `createdAt` and `createdBy`. The registration is additive only; no existing
`members` records are migrated or reconciled.

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

| Collection       | Required fields                                                                                                                                                                    | References                                                                                                                                                                                                                                                            | Classification                                                                                          | Write authority                                                                                            | Deletion/history rule                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assessments`    | `assessmentId`, `academyId`, `studentId`, `coachStaffId`, `sessionId`, `dimensions`, `observedAt`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`   | `studentId` -> `students`, `coachStaffId` -> `staff`, `sessionId` -> `sessions`; dimensions are owned by `T009`.                                                                                                                                                      | `Confidential`                                                                                          | Development/assessment backend; assigned coach or authorized head coach workflow.                          | Preserve the original assessment and correction author/moment; no normal hard delete. `T009` owns final review and weighting rules.                                                                                   |
| `skillProgress`  | `progressId`, `academyId`, `studentId`, `skillKey`, `level`, `evidence`, `reviewedBy`, `reviewedAt`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy` | `studentId` -> `students`, `reviewedBy` -> `staff`; `skillKey` is a module-owned identifier, not an arbitrary public label.                                                                                                                                           | `Confidential`                                                                                          | Development backend; review is performed by authorized staff.                                              | Preserve evidence and review history; corrections update status or append history with audit. It never grants a belt or stripe automatically.                                                                         |
| `recognitions`   | `recognitionId`, `academyId`, `studentId`, `category`, `proposedBy`, `approvedBy`, `approvedAt`, `status`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`     | `studentId` -> `students`, `proposedBy` and `approvedBy` -> `staff`; approval must be a human head coach decision.                                                                                                                                                    | `Confidential`                                                                                          | Development backend; proposal and approval are separate authorized actions.                                | Preserve proposal, approval, rejection, and correction history; no automatic grant and no public child leaderboard.                                                                                                   |
| `leads`          | `leadId`, `academyId`, `contactReference`, `source`, `ownerId`, `status`, `nextActionAt`, `consentState`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`      | `contactReference` may point to an adult/family record when linked; `ownerId` references an authorized `users` or `staff` identity.                                                                                                                                   | `Confidential`                                                                                          | CRM backend and assigned owner workflow; consent state is backend-validated.                               | Preserve status and activity history; deactivate or redact only through the future `T011` policy, not a casual delete.                                                                                                |
| `messages`       | `messageId`, `academyId`, `audienceId`, `channel`, `templateKey`, `sentAt`, `createdBy`, `status`, `schemaVersion`, `createdAt`, `updatedAt`, `updatedBy`                          | `audienceId` is a backend identifier for an evaluated audience, not a collection or path. It is evaluated from canonical `relationships`, `families`, `students`, `sessions`, and `programs`/`classes` as applicable; the message stores only this minimal reference. | `Confidential`; communication involving a minor is `Restricted`.                                        | Communication backend and authorized sender workflow; clients cannot create a private minor-coach channel. | Preserve sent message status and delivery linkage. Audience membership is recomputed/validated and is never authorized from `audienceId` alone; restricted content or recipients require a separate authorized query. |
| `deliveryEvents` | `deliveryEventId`, `academyId`, `messageId`, `provider`, `providerEventId`, `status`, `occurredAt`, `idempotencyKey`, `schemaVersion`                                              | `messageId` -> `messages`; provider identifiers are minimal opaque evidence.                                                                                                                                                                                          | `Confidential`; classification inherits `Restricted` when the source audience or payload is restricted. | Communication integration backend after provider verification and idempotency checks.                      | Append-only delivery history; retries do not duplicate events and interactive users cannot rewrite provider evidence.                                                                                                 |

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
cleanup. Rollback leaves the DI-only producer uncomposed and removes/disables
the callable/UI; any derived documents remain inert. Production retention or
deletion requires T011 and explicit operator approval.

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

The only deterministic document IDs mandated by this contract are:

| Record               | Document ID                                                        | Purpose                                                                                                                            |
| -------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Booking              | `v2:{sessionId.length}:{sessionId}:{studentId.length}:{studentId}` | Enforces one injective booking identity per student and session; compatibility reads also probe legacy `{sessionId}__{studentId}`. |
| Waitlist entry       | `v2:{sessionId.length}:{sessionId}:{studentId.length}:{studentId}` | Enforces one injective queue identity per student and session with the same explicit legacy-read compatibility rule.               |
| Canonical attendance | `{sessionId}__{studentId}`                                         | Enforces one canonical attendance identity per student and session; T060 does not migrate attendance identity.                     |

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

For all other collections, IDs are backend-generated opaque IDs unless an
owning module publishes an additional approved contract. `providerEventId`,
`deliveryEventId`, and `idempotencyKey` provide integration idempotency but do
not authorize a client-chosen document ID. A deterministic ID must never be
derived from raw personal data, a secret, or a value marked `Pending approval`.

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

- `students`, `checkouts`, `healthProfiles`, `safeguardingCases`, `consents`,
  `documents`, `auditEvents`, `exports`, and verified payment evidence are not
  general student/family directory data.
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

## Levels catalog (T083)

`levelSystems`, `levelDefinitions`, and `levelRequirements` are `Internal` reference collections at:

- `academies/{academyId}/levelSystems/{systemId}`: Published system summary, metadata, precedence, source hash, and embedded skill catalog (11 skills).
- `academies/{academyId}/levelDefinitions/{definitionKey}`: 171 immutable definitions (27 belts, 144 stripes) with merged DOCX criteria, observed criteria, visuals, and anomaly flags.
- `academies/{academyId}/levelRequirements/{requirementKey}`: 165 technique requirements linked to definition keys and skills.

The non-production seed (`apps/functions/scripts/seed-levels.mjs`) is the only writer. Direct client reads and writes are denied by default. The callable `listLevelCatalog` provides authenticated read access. Rollback deletes all documents belonging to a selected `systemId` in non-production environments.

## Backup and restoration boundary (T054)

Tenant backups are operation artifacts, not a new canonical collection. Backup schema v2 includes `waitlistEntries` and the three backend-only scheduling coordination states. The allowlist, manifest schema, checksum, retention placeholder, excluded secrets, and operator confirmation gate live in `apps/functions/src/data/backup-contracts.ts` and `apps/functions/src/data/restore-runbook.md`. A backup is tenant-scoped under `academies/{academyId}` and must preserve the path/field `academyId` invariant.

The backup scope excludes Firebase Auth, RTDB `presence`, service credentials, tokens, card data, and raw private object contents. Waitlist records and locks remain excluded from aggregate user/report exports. Before enabling a restored tenant, validation requires `waitlistPositionStates.lastPosition >= max(waitlistEntries.position)` for every session; a smaller value fails closed, while a larger value only preserves safe gaps. Backup and restore callables are owner/administrator-only, require App Check, reject arbitrary collection paths, and remain fail-closed until an approved private artifact store and production retention policy exist. The emulator rehearsal captures the current state, applies a verified artifact in an isolated namespace, and rolls back the previous state after a synthetic failure. No production backup, restore, migration, or deployment is implied by this contract.

## Versioning, migration, and rollback boundary

This task publishes a contract only. It does not create collections, add
indexes, apply Rules, migrate data, or deploy resources. The repository has no
approved production migration in this document.

Before a future migration uses this contract, its owner must document the
exact version and scope, an idempotent `up`, a tested `down` or compensating
procedure, dry-run results against synthetic emulator fixtures, and the
invariants and query checks at each checkpoint. A migration affecting existing
data requires a verified backup and restore test before production; destructive
operations require explicit operator confirmation. If a migration fails, the
operator stops the rollout, preserves evidence, and uses the documented
rollback rather than deleting documents manually from a console.

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
