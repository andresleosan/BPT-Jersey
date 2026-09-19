# Member subscription alerts implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Edit a member's subscription and let administrators act on 24-hour expiry notices in Overview.

**Architecture:** Dedicated administrative callables update existing membership records transactionally. A server-owned inbox receives scheduled expiry notices and operational audit events; React panels provide member editing and a paginated Overview inbox.

**Tech Stack:** Next.js 16, React, TypeScript, Zod, Firebase callable/Firestore/scheduled functions.

**Spec:** `docs/superpowers/specs/2026-09-18-member-subscription-alerts-design.md`

## Global constraints
- Active owner/administrator only; academy is derived from auth, never the payload.
- Preserve existing membership record schema and lifecycle, App Check, and browser-origin policy.
- No automatic charges or renewal; one month means a clamped UTC calendar month.
- Work in feature/member-subscription-alerts; do not modify shared main or publish in this task.
- No automated test suites; use static validation and builds as requested.

### Task 1: Shared contracts and membership editing
Files: create `packages/domain/src/memberships/subscription-admin-contracts.ts`, `apps/functions/src/memberships/subscription-admin-service.ts`, `apps/functions/src/memberships/subscription-admin-callables.ts`; modify domain package exports/runtime inputs, audit action registry and Functions runtime mapping/index.
- [x] Define Zod schemas for {studentId}, edit {membershipId, requestId, expectedUpdatedAt, operation: save|extend-month, planId?, endsAt?}, notification projection and paginated inbox. Use ISO UTC timestamps and opaque identifier validation.
- [x] Implement `addSubscriptionMonth(iso: string): string` by setting day to 1, adding a month, and clamping the original day to that month's last day.
- [x] Implement `listMemberSubscriptions(academyId, studentId)` with a member-specific query, valid canonical student and plan filtering; return member name, eligible plans, and editable membership projections with updatedAt.
- [x] Implement transactional `updateMemberSubscription`: load receipt/current member/plan before writes, reject stale updatedAt/cancelled status/ineligible plan; persist membership, audit, retry receipt, and resolve any notice for a replaced expiry.
- [x] Register new administrative callables with existing App Check/origin options and active-account check.

### Task 2: Administrator inbox and scheduled reminders
Files: create `apps/functions/src/notifications/admin-notification-service.ts`, `apps/functions/src/notifications/admin-notification-callables.ts`, `apps/functions/src/notifications/admin-notification-triggers.ts`; modify `firestore.indexes.json`, `firestore.rules`, Functions exports.
- [x] Deduplicate expiry by hash(membershipId, endsAt); transaction rechecks the current record and reads the student's display name before writing a server-owned notice.
- [x] Add a minute scheduler querying bounded pages of endsAt in [now-24h, now+24h]; filter cancelled memberships and retry safely. Add a membership-write trigger to resolve replaced periods and catch already-due edits.
- [x] Map selected operational audit actions to safe inbox copy and fixed local links, one notice per source event; no audit read events or sensitive payloads.
- [x] Add paginated all/unread inbox and mark-read/leave actions. Leave only resolves that period's notice and never mutates membership. Return explicit errors if stale.
- [x] Add required group/compound indexes and explicit deny rules for inbox and change receipts.

### Task 3: Member editor and Overview inbox
Files: create `apps/web/src/lib/subscription-admin-client.ts`, `apps/web/src/app/admin/members/member-subscription-editor.tsx`, `apps/web/src/app/admin/notifications/admin-notification-panel.tsx`, scoped CSS; modify Members, Search and Overview pages.
- [x] Validate callable responses in the client. Preserve request IDs across uncertain retries; regenerate only when a draft changes.
- [x] Add Subscription action to canonical directory rows and reuse the editor on canonical search results. Include plan/date editing, extension, no-end-date control, useful empty/error/success states and explicit refresh after conflicts.
- [x] Add an independent Overview inbox with all/unread filter, pagination, refresh on focus/every minute, mark read, links and expiry actions. Extend loads the current member snapshot, verifies matching membership/expiry, then calls the transactional edit.
- [x] Keep panels accessible, responsive and consistent with the existing admin styles. Render inbox even when dashboard loading fails.

### Task 4: Validation and delivery notes
- [x] Run changed-file formatting/lint, domain/Functions/web typechecks, web production build with synthetic Firebase configuration and Functions artifact build.
- [x] Inspect diff for scope and generated files. Do not run automated tests per user request.
- [x] Update this checklist and document deployment order, precision of reminders and pending production state. Commit only feature files on the isolated branch.

Delivery and validation details: `2026-09-18-member-subscription-alerts-release.md`. No deployment or automated tests were performed.
