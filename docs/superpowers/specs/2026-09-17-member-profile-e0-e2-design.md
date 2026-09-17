# Member profile E0–E2: security fix, canonical member record with birthdays, JIU-JITSU IBJJF (T051V2)

Date: 2026-09-17 · Branch: `feature/member-profile-e0-e2` · Task: T051V2 (E0–E2 of the member record clone)

## 1. Context and goal

Regyfit's "Search Members 2.0" opens a member record with tabs PROFILE, DETAILS, PLAN, DOCUMENTS,
PAYMENTS, CLASSES, COMMUNICATION, NOTES. The operator wants the whole record replicated in BPT and
improved. The work is split into deliveries, each with its own spec → grill → plan → build → Playwright:

| #   | Delivery                                                                                                                           | This spec |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | --------- |
| E0  | Security: remove imported app password, mask restricted identifiers in the Regyfit panel                                           | yes       |
| E1  | Canonical member record on `students`: search → record page, header, PROFILE (base cards), DETAILS (all Regyfit fields), birthdays | yes       |
| E2  | JIU-JITSU IBJJF: profile card + Manage (history, assign, void, skills assessment)                                                  | yes       |
| E3  | CLASSES + monitoring (30-day attendance, usage index, sleeper, 12-month chart, history)                                            | no        |
| E4  | PLAN + PAYMENTS per member                                                                                                         | no        |
| E5  | NOTES, COMMUNICATION log/scheduling, responsible coach, groups                                                                     | no        |
| E6  | DOCUMENTS per member                                                                                                               | no        |

Sources: read-only Regyfit capture (raw, personal data, outside the repo:
`/root/regyfit-capture/raw/member-profile/`, `/root/regyfit-capture/raw/member-full/`), BPT inventory
of 2026-09-17.

## 2. Operator decisions (2026-09-17, in chat)

1. The record reads the canonical `students` identity, not `regyfitMemberRecords`.
2. Search runs over `students`; the imported Regyfit directory stays as read-only reference, not linked
   (ADR-009 / field-mapping forbid merging without a reviewed reconciliation).
3. Scope of the member record = everything Regyfit shows, delivered as E0–E6; this cycle is E0+E1+E2.
4. Imported app password: removed entirely (contract, panel, importer).
5. DETAILS replicates Regyfit's fields as they appear, **including health number, weight, height and
   BMI**. This is an explicit operator exception to `docs/operations/t011-retention-residency-erasure-policy.md`
   decision 4 (health data prohibited in the MVP without an approved DPIA). Recorded as debt: the policy
   must be amended or a DPIA completed before production deploy of those fields (see §8).
6. Skills catalogue: import Regyfit's full list (58 skills observed) with per-level minimums.
7. Wrongly assigned level: void with mandatory reason (append-only history), never delete.

## 3. Architecture

Static export constraint (`output: "export"`): no dynamic segments. The record is a static route
`apps/web/src/app/admin/members/profile/page.tsx` reading `?id=<studentId>` on the client, with
`?tab=<profile|details|plan|documents|payments|classes|communication|notes>` and `&view=manage` for the
IBJJF Manage screen, so every state is linkable and survives reload.

Layering per CLAUDE.md:

- `packages/domain/src/members/member-profile-contracts.ts` — `getMemberProfile` input/output, DETAILS
  field schemas, birthday badge derivation (pure), BMI derivation (pure).
- `packages/domain/src/levels/level-contracts.ts` (+ new `skill-catalog` data) — skill categories,
  per-level skill minimums, single progress formula, `voidPromotion` input, promotion history view.
- `apps/functions/src/members/member-profile-service.ts` / `-firestore.ts` / `-callables.ts` —
  aggregate read, audited.
- `apps/functions/src/levels/` — extend progress summary (attendance since level start), add
  `voidPromotion`, add `getStudentLevelHistory` if `listGraduations` cannot filter by student.
- `apps/web/src/lib/member-profile-client.ts`; levels client extended.
- UI under `apps/web/src/app/admin/members/profile/`.

`packages/domain` never imports Firebase. New callables are exported from `apps/functions/src/index.ts`.

## 4. E0 — Security fix

- Remove `password` from `regyfitAppAccessSchema`
  (`packages/domain/src/members/regyfit-member-record-contracts.ts:63-68`). The schema is strict, so a
  stored record still carrying `password` would fail parsing: the read path strips the key before parse
  (explicit, tested) instead of failing the whole panel; the importer
  (`qa/scripts/import-regyfit-member-records.mjs`) drops it and never writes it.
- `member-profile-panel.tsx`: remove the "Password" row.
- `getRegyfitMemberRecord`: return `idCardNumber`, `healthNumber`, `vatNumber` masked (last 3 characters);
  a new `revealRegyfitRecordField({recordId, field, purpose})` (owner/administrator, closed purpose enum,
  rate-limited, audited) returns one value. The panel shows a "Reveal" text button per field.
- Production purge of already stored passwords: separate runbook step (dry-run count first), executed
  only after the operator confirms in chat. Not part of automated tasks.

Tests: contract rejects/strips `password`; panel has no "Password" text; handler output is masked;
reveal requires admin, writes an audit event, and a disabled audit write makes the test fail.

## 5. E1 — Canonical member record

### 5.1 Search (`/admin/members/search`)

- The exact/fuzzy search over canonical students (existing `lookupMemberIdentity` / `listMembers`)
  becomes the primary block; each result row has an inline text action "Open record" linking to
  `/admin/members/profile?id=`.
- The imported Regyfit directory remains below, labelled "Regyfit archive (read only)".
- Remove inline off-brand colours (`#4f46e5`, `#eef2ff`, `#4b5563`) in favour of DESIGN.md tokens.
- Restricted identifiers never appear in the results (ADR-009 rule 14 allowlist).

### 5.2 Record header

Name, masked member reference, age, participant type, status (text + left border colour, no pill),
birthday badge. Tab list with the 8 Regyfit tabs (ARIA tabs, arrow keys, same pattern as the existing
panel). Tabs not delivered yet (PLAN, DOCUMENTS, PAYMENTS, CLASSES, COMMUNICATION, NOTES) render the
DESIGN.md empty state (eyebrow + headline + one sentence + one button) linking to the current module
(Memberships, Waivers, Billing, Attendance, CRM, —).

### 5.3 Birthdays

- Derived server-side from `students.dateOfBirth` in the academy time zone (Europe/Jersey).
- `birthdayBadge`: `today` | `inDays(1..7)` | none, obtained by calling the existing
  `deriveUpcomingBirthdays` (`packages/domain/src/birthdays/upcoming-birthday-contracts.ts:123`) with
  `windowDays: 7` and the single candidate; its `celebratesOn` already maps 29 February to 28 February in
  non-leap years. No new date logic.
- Header chip text: "Birthday today" / "Birthday in N days"; DETAILS shows "N years old" beside the date.
- The existing upcoming-birthdays band on the overview links each name to the record.

### 5.4 PROFILE tab (E1 cards)

- Member card: "Member since <date> · N months", profession.
- JIU-JITSU IBJJF card (§6.1).
- Account manager: guardians from Families, link to the family; "No account manager" empty state.
- Plan summary: current membership (name, status, valid until) from memberships, link to Memberships.
- Cards for monitoring, app access, communication, coach, POS balance, staff, groups, latest changes
  arrive in E3–E6 and are not rendered as placeholders.

### 5.5 DETAILS tab

One form, one Save button (plus Ctrl/Cmd+S), dirty-state warning on tab change/navigation, labels above
inputs, sections as in Regyfit:

| Section        | Fields                                                                                               | Input                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Identification | Full name*, Short name, Member No., Nickname (internal, never shown to the member)                   | text, select of generated variants, text with "next free number", text |
| Contacts       | E-mail, Mobile (country code + number), Emergency contact (name, relationship, phone)                | email, select + tel, existing structure                                |
| Address        | Address, City, Postal code, Country                                                                  | text, text, text, select (ISO 3166)                                    |
| Documents      | ID card no., ID expiry, Health number, Tax number, Profession                                        | text, date (expired / expires ≤30 days notice), text, text, text       |
| Personal       | Gender, Date of birth* (+ "N years old"), Weight (kg), Height (cm), BMI (read-only value + category) | select, date, number 1–400, number 30–250, derived                     |
| Registration   | Registration date, Recommended by (member picker), How they heard, Initial contact                   | date, student picker, academy option list, academy option list         |
| Notes          | Internal notes                                                                                       | textarea ≤2000                                                         |

- "How they heard" / "Initial contact" option lists are academy settings (seeded with Regyfit's values:
  Friends, Social networks, Radio, Television, Flyers, Website, WhatsApp, Others / Phone, Facebook, In
  person, Instagram, Website, WhatsApp); editing the lists is admin-only and out of this spec's UI
  beyond a simple manage dialog.
- BMI is computed on read, never stored.
- Schemas: extend `studentAdminProfile` base shape and `updateMember` input (zod strict, trimmed,
  bounded lengths); member number uniqueness enforced in a transaction.
- Restricted fields (member no., ID card, tax no., health no., weight, height, notes) are returned only
  by `getMemberProfile` to owner/administrator, audited per read (reuse `studentRestrictedReadLimits`),
  and never in lists, search, exports or analytics.

### 5.6 `getMemberProfile`

Input `{ studentId }`. Roles owner/administrator. Output: header, birthday badge, profile cards data
(member since, account managers, current membership summary), details. App Check enforced. Rate-limited
and audited as a restricted read. Errors mapped to safe strings in the web client.

## 6. E2 — JIU-JITSU IBJJF

### 6.1 Profile card

Belt rendered with DESIGN.md §10 belt components (bar + tip with stripe marks, ordered stripe list),
level name, promotion date, "Next graduation" single progress value and bar, "Classes since last
promotion x/y", "Days at this level x/y" (met = green left border text), "Manage" button. Uninitialised
level → empty state "No level yet" with "Open level" (head coach/owner). Visible to owner, administrator,
headCoach, coach (existing level roles); the rest of the record stays owner/administrator.

### 6.2 Single progress formula (domain, pure)

`progress = mean(min(classes/minClasses,1), min(days/minDays,1), [skills])` where
`skills = Σ min(score_i, required_i) / Σ required_i` included only when the level defines skill
minimums; a criterion with no minimum is excluded from the mean; result floored to an integer 0–100.
Card and Manage call the same function (fixes Regyfit's 100% vs 67% mismatch).
`classes` counts attended/late attendance with date ≥ `currentLevelStartedAt` (change in
`level-service.ts` progress summary; covered by tests before/after).

### 6.3 Manage view (`&view=manage`)

- Back to record; age, name, level system.
- **Level history** table: level (belt icon + name), assigned on, classes/days at assignment (x/min),
  promoted by, status. Voided rows shown struck through with reason and who voided.
- **Assign next level** (headCoach, owner): level select limited to levels after the current one in
  sequence; promotion date required, no default, not in the future, not before the current level start;
  confirmation dialog "Promote <name> from <X> to <Y> on <date>?"; reuses
  `openStudentLevel` / `approvePromotion` semantics (append-only).
- **Void promotion** (headCoach, owner): only the latest non-voided promotion; mandatory reason
  (10–500 chars); confirmation; new callable `voidPromotion` appends a void record, restores the previous
  level head, audits. Never deletes.
- **Skills assessment**: categories derived from the captured label prefix before " - " (observed:
  Dominant Positions 9, Guard 5, Guard Passing 6, Submissions 12, Sweeps 8, Escapes, Warm Up 1–10 grouped
  as "Warm Up", unprefixed labels such as "Tie The Belt" and "Berimbolo" grouped as "Fundamentals"; the
  sanitized capture is the source of truth) as collapsible groups with a per-group "rated/min met" count;
  each skill a 1–5 radio group (accessible, 44px targets); level minimum marked with an outline and text
  "Minimum 2"; Save explicit, dirty warning; stored with `recordEvaluation` (extended to many skills in one
  call if needed). Coaches may rate; headCoach/owner assign/void.

### 6.4 Skill catalogue import

A sanitized, structure-only capture of Regyfit's skill list (labels, category, sequence) and per-level
minimum-score sets (from the level rule format `minAge*maxAge*minClasses*minDays*skillId+minScore-…`)
committed as `docs/data/ibjjf-skills-observed.sanitized.json`; seeded as a new catalogue version through
the existing level seed/publication path (versioned in-house, never synced live from Regyfit). The
`expected_11_skills` integrity check becomes version-aware.

## 7. Cross-cutting

- DESIGN.md: square corners, purple accent only, status as text + left border, Barlow Condensed display /
  Source Sans 3 body, tabular numbers, skeleton loaders, empty-state pattern, inline row actions, 44px
  targets, one column below 50rem, no horizontal scroll, reduced motion, UK English, no emojis or
  icon-only buttons. Run the impeccable/taste audit on the finished screens.
- Frontend security: no `dangerouslySetInnerHTML`; all callable responses zod-parsed; safe error strings;
  `id` query param validated as an opaque identifier before any call; no restricted value in URLs, logs,
  `console`, analytics or `localStorage`; no new external origins (CSP unchanged).
- Backend security: App Check, role checks via existing helpers, academy scope assertion, strict zod
  input, audit on restricted reads/writes, Firestore rules stay deny-direct for new data.
- Code: follow existing patterns, smallest diff, no new dependencies.

## 8. Risks and debt

- Health data in DETAILS contradicts t011 decision 4 (operator exception, §2.5). Production deploy of
  those four fields is gated on the operator amending the policy or approving a DPIA; the plan's deploy
  checklist blocks on it.
- Existing passwords in production `regyfitMemberRecords`: purge requires explicit confirmation.
- A composite index may be needed for attendance since level start; add to `firestore.indexes.json`
  and test against the emulator.
- Regyfit adult-with-plan record was not captured (auto-mode block); E1 fields do not depend on it.

## 9. Testing and evidence

- Unit (TDD): domain (birthday badge, BMI, progress formula, details schemas, void input), functions
  services with in-memory fakes (profile aggregate, audit, attendance since level start, void,
  member-number uniqueness), web components (tabs, form dirty state, masking, confirmation dialogs).
- Rules: `qa/rules` asserts new/extended collections stay deny-direct.
- Emulator integration for `getMemberProfile`, `voidPromotion`, attendance-since-level query.
- Playwright (`qa/tests/member-profile.spec.ts`, @smoke subset) against emulators with owned fixtures:
  search → open record → edit and save DETAILS → birthday chip → Manage → assign level (date required,
  confirm) → void with reason → rate skills and save → reload keeps state; desktop and 390px mobile;
  axe accessibility check; screenshot evidence.
- Gate: `corepack pnpm verify:mvp`; evidence recorded in `tasksv2.md` T051V2.
- No production deploy, destructive migration or paid-API spend without operator confirmation.
