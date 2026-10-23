# Registration notices that ask for action and close themselves

Date: 2026-10-23. Approved by Luis in chat ("aprobado") on the design proposed the same day.

## Why

The office says new registrations "don't come in properly" in the notifications, so the
owner/administrator do not act on them. A production reading (read-only, 2026-10-23) shows
delivery works: 141 of 143 enrolment requests have their «New registration awaiting approval»
notice (the 2 without one are from September), and the trigger `adminOperationalNotificationCreated`
answered 988 × 204 and 9 × 500 (OOM on 2026-10-10, retried) in 14 days.

The failure is presentation and lifecycle:

- 1,241 notices and **none is ever resolved** except 11 subscription-expiring ones. Deciding a
  request leaves its «awaiting approval» notice exactly as it was.
- 1,220 of 1,241 are already **read**. Opening a notice is the only thing that changes it, so a
  pending registration looks the same as the 149 already decided.
- Registration noise produced by the office's own actions: 315 «Member added», 134
  «Registration approved», 40 «Registration approval needs attention», 9 «withdrawn», 5
  «returned».
- The notice links to the queue (`/admin/members/requests`), not to the request.
- Example: the request submitted 2026-10-19 19:46Z (one minor, west-teens) is still `submitted`;
  its notice was read 2026-10-20 06:06Z and then looked like every other one.

Success: when the owner/administrator open the notifications, they can tell at a glance which
registrations are still waiting, reach the request in one click, and the notice disappears from
"waiting" by itself once somebody decides the request.

## Goals

1. An open registration notice is resolved automatically when its request is decided.
2. Informational registration notices are stored already read and resolved.
3. The inbox has a «Pending» view (open notices) and shows how many registrations are waiting.
4. A registration notice links to its own request; the queue page brings that request into view.
5. A one-off operator script resolves the existing backlog, dry-run first.

## Non-goals

- E-mail, push or any delivery channel other than the existing inbox.
- Approving from the inbox. Approval needs level and plan choices on the queue page.
- Changing payment, membership, class or subscription-expiring notices.
- Changing the approval service or the enrolment request lifecycle.

## Anti-goals (failure even if it "works")

- A new field on stored notice documents or on the inbox response. `adminNotificationSchema` and
  `adminInboxPageSchema` are `strictObject`; an old build that meets an unknown field throws (see
  the 2026-09-30 incident with `listStaffProfiles`). Only existing fields (`readAt`, `resolvedAt`,
  `href`) carry the new behaviour.
- Opening the confidential request detail automatically from a link. That read is purpose-bound,
  audited and counted; it stays behind a deliberate click.
- Personal data in a URL. The link carries only the opaque `enrolmentRequestId`.
- A pending registration being resolved by anything other than a decision on that request.

## Behaviour

### Server: `apps/functions/src/notifications/admin-notification-triggers.ts`

Trigger stays `onDocumentCreated` on `academies/{academyId}/auditEvents/{auditEventId}`, idempotent
under `retry: true`.

**Actionable registration notices** — actions `enrolment.request.submitted` and
`enrolment.request.approval.failed`:
- created as today (`readAt: null`, `resolvedAt: null`);
- `href` = `/admin/members/requests?request=<enrolmentRequestId>`, where the id is the last
  segment of `targetRef` (`academies/{academyId}/enrolmentRequests/{id}`). Fall back to
  `/admin/members/requests` if `targetRef` is not an enrolment request path.

**Informational registration notices** — `enrolment.request.approved`,
`enrolment.request.returned`, `enrolment.request.withdrawn`:
- created with `readAt` and `resolvedAt` both set to the notice's `createdAt`.

**«Member added» (`member.created`) is unchanged** (Luis, 2026-10-23, Q2 = b): it is also
emitted by member-driven paths (a client adding a child in their profile,
`profile-service.ts:379`; a member linking or recovering an account,
`member-recovery-service.ts:861`), where the person may be new to the office. It stays open and
unread on creation and the backfill does not touch it.

**Resolution on decision** — when the audit action is `enrolment.request.approved`,
`enrolment.request.returned`, `enrolment.request.withdrawn` or `enrolment.request.denied`
(denied has no notice of its own; it still resolves):
- read the audit events with `targetRef ==` the request path (existing composite index
  `targetRef ASC, occurredAt DESC`), keep those whose action is `enrolment.request.submitted` or
  `enrolment.request.approval.failed`;
- for each, notice id = `event-` + sha256(auditEventId) (the existing id scheme); if the notice
  exists and `resolvedAt` is null, set `resolvedAt` to the decision's time and `readAt` to
  `readAt ?? that time`;
- a missing notice is not an error. Runs whether or not a notice for the decision itself is
  created. *(Claude's call, race)* The two notices come from independent runs of a retried
  trigger, so the decision can land first. To close that gap, when an actionable notice is
  created the trigger reads the request: if it is missing (deny deletes it) or its status is
  not `submitted`/`approving`/`approval-failed`, the notice is created already resolved. That is
  still "resolved by a decision" — the decision already happened. Bounded: read at most the 100 most recent events for that target (a request carries
  a handful of lifecycle events plus restricted detail reads).
- `enrolment.request.approval.failed` resolves nothing: the request still needs action.
- A request that is returned and then resubmitted gets a new `submitted` event, so a new open
  notice, as today.

### Domain: `packages/domain/src/memberships/subscription-admin-contracts.ts`

`adminInboxQuerySchema.readState` gains `"pending"`: notices with `resolvedAt == null`. Nothing
else in the contract changes. Functions must be deployed before the web sends `"pending"`.

### Server: `admin-notification-service.ts` `getAdminInbox`

- `readState === "pending"` filters `resolvedAt == null`, ordered like the other views, paginated
  with the same cursor. Needs composite indexes on `adminNotifications`:
  `resolvedAt ASC, createdAt DESC, __name__ DESC` and
  `resolvedAt ASC, kind ASC, createdAt DESC, __name__ DESC` (added to `firestore.indexes.json`,
  deployed before the functions).
- `unreadCount` unchanged.

### Web: `apps/web/src/app/admin/notifications/admin-notification-panel.tsx`

- The read-state select gains «Pending» (`pending`). Default filters stay «All» (Q1 = a).
- Above the list, when there is at least one open registration notice: a line
  «N registrations waiting for approval» linking to `/admin/members/requests`. N comes from a
  separate `listAdminNotifications({ kind: "registration", readState: "pending" })` call; shown as
  «30+» when the page is full. *(Claude's call)* N counts requests, not notices: a request that
  failed approval has two open notices, so the panel de-duplicates by `href`. No new response field.
- A resolved notice of any kind shows a quiet «Done» marker in the list and in the detail (the
  detail already shows «Resolved» for subscription-expiring; reuse it).
- `sectionLabels[selected.href]` must look up the path without the query string, so the link
  still reads «Open requests» (`admin-notification-panel.tsx:47-53`) rather than «Open section».

### Web: `apps/web/src/app/admin/members/requests/page.tsx`

- Reads `?request=<id>` once after the queue loads. If that request is in the queue: set the
  filter so it is visible (`waiting`, or `all` if it is no longer waiting), clear the search,
  scroll its row into view, highlight it, and focus its Review button. Do not call
  `getEnrolmentRequestDetail` automatically.
- Unknown or decided-and-gone id: show a short notice «That registration has already been
  decided or is no longer in the queue.» and leave the page as it is.
- Static export: `useSearchParams` needs a `Suspense` boundary if the page does not have one.

### Operator script (one-off, writes to production only with Luis's confirmation)

`apps/functions/scripts/resolve-registration-notices.mjs`, same conventions as the other operator
CLIs (ADC, `--project`, short confirmation code, dry run by default):

- dry run prints counts only, no names: open «awaiting approval»/«needs attention» notices whose
  request is no longer `submitted`/`approval-failed`/`approving`, or no longer exists (deny
  deletes it) (to resolve), those whose request
  still waits (to keep), and open informational registration notices — approved, returned, withdrawn; not «Member
  added» — (to mark read + resolved);
- `--apply` writes `resolvedAt` (and `readAt` if null) in batches of ≤ 400, idempotent,
  re-runnable;
- maps notices to requests through the audit events (notice id = `event-` + sha256(auditEventId)).

Expected at 2026-10-23 (from the read of that day; the dry run is the source of truth):
150 «awaiting approval» + 40 «needs attention» = 190 actionable, of which the one(s) for the
2026-10-19 request stay open and the rest (~189) are resolved; informational notices closed =
«Registration approved» 134 + «returned» 5 + «withdrawn» 9 = 148. «Member added» (315) untouched.

## Deploy order

1. Firestore indexes (`firestore.indexes.json`), wait until READY.
2. Functions: every function exported from the changed files, at least
   `adminOperationalNotificationCreated`, `subscriptionExpiryNoticeWritten`,
   `subscriptionExpiryNoticesSchedule`, `adminPlanPaymentNotificationCreated`,
   `adminPrivateLessonPurchaseNotificationCreated`, `listAdminNotifications`,
   `updateAdminNotification`. The domain module `@bpt-jersey/domain/memberships/admin` is imported
   more widely, but only these parse `readState`; the plan lists the final set from the import graph.
3. Web (push to main → Pages).
4. Operator script, dry run, then `--apply` after Luis confirms.

## Testing (Luis asked for Playwright MCP at the end of the build)

- Unit tests beside the changed files for: resolution on each decision action, no resolution on
  approval.failed, informational notices born resolved, href with request id, `pending` query.
- Browser check with Playwright MCP against the local emulators (`demo-bpt-jersey`): submit an
  enrolment, see it in «Pending» with the waiting count, follow the link to the highlighted
  request, approve it, see the notice marked Done and the count drop. Production cannot be
  driven from the VPS (App Check rejects its Chrome).

## Decisions by Luis (2026-10-23)

- Q1 = a: «Pending» is a filter, the inbox still opens on «All». The at-a-glance signal is the
  line «N registrations waiting for approval». Payment, invoice, membership, class and
  subscription-expiring notices are not changed (so «Pending» also lists their ~590 open notices).
- Q2 = b: «Member added» stays as today and is not backfilled.

## Left to the builder

Exact copy of the waiting line and the Done marker within DESIGN.md; test structure; script
argument names; how the highlight is styled (existing tokens only).
