# BPT Jersey — project working instructions

Read `PRODUCT.md` and `DESIGN.md` before product or interface changes. Reuse the existing admin shell, controls and brand tokens. Coach views must preserve their role restrictions and exclude financial workflows. Authentication, Google linking and attendance controls must remain functional.

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

Run focused tests for changed behavior, TypeScript and lint checks. For interface changes, inspect real rendered pages at mobile and desktop widths, including keyboard navigation, loading/error states and overflow. Use synthetic fixtures for screenshots; never expose member data or credentials. Report measured performance separately from expected improvements.
