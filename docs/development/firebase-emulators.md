# Firebase Emulator Suite

The local environment uses the demo project `demo-bpt-jersey`. Demo project IDs cannot reach live Firebase resources, which prevents accidental production writes or billing during development.

## Commands

- `corepack pnpm firebase:emulators` starts Auth, Firestore, Realtime Database, and Functions emulators.
- `corepack pnpm firebase:emulators:data` starts the Auth and database emulators without Functions.
- `corepack pnpm test:rules` starts Auth, Firestore, and Realtime Database, runs the Rules suite, and shuts the emulators down.

On restricted Windows environments, set `XDG_CONFIG_HOME` to the repository-local ignored `.firebase-config` directory before invoking Firebase CLI.

The initial Rules posture is intentionally default-deny. Feature tasks must add the smallest required access and prove both allowed and rejected cases before changing these files.

## Authenticated callable E2E for the canonical member directory (T093)

The web client is App Check fail-closed and the SDK only attaches `X-Firebase-AppCheck` after a real
token exchange, so the browser path cannot be exercised offline. The Functions Emulator runs with
`skipTokenVerification`, which decodes (without verifying) an unsigned App Check JWT and populates
`request.app`. `qa/tests/member-directory-auth-emulator.spec.ts` therefore drives the callables
directly with a real Auth Emulator session.

1. Build the artifact once: `node apps/functions/scripts/build-deploy-artifact.mjs` (also builds
   `packages/domain/lib` and `apps/functions/lib`, which the initializer imports).
2. Provide synthetic secrets (base64url, 32-64 bytes, distinct, no placeholder words) in
   `.firebase-functions/.secret.local` for `MEMBER_DIRECTORY_IDENTITY_KEY_SECRET`,
   `MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET`, `MEMBER_DIRECTORY_CURSOR_SECRET`,
   `MEMBER_PAGE_TOKEN_SECRET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Export the same
   identity/integrity values plus `MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET` in the shell: the
   initializer binds the directory state to them and the callables verify that binding.
3. Run, with JDK 21 on `PATH`:

   ```bash
   T093_MEMBER_DIRECTORY_EMULATOR_E2E=true GCLOUD_PROJECT=demo-bpt-jersey    T093_E2E_ACADEMY_ID=t093-e2e-academy    AUTH_EMULATOR_E2E_EMAIL=t093-owner@example.test AUTH_EMULATOR_E2E_PASSWORD=<12+ chars>    npx firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions      "node qa/scripts/run-member-directory-e2e.mjs"
   ```

The runner seeds the Auth user, writes the exact provisioned `users/{uid}` document, initializes the
empty canonical directory for the synthetic academy and runs the spec. The encrypted empty baseline is
kept under the ignored `.tmp/member-directory-baselines/`; if the secrets change, use a new
`T093_E2E_ACADEMY_ID` because an existing baseline can only be reopened with its original secrets.
