# T011 Retention, Residency And Deletion Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare a safe operator/legal decision packet for T011 without asserting legal compliance or changing runtime behavior.

**Architecture:** A Markdown decision packet is the single operational artifact. Existing classification and Firestore contracts remain authoritative for current controls, while every final retention or residency value remains outside the product until T011 is approved.

**Tech Stack:** Markdown, repository documentation, Git diff checks.

## Global Constraints

- Do not claim GDPR, UK GDPR, Jersey Data Protection Law, PCI DSS, or safeguarding compliance.
- Do not invent retention periods, legal bases, provider regions, transfer mechanisms, or deletion deadlines.
- Keep T011 `bloqueada`, T023 `bloqueada`, and T018 `pendiente`.
- Pilot data is synthetic or sanitized; no production writes, migrations, destructive deletion, or deployment.
- `tasks.md` remains the canonical ledger and must record the packet evidence.

---

### Task 1: Create the T011 decision packet

**Files:**
- Create: `docs/operations/t011-retention-residency-deletion-decision-packet.md`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`

**Interfaces:**
- Consumes: `docs/security/data-classification-threat-model-access-matrix.md`, `docs/data/firestore-data-model.md`, `STACK.md`, `BRIEF.md`.
- Produces: a reviewable decision matrix and ledger evidence that does not unblock T011.

- [x] **Step 1: Inventory decision categories**

Document the categories already present in the project: adult identity, minors/families/relationships, health/support, safeguarding, consents/waivers/documents, memberships/finance, attendance/checkouts, audit events, exports, CRM/communications, Regyfit restricted snapshots, Auth state, backups, and operational logs.

- [x] **Step 2: Define the approval fields**

For every category require an approver and source, retention trigger and period or rule, legal hold behavior, residency/transfer decision, access expiry, deletion or irreversible de-identification method, backup treatment, restore behavior, and audit evidence. Leave these as explicit decisions required from the operator/adviser; do not fill them with assumptions.

- [x] **Step 3: Record provisional pilot controls**

State that the pilot uses synthetic or sanitized data only, has no production writes, keeps history through status/deactivation rather than destructive interactive deletion, excludes secrets and PII from logs, and does not treat emulator cleanup as the final legal deletion policy.

- [x] **Step 4: Add the ledger evidence**

Append a dated entry to `tasks.md` stating that the packet exists, `T011` remains `bloqueada`, and `T023`/`T018` remain blocked or pending until the external decision is recorded. Keep the matching `T011` evidence in `Lista/Lista.js` aligned with that state.

- [x] **Step 5: Verify the documentation**

Run:

```powershell
git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check
```

Confirm that searches for `T011` still show `bloqueada`, that no invented retention period or provider region was introduced, and that the packet does not claim legal compliance.
