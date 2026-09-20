# Legacy member access recovery

Members start at `/login/recover`, enter their full name and optionally their old email,
then sign in with Google or create an email/password account. The public response does
not reveal whether a member was found. Passwords remain in Firebase Authentication.

Recovery searches the academy's Regyfit archive (`regyfitMemberRecords`), legacy directory
(`members`) and current profiles (`students`). Original source records are retained.
Sources are joined only through existing links, validated administrative identity keys,
migration decisions or an explicitly reviewed compatible identity. Name alone never
authorises a merge. Each collection is bounded at 1,000 records.

## Office approval

Every new recovery needs administrator or owner approval, including requests using the
original email. Account creation binds the request before sending verification email.
Account-bound requests appear under **Enrolment requests → Member access recovery**;
the navigation shows a recovery count, refreshed once per minute while visible. The
previous `/admin/members/recovery` route opens the same review component.

The queue includes email verification pending, awaiting review and additional member
details needed. Unbound public attempts, expired, rejected and completed requests are
excluded. The oldest 50 actionable requests are shown; resolve and refresh to continue.

The reviewer can search all three sources by name, email or membership number, select
the correct original record and independently confirm identity. Email ownership must
be verified before approval. Existing tickets refresh their candidates when opened.
If more than 20 candidates match, narrow the office search. Missing personal details
are completed by the member after identity approval and retained on the server for retry.

Known minors retain the guardian process. Inactive/suspended canonical memberships are
not reactivated. Where a current active profile exists, it is authoritative over an
older archive's membership status. Source conflicts require office reconciliation.

## Preserving access and history

Linking preserves existing student and family IDs, so attendance, levels, payments,
subscriptions and other records already attached to those IDs stay attached. A new
canonical profile is created only when no existing identity or conflicting similar
profile is found. The transaction records source links, identity reservations, the
directory state, integrity evidence, audit event and a recovery receipt together.

Replacing a previously linked adult account requires a new reviewed request and is
limited to a sole adult account/family. It preserves the student and family, associates
the new verified email, marks the old client profile inactive, removes its old identity
reservation and moves source links. Refresh sessions for the old account are revoked
after the transaction; retries repair session revocation and new account claims.
Staff accounts and shared/guardian families cannot be transferred through this flow.
Completed tickets cannot be replayed to reclaim a replaced account.

Members can open **Progress → Your previous membership history** to view their linked
archive's graduation progress, membership plan, attendance and payments. Loading is
on demand. The server resolves the current member from authenticated ownership and
returns only those historical fields; it accepts no client-supplied member ID.
Historical snapshots do not automatically create current subscriptions, payments or graduation decisions.

## Linking an existing paid period

After approval, **Review previous subscription** opens the linked archive's current
subscription editor. The same editor is available from **Previous member records**.
If the member has no canonical profile yet, office registration creates one with a
persistent source link; later recovery reuses that profile. Stored archive fields
from the old application are normalised before validation and never become new credentials.

For a member without a current subscription, select the matching current plan and
**Previously paid: link existing payment**. Recorded dates prefill the form; the
archive's final paid day is included by setting the exclusive end to the next day.
The administrator confirms the original payment, plan and dates. Missing dates must
be supplied from office evidence. The server verifies the archive-to-student link,
rejects conflicting links and prevents duplicate active subscriptions or duplicate retries.

This creates a current subscription and an audit reference to the original archive,
without creating another invoice or payment. The original payment and progress history
remain intact. Legacy import snapshots do not block this canonical subscription.
Booking, waitlist entry and offer acceptance use the class start time to check the
paid period. Member calendars and office registration report classes outside that period;
existing bookings and attendance remain visible. Plan, capacity, financial standing,
consent and administrator-assigned group rules continue to apply.

The archive's active flag is insufficient to infer payment coverage. Read-only inspection
found 87 records within their recorded dates, 150 expired periods and 12 active flags
without complete dates. These are archive record counts, not distinct verified members.
Office confirmation is required; deployment does not bulk-activate those records.

## Deployment and validation

Deploy the frontend and these six callables together: `beginMemberRecovery`,
`completeMemberRecovery`, `listMemberRecoveryRequests`, `getMemberRecoveryDetail`,
`reviewMemberRecovery`, `getMemberRecoveryHistory`. New source associations use
`memberRecoverySourceLinks`; direct browser access is denied, as for existing recovery
collections. The existing `memberRecoveryRequests` compound index on `status`,
`accountVerified`, `expiresAt`, `createdAt` supports both queue queries.

Functions must use the intended `ACADEMY_ID` and existing directory identity/integrity
secret bindings. Canonical directory state and the signed restore guard must already
be ready. Google/password providers, allowed domains and enforced App Check remain in
effect. No source data migration or record deletion is part of deployment.

Only an opaque ticket is saved in browser session storage. Public tickets expire after
24 hours; account binding sets a fixed 30-day office review period. Restarting clears
the browser ticket. No remote TTL policy or automatic record deletion is introduced.

On 2026-09-20, read-only production counts found 243 legacy directory records, 249 archive
records and 3 current students. Six of seven recovery attempts were still unbound;
one was linked. These counts overlap and are not distinct member counts.

The recovery and subscription change was tested at the user's explicit request.
Focused unit/component tests cover mandatory approval, optional old email, verification
retries, source parsing, conflicting ownership, paid-period confirmation and date boundaries.
Firebase Auth and Firestore emulator scenarios cover new Google and password identities,
name-only recovery, queue approval, subsequent sign-in with member claims, preserved student
and family IDs, progress/history access, idempotent paid-period linking, and booking/waitlist
refusal outside the paid period. Email verification is simulated; email delivery and a real
Google browser redirect are not covered. Browser visual/performance checks remain unmeasured.
No real member was approved or altered as part of these tests.

Deploy the subscription connection with `resolveMemberSubscriptionProfile`,
`registerImportedMemberForOffice`, `manageMemberSubscription`, `listMemberSubscriptionBilling`,
`getMemberRecoveryDetail`, `requestBooking`, `joinWaitlist`, `issueNextWaitlistOffer`
and `acceptWaitlistOffer`, plus the frontend. No additional rules or indexes are required.
