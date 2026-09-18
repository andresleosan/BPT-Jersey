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

- [x] Write failing tests for normalisation, generic begin responses, ownership, expiry, rate limits, admin authorisation, transactional uniqueness and claim repair.
- [x] Run focused node tests and record the expected failure.
- [x] Implement bounded server matching, durable tickets, verified identity workflow and review, then canonical linking with existing state/guard/receipt/audit primitives.
- [x] Run focused unit and emulator integration tests for replay and competing link attempts.

Representative security assertion:

```ts
expect(await complete({ recoveryId, user: unverifiedUser })).toMatchObject({
  status: "verify-email",
});
expect(store.linkCount).toBe(0);
```

### Task 2: Member recovery and office review screens

**Files:** `apps/web/src/lib/member-recovery-client.ts`, `apps/web/src/app/login/recover/`, login entry link, `apps/web/src/app/admin/members/recovery/`, member directory entry link, paired tests.
**Interfaces:** consumes Task 1 API, existing Firebase Auth and admin session helpers. All request/response shapes are validated at the boundary.

- [x] Write failing client/form tests for Google, password registration, existing login, verification, resume, profile-required, pending, linked and admin review.
- [x] Run focused web tests and verify failure.
- [x] Implement recovery and review components with existing UI classes, accessible native forms and safe errors.
- [x] Verify focused tests, no passwords in storage, and static routes.

Representative success assertion:

```ts
await user.click(screen.getByRole("button", { name: "Continue with Google" }));
expect(completeMemberRecovery).toHaveBeenCalledWith({ recoveryId });
```

### Task 3: Integration, review and handover

- [x] Resolve API consistency and review whole diff for data preservation and authorisation.
- [x] Run focused tests, typecheck, changed-file lint/format, web build and local browser smoke.
- [x] Record exact evidence and deployment prerequisites. Commit only feature files on the isolated branch.

## Progress and rulings

- Baseline: source branch contains unrelated uncommitted UI edits; isolated worktree starts at `8792fd8`.
- Ruling: no match information is exposed before authentication; the first screen continues generically even on a miss to protect member privacy.
- Ruling: the approved automatic route requires both name match and ownership of the registered email; source matching alone never grants access.
- Ruling: legacy imported records are not equivalent to canonical student accounts; recovery includes canonical linkage and completion of required missing fields.

## Verification evidence — 2026-09-18

Work is on `feature/legacy-member-recovery`, based on `8792fd8` from `feature/member-profile-e0-e2`, in `/root/BPT-Jersey-wt/member-recovery`. The original checkout's unrelated edits are preserved.

- Final source tree (`a08ee86`): `corepack pnpm test` — 354 files, 3,705 tests passed, exit 0 (379.71 seconds).
- `corepack pnpm build`, `corepack pnpm typecheck`, `corepack pnpm lint`, and the domain runtime build passed. After the final queue fix, Functions build/typecheck and focused lint/format passed again.
- Final queue regression run: 41 tests passed across the service, callables and office UI. The service suite retains the source-minor, conflicting-identity and claim-repair regressions.
- Isolated Firestore integration: two tests passed using only synthetic `demo-bpt-jersey` data. Concurrent claims produce one canonical link; a 425-ticket queue fixture demonstrates that resolving 50 requests reveals the remaining 15 actionable requests.
- Firestore boundary tests passed for direct access denial to recovery collections.
- Local Playwright smoke passed for desktop and 390px mobile recovery screens: English labels, no runtime errors or horizontal overflow, Google/password choices visible, only the opaque ticket stored. Preview data and callable responses were synthetic; no real account or verification email was used.
- Independent reviews found and resolved source-minor validation, conflicting canonical identity, stale account state, initial verification sending, claim-refresh retry and account-email labeling issues. The final queue finding was fixed in `a08ee86`; scoped re-review approved it with no open or deferred findings.

Release prerequisites and data-preservation behavior are documented in `docs/legacy-member-recovery.md`. No production deployment, production data mutation or real email send occurred. The recovery query requires the committed Firestore index to be deployed and ready.

Status: implementation and local verification complete; all review findings resolved. Only documentation changed after the final suite. The isolated branch is ready for the operator to choose integration; no merge, push or production deployment has been performed.
