# Intro Class booking, attendance and membership conversion

Date: 2026-09-21 · Branch: `main` · Delivery: 2 of 6

## 1. Context and goal

This is the second vertical delivery in the approved eleven-objective programme. It lets a new
student book and attend one free Intro Class without first holding a subscription, then guides the
student or guardian through an in-app, manually reviewed membership purchase.

The observable outcome is:

`Intro Class → free booking → attendance → in-app follow-up → venue and plan → bank-transfer evidence → office review → active membership`.

No email, SMS, external push provider, automatic charge or payment-provider integration is added.
Production deployment, data migration and Firebase configuration remain separate operations that
require explicit operator authorisation.

## 2. Approved product decisions

1. An Intro Class costs zero and does not require a current subscription.
2. The participant still needs a signed-in BPT account, a canonical student identity and a current
   accepted waiver. Removing the subscription precondition does not remove safeguarding controls.
3. A new student is one with no recorded Intro Class attendance and no active ordinary membership.
   An expired, paused, overdue or cancelled membership does not make a former member eligible for a
   self-service introductory place. Office staff may resolve exceptional cases outside this flow.
4. A participant may hold at most one future confirmed Intro Class booking. Cancellation and a
   no-show permit rebooking; confirmed attendance closes future self-service Intro Class booking.
5. The ordinary capacity, booking-window, cancellation, class-status and academy-boundary rules
   continue to apply.
6. Members may self-check in and coaches or administrators may mark attendance using the existing
   attendance controls. Existing time, booking, geofence, actor and audit checks remain in force.
7. Only the first confirmed Intro Class attendance creates the conversion follow-up. Retries or
   later corrections cannot create duplicate notices or applications.
8. Follow-up is exclusively in-app. No email, SMS or paid notification service is called.
9. The membership form collects the participant, venue and eligible subscription plan. It does not
   collect postal address or medical conditions.
10. The applicant transfers the displayed amount and uploads a PNG or JPEG receipt/screenshot.
    Submission creates a pending membership application; it does not grant class access.
11. Owner or administrator reviews the evidence in `/admin/billing`. Approval creates the canonical
    financial and membership records; correction and rejection leave an explicit reason visible to
    the applicant.
12. Coaches can see the Intro Class participant in their roster and record attendance, but cannot
    see payment evidence, applications or billing actions.

## 3. Rejected approaches

### 3.1 Hidden trial membership

The current `/account/membership` flow creates a `trial` membership for a selected paid plan, and
ordinary bookings accept `trial` as eligible. Reusing that mechanism would force the user to select
a subscription before attending and could accidentally grant access to other classes. Intro access
therefore must not be represented as a membership.

### 3.2 Course or seminar enrolment

The finite-course module already supports membership-free access, private payment evidence and
in-app notices, but its commercial lifecycle is a one-time purchase for a fixed programme. An Intro
Class converts into a recurring membership. Reusing course enrolments as the source of truth would
mix capacity, refund and attendance semantics. The implementation may reuse small storage or UI
patterns, not course records or course authorisation.

### 3.3 Client-authored Firestore state

Direct browser writes would weaken academy scope, evidence ownership and idempotency. All bookings,
notices, applications and review decisions remain behind App Check-protected callable services or
trusted backend triggers.

## 4. Class and session modelling

### 4.1 Intro designation

The class definition carries an explicit access mode:

- `membership` for ordinary classes; and
- `intro` for the free introductory funnel.

Persisted class and session readers default a missing value to `membership`, preserving existing
documents. New or updated sessions inherit the class access mode, while an authorised office user
may correct a specific session. A client cannot infer Intro Class access from the title.

The administrative Classes / Services editor exposes one clear control for the access mode. It
reuses the existing admin shell and controls. The member calendar labels Intro Class plainly and
shows that it is free; it does not use decorative pricing cards or introduce a parallel calendar.

### 4.2 Booking origin

The booking contract gains a new versioned origin:

```ts
{
  schemaVersion: "3";
  membershipId: null;
  source: { kind: "intro" };
}
```

Legacy membership and course booking records remain readable. The booking ID stays deterministic
from session and canonical student, so retries cannot reserve two places. Attendance, cancellation,
capacity counts, roster reads and audit projections accept the new origin only after validating the
session's stored access mode.

### 4.3 Intro eligibility

The final booking transaction evaluates all facts again under server authority:

- authenticated actor is authorised for the canonical participant;
- participant is active and academy-scoped;
- a current accepted waiver exists;
- session is scheduled, bookable and marked `intro`;
- session venue is compatible with the participant's selected/preferred venue;
- no ordinary active membership exists;
- no prior attended or late Intro Class exists;
- no other future confirmed Intro Class booking exists; and
- capacity and booking deadlines permit the place.

The browser may show optimistic eligibility but cannot authorise it. Existing membership booking
rules are unchanged for ordinary sessions.

## 5. Calendar and attendance

The account calendar must be useful before a membership exists. Its read model therefore returns
eligible Intro Class sessions for an authorised canonical participant independently from the
ordinary membership calendar. When a participant has a current membership, normal sessions remain
driven by that membership and Intro Class is not offered.

A confirmed Intro Class booking appears in the same calendar cards and daily agenda as ordinary
bookings. Cancellation uses the existing confirmation dialog. The member self-check-in path still
requires that booking and enforces its current server-time and proximity rules. Staff check-in uses
the existing coach/admin roster and preserves coach role restrictions.

Attendance records retain their canonical deterministic identity. Intro origin is derived from the
validated booking and session, not from a client flag. Corrections preserve audit history. A later
correction from attended/late to a non-attendance state does not silently delete an already issued
follow-up; office can resolve the resulting application normally.

## 6. First-attendance trigger and in-app notice

A Firestore attendance trigger handles only newly created canonical attendance records. It ignores
corrections, missed states, non-Intro sessions and cross-academy inconsistencies. In a transaction it
re-reads the session, booking and canonical participant, then creates a deterministic conversion
state keyed by academy and student. The state is create-once, making trigger retry and concurrent
check-in safe.

The conversion state records the first accepted source attendance, participant, recipient account,
creation time and lifecycle status. It contains no payment evidence or health data. For an adult the
recipient is the linked client account; for a minor it is the currently authorised guardian. If no
safe recipient can be resolved, the trigger records an auditable unresolved state rather than send
the notice to a guessed account.

The same transaction creates a member notification with:

- kind `intro-membership-follow-up`;
- a short title and message;
- `href: "/account/membership?from=intro"`;
- recipient UID, participant ID and source attendance ID;
- `readAt: null`; and
- a deterministic notice ID.

The member-notification collection is generic to account notices rather than course-specific.
Callables list only the caller's own notices, use stable pagination and mark a notice read only after
checking recipient ownership. The account surface displays the unread notice as a status band with
one action. It never renders server text as HTML.

## 7. Membership application and private evidence

### 7.1 Selection

`/account/membership` continues to show existing memberships, but the Intro follow-up replaces the
current generic trial action for an eligible conversion state. The participant or authorised
guardian selects:

- the canonical participant;
- Town or West venue; and
- one currently published plan that is eligible for age, participant type and venue.

The server re-reads the plan and eligibility at submission. Price, currency, duration and class
allowances come from the stored plan, never the browser. Retired plans cannot be selected. If no
plan matches, the page tells the applicant to contact the office without creating partial access.

### 7.2 Bank transfer and upload

The form reads the academy's existing bank-transfer instructions. Missing instructions prevent the
application from entering payment review and show an actionable message. The server generates a
non-personal transfer reference bound to the application.

Evidence accepts only non-empty PNG or JPEG files up to 2 MiB. The backend verifies the decoded
bytes, computes the SHA-256 identity and stores the object under an academy/applicant/application
namespace in the existing private R2 boundary. Repeating the same upload is idempotent. The browser
never receives bucket credentials or a durable public URL.

Submission verifies that the object exists, belongs to the caller and matches its hash before it is
attached. It records the applicant-entered bank reference and the server-owned plan snapshot. The
application state machine is:

`draft → pending_review → correction_requested → pending_review → approved | rejected | cancelled`.

Only one non-terminal application may exist for a participant. `pending_review` and
`correction_requested` grant no booking access and create no active membership.

## 8. Administrative billing review

`/admin/billing` adds a pending membership applications section using the existing shell and table
patterns. Owner and administrator may:

- open the selected participant, venue, plan snapshot, amount and transfer reference;
- request a one-minute private evidence URL;
- approve the application after confirming the transfer;
- request correction with a required reason; or
- reject with a required reason.

The office cannot change the applicant's selected plan while approving. If the plan, price,
participant eligibility or payment instructions changed materially, approval stops and asks for a
fresh application decision. The evidence image uses a fixed image context, no HTML injection and
`referrerPolicy="no-referrer"`.

Approval is an idempotent server operation identified by request ID and expected application
revision. It creates or activates exactly one canonical membership for the selected plan and period,
one matching membership invoice and one manual bank-transfer payment allocation. It reuses the
existing finance and membership invariants: payer scope, integer minor units, exact allocation,
audit events and canonical student/family linkage. It then marks the application approved and the
conversion state completed. A retry returns the same result; partial or conflicting records stop for
manual review rather than fabricate another payment.

Correction and rejection create deterministic in-app notices linking back to Membership. Evidence
remains private and follows the existing retention boundary. Coaches and members cannot request the
administrative evidence URL.

## 9. Authorisation and security invariants

- Every callable requires App Check and a current active account unless an existing emulator-only
  test seam explicitly substitutes it.
- Academy ID, participant ID, recipient UID, plan, price and membership dates are server-derived or
  revalidated at the trust boundary.
- Guardian actions require the current canonical relationship; a stale client selection is denied.
- Teen accounts may view their calendar and check themselves in under existing policy, but payment
  application authority remains with the guardian where current product rules require it.
- Coach reads contain session, participant and attendance facts only. No price, bank instruction,
  receipt or application decision enters coach payloads.
- Member notifications are recipient-scoped and cannot be enumerated by document ID.
- Evidence is content-type, size, ownership and hash checked. Signed administrative URLs expire
  after one minute and use no-referrer rendering.
- Deterministic operation receipts protect booking, trigger, submission and approval retries.
- No direct client writes are added to Firestore Rules.
- Audit data identifies actors and outcomes without copying receipt bytes or unnecessary personal
  information.

## 10. Error and recovery behaviour

- A concurrent final place produces one confirmed booking and one capacity error.
- A cancelled or full session never becomes bookable because a stale calendar said otherwise.
- An Intro Class booking attempted after first attendance or active membership returns a stable,
  non-sensitive ineligibility reason.
- Trigger failure can be retried safely. Duplicate trigger delivery produces no second notice.
- Missing guardian/account resolution creates an unresolved conversion state visible to authorised
  office staff; it does not notify another user.
- Interrupted evidence upload leaves an unattached private object eligible for the existing cleanup
  policy and no pending application.
- A failed submission preserves local non-sensitive form values and permits retry with the same
  request ID.
- A changed plan or application revision aborts approval without recording a payment.
- Approval detects any pre-existing membership, invoice or payment conflict and fails closed for
  manual review.
- User-facing messages are short, in British English and do not expose Firestore paths, object keys,
  internal IDs or another member's state.

## 11. Interface requirements

All member surfaces follow the rounded member-app exception in `DESIGN.md` section 9. Intro Class
uses the existing yellow/open and green/booked calendar states rather than a new accent. The
conversion notice is a full-width status band with one primary action. Membership selection remains
left aligned and shows venue, plan access and price before payment evidence.

Administrative controls follow the square, ruled BPT admin language: warm canvas, Gi White surfaces,
Mat Ink borders and BPT Purple actions. Status is communicated with text and a left rule, not colour
alone. Loading reserves layout with skeletons; there are no spinners, gradients, generic card grids
or decorative icons.

All new controls preserve visible focus, keyboard operation, labelled native inputs, error summaries,
44px touch targets and mobile overflow protection. File errors are associated with the input and
announced. Busy state disables only the operation being submitted and cannot result in duplicate
requests.

## 12. Compatibility and data operations

Existing classes and sessions without `accessMode` are read as `membership`. Existing booking
schema versions remain unchanged and readable. No migration is required to keep the current
calendar working.

An optional guarded reconciliation may later backfill explicit `membership` values for operational
clarity, but this delivery neither needs nor executes it. Intro classes are designated explicitly by
authorised office users after deployment; titles are never mass-classified.

The backup and privacy inventories add the new conversion, member-notification, membership-
application and evidence metadata collections before production activation. Receipt bytes remain in
private object storage and are not copied into Firestore backups.

## 13. Verification and acceptance

### 13.1 Domain and service tests

- Legacy sessions default to membership access; only explicit Intro sessions accept intro booking.
- Eligibility covers accepted waiver, canonical actor scope, active membership, prior attendance,
  concurrent future booking, venue, capacity and time windows.
- Booking retries are idempotent and never consume capacity twice.
- Membership and course booking behaviour remains unchanged.
- Member and staff check-in both accept a confirmed intro booking while preserving their current
  role, timing and geofence checks.
- The attendance trigger ignores non-intro/correction/missed records and creates one conversion state
  and notice for repeated delivery.
- Adult and guardian recipient resolution is scoped; unresolved recipients fail closed.
- Plan and venue submission validates current server records and permits one pending application.
- Evidence rejects wrong MIME, empty/oversized content, mismatched hash and cross-user ownership.
- Review permissions exclude coaches. Approval is revision-checked and idempotently creates one
  membership, invoice, payment allocation and audit trail.
- Correction/rejection reasons and in-app notices are deterministic and recipient-scoped.

### 13.2 Emulator integration

With synthetic identities and Firebase emulators:

1. create an adult or guardian/student profile with waiver but no membership;
2. create a Town Intro Class with one place;
3. reserve it and prove a competing request cannot exceed capacity;
4. self-check in and, separately, prove coach check-in works under coach-only permissions;
5. observe exactly one in-app conversion notice after trigger retry;
6. select Town and an eligible plan, upload synthetic evidence and submit;
7. prove the pending application does not unlock an ordinary class;
8. approve as administrator and prove the membership and financial records appear once; and
9. prove a coach cannot read or decide the application.

No real member data, bank credential or production project is used.

### 13.3 Playwright

Desktop and mobile projects cover:

- pre-membership calendar discovery and free Intro Class booking/cancellation;
- booked Intro Class self-check-in states;
- in-app notice visibility and recipient isolation;
- Membership participant, venue and plan selection;
- safe PNG/JPEG evidence validation and pending-review state;
- admin Billing approval/correction/rejection; and
- denial of financial UI to coach roles.

The suite uses synthetic fixtures. Screenshots, if requested, contain no real member, receipt or
credential data.

## 14. Delivery boundaries

This specification covers objective 3 only. It does not implement bulk auto-booking, Transit Free,
cross-level exceptions, staff password provisioning, curriculum assignment, Classes / Services
performance work or the course/landing redesign. Those remain separate approved deliveries.

Completion means the implementation and requested verification are committed and pushed to local
and GitHub `main`, with matching SHAs. It does not mean Firebase Functions, Firestore Rules, indexes,
R2 configuration or the web application have been deployed to production.
