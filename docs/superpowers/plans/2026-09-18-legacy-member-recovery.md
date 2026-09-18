# Legacy Member Recovery Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Recover legacy member data through verified Google or email/password accounts.
**Architecture:** A generic public recovery ticket precedes Firebase authentication. A server workflow owns matching, verification, review and canonical linking; static React pages consume validated projections.
**Tech Stack:** Next.js 16, React 19, Firebase Auth/Functions/Firestore, TypeScript, Zod, Vitest.
**Spec:** `docs/superpowers/specs/2026-09-18-legacy-member-recovery-design.md`

## Global Constraints

- All new application text and code are in English.
- Only add legacy member recovery; preserve existing work and login flows.
- No production writes, credential exports, real emails or deployment during implementation.
- Verify email ownership before automatic linking; changed email requires administrative identity review.
- Preserve canonical identity, directory integrity and historical data; no automatic membership renewal.
- Tests use only synthetic data and `demo-bpt-jersey` emulators.

### Task 1: Server recovery workflow and canonical linking

**Files:** new recovery contracts in `packages/domain/src/members/`, new recovery service/store/callables in `apps/functions/src/members/`, canonical writer integration where required, domain exports, function exports, explicit Firestore deny rules/tests and indexes if needed.
**Interfaces:** API boundary in the spec; consumes Firebase Auth users and canonical directory primitives; produces recovery projections only, never raw imports or credentials.

- [ ] Write failing tests for normalisation, generic begin responses, ownership, expiry, rate limits, admin authorisation, transactional uniqueness and claim repair.
- [ ] Run focused node tests and record the expected failure.
- [ ] Implement bounded server matching, durable tickets, verified identity workflow and review, then canonical linking with existing state/guard/receipt/audit primitives.
- [ ] Run focused unit and emulator integration tests for replay and competing link attempts.

Representative security assertion:
```ts
expect(await complete({ recoveryId, user: unverifiedUser })).toMatchObject({ status: "verify-email" });
expect(store.linkCount).toBe(0);
```

### Task 2: Member recovery and office review screens

**Files:** `apps/web/src/lib/member-recovery-client.ts`, `apps/web/src/app/login/recover/`, login entry link, `apps/web/src/app/admin/members/recovery/`, member directory entry link, paired tests.
**Interfaces:** consumes Task 1 API, existing Firebase Auth and admin session helpers. All request/response shapes are validated at the boundary.

- [ ] Write failing client/form tests for Google, password registration, existing login, verification, resume, profile-required, pending, linked and admin review.
- [ ] Run focused web tests and verify failure.
- [ ] Implement recovery and review components with existing UI classes, accessible native forms and safe errors.
- [ ] Verify focused tests, no passwords in storage, and static routes.

Representative success assertion:
```ts
await user.click(screen.getByRole("button", { name: "Continue with Google" }));
expect(completeMemberRecovery).toHaveBeenCalledWith({ recoveryId });
```

### Task 3: Integration, review and handover

- [ ] Resolve API consistency and review whole diff for data preservation and authorisation.
- [ ] Run focused tests, typecheck, changed-file lint/format, web build and local browser smoke.
- [ ] Record exact evidence and deployment prerequisites. Commit only feature files on the isolated branch.

## Progress and rulings

- Baseline: source branch contains unrelated uncommitted UI edits; isolated worktree starts at `8792fd8`.
- Ruling: no match information is exposed before authentication; the first screen continues generically even on a miss to protect member privacy.
- Ruling: the approved automatic route requires both name match and ownership of the registered email; source matching alone never grants access.
- Ruling: legacy imported records are not equivalent to canonical student accounts; recovery includes canonical linkage and completion of required missing fields.
