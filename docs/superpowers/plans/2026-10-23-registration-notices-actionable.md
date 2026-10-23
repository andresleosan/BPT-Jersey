# Registration notices that ask for action — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registration notices resolve themselves when the request is decided, informational ones are born closed, the inbox gains a «Pending» filter and a waiting count, and a notice links to its own request.

**Architecture:** All new server rules live in one pure-ish module, `apps/functions/src/notifications/registration-notices.ts`, called by the existing audit-event trigger and by a one-off operator script (through the built artifact). The inbox gets one new `readState` value. The web changes stay inside the notification panel and the requests queue page. No field is added to any stored or returned document.

**Tech Stack:** TypeScript strict, Firebase Functions v2, firebase-admin Firestore, zod, Next.js 16 static export, React 19, vitest (`node` + `web` projects), Playwright MCP against emulators.

**Spec:** `docs/superpowers/specs/2026-10-23-registration-notices-actionable-design.md`

## Global Constraints

- Work and commit on local `main`; no branch, no push, no deploy (Luis deploys from a runbook).
- Never add a field to `adminNotificationSchema` / `adminInboxPageSchema` documents (both `strictObject`).
- Notice id scheme is fixed: `event-` + sha256(auditEventId) hex.
- Actionable actions: `enrolment.request.submitted`, `enrolment.request.approval.failed`.
- Informational (born read + resolved): `enrolment.request.approved`, `enrolment.request.returned`, `enrolment.request.withdrawn`. `member.created` is NOT changed.
- Deciding actions (resolve open actionable notices): `enrolment.request.approved`, `.returned`, `.withdrawn`, `.denied`.
- A request still waits when its status is `submitted`, `approving` or `approval-failed`; a missing request (deny deletes it) is decided.
- Link: `/admin/members/requests?request=<enrolmentRequestId>`; only the opaque id in the URL.
- UI copy UK English, plain academy voice; DESIGN.md: status = text + left-rule, no pills, no spinners, radius 0 in admin, existing tokens only, touch targets ≥ 44px.
- The requests page never calls `getEnrolmentRequestDetail` on its own.
- Tests only where this plan names them; run single files (`corepack pnpm vitest run --project <p> <file>`), never the whole suite.

## Review Focus

1. Decision lands before the submitted notice (retried trigger) → the submitted notice is created already resolved (Task 2 test `creates an actionable notice resolved when the request is already decided`).
2. Request resubmitted after «returned» → old notice resolved, new submitted notice open (Task 2 test `resolves only notices of the decided request path`, distinct paths).
3. Denied request (document deleted) → its notices count as decided in trigger and backfill (Task 2 tests use a missing request).
4. Request failed approval → two open notices, waiting count says 1 (Task 3 test `counts waiting registrations by request, not by notice`).
5. Link to a request that is no longer in the queue → short notice, page unchanged, no detail read (Task 4 test `explains a request that is no longer in the queue`).

---

### Task 1: «Pending» inbox filter (domain + service + indexes)

**Files:**
- Modify: `packages/domain/src/memberships/subscription-admin-contracts.ts:104-115` (readState enum)
- Modify: `apps/functions/src/notifications/admin-notification-service.ts:128-181` (`getAdminInbox`)
- Modify: `firestore.indexes.json` (two `adminNotifications` indexes)
- Test: `apps/functions/src/notifications/admin-notification-service.test.ts`

**Interfaces:**
- Produces: `AdminInboxQuery["readState"]` = `"all" | "unread" | "read" | "pending"`; `getAdminInbox` with `readState: "pending"` returns notices where `resolvedAt === null`, same ordering/cursor/`unreadCount` as `"unread"`.

- [ ] **Step 1: Write the failing test** in the existing `describe("getAdminInbox")`:

```ts
it("returns only open notifications for the pending view, filtered by kind", async () => {
  const open = notice({ createdAt: "2026-10-20T10:00:00.000Z", kind: "registration", resolvedAt: null });
  const done = notice({ createdAt: "2026-10-21T10:00:00.000Z", kind: "registration", resolvedAt: "2026-10-21T11:00:00.000Z" });
  const other = notice({ createdAt: "2026-10-22T10:00:00.000Z", kind: "payment", resolvedAt: null });
  const { db } = fakeDb([open, done, other]);
  const page = await getAdminInbox(db, "a", { kind: "registration", readState: "pending", from: null, to: null, cursor: null });
  expect(page.notifications.map((n) => n.notificationId)).toEqual([open.notificationId]);
});
```

- [ ] **Step 2:** `corepack pnpm vitest run --project node apps/functions/src/notifications/admin-notification-service.test.ts` → FAIL (schema/type rejects `"pending"` or wrong rows).
- [ ] **Step 3:** Add `"pending"` to the enum; in `getAdminInbox` add `if (input.readState === "pending") base = base.where("resolvedAt", "==", null);` next to the `unread` filter (the `!== "read"` branch already serves it).
- [ ] **Step 4:** Add to `firestore.indexes.json` (same shape as the existing `readAt` ones): `adminNotifications` `resolvedAt ASC, createdAt DESC, __name__ DESC` and `resolvedAt ASC, kind ASC, createdAt DESC, __name__ DESC`. Check with `node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8'))"`.
- [ ] **Step 5:** Re-run the test file → PASS. `corepack pnpm --filter @bpt-jersey/domain build:runtime` succeeds.
- [ ] **Step 6: Commit** `feat(notifications): «Pending» inbox filter for open notices`

---

### Task 2: Registration notice lifecycle (server)

**Files:**
- Create: `apps/functions/src/notifications/registration-notices.ts`
- Modify: `apps/functions/src/notifications/admin-notification-triggers.ts:88-187` (`messages` hrefs stay; `adminOperationalNotificationCreated` uses the module)
- Test: `apps/functions/src/notifications/registration-notices.test.ts`

**Interfaces:**
- Produces (exported from `registration-notices.ts`):
  - `noticeIdForAuditEvent(auditEventId: string): string` — moved from the trigger (`event-` + sha256 hex); the trigger and the script use it.
  - `enrolmentRequestIdOf(academyId: string, targetRef: string): string | null` — last segment when `targetRef` matches `academies/{academyId}/enrolmentRequests/{id}`, else null.
  - `registrationNoticeHref(action: string, academyId: string, targetRef: string, fallback: string): string` — actionable actions with a request id → `/admin/members/requests?request=<id>`; otherwise `fallback`.
  - `requestStillWaiting(status: unknown): boolean` — true for `submitted | approving | approval-failed`.
  - `initialNoticeState(input: { action: string; createdAt: string; requestWaiting: boolean | null }): { readAt: string | null; resolvedAt: string | null }` — informational → both `createdAt`; actionable with `requestWaiting === false` → both `createdAt`; else both null. `requestWaiting` is null for non-registration actions.
  - `resolveRegistrationNotices(db: Firestore, input: { academyId: string; targetRef: string; at: string }): Promise<number>` — reads `auditEvents` `where("targetRef","==",targetRef).orderBy("occurredAt","desc").limit(100)`, keeps actionable actions, and in one transaction per notice sets `resolvedAt: at` and `readAt: readAt ?? at` on existing notices with `resolvedAt === null`; returns how many it resolved. Missing notices are skipped.
  - `classifyRegistrationNotice(input: { title: string; resolvedAt: string | null; requestWaiting: boolean | null }): "resolve" | "keep" | "close-informational" | "ignore"` — for the script (Task 5): open «New registration awaiting approval» / «Registration approval needs attention» → `resolve` if `requestWaiting === false`, `keep` if true; open «Registration approved» / «Registration returned for changes» / «Registration withdrawn» → `close-informational`; anything else or already resolved → `ignore`.
- Consumes: `adminNotificationSchema` (unchanged).

- [ ] **Step 1: Write the failing tests** (`registration-notices.test.ts`, small in-memory fake with `doc().get()`, `collection().where().orderBy().limit().get()`, `runTransaction`):
  - `builds the request link only for actionable registration actions` — submitted with `academies/a/enrolmentRequests/r1` → `/admin/members/requests?request=r1`; approved → fallback; submitted with `academies/a/students/s1` → fallback.
  - `creates informational registration notices read and resolved` — `initialNoticeState({action:"enrolment.request.approved", createdAt:T, requestWaiting:null})` → `{readAt:T, resolvedAt:T}`; same for returned/withdrawn; `member.created` → both null.
  - `creates an actionable notice resolved when the request is already decided` — submitted, `requestWaiting:false` → both T; `requestWaiting:true` → both null.
  - `resolves only notices of the decided request path` — two requests' submitted events + notices; resolving path A returns 1, A's notice has `resolvedAt === at`, B's stays null; a previously read notice keeps its `readAt`.
  - `leaves already resolved and missing notices alone` — resolved notice keeps its original `resolvedAt`; an audit event with no notice → no throw, count 0.
  - `classifies backlog notices` — the four outcomes above, including a missing request (`requestWaiting:false`) → `resolve`, and «Member added» → `ignore`.
- [ ] **Step 2:** `corepack pnpm vitest run --project node apps/functions/src/notifications/registration-notices.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement the module with the signatures above.
- [ ] **Step 4:** Wire the trigger:
  - id via `noticeIdForAuditEvent`;
  - if the action is a deciding action, call `resolveRegistrationNotices(db, {academyId, targetRef, at: createdAt})` before the `if (!copy) return` (so `denied`, which has no copy, still resolves);
  - for actionable actions read `academies/{academyId}/enrolmentRequests/{id}` and pass `requestWaiting = exists && requestStillWaiting(status)`;
  - spread `initialNoticeState(...)` and `href: registrationNoticeHref(action, academyId, targetRef, copy.href)` into the parsed value (replacing the literal `readAt: null, resolvedAt: null`).
- [ ] **Step 5:** Re-run the test file → PASS. Compile like deploy: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/functions exec tsc -p tsconfig.deploy.json --noEmit` → 0 errors (if `tsconfig.deploy.json` takes extra flags in `firebase.json` predeploy, use exactly those).
- [ ] **Step 6: Commit** `feat(notifications): registration notices close when the request is decided (functions)`

---

### Task 3: Inbox panel — Pending option, waiting count, Done marker (web)

**Files:**
- Modify: `apps/web/src/app/admin/notifications/admin-notification-panel.tsx`
- Modify: `apps/web/src/app/admin/notifications/admin-notifications.css`
- Test: `apps/web/src/app/admin/notifications/admin-notification-panel.test.tsx`

**Interfaces:**
- Consumes: `getAdminNotifications(input: AdminInboxQuery)` from `apps/web/src/lib/subscription-admin-client.ts` with `readState: "pending"` (Task 1).

- [ ] **Step 1: Write the failing tests** (reuse the file's `api` mock):
  - `offers a Pending view that queries open notices` — choosing «Pending» in the «Show» select sends `readState: "pending"`.
  - `counts waiting registrations by request, not by notice` — the pending-registration call returns 3 open notices, two with the same `href` `/admin/members/requests?request=r1` and one with `?request=r2` → text «2 registrations waiting for approval» linking to `/admin/members/requests`; zero → no line; a full page (30 notices) → «30+ …».
  - `marks resolved notices as done` — a notice with `resolvedAt` set shows «Done» in its row.
  - `labels a request link by its path` — selected notice with `href: "/admin/members/requests?request=r1"` renders the link text «Open requests» and `href` keeps the query.
- [ ] **Step 2:** `corepack pnpm vitest run --project web apps/web/src/app/admin/notifications/admin-notification-panel.test.tsx` → the new tests FAIL.
- [ ] **Step 3:** Implement:
  - select option `<option value="pending">Pending</option>`; the `onChange` accepts `"pending"`;
  - a second load `getAdminNotifications({kind:"registration", readState:"pending", from:null, to:null, cursor:null})` run with the main load and the 60 s poll; count distinct `href`; render one line above the list (`.admin-inbox-waiting`, Attention Amber left-rule band per DESIGN.md «Notices», `Link` to `/admin/members/requests`); failures of this call render nothing;
  - row: when `notice.resolvedAt`, append `<span className="admin-inbox-row-done">Done</span>` (Muted text, no pill); in the detail reuse `admin-inbox-resolved` text «Done» for non-subscription kinds;
  - link label: `sectionLabels[selected.href.split("?")[0]]`.
- [ ] **Step 4:** Re-run → PASS (old tests in the file still pass).
- [ ] **Step 5: Commit** `feat(web): Pending notices, registrations waiting count, Done marker`

---

### Task 4: Requests queue opens the linked request (web)

**Files:**
- Modify: `apps/web/src/app/admin/members/requests/page.tsx` (`EnrolmentRequestQueueContent`)
- Modify: `apps/web/src/app/admin/members/requests/requests.css`
- Test: `apps/web/src/app/admin/members/requests/page.test.tsx`

**Interfaces:**
- Consumes: the `?request=<id>` link from Task 2/3. Reads `new URLSearchParams(window.location.search).get("request")` once, the first time `state.status === "ready"` (no `useSearchParams`, so no Suspense boundary needed).

- [ ] **Step 1: Write the failing tests** (set `window.history.replaceState({}, "", "/admin/members/requests?request=<id>")` before render):
  - `brings the linked request into view and focuses its Review button` — the row for that id gets `data-linked` and focus lands on its Review button; `getEnrolmentRequestDetail` mock not called.
  - `shows a linked request that is no longer waiting` — the id belongs to an approved row → filter switches to «All requests» and the row is marked.
  - `explains a request that is no longer in the queue` — unknown id → status text «That registration has already been decided or is no longer in the queue.»; filter stays «Waiting».
- [ ] **Step 2:** `corepack pnpm vitest run --project web apps/web/src/app/admin/members/requests/page.test.tsx` → new tests FAIL.
- [ ] **Step 3:** Implement with a `useRef` "handled" flag: find the row; if found, `setSearch("")`, `setFilter(open ? "waiting" : "all")`, store `linkedId`; after render, `scrollIntoView({block:"center"})` the card (`id={`enrolment-request-${id}`}`) and focus its Review button; card gets `data-linked` → Purple Wash fill + `#D9D6FF` outline (DESIGN.md selected row). Not found → `setNotice({ tone: "error", text: "That registration has already been decided or is no longer in the queue." })` (the page's `Notice` has only `error | success`).
- [ ] **Step 4:** Re-run → PASS; then `corepack pnpm --filter @bpt-jersey/web exec tsc --noEmit` → no new errors in the touched files.
- [ ] **Step 5: Commit** `feat(web): a registration notice opens its own request in the queue`

---

### Task 5: Backlog script (operator, dry run by default)

**Files:**
- Create: `apps/functions/scripts/resolve-registration-notices.mjs`

**Interfaces:**
- Consumes: `classifyRegistrationNotice`, `noticeIdForAuditEvent`, `requestStillWaiting` from the built artifact `.firebase-functions/lib/src/notifications/registration-notices.js` (same loading pattern as `apply-special-access-ladder.mjs`).

- [ ] **Step 1:** Write the script: `GCLOUD_PROJECT` required; `--academy-id=demo-academy` default; dry run prints only counts per outcome (`resolve`, `keep`, `close-informational`, `ignore`), never names or ids; `--apply --confirm=<code>` where `<code>` is the first 6 hex chars of sha256 of the dry run's counts line printed by that dry run (short code, per the memory about long pasted confirmations). Mapping: read `auditEvents` where `action in [submitted, approval.failed]` → `noticeIdForAuditEvent(id)` → `targetRef`; read each referenced request once (missing = decided). Writes `resolvedAt` = run time and `readAt` = `readAt ?? run time` in `BulkWriter`/batches ≤ 400, only on docs still `resolvedAt == null` (re-runnable).
- [ ] **Step 2:** Run the dry run against the emulator data from Task 6 (`FIRESTORE_EMULATOR_HOST`, project `demo-bpt-jersey`) → counts match the seeded notices; `--apply` with the code → second dry run shows `resolve: 0`, `close-informational: 0`.
- [ ] **Step 3: Commit** `feat(ops): back-fill script that closes decided registration notices`

---

### Task 6: Browser acceptance with Playwright MCP (emulators) and runbook

**Files:**
- Create: `/root/bpt-runbook/registration-notices-2026-10-23/GUIA.md` (outside the repo, Spanish, per Luis's step rules)

- [ ] **Step 1:** Build domain runtime, start emulators in the `bpt-emu:local` container (`--network none` per memory), web dev server with `NEXT_PUBLIC_FIREBASE_ENV=local`.
- [ ] **Step 2:** Playwright MCP: submit an enrolment at `/enrol` with plan Free Trial; as owner open the inbox → «1 registration waiting for approval»; «Show: Pending» lists it; open it → «Open requests» link with `?request=`; queue highlights the row and focuses Review; approve → back in the inbox the notice shows «Done» and the waiting line is gone. Screenshot each state; check the console has no errors.
- [ ] **Step 3:** Write the runbook: indexes deploy (wait READY) → the 7 functions in Task 2's list in one batch → push `main` (Pages) → script dry run → Luis confirms → `--apply`. Each step with terminal, expected output, ⚠️ on prod writes.
- [ ] **Step 4:** Report to Luis; do not push or deploy.
