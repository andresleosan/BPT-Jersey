# Add a child / train yourself as an enrolment, and account people — design

Date: 2026-09-30 · Owner request (Luis) · Status: design approved in chat, pending spec review

## Goal

1. A member who already has an account adds a child (or starts training themselves) through the
   **same enrolment form** new members use: their own details prefilled, the child's details, the
   waiver, a plan per person (Free Trial when no paid plan is chosen), and the office approves it in
   **Enrolment Requests** like any other enrolment.
2. Every account shows **exactly the people who train on it** — the holder when they train, and
   each child — and each person sees the sessions their own age and subscription allow. Today a
   parent who trains and has children who train loses either themselves or the children.

## Decisions (traceable)

| # | Decision | Who / where |
|---|---|---|
| D1 | "Add a child" from My plan opens the full enrolment form: parent prefilled as guardian and as the child's emergency contact, child's details, waiver, plan choice. | Luis, request 2026-09-30 |
| D2 | No paid plan chosen for a child → Free Trial. | Luis, request 2026-09-30 |
| D3 | The request arrives in **Enrolment Requests** with all its data; the office approves it there. | Luis, request 2026-09-30 |
| D4 | Approve links the child to the parent's account with full guardian rights: book, change plan, everything a guardian does. | Luis, request 2026-09-30 |
| D5 | Registration offers three explicit options: **Just me**, **My child or children**, **Me and my child or children**. Same logic from My plan for an existing account. | Luis, question round 1 |
| D6 | Children added with the old broken flow are deleted by Luis (Delete account) and re-added with the new flow. No repair of the old path. | Luis, question round 1 |
| D7 | No separate "accept the waiver afterwards" step for an added child: the waiver is inside the add-child form. | Luis, question round 1 |
| D8 | "Train yourself" moves to the same enrolment flow; the old Plan requests system (dialog, office card, three callables, service, client) is removed. | Claude, approved design §7 (follows from D5) |
| D9 | Existing-member mode reuses `/enrol`; no second form. | Claude, approved design (approach) |
| D10 | In existing-member mode the holder's name, email and phone are prefilled and read-only (changed in Settings); the child's emergency contact is prefilled and editable. | Claude, approved design §2 |
| D11 | Only sensible options are offered: a holder who already trains sees only "Add a child"; a guardian who does not train sees all three. | Claude, approved design §2 |
| D12 | The request shows an "Existing member" tag in Enrolment Requests; Approve, Request changes and Deny Enrolment work as for any request. | Claude, approved design §4 |
| D13 | Approving an existing member's request never creates a second account or family: children join the holder's existing family (created only if there is none); a holder who starts training gets their own student on the same account. | Claude, approved design §5 |
| D14 | Who appears on an account is decided by the account's profile list (`listMyMemberProfiles`: `self` = holder trains, `guardian` = a child), **never by the role claim**. One shared web loader used by the calendar, Progress and the sibling check-in. | Luis, message 2026-09-30 ("differentiate the tutor who does not train from the member who trains"); Claude design |
| D15 | Each person sees sessions by their own age band and subscription/trial (server rule, unchanged). | Luis, message 2026-09-30 |
| D16 | `/account/waiver` stays for pre-online-enrolment members (D12 of 2026-09-23); it is simply not needed for children added through the new flow. | Claude, approved design ("what I don't touch") |
| D17 | The Plan requests card must be empty before the deploy that removes it. | Claude, approved design §7 |
| D18 | Verification: no test suites (repo rule). Acceptance check in the local emulator with three synthetic accounts (tutor who does not train + children; member who trains + children; member who trains alone), then Luis checks in production. | Luis, message 2026-09-30 ("make sure it works"); AGENTS.md |

## Current state (facts from code, 2026-09-30)

- **Old add-child flow** (`74cd929`): `apps/web/src/app/account/membership/plan-person-request.tsx`
  asks only name, date of birth, centre and times; writes `academies/{a}/memberPlanRequests/{id}`
  via `requestMemberPlanPerson`; the office decides it in "Plan requests"
  (`admin/members/requests/plan-requests-panel.tsx`, `decideMemberPlanRequest`), which adds the child
  to a family with a fixed Free Trial and promotes `adultStudent` → `guardian`. No waiver, no plan,
  no parent data.
- **People on an account, web side**: the calendar picks its people from the **role**
  (`lib/calendar/firebase-calendar-repository.ts:76-79`): `guardian` → `getFamily()` (children only,
  `getGuardianFamily` keeps `via === "guardian"`), otherwise `getClientProfile()` (holder only).
  Progress does the same (`account/progress/page.tsx:11`, `member-progress.tsx:318-348`), and the
  sibling check-in prompt runs only for `guardian` (`calendar/member-calendar.tsx:436`).
  My plan (`account/membership/page.tsx:80-110`) already does it right: `listMyProfiles()` →
  holder via `getClientProfile()` + children via `getFamily()`.
- **Stale role**: approval changes the claim server-side, but the browser keeps the old ID token
  (up to about an hour), so which half of the family is missing depends on when the member signs in.
- **Server side is per person, not per role**: `requireStudentScope` → `memberAccess.authorise`
  (self link or current guardian link), memberships scoped by `memberStudentIds`, sessions filtered
  by `canViewMemberSession` with the person's date of birth and plan
  (`schedule/member-calendar-week-callables.ts`). No change needed there.
- **Enrolment**: `/enrol` has three steps (details + minors + waiver; plans with Free Trial default;
  payment and review). Submission refuses an account whose hold is `approved`
  (`canSubmitEnrolmentRequest` allows only no hold or `withdrawn`). Approval
  (`members/enrolment-approval-service.ts`) always creates the account-level records
  (`createAdminAdultForAccount`, `saveGuardianProfile`, `createFamily`), which conflict for an
  existing member. `registration.complete` applies level and subscription/trial per student in
  `enrolmentStudents(record)` order and works for any student list.
- **Waiver**: an approved enrolment carrying the current version counts as accepted for its
  `approvedStudentIds` (`consents/enrolment-waiver-acceptance.ts`), so approved children need no
  separate acceptance.

## Design

### 1. Three choices at registration (`/enrol`, step 1)

Replace the "adult student / guardian" radio and the "I also want to train" checkbox with one radio
group: **Just me** · **My child or children** · **Me and my child or children**. They map to the
existing fields (`applicantIsStudent`, minors ≥ 1); the request contract does not change for new
members.

### 2. Existing-member mode

- My plan's "Add someone" section shows buttons that link to `/enrol?for=child`, `/enrol?for=self`
  or `/enrol?for=both` (D11 decides which are shown, from the profile list).
- `/enrol` with a signed-in account that already has a profile list enters existing-member mode:
  - holder's name, email, phone from `getClientProfile()` / the guardian profile, read-only;
  - the choice radio shows only the options allowed by D11, preselected from `?for=`;
  - each child's emergency contact is prefilled with the holder's name and phone
    (relationship "Parent"), editable;
  - plans and payment steps are unchanged.
- The submission carries `existingMember: true`.

### 3. Server: accepting the request

- `enrolmentRequestSubmissionSchema` / record gain optional `existingMember: true`.
- `submitEnrolmentRequest`: when `existingMember` is set, the server **verifies** it — the account
  has an active client document and at least one profile — and then:
  - replaces the applicant's name, email and phone with the stored account values (the client's copy
    is not trusted);
  - refuses `applicantIsStudent: true` if the holder already has a `self` profile;
  - allows the request even when the hold is `approved`, while still refusing a second **open**
    request (`submitted`/`returned`).
- Everything else (waiver hash, plan selections, payment proof) is the existing path.

### 4. Office

`Enrolment Requests` lists it like any enrolment, with an **Existing member** tag on the card and
in the detail panel. Approve / Request changes / Deny Enrolment behave as today.

### 5. Approval of an existing member's request

In `enrolment-approval-service.ts`, when `record.existingMember`:

- skip `saveGuardianProfile` when the client document already exists;
- holder starts training (`applicantIsStudent`): `createAdminAdultForAccount` with
  `existingClientAccount: true` (the path "Train yourself" already used);
- children: promote the claim to `guardian` (read back, restore on miss — existing
  `promoteClaim`), then add each child to the holder's family: `getGuardianFamily` → `updateFamily`
  `addStudent` when a family exists, `createFamily` only when none; a retry matches an existing
  child by normalised name + date of birth instead of writing it twice (logic lifted from the old
  family-plan service);
- `registration.complete` (level + subscription or Free Trial) and `completeApproval`
  (`approvedStudentIds`) unchanged — this is what makes the waiver count for the new children.

### 6. People on an account (the bug fix, D14–D15)

- New `apps/web/src/lib/account-people.ts`: `loadAccountPeople()` →
  `{ studentId, fullName, via: "self" | "guardian", dateOfBirth, trainingCenter }[]`, built as My plan
  does today (`listMyProfiles` + `getClientProfile` when a `self` profile exists + `getFamily` when a
  `guardian` profile exists). My plan switches to it too, so there is one implementation.
- The calendar repository, Progress and the sibling check-in use it instead of the role.
  A `teenStudent` still sees only themselves (their profile list has only `self`).
- If the profile list contains children but the token's role is not `guardian`, the loader
  refreshes the ID token once, so pages that still read the role see the new one.
- Sessions per person: unchanged server rule; the calendar now always asks for the right person.

### 7. Removal

Delete `plan-person-request.tsx`, `plan-requests-panel.tsx`, `lib/family-plan-client.ts`,
`functions/src/family-plan/*`, their exports in `functions/src/index.ts`, the panel's use in the
requests page and its CSS. The deployed functions `requestMemberPlanPerson`,
`listMemberPlanRequests` and `decideMemberPlanRequest` are deleted with
`firebase functions:delete` (a partial deploy does not remove them). The `memberPlanRequests`
collection is left as history.

## Out of scope

- Changing server-side eligibility rules (age bands, plans, trials) — they are correct.
- Repairing children added with the old flow (D6).
- Changing `/account/waiver` for legacy members (D16).

## Delivery

- Web: push to `main` (Cloudflare Pages).
- Functions to deploy (with Luis's OK): `submitEnrolmentRequest`, `approveEnrolmentRequest`,
  `listEnrolmentRequests` and `getEnrolmentRequestDetail` (for the tag). Functions to delete: the
  three above (§7), after the Plan requests card is empty (D17).
- Order: push → deploy functions → delete old functions.

## Verification (D18)

Local emulator, synthetic data only:

1. **Guardian who does not train + 2 children**: calendar and Progress show both children, not the
   holder; each child sees the sessions of their band and plan.
2. **Member who trains + 1 child**: shows "You" and the child; each sees their own sessions; booking
   works for both.
3. **Member who trains alone** uses Add a child → form prefilled → request in Enrolment Requests
   with "Existing member" → Approve → without signing out the account shows "You" + the child, the
   child has no waiver block, and has a Free Trial (or the chosen plan).
4. A guardian who does not train uses "Train yourself" → approved → shows "You" + the children.

Then Luis repeats case 3 in production with a test child.
