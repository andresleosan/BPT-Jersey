# Membership payment reminder emails

Date: 2026-11-03. Approved by Luis in chat («aprobado») on 2026-11-03, after the builder check and
his answers to D25 and D29.

## Why

Today nothing in the platform emails a member. The only emails are the Firebase Auth templates
(password reset, verify email). When a renewal is not paid, the office writes to the member by
hand ("enviamos correo para el cobro"). Members can already renew by themselves in
`/account/membership`: they pay by bank transfer and upload the transfer reference and a
screenshot, then the office reviews it. What is missing is telling them, at the right moment, to
go there.

Production reading on 2026-11-03 (COUNT aggregations only, no documents read):

- There are 144 memberships, all `active`. 27 end in the next 30 days and 3 in the next 7.
  31 have `endsAt = null`, and 13 have an `endsAt` in the past but are still `active`.
- There are 178 active students, and 155 of the 160 user profiles have an email.
- Worst case is about 27 × 4 ≈ 110 reminder emails a month, a few a day. Amazon SES costs about
  USD 0.10 per 1,000, so this is cents a month.

Success means the following:

- Members renew before or just after their end date without the office writing to them.
- The office only follows up the few still unpaid after the last reminder.
- The office can see in the member's profile exactly what was sent and when.

## Goals

1. A daily job at 09:00 Europe/Jersey sends up to four reminders for each membership period: 7 days
   before `endsAt`, 1 day before, 1 day after and 7 days after.
2. Each reminder is sent at most once. The reminders stop by themselves in any of these cases:
   - the member renews, because `endsAt` changes;
   - the membership is cancelled or paused;
   - the member has a renewal waiting for office review.
3. The email reaches the right person: the adult member, or for a minor the family's paying
   contact. Members with no reachable email are skipped and recorded.
4. Once the reminder window has passed, the office gets an admin notice,
   «Membership still unpaid after reminders», linking to the member's Payments tab. The notice
   resolves itself on renewal or cancellation.
5. The member's Payments tab shows the last reminder: date, step and outcome.
6. The emails go out through Amazon SES in eu-west-3 (Paris) from `mail.bptjersey.com`, with SPF,
   DKIM and DMARC aligned. Replies go to the academy's inbox.
7. The rollout is safe. A mode switch, off / dry-run / test / live, defaults to dry-run, and each
   run has a hard cap on emails.

## Non-goals

- Emails about classes: cancellations, reminders and schedule changes. They are a separate second
  task (Luis, 2026-11-03).
- Changing any membership status or any access rule. There is no automatic `overdue` marking and
  no blocking.
- Amounts, invoices, bank details or attachments in the email.
- A member-facing email preference screen or unsubscribe link. These are service messages; see
  Data protection.
- Grouping several children's reminders into one email.
- Free-trial expiry (`trialAccess`), pay-as-you-go and marketing emails.
- Bounce or complaint webhooks. Version 1 relies on the SES account-level suppression list.

## Anti-goals

The design has failed if any of the following happens, even when it otherwise works:

- A reminder reaches a member who has already renewed or whose renewal is waiting for review.
- A member receives the same reminder twice, or more than one reminder for the same membership on
  the same day.
- Logs, delivery history or reminder records contain names, emails or other personal data.
- Emails land in spam because the sending domain is not authenticated.
- An email links anywhere other than `https://www.bptjersey.com`, or asks the member to pay a bank
  account.

## Decisions

Who decided each point and where. "Claude's call" marks a default Luis has not explicitly
confirmed; he should check those while reading.

| # | Decision | Who | Where |
| --- | --- | --- | --- |
| D1 | The provider is Amazon SES, region eu-west-3 (Paris). Resend was rejected because it stores data in the US even when sending from its EU region | Luis | chat 2026-11-03, "me parece bien lo de amazon ses" |
| D2 | Payment and renewal reminders come first; class emails are a second task | Luis | chat 2026-11-03, "los recordatorios para que pague las suscripciones" and "me parece bien" |
| D3 | The automatic emails after the end date replace the office's manual collection emails | Luis (current practice) | chat 2026-11-03, "enviamos correo para el cobro" |
| D4 | Claude writes the email copy (below) | Luis delegated | chat 2026-11-03, "redacta las guias tu" |
| D5 | The sequence is −7, −1, +1 and +7 days around `endsAt`, followed by an office notice | Claude's proposal, accepted | chat 2026-11-03 |
| D6 | The emails never change status or access | Claude's proposal, accepted | chat 2026-11-03 |
| D7 | The recipient is the account holder, or for a minor the family's paying contact | Claude's proposal, accepted | chat 2026-11-03 |
| D8 | From `BPT Jersey <membership@mail.bptjersey.com>`, Reply-To `bptjersey@gmail.com` | Claude's call | chat 2026-11-03 |
| D9 | The email shows no amount, because a wrong amount in a payment email is worse than none | Claude's call | chat 2026-11-03 |
| D10 | No reminder while the member has a renewal waiting for review. The chat said this for the after-date emails; this document extends it to all four | Claude's call | chat 2026-11-03 + this document |
| D11 | The call to action is `https://www.bptjersey.com/account/membership` | Claude's call | chat 2026-11-03 |
| D12 | The office sees the last reminder on the member's Payments tab | Claude's proposal, accepted | chat 2026-11-03 |
| D13 | Sending practices: own subdomain, SPF/DKIM/DMARC, a person reads replies, one purpose per email, no tracking, text + HTML, phased rollout | Claude's advice, accepted | chat 2026-11-03 |
| D14 | English, sent at 09:00 Europe/Jersey | Claude's call | chat 2026-11-03 |
| D15 | Claude writes Luis a step-by-step guide for the SES account and the DNS records | Claude's commitment | chat 2026-11-03 |
| D16 | DNS records are added in Cloudflare, because the bptjersey.com nameservers are Cloudflare's | Fact | DNS query 2026-11-03 |
| D17 | Scope: status `active` or `overdue`, a monthly or term plan with a price above zero, an `endsAt`, and not complimentary | Claude's call; the complimentary exclusion came from the builder check | this document |
| D18 | Each step has a send window, and at most one step per membership per run | Claude's call | this document |
| D19 | One email per membership; children are not grouped | Claude's call | this document |
| D20 | The footer uses the Town office address | Claude's call | this document |
| D21 | Email addresses come from Firebase Auth for accounts with a login | Claude's call | this document |
| D22 | Reminder state is one document per membership, plus the existing delivery history once its full read is fixed | Claude's call | this document |
| D23 | Modes are off / dry-run / test / live, defaulting to dry-run, with at most 30 emails per run | Claude's call | this document |
| D24 | The SES client is `@aws-sdk/client-sesv2` at the version the repo already pins | Claude's call | this document |
| D25 | Lawful basis: service messages under the membership contract, so no opt-in and no unsubscribe link | Luis, for the owner | chat 2026-11-03, «1 si» |
| D26 | The AWS account is opened under `andres.san1404@gmail.com`, the platform owner's email. It is only the AWS login and billing contact, never visible to members. The account root user gets MFA, and day-to-day sending uses the restricted IAM user | Luis | chat 2026-11-03, «la cuenta de amazon a nombre de andres.san1404@gmail.com» |
| D27 | Only cycles whose end date falls on or after the go-live date get reminders. Older and stale records stay with the office | Claude's call, from the builder check | this document |
| D28 | Version 1 does not go through the notification-preference policy and adds no purpose to it. On 2026-11-03 production had 0 preference documents | Claude's call, from the builder check | this document |
| D29 | `endsAt` is the only sign that a member has paid. Whenever the office takes or records a payment, it also renews the subscription, so the job does not check Finance payments or invoices | Luis | chat 2026-11-03, «2 si» |

## Behaviour

### Which memberships get reminders

A membership is in scope when **all** of these are true:

- its status is `active` or `overdue`. `trial`, `paused` and `cancelled` are out. A paused member
  cannot book anyway, and pausing does not move `endsAt`.
- it has an `endsAt`.
- its plan has `billingPeriod` `monthly` or `term`, and a price above zero. This excludes
  pay-as-you-go plans (`per-session`) and Transit Free.
- it is not complimentary: `academies/{a}/membershipAdministration/{membershipId}` does not have
  `complimentary: true`. On 2026-11-03, 39 of the 225 administration documents were complimentary,
  for example staff and waived plans. Read the administration documents only for memberships
  already in the query window.
- its end date (Jersey date) is on or after the go-live date (D27), a `defineString` param
  `REMINDER_START_DATE` in `YYYY-MM-DD`. Dry-run uses the same rule with the planned date. This
  stops the first live run from sending collection emails for periods that ended earlier. The 13
  `active` memberships with a past `endsAt` belong to the office.
- the member can renew it from `/account/membership`. The builder checks how the renewal flow
  treats "legacy" memberships and applies the same rule here.

Today term (kids) plans approved through the intro flow have `endsAt = null`, so in practice only
the term memberships the office gave an end date get reminders.

### The sequence

Days are counted in Europe/Jersey calendar dates:

`d = (Jersey date of endsAt) − (Jersey date of the run)`

The end date shown in the email must use the same date the member sees on `/account/membership`.

| Step | Name | Sent when | Purpose |
| --- | --- | --- | --- |
| 1 | `ends-in-7` | 2 ≤ d ≤ 7 | Friendly notice with the end date |
| 2 | `ends-tomorrow` | d = 1 | Short reminder |
| 3 | `payment-due` | −6 ≤ d ≤ −1 | First collection email |
| 4 | `final-reminder` | −13 ≤ d ≤ −7 | Last automatic email. In the same run, the office notice is created |

Rules:

- **Latest step only.** On each run, for each membership, take the latest step whose window
  contains today. If that step has not yet been processed for this `(membershipId, endsAt)`,
  process it. An earlier step that was missed is never sent late. That happens for example when
  the membership was created 3 days before its end, or when a run failed.
- **New cycle on renewal.** A renewal or extension changes `endsAt` on the same membership
  document. That starts a new cycle with all four steps available again.
- **Suppression.** A membership whose `studentId` has a `membershipApplications` document with
  `status == "pending_review"` is skipped. One equality query per run builds the set. A suppressed
  step is not marked as processed, so it can still go out inside its window if the request comes
  back `needs_correction` or `rejected`. If the request is approved, `endsAt` moves and a new
  cycle starts.
- **Payments (D29).** `endsAt` is the only signal that a member has paid, because the office always
  renews the subscription when it takes or records a payment. The job reads no Finance payments
  and no invoices.
- **Office notice.** When step 4 is processed, create an admin notice of a new kind, «Membership
  still unpaid after reminders». It is created whatever the email outcome, even "no email on
  file", so nobody falls through. The rest works like the existing subscription-ending notice:
  - Its id is deterministic and keyed on `(membershipId, endsAt)`.
  - It links to `/admin/members/profile?id=<studentId>&tab=payments`.
  - It resolves itself when `endsAt` changes or the membership becomes `cancelled` or `paused`.
- **Safety cap.** At most 30 emails per run. When there are more, log it and leave the rest for
  the next run, which the windows allow.

### Who receives it

Start from `academies/{a}/memberships/{id}` and its `studentId` and `familyId`:

| Member | Recipient address | Greeting |
| --- | --- | --- |
| Adult with a login (`students.userId`) | Firebase Auth email of that user | First word of `students.fullName` |
| Minor in a family with a login (`families.primaryContactUserId`, which equals `billingContactUserId`) | Firebase Auth email of that contact | First word of `users/{uid}.displayName`, and the child's first word of `fullName` |
| Minor in an office-managed family (contacts null, `guardianContact.email` present) | `guardianContact.email` | First word of `guardianContact.fullName`, plus the child's name |
| Adult created by the office with no login | `students.email`, if present | First word of `fullName` |
| Anything else (no address, or an address that fails a basic syntax check) | none: skip and record "no email on file" | — |

Firebase Auth is read directly with `getUser(uid)`. `users/{uid}.email` can lag behind an email
change until the member opens their settings. A guardian with two children whose memberships end
together gets two emails, one per child.

### The emails

Every email has:

- a plain-text part and an HTML part, with the same words in both;
- inline styles only, using the BPT brand from `DESIGN.md`;
- a layout that reads well with images blocked;
- no tracking pixel and no rewritten links;
- all variables HTML-escaped.

`{planName}` comes from `academies/{a}/plans/{planId}.displayName`. In the samples below, Sam is
the member and the plan is "Adults Unlimited".

**Step 1, `ends-in-7`.** Subject: `Your BPT Jersey membership ends on 12 November`

> Hi Sam,
>
> Your Adults Unlimited membership ends on **Wednesday 12 November**.
> To keep training without interruption, renew in your account before then:
>
> **[ Renew my membership ]**
>
> You can pay by bank transfer and upload the screenshot there, or pay at reception.
> If you've already renewed, thank you, you can ignore this email.
>
> See you on the mats,
> The BPT Jersey team

**Step 2, `ends-tomorrow`.** Subject: `Reminder: your membership ends tomorrow`

> Hi Sam,
>
> Just a reminder that your Adults Unlimited membership ends tomorrow, Wednesday 12 November.
>
> **[ Renew my membership ]**
>
> If you've already paid, thank you, there's nothing else to do.
> The BPT Jersey team

**Step 3, `payment-due`.** Subject: `Your BPT Jersey membership payment is due`

> Hi Sam,
>
> Your Adults Unlimited membership ended on 12 November and we haven't received your renewal yet.
> Please renew in your account as soon as you can:
>
> **[ Pay and renew ]**
>
> If you've already sent the transfer, thank you, we'll confirm it shortly.
> If you'd like to change or pause your plan, just reply to this email and we'll help.
> The BPT Jersey team

**Step 4, `final-reminder`.** Subject: `Second reminder: membership payment due`

> Hi Sam,
>
> We still haven't received the renewal for your Adults Unlimited membership, which ended on
> 12 November.
>
> **[ Pay and renew ]**
>
> This is our last automatic reminder. If there's a problem with the payment, or you'd like to stop
> or change your membership, just reply and we'll sort it out together.
> The BPT Jersey team

**Guardian variant.** The greeting names the guardian, and the sentence names the child, for
example «Hi Ana, Leo's Junior membership ends on Wednesday 12 November.». The same pattern
applies in every step.

**Footer, all emails.** «BPT Jersey · Office 9, 13 Library Place, St Helier, Jersey JE2 3RR ·
You're receiving this because you have a membership with BPT Jersey. Questions? Just reply to this
email.»

**Buttons.** Every button links to `https://www.bptjersey.com/account/membership`.

**Headers.** From `BPT Jersey <membership@mail.bptjersey.com>`, Reply-To `bptjersey@gmail.com`.

### What the office sees

- **Payments tab** (`apps/web/src/app/admin/members/profile/payments-tab.tsx`). One line per
  membership, for example «Last reminder: 13 Nov 2026 · Payment due (3 of 4) · Sent». The outcome
  is one of `Sent`, `Not sent: no email on file`, `Not sent: dry run` or `Failed`.
  - The data comes from an optional per-membership field returned by
    `listMemberSubscriptionBilling`.
  - The web must accept that field, defaulting to null, **before** the function returns it,
    because the parsers are strict.
- **Admin inbox.** The new «Membership still unpaid after reminders» notice described above. Its
  kind needs a label and a filter entry in the notifications panel, and the web must ship first.

### Where the state lives

- **`academies/{a}/membershipReminders/{membershipId}`.** One small document per membership:
  `endsAt` for the current cycle, the processed steps with their time and outcome, and
  `schemaVersion`. It holds no personal data. The billing callable reads it with a plain `get`,
  so no index is needed. When `endsAt` differs from the stored cycle, the document counts as a
  fresh cycle. Dry-run outcomes are shown but do not count as processed.
- **Delivery history.** The existing dispatcher (`apps/functions/src/delivery/delivery-service.ts`)
  keeps idempotency and bounded retries per `deliveryId`, where
  `deliveryId = sha256(membershipId | endsAt | step)`.
  - Fix first: `createFirestoreDeliveryHistoryStore.getLatest` reads the whole `deliveryEvents`
    collection on every send (lines 261-284). Read the at most three documents
    `delivery_{deliveryId}_{1..3}` by id instead.
- **Member hard delete.** It must also remove `membershipReminders/{membershipId}`. The admin
  notice is already covered, because the hard delete clears `adminNotifications`.

### Sending infrastructure

**SES client.** Use `@aws-sdk/client-sesv2` pinned to the same version as the repo's
`@aws-sdk/client-s3` (3.1107.0). It reuses the already-locked `@aws-sdk/core` and `@smithy/*`
tree, adding about one lockfile entry. Commit `pnpm-lock.yaml` with it, or the P-02 deploy
lockfile check fails. The call is `SendEmail` with `Content.Simple` (subject, text, HTML) plus
`FromEmailAddress` and `ReplyToAddresses`.

**SES provider adapter.** It implements the existing `ExternalDeliveryProvider`:

- throttling and 5xx errors are retryable;
- rejected messages, an unverified identity or a suspended account are not, and get logged
  loudly.

**Credentials.**
- Two Firebase secrets, `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`, bound only to the
  reminder job. They follow the R2 pattern: `defineSecret`, the `secrets: [...]` option and a
  cached client, as in `apps/functions/src/storage/r2-client.ts`.
- An IAM user that may only call `ses:SendEmail` on the `mail.bptjersey.com` identity in
  eu-west-3, with `ses:FromAddress` restricted to `membership@mail.bptjersey.com`.

**Settings.** These are `defineString` params, so they travel with the deploy and fail closed:
- `SES_REGION`, default `eu-west-3`;
- `REMINDER_FROM`;
- `REMINDER_REPLY_TO`;
- `REMINDER_MODE`, default `dry-run`;
- `REMINDER_TEST_RECIPIENT`, used only in test mode.

**Modes.**
- `off`: does nothing.
- `dry-run`: computes everything and records `dry run` outcomes. It sends nothing and writes no
  delivery events.
- `test`: sends the four steps in both variants, built from synthetic data, only to
  `REMINDER_TEST_RECIPIENT`, and reads no member addresses.
- `live`: sends for real.

**The job.** Copy the `buildLeaderboards` schedule pattern
(`apps/functions/src/competitors/competitors-callables.ts:34-44`):
- `onSchedule` with `schedule: "0 9 * * *"` and `timeZone: "Europe/Jersey"`;
- `maxInstances: 1`, `timeoutSeconds: 540`;
- the academy id from `defineString("COURSES_ACADEMY_ID")`.

**The query.** Copy the existing expiry sweep
(`apps/functions/src/notifications/admin-notification-triggers.ts:65-99`):
`collectionGroup("memberships")` with `endsAt` greater than now − 14 days and at most now + 8 days,
`orderBy("endsAt")`, pages of 200. The existing `memberships.endsAt` collection-group field
override serves it (`firestore.indexes.json:1061-1078`), so no new index is needed. Filter status
and plan in memory.

**Logs.** Counts per step and outcome, plus internal ids at most. Never an address or a name.

**DNS (Cloudflare).** Luis adds these by following the guide:
- the three SES Easy DKIM CNAMEs for `mail.bptjersey.com`, set to **DNS only**, not proxied;
- a custom MAIL FROM `bounce.mail.bptjersey.com`, with
  `MX 10 feedback-smtp.eu-west-3.amazonses.com` and `TXT "v=spf1 include:amazonses.com ~all"`;
- `_dmarc.bptjersey.com` set to `v=DMARC1; p=none; rua=mailto:bptjersey@gmail.com`, moving to
  `quarantine` after a clean month.

**SES account.**
- Choose the pay-as-you-go pricing. New accounts may start on a higher-priced plan.
- Request production access with the guide's ready-made text. The review can take up to 4 days.
- Keep the account-level suppression list for bounces and complaints turned on.

### Data protection

- **Lawful basis (D25, confirmed).** These are service messages that perform the membership
  contract. They are not marketing, so no opt-in and no unsubscribe link. The owner records the
  purpose and the lawful basis in the T011 processing register.
- **Notification-preference policy (D28).**
  - The existing policy (`packages/domain/src/delivery/notification-policy.ts:179-257`) requires
    `consentState: "granted"` and skips any intent that has no stored preference.
  - Nothing calls it today, and production holds 0 preference documents. Routing through it
    would send nothing.
  - The reminder job therefore builds the delivery requests and calls the dispatcher directly.
    The policy and its purposes stay as they are.
- **New processor.** Add Amazon SES (eu-west-3) to the T011 processor register. AWS's GDPR data
  processing addendum is part of its service terms. The data stays in the EU, so no transfer
  impact assessment is needed
  (`docs/operations/t011-retention-residency-deletion-decision-packet.md:104-106`).
- **What goes into the email.** Only the first name, the child's first name for guardians, the
  plan name and the end date.

### Rollout

1. Publish the web: the Payments tab line and the notice label.
2. Deploy the functions: the job in `dry-run`, the billing callable and the notice.
3. Luis sets up SES and DNS by following the guide.
4. Run in dry-run for 7 days. Review the counts in the logs and the «dry run» lines on Payments
   tabs. The office reviews the 13 `active` memberships with a past end date, since D27 leaves
   them out.
5. Run in test mode. The emails reach Luis's inbox. Check that Gmail's «Show original» says SPF,
   DKIM and DMARC = PASS, and look at them on a phone.
6. Switch to `live`. Watch the first week's outcomes and the SES bounce rate.

There is no new index and no data migration. Each deploy is a production deploy and needs
Luis's confirmation in chat.

## Left to the builder

- **Email HTML.** The template structure and the HTML, within `DESIGN.md`. Whether to add the logo
  as an image hosted on `www.bptjersey.com`.
- **Names.** Function, file and step names; the exact admin notice title wording and its
  `details`.
- **Code layout.** How to split the work across the domain, service, adapter and job layers.
- **Pending applications.** Whether the pending-review check also matches intro-conversion
  applications stored under a non-canonical `studentId`. Prefer matching both if it is cheap.
- **Retries.** Whether the job sets `retryCount`. Idempotency makes a retry safe, except for a
  crash between SES accepting a message and the history write. That rare edge can produce a
  duplicate email; this is a known limit.

## Open questions

None. Answered on 2026-11-03: the lawful basis (D25), payments recorded without a renewal (D29)
and the AWS account owner (D26).
