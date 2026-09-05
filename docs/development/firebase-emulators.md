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

`node apps/functions/scripts/build-deploy-artifact.mjs` recreates `.firebase-functions/` from
scratch (`rmSync` of the whole directory), so it also deletes the git-ignored `.secret.local`.
Keep the synthetic values outside the repository and rewrite the file after every build; a
directory baseline bound to lost secrets can only be reopened by creating a new academy ID.

## Authenticated callable E2E for client onboarding (T094)

Same mechanism as T093, covering the client side: `qa/tests/onboarding-auth-emulator.spec.ts`
signs in an owner, an adult student and a guardian against the Auth Emulator and drives
`publishWaiverVersion`, `saveClientProfile`, `saveGuardianProfile`, `createFamily`,
`getWaiverRegistration`, `acceptWaiver`, `getWaiverEvidenceDownload` and `revokeWaiverConsent`,
plus the fail-closed negatives (no App Check, no session, extra keys, minor date of birth on an
adult profile, declined required clause, typed-name mismatch, cross-scope acceptance and evidence
access, re-acceptance after revocation, direct Firestore reads denied by Rules).

Waiver acceptance writes the evidence PDF before the consent commits. Outside the emulator that
needs R2; inside it, `createPrivateStorageR2Client` (`apps/functions/src/storage/r2-client.ts`)
falls back to an in-process store only when `FUNCTIONS_EMULATOR=true`, `FIRESTORE_EMULATOR_HOST`
is a loopback non-privileged port and the project ID starts with `demo-`. Anywhere else an
unconfigured R2 keeps failing closed. Its signed URLs point at `private-storage.emulator.invalid`.

1. Build the artifact and provide `.firebase-functions/.secret.local` as for T093.
2. Export the identity/integrity secrets plus `MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET`.
3. Run, with JDK 21 on `PATH` and `BPT_SYNTHETIC_PILOT=true` in the same shell (the Functions
   Emulator inherits it; the waiver callables are closed without it):

   ```bash
   BPT_SYNTHETIC_PILOT=true T094_ONBOARDING_EMULATOR_E2E=true GCLOUD_PROJECT=demo-bpt-jersey \
   T094_E2E_ACADEMY_ID=t094-e2e-academy T094_OWNER_EMAIL=t094-owner@example.test \
   T094_ADULT_EMAIL=t094-adult@example.test T094_GUARDIAN_EMAIL=t094-guardian@example.test \
   T094_E2E_PASSWORD=<12+ chars> \
   npx firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions \
     "node qa/scripts/run-onboarding-e2e.mjs"
   ```

The runner (`qa/scripts/run-onboarding-e2e.mjs`) seeds the owner with the T093 seeds, seeds the two
client identities with `qa/scripts/seed-onboarding-emulator.mjs` (Auth users and claims only: their
`users`, `students`, family and relationship documents are created by the callables under test),
initializes the empty canonical directory and runs the spec. Only `@example.test` users, loopback
emulators and the demo project are accepted.

## Authenticated callable E2E for the manual billing cycle (T095)

`qa/tests/manual-billing-auth-emulator.spec.ts` drives the manual billing cycle on canonical data:
`publishWaiverVersion` and `saveClientProfile` as prerequisites, `savePlan`/`activatePlan`,
`createMembership` (staff, without naming a family: the backend derives the adult's own family),
`issueManualInvoice`, `recordManualPayment`, `listFinancialAccount` for the adult and staff,
`getFinancialDashboard` and `listMemberships`, plus the fail-closed negatives (membership before the
waiver is accepted, self-service active membership, duplicate current membership, mismatched family,
client-issued invoices, payment above balance, App Check, session, payload shape, Rules on direct
reads). Same secrets, pilot flag and JDK requirements as T094.

```bash
BPT_SYNTHETIC_PILOT=true T095_MANUAL_BILLING_EMULATOR_E2E=true GCLOUD_PROJECT=demo-bpt-jersey \
T095_E2E_ACADEMY_ID=t095-e2e-academy T095_OWNER_EMAIL=t095-owner@example.test \
T095_ADULT_EMAIL=t095-adult@example.test T095_E2E_PASSWORD=<12+ chars> \
npx firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions \
  "node qa/scripts/run-manual-billing-e2e.mjs"
```

The Functions Emulator serves `.firebase-functions/`, so rebuild the artifact after any backend
change before running these specs; a stale artifact fails with the previous callable contract.

## Authenticated callable E2E for class operations (T096)

`qa/tests/schedule-auth-emulator.spec.ts` drives the class operations cycle on canonical data after
the T095 prerequisites (waiver, adult profile, plan, active membership): `listScheduleCatalog`,
`saveProgram`, `saveSession` at Town and West, `listSessions`, `requestBooking` (idempotent replay,
one-hour cutoff, site eligibility), `listStudentBookings`, `evaluateSessionMinimum`, `checkIn`
(staff, manual only in the pilot), `listSessionAttendance`, `correctAttendance`,
`getSessionOperationalView`, `cancelBooking`, `cancelSession`, `reconcileSessionNoShows`, plus the
role, App Check, session, payload and Rules negatives. Same secrets, pilot flag and JDK requirements.

```bash
BPT_SYNTHETIC_PILOT=true T096_SCHEDULE_EMULATOR_E2E=true GCLOUD_PROJECT=demo-bpt-jersey \
T096_E2E_ACADEMY_ID=t096-e2e-academy T096_OWNER_EMAIL=t096-owner@example.test \
T096_ADULT_EMAIL=t096-adult@example.test T096_E2E_PASSWORD=<12+ chars> \
npx firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions \
  "node qa/scripts/run-schedule-e2e.mjs"
```
