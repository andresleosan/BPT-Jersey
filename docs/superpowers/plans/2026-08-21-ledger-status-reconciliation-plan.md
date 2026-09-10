# Ledger Status Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the documented statuses of `tasks.md` and `Lista/Lista.js` without changing runtime behavior.

**Architecture:** `tasks.md` remains the canonical ledger. `Lista/Lista.js` is updated only in the three stale status fields identified during validation; no functional task is started.

**Tech Stack:** Markdown, JavaScript, Node.js syntax checking.

## Global Constraints

- Do not modify application runtime code.
- Keep `T018` as `pendiente` because its prerequisites are not complete.
- Set `T019`, `T021`, and `T022` to `revisión` in the visual ledger.
- Do not commit, deploy, migrate, or access production data.

---

### Task 1: Synchronize visual ledger statuses

**Files:**
- Modify: `Lista/Lista.js:366-412`

**Interfaces:**
- Consumes: canonical statuses in `tasks.md`.
- Produces: matching `Lista/Lista.js` statuses for `T019`, `T021`, and `T022`.

- [x] **Step 1: Update the three stale statuses**

Change only the status argument for `T019`, `T021`, and `T022` from `en-progreso` to `revisión`. Leave `T018` as `pendiente`.

- [x] **Step 2: Verify JavaScript syntax**

Run: `node --check Lista/Lista.js`

Expected: exit code `0` and no syntax errors.

- [x] **Step 3: Verify the exact status values**

Inspect the affected entries and confirm:

```text
T019 = revisión
T021 = revisión
T022 = revisión
T018 = pendiente
```
