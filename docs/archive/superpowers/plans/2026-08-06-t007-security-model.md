# T007 Security Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Cronos must execute inline and must not delegate to subagents.

**Goal:** Produce and verify the preliminary data-classification, threat-model, and role-access baseline required before BPT Jersey implements domain data or authorization.

**Architecture:** One technology-independent security document will be the source of truth for classifications, threats, access boundaries, and downstream control ownership. It will describe policy intent without prematurely defining Firestore collections, custom claims, Firebase Rules, R2 paths, or API contracts.

**Tech Stack:** Markdown, Git, ripgrep, existing Cronos `security-baseline`, `BRIEF.md`, `STACK.md`, and `tasks.md`.

## Global Constraints

- Treat the project as Level 3 because it processes child, health, payment, consent, and safeguarding data.
- Keep internal technical documentation in Spanish; retain code identifiers and role names in English.
- Do not claim GDPR, UK GDPR, Jersey Data Protection Law, PCI DSS, or safeguarding compliance; `T011` remains the legal-policy gate.
- Do not define concrete data collections or authorization rules; those belong to `T013` and `T016`.
- Do not introduce authenticated accounts for minors in the MVP.
- Preserve human approval for payments, promotions, safeguarding, and recognition decisions.
- Do not commit unless the operator explicitly requests it.

---

### Task 1: Open T007 and establish document boundaries

**Files:**
- Modify: `tasks.md:17`
- Create: `docs/security/data-classification-threat-model-access-matrix.md`
- Reference: `BRIEF.md:23-87`
- Reference: `STACK.md:49-67`
- Reference: `docs/superpowers/specs/2026-08-06-t007-security-model-design.md`

**Interfaces:**
- Consumes: the approved scope and role list in the design specification.
- Produces: a security document with stable headings used by all later plan tasks.

- [ ] **Step 1: Mark T007 as active**

Change only the T007 state in `tasks.md` from `pendiente` to `en-progreso`. Do not alter blocked decisions `T008-T011`.

- [ ] **Step 2: Create the document skeleton**

Create `docs/security/data-classification-threat-model-access-matrix.md` with these headings in this order:

```markdown
# Clasificación de datos, amenazas y matriz preliminar de acceso

## Estado y propósito
## Alcance y supuestos
## Principios de seguridad
## Niveles de clasificación
## Inventario de datos del MVP
## Actores y fronteras de confianza
## Modelo de amenazas
## Matriz preliminar de acceso
## Controles transversales obligatorios
## Riesgos y decisiones abiertas
## Trazabilidad a tareas
## Criterio de revisión
```

State that this is a preliminary policy model, not a legal-compliance certification or a concrete Firebase schema.

- [ ] **Step 3: Verify the scope language**

Use OpenCode's `grep` tool with:

```text
pattern: preliminar|cumplimiento|Firestore|T013|T016
path: docs/security
include: data-classification-threat-model-access-matrix.md
```

Expected: the document explicitly says the model is preliminary, does not claim compliance, and defers concrete storage and Rules design to `T013`/`T016`.

---

### Task 2: Define classification and data inventory

**Files:**
- Modify: `docs/security/data-classification-threat-model-access-matrix.md`
- Reference: `BRIEF.md:38-87`
- Reference: `STACK.md:49-110`

**Interfaces:**
- Consumes: the four classification levels approved in the design.
- Produces: classification definitions and one classification assignment for every MVP data domain.

- [ ] **Step 1: Document security principles**

Include all of these rules:

- Deny by default and least privilege.
- Purpose, role, family relationship, and class/staff assignment limit access.
- Restricted fields override broader record permissions.
- Derived data inherits the highest source classification unless declassification is documented.
- Sensitive actions run through authorized backend commands and produce audit events.
- Historical financial, membership, attendance, consent, and assessment records are retained or soft-deleted according to the future `T011` policy.
- Guardian visibility is mandatory for communication involving a minor.
- Belts, stripes, recognition, refunds, payment corrections, and safeguarding decisions are never automatic final decisions.

- [ ] **Step 2: Define the four levels**

Add a table with exact identifiers and intent:

| Level | Meaning | Minimum handling |
|---|---|---|
| `Public` | Deliberately published information | Integrity controls; no private data |
| `Internal` | Non-public, low-sensitivity operations | Authenticated workforce access; no public indexing |
| `Confidential` | Personal, commercial, progress, CRM, or administrative financial data | Relationship/assignment-scoped access; audit sensitive changes |
| `Restricted` | Child, health, safeguarding, consent, pickup, credentials, payments, and audit evidence | Explicit authorization, backend enforcement, strongest audit and export restrictions |

- [ ] **Step 3: Classify every MVP domain**

The inventory table must contain at least these rows and classifications:

- Public academy content, programs published for marketing, and public contact details: `Public`.
- Internal class templates, non-sensitive room/location operations, and staff availability: `Internal`; any linked personal data raises the record to `Confidential`.
- User identity, family relationships, guardian contacts, adult students, staff profiles, CRM leads, bookings, memberships, invoices, receipts, balances, attendance, progress, assessments, recognition candidates, and message-delivery history: `Confidential`.
- Minor identity and date of birth, medical/support needs, emergency contacts, safeguarding notes, consent/waiver evidence, authorized pickup, independent-leave authorization, precise child presence/check-out state, authentication factors, payment provider identifiers/webhook evidence, audit logs, private exports, backups, and private R2 objects: `Restricted`.
- Raw card data, passwords, MFA secrets, provider secrets, and unrestricted private-object URLs: prohibited from application storage.

For each row include data subjects, examples, primary users, retention dependency, and downstream task.

- [ ] **Step 4: Check coverage and forbidden storage**

Use OpenCode's `grep` tool with:

```text
pattern: Public|Internal|Confidential|Restricted|menor|médic|pago|consent|auditor|tarjeta|contraseña|MFA|R2
path: docs/security
include: data-classification-threat-model-access-matrix.md
```

Expected: all four levels and all high-risk categories are present; prohibited raw card and secret storage is explicit.

---

### Task 3: Model trust boundaries, threats, and abuse cases

**Files:**
- Modify: `docs/security/data-classification-threat-model-access-matrix.md`
- Reference: `docs/adr/ADR-002-firebase-platform.md`
- Reference: `docs/adr/ADR-003-cloudflare-r2-private-files.md`
- Reference: `docs/security/dependency-risk-register.md`

**Interfaces:**
- Consumes: classified assets from Task 2.
- Produces: threat entries with severity, mitigation, residual risk, and task ownership.

- [ ] **Step 1: Define actors and trust boundaries**

Document these actors: unauthenticated visitor, `owner`, `administrator/reception`, `head coach`, `coach`, `parent/guardian`, `adult student`, disabled/former staff, payment/email providers, and system jobs. State that minors are protected data subjects, not authenticated actors.

Document these boundaries: browser/PWA to Firebase Auth; browser to Firestore/RTDB Rules; browser to Cloud Functions; Functions to Firebase Admin; Functions to R2; payment/email provider to webhook; CI/operator to cloud environments; export/backup storage to authorized recipients.

- [ ] **Step 2: Add the threat register**

Use IDs `THR-001` onward and cover these minimum cases:

- Account takeover and weak/reused credentials.
- Role/custom-claim escalation and stale access after staff deactivation.
- Cross-family and cross-student object access.
- Coach access outside assigned classes or operational purpose.
- Child check-in/check-out falsification or unauthorized pickup.
- Medical, safeguarding, consent, assessment, and waiver disclosure.
- Enumeration, scraping, bulk export, and excessive read abuse.
- Forged, replayed, duplicated, or reordered payment webhooks.
- Payment, attendance, assessment, or membership correction without audit history.
- Hidden private coach-to-minor communication.
- Public, overlong, or replayable R2 signed URLs.
- Secrets or personal data in source, logs, console, CI artifacts, screenshots, or test fixtures.
- Injection, unsafe input, oversized payload, and file-upload abuse.
- Denial of service or cost amplification against public endpoints and Firebase operations.
- Audit-log tampering or deletion.
- Backup exposure or restoration into the wrong environment.
- Dependency compromise and unsafe build scripts.

Each row must include STRIDE category, asset, scenario, inherent severity, baseline mitigation, residual risk, and owner task. Critical inherent risks must either have a concrete mitigation path or remain blocking.

- [ ] **Step 3: Apply the security-baseline checklist explicitly**

Add a short cross-check covering authentication/authorization, sensitive data in responses and logs, secrets, `.gitignore`/history, input validation, integrations, dependencies, and rate limiting/abuse protection. Link each item to `T014-T019`, `T024`, `T034-T036`, `T045-T047`, or `T055` as applicable.

- [ ] **Step 4: Verify threat coverage**

Use OpenCode's `grep` tool with:

```text
pattern: THR-[0-9]{3}|suplant|escal|famil|check-out|webhook|R2|logs|rate|auditor|backup|dependenc
path: docs/security
include: data-classification-threat-model-access-matrix.md
```

Expected: the threat register includes every required domain and numbered threat IDs without gaps.

---

### Task 4: Define the access matrix and close documentary QA

**Files:**
- Modify: `docs/security/data-classification-threat-model-access-matrix.md`
- Modify: `tasks.md:17,124-178`

**Interfaces:**
- Consumes: classification and threat constraints from Tasks 2 and 3.
- Produces: review-ready T007 evidence and downstream authorization requirements.

- [ ] **Step 1: Define matrix notation and operations**

Use:

- `F`: full within authorized academy scope.
- `S`: scoped by self, family relationship, assigned class, or assigned operational responsibility.
- `A`: explicit approval action only.
- `-`: prohibited.

Cover read, create, update, approve, export, and delete/retain. State that `F` never bypasses restricted-field exceptions, purpose limits, or audit requirements.

- [ ] **Step 2: Add all matrix domains and minimum restrictions**

Include rows for identity/accounts, family/guardian links, minor profiles, medical/support data, staff, programs/classes, bookings, attendance, child check-out, memberships, payments/invoices/refunds, consents/waivers, assessments, progress, recognition, CRM, communications, private files, audit logs, reports, and exports.

Enforce these minimum negative rules:

- `coach` cannot read payment details, unrestricted medical records, safeguarding records, CRM, exports, or audit logs.
- `coach` access to student/attendance/progress data is assignment-scoped.
- `parent/guardian` can only access linked family members and cannot alter staff-authored attendance or assessments directly.
- `adult student` can only access self-service data and cannot access another family/student.
- `administrator/reception` cannot approve belts/stripes or head-coach-only recognition.
- `head coach` cannot receive unrestricted financial-provider secrets or bypass financial controls.
- Only tightly authorized roles can export; every export is purpose-limited and audited.
- No interactive user can mutate or delete audit events.
- Deactivated staff immediately lose interactive access.

- [ ] **Step 3: Document open decisions and traceability**

Keep `T008-T011` explicitly open. Map controls to at least `T013`, `T014`, `T015`, `T016`, `T017`, `T018`, `T019`, `T023`, `T024`, `T030`, `T034`, `T036`, `T047`, `T053`, `T054`, and `T055`.

- [ ] **Step 4: Run documentary verification**

Use OpenCode's `grep` tool for both searches, then run the Git check:

```text
pattern: owner|administrator/reception|head coach|coach|parent/guardian|adult student|system/integration
pattern: T008|T009|T010|T011|T013|T016|T019|T024|T030|T036|T047|T053|T054|T055
path: docs/security
include: data-classification-threat-model-access-matrix.md
```

```powershell
git diff --check
```

Expected: all roles and control-owner tasks are present; `git diff --check` returns no output. Manually verify that every heading has substantive content and every table row has a classification, access decision, or explicit external dependency.

- [ ] **Step 5: Perform the final security review**

Review every `Restricted` inventory row against the matrix and threat register. Block closure if any restricted data lacks a negative access rule, audit expectation, or downstream enforcement task. Record any non-critical residual risk under `Riesgos y decisiones abiertas`.

- [ ] **Step 6: Move T007 to review and record evidence**

If and only if Step 5 finds no critical gap, change T007 from `en-progreso` to `revisión`. Add a dated `T007` entry under `Evidencia del ciclo de autocrítica` summarizing classification coverage, threat count, access-matrix scope, security-baseline result, documentary QA commands, and residual blocked decisions `T008-T011`.

- [ ] **Step 7: Stop for operator review**

Present the completed security document and evidence. Do not move T007 from `revisión` to `aprobada` until the operator accepts the document or all requested corrections have been applied and reverified.
