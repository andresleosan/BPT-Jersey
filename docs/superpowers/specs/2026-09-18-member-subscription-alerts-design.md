# Member subscriptions and administrator notifications

## Scope and decisions
Administrators and owners can edit a canonical member's subscription plan and end date from Members and the canonical search result. Active plans are filtered by age and Town/West on the server. A one-month extension adds one calendar month to the later of the current expiry and now, clamping month-end dates. No payment is charged, invoice changed, or automatic renewal enabled. Cancelled subscriptions remain terminal; creating a subscription continues through the existing workflow.

The user confirmed the administrator is the recipient and decision maker, from Overview. Notifications are internal to the administrator Overview; this does not provision email or browser push. A scheduled Firebase function checks each minute and creates one notice per membership/end-date when the 24-hour threshold is crossed, with late catch-up for the previous day. Scheduling and network delivery can add latency; this is not a guarantee to the second. Leaving a subscription as it is acknowledges that expiry notice without changing the membership. Changing its end date resolves the old notice; the next period gets a separate notice.

## Architecture
Use the existing canonical membership record and managed plan catalogue. Add dedicated administrative callables instead of broadening client membership permissions. Changes use Firestore transactions, expected updatedAt concurrency checks, a request receipt for retry safety, and audit events. The public membership schema stays unchanged.

A server-owned adminNotifications collection holds an academy-wide inbox, with read and resolved state shared between office users. Only active owners/administrators can access its callables. Direct browser access stays denied. A minute scheduler and membership change trigger maintain expiry notifications. A separate audit-event trigger adds registration, membership, payment, and cancelled-class operational notices; it ignores read-only audit events and deduplicates on audit ID. Overview shows an independent panel, including when other dashboard sources fail, with pagination, unread filtering, timestamps, and contextual links/actions.

## UX
Members gets a Subscription action per canonical member; the same editor is embedded in the canonical search detail. Existing plan, status, end date and available plans are visible. Saving a plan/date and extending a month are explicit actions with busy/error/success states. Indefinite subscriptions display No end date and have no expiry alert until an end is set. Imported Regyfit source snapshots remain historical, not an editable second membership system.

The Overview inbox displays expiring subscriptions alongside new registrations, membership changes, payment activity and cancelled classes. Expiry notices offer Extend one month and Leave as is. All notices can be marked read and opened in their associated workspace. Stale reminders cannot extend a replacement period.

## Validation and delivery
Per user instruction: no Cronos workflow, no automated test suites or test-review loop. Verify types, targeted lint/format, production web compilation, and Functions artifact build. Record limitations honestly. Work in an isolated branch; no production deployment or unrelated main changes in this task. Release requires the new callables, background functions and indexes before publishing frontend. No migration, payment-provider action, credential changes, or new public service is needed.
