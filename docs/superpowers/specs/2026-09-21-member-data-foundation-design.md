# Member data foundation: simplified profiles, canonical member numbers and IBJJF v3

Date: 2026-09-21 · Branch: `main` · Delivery: 1 of 6

## 1. Context and goal

This is the first vertical delivery in the approved eleven-objective programme. It establishes the
member-data rules needed by the later Intro Class, membership, calendar and staff deliveries without
changing opaque resource identities or widening role access.

The delivery:

- removes postal location and medical-condition capture from member-facing and administrative forms;
- retains backward-compatible reads of historical documents;
- keeps venue and subscription selection in their purpose-specific flows;
- makes the visible membership number a canonical positive decimal string;
- adds an idempotent, reviewable reconciliation for legacy membership-number collisions; and
- publishes a new immutable level catalogue version whose adult White Belt first-stripe threshold is
  20 attended classes and 60 days.

This delivery does not execute a production migration, seed a production catalogue, deploy Firebase
Functions or deploy the web application. Those operations require separate operator authorisation.

## 2. Programme decomposition

The operator approved six independently reviewable deliveries:

1. Member data foundation (this specification).
2. Intro Class booking, attendance, in-app conversion and pending subscription review.
3. Staff creation with a temporary password or verified Google link.
4. Session curriculum, auto-booking, Transit Free and cross-level access exceptions.
5. Classes / Services measured performance improvements.
6. Courses, seminars and landing-page redesign.

Each delivery receives its own specification, implementation plan, focused commits and verification.
Existing functionality is audited before extension so the programme does not reimplement features
already present in the repository.

## 3. Approved decisions

1. `studentId` and internal `memberId` values remain opaque and immutable. Only the visible
   `membershipNumber` is normalised.
2. A canonical membership number is a positive decimal string with no `#`, sign, decimal point or
   leading zero. The stored representation remains a string to avoid JavaScript integer limits and
   preserve a stable display value.
3. `#0033`, `0033` and `33` have the same canonical candidate, `33`. Zero, negative values, decimals
   and non-numeric text require manual review.
4. A non-colliding prefixed or zero-padded value is normalised in place. When `#33` and canonical
   `33` coexist, `33` keeps its number and the prefixed record receives the next number after the
   highest canonical value. Gaps are never reused.
5. Address, post code, city and country are removed from capture and editing. Historical values
   remain readable by compatibility schemas but are not rendered in general member or admin forms.
6. Medical conditions are not captured or edited. Historical medical records remain read-only in the
   restricted medical area until the retention policy removes them. Member and coach views never
   receive them.
7. Public and administrative enrolment retain venue and subscription-plan selection. The member
   profile retains preferred venue. Member plan selection and changes belong to
   `/account/membership`, with evidence and administrative approval, not profile editing.
8. Adult White Belt first-stripe eligibility begins at 20 attended classes and 60 days and remains
   satisfied above those thresholds.
9. The published and hashed `ibjjf-v2` catalogue is not rewritten. `ibjjf-v3` preserves its keys,
   hierarchy, skills and visuals while superseding the historical 25-class/90-day White Belt override.
10. Production migration, catalogue seed and deployment are separate, explicitly authorised
    operations.

## 4. Domain boundaries

### 4.1 Persisted compatibility versus new input

Persisted schemas continue to parse optional legacy `postalAddress`, city, country and medical data.
Removing those properties from persisted schemas would make existing documents unreadable and is not
required to stop collection.

Mutation schemas treat all removed fields as optional legacy input so an older client does not block
an otherwise valid mutation. Current clients omit them. A full-replacement update that omits a legacy
field preserves the stored value rather than silently deleting history. No completeness check depends
on a postal or medical field.

Read projections enforce purpose:

- general account, member directory and coach projections omit historical postal and medical data;
- the ordinary administrator Details form omits postal location;
- the restricted medical workflow may display historical medical data as read-only; and
- migration and reconciliation services may read legacy values only for their documented purpose.

### 4.2 Venue and subscription ownership

The public enrolment flow remains:

`personal details → venue → eligible plan → payment evidence when required → submit`.

Administrative enrolment remains:

`personal details → initial level → venue → subscription/payment → complete`.

The account profile updates personal details, training preferences and preferred venue. It links to
Membership for plan changes. A profile mutation cannot create or activate a subscription.

### 4.3 Canonical membership number

A pure shared normaliser accepts a bounded string and returns either a canonical value or a closed
error code. The canonical range is `1..999999999`, matching the existing nine-digit operational
ceiling. Leading zeros and a single leading `#` are removed before validation. Whitespace and control
characters do not become part of an identifier.

New and updated membership numbers are checked for academy-scoped uniqueness in the same transaction
that writes the profile. The uniqueness reservation is keyed from a non-reversible deterministic
identity representation already used by the canonical member directory rather than making the
sequential number a public Firestore document identity.

Duplicate input returns a stable conflict code and, where the caller is authorised to see it, the
next monotonic candidate. Opaque IDs remain the only references used by attendance, payments,
audits, bookings and child collections.

## 5. Membership-number reconciliation

The reconciliation is implemented under `apps/functions/src/members/` as domain logic plus a
Firestore adapter and an operator CLI entry point. It reuses the repository's existing migration
patterns instead of creating a second generic migration framework.

### 5.1 Plan phase

The read-only phase scans `members` and the canonical member directory for one academy, validates
document ownership and builds a deterministic plan. Each row contains only the opaque record
reference, source version/precondition, masked old value, proposed canonical value and reason. The
full plan includes the observed maximum, counts, academy scope, generation time, schema version and a
content hash.

Rows are classified as:

- `normalise`: a unique valid candidate can be changed in place;
- `reassign`: a legacy-form record collides with the canonical owner and receives a reserved
  monotonic number;
- `already_canonical`: no write is necessary; or
- `manual_review`: invalid, ambiguous, cross-academy or inconsistent data must not be changed.

The canonical owner always keeps the number. Multiple colliding legacy rows are ordered by stable
opaque ID and assigned consecutive numbers after the observed maximum so retries produce the same
plan.

### 5.2 Apply phase

Apply requires the exact plan hash and an explicit confirmation. It re-reads each source inside a
transaction, checks the captured version and verifies the number reservation before writing. It
updates only membership-number projections and identity aliases; it never changes opaque document
IDs or rewrites attendance, payments, bookings, audits or child collection references.

Each applied row writes append-only audit evidence with actor, operation ID, old/new masked values,
reason and timestamps. It does not log raw personal data. A retry yields `already_applied`. A changed
source yields `stale`, and a conflicting reservation yields `manual_review`; neither is overwritten.

The public result statuses are `planned`, `applied`, `already_applied`, `stale` and `manual_review`.
Chunk receipts allow safe restart after partial completion.

## 6. IBJJF v3

`ibjjf-v3` is a new approved catalogue version. It is generated from the same committed structural
sources as `ibjjf-v2`, with stable definition keys and a new operator-override table that sets adult
`WHITE BELT` to `minClasses: 20` and `minDays: 60`. The existing Red Belt decision remains unchanged.

Version shapes and approved hashes become version-aware for v3. Seed guards continue to fail closed
for unknown targets, mismatched projects, emulator/production confusion, unapproved hashes and absent
confirmation strings. Because v2 and v3 intentionally reuse logical definition keys, v3 definition
and requirement documents use version-qualified storage IDs while retaining their logical keys in
document data. A single academy-scoped active-catalogue pointer keeps v2 authoritative while v3 is
staged; all runtime reads resolve through that pointer.

An independent dry-run migration identifies active `studentLevelProgress` heads on `ibjjf-v2` whose
definition keys exist unchanged in v3. Apply updates only the mutable head's `systemId`, version and
audit metadata with a concurrency precondition. Historical promotions and assessments retain their
original system references. An unknown or changed definition key requires manual review.

Activation is a separate, idempotent transaction after migration. It requires an exact confirmation
bound to academy, operation and migration-plan hash; refuses any progress head not on v3; preserves
the immutable v2 catalogue; and writes an immutable activation receipt before v3 becomes active.

Backend summaries and frontend progress widgets consume the catalogue criteria already returned by
the progress service. Neither layer gets a second hard-coded 20/60 rule. Eligibility uses `>=`, so it
does not regress after class 20 or day 60.

## 7. Interfaces and experience

### 7.1 Public enrolment

Remove address state, fields, partial-address error messages and request mapping. Keep the existing
venue selector, eligible-plan step, payment evidence rules, waiver and resumption behaviour. Copy must
not suggest that the online form collects medical conditions.

### 7.2 Account profile and membership

The account profile continues to edit identity, contact, preferred venue and training preferences.
It does not show postal or medical fields. A clear action routes plan selection to
`/account/membership`; saving the profile cannot alter billing state.

### 7.3 Administrative member surfaces

Remove Address, Post code, City and Country from the Details draft, field-error mapping and rendered
form. Preserve venue and the existing Plan editor. Administrative creation keeps venue and plan in
the completion flow. The medical area shows inherited records as read-only and retains its current
office-only authorisation.

All surfaces reuse the admin/account shells, controls and `DESIGN.md` tokens. Removing fields should
simplify hierarchy rather than introduce replacement cards or decoration. Focus visibility, keyboard
operation, 44px touch targets and mobile overflow protection remain required.

## 8. Authorisation and security invariants

- Coach projections and routes remain free of finance, postal, medical and migration data.
- Only existing authorised office roles may update member details.
- Only an owner or explicitly authorised operator path may apply reconciliation or catalogue
  migration; ordinary clients cannot call it.
- App Check, current-role validation, academy scoping, rate limits and audit availability remain
  fail-closed.
- Sequential membership numbers are display identifiers, never public resource keys or authorisation
  evidence.
- Migration artefacts contain masked values and no credentials, medical content or payment evidence.
- No direct client write is added to Firestore Rules.

## 9. Error behaviour

- Missing removed fields never fail enrolment, profile or member updates.
- Partial or malformed legacy values remain readable but are not copied into new requests.
- A duplicate canonical number returns a conflict without exposing the owner of that number.
- A migration precondition mismatch returns `stale`; it does not retry with a newly invented result.
- Invalid legacy numbers remain unchanged under `manual_review`.
- Catalogue hash, target or confirmation mismatch aborts before any write.
- Catalogue activation refuses unresolved or stale progress heads and never deletes v2.
- UI errors use the established safe, plain-language messages and retain the user's non-sensitive
  form state.

## 10. Verification

### 10.1 Unit and service tests

- Current forms and mutation contracts succeed without address or medical fields.
- Historical documents containing those fields still parse and restricted reads remain scoped.
- Venue and plan remain present in public and administrative enrolment.
- Canonicalisation covers `#0033`, `0033`, `33`, whitespace, bounds and all rejected forms.
- Transactional uniqueness handles concurrent attempts and never exposes another member.
- Reconciliation covers unique normalisation, `#33`/`33`, multiple collisions, deterministic
  allocation, partial chunks, replay, stale sources and invalid records.
- Tests assert that opaque IDs and representative attendance/payment/audit references do not change.
- `ibjjf-v3` passes shape and approved-hash integrity checks, preserves all definition keys, uses
  20/60 for adult White Belt and retains other v2 criteria.
- Progress tests cover 19/59, 20/60 and values above both thresholds.
- Negative authorisation tests cover coach and ordinary-client access.

### 10.2 Playwright

Using Firebase emulators and synthetic identities only:

- public enrolment has no removed fields and completes venue/plan selection;
- administrative enrolment completes venue and subscription without postal/medical data;
- the member profile exposes preferred venue but routes plan changes to Membership;
- the admin Details form omits all four location fields and still saves unrelated changes; and
- progress renders not-yet-eligible, threshold-met and above-threshold states from backend data.

Tests use role-based locators, accessible labels and web-first assertions. They must not depend on
production accounts, member data, payment evidence or credentials.

## 11. Delivery and rollback

Implementation commits stay focused on this delivery and are pushed directly to `origin/main` under
the repository workflow. Automated suites run because the operator explicitly requested Vitest and
Playwright verification for this programme.

Publishing remains separate. A future authorised rollout must apply compatible Functions before or
with web changes, generate and review reconciliation dry runs, seed v3 under its production guard,
migrate progress heads, and verify reads before enabling consumers. Rollback means stopping new
writes, restoring the prior web/Functions release and pointing active heads back only through the
versioned migration tool; immutable catalogues and historical audit are never deleted.

## 12. Out of scope

- Executing any production migration, seed or deployment.
- Deleting historical postal or medical data outside the retention workflow.
- Making sequential numbers into document IDs.
- Intro Class, staff credentials, curriculum, auto-booking, Transit Free, access exceptions,
  Classes / Services performance work or the course redesign; those belong to deliveries 2–6.
