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
Historical snapshots do not manufacture new payments, subscriptions or graduation decisions.

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

The 2026-09-20 change is verified by source inspection, deployment compilation and
read-only release checks. Automated tests were not run under the current operator
workflow; older test suites have not been updated for mandatory office approval.
Production approval with a real member remains an acceptance check, not a claimed test result.
