/cle# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BPT Jersey Academy Platform: public site, member/client area and admin panel for a single
Brazilian jiu-jitsu academy. pnpm monorepo, TypeScript strict, Spanish-language docs. Talk to the
operator in Spanish; code, identifiers and contracts are in English.

Read `STACK.md` (stack decisions), `BRIEF.md` (product) and `LECCIONES.md` (hard-won lessons) before
non-trivial work. `tasks.md` / `tasksv2.md` are the task ledger: every piece of work has a task
entry, and a task is only "done" with real test evidence recorded there. Design specs and
implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/` (one dated
file per feature); ADRs in `docs/adr/`.

Never deploy to production, run a destructive migration, or add paid-API spend without the operator
confirming explicitly in chat.

## Commands

Always via Corepack from the repo root: `corepack pnpm <script>`. Node `>=22.13 <25` (Node 25 fails).
Never install pnpm or firebase-tools globally.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck            # tsc --noEmit in every workspace package
corepack pnpm lint                 # eslint --max-warnings 0
corepack pnpm format:check         # prettier (format to fix)
corepack pnpm test                 # vitest projects `web` (jsdom) + `node`, ~2500 tests, ~45 s
corepack pnpm --filter @bpt-jersey/web dev   # http://127.0.0.1:3000
corepack pnpm verify:mvp           # full gate: format, lint, typecheck, build, unit, rules, load, e2e smoke
```

Single test file / single test name:

```bash
corepack pnpm vitest run --project node apps/functions/src/schedule/schedule-service.test.ts
corepack pnpm vitest run --project web apps/web/src/lib/members-client.test.ts -t "creates a member"
```

Project mapping: `web` = `apps/web/src/**/*.test.{ts,tsx}`; `node` = `apps/functions`,
`packages/*`, `qa/unit`; `rules` = `qa/rules`; `firestore-integration` = `qa/integration`.

Anything that starts Firebase emulators needs JDK 21 and the project id `demo-bpt-jersey`
(a `demo-` id can never touch real Firebase). Export `FUNCTIONS_DISCOVERY_TIMEOUT=300000` first;
the repo exports ~170 functions and the default 10 s discovery times out silently.

```bash
corepack pnpm test:rules           # Firestore + RTDB security rules, spins emulators itself
corepack pnpm test:integration     # qa/integration against emulators (minutes; weekly in CI)
corepack pnpm firebase:emulators   # auth 9099, functions 5001, firestore 8080, rtdb 9000, ui 4000
corepack pnpm test:e2e:smoke       # Playwright @smoke; build apps/web first (tests the static export)
corepack pnpm --dir qa exec playwright install chromium   # once, into .playwright-browsers/
```

Functions must be built from a compiled domain: `pnpm --filter @bpt-jersey/domain build:runtime`
before `pnpm --filter @bpt-jersey/functions build`. The deployable artifact is
`.firebase-functions/` (built by the `firebase.json` predeploy script), not `apps/functions/lib`.

## Architecture

**Modular monolith, three deploy targets, one rule: `packages/domain` never imports Firebase.**

- `apps/web` — Next.js 16 / React 19, `output: "export"`. Pure static site on Cloudflare Pages: no
  server components with data, no API routes, no middleware. All data goes through Firebase client
  SDK (Auth, Firestore reads, callables). App Check with reCAPTCHA Enterprise in production;
  emulators only when `NEXT_PUBLIC_FIREBASE_ENV=local` (`next.config.ts` throws otherwise).
  Routes under `src/app/` by role: `account` (member), `admin`, `coach`, `staff`, `enrol`, `login`,
  `shop`, `levels`.
- `apps/functions` — Firebase Cloud Functions v2 (`onCall`), Node 22. One folder per feature; every
  exported callable is re-exported from `src/index.ts` (that file is the deploy surface).
- `packages/domain` — zod schemas, contracts, state transitions, business rules. Unit-tested without
  emulators. Exposed via explicit subpath exports in its `package.json` (`@bpt-jersey/domain/members`,
  `.../schedule` …); a new contract module must be added there.
- `qa/` — rules tests, emulator integration, Playwright specs (`qa/tests/*.spec.ts`), fixtures.

**Per-feature layering** (follow it when adding anything):

1. `packages/domain/src/<feature>/<feature>-contracts.ts` — input/output schemas and types.
2. `apps/functions/src/<feature>/<feature>-service.ts` — pure logic, tested with in-memory fakes.
3. `apps/functions/src/<feature>/<feature>-firestore.ts` — Firestore adapter for that service.
4. `apps/functions/src/<feature>/<feature>-callables.ts` — `onCall` wrappers: auth/claims check
   (`requireAdminActor`, `assertAcademyScope`), zod parse, service call; exported in `index.ts`.
5. `apps/web/src/lib/<feature>-client.ts` — `httpsCallable` + zod parse of the response, returning
   safe user-facing error strings (never raw Firebase errors).
6. Route/components under `apps/web/src/app/...`.

Data decisions that shape code: Firestore is the canonical store, RTDB is ephemeral only; private
files go to Cloudflare R2 through a storage adapter (ADR-003); `students` is the single participant
identity, memberships/finance are their own authorities (ADR-009); levels are versioned in-house,
never synced from Regyfit. Firestore rules and composite indexes live at the repo root
(`firestore.rules`, `firestore.indexes.json`); a missing composite index shows up as an opaque
runtime error, not at deploy time.

## Testing conventions

- Unit: `*.test.ts(x)` beside the source. E2E: `*.spec.ts` in `qa/tests/`, prefer accessible roles.
- Every test owns its data; no real Firebase projects or credentials in automated tests. Opt-in
  live Playwright projects (`live-auth`, `t017-mfa-live`) read secrets from env only and never run
  in CI.
- An existence check is not a functioning check (`LECCIONES.md` §4): assert the value, and for a
  new guard, disable it and confirm a test dies.
- CI (`.github/workflows/ci.yml`) runs, in order: domain `build:runtime`, format:check, lint,
  typecheck, test:unit, `pnpm audit --audit-level high`, test:rules, web build, e2e smoke.
