# Legacy member access recovery

Members start at `/login/recover`, also linked from member sign-in. They enter their full name and previous email, then continue with Google or an email/password account. Existing Firebase accounts can sign in or reset their password. Google sign-in supports any account accepted by the configured Google provider.

The initial response is intentionally identical whether a record matches or not. Automatic recovery requires a unique legacy record matching the supplied name and previous email, plus server-confirmed ownership of that same verified email. A new email, ambiguous match or conflicting ownership needs office identity review at `/admin/members/recovery`. Approval requires selecting the source record and explicitly confirming independent identity verification. The office queue shows only unexpired, verified, account-bound requests awaiting review, with the oldest account bindings first. Resolved requests are excluded; resolving a page and refreshing reveals the next pending requests.

Required missing profile details are requested only after identity authorization. Known children use the existing guardian process. Inactive or suspended memberships require office follow-up; recovering identity never renews or reactivates membership.

## Data preservation

Recovery reuses an existing canonical student when supported by validated identity reservations. New canonical records retain an immutable association with the original Regyfit source. A transaction writes the account association, identity reservations, directory state, integrity evidence, audit event and recovery receipt together. Concurrent claims and retries cannot create a second source association. Auth claims are updated after durable linking and can be repaired by retrying.

Original imported records and their historical membership, payment, attendance and progress data are preserved. This feature does not manufacture canonical financial or membership records from imported history. Existing workflows remain responsible for those records.

Only the opaque recovery ticket is saved in browser session storage. An unbound ticket expires after 24 hours; authentication binds it to one account and sets its expiry to 30 days after the initial account binding for office review. Subsequent attempts do not extend that expiry. The server enforces expiry. Restarting or completing the flow removes the browser ticket. No password or profile data is stored by the recovery page.

## Release prerequisites

Implementation and local tests do not deploy the feature. Use the existing release process for the frontend, five callable functions, Firestore rules and the recovery queue index together. Deploy the `memberRecoveryRequests` compound index (`status`, `accountVerified`, `expiresAt`, `createdAt`, all ascending) and wait until it is ready before opening the office queue. The verification marker is owned by the server and populated from Firebase Auth; development tickets created before this feature must complete recovery once to enter the queue.

- Set the Functions `ACADEMY_ID` explicitly to the intended academy; recovery has no demo fallback.
- Use the existing directory identity and integrity secret bindings and version labels. Never copy secret material into source, documentation or browser configuration.
- The canonical directory state and signed restore guard must already be initialized and ready. Recovery does not initialize or migrate production directory state.
- Configure Google and email/password providers, authorized domains, verification-email settings and App Check for the existing website using the standard environment procedure.
- Production callable origins are `https://bptjersey.com`, `https://www.bptjersey.com` and `https://bptjersey.pages.dev`.
- Direct client access to recovery requests, rate-limit records, write receipts and source links is denied by Firestore rules. The office views them only through authorized callables.
- Source/canonical scans fail closed above 1,000 records. This implementation is sized for the observed aggregate of 249 imported records; larger datasets need indexed matching before raising limits.
- Expiry checks do not delete stored requests. Apply the academy's approved retention procedure; this change provisions no remote TTL policy.

## Local verification

Tests use synthetic records and the `demo-bpt-jersey` project only. Production accounts and real verification emails are unnecessary for verification.

- Member recovery and administrative review component tests cover authenticated state transitions and identity confirmation.
- Service/callable tests cover unique matches, changed email, verification, expiry, rate limits, role checks, ownership conflicts, missing fields and claim repair.
- `qa/integration/member-recovery.test.ts` exercises competing account claims against the Firestore emulator and asserts one source link, one canonical student and one state revision. It also seeds 425 requests to verify queue filtering and progress through more than 50 actionable requests.
- `qa/rules/member-directory-boundary.test.ts` checks that every browser role is denied direct access to the new collections.

See the implementation plan in `docs/superpowers/plans/2026-09-18-legacy-member-recovery.md` for final verification evidence and branch status.
