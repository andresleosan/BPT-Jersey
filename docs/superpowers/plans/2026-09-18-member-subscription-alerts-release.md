# Member subscription alerts — delivery notes

Implemented on `feature/member-subscription-alerts`, based on `5e324ec53a8601b4179124b01020bce7a22e09fe`. This task does not merge to main, push to GitHub, deploy Firebase, or publish the web app.

## Behaviour

- Members directory and canonical search expose the subscription editor. It edits the managed plan and end date, validates age and Town/West on the server, and supports a calendar-month extension. Cancelled subscriptions cannot be changed; inactive members must be reactivated first.
- Overview has an independent shared administrator inbox, including when the rest of the dashboard is unavailable. Owners and administrators with active accounts can filter all/unread notifications, read older pages, mark notices read, and open the relevant workspace.
- An expiry notice offers **Extend 1 month** and **Keep end date**. Extension starts from the later of now and the existing expiry, clamps month-end dates, and leaves the payment/invoice records unchanged. A stale or already-resolved reminder cannot renew another period. Retries reuse request receipts; concurrent edits use the membership's updated timestamp.
- Expiry reminders are internal notifications. The scheduler checks every minute; an open Overview refreshes each minute and on window focus. Scheduler/network latency can delay appearance beyond exactly 24 hours before expiry. A trailing 24-hour window catches late edits and brief outages.
- Subscriptions with no end date produce no expiry notice until an administrator sets one. No historical expiry or billing date is guessed.
- The inbox includes new registration submissions/approvals/returns/withdrawals/failures, newly created members, subscription creation/status/plan changes, payment and invoice events, and quorum-cancelled classes. Existing historical audit events are not backfilled. Read-only audit events are excluded.
- Notification read/resolved state is shared across administrators in one academy. Direct browser access to inbox/receipt collections remains denied; callable access requires App Check and current administrator authority.

## Release order

1. Deploy `firestore.indexes.json` and `firestore.rules`; wait for the membership `endsAt` collection-group index and unread-notification index to become ready.
2. Deploy the four callables `listMemberSubscriptions`, `updateMemberSubscription`, `listAdminNotifications`, `updateAdminNotification` and the three background functions `subscriptionExpiryNoticeWritten`, `subscriptionExpiryNoticesSchedule`, `adminOperationalNotificationCreated` using the repository's generated Functions artifact. The deploy creates the corresponding managed scheduler job and Firestore event triggers.
3. Build/publish the frontend with the existing production Firebase configuration. The local build used synthetic public configuration only and must not be published as the production artifact.
4. Operational verification after deployment should confirm that the managed schedule is enabled, an active administrator can access the new callables, and an eligible subscription with a known end date produces its inbox notice. These production checks have not been performed here.

No migration, email provider, browser notification permission, automatic renewal, or payment charge is introduced.

## Local validation

Per the user's request, no automated tests, emulators, browser test suite, Cronos workflow, or external review agents were run.

- Domain and Functions TypeScript checks.
- Web route generation and TypeScript check.
- ESLint with zero warnings on changed TypeScript/TSX files.
- Prettier check on changed TypeScript/TSX/CSS/JSON files.
- Production Next.js static build with synthetic Firebase public settings.
- `node apps/functions/scripts/build-deploy-artifact.mjs` (compiles domain and Functions and prepares runtime imports/dependencies).
- `git diff --check` and scoped source/diff inspection.

This validates compilation and static consistency; runtime behaviour against deployed Firebase remains unverified. Generated build outputs and dependencies are excluded from the commit.
