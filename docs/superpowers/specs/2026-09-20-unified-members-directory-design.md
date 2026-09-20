# Unified Members directory and legacy access

Date: 20 September 2026

Status: written specification for user review. The four conversational design blocks were approved, including the correction that requests remain in the existing Enrolment requests section. The user subsequently requested automatic training-group matching and a member-facing form for missing training details, incorporated in section 7.1. This updated document has not yet been approved as the implementation specification. No application, production data or account permissions have been changed by this design work.

## 1. Purpose and agreed boundaries

BPT Jersey is the operational system. Regyfit is a historical source. Every athlete must have one stable BPT member identity through which authorised staff can manage personal details, membership, payments, level, progress, training assignments and account relationships.

Complete the existing canonical Firestore directory rather than introduce another database. A unified database means a consistent operational model with linked records; it does not require placing accounts, payments and athletes in one collection. Preserve the original Regyfit records as evidence while making current member details administrable.

All production interface text and maintained product documentation use British English. Conversation notes may remain in Spanish. Standalone previews use fictional people and payments and remain outside the application.

Existing Members, Families and the imported-member search converge on one Members section. Enrolment requests remains the existing destination for applications and recovery requests. Do not create a second request queue inside Members.

## 2. Existing implementation and integration points

The relevant application currently uses `students`, `studentAdminProfiles`, `users`, `families`, `relationships`, `memberships` and plans, alongside `members` and `regyfitMemberRecords` as legacy sources. Preserve stable IDs and references already used by attendance, bookings, subscriptions and payments.

The current Enrolment requests page is `/admin/members/requests`. It already contains **New enrolments** and **Member access recovery**. `/admin/members/recovery` redirects to `/admin/members/requests#member-recovery`. Reuse that structure, its permissions and its request lifecycle.

The recovery flow already supports Google or email/password, email verification and office approval. Extend it for guardian requests and individual child links. The existing whole-family `replaceTutor` operation does not satisfy the required per-child replacement behaviour.

Existing age classification uses 18 for adulthood. Independent account access from 16 is a separate policy and must not redefine unrelated adult/minor classifications. Existing legacy recovery documentation treats current canonical values as authoritative in some cases; this design replaces automatic source precedence for reconciliation with an explicit administrative decision for every discrepancy.

## 3. Identity, ownership and relationships

- Keep one canonical athlete ID. Account recovery links an authenticated account to that ID; it does not enrol the athlete again.
- One account can access its own athlete profile and several approved child profiles. Memberships, progress and bookings belong to the relevant athlete, not to the currently selected account view.
- Each child has at most one active guardian account. A guardian is required below 16 and optional at 16–17.
- A family view groups existing relationships. It does not create another member directory or imply that everyone with the same email belongs to one family.
- Retain existing family and billing identifiers unless a separately reviewed operation must change them. Per-child access must not be granted merely because an account previously controlled a shared family record.
- A pending guardian or incomplete date of birth does not remove an existing athlete from Members. Missing information is visible for administrative review.

Use validated existing links and reliable unique identifiers to propose matches. Similar names, shared emails, and name plus date of birth can locate candidates but do not independently authorise a merge. Ambiguous or conflicting identity matches require individual review. Identical imports and retries must not create duplicate members, payments or attendance credits.

## 4. Age transitions and guardian changes

At 16, an existing guardian retains access. The athlete may request their own verified account, with administrative approval. The guardian link remains until administration removes it or the athlete turns 18.

From the eighteenth birthday, the athlete is an independent adult. Guardian access to that athlete ends without requiring another administrative decision. Retain the former relationship as history, not as an active permission. Do not add an adult-guardian delegation feature.

Use the confirmed birth date and academy date for this boundary. Authorisation must enforce the boundary when accessing a profile; it must not depend solely on a background job updating a label. Unknown or disputed dates require review rather than an invented birthday or automatic new access grant.

An existing approved personal account continues working. An athlete without one uses **I'm an athlete. Recover my access.** to claim the existing record. The lack of a personal account does not extend the guardian's access. Surface upcoming transitions to staff when account preparation is needed. Preserve the member's plan, paid periods, history and progress throughout.

Replacing a guardian requires an explicit confirmation identifying the child, current guardian and proposed guardian. Approval ends only the former guardian's access to that child. Both accounts retain all other authorised profiles. A request alone does not replace the guardian. Recheck the active relationship when applying the decision so a stale review cannot overwrite a newer relationship.

## 5. Recovery and Enrolment requests

### Applicant flow

The login offers two entries:

- **I'm a guardian. Recover my child's access.** Collect the guardian's details and each child's full name and date of birth. Allow the applicant to include their own athlete profile.
- **I'm an athlete. Recover my access.** Collect the athlete's full name and optional previous email. Age eligibility is checked against the reviewed member record; do not add a mandatory previous email requirement.

Guardian recovery applies to children under 18. Adults request their own access. Matching is internal: the applicant does not receive directory search results or confirmation that a particular child exists before access is approved.

The applicant signs in to an existing account, completes Google authentication, or creates an email/password account and verifies the email. The sign-in email may differ from the optional previous email. Typing a Google address is not proof of account ownership. Passwords remain with Firebase Authentication and are never stored in recovery records, reviewer notes or logs.

A prepared account is not yet an approved member link. Preserve the existing account-bound request and verification process so an interrupted flow can resume without creating duplicate requests or accounts.

### Administrative flow

New applications remain under **Enrolment requests → New enrolments**. Athlete recovery, guardian recovery and guardian replacement use **Enrolment requests → Member access recovery**. The queue identifies the request type and links to the relevant review.

The authorised reviewer checks account ownership, athlete identity and, for a guardian, the relationship. Record the verification basis, reviewer and time. Existing academy records, confirmation through an already trusted contact, or an office identity check can support the decision. A newly supplied email or knowledge of a child's birth date alone cannot establish the guardian relationship. Request more information when the evidence is insufficient; a disputed relationship stays pending.

Preserve current role restrictions. This work does not give coaches access to confidential recovery details, financial records or approval powers reserved for authorised office staff.

Approve only the specifically reviewed profiles. Approval of one child does not imply approval of siblings or the applicant's own athlete profile. A confirmed link may be approved while financial reconciliation remains pending. Rejection does not delete the historical member record.

After approval, provide a link to the corresponding Members record. New enrolments become visible in the directory only once approved. Existing members remain visible even while a recovery request or data review is pending.

## 6. Reconciliation policy

Data review organises duplicates, missing information and conflicting records; it is an administrative work list within Members, not another directory or enrolment queue.

Present the BPT value and legacy value with their sources and relevant dates. No source wins by default. For each discrepancy, administration must explicitly retain a value, accept a verified correction, or establish that the values represent different historical periods. Record the evidence, reason, author and decision time, preserving both originals.

Current operational data remains unchanged until a decision is applied. This temporary preservation does not make BPT the automatic winner. A member's reconciliation cannot be closed with unresolved discrepancies. Missing details remain visibly unknown; required missing information prevents the particular operation that needs it.

Keep account access, identity reconciliation and plan confirmation as separate states. Do not revoke already confirmed access or suspend a valid confirmed plan merely because an unrelated historical field needs review.

## 7. Plans, payments and training history

The member record shows the subscription, membership state, confirmed period and relevant booking permissions. An old active flag is insufficient to establish current coverage. Recovery does not automatically reactivate expired or suspended memberships.

To recognise an existing paid period, administration confirms the athlete, matching BPT plan, covered dates and original payment evidence. Preserve date-boundary semantics from the existing paid-period linking flow. Linking the previous payment creates neither a new invoice nor a second charge. Incomplete evidence leaves the plan awaiting review. Missing data is not a debt or a zero amount.

Display available payment dates, amounts, descriptions, covered periods, provenance and confirmation state. Preserve uncertain original values rather than silently parsing them into authoritative amounts or dates. Correct historical movements using traceable adjustments through the appropriate billing operations; do not silently rewrite the original transaction.

Guardian changes and adulthood retain who made historical payments and the athlete's already paid period. Future billing responsibility is reviewed separately. Payment authorisations are not automatically transferred, cancelled or recreated by changes in profile access.

Retain belt, stripes, level dates and training progress. Reconcile a reviewed historical balance and the attendance cut-off before combining them with new BPT activity. Do not fabricate dated attendance events from an aggregate count. Count each event once and identify incomplete coverage explicitly.

Derive group and class eligibility automatically when confirmed age, centre, level and the configured class rules produce an unambiguous match. A belt alone does not establish all training assignments. Preserve existing confirmed assignments and specific permissions; send ambiguous or conflicting mappings for administrative review. Booking requires the applicable confirmed plan and normal class permissions, even when profile access has already been approved.

### 7.1 Complete your training details

Provide **Complete your training details** on the athlete's member interface and on an authorised guardian's selected child profile. Surface it when information required to determine the training group or subscription is missing or unconfirmed. Keep the rest of the approved profile and confirmed history available. Profiles with complete, confirmed details and valid coverage should proceed directly to their eligible sessions without an unnecessary completion step.

Prefill available birth date, training centre and historical plan/frequency, identifying information that needs confirmation. Ask for missing or unconfirmed values rather than requiring the member to re-enter a complete legacy record. Use the date of birth to calculate age; do not ask the member to type an age that will become stale. Confirm the current training centre, Town or West, and the desired training frequency or pay-as-you-go preference where it is needed to distinguish plans. Existing contact or training-time fields from the recovery flow can be reused when their operational purpose requires them; they are not substitutes for plan eligibility.

Use current configured class age ranges, centre, discipline, level restrictions and existing explicit permissions to derive eligible groups. An unambiguous match from confirmed data can be assigned automatically. If input data still needs verification, display a calculated proposal until verification is complete. Multiple ambiguous matches or no matching group require review; do not select the first record arbitrarily. Recheck eligibility at the session date so birthdays are handled correctly.

Training age ranges, subscription participant types and account independence are separate rules. The source includes configurable class presets such as 4–7, 8–11, 12–15 and 16+, while the current subscription categorisation treats adults from 18. Do not hard-code the presets as universal rules or silently equate a 16+ training group with an adult account or adult subscription. The implementation must use and reconcile the actual configured catalogue and class restrictions consistently across assignment and booking.

Filter subscription options by the current authorised catalogue, eligibility, site coverage and frequency. Preserve an existing confirmed subscription if compatible. Where one option remains, suggest it automatically. Where several options fit, let the member choose their preferred compatible option with its current price, frequency, sites and billing period visible. Do not silently upgrade, downgrade or charge a member. Retired plans may remain part of history but must not be offered as new selections. If no option fits, allow submission for BPT review instead of trapping the member behind an empty required selector.

A member's correction to a recorded birth date or centre, or a requested change of subscription, does not silently overwrite confirmed data or an existing paid period. Preserve the original and route discrepancies through the agreed administrative review. Training preferences and self-declared details do not prove historical payment. Level changes remain a staff correction workflow; the member may flag an error rather than award their own progression.

Once identity access is approved, missing training-data review belongs to **Members → Data review** on the same member record. If an existing enrolment or recovery request is still awaiting completion, attach the submitted details to that request in **Enrolment requests**. Do not create a duplicate access request or a separate member directory.

For uncertain legacy coverage, submitting the form leaves the subscription under review. Once the required details and applicable subscription coverage are confirmed, the calendar offers eligible sessions, subject to normal capacity, booking windows, frequency limits and plan conditions. A calculated group or selected plan alone does not enable booking, establish a paid period or authorise a new charge. Pay-as-you-go options retain their own confirmed billing rules rather than inventing a prepaid period.

The standalone preview includes **06 · Training details**: a fictional member with prefilled details, a calculated group, compatible plan choices, a no-match submission path and a design-only preview of booking access after BPT confirmation. The catalogue and dates shown are examples, not a production-data audit or current price quotation.

## 8. Unified Members interface

Members has three internal views:

| View | Purpose |
| --- | --- |
| All members | Existing members and approved new enrolments in the same searchable directory. |
| Families | Group the same profiles by their active guardian/account relationships. |
| Data review | Find and resolve identity, relationship and historical-data issues. |

The initial directory shows name, age, level, group/location, plan and status, guardian/account, and review indicators. Search supports member name, membership number and guardian; the preview includes status and source filters. Searching historical data leads to the canonical record or its review case rather than another editable copy.

Every view opens the same member record:

| Tab | Contents and actions |
| --- | --- |
| Overview | Personal details, membership summary, level, group, account and outstanding issues. |
| Plan and payments | Current plan, confirmed period, historical payments, source review and traceable corrections. |
| Level and progress | Level, stripes, training history, group and class assignments. |
| Family and access | Own account, guardian, permitted profiles, guardian replacement and age transitions. |
| History | Source links, administrative decisions and changes. |

Current details are editable by authorised administrators. Historical originals remain available as evidence. The interface offers the appropriate correction workflow instead of making the whole member record read-only.

Retire the separate Families and imported-search workflows only after their functionality is available here. Old links should lead to the equivalent Members view or record with the same authorisation checks. Retain the existing Enrolment requests route and its two request types; a link from Members may open a specific request there without creating another queue.

## 9. Migration, errors and operational boundaries

Begin implementation work with a read-only inventory of sources, existing links, IDs, missing fields, duplicate candidates and archive coverage. Distinguish document counts from people. Earlier documented counts are not a current census. Existing bounded archive readers and snapshot histories are not evidence of complete lifetime payment or attendance coverage; establish actual limits and gaps before making completeness claims.

Generate a reviewable change preview before writing. It identifies the athlete, source references, proposed links, discrepancies and affected operational references. Reliable, compatible matches may be presented for batch review, but ambiguous identities and all discrepancies retain their required explicit decisions.

Apply changes in bounded, resumable operations with stable source links and operation identifiers. Recheck relevant records and permissions at application time. If records changed after review, refresh the review instead of silently applying stale decisions. A failed operation must not leave account access granted to the wrong athlete or lose a paid period. Report which operations succeeded and which require attention; retries must not duplicate them.

Preserve originals, record before/after values and keep enough operation provenance to diagnose and correct a change. Reversing an operation must not overwrite later legitimate member activity. Keep existing operational paths until canonical readers and authorised access have been reconciled. Do not perform destructive archive cleanup as part of this work.

The implementation plan should sequence: identity/reconciliation foundations; account and guardian lifecycle; then unified operational views and retirement of redundant navigation. New guardian permissions must be enforced by the server and all affected readers, not solely by interface controls.

## 10. Validation and review artefacts

The prototype is `/root/compartido/bpt-members-propuesta-v1.html`. It is standalone, uses embedded assets and fictional data, and makes no backend requests. Authentication, approval, edits and payments are demonstrations. The interview record is `/root/compartido/bpt-members-decisiones.md`.

Validation so far consists of code/document inspection and scoped prototype inspection. Desktop/mobile preview work, including the training-details screen, used fictional data. No production inventory has been performed for this design and no runtime migration guarantees have been established.

Follow the repository's explicit preference: no automated test suites, broad lint/type checks or builds are required or authorised by this design review. Use code inspection and focused review. Any later requested tests or authorised deployment checks belong to their approved execution scope.

Before a real migration, its read-only inventory and change preview must establish source coverage, unique identity links, preserved operational references, payment attribution and unresolved cases. After applying reviewed operations, reconcile the resulting IDs and counts with that preview and record exceptions. These are operational reconciliation steps, not a claim that production was verified in this design session.

The next step after approval of this written specification is an implementation plan for separate review and selection of its execution method. Approval of this document does not itself execute a migration or deployment.

## References

- `docs/legacy-member-recovery.md`
- `docs/superpowers/specs/2026-09-19-member-unification-s1-identity-design.md`
- `docs/superpowers/specs/2026-09-20-member-profile-live-design.md`
- `apps/web/src/app/admin/members/requests/page.tsx`
- `apps/web/src/app/admin/members/recovery/page.tsx`
- `apps/web/src/app/login/recover/recovery-form.tsx`
- `packages/domain/src/profiles/profile-contracts.ts`
- `packages/domain/src/schedule/schedule-contracts.ts`
- `packages/domain/src/schedule/member-calendar-contracts.ts`
- `packages/domain/src/memberships/plan-contracts.ts`
- `packages/domain/src/members/enrolment-request-contracts.ts`
- `apps/web/src/app/enrol/plan-choices.tsx`
