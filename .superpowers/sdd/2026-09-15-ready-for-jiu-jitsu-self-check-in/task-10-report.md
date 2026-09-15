# Task 10 report — Ready for Jiu Jitsu workbench QA

## Scope and parent

- Actual commit parent before this task: `c3196a0a67cb072a4fff2d6333e7036f8470615d`
- Changed only: `qa/tests/account-self-check-in.spec.ts` and
  `qa/scripts/account-self-check-in-shots.mjs`, plus this required report.
- Preserved unrelated untracked `Assets/`, `PRODUCT.md`, and `docs/audits/`.

## Workbench preparation

After a read-only exact-name status check, ran:

```bash
docker restart bpt-account-app && sleep 8 && docker logs --tail 5 bpt-account-app
curl -sk -o /dev/null -w '%{http_code}\n' https://optimyze-vps-de-prod.tail29c816.ts.net:9471/login
```

Result: only `bpt-account-app` was restarted; its log reported `Ready`, and `/login`
returned `200` over HTTPS. No other container, network, firewall, Caddy, Firebase, or
environment-secret operation was performed.

## Browser test

Ran directly from `qa/` (not through `run-e2e.mjs`, which does not forward the opt-in):

```bash
PLAYWRIGHT_BROWSERS_PATH=/root/BPT-Jersey/.playwright-browsers \
ACCOUNT_WORKBENCH_E2E=true \
BASE_URL=https://optimyze-vps-de-prod.tail29c816.ts.net:9471 \
corepack pnpm exec playwright test tests/account-self-check-in.spec.ts \
  --project desktop-chromium --project mobile-chromium
```

Result: **8 passed** (4 cases × desktop/mobile), confirmed by
`qa/test-results/.last-run.json` with `status: "passed"` and no failed tests.

Coverage uses the real fixture repository and Chromium geolocation, with no whole-backend
mocks:

- exact 390×844 and 1280×800 viewports;
- `/accounts` protected alias continuation, sign-in, and canonical `/account`;
- End-key check-in, attended ready-session update, and real reload persistence;
- native `ArrowRight` presses retaining `94` then committing at `95`;
- real pointer slide; genuine Chromium callback deliberately delayed while locating; repeat
  pointer gesture remains one location request;
- near location success, 120 m refusal, explicit CDP-denied permission message, and guardian
  switching from Maya/Teens BJJ to Leo/Kids BJJ.

## Screenshots

The default script captures all eight states; its optional
`ACCOUNT_SCREENSHOT_VIEWPORT` / `ACCOUNT_SCREENSHOT_STATE` selectors were used to complete
individual real-workbench capture passes within the command transport's short process window.
No launch arguments disable the browser sandbox.

```bash
PLAYWRIGHT_BROWSERS_PATH=/root/BPT-Jersey/.playwright-browsers \
ACCOUNT_BASE_URL=https://optimyze-vps-de-prod.tail29c816.ts.net:9471 \
node scripts/account-self-check-in-shots.mjs
```

Final PNGs (all under `qa/screenshots/`, ignored and not committed):

- `qa/screenshots/ready-idle-phone.png`
- `qa/screenshots/ready-locating-phone.png`
- `qa/screenshots/ready-done-phone.png`
- `qa/screenshots/ready-refused-phone.png`
- `qa/screenshots/ready-idle-desktop.png`
- `qa/screenshots/ready-locating-desktop.png`
- `qa/screenshots/ready-done-desktop.png`
- `qa/screenshots/ready-refused-desktop.png`

The script checks browser console/page errors (with auth/AppCheck/JWT text redacted) and fails
on horizontal overflow before writing a screenshot. The local image-view helper could not open
PNGs because its normal sandbox path cannot create a user namespace; the required PNGs are present
for the controller's visual inspection.

## Additional validation and concern

```bash
git diff --check -- qa/tests/account-self-check-in.spec.ts qa/scripts/account-self-check-in-shots.mjs
node --check qa/scripts/account-self-check-in-shots.mjs
corepack pnpm typecheck
```

Whitespace and JavaScript syntax checks passed. `qa` typecheck remains blocked by three unrelated
pre-existing `TS2882` imports of `../../Lista/Lista.js` in `qa/unit/` (not touched by this task).

## Review round 1 — denied boundary and parallel fixture isolation

Review-fix base commit: `680c7c4fb865e8f6e7c399a2d13f2b88140aad1e`.

The CDP-denied check now proves that the denied gesture does not enter the in-process fixture
repository boundary. A network listener would be vacuous because the workbench fixture calls
`clockIn` locally. Instead, the Playwright test obtains the live `ReadyForJiuJitsu` React prop
whose implementation is the immediate `(input) => repository.clockIn(input)` adapter, sets a
CDP `Debugger.setBreakpointOnFunctionCall` only around the denied End-key gesture, and asserts
that its call count is zero. This is narrow observation only: it does not replace the repository,
route requests, or mock a backend.

No serialisation was added. The actual fixture source obtains `window.localStorage` in
`browserFixtureStorage()` and passes it only to `createFixtureCalendarRepository`; Playwright's
`page`/`context` fixtures create a fresh browser context per test. Thus every fully-parallel test
has an isolated local-storage namespace for its fixture attendance, while the test that requires
persistence checks reload within its own context. The final parallel 4 × 2 run passed, confirming
the same teen fixture can be exercised concurrently without cross-test attendance leakage.

After the controller materialized the tracked sparse-excluded `Lista/` path (without content
edits), ran:

```bash
cd /root/BPT-Jersey/qa
corepack pnpm typecheck
PLAYWRIGHT_BROWSERS_PATH=/root/BPT-Jersey/.playwright-browsers \
ACCOUNT_WORKBENCH_E2E=true \
BASE_URL=https://optimyze-vps-de-prod.tail29c816.ts.net:9471 \
corepack pnpm exec playwright test tests/account-self-check-in.spec.ts \
  --project desktop-chromium --project mobile-chromium
```

Results: TypeScript check passed; Playwright passed **8/8** and
`qa/test-results/.last-run.json` records `status: "passed"` with no failed tests.
