# Member-record isolation race review

Baseline: `d324ef4`, `feature/member-profile-live`, `/root/BPT-Jersey-s3`.
All data in this investigation was synthetic. No push, deployment or production access.

## Verdict: (a), a component race

The passive URL-normalisation effect could overwrite a newer navigation with the
location captured by an older render. The identity gate compared the loaded profile
with React's location state; both could correctly identify student 2 while the old
effect had put student 1 back in the browser URL.

An instrumented failure recorded this sequence (timestamps in milliseconds):

| Time | Event |
| --- | --- |
| 5816.09 | Student 1's notes commit under student 1's URL. |
| 5817.55 | Navigation selects student 2; `popstate` queues its React location. |
| 5817.88 | Student 1's pending effect rewrites the URL from student 2 to student 1. |
| 5819.58 | Student 2's profile resolves. |
| 5821.18 | Student 2's notes commit under student 1's URL. |
| 5822.50 | Student 2's effect repairs the URL again. |

This particular failure happens on the first simulated member navigation in the
Back/Forward test, before its `history.back()` call. It depends on timing, not a
demonstrated test-order dependency.

The mismatch is in the actual committed DOM and URL, not a Profiler-only intermediate
render. Repair relies on another passive effect. React allows a browser paint before
passive effects, so that later repair cannot establish that the mismatch is invisible.
See [React's effect timing documentation](https://react.dev/reference/react/useEffect#caveats).

## Reproduction before the fix

- **100 fresh-process whole-file runs:** 0 isolation failures; 3 other file failures
  (one premature coach URL assertion and two keyboard assertions that raced heading focus).
- **500 diagnostic repetitions of the original isolation test:** 3 failures (0.6%),
  all `student-2 rendered under student-1`. A temporary Vite transform repeated the
  test and logged location synchronisation, renders, commits and URL rewrites; it did
  not change component behaviour or the worktree source.
- **20 fresh-process whole-file runs with the new deterministic regression, component
  still unchanged:** 20/20 reproduced that exact isolation assertion (100%).

The deterministic regression selects student 2 from the Profiler callback after
student 1's notes commit and before its passive effects. This forces the observed
relative ordering without relying on a sleep, retries or CPU load. It is a scheduling
boundary probe, not a claim that a browser event executes inside React's commit stack.
The callback continues checking every commit for either student's notes under the
other student's URL. The original Back/Forward regression is unchanged.

Focused deterministic invocation:

```sh
corepack pnpm exec vitest run --project web \
  apps/web/src/app/admin/members/profile/member-record.test.tsx \
  -t 'pending URL repair'
```

It fails against the original component and passes with the fix. For a mutation
check, removing the new location comparison from the normalisation effect restores
the failure.

Whole-file base invocation:

```sh
corepack pnpm exec vitest run --project web \
  apps/web/src/app/admin/members/profile/member-record.test.tsx
```

For zero-based iteration `i`, the loop used the base command when `i % 4 == 0`;
otherwise it appended `--sequence.shuffle --sequence.seed=$((1000+i))` and
`--maxWorkers=1`, `2` or `4` for remainders 1, 2 or 3 respectively. Four independent
CLI processes ran concurrently. Worker-count changes alone do not parallelise the
tests within this single file. Each iteration kept its command, exit code and log.

Local reproduction artifacts are under `/tmp/bpt-isolation-review/`: `repeat.py`,
`before/`, `trace.config.mjs`, `trace-500.log` and `deterministic-before/`. The
diagnostic invocation was:

```sh
corepack pnpm exec vitest run \
  --config /tmp/bpt-isolation-review/trace.config.mjs -t 'never commits'
```

## Change

Before writing history, the normalisation effect reads the current URL and compares
its student ID, tab and Manage mode with its captured location. If navigation has
moved on, it returns. The comparison and history write are synchronous, so navigation
cannot interleave between them. A superseded effect can no longer undo the new
identity; the existing render identity gate and late-response cancellation remain.

Two separately reproduced test timing problems were also corrected: the keyboard
test waits for the loading effect to focus the heading before focusing the tab, and
the coach test waits for URL normalisation before asserting the final URL and absence
of office requests. Neither change relaxes student-isolation assertions.

## Verification

- **200/200 whole-file runs passed, 0 failures (6,400 test executions).**
  Fifty runs used the default invocation; fifty each used shuffled seeds with
  `--maxWorkers=1`, `2` and `4`. The deterministic and original isolation tests were
  included in every run. Commands, exit codes and logs: `/tmp/bpt-isolation-review/after/`.
- **16/16 synthetic browser checks passed**, with zero retries, using the local
  static build at 1440 × 900 and 390 × 844. Coverage included keyboard navigation,
  Back/Forward, loading/error/empty states, coach restrictions and overflow. Notes,
  loading and error screenshots were inspected. No performance improvement is claimed.

```sh
NEXT_PUBLIC_ADMIN_E2E=true node qa/run-e2e.mjs \
  tests/member-profile-live.spec.ts \
  --project=desktop-chromium --project=mobile-chromium --workers=1 --retries=0
```

The build used explicit synthetic Firebase configuration and local/demo settings.
The static server listened only on loopback and was stopped by the test runner.

**Full gate passed:** domain runtime build, formatting, lint, all workspace TypeScript
checks, and **398 test files / 4,274 tests**, with no failures.

```sh
corepack pnpm --filter @bpt-jersey/domain build:runtime && \
corepack pnpm format:check && corepack pnpm lint && \
corepack pnpm typecheck && corepack pnpm test
```

An initial gate attempt was interrupted during lint with exit 137 while the stress
loop and browser build were running. The complete gate was then restarted after
both finished; the interrupted attempt is not counted as a pass.

The successful test-suite log is `/tmp/bpt-isolation-review/gate-tests.log`.
Browser log: `/tmp/bpt-isolation-review/browser-tests.log`; screenshots:
`qa/test-results/member-profile-live-*/`.
