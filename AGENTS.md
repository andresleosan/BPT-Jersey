# BPT Jersey — project working instructions

Read `PRODUCT.md` and `DESIGN.md` before product or interface changes. Reuse the existing admin shell, controls and brand tokens. Coach views must preserve their role restrictions and exclude financial workflows. Authentication, Google linking and attendance controls must remain functional.

No process books classes for a member (ADR-018): a booking comes only from the owner/administrator in the office or from the member in `/account`. Never add scripts, triggers or schedules that create bookings.

## Current function-fix workflow (operator preference)

- Work directly on local `main`. Fetch and integrate `origin/main` before editing,
  preserving unrelated changes. Do not create branches, worktrees, or pull requests
  unless the user explicitly asks for them.
- Commit only the requested fix and push directly to `origin/main`. A task is not
  delivered until the commit is on both local and GitHub `main`; verify their SHAs.
  Never force-push or discard unrelated work. Resolve routine integration locally.
- Do not add, run, retry, or wait for automated tests unless explicitly requested:
  this includes unit, rules, integration, browser, coverage, and `verify:mvp` suites.
  Do not repair unrelated test fixtures as part of a function fix.
- GitHub test workflows are manual-only. Do not dispatch them or restore automatic
  push, pull-request, or scheduled triggers without an explicit request.
- Use code inspection and Git state to verify delivery. Full-workspace lint, type
  checks, formatting, and builds are not routine gates. Compile only what is needed
  for an authorized deployment, and report clearly when tests were not run.
- Read only documentation relevant to the fix. A small backend correction does not
  require design reviews, browser screenshots, a new plan/spec/ADR, or ledger/board
  updates unless its scope actually changes those artifacts or the user asks.
- GitHub publication and Firebase deployment are separate operations. Reuse any
  existing authorization for the relevant deployment scope; do not ask again for
  actions already authorized. This workflow does not grant new production access.

## Standing skill preferences

The owner explicitly requested that the following skills remain part of this project's working context. Consider all of them at the start of each new task, then read and apply the ones relevant to its scope. Do not force unrelated design or infrastructure work into a task. These are the skills confirmed in this project's conversation; no additional historical usage is assumed.

| Skill | Use when | Local source in this workspace |
| --- | --- | --- |
| critica-de-diseno | Interface critique, specification and visual review | `/root/.codex/skills/critica-de-diseno/SKILL.md` |
| design-taste-frontend | Landing and brand direction, within its stated applicability | `/root/.codex/skills/design-taste-frontend/SKILL.md` |
| frontend-design | Interface implementation consistent with BPT | `/root/.agents/skills/frontend-design/SKILL.md` |
| impeccable | Product context, spacing, hierarchy and polish | `/root/.codex/skills/impeccable/SKILL.md` |
| web-performance-optimization | Loading, rendering and measured performance | `/root/.codex/skills/web-performance-optimization/SKILL.md` |
| ponytail | Simplification and maintainable implementation | `/root/.codex/skills/ponytail/SKILL.md` |
| frontend-security-coder | Safe frontend data handling and interactions | `/root/.codex/skills/frontend-security-coder/SKILL.md` |
| bash-defensive-patterns | Shell automation and deployment scripts | `/root/.codex/skills/bash-defensive-patterns/SKILL.md` |
| security-best-practices | Security-sensitive implementation and review | `/root/.codex/skills/security-best-practices/SKILL.md` |

Resolve these skills through the current environment's skill catalog if local paths differ. Report missing required skills rather than pretending to apply them. Existing project design and explicit user requirements take precedence over generic aesthetic defaults. This list does not grant deployment, IAM changes or access to secrets.

## Verification

Follow the current function-fix workflow above. Automated tests are opt-in by explicit user request. For requested interface verification, use synthetic data and keep the review limited to the changed behavior; never expose member data or credentials. Do not infer functional success from a Git push or compilation alone.
