# Quality assurance conventions

- Unit files use `*.test.ts` or `*.test.tsx` and run with Vitest.
- Browser journeys use `*.spec.ts` under `qa/tests/` and run with Playwright.
- Prefer behavior and accessible roles over implementation details.
- Every test owns its data and must run independently of execution order.
- Production credentials and live Firebase projects are prohibited in automated tests.
- Contract, Rules, load, and security-edge suites are added beside the feature they protect.
- Build `apps/web` before E2E so Playwright exercises the production static export.

## Firebase Auth test accounts

- Unit tests and signed-out browser checks use no real Firebase users and never require credentials.
- Authenticated local journeys, when explicitly enabled by an operator, use dedicated non-production client and pre-provisioned administrator accounts in the Firebase staging/emulator environment.
- Credentials must come from a local secret mechanism or environment injection outside the repository. Never put passwords, tokens, cookies, storage state, screenshots, traces, command arguments, or reports in the checkout.
- The administrator account must already have verified `academyId` plus `owner` or `administrator` claims. There is no public administrator registration path.
- Live Auth verification is opt-in only, skipped by CI, and must not be run against production without an explicit operator request.
- The opt-in Playwright project is `live-auth`. Enable it only with `UNIFIED_LOGIN_LIVE_AUTH=true` and inject `UNIFIED_LOGIN_CLIENT_EMAIL`, `UNIFIED_LOGIN_CLIENT_PASSWORD`, `UNIFIED_LOGIN_ADMIN_EMAIL`, and `UNIFIED_LOGIN_ADMIN_PASSWORD` from a local secret mechanism outside the repository.
- Run it with `node qa/run-e2e.mjs --project=live-auth`; the project disables screenshots, traces, and videos so credentials cannot enter browser artifacts. The runner forwards values only to the local child process and never prints them.
- The live journey is not evidence for this task unless an operator supplies a local non-production session and explicitly requests the run. The client must be denied by `/admin`; the provisioned administrator must reach `/admin`; both sessions are logged out before completion.

## T017 TOTP MFA verification

- Firebase Authentication TOTP is enabled per local/staging project by the operator. Phone/SMS Auth is not enabled for T017.
- `t017-mfa-live` is opt-in only and requires `T017_MFA_LIVE=true`, `T017_MFA_ADMIN_EMAIL`, `T017_MFA_ADMIN_PASSWORD`, `T017_MFA_TOTP_CODE`, `T017_MFA_CLIENT_EMAIL`, and `T017_MFA_CLIENT_PASSWORD` injected by a local secret mechanism. Values are never printed or committed.
- Run from the repository root with `node qa/run-e2e.mjs --project=t017-mfa-live`. The project is serial and disables screenshots, traces, and video. CI and production runs are prohibited.
- A fresh dedicated staging admin may stop at the enrollment wizard for the operator to scan the one-time QR; the subsequent run verifies the six-digit challenge and refreshed admin session. Invalid/cancelled codes remain outside the shell.
- Recovery is operator-only: remove the factor from the dedicated staging account in Firebase Auth and record the action in the staging runbook. There is no public bypass or fixed code.
- T017 has no Firestore/RTDB migration. Rollback is restoring the prior web/Functions revision; account rollback is removing only the dedicated staging factor.

## Regyfit read-only discovery

- The offline metadata test runs with `corepack pnpm --dir qa exec playwright test tests/regyfit-discovery.spec.ts --grep "offline metadata"`.
- The live journey is skipped unless `REGYFIT_BASE_URL`, `REGYFIT_EMAIL`, and
  `REGYFIT_PASSWORD` are present in the local environment.
- Credentials must come from an approved local secret mechanism. Do not put them
  in command arguments, repository files, Playwright traces, screenshots, or
  reports. Their values are never logged.
- The journey reads only pathname/title/navigation labels/buttons/form metadata
  and table headers. It never reads input values, table cells, cookies, storage,
  response bodies, or full page text.
- Navigation is same-origin, bounded, serial, delayed, and read-only. Mutating
  routes and actions are excluded. Discovery output is not saved unless
  `REGYFIT_SAVE_DISCOVERY=true` and `REGYFIT_OUTPUT_DIR` points outside the repo.
- Do not run the live journey in CI or against production. A controlled operator
  request is required before the first authenticated session.
