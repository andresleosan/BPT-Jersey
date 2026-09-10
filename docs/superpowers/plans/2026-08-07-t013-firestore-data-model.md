# T013 Firestore and RTDB Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Cronos executes this plan inline unless the operator chooses subagents; no commit is authorized.

**Goal:** Convert the approved T013 design into a durable Firestore/RTDB ADR, a field-level data contract, a migration and rollback runbook, query-backed Firestore indexes, and synthetic emulator fixtures without applying production changes.

**Architecture:** Firestore Standard remains the canonical multi-tenant store under `academies/{academyId}`. RTDB is limited to expiring presence at `academies/{academyId}/presence/{sessionId}/{studentId}` and cannot reconstruct canonical data. Documentation defines ownership, classification, references, invariants, and reversible operational procedures; the index file contains only the compound indexes owned by documented queries.

**Tech Stack:** Markdown, Firestore composite-index JSON, Firebase Emulator Suite, Vitest 4.1.10, TypeScript 6.0.3, Node.js 22-24, pnpm 11.20.0.

## Global Constraints

- Firestore Standard is the source of truth for identity, families, students, staff, scheduling, bookings, attendance, check-out, memberships, payments, progress, CRM, communications, files, consent, safeguarding, audit, reports, and exports.
- RTDB contains only temporary presence and operational session state at `academies/{academyId}/presence/{sessionId}/{studentId}`.
- Every Firestore document under an academy carries an `academyId` matching its path; cross-academy references are invalid.
- `healthProfiles`, `safeguardingCases`, `consents`, `documents`, `auditEvents`, and `exports` remain separate restricted collections with dedicated authorization boundaries.
- No raw card number, CVV/CVC, password, MFA secret, provider secret, R2 key, or complete payment-provider payload is stored.
- Values marked `(f)` and unresolved `Pending approval` decisions from `T008` remain modeling-only and cannot become production constraints, billing input, capacity enforcement, attendance logic, notifications, or authorization rules.
- `T008`, `T009`, `T010`, and `T011` remain visibly open; this plan may model stable relationships without closing those decisions.
- `T016` owns Firebase Rules; this plan does not replace default-deny Rules with permissive Rules.
- No production migration, deployment, destructive operation, paid service, credential, or Git commit is allowed.
- Every migration procedure documents `up`, compensating `down` or restore, dry-run, backup verification, checkpoints, observability, and failure handling before any application.
- Technical identifiers and code stay in English; internal documentation stays in Spanish; all fixture values are synthetic.

---

### Task 1: Record architecture and activate T013

**Files:**
- Create: `docs/adr/ADR-004-firestore-aggregate-boundaries.md`
- Modify: `tasks.md:28` and the T013 evidence section near the existing T008/T012 evidence

**Interfaces:**
- Consumes: `BRIEF.md`, `STACK.md`, `docs/superpowers/specs/2026-08-07-t013-firestore-data-model-design.md`, and the approved `T007` access matrix.
- Produces: an ADR that fixes the Firestore aggregate boundary, RTDB limitation, tenant path, alternatives, and dependency gates; `T013` moves from `pendiente` to `en-progreso` without changing the T008 dependency.

- [ ] **Step 1: Mark only T013 as active**

Change the T013 row state in `tasks.md` to `en-progreso` and leave `T008`, `T009`, `T010`, and `T011` unchanged:

```text
| T013 | Diseñar colecciones, índices, invariantes y plan de migraciones Firestore/RTDB | T007,T008 | en-progreso | Modelo y rollback documentados |
```

- [ ] **Step 2: Write the ADR with the approved decisions**

Create `docs/adr/ADR-004-firestore-aggregate-boundaries.md` with exactly these decision points:

```markdown
# ADR-004: Firestore Aggregate Boundaries and Ephemeral RTDB Presence

- Status: Accepted for T013 implementation; operational values remain pending in T008-T011.
- Date: 2026-08-07.
- Scope: BPT Jersey Academy Platform MVP data boundaries.

## Context

The platform is a Level 3 multi-module system handling minors, families, staff, attendance, check-out, memberships, payments, progress, consent, safeguarding, audit, and private documents. It needs one canonical history, tenant isolation, queryable operational records, and a small real-time surface without creating a second source of truth.

## Decision

Use Cloud Firestore Standard as the canonical store. Place academy data under `academies/{academyId}` and keep `academyId` in every operational document as a defensive tenant check. Keep domain entities in separate direct subcollections: identity, scheduling, attendance, commercial, development, CRM/communication, and restricted governance. Use deterministic IDs for booking and attendance records keyed by `sessionId__studentId`.

Use Realtime Database only for expiring presence at `academies/{academyId}/presence/{sessionId}/{studentId}`. Presence may contain `state`, `lastSeenAt`, and `sessionVersion`; it cannot contain canonical attendance, payments, memberships, progress, consent, audit, health, or safeguarding data and cannot restore Firestore.

Keep the application as a modular monolith. Backend transactions and idempotency enforce capacity, booking uniqueness, attendance uniqueness, checkout state, and append-only event behavior. Final role Rules belong to T016; final operational values belong to T008; payment provider details belong to T010; retention/residency/deletion belong to T011.

## Alternatives rejected

1. RTDB as the primary database: rejected because payment, attendance, consent, and audit history need Firestore transactions, query contracts, and durable canonical records.
2. Embedding all students, relationships, or bookings in family/session documents: rejected because arrays would grow without a safe ownership boundary and would make independent queries and corrections harder.
3. Separate database per module or microservices: rejected because the current product has one academy, one team, and no independent scaling or deployment requirement.
4. Eagerly indexing every field: rejected because compound indexes are added only for documented queries.

## Consequences

The model is consistent across modules and supports later Rules, audit, and migration work. Queries require a documented owner and index. Restricted collections need separate access checks and exports. RTDB data loss is acceptable because it is ephemeral; Firestore data loss is not and requires verified backup/restore procedures.

## Revisit conditions

Revisit this ADR only if the product adds independent tenant-scale requirements, offline canonical attendance, a measured real-time need beyond presence, or a verified operational reason to split services. Do not revisit it to encode unapproved T008/T010/T011 values.
```

- [ ] **Step 3: Record the modeling authorization without approving T008**

Replace the stale T008 evidence sentence that says T013 remains paused with a dated note stating that the operator authorized option 1 on 2026-08-07: stable relationships may be modeled with `(f)` values visible as non-production placeholders, while T008 remains `pendiente` and no placeholder becomes a production constraint.

- [ ] **Step 4: Verify the ADR and task gate**

Run:

```powershell
corepack pnpm exec prettier --check firestore.indexes.json
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
```

Search `docs/adr/ADR-004-firestore-aggregate-boundaries.md` and `tasks.md` for `academies/{academyId}`, `presence`, `T008`, `T010`, `T011`, `T016`, `rollback`, and `(f)`. Expected: the ADR contains each boundary and the task table changes only T013 to `en-progreso`.

---

### Task 2: Publish the field-level Firestore contract

**Files:**
- Create: `docs/data/firestore-data-model.md`
- Reference: `docs/superpowers/specs/2026-08-07-t013-firestore-data-model-design.md`
- Reference: `docs/security/data-classification-threat-model-access-matrix.md`

**Interfaces:**
- Consumes: the approved collection groups, common envelope, relationship rules, query table, invariants, and dependency boundaries from the T013 specification.
- Produces: a field-level contract that later backend modules, Rules, fixtures, and migrations can implement without inventing collection names or source-of-truth relationships.

- [ ] **Step 1: Define path, ID, envelope, and classification conventions**

Start the document with the canonical paths and these exact rules:

```markdown
## Path and identity conventions

- Firestore root: `academies/{academyId}`.
- Direct subcollections: `users`, `families`, `students`, `staff`, `relationships`, `locations`, `programs`, `classes`, `sessions`, `plans`, `bookings`, `attendance`, `checkouts`, `memberships`, `invoices`, `payments`, `paymentEvents`, `assessments`, `skillProgress`, `recognitions`, `leads`, `messages`, `deliveryEvents`, `healthProfiles`, `safeguardingCases`, `consents`, `documents`, `auditEvents`, and `exports`.
- RTDB presence: `academies/{academyId}/presence/{sessionId}/{studentId}`.
- Booking document ID: `{sessionId}__{studentId}`.
- Attendance document ID: `{sessionId}__{studentId}`.
- Mutable documents use `academyId`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, and `status` when applicable.
- Server timestamps and actor IDs are backend-owned; clients cannot choose them.
```

Add a classification table with `Public`, `Internal`, `Confidential`, and `Restricted`, including the read/write owner and the reason restricted data never appears in general list queries or exports.

- [ ] **Step 2: Add identity and operational collection contracts**

For each collection below, add a table with `Required fields`, `References`, `Classification`, `Write authority`, and `Deletion/history rule`:

```text
users: userId, academyId, accountType, displayName, email, authProvider, active, schemaVersion, timestamps
families: familyId, academyId, primaryContactUserId, billingContactUserId, status, schemaVersion, timestamps
students: studentId, academyId, familyId, displayName, dateOfBirthOrAgeBand, active, schemaVersion, timestamps
staff: staffId, academyId, userId, roleAssignments, active, schemaVersion, timestamps
relationships: relationshipId, academyId, familyId, studentId, adultUserId, relationshipType, permissions, validFrom, validTo, status
locations: locationId, academyId, name, address, timezone, active, schemaVersion, timestamps
programs: programId, academyId, name, ageBand, discipline, level, active, schemaVersion, timestamps
classes: classId, academyId, programId, locationId, recurrenceRule, instructorIds, capacity, active, schemaVersion, timestamps
sessions: sessionId, academyId, classId, programId, locationId, startAt, endAt, status, capacitySnapshot, schemaVersion, timestamps
plans: planId, academyId, name, eligibility, billingCadence, priceMinor, currency, active, schemaVersion, timestamps
bookings: bookingId, academyId, sessionId, studentId, membershipId, status, requestedAt, cancelledAt, schemaVersion, timestamps
attendance: attendanceId, academyId, sessionId, studentId, state, occurredAt, correctionOf, schemaVersion, timestamps
checkouts: checkoutId, academyId, sessionId, studentId, adultUserId, method, checkedOutAt, status, schemaVersion, timestamps
memberships: membershipId, academyId, familyId, studentId, planId, status, startsAt, endsAt, nextBillingAt, schemaVersion, timestamps
invoices: invoiceId, academyId, familyId, membershipId, status, totalMinor, currency, dueAt, paidAt, schemaVersion, timestamps
payments: paymentId, academyId, familyId, invoiceId, status, amountMinor, currency, occurredAt, providerReference, schemaVersion, timestamps
paymentEvents: eventId, academyId, paymentId, provider, providerEventId, eventType, receivedAt, verifiedAt, idempotencyKey, schemaVersion
```

State that `capacity`, `priceMinor`, `currency`, membership eligibility, and session rules are configurable records; `(f)` values from T008 are not hard-coded into this contract.

- [ ] **Step 3: Add development, CRM, communication, and restricted contracts**

Continue the field-level tables with:

```text
assessments: assessmentId, academyId, studentId, coachStaffId, sessionId, dimensions, observedAt, status, schemaVersion, timestamps
skillProgress: progressId, academyId, studentId, skillKey, level, evidence, reviewedBy, reviewedAt, status, schemaVersion, timestamps
recognitions: recognitionId, academyId, studentId, category, proposedBy, approvedBy, approvedAt, status, schemaVersion, timestamps
leads: leadId, academyId, contactReference, source, ownerId, status, nextActionAt, consentState, schemaVersion, timestamps
messages: messageId, academyId, audienceId, channel, templateKey, sentAt, createdBy, status, schemaVersion, timestamps
deliveryEvents: deliveryEventId, academyId, messageId, provider, providerEventId, status, occurredAt, idempotencyKey, schemaVersion
healthProfiles: healthProfileId, academyId, studentId, minimumOperationalSupport, reviewState, expiresAt, status, schemaVersion, timestamps
safeguardingCases: caseId, academyId, studentId, intakeReference, participants, actions, resolution, status, schemaVersion, timestamps
consents: consentId, academyId, subjectType, subjectId, version, signedBy, signedAt, revokedAt, evidenceDocumentId, status, schemaVersion
documents: documentId, academyId, subjectType, subjectId, objectKey, classification, permissions, expiresAt, status, schemaVersion, timestamps
auditEvents: auditEventId, academyId, actorId, action, targetRef, purpose, correlationId, occurredAt, result, schemaVersion
exports: exportId, academyId, requestedBy, purpose, scope, classification, recipient, expiresAt, status, schemaVersion, timestamps
```

Specify that health and safeguarding records contain only the minimum operational data, document blobs remain in private R2, audit/payment events are append-only, consent evidence is versioned, and none of these collections is exposed through a general student/family listing.

- [ ] **Step 4: Document relationships, source of truth, and ownership**

Add a relationship matrix covering `family -> relationship -> student`, `session -> program/class/location`, `booking -> session/student/membership`, `attendance -> session/student`, `checkout -> session/student/adult`, and `payment -> invoice/membership`. For each row state which module writes the record, which module may read it, and whether corrections append history or update a mutable status.

Include the exact consistency rules:

```markdown
- A booking is eligible only after backend verification of the student, family relationship, active membership, program, and session.
- A booking and attendance record are unique by `{sessionId}__{studentId}`; retries are idempotent.
- An attendance correction preserves the original record and writes an audit event.
- A checkout requires a valid staff or authorized-adult actor and one active checkout per student/session.
- Payment provider events are verified and idempotent; they do not silently rewrite financial history.
- Belts and stripes are never granted automatically by a stored assessment or progress document.
```

- [ ] **Step 5: Map documented queries to index ownership**

Copy the sixteen query contracts from the T013 specification into a table with `Collection`, `Filters/order`, `Owning module`, and `Index entry`. State that a new compound index requires a real query owner and a test or query contract before it is added to `firestore.indexes.json`.

- [ ] **Step 6: Verify the contract has no unresolved implementation gaps**

Run:

```powershell
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
```

Search the document for `T008`, `T009`, `T010`, `T011`, `Restricted`, `academyId`, `schemaVersion`, `append-only`, `R2`, and `RTDB`. Expected: each dependency and security boundary is explicit; no field stores raw payment credentials or full medical/safeguarding narratives.

---

### Task 3: Create the migration, backup, and rollback runbook

**Files:**
- Create: `docs/data/migrations/README.md`
- Reference: `docs/superpowers/specs/2026-08-07-t013-firestore-data-model-design.md`
- Reference: `STACK.md` sections `Base de datos`, `Testing`, `Costo`, and `Hosting / Despliegue`

**Interfaces:**
- Consumes: T013 migration procedure, rollback rules, Firebase emulator ports, and deployment prohibitions.
- Produces: an operational runbook that later migration tasks can execute without inventing backup, restore, environment, or failure semantics.

- [ ] **Step 1: Define migration metadata and environment guards**

Create the runbook with a required migration record containing `migrationId`, `modelVersion`, `author`, `createdAt`, `scope`, `up`, `downOrRestore`, `verificationQueries`, `backupReference`, and `operatorApproval`. Require an explicit environment value of `emulator`, `staging`, or `production`; reject an empty or unknown environment before any write.

- [ ] **Step 2: Document the `up` workflow**

Document these exact phases in order:

```text
1. Review BRIEF.md, STACK.md, tasks.md, the current ADR, and the field-level contract.
2. Enumerate affected collections and expected document counts.
3. Run the migration against synthetic fixtures in the Firebase emulators.
4. Validate tenant path, academyId, references, deterministic IDs, statuses, timestamps, and query results.
5. Run in staging only after a backup and restoration test are recorded.
6. Create a recent production backup, verify restoration, and obtain explicit operator approval before production.
7. Apply additive, idempotent writes in bounded checkpoints with structured logs and counters.
8. Re-run invariants and query checks after every checkpoint.
```

State that this T013 implementation performs none of phases 5-7 and leaves production untouched.

- [ ] **Step 3: Document `down`, compensation, and restore**

Define `down` for additive fields/records as an idempotent compensating operation; define restore for changes to existing documents as restoring the verified backup or running a staging-tested reversal. Prohibit `DROP`, `TRUNCATE`, destructive type changes, and manual console deletion without backup, audit evidence, and explicit operator approval.

- [ ] **Step 4: Add failure, observability, and reconciliation rules**

Require a migration correlation ID, checkpoint number, attempted/succeeded/failed counts, affected academy IDs, error sample, and final status. On failure, stop at the current checkpoint, preserve logs and the pre-migration backup reference, do not retry blindly, run the documented reversal, and reconcile counts before reopening writes.

- [ ] **Step 5: Add the local verification commands**

Include the exact commands below and explain their expected purpose:

```powershell
corepack pnpm test:rules
corepack pnpm test
corepack pnpm typecheck
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
```

The runbook must state that `test:rules` requires the Firebase emulators, that default-deny Rules remain expected until T016, and that a green local run is not approval for staging or production.

- [ ] **Step 6: Verify migration safety language**

Search the runbook for `backup`, `restore`, `rollback`, `operator`, `production`, `emulator`, `idempotent`, `DROP`, and `TRUNCATE`. Expected: every destructive action is blocked by backup verification and explicit operator approval; no step implies that T013 already migrated data.

---

### Task 4: Materialize indexes and synthetic emulator fixtures

**Files:**
- Modify: `firestore.indexes.json`
- Create: `qa/fixtures/t013-model-fixtures.json`
- Create: `qa/rules/t013-data-model.test.ts`

**Interfaces:**
- Consumes: the query table in `docs/data/firestore-data-model.md`, the canonical paths, and the common envelope.
- Produces: sixteen query-backed composite indexes and a rules-disabled emulator test that loads only synthetic records, validates path/tenant/ID invariants, exercises the documented session query, and verifies RTDB presence stays ephemeral.

- [ ] **Step 1: Add only the sixteen documented compound indexes**

Replace the empty `indexes` array with these `collectionGroup`/`queryScope`/`fields` pairs, keeping `fieldOverrides` empty:

```json
{
  "indexes": [
    { "collectionGroup": "sessions", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "startAt", "order": "ASCENDING" }] },
    { "collectionGroup": "sessions", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "locationId", "order": "ASCENDING" }, { "fieldPath": "startAt", "order": "ASCENDING" }] },
    { "collectionGroup": "sessions", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "programId", "order": "ASCENDING" }, { "fieldPath": "startAt", "order": "ASCENDING" }] },
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "sessionId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "ASCENDING" }] },
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "studentId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" }] },
    { "collectionGroup": "attendance", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "studentId", "order": "ASCENDING" }, { "fieldPath": "occurredAt", "order": "DESCENDING" }] },
    { "collectionGroup": "attendance", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "sessionId", "order": "ASCENDING" }, { "fieldPath": "state", "order": "ASCENDING" }] },
    { "collectionGroup": "memberships", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "studentId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }] },
    { "collectionGroup": "memberships", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "nextBillingAt", "order": "ASCENDING" }] },
    { "collectionGroup": "invoices", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "familyId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "dueAt", "order": "ASCENDING" }] },
    { "collectionGroup": "payments", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "familyId", "order": "ASCENDING" }, { "fieldPath": "occurredAt", "order": "DESCENDING" }] },
    { "collectionGroup": "leads", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "nextActionAt", "order": "ASCENDING" }] },
    { "collectionGroup": "leads", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "ownerId", "order": "ASCENDING" }, { "fieldPath": "nextActionAt", "order": "ASCENDING" }] },
    { "collectionGroup": "messages", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "audienceId", "order": "ASCENDING" }, { "fieldPath": "sentAt", "order": "DESCENDING" }] },
    { "collectionGroup": "auditEvents", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "targetRef", "order": "ASCENDING" }, { "fieldPath": "occurredAt", "order": "DESCENDING" }] },
    { "collectionGroup": "auditEvents", "queryScope": "COLLECTION", "fields": [{ "fieldPath": "actorId", "order": "ASCENDING" }, { "fieldPath": "occurredAt", "order": "DESCENDING" }] }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 2: Create the synthetic fixture set**

Create `qa/fixtures/t013-model-fixtures.json` with no real names, emails, addresses, credentials, or payment data. Use `demo-academy` as the tenant and include at least these records:

```json
{
  "firestore": [
    { "path": "academies/demo-academy", "data": { "academyId": "demo-academy", "schemaVersion": 1, "status": "active", "displayName": "Synthetic Academy" } },
    { "path": "academies/demo-academy/students/student-demo-1", "data": { "academyId": "demo-academy", "schemaVersion": 1, "studentId": "student-demo-1", "familyId": "family-demo-1", "displayName": "Synthetic Student", "active": true, "status": "active" } },
    { "path": "academies/demo-academy/sessions/session-demo-1", "data": { "academyId": "demo-academy", "schemaVersion": 1, "sessionId": "session-demo-1", "programId": "program-demo-bjj", "locationId": "location-demo", "startAt": "2026-08-11T17:30:00Z", "endAt": "2026-08-11T18:30:00Z", "status": "scheduled" } },
    { "path": "academies/demo-academy/bookings/session-demo-1__student-demo-1", "data": { "academyId": "demo-academy", "schemaVersion": 1, "bookingId": "session-demo-1__student-demo-1", "sessionId": "session-demo-1", "studentId": "student-demo-1", "status": "requested", "createdAt": "2026-08-07T12:00:00Z" } },
    { "path": "academies/demo-academy/attendance/session-demo-1__student-demo-1", "data": { "academyId": "demo-academy", "schemaVersion": 1, "attendanceId": "session-demo-1__student-demo-1", "sessionId": "session-demo-1", "studentId": "student-demo-1", "state": "present", "occurredAt": "2026-08-11T17:35:00Z" } },
    { "path": "academies/demo-academy/paymentEvents/payment-event-demo-1", "data": { "academyId": "demo-academy", "schemaVersion": 1, "eventId": "payment-event-demo-1", "provider": "synthetic", "providerEventId": "provider-event-demo-1", "eventType": "payment_succeeded", "idempotencyKey": "synthetic-event-demo-1", "receivedAt": "2026-08-11T18:00:00Z" } },
    { "path": "academies/demo-academy/healthProfiles/student-demo-1", "data": { "academyId": "demo-academy", "schemaVersion": 1, "healthProfileId": "student-demo-1", "studentId": "student-demo-1", "minimumOperationalSupport": "synthetic-only", "status": "active" } }
  ],
  "rtdb": [
    { "path": "academies/demo-academy/presence/session-demo-1/student-demo-1", "data": { "state": "checked_in", "lastSeenAt": "2026-08-11T17:35:30Z", "sessionVersion": 1 } }
  ]
}
```

- [ ] **Step 3: Add the emulator-backed fixture test**

Create `qa/rules/t013-data-model.test.ts` using the existing `initializeTestEnvironment` pattern. The test must:

1. Read `firestore.rules` and `database.rules.json` from the repository and connect to ports `8080` and `9000`.
2. Load `qa/fixtures/t013-model-fixtures.json`.
3. In `testEnvironment.withSecurityRulesDisabled`, write every fixture record with `setDoc(doc(firestore, path), data)` and `set(ref(database, path), data)`; this bypass is test-only and does not modify Rules.
4. Assert every Firestore path starts with `academies/demo-academy/` or equals `academies/demo-academy`, every Firestore record has `data.academyId === "demo-academy"`, and booking/attendance IDs equal `{sessionId}__{studentId}`.
5. Query `academies/demo-academy/sessions` with `where("status", "==", "scheduled")` and `orderBy("startAt", "asc")`, then assert the first document is `session-demo-1`.
6. Read the RTDB presence node and assert its keys are exactly `state`, `lastSeenAt`, and `sessionVersion`; assert no forbidden canonical field such as `paymentId`, `attendanceId`, `membershipId`, `healthProfileId`, or `auditEventId` exists.
7. Clear Firestore and RTDB after each test and clean up the emulator environment after all tests.

The file may use `unknown` plus narrow helper functions for parsed JSON; it must not introduce a production data adapter or change Rules.

- [ ] **Step 4: Validate index ownership and fixture safety**

Run:

```powershell
corepack pnpm exec prettier --check firestore.indexes.json qa/rules/t013-data-model.test.ts
corepack pnpm test:rules
```

Expected: the index file parses and contains sixteen entries; the emulator test passes; no Rules are loosened; only synthetic records are written and cleaned up.

---

### Task 5: Run the T013 gate and prepare operator review

**Files:**
- Modify: `tasks.md:28` and the T013 evidence section
- Review: all files created or modified by Tasks 1-4

**Interfaces:**
- Consumes: completed ADR, field contract, migration runbook, index file, fixture, and emulator test.
- Produces: fresh verification evidence and T013 in `revisión`; it does not mark T013 `aprobada` until the operator explicitly accepts the result.

- [ ] **Step 1: Run the security-focused content scan**

Search only the T013 deliverables:

```text
pattern: password|secret|credential|serviceAccount|api[_-]?key|privateKey|cvv|cvc|card number|real customer|real student
path: docs/adr,docs/data,qa/fixtures,qa/rules
```

Expected: no credentials, card data, real customer records, or service-account material. A documented prohibition such as `No raw card number` is acceptable only when it is not accompanied by a secret value.

- [ ] **Step 2: Run the relevant verification commands**

Run each command and preserve its actual output:

```powershell
corepack pnpm test:rules
corepack pnpm test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm exec prettier --check firestore.indexes.json qa/rules/t013-data-model.test.ts
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
```

If the root formatter still reports only the pre-existing external `opencode.json` change, record that exact residual without changing or hiding the file. Any new failure in T013 files keeps the task `en-progreso` until corrected.

- [ ] **Step 3: Inspect the final diff and dependency boundaries**

Confirm that the diff changes only the planned ADR, data docs, migration runbook, index file, fixture, emulator test, and T013 evidence. Confirm that `firestore.rules`, `database.rules.json`, application runtime code, secrets, production projects, and T008 operational values were not changed.

- [ ] **Step 4: Apply the self-critique result**

Review the deliverables against `security-baseline`: tenant isolation is explicit, restricted data is separated, RTDB cannot become canonical, no raw payment data exists, and destructive migration requires backup plus operator approval. If a critical security finding appears, stop and leave T013 `en-progreso`.

- [ ] **Step 5: Record exact evidence and move T013 to review**

Append a dated `T013 - 2026-08-07` entry under `Evidencia del ciclo de autocrítica` in `tasks.md` with the actual test counts, lint/typecheck/format results, diff check result, fixture scope, and the residual root formatter issue if it remains. Change only the T013 state to `revisión` after all relevant commands pass.

- [ ] **Step 6: Stop at the operator checkpoint**

Present the changed files, verification evidence, open dependencies, and the explicit statement that no migration or deployment occurred. Wait for the operator to approve T013 before changing it to `aprobada` or starting T015/T016 work.

## Plan Self-Review

- Spec coverage: architecture boundaries map to Task 1; collection fields and relationships map to Task 2; migration/rollback requirements map to Task 3; indexes and synthetic fixture checks map to Task 4; security, tests, and evidence map to Task 5.
- Placeholder safety: `(f)` and `Pending approval` remain visible as non-production dependencies; T008 is never silently approved.
- Type/path consistency: collection names, root paths, deterministic IDs, field names, and query fields are repeated consistently across the ADR, data contract, fixture, indexes, and test.
- Scope boundary: no Firebase Rules implementation, payment provider selection, retention policy, production migration, or deployment is included; those remain owned by later tasks and operator checkpoints.
