# T008 Academy Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Cronos executes this documentation task inline; no commit is authorized.

**Goal:** Create a provisional academy-configuration record that separates public website facts from fictitious `(f)` placeholders and unresolved academy decisions.

**Architecture:** The record is a human-reviewed Markdown source for future T013 data modeling. It is not a seed file, database migration, production configuration, billing input, authorization source, or runtime fixture. Provenance is explicit at the value/section level, and pending contradictions remain unresolved.

**Tech Stack:** Markdown, public BPT Jersey website sources, Git diff checks, OpenCode search tools.

## Global Constraints

- `Published` values come from `https://bptjersey.com/`, `/classes`, `/contact-us`, or `/privacy-policy`, consulted on 2026-08-07.
- Every invented value carries `(f)` directly beside the value.
- `Pending approval` values are not silently resolved.
- No `(f)` value may seed production, billing, attendance, capacity enforcement, notifications, or authorization rules.
- T008 remains blocked until the academy/operator approves the operational values.
- T013 may model stable relationships but cannot encode `(f)` or pending values as production invariants.
- Do not add personal data, credentials, payment secrets, or real customer records.
- Do not modify Firebase files or production code.
- Do not commit unless the operator explicitly requests a commit.

---

### Task 1: Create the provisional source-of-truth document

**Files:**
- Create: `docs/operations/academy-configuration-provisional.md`
- Reference: `docs/superpowers/specs/2026-08-07-t008-academy-configuration-design.md`

**Interfaces:**
- Consumes: approved T008 design and public website facts.
- Produces: a provisional Markdown configuration that T013 can reference without treating placeholders as final.

- [ ] **Step 1: Create the document header and provenance legend**

Start the file with:

```markdown
# BPT Jersey Academy Configuration (Provisional)

Status: provisional; T008 remains blocked pending academy approval.
Last website consultation: 2026-08-07.

`Published` = copied from the public website.
`(f)` = fictitious placeholder for modeling/testing only.
`Pending approval` = must be confirmed by the academy/operator.

No `(f)` value may reach production, billing, attendance, capacity enforcement, notifications, or authorization rules.
```

- [ ] **Step 2: Add source links and public program/location data**

Include the four source URLs, then list the published programs and locations. Every published bullet must use `[Published]` and retain exact public wording where practical. Include Carrefour Metro and Strive addresses; record Age Concern as a referenced Saturday kids location with address `Pending approval`.

- [ ] **Step 3: Add the published schedule table**

Create a table with columns `Program/session`, `Day/time`, `Location`, `Source state`. Include exactly these published rows:

| Program/session | Day/time | Location | Source state |
|---|---|---|---|
| Kids | Tuesday and Thursday, 17:30 | Strive Health Club | Published |
| Kids under 4-6 years | Saturday, 09:00-09:45 | Age Concern | Published; address pending approval |
| Kids age 7-9 | Saturday, 10:00-10:45 | Age Concern | Published; address pending approval |
| Kids age 10-12 | Saturday, 11:00-12:00 | Age Concern | Published; source text says `1100-1200am`, pending confirmation |
| Beginners BJJ | Monday and Wednesday, 18:30-19:30 | Carrefour Metro | Published |
| BJJ | Monday, 12:00-13:00 | Carrefour Metro | Published |
| BJJ | Friday, 13:15-14:15 | Carrefour Metro | Published |
| Open mat | Friday to Sunday | Carrefour Metro | Published; exact times pending approval |
| Beginners BJJ | Tuesday and Thursday, 18:30-19:30 | Strive Health Club | Published |
| No-Gi | Tuesday and Thursday, 06:00-07:00 | Carrefour Metro | Published |

Do not invent a timezone, session ID, instructor assignment, or capacity in this table.

- [ ] **Step 4: Add public prices without resolving contradictions**

Record `£40/month` for Carrefour Metro, `£10/session` or `£65/month` for BPT West/Strive with the public `£8 class` wording, and `£95` once weekly for the current kids school term. Mark the kids Carrefour-membership restriction versus Strive/Age Concern as `Pending approval`.

---

### Task 2: Add fictitious placeholders and pending decisions

**Files:**
- Modify: `docs/operations/academy-configuration-provisional.md`

**Interfaces:**
- Consumes: public facts from Task 1.
- Produces: clearly marked test/modeling defaults and an explicit approval register.

- [ ] **Step 1: Add operating defaults with `(f)` markers**

Add these exact placeholders:

```markdown
- Timezone: `Europe/Jersey (f)`.
- Default session status: `scheduled (f)`.
- Default booking status: `requested (f)`.
- Default membership status: `trial (f)`.
- Default currency: `GBP (f)`.
```

- [ ] **Step 2: Add capacity placeholders**

Add `24 (f)` for Carrefour BJJ/No-Gi, `20 (f)` for Strive adult sessions, `16 (f)` for Strive kids, `12 (f)` per Age Concern Saturday age group, and `30 (f)` for open mat. State that none are approved safety limits.

- [ ] **Step 3: Add membership and booking placeholders**

Add: booking opens `14 days before session (f)`; cancellation cutoff `12 hours before session (f)`; waitlist limit `5 people (f)`; billing date `1st of each month (f)`; freeze limit `2 months per membership year (f)`; freeze notice `7 days before the next billing date (f)`; overdue grace `7 days (f)`; trial duration `14 days (f)`; refund rule `manual review required (f)`.

- [ ] **Step 4: Add the pending approval register**

List the unresolved Age Concern address/activation, kids membership contradiction, `£8 class` ambiguity, definitive programs/levels/age bands/instructors, capacities, membership rules, booking/waitlist rules, open mat details, payment provider/tax, and `T011` privacy/retention/residency/deletion decisions.

---

### Task 3: Verify provenance, safety boundaries, and T008 state

**Files:**
- Modify: `tasks.md:17`
- Modify: `docs/operations/academy-configuration-provisional.md`

**Interfaces:**
- Consumes: completed provisional configuration.
- Produces: documentary evidence and an unchanged blocked T008 gate.

- [ ] **Step 1: Verify all invented values are marked**

Use OpenCode `grep` with:

```text
pattern: \(f\)|Pending approval|Published|production|billing|authorization
path: docs/operations
include: academy-configuration-provisional.md
```

Expected: every fictitious section contains `(f)`, every source section has `Published`, and the no-production rule is present.

- [ ] **Step 2: Verify no sensitive or executable data was introduced**

Use OpenCode `grep` with:

```text
pattern: password|secret|credential|serviceAccount|api[_-]?key|privateKey|customer|student name|email address
path: docs/operations
include: academy-configuration-provisional.md
```

Expected: no matches. Public business data is allowed; real customer records are not.

- [ ] **Step 3: Verify document quality**

Run:

```powershell
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
```

Expected: no output. Check manually that no `(f)` value appears without its marker and no `Pending approval` item is written as an approved rule.

- [ ] **Step 4: Keep T008 blocked and record evidence**

Leave the T008 row as `bloqueada`. Append a dated evidence entry to `tasks.md` stating that public data was consulted, placeholders are marked `(f)`, contradictions remain pending, and academy approval is still required. Do not mark T008 `aprobada` based only on the website.

- [ ] **Step 5: Stop before T013 implementation**

Do not alter `firestore.indexes.json`, Rules, migrations, or code. T013 resumes only after this document is reviewed and the operator decides whether provisional values may be used for modeling.
