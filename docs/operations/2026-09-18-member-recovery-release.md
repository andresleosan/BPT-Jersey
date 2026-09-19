# Member recovery: production diagnosis and name-only support

Date: 2026-09-18. Branch: `fix/member-recovery-name-only`.
Status: operator authorized the coordinated release; Firebase deployment completed. The frontend is published by pushing this change to main.

## Observed production failure

Read-only checks used the existing authenticated Firebase session for project
`bptjersey-f5a25`. No production records or authentication accounts were changed.

- The deployed function inventory contains none of the five recovery callables.
- The `beginMemberRecovery` endpoint returns HTTP 404 to a preflight from
  `https://bptjersey.com`. The UI therefore cannot begin a recovery request.
  This explains the generic error before matching can run.
- The Firestore index inventory contains no `memberRecoveryRequests` composite index.
- Live rules do not include the explicit recovery collection blocks in this repository.
  Existing default-deny rules remain in place; this is not evidence of exposed records.
- Imported records: 249 with full names, 125 with an email, 124 without an email.
  These records belong to academy `demo-academy`, despite the production project's
  different identifier. Do not infer the academy identifier from its name.
- The canonical directory state and restore guard exist. Their inspected metadata
  indicates canonical-v1 mode, open freeze, idle operation, complete identity-key
  coverage and identity-v1/integrity-v1 version labels. This metadata check does
  not validate the signed guard against secret material.

The earlier merge published the frontend through Cloudflare Pages. That process does
not deploy Firebase Functions, rules or indexes.

## Behavior

The old email is optional. Empty and whitespace-only values are normalized as omitted;
invalid non-empty email addresses still fail validation. Name matching uses the existing
case, accent and whitespace normalization.

After entering a name, the member can authenticate with Google or create an account
with a new email and password. The new account's email must be verified. A name-only
request always waits for independent office identity confirmation before linking to the
source record. The office sees “Not supplied” for the omitted previous email.

Existing name-and-email automatic recovery remains available only for a unique match
with verified ownership of the original address. Imported records remain unchanged.
No additional Firebase Auth accounts or verification messages were created for testing.

## Verification

- Focused contracts, service, callable, member UI, office UI and authentication tests:
  6 files, 78 tests passed.
- Firestore emulator integration and direct-access rules: 2 files, 4 tests passed,
  including persistence of a name-only request without an automatic account link.
- Workspace typecheck and lint passed.
- Firebase deployment artifact and static web build passed.
- Local Chromium smoke passed on desktop and mobile: name-only submission reaches
  Google/password choices; no previous email is sent, no runtime errors or horizontal
  overflow. The browser test mocks the callable response; the service and emulator
  tests cover backend behavior.
- Test data is synthetic, using `demo-bpt-jersey`; no production mutation occurred.

## Coordinated release, after explicit confirmation

Follow [the release runbook](t058-release-rollback-runbook.md). This document does not
authorize production changes.

1. Recheck the release delta and capture the current rules and Pages deployment for rollback.
   Reconcile unrelated rule/index changes before deploying the repository configuration.
2. Use the existing project configuration with Functions `ACADEMY_ID=demo-academy`.
   Confirm the existing identity/integrity secret bindings and version labels; do not
   create replacement key material. Confirm Auth providers, authorized domains and App Check.
3. Deploy the additive recovery index and scoped rules. Wait for the compound index
   (`status`, `accountVerified`, `expiresAt`, `createdAt`, ascending) to become ready.
4. Deploy only the five recovery functions from the verified artifact:

   ```bash
   FUNCTIONS_DISCOVERY_TIMEOUT=300000 corepack pnpm exec firebase deploy \
     --project bptjersey-f5a25 \
     --only functions:beginMemberRecovery,functions:completeMemberRecovery,functions:listMemberRecoveryRequests,functions:getMemberRecoveryDetail,functions:reviewMemberRecovery
   ```

5. Verify function availability and CORS. Validate the authenticated office queue
   without approving or changing real members for a smoke test.
6. Merge the tested name-only change and push `main` last, which publishes the frontend.
   Verify the deployed page and repeat the originally reported flow with the operator's
   intended member. Do not fabricate production test identities.

If release validation fails, stop before the frontend push. Preserve all records and
requests. Use the captured frontend/rules versions and the runbook's scoped rollback
procedure; do not delete functions, indexes, tickets or member links as an automatic
rollback. Name-only support is backward compatible with existing name-and-email requests.

## Authorized production execution

The operator explicitly approved deploying Functions, rules and indexes, then publishing main.

- Deployed the four explicit deny blocks and the recovery compound index. The index is READY.
  Comparing live and repository configuration confirmed no unrelated rules/index changes.
- Created all five recovery callables in us-central1, Node.js 22. All are ACTIVE.
  Comparing function inventories confirmed no existing function was changed or removed.
- Set ACADEMY_ID to demo-academy and bound the existing identity/integrity secret versions (2).
  Deployment discovery also required the existing BPT_WAIVER_REGISTRATION=disabled value;
  no waiver functions were redeployed.
- Every recovery endpoint now responds to the production website's CORS preflight with 204.
  Before release the entry endpoint returned 404.
- The production office-queue Firestore query succeeds with the new index (zero pending requests
  at validation time). This checks the query, not an authenticated office browser session.
- Google and email/password authentication are enabled; bptjersey.com is an authorized Auth domain.
- The reCAPTCHA Enterprise domain allowlist omitted bptjersey.com. Added that exact domain to
  the existing www and Pages entries. Domain validation remains enabled; other web settings
  are unchanged. The frontend's actual public site key matches Firebase App Check configuration.
- An automated browser still received App Check attestation rejection after the domain correction.
  No App Check enforcement, score threshold or other bot protection was weakened. Full live
  recovery with a real account remains a user acceptance check. All local synthetic tests passed.
- No member records, recovery tickets or Auth accounts were created or changed during validation.
  The browser probe replaced form data with an empty invalid payload before sending it.

Frontend baseline for rollback: Cloudflare deployment
b8297215-8174-42e9-a5e9-3c100b5edbcc, commit 5e324ec. Publish the tested name-only change through
the authorized main push, then verify the new Pages deployment and optional email field.
