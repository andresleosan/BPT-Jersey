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
3. Run, with JDK 21 on `PATH`. Check what `java -version` actually reports rather than whether a
   JDK 21 is installed: an Oracle Java 8 entry under
   `C:\Program Files (x86)\Common Files\Oracle\Java\java8path` shadows a perfectly good Temurin
   21 and firebase-tools then refuses. Prepending the real JDK for the command is enough:

   ```bash
   export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin:$PATH"
   ```

   ```bash
   T093_MEMBER_DIRECTORY_EMULATOR_E2E=true GCLOUD_PROJECT=demo-bpt-jersey    T093_E2E_ACADEMY_ID=t093-e2e-academy    AUTH_EMULATOR_E2E_EMAIL=t093-owner@example.test AUTH_EMULATOR_E2E_PASSWORD=<12+ chars>    npx firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions      "node qa/scripts/run-member-directory-e2e.mjs"
   ```

   `T121_APPLICANT_PASSWORD=<12+ chars>` is required too: the same run covers the enrolment
   approval of T121 slice 2, whose applicants are seeded by
   `qa/scripts/seed-enrolment-applicants-emulator.mjs`.

The runner seeds the Auth user, writes the exact provisioned `users/{uid}` document, seeds the
synthetic enrolment applicants, initializes the empty canonical directory for the synthetic academy
and runs both specs: `member-directory-auth-emulator.spec.ts` (T093) and
`enrolment-approval-auth-emulator.spec.ts` (T121 slice 2 / T122). The encrypted empty baseline is
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

The same run also covers the quorum sweep (T110): a session still open for booking is left alone
even below its minimum, a session inside the one-hour cutoff that meets its minimum is left alone,
one that never reached four bookings is cancelled with the canonical reason and reports
`alreadyCancelledForQuorum` when the sweep repeats, clients cannot run it (403), a session cancelled
for another reason is never swept, the member who had booked a cancelled class gets the derived
in-app notice through `listClientReminders` (no queue, no email, no SMS, no identifiers), and the
cancellation audit event stays closed to direct reads. The Emulator cannot fast-forward the clock, so
a booking released by the sweep itself is proven at unit level in
`apps/functions/src/schedule/quorum-sweep-service.test.ts`.

`apps/functions/src/schedule/quorum-sweep-runner.ts` is the manual window sweep, deliberately not
exported from `index.ts` and deliberately not a scheduled function: it requires `--academy-id`,
`--window-hours` and `--actor-id` and refuses any target but the demo Firestore Emulator. Enabling it
automatically is a separate operator checkpoint, as recorded for the T062 producer.

The same run covers the 50 m check-in eligibility signal (T109): administration records the Town
site coordinates with `saveLocationGeofence` (clients 403, malformed coordinates 400), the catalog
returns them, a check-in measured inside the radius records `proximity.signal = "within"`, one
measured outside is refused without a staff reason and recorded with the reason and its own audit
event when given, a reason is refused inside the radius, and `locations`, `attendance` and the
override audit document stay closed to direct reads by Rules. Only a distance and an accuracy ever
travel to the backend; no coordinate of a person is sent or stored.

```bash
BPT_SYNTHETIC_PILOT=true T096_SCHEDULE_EMULATOR_E2E=true GCLOUD_PROJECT=demo-bpt-jersey \
T096_E2E_ACADEMY_ID=t096-e2e-academy T096_OWNER_EMAIL=t096-owner@example.test \
T096_ADULT_EMAIL=t096-adult@example.test T096_E2E_PASSWORD=<12+ chars> \
npx firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions \
  "node qa/scripts/run-schedule-e2e.mjs"
```

## Authenticated callable E2E for progress and promotions (T097)

`qa/tests/progress-auth-emulator.spec.ts` seeds a head coach (`qa/scripts/seed-staff-emulator.mjs`:
Auth user, `headCoach` claims, staff `users/{uid}` document and `staff/{staffId}` profile) and the
canonical Levels catalog (`apps/functions/scripts/seed-levels.mjs --target=emulator`), then drives
`listLevelCatalog`, the onboarding prerequisites, `openStudentLevel` (head coach only, once, belts
only), a head-coach session with booking and manual check-in, `getStudentProgressSummary` for the
adult and staff, `recordEvaluation`, `listRecognitionCandidates`, `approvePromotion` to the next
definition, `getProgressReport` and the App Check, session, payload and Rules negatives. A third
test covers the family path: a guardian enrols a minor, reads the roster with `getFamily` and the
child's progress with `getStudentProgressSummary`, while an unrelated adult and an unlinked
student identifier are refused.

```bash
BPT_SYNTHETIC_PILOT=true T097_PROGRESS_EMULATOR_E2E=true GCLOUD_PROJECT=demo-bpt-jersey \
T097_E2E_ACADEMY_ID=t097-e2e-academy T097_OWNER_EMAIL=t097-owner@example.test \
T097_HEAD_COACH_EMAIL=t097-headcoach@example.test T097_ADULT_EMAIL=t097-adult@example.test \
T097_GUARDIAN_EMAIL=t097-guardian@example.test T097_E2E_PASSWORD=<12+ chars> \
npx firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions \
  "node qa/scripts/run-progress-e2e.mjs"
```

## Golden path: the seven suites in one emulator run (T098)

`qa/scripts/run-golden-path-e2e.mjs` seeds one synthetic academy once (owner, head coach with
staff profile, three guardians, seven adults, empty canonical directory, Levels catalog) and runs
the T094, T095, T096, T111, T112, T113 and T097 suites in sequence with one worker: adult and guardian onboarding
with waiver evidence, plan, membership, manual invoice and payment, program, sessions, booking,
quorum, check-in with the proximity signal, attendance correction, cancellations, the quorum sweep,
the Town no-show penalty proposed and resolved by office, the upcoming birthdays of each site, the
age bands that filter a recognition proposal, level opening, evaluation, recognition
candidates, promotion, family progress and progress report. Each suite gets its own adult because a
student can hold only one current membership, and the progress suite gets its own guardian because
a tutor holds one family.

```bash
BPT_SYNTHETIC_PILOT=true GOLDEN_PATH_EMULATOR_E2E=true GCLOUD_PROJECT=demo-bpt-jersey GOLDEN_PATH_ACADEMY_ID=golden-e2e-academy GOLDEN_PATH_PASSWORD=<12+ chars> GOLDEN_PATH_OWNER_EMAIL=golden-owner@example.test GOLDEN_PATH_HEAD_COACH_EMAIL=golden-headcoach@example.test GOLDEN_PATH_GUARDIAN_EMAIL=golden-guardian@example.test GOLDEN_PATH_GUARDIAN_PROGRESS_EMAIL=golden-guardian-progress@example.test GOLDEN_PATH_GUARDIAN_LEVELS_EMAIL=golden-guardian-levels@example.test GOLDEN_PATH_ADULT_ONBOARDING_EMAIL=golden-adult-onboarding@example.test GOLDEN_PATH_ADULT_BILLING_EMAIL=golden-adult-billing@example.test GOLDEN_PATH_ADULT_SCHEDULE_EMAIL=golden-adult-schedule@example.test GOLDEN_PATH_ADULT_PENALTY_EMAIL=golden-adult-penalty@example.test GOLDEN_PATH_ADULT_BIRTHDAY_TOWN_EMAIL=golden-adult-birthday-town@example.test GOLDEN_PATH_ADULT_BIRTHDAY_WEST_EMAIL=golden-adult-birthday-west@example.test GOLDEN_PATH_ADULT_PROGRESS_EMAIL=golden-adult-progress@example.test npx firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions   "node qa/scripts/run-golden-path-e2e.mjs"
```

## What the enrolment approval E2E cannot prove

`enrolment-approval-auth-emulator.spec.ts` dispatches two approvals of one request together and
checks that a single member comes out. That is a real case - a distracted second reviewer - but it
is **not** a race. The Functions Emulator runs invocations through a single worker and serialises
them; its own log shows `Beginning ... Finished ... Beginning ... Finished`, never an overlap. This
was verified by mutation: with the approval idempotency key deliberately un-pinned, the whole suite
still passed. Do not cite it as evidence of behaviour under simultaneous contention. The pin is
covered by a unit test that does fail under that mutation
(`apps/functions/src/members/enrolment-request-service.test.ts`, "gives a retry the key the first
attempt pinned, never a fresh one").
