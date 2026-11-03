# Membership Payment Reminder Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily job emails each in-scope member up to four payment reminders around their membership `endsAt` through Amazon SES. After the last reminder the office gets a notice that closes itself, and the Payments tab shows the last reminder.

**Architecture:**
- **Domain.** Pure rules (step windows, scope, state schema) live in a new domain module.
- **Job.** One scheduled function, `membershipPaymentRemindersSchedule`, runs at 09:00 Europe/Jersey. A pure run service reads and writes through ports. A Firestore/Auth adapter implements the ports, and an SES provider plugs into the existing T046 dispatcher.
- **Office surfaces.** The existing billing callable and the membership trigger gain the reminder line and the notice resolution. The web adds one line and one notice kind.

**Tech Stack:** TypeScript strict, Firebase Functions v2 (Node 22, europe-west9), Firestore Admin SDK, Firebase Auth Admin, zod 4.4.3, `@aws-sdk/client-sesv2@3.1107.0`, Next.js 16 static web.

**Spec:** `docs/superpowers/specs/2026-11-03-membership-payment-reminders-design.md` (approved 2026-11-03). Read it first. The email copy, recipient table, scope rules and step windows are fixed there.

## Global Constraints

- Work directly on local `main`; commit only your files (`git add <paths>`, never `-A`); no branches, worktrees or PRs.
- **No automated tests** are added, run or awaited unless Luis asks (AGENTS.md). Verification means compiling as the deploy does, inspecting the code, and the dry-run and test modes in production.
- The domain never imports Firebase. A new domain file must be registered in three places:
  - `packages/domain/package.json` exports;
  - `packages/domain/tsconfig.runtime.json` include;
  - `apps/functions/src/deploy-runtime.ts` `domainImportReplacements`.
- Strict parsers mean the web ships before the functions. New fields are `.nullable().default(null)`. The new notice kind must be live on the web before any function writes it.
- **Step names** (exact): `ends-in-7`, `ends-tomorrow`, `payment-due`, `final-reminder`.
- **Windows**, with `d` = Jersey end date − Jersey run date: `2 ≤ d ≤ 7`, `d = 1`, `−6 ≤ d ≤ −1`, `−13 ≤ d ≤ −7`.
- **Outcomes** (exact): `sent`, `no-email`, `dry-run`, `failed`. `dry-run` does not count as processed; the other three do.
- **Notice kind** `membership-unpaid`:
  - title `Membership still unpaid after reminders`;
  - href `/admin/members/profile?id=<studentId>&tab=payments`;
  - id `unpaid-${sha256(membershipId|endsAt)}`, hashing the raw stored `endsAt`.
- **Delivery id** `sha256(membershipId|endsAt|step)`, hex, using the raw stored `endsAt`.
- **Params** (`defineString`, all with defaults):

  | Param | Default |
  | --- | --- |
  | `SES_REGION` | `eu-west-3` |
  | `REMINDER_MODE` | `dry-run`; any other value means `off` |
  | `REMINDER_FROM` | `BPT Jersey <membership@mail.bptjersey.com>` |
  | `REMINDER_REPLY_TO` | `bptjersey@gmail.com` |
  | `REMINDER_TEST_RECIPIENT` | `""` |
  | `REMINDER_START_DATE` | `""` |

- **Secrets** (`defineSecret`), bound only to the job: `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`.
- **Cap:** 30 emails per run.
- **Personal data in logs:** never. Logs, `deliveryEvents` and `membershipReminders` hold ids, steps, outcomes and dates only. No names or addresses. Error logs carry ids, the step, `err.name` and the HTTP status only, never `err.message`: SES messages can contain addresses.
- **Inbox callables first.** Every function that parses `adminNotificationSchema` or `adminInboxQuerySchema` must be deployed with the new kind no later than the job: `listAdminNotifications` and `updateAdminNotification` (`apps/functions/src/notifications/admin-notification-service.ts:115-120,184`). The job's first deploy is in `dry-run`, which never writes a notice.
- **Domain imports.** Relative imports inside `packages/domain` have no extension, as in `./plan-contracts`, matching the existing files. `prepare-runtime.mjs` adds `.js` when it builds.
- **Every commit compiles.** Nothing is pushed until every task is committed; the kit pushes at the end.
- **Production actions:** push and deploy happen only through Luis's kit after his OK in chat. The classifier blocks Claude's push and deploy.

## Review Focus

These are the failure modes most likely to hurt a member that nothing automated exercises. Each has a pinned check in its task:

1. **Jersey date boundaries and BST.** An `endsAt` near midnight UTC in summer must give the same Jersey date in the email and in the step choice, matching what members see. Checked in Task 1 Step 3 and Task 9 dry-run review.
2. **Renewal in the middle of a sequence.** A changed `endsAt` must start a fresh cycle, with no step 3/4 for the old date, and must resolve the old unpaid notice. Checked in Task 5 Step 2 (fresh-cycle rule), Task 6 Step 2 and Task 9 review.
3. **A pending request that comes back.** A step suppressed while `pending_review` must not be recorded, so it can still go out if the request is returned. Checked in Task 4 Step 2.
4. **No reachable email.** The outcome is `no-email`, step 4 still creates the office notice, and nothing throws. Checked in Task 4 Step 2 and Task 5 Step 2.
5. **Mode switches.** `dry-run` records must not block `live` sends. `test` must never read member addresses and must only email `REMINDER_TEST_RECIPIENT`. Checked in Task 4 Step 2 and Task 7 Step 2.

---

### Task 1: Domain rules, state schema, billing field and notice kind

**Files:**
- Create: `packages/domain/src/memberships/payment-reminders.ts`
- Modify: `packages/domain/package.json`. Add an export `"./memberships/payment-reminders"` with the same `types`/`import`/`default` triple as `"./memberships/admin"`, pointing at `src/…/payment-reminders.ts` and `lib/…/payment-reminders.js`.
- Modify: `packages/domain/tsconfig.runtime.json`. Add `"src/memberships/payment-reminders.ts"` to `include`.
- Modify: `apps/functions/src/deploy-runtime.ts`. Add `"@bpt-jersey/domain/memberships/payment-reminders": "../../domain/memberships/payment-reminders.js"`.
- Modify: `packages/domain/src/memberships/subscription-admin-contracts.ts`:
  - append `"membership-unpaid"` to `adminNotificationKinds` (lines 64-71);
  - add `lastReminder` to `subscriptionBillingSchema` (lines 237-257), importing `paymentReminderSummarySchema` from `"./payment-reminders"`.
- Modify: `apps/web/src/app/admin/notifications/admin-notification-panel.tsx`. It belongs here because `kindLabels` is an exhaustive `Record` and the web stops compiling without it:
  - `kindLabels` (39-46): add `"membership-unpaid": "Unpaid"`;
  - `kindOf` (96-101): add a branch giving `"Unpaid membership"`, because the default branch cuts off the last letter;
  - `sectionLabels` (47-53): add `"/admin/members/profile": "Open payments"`.

**Interfaces:**
- Produces, from `@bpt-jersey/domain/memberships/payment-reminders`:
  - `paymentReminderSteps: readonly ["ends-in-7","ends-tomorrow","payment-due","final-reminder"]` and `type PaymentReminderStep`.
  - `paymentReminderOutcomes: readonly ["sent","no-email","dry-run","failed"]` and `type PaymentReminderOutcome`.
  - `paymentReminderStepNumber(step: PaymentReminderStep): 1 | 2 | 3 | 4`.
  - `daysUntilJerseyDate(endsAt: string, now: Date): number`, using `dateKeyInJersey` from `../schedule/member-calendar-contracts`. `BillingPeriod` comes from `./plan-contracts` and `MembershipStatus` from `./membership-contracts`, all without extensions.
  - `dueReminderStep(days: number): PaymentReminderStep | null`.
  - `isPaymentReminderCandidate(input: { status: MembershipStatus; endsAt: string | null; billingPeriod: BillingPeriod; priceMinor: number; complimentary: boolean; startDateKey: string }): boolean`.
  - `membershipReminderStateSchema` (zod strict) `{ membershipId, endsAt: string, steps: { [step]?: { at: iso datetime, outcome } }, schemaVersion: "1" }` and `type MembershipReminderState`.
  - `paymentReminderSummarySchema` `{ endsAt: string, step, stepNumber: 1-4, at: iso datetime, outcome }` and `type PaymentReminderSummary`.
  - `isProcessedOutcome(outcome): boolean`.
  - `lastReminderOf(state: MembershipReminderState | null): PaymentReminderSummary | null`.
- Produces, from `@bpt-jersey/domain/memberships/admin`:
  - `subscriptionBillingSchema` gains `lastReminder: paymentReminderSummarySchema.nullable().default(null)`;
  - the kind `"membership-unpaid"`.

- [ ] **Step 1: Write the module and the two contract changes.**
  - `dueReminderStep` maps exactly the Global Constraints windows and returns `null` otherwise.
  - `isPaymentReminderCandidate` returns true only when all of these hold: status is `active` or `overdue`; `endsAt` is non-null; billing period is `monthly` or `term`; `priceMinor > 0`; not complimentary; and `dateKeyInJersey(new Date(endsAt)) >= startDateKey` (string compare on `YYYY-MM-DD`).
  - `lastReminderOf` returns the step with the latest `at`.
  - `isProcessedOutcome` is false only for `dry-run`.
  - In `payment-reminders.ts`, declare local `const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u)` and `const instant = z.iso.datetime()`, the same as subscription-admin-contracts.ts:5-6, which are private there.
  - **`payment-reminders.ts` never imports `subscription-admin-contracts.ts`.** The dependency goes one way only. A cycle would leave `instant` uninitialised at load time and crash every importer.
- [ ] **Step 2: Build the domain runtime and compile the web.**
  - Run `corepack pnpm --filter @bpt-jersey/domain build:runtime`. Expected: exit 0, and `packages/domain/lib/memberships/payment-reminders.js` exists.
  - Run `corepack pnpm --filter @bpt-jersey/web exec tsc --noEmit`. Expected: no error in any file outside `*.test.ts` / `*.test.tsx`.
- [ ] **Step 3: Inspect the date pin (Review Focus 1).**
  - Confirm that `daysUntilJerseyDate` compares `dateKeyInJersey(new Date(endsAt))` with `dateKeyInJersey(now)` as calendar dates, never as millisecond differences.
  - Example: `2026-06-11T23:30:00Z` is Jersey date `2026-06-12` (BST).
- [ ] **Step 4: Commit.**
  - Files: `git add packages/domain/src/memberships/payment-reminders.ts packages/domain/src/memberships/subscription-admin-contracts.ts packages/domain/package.json packages/domain/tsconfig.runtime.json apps/functions/src/deploy-runtime.ts apps/web/src/app/admin/notifications/admin-notification-panel.tsx`
  - Message: `git commit -m "feat(domain): payment reminder rules and contracts"`

### Task 2: Delivery history reads by id

**Files:**
- Modify: `apps/functions/src/delivery/delivery-service.ts:261-268`, `createFirestoreDeliveryHistoryStore().getLatest`.

**Interfaces:**
- Consumes `buildDeliveryEventId` and `parseDeliveryHistoryRecord` from `@bpt-jersey/domain/delivery`.
- Produces `getLatest(academyId, deliveryId)`. The signature is unchanged, but it now reads at most 3 documents.

- [ ] **Step 1: Replace the full-collection read.**
  - Call `assertIdentifier(academyId, "academyId")` and `assertIdentifier(deliveryId, "deliveryId")`.
  - Read `academies/${academyId}/deliveryEvents/${buildDeliveryEventId(deliveryId, n)}` for n = 1..3 through `params.firestore.doc(path).get()`.
  - Parse every existing doc; an invalid one throws `DeliveryServiceError("invalid", "Invalid delivery history record")`.
  - Return the highest attempt, or `null`.
  - Leave `list()` unchanged.
- [ ] **Step 2: Compile like the deploy.**
  - Run: `node node_modules/typescript/bin/tsc -p apps/functions/tsconfig.deploy.json --module ESNext --moduleResolution Bundler --rootDir apps/functions --noEmit`
  - Expected: no output, exit 0. Never run `build-deploy-artifact.mjs`: it deletes `apps/functions/lib`.
- [ ] **Step 3: Commit.**
  - Files: `git add apps/functions/src/delivery/delivery-service.ts`
  - Message: `git commit -m "fix(functions): delivery history reads the three attempt documents by id"`

### Task 3: SES sending and email rendering

**Files:**
- Modify: `apps/functions/package.json` and `pnpm-lock.yaml`, via `corepack pnpm --filter @bpt-jersey/functions add @aws-sdk/client-sesv2@3.1107.0 --save-exact` from the repo root. Never use `--prod` or `--config.node-linker`.
- Create: `apps/functions/src/membership-reminders/payment-reminder-params.ts`
- Create: `apps/functions/src/membership-reminders/payment-reminder-emails.ts`
- Create: `apps/functions/src/membership-reminders/ses-provider.ts`

The folder name is deliberately not `reminders/`, which already holds the unrelated in-app reminders.

**Interfaces:**
- Produces, from `payment-reminder-params.ts`:
  - the params `sesRegion`, `reminderMode`, `reminderFrom`, `reminderReplyTo`, `reminderTestRecipient`, `reminderStartDate`, all `defineString` with the Global Constraints defaults, following the `consent-callables.ts:44-48` pattern;
  - `parseReminderMode(value: string): "off" | "dry-run" | "test" | "live"`, where unknown means `"off"`.
- Produces, from `payment-reminder-emails.ts`:
  - `paymentReminderTemplateId(step: PaymentReminderStep, audience: "self" | "guardian"): string`, which returns `payment-reminder.${step}.${audience}`;
  - `renderPaymentReminderEmail(templateId: string, variables: Readonly<Record<string, string>>): { subject: string; text: string; html: string }`.
  - The variables are `recipientFirstName`, `memberFirstName` (guardian only), `planName`, `endDateLong` (for example "Wednesday 12 November") and `endDateShort` (for example "12 November").
  - Unknown templates or missing variables throw.
  - It also exports `formatReminderDates(endsAt: string): { endDateLong: string; endDateShort: string }`. It uses `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Jersey", weekday: "long", day: "numeric", month: "long" })`, and the same without `weekday`.
- Produces, from `ses-provider.ts`:
  - `sesSecrets = ["SES_ACCESS_KEY_ID", "SES_SECRET_ACCESS_KEY"].map((name) => defineSecret(name))`, copying the pattern in `members/enrolment-payment-proof.ts:13-19`;
  - `createSesDeliveryProvider(options: { send: (input: SendEmailCommandInput) => Promise<{ MessageId?: string }>; from: string; replyTo: string }): ExternalDeliveryProvider`, named `"ses"`;
  - `createSesSendFromEnvironment(region: string): (input: SendEmailCommandInput) => Promise<{ MessageId?: string }>`. It reads `process.env.SES_*`, caches one `SESv2Client` per sha256 of its config (copying `r2-client.ts:303-326`), and throws `Error("Email sending is not configured")` when unset.

- [ ] **Step 1: Add the dependency.**
  - Expected: `apps/functions/package.json` has `"@aws-sdk/client-sesv2": "3.1107.0"`.
  - `git diff --stat pnpm-lock.yaml` shows a small change: the new package, reusing the locked `@aws-sdk/core` and `@smithy/*`.
- [ ] **Step 2: Write the params and the renderer.**
  - **Copy:** subjects, bodies, button labels and footer verbatim from the spec, section "The emails". The guardian variant is "Hi {recipientFirstName}, {memberFirstName}'s {planName} membership …".
  - **Fixed values:** the button URL is `https://www.bptjersey.com/account/membership`. The footer address is `Office 9, 13 Library Place, St Helier, Jersey JE2 3RR`.
  - **HTML:** escape every variable, inline styles only, following DESIGN.md:
    - colours: body `#F2F1ED`, card `#FFFFFF`, text `#1A1A18`, footer `#65635D`;
    - button: `#2F2483` with white text, square corners;
    - fonts: `'Source Sans 3',Arial,sans-serif`;
    - no tracking pixel, and it must read well with images off. The logo is optional, at `https://www.bptjersey.com/bpt-jersey-logo.png`, with alt text.
  - **Greeting.** «Hi there,» whenever `recipientFirstName` is `there`.
- [ ] **Step 3: Write the provider.**
  - `send` renders through `renderPaymentReminderEmail`, then calls `options.send` with: `FromEmailAddress: from`, `Destination: { ToAddresses: [request.recipient] }`, `ReplyToAddresses: [replyTo]`, `Content: { Simple: { Subject, Body: { Text, Html } } }` (all `Charset: "UTF-8"`).
  - On success it returns `{ status: "accepted", providerMessageId: MessageId ?? null, failureCode: null, retryable: false }`.
  - Map errors by name: `TooManyRequestsException`, `ThrottlingException`, `LimitExceededException` and 5xx → `{ status: "failed", failureCode: "ses_throttled" | "ses_unavailable", retryable: true }`. Anything else → `{ status: "failed", failureCode: "ses_rejected", retryable: false }`. Failure codes must match `/^[a-z0-9][a-z0-9._-]{0,63}$/u`.
  - **Logging.** On `ses_rejected`, call `logger.error("SES rejected a reminder", { failureCode, errorName: err.name, httpStatus: err.$metadata?.httpStatusCode })`. Never log `err.message`, which can name addresses, and never log the recipient.
- [ ] **Step 4: Compile like the deploy.** Run the Task 2 Step 2 command. Expected: no output, exit 0.
- [ ] **Step 5: Commit.**
  - Files: `git add apps/functions/package.json pnpm-lock.yaml apps/functions/src/membership-reminders/payment-reminder-params.ts apps/functions/src/membership-reminders/payment-reminder-emails.ts apps/functions/src/membership-reminders/ses-provider.ts`
  - Message: `git commit -m "feat(functions): SES provider and payment reminder emails"`

### Task 4: The reminder run (pure service)

**Files:**
- Create: `apps/functions/src/membership-reminders/payment-reminder-service.ts`

**Interfaces:**
- Consumes the Task 1 domain module, `ExternalDeliveryRequest` and `DeliveryHistoryRecord`, and `paymentReminderTemplateId` and `formatReminderDates` from Task 3.
- Produces these types:
  - `ReminderCandidate = { membershipId: string; studentId: string; familyId: string; status: MembershipStatus; endsAt: string; planId: PlanId }`.
  - `ReminderRecipient = { email: string; recipientFirstName: string; memberFirstName: string | null }`, where `memberFirstName` is set for guardians only.
  - `PaymentReminderPorts`:
    - `listCandidates(fromIso: string, toIso: string): Promise<readonly ReminderCandidate[]>`
    - `loadPendingStudentIds(): Promise<ReadonlySet<string>>`
    - `loadPlans(): Promise<ReadonlyMap<string, { displayName: string; billingPeriod: BillingPeriod; priceMinor: number }>>`
    - `loadComplimentaryIds(ids: readonly string[]): Promise<ReadonlySet<string>>`
    - `loadStates(ids: readonly string[]): Promise<ReadonlyMap<string, MembershipReminderState>>`
    - `resolveRecipient(candidate: ReminderCandidate, todayKey: string): Promise<ReminderRecipient | null>`
    - `dispatch(request: ExternalDeliveryRequest): Promise<DeliveryHistoryRecord>`
    - `saveStep(previous: MembershipReminderState | null, membershipId: string, endsAt: string, step: PaymentReminderStep, outcome: PaymentReminderOutcome, at: string): Promise<void>`
    - `notifyOfficeUnpaid(candidate: ReminderCandidate, planName: string): Promise<void>`
  - `PaymentReminderRunSummary = { considered: number; byStep: Record<PaymentReminderStep, Partial<Record<PaymentReminderOutcome, number>>>; skipped: Record<"out-of-scope" | "pending-review" | "already-processed" | "no-step" | "capped", number> }`.
- Produces these functions:
  - `paymentReminderDeliveryId(membershipId: string, endsAt: string, step: PaymentReminderStep): string`, the sha256 hex of `${membershipId}|${endsAt}|${step}` (`node:crypto`).
  - `runPaymentReminders(ports: PaymentReminderPorts, options: { academyId: string; now: Date; mode: "dry-run" | "live"; startDateKey: string; cap: number }): Promise<PaymentReminderRunSummary>`
  - `sendPaymentReminderSamples(dispatch: PaymentReminderPorts["dispatch"], options: { academyId: string; recipient: string; now: Date }): Promise<number>`

- [ ] **Step 1: Write `runPaymentReminders`.**
  - **Window.** `fromIso = now − 14 d`, `toIso = now + 8 d`.
  - **No candidates.** Return the zero summary before any `load*` call. `Firestore.getAll` throws when it gets no references.
  - **Per candidate,** in order, with `todayKey = dateKeyInJersey(now)`:
    1. Look up the plan; a missing plan counts as out-of-scope.
    2. `isPaymentReminderCandidate`.
    3. A pending-review `studentId` is skipped and **not recorded**.
    4. Run `dueReminderStep(daysUntilJerseyDate(...))`; `null` counts as no-step.
    5. **Already processed** in either case below counts as already-processed:
       - (a) the state has the same `endsAt` and that step's outcome `isProcessedOutcome`;
       - (b) the state has any step, under any `endsAt`, with an `isProcessedOutcome` outcome whose `dateKeyInJersey(at) === todayKey`. This means at most one email per membership per day, even when `endsAt` changed the same day.

       In `live`, when (a) applies and the step is `final-reminder`, still call `ports.notifyOfficeUnpaid`. It is idempotent and repairs a notice an earlier run failed to create.
    6. Apply the cap: count would-send entries in `dry-run` and dispatch attempts in `live`. At the cap, count capped and continue counting only.
    7. **`dry-run`:** resolve the recipient only to count; `null` adds to the `dryRunNoEmail` counter. Save the outcome `dry-run` and stop. Dry-run never saves `no-email` and never calls `notifyOfficeUnpaid`.
    8. **`live`:** resolve the recipient; `null` gives the outcome `no-email`. Otherwise call `ports.dispatch` with:
       - `deliveryId: paymentReminderDeliveryId(membershipId, endsAt, step)` and `channel: "email"`;
       - `templateId: paymentReminderTemplateId(step, audience)`, where `audience = recipient.memberFirstName !== null ? "guardian" : "self"`;
       - the variables of Task 3, **omitting** `memberFirstName` for self because empty strings are rejected;
       - `requestedAt: now.toISOString()`.

       `accepted` or `delivered` is `sent`; `skipped` or `failed` is `failed`.
    9. **`live`, `final-reminder`:** call `ports.notifyOfficeUnpaid` **before** saving, whatever the outcome.
    10. Save the step.
  - **Errors in `live`.** If `resolveRecipient` or `dispatch` throws, log `membershipId`, the step and `err.name`, and use the outcome `failed`. Then still run items 9 and 10. If `notifyOfficeUnpaid` or `saveStep` throws, log the same way, count `failed` and go on to the next candidate. A run never aborts.
  - `PaymentReminderRunSummary` gains `dryRunNoEmail: number`.
- [ ] **Step 2: Inspect the pins (Review Focus 3, 4, 5).** Confirm by reading the code that:
  - (a) a pending-review skip happens before any `saveStep`;
  - (b) in `live`, `no-email` is saved and step 4 still creates the notice before the save;
  - (c) only `isProcessedOutcome` blocks a step, so `dry-run` never blocks `live`; dry-run saves nothing but `dry-run` and never notifies;
  - (d) `sendPaymentReminderSamples` takes no ports other than `dispatch`. It sends 4 steps × 2 audiences with synthetic values (`Sam`, `Ana`/`Leo`, `Adults Unlimited`, an end date 7 days ahead) to `recipient`, with deliveryIds `sha256("sample|" + now.toISOString() + "|" + templateId)`;
  - (e) a `final-reminder` whose dispatch threw still reaches `notifyOfficeUnpaid`.
- [ ] **Step 3: Compile like the deploy.** Run the Task 2 Step 2 command. Expected: no output, exit 0.
- [ ] **Step 4: Commit.**
  - Files: `git add apps/functions/src/membership-reminders/payment-reminder-service.ts`
  - Message: `git commit -m "feat(functions): payment reminder run service"`

### Task 5: Firestore and Auth adapter, the unpaid notice, ids

**Files:**
- Create: `apps/functions/src/membership-reminders/payment-reminder-firestore.ts`
- Modify: `apps/functions/src/notifications/notification-identifiers.ts`. Add `unpaidNotificationId(membershipId: string, endsAt: string): string` (`unpaid-` + sha256 hex of `${membershipId}|${endsAt}`), next to `expiryNotificationId`.
- Modify: `apps/functions/src/notifications/admin-notification-service.ts`. Add `createUnpaidMembershipNotice(db: Firestore, input: { academyId: string; membershipId: string; studentId: string; endsAt: string; memberName: string; planName: string }): Promise<void>`.

**Interfaces:**
- Consumes Task 4's `PaymentReminderPorts` and Task 1's schemas.
- Produces `createPaymentReminderPorts(db: Firestore, auth: Auth, academyId: string, dispatcher: { dispatch: (request: unknown) => Promise<DeliveryHistoryRecord> } | null): PaymentReminderPorts`. With `null` (dry-run), `ports.dispatch` throws `Error("Dispatch is disabled in dry-run")`.
- Produces `unpaidNotificationId`, which Task 6 uses, and `createUnpaidMembershipNotice`, which this task's adapter uses.

- [ ] **Step 1: Write `createUnpaidMembershipNotice`.**
  - It runs in a transaction, like `syncSubscriptionNotice`, because a scheduler snapshot can predate a renewal:
    1. Re-read `academies/{a}/memberships/{membershipId}`.
    2. Continue only if its raw `endsAt === input.endsAt` and its status is `active` or `overdue`.
    3. Create `academies/{a}/adminNotifications/{unpaidNotificationId}` with `adminNotificationSchema.parse`, only when that document does not exist yet.
  - Fields:
    - `kind: "membership-unpaid"`;
    - `title: "Membership still unpaid after reminders"`;
    - `message: "<memberName>'s membership ended on <when(endsAt,false)> and is still unpaid after the automatic reminders."`;
    - `href: /admin/members/profile?id=<studentId>&tab=payments`;
    - `membershipId`, `studentId`, and `endsAt: new Date(endsAt).toISOString()`;
    - `details: { from: memberName, amount: null, facts: [Member, Plan, Ended] }`.
  - It copies the `syncSubscriptionNotice` (lines 22-111) field style. Notices are staff-only, so the member name is allowed here.
- [ ] **Step 2: Write the adapter.**
  - **`listCandidates`.** Use the exact query of `admin-notification-triggers.ts:65-99`: `collectionGroup("memberships")`, `endsAt > fromIso`, `<= toIso`, `orderBy("endsAt")`, pages of 200. Then:
    - keep only paths under `academies/{academyId}/memberships/`;
    - skip `source === "legacy-import"`;
    - skip, without throwing, any other `source`, counting it in logs;
    - `parseMembershipRecord` from `@bpt-jersey/domain/memberships/lifecycle`.
    - Copy the renewal rule from `apps/functions/src/memberships/intro-application-admin-service.ts:182-196`. Query `memberships where studentId == X limit 20` per candidate. Drop the candidate when its student has more than one live (non-cancelled, non-legacy) membership, or when any non-legacy membership of that student fails `parseMembershipRecord`.
  - **`loadPendingStudentIds`.** `academies/{a}/membershipApplications where status == "pending_review"`, then a Set of `studentId`. Match the stored `studentId` only. This is an accepted risk: an intro conversion with a non-canonical id is for members without a live paid membership.
  - **`loadPlans`.** `academies/{a}/plans` with `parsePlanRecord` (`@bpt-jersey/domain/memberships`).
  - **`loadComplimentaryIds`.** `getAll` on `membershipAdministration/{id}` where `complimentary === true`. An empty `ids` returns an empty Set without calling `getAll`.
  - **`loadStates`.** `getAll` on `membershipReminders/{id}`, parsed with `membershipReminderStateSchema`. Skip invalid documents and log them by id. An empty `ids` returns an empty Map.
  - **`saveStep`.** Write `membershipReminders/{membershipId}`, overwriting the whole document after parsing it. If `previous?.endsAt !== endsAt`, start a fresh state containing only this step. This is the Review Focus 2 pin.
  - **`resolveRecipient`.** Follow the spec's recipient table row by row.
    - Parse `academies/{a}/students/{studentId}` with `parseEffectiveStudentProfileAt(data, todayKey)` (`@bpt-jersey/domain/profiles`).
    - Write `authEmail(uid)` as `(await auth.getUser(uid).catch(() => null))?.email`.
    - **Adult**, `participantType === "adult"`. `memberFirstName = null`, and the greeting comes from `student.fullName`:
      - with `student.userId`, the email is `authEmail(student.userId)`;
      - without it, the email is `student.email`.
    - **Minor**, any other type. **Never use `students.userId`.** Read `academies/{a}/families/{candidate.familyId}` with `parseFamilyRecord` (`@bpt-jersey/domain/families`), and set `memberFirstName` to the first word of `student.fullName`.
      - If `primaryContactUserId` is set, the email is `authEmail(primaryContactUserId)`. The greeting comes from the raw `academies/{a}/users/{uid}` `.get("displayName")` when it is a non-empty string, copying `describer` in admin-notification-triggers.ts:29-46, otherwise from the Auth `displayName`. `parseUserProfile` is too strict for this.
      - Otherwise the email is `guardianContact.email`, and the greeting comes from `guardianContact.fullName`.
    - **First names.** Take the first whitespace-separated word. A blank greeting becomes `"there"`, giving «Hi there,». A blank `memberFirstName` becomes `null`, so the self template is used. Never pass an empty variable.
    - Return `null` when the email is missing or fails `/^[^\s@]+@[^\s@]+\.[^\s@]+$/u`, so a bad address gives `no-email` (Review Focus 4).
  - **`notifyOfficeUnpaid`.** Read the member name from `students.fullName` and call `createUnpaidMembershipNotice` (Step 1).
- [ ] **Step 3: Compile like the deploy.** Run the Task 2 Step 2 command. Expected: no output, exit 0.
- [ ] **Step 4: Commit.**
  - Files: `git add apps/functions/src/membership-reminders/payment-reminder-firestore.ts apps/functions/src/notifications/notification-identifiers.ts apps/functions/src/notifications/admin-notification-service.ts`
  - Message: `git commit -m "feat(functions): payment reminder Firestore adapter and unpaid notice"`

### Task 6: Resolve the unpaid notice on renewal, pause or cancel

**Files:**
- Modify: `apps/functions/src/notifications/admin-notification-service.ts`. Add `resolveUnpaidMembershipNotice(db: Firestore, reference: DocumentReference, previousEnd: string | null): Promise<void>`.
- Modify: `apps/functions/src/notifications/admin-notification-triggers.ts:49-62`, `subscriptionExpiryNoticeWritten`. Call `resolveUnpaidMembershipNotice(getFirestore(), event.data.after.ref, typeof oldEnd === "string" ? oldEnd : null)` after `syncSubscriptionNotice`.

**Interfaces:**
- Consumes `unpaidNotificationId` (Task 5).

- [ ] **Step 1: Write `resolveUnpaidMembershipNotice`.**
  - When `previousEnd` is a string, resolve the notice `unpaidNotificationId(membershipId, previousEnd)` if all of these hold: the notice exists; it is unresolved; and either the membership is missing, its status is `cancelled` or `paused`, or its `endsAt !== previousEnd`.
  - Resolving sets `{ resolvedAt: now, readAt: now }`, in a transaction like lines 22-111.
  - The trigger keeps `retry: true`.
- [ ] **Step 2: Inspect Review Focus 2.** Confirm that a renewal changing `endsAt` resolves the old notice, and that the job's next run starts a fresh state (Task 5 `saveStep`).
- [ ] **Step 3: Compile like the deploy.** Run the Task 2 Step 2 command. Expected: no output, exit 0.
- [ ] **Step 4: Commit.**
  - Files: `git add apps/functions/src/notifications/admin-notification-service.ts apps/functions/src/notifications/admin-notification-triggers.ts`
  - Message: `git commit -m "feat(functions): unpaid notice resolves on renewal, pause or cancel"`

### Task 7: The scheduled job

**Files:**
- Create: `apps/functions/src/membership-reminders/payment-reminder-schedule.ts`
- Modify: `apps/functions/src/index.ts`. Add `export { membershipPaymentRemindersSchedule } from "./membership-reminders/payment-reminder-schedule.js";` next to the notifications exports (lines 259-269).

**Interfaces:**
- Consumes Tasks 3, 4 and 5, `createDeliveryDispatcher` and `createFirestoreDeliveryHistoryStore` (`delivery/delivery-service.ts`), and `coursesAcademyId` (`courses/course-public-http.ts:10`, imported, never redefined).

- [ ] **Step 1: Write the job.**
  - Options: `onSchedule({ schedule: "0 9 * * *", timeZone: "Europe/Jersey", timeoutSeconds: 540, memory: "512MiB", maxInstances: 1, secrets: sesSecrets }, …)`, with no `retryCount`. A failed day is caught up by the windows.
  - **Startup.** If `academyId` is empty, return. Get `mode = parseReminderMode(reminderMode.value())`; `off` logs and returns.
  - **`test` mode.** The recipient must pass the email pattern, or log an error and return. Then call `sendPaymentReminderSamples` with an SES dispatcher. No member data is read.
  - **`live` mode.** `REMINDER_START_DATE` must match `^\d{4}-\d{2}-\d{2}$`, or log an error and return.
  - **`dry-run` mode.** An empty start date means `dateKeyInJersey(now)`. Anything else must match the same pattern, or log an error and return.
  - **`test` mode** ignores `REMINDER_START_DATE`.
  - **Every run** logs the mode and the start date it used, next to the counts.
  - **Wiring.** The SES dispatcher is `createDeliveryDispatcher({ provider: createSesDeliveryProvider({ send: createSesSendFromEnvironment(sesRegion.value()), from, replyTo }), history: createFirestoreDeliveryHistoryStore({ firestore: getFirestore() as unknown as GenericDeliveryFirestore }) })`. Build it only in `test` and `live`.
  - **Run.** Call `runPaymentReminders` with `cap: 30`. Log the summary with `logger.info` (counts only).
- [ ] **Step 2: Inspect Review Focus 5.** Confirm that `test` builds no ports and never calls `createPaymentReminderPorts`, and that `dry-run` never builds the SES client.
- [ ] **Step 3: Compile like the deploy.** Run the Task 2 Step 2 command. Expected: no output, exit 0.
- [ ] **Step 4: Commit.**
  - Files: `git add apps/functions/src/membership-reminders/payment-reminder-schedule.ts apps/functions/src/index.ts`
  - Message: `git commit -m "feat(functions): daily membership payment reminders job"`

### Task 8: Office surfaces and member delete

**Files:**
- Modify: `apps/functions/src/memberships/manual-subscription-service.ts:487-490` and `:524-576`, `listSubscriptionBilling`:
  - add `base.collection("membershipReminders").doc(document.id).get()` to the `Promise.all`;
  - return `lastReminder: lastReminderOf(state)`, where `state` is `membershipReminderStateSchema.safeParse(snapshot.data())` when it succeeds and `null` when the document is missing or invalid.
- Modify: `apps/functions/src/members/member-delete-callables.ts:126-129`. Push `firestore.doc(`${root}/membershipReminders/${membership.id}`)` inside the membership loop, and update the comment block at 33-45 if it lists collections.
- Modify: `apps/web/src/app/admin/members/profile/payments-tab.tsx:111-120`. After the complimentary block, add one `<p>` per item with `lastReminder`, in this form: `Last reminder: 13 Nov 2026 · Payment due (3 of 4) · Sent (period ending 12 Nov 2026)`.
  - The first date is `lastReminder.at`, when the email went out. The second is `lastReminder.endsAt`.
  - Format both with `toLocaleDateString("en-GB", { timeZone: "Europe/Jersey", day: "numeric", month: "short", year: "numeric" })`.
  - Step labels: Ends in 7 days, Ends tomorrow, Payment due, Final reminder.
  - Outcome labels: Sent, Not sent: no email on file, Not sent: dry run, Failed.

The notification panel labels moved to Task 1.

- [ ] **Step 1: Make the three changes.**
- [ ] **Step 2: Compile.**
  - Functions: run the Task 2 Step 2 command. Expected: no output, exit 0.
  - Web: run `corepack pnpm --filter @bpt-jersey/web exec tsc --noEmit`. Expected: no error in any file outside `*.test.ts` / `*.test.tsx`. The 2 known errors live in test files.
- [ ] **Step 3: Commit.**
  - Files: `git add apps/functions/src/memberships/manual-subscription-service.ts apps/functions/src/members/member-delete-callables.ts apps/web/src/app/admin/members/profile/payments-tab.tsx`
  - Message: `git commit -m "feat: last payment reminder on the Payments tab"`

### Task 9: Operator kit, guide and rollout

**Files**, outside the repo, with no commit:
- Create: `/root/bpt-runbook/recordatorios-pago-2026-11/GUIA.md` and `GUIA.html`, built with `python3 ~/.claude/skills/crear-guias/build_guide.py`, in Spanish, following Luis's golden rule.
- Create: `/root/bpt-runbook/recordatorios-pago-2026-11/publicar.sh`. It is modelled on `ahorro-2026-11-03/publicar.sh`, with the base and head SHAs fixed at writing time.
- Create: `/root/bpt-runbook/recordatorios-pago-2026-11/comprobar-web.py`. It is modelled on `ahorro-2026-11-03/comprobar-web.py` and checks that the live bundle contains both `Last reminder: ` and `Unpaid membership`.
- Create: `/root/bpt-runbook/recordatorios-pago-2026-11/desplegar-functions.sh` and `funciones.txt`, run through `p06-cuenta-servicio/desplegar-p06.sh`. The list has 6 names: `listAdminNotifications`, `updateAdminNotification`, `subscriptionExpiryNoticeWritten`, `listMemberSubscriptionBilling`, `deleteMemberAccount`, `membershipPaymentRemindersSchedule`. They fit in one batch: the job's first deploy is in `dry-run` and writes no notice.
- Create: `/root/bpt-runbook/recordatorios-pago-2026-11/comprobar.py`, read-only. It reports:
  - the Scheduler job state and last status;
  - the last run's summary log line, including the mode and start date;
  - a COUNT of `membershipReminders`.
- Do **not** edit `p06-cuenta-servicio/comun.sh` or `verificar.py` when writing the kit. Before the SES secrets exist, the deploy pre-flight `verificar.py --exigir permisos` would fail for every kit. The guide edits them at the right moments, in steps 7 and 12.

- [ ] **Step 1: Write the guide.** The steps are in this order; each production step is marked ⚠️ and gives its expected output.
  1. **AWS account.** Create it under `andres.san1404@gmail.com` with MFA on the root user, pick SES region eu-west-3 and pay-as-you-go pricing.
  2. **Domain identity.** Verify `mail.bptjersey.com` with Easy DKIM. The 3 CNAMEs go in Cloudflare as **DNS only**.
  3. **MAIL FROM.** Set a custom MAIL FROM `bounce.mail.bptjersey.com`: `MX 10 feedback-smtp.eu-west-3.amazonses.com` and `TXT v=spf1 include:amazonses.com ~all`.
  4. **DMARC.** Add `_dmarc.bptjersey.com` with `v=DMARC1; p=none; rua=mailto:bptjersey@gmail.com`.
  5. **Test recipient.** Verify Luis's address as a sandbox recipient.
  6. **IAM user.** Create one whose policy allows only `ses:SendEmail` on the identity, with condition `ses:FromAddress = membership@mail.bptjersey.com`, and create its access keys.
  7. **Secrets.**
     - (a) Run `corepack pnpm exec firebase functions:secrets:set SES_ACCESS_KEY_ID --project bptjersey-f5a25` and the same for `SES_SECRET_ACCESS_KEY`, pasting at the hidden prompt.
     - (b) Only then add both names to `SECRETS` in `comun.sh` and `KNOWN_SECRETS` in `verificar.py:64-68`, and run `02-permisos-bpt-functions.sh` to grant `secretAccessor`.
  8. **Production access.** Request it, using the guide's ready-made text in English.
  9. **`.env`.** Add the six params to `apps/functions/.env`, with `REMINDER_MODE=dry-run` and `REMINDER_START_DATE` = **the first day of the dry run**. That way the dry run also shows collection steps for periods ending that week. Nothing is sent in dry run.
  10. **Publish.** Run `publicar.sh`, which publishes the web, and wait for `comprobar-web.py` to print the new bundle.
  11. **Deploy.** Run `desplegar-functions.sh`.
  12. **Scheduled-service permissions.** Before the job's first 09:00 run, give `membershippaymentremindersschedule` the same `run.invoker` set-up as the other P-06 scheduled services. Check first how `comun.sh` `SCHED_SERVICES`, `02-permisos-bpt-functions.sh` and `vigilar.py` handled `keephotfunctionswarm`. Then run `python3 -I verificar.py` as a full report and check that the new Scheduler job's OIDC account is `bpt-functions`.
  13. **Dry run.** Seven days, checked with `comprobar.py`.
  14. **Test mode.** Set `REMINDER_MODE=test`, redeploy only the job, force-run it in Cloud Scheduler, and check in Gmail that «Show original» shows SPF/DKIM/DMARC = PASS. Then set it back to `dry-run`.
  15. **Live.** Once production access is granted, make one `.env` edit and redeploy only the job:
      - `REMINDER_MODE=live`;
      - `REMINDER_START_DATE` = **today's Jersey date**, never an earlier one, so the first live run sends no collection emails for periods that ended before go-live (D27).

      Afterwards `comprobar.py` must show `live` and that date.
  16. **Rollback.** Set `REMINDER_MODE=off` and redeploy the job.
- [ ] **Step 2: Dry-run review checklist**, written into the guide, covering Review Focus 1, 2 and 4:
  - the Payments tab «dry run» lines show a date equal to the member's end date on `/account/membership`;
  - a member renewed during the week shows the new end date only;
  - the `dryRunNoEmail` count is visible, and those members appear nowhere as «no email» on the Payments tab.

  It also has two steps for the office and the owner, both from the spec:
  - the office reviews the 13 `active` memberships whose end date has passed, since D27 leaves them out;
  - the owner adds Amazon SES (eu-west-3) and the "payment reminders" purpose, with lawful basis contract (D25), to the T011 processor register.
- [ ] **Step 3: Write `publicar.sh`, `desplegar-functions.sh`, `comprobar.py` and `comprobar-web.py`.** Dry-run each of them: answer `n` and check the guards. Expected: "Cancelado" or the read-only output, and no production change.
- [ ] **Step 4: Hand over to Luis.** Send the guide paths and the order «guía pasos 1-9 → publicar → desplegar → paso 12». Production steps run only after his explicit OK in chat.
