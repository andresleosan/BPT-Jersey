# Member profile Plan D: assisted Regyfit import of levels, skills and DETAILS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load every Regyfit member's JIU-JITSU IBJJF level history, current-level class baseline and
existing skill scores into BPT, and backfill empty DETAILS fields from the already imported
`regyfitMemberRecords`, through an operator-run, dry-run-first, create-only import.

**Architecture:** A read-only capture script outside the repository fetches three Regyfit HTML
fragments per member from the logged-in Chrome tab and stores parsed JSON in
`/root/regyfit-capture/raw/member-levels/`. A pure ESM module
(`qa/scripts/regyfit-member-profile-map.mjs`, typed by a `.d.mts`) holds the HTML parsers, the
member-number + date-of-birth matcher, the level/skill planner and the empty-only DETAILS backfill.
A thin CLI (`qa/scripts/import-regyfit-member-profile.mjs`) reads the target first, prints counts
only, writes the identity-bearing review list outside the repository, and on apply creates level
documents per student in a transaction that skips any student whose level is already open.

**Tech Stack:** Node 22 ESM, `firebase-admin` (resolved from `apps/functions`), Playwright
`connectOverCDP` (capture only), Vitest (`node` project for `qa/unit`, `firestore-integration`
project for `qa/integration`), Playwright against the static export on Firebase Emulators in Docker.

**Spec:** `docs/superpowers/specs/2026-09-17-member-profile-e0-e2-design.md` §6.5 and grill
decisions G2, G3, G4, G5, G8, G10 (§2), §8 risks, §9 testing. House-style reference:
`docs/superpowers/plans/2026-09-17-classes-services-plan-4a-import-types-sessions.md`.

**Runs after:** Plan B (member record, DETAILS contract) and Plan C (levels extensions, new catalogue
version, IBJJF card). The names below are taken from the Plan B and Plan C texts
(`docs/superpowers/plans/2026-09-17-member-profile-b-e1-record.md` Task 1,
`docs/superpowers/plans/2026-09-17-member-profile-c-e2-ibjjf.md` "Interfaces produced for Plan D" and
Tasks 1, 6–11); Task 1 Step 1 greps the merged code once before any code is written.

## Global Constraints

- CLAUDE.md layering: `packages/domain` never imports Firebase; a new domain module is added to the
  domain `package.json` subpath exports; callables are exported from `apps/functions/src/index.ts`.
  Plan D adds **no** domain module and **no** callable: it is a `qa/scripts` importer like
  `regyfit-classes-services-import.mjs`, reading and writing Firestore with `firebase-admin`.
- Raw capture and the review list stay outside the repository: `/root/regyfit-capture/raw/member-levels/`.
  The CLI refuses a capture directory inside the repo except the synthetic fixture
  `qa/fixtures/regyfit-member-profile-synthetic/`, and refuses any review directory inside the repo.
- Terminal and repo output are **counts only**: no names, member numbers, dates of birth, field values
  or Regyfit ids in stdout, logs, commits, the ledger or screenshots committed to the repo.
- Matching (G5): a Regyfit member maps to a student only when the member number (normalised NFKC,
  trimmed, upper case, compared with `studentAdminProfiles/{id}.membershipNumber`) AND the date of
  birth (`students/{id}.dateOfBirth`) are both equal, and the member number is unique on both sides.
  Never by name or e-mail. Everything else goes to the review list and is not loaded.
- Create-only (G2): a student with an existing `studentLevelProgress/{studentId}` is skipped whole
  (head, promotions and scores). Deterministic document ids make a rerun a no-op.
- Empty-only (G8): a DETAILS field is written only when absent, `null` or `""` in BPT, re-checked
  inside the write transaction. Target = Plan B's `studentAdminDetailsSchema`, stored as the optional
  `details` object of `studentAdminProfiles/{id}`. Backfilled (Regyfit `regyfitMemberRecords` field →
  `details.<key>`): `nickname` → `nickname` (≤64), `profession` → `profession` (≤120), `locality` →
  `city` (≤120), `idCardDue` → `idCardExpiresOn`, `registrationDate` → `registeredOn`, `notes` →
  `internalNotes` (≤2000). `address` + `postcode` → the **top-level** `postalAddress: { line, postCode }`
  (Plan B keeps it outside `details`), only when both are present. Every merged `details` block is
  parsed with `studentAdminDetailsSchema` (and `postalAddress` with `postalAddressSchema`) before any
  write. **Never backfilled:** identifier fields that feed the member-directory identity-key index
  (`membershipNumber`, `idCardNumber`, `vatNumber`); contact identity (`email`, `phoneNumber`); health
  data `details.healthNumber`, `details.weightKg`, `details.heightCm` (health data stays behind the
  DPIA/policy operator gate of spec §2.5 and §8); `details.country` (Regyfit stores free text, Plan B
  stores ISO 3166 alpha-2; there is no safe mapping without guessing, so it is excluded); and
  `details.shortName`, `recommendedByStudentId`, `howHeard`, `initialContact` (no Regyfit source).
- Class baseline (G10): the level head carries
  `importedBaseline: { classes, cutoff: "YYYY-MM-DD", source: "regyfit-import" }` (Plan C
  `importedBaselineSchema`). Plan C defines `cutoff` as the **first day counted from BPT attendance,
  inclusive**, so it must be strictly after the capture day of every captured member (the day after
  the capture): no Regyfit class is counted again by BPT attendance.
- Level documents follow Plan C exactly. Head `studentLevelProgress/{studentId}`: `currentDefinitionKey`,
  `currentLevelStartedAt` (`<assignedOn>T00:00:00.000Z`, the form Plan C's open/assign write),
  `lastApprovedPromotionId` (`null` when Regyfit has a single row), `openedByStaffId: null`,
  `openingNotes`, `openedDefinitionKey` + `openedOn` (the oldest Regyfit row), `openedByRole: null`,
  `source: "regyfit-import"`, `importedBaseline`. Every later Regyfit row is one `levelPromotions`
  document with `promotedOn`, `note: null`, `gaps: []`, `atAssignment { classes, days }`,
  `restore { currentDefinitionKey, currentLevelStartedAt, lastApprovedPromotionId, importedBaseline: null }`
  (so the latest imported promotion is voidable by Plan C's `voidPromotion`) and
  `source: "regyfit-import"`. The import never writes `kind: "void"` documents (`void_<promotionId>`).
- Catalogue: the published level system must be `ibjjf-v2` (Plan C). Skill scores map by Regyfit skill
  id through `docs/data/ibjjf-skills-observed.sanitized.json` (`skills[].regyfitId` → `key`, Plan C
  Task 1), restricted to keys in the published `skillCatalog`. Level history rows carry no Regyfit level
  id (`regyfitGradId` is the assignment row), so levels map by normalised name to the published
  `ibjjf-v2` definitions, whose names are Regyfit's own; two definitions with one name are refused.
- Emulator first. Emulator project id `demo-bpt-jersey`, `FIRESTORE_EMULATOR_HOST` loopback. On this
  VPS emulators run in Docker `bpt-emu:local --network none` (host port 8080 is code-server). Export
  `FUNCTIONS_DISCOVERY_TIMEOUT=300000` whenever Functions start.
- Production: `REGYFIT_IMPORT_TARGET=production`, `GCLOUD_PROJECT=bptjersey-f5a25`,
  `REGYFIT_OPERATOR_CONFIRMATION=member-profile-levels-production-v1`, academy id `demo-academy`.
  Production today has **no level catalogue** and `NEXT_PUBLIC_LEVELS_BACKEND` is false; the seed
  guard change, the `ibjjf-v2` production seed, the Pages flag and the Plans A–C deploy are operator
  gates listed in Task 7 before any production run.
  Production dry run (read-only) and apply are **operator gates** (Task 7) and never automated. No
  production deploy, destructive migration, paid-API spend or production write without the operator's
  explicit OK in chat.
- Regyfit capture (G3/G4): authorised by the operator in chat on 2026-09-17 as a read-only walk. Same-
  origin GET only, never a click, never a POST, ≥2 s between members, resumable. If the auto-mode
  classifier blocks the walk, stop and report; do not work around it.
- Backend security: Firestore rules stay deny-direct (no rule changes: the import uses the Admin SDK);
  every write is create-only or a guarded empty-field update; provenance on every written document
  (`source: "regyfit-import"`, `createdBy`/`updatedBy: "regyfit-import"`). An existence check is not
  a functioning check: each guard (existing head, empty-only, repository guards, target guard) has a
  test that fails when the guard is removed, and the plan says which.
- Frontend (Task 6 only reads the Plan B/C screens): DESIGN.md rules apply to anything visible — tokens
  purple `#2F2483`, canvas `#F2F1ED`, ink `#1A1A18`, muted `#65635D`, line `#8A8880`, Purple Wash
  `#F0EFFF`/`#D9D6FF`; square corners; hard offset shadows; status = text + coloured left border,
  never a pill; Barlow Condensed display / Source Sans 3 body; eyebrow 0.72rem 700 uppercase 0.15em;
  tabular numbers; buttons ≥3.15rem with 3px purple focus outline; labels above inputs; inline row
  actions, no kebab; skeletons not spinners; empty state = eyebrow + headline + one sentence + one
  button; one column below 50rem; no horizontal scroll; ≥44px targets; reduced motion; UK English; no
  emojis, no icon-only buttons; belt colours only in `.belt-bar`/`.belt-tip`/`.levels-colour`. Plan D
  adds no UI and no CSS; it reuses `admin.css`, `admin-ui.tsx`, `admin-data-table.tsx` via Plans B/C.
- Frontend security: no `dangerouslySetInnerHTML`; zod-parse callable responses; safe error strings;
  `?id=` validated as an opaque id; no restricted value in URLs, console, logs, analytics or web
  storage; no new origins. (Owned by Plans B/C; Plan D's e2e only asserts the rendered text.)
- Ponytail: smallest diff, reuse before create (`parseRegyfitDate`, `zonedIso`, `resolveTarget` from
  `regyfit-classes-services-map.mjs`), no new dependencies, no speculative abstractions; deliberate
  simplifications carry `// ponytail:` comments naming the ceiling.
- Before `corepack pnpm typecheck` / `test`, materialise the sparse paths
  (`git sparse-checkout add Lista Listav2`) and restore afterwards
  (`git sparse-checkout set '/*' '!/Lista' '!/Listav2'`). Never run prettier on
  `tasksv2.md`; edit it by hand.
- Code, identifiers and UI copy in English (UK); ledger notes in Spanish. Every commit message ends with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and carries `(T051V2)`.

## Decisions taken in this plan (reviewer: check these)

1. **The oldest Regyfit row is the head's opening, not a promotion.** Plan C's history reader
   (`buildLevelHistory`, Plan C Task 10) builds the opening entry from `openedDefinitionKey`/`openedOn`
   on the head and turns every `levelPromotions` document into a promotion entry with
   `String(fromDefinitionKey)`, so a promotion with `fromDefinitionKey: null` would render as `"null"`.
   The import therefore writes the oldest row as `openedDefinitionKey`/`openedOn` and one promotion per
   later row.
2. **Imported scores are per-skill `assessments` documents**, the storage Plan C Task 11
   (`recordSkillRatings`) keeps: one document per skill, id `buildEvaluationId`, `sessionId: string | null`.
   All carry the same `evaluatedAt` (cutoff day 00:00 Europe/Jersey), `sessionId: "regyfit-import"`
   and `source: "regyfit-import"`, and no `evaluatorRole`/`coachStaffId` (spec: no decider on imported
   records).
3. **No audit events.** The importer is an operator script like the other Regyfit importers;
   provenance is on each document and the run evidence goes to `tasksv2.md`.
   `// ponytail:` a per-run audit event needs a new audit action enum in the domain; add it if the
   operator asks for it.
4. **`atAssignment` of a promotion = the counters of the Regyfit row it leaves.** Plan C stores on a
   promotion the classes/days done at the _from_ level against the target's minimum
   (`atAssignment: { classes: {done,min}, days: {done,min} }`); a Regyfit row shows the classes/days
   done at that level against the next minimum. So the promotion into row _k_ takes row _k−1_'s
   counters, `null` per counter when Regyfit shows none (Plan C's `criterionAt` reads `null`). The
   newest row's classes become `importedBaseline.classes`.
5. **Imported promotions carry `restore` with `importedBaseline: null`.** Plan C's `voidPromotion`
   only voids the head's `lastApprovedPromotionId` and restores from `restore`; the baseline belongs to
   the current level (G10), so voiding the latest imported promotion reopens the previous level without
   a baseline.
6. **DETAILS backfill fields** are Plan B's names (Global Constraints): `nickname`, `profession`,
   `city`, `idCardExpiresOn`, `registeredOn`, `internalNotes` inside `details`, plus top-level
   `postalAddress`. `country` is excluded (no safe ISO mapping); health fields are excluded.

---

## File Structure

| Path                                                                            | Responsibility                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `qa/scripts/regyfit-classes-services-map.mjs` (modify)                          | `resolveTarget(env, confirmation)` takes the confirmation value as a parameter (default unchanged).          |
| `qa/scripts/regyfit-classes-services-map.d.mts` (modify)                        | Type of the new optional parameter.                                                                          |
| `qa/scripts/regyfit-member-profile-map.mjs` (create)                            | Pure: HTML parsers, normalisers, matcher, level/skill planner, DETAILS backfill, `planImport`, target guard. |
| `qa/scripts/regyfit-member-profile-map.d.mts` (create)                          | Type surface for the unit tests.                                                                             |
| `qa/unit/regyfit-member-profile-map.test.ts` (create)                           | Unit tests for every export.                                                                                 |
| `qa/scripts/import-regyfit-member-profile.mjs` (create)                         | CLI: guards, read target, plan, review file, create-only apply, counts line.                                 |
| `qa/package.json` (modify)                                                      | `import:regyfit-member-profile` script.                                                                      |
| `qa/fixtures/regyfit-member-profile-synthetic/91xx.json` (create, 6 files)      | Synthetic captured members (no real data).                                                                   |
| `qa/integration/regyfit-member-profile-import.test.ts` (create)                 | Emulator proof: dry run, apply, rerun, rejections, empty-only, no values in stdout.                          |
| `/root/regyfit-capture/scripts/regyfit-member-levels.mjs` (create, outside git) | Read-only CDP capture.                                                                                       |
| `qa/scripts/seed-regyfit-member-profile-emulator.mjs` (create)                  | Synthetic student, admin profile, session and attendance for the UI proof.                                   |
| `qa/scripts/run-member-profile-import-ui-e2e.mjs` (create)                      | Opt-in runner: seeds, catalogue, import, spec.                                                               |
| `qa/tests/member-profile-import-emulator.spec.ts` (create)                      | Record page shows the imported level and "9 from Regyfit + 1 in BPT".                                        |
| `qa/run-e2e.mjs` (modify)                                                       | Forward `MEMBER_PROFILE_IMPORT_UI_EMULATOR_E2E`.                                                             |
| `tasksv2.md` (modify by hand)                                                   | T051V2 evidence.                                                                                             |

---

### Task 1: Parsers, normalisers and target guard

**Files:**

- Modify: `qa/scripts/regyfit-classes-services-map.mjs` (function `resolveTarget`, last function of the file)
- Modify: `qa/scripts/regyfit-classes-services-map.d.mts` (declaration of `resolveTarget`)
- Create: `qa/scripts/regyfit-member-profile-map.mjs`
- Create: `qa/scripts/regyfit-member-profile-map.d.mts`
- Test: `qa/unit/regyfit-member-profile-map.test.ts`

**Interfaces:**

- Consumes: `parseRegyfitDate(text)`, `zonedIso(date, time, timezone)`, `resolveTarget(env)` from
  `qa/scripts/regyfit-classes-services-map.mjs`; Plan B `studentAdminDetailsSchema` keys (stored in
  `studentAdminProfiles/{id}.details`); Plan C head fields (`openedDefinitionKey`, `openedOn`,
  `openedByRole`, `source`, `importedBaseline`), promotion fields (`promotedOn`, `note`, `gaps`,
  `atAssignment`, `restore`, `source`), per-skill assessments with `sessionId: string | null`.
- Produces (exact names used by Tasks 2–6):
  - `productionConfirmation: "member-profile-levels-production-v1"`
  - `importSource: "regyfit-import"`
  - `resolveMemberProfileTarget(env: Record<string, string | undefined>): { target: "emulator" | "production"; projectId: string }`
  - `parseMemberListHtml(html: string): { ids: string[]; total: number | null }`
  - `parseMemberDetailsHtml(html: string): { memberNumber: string | null; dateOfBirth: string | null }`
  - `parseLevelHistoryHtml(html: string): RegyfitLevelHistoryRow[]` where
    `RegyfitLevelHistoryRow = { regyfitGradId: string; levelName: string; assignedOn: string; classes: { done: number; min: number | null } | null; days: { done: number; min: number | null } | null }`
  - `parseSkillScoresHtml(html: string): { regyfitSkillId: string; label: string; score: number | null }[]`
  - `normalizeMemberNumber(value: unknown): string | null`
  - `levelNameKey(name: string): string`

- [ ] **Step 1: Quick check that the merged Plan B and Plan C code carries the names used here**

```bash
cd /root/BPT-Jersey
git log --oneline -1
grep -c "idCardExpiresOn\|registeredOn\|internalNotes\|studentAdminDetailsSchema" packages/domain/src/members/member-directory-contracts.ts
grep -c "importedBaselineSchema" packages/domain/src/levels/level-manage-contracts.ts
grep -c "openedDefinitionKey\|atAssignment\|restore: {\|sessionId: null" apps/functions/src/levels/level-service.ts
node -e 'const s=require("./docs/data/ibjjf-skills-observed.sanitized.json");console.log(s.skills.filter(k=>/^\d+$/.test(k.regyfitId)).length)'
```

Expected: every count is greater than 0 and the last line prints `58`. A `0` means Plan B or Plan C
merged under other names than their plan texts: **stop and report to the controller** with the output;
do not adapt Plans B/C from here.

- [ ] **Step 2: Write the failing test**

Create `qa/unit/regyfit-member-profile-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { productionConfirmation as classesConfirmation } from "../scripts/regyfit-classes-services-map.mjs";
import {
  levelNameKey,
  normalizeMemberNumber,
  parseLevelHistoryHtml,
  parseMemberDetailsHtml,
  parseMemberListHtml,
  parseSkillScoresHtml,
  productionConfirmation,
  resolveMemberProfileTarget,
} from "../scripts/regyfit-member-profile-map.mjs";

// Synthetic markup with the structure of Regyfit's grads_aluno.php, gerir_atleta.php and
// dados_alunos.php fragments (observed 2026-09-17). No real member data.
function historyRow(gradId: string, title: string, date: string, counters = ""): string {
  return (
    `<tr id="grad${gradId}" style="border-bottom: 1px solid #dee2e6;"><td>` +
    `<button type="button" data-toggle="tooltip" data-original-title="" onclick="parent.confirmar('x','Are you sure you want to delete this level','<a onClick=\\'frame_modal.del_grad_atleta.apply(null, [1,2,&quot;3&quot;])\\'>DELETE</a>');" class="btn btn-danger but_text"><i class="fas fa-trash"></i></button></td>` +
    `<td><div data-html="true" data-toggle="tooltip" data-original-title="${title}" style="width:55px;"><svg></svg></div></td>` +
    `<td class="text-uppercase">${date}</td>${counters}</tr>`
  );
}

function counters(classes: string, classesMin: string, days: string, daysMin: string): string {
  return (
    `<td align="center" style="font-size:18px" class="text-success"><span id="feed_aulas">${classes}</span><span style="font-size:10px">/${classesMin}</span></td>` +
    `<td align="center" style="font-size:18px" class="text-success"><span id="feed_dias">${days}</span><span style="font-size:10px">/${daysMin}</span></td>`
  );
}

function skillBlock(id: string, label: string, filled: number | null, hidden = ""): string {
  const buttons = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<div onClick="on_off('${id}','${n}')" class="btn badge-info p-0 aval_all ${n === filled ? "aval_on" : "aval_off"} all_${id} but_${id}_${n}" style="height:30px;"><div class="m-1 pl-1 pr-1 auto_${id}_${n}" style="line-height:17px;">${n}</div></div>`,
    )
    .join("");
  return (
    `<div class="form-group mb-1"><div class="input-group">` +
    `<div data-toggle="tooltip" data-placement="left" data-original-title="${label}" class="form-control pt-1 pb-1 mr-1 text-truncate" style="height:auto;">${label}</div>` +
    `${buttons}<input class="gest_all" type="hidden" id="gest_${id}" value="${hidden}"></div></div>`
  );
}

describe("parseMemberListHtml", () => {
  it("collects distinct internal ids and the header total", () => {
    const html =
      `<div class="card-header">Members (3) 1-10 of 3</div>` +
      `<a onclick="openMemberModal('11','Synthetic A','','ativo','Active');"></a>` +
      `<a onclick="openMemberModal('11','Synthetic A','','ativo','Active');"></a>` +
      `<a onclick="openMemberModal('12','Synthetic B','','inativo','Inactive');"></a>`;
    expect(parseMemberListHtml(html)).toEqual({ ids: ["11", "12"], total: 3 });
  });
});

describe("parseMemberDetailsHtml", () => {
  it("reads member No. and date of birth from the DETAILS inputs", () => {
    const html =
      `<input type="number" name="proc" id="proc" class="form-control" maxlength="9" data-value="x" value="9101" style="">` +
      `<input type="date" name="data_nasc" id="data_nasc" value="1990-01-01" onchange="da_nasc();" style="">`;
    expect(parseMemberDetailsHtml(html)).toEqual({
      memberNumber: "9101",
      dateOfBirth: "1990-01-01",
    });
  });

  it("returns null for empty values and fails loudly when the markup changed", () => {
    const empty = `<input name="proc" value=""><input name="data_nasc" value="">`;
    expect(parseMemberDetailsHtml(empty)).toEqual({ memberNumber: null, dateOfBirth: null });
    expect(() => parseMemberDetailsHtml(`<input name="nome" value="x">`)).toThrow(
      "DETAILS markup changed",
    );
  });
});

describe("parseLevelHistoryHtml", () => {
  it("parses every assignment row with its counters", () => {
    const html =
      `<table>` +
      historyRow("902", "White - 2nd Stripe", "19 May 2026", counters("9", "25", "121", "75")) +
      historyRow("901", "Black &amp; White Synthetic", "10 Jan 2026") +
      `</table>`;
    expect(parseLevelHistoryHtml(html)).toEqual([
      {
        regyfitGradId: "902",
        levelName: "White - 2nd Stripe",
        assignedOn: "2026-05-19",
        classes: { done: 9, min: 25 },
        days: { done: 121, min: 75 },
      },
      {
        regyfitGradId: "901",
        levelName: "Black & White Synthetic",
        assignedOn: "2026-01-10",
        classes: null,
        days: null,
      },
    ]);
  });

  it("reads a counter with no minimum and returns no rows for a member without levels", () => {
    const row = historyRow("903", "WHITE BELT", "1 Feb 2026", counters("4", "", "30", ""));
    expect(parseLevelHistoryHtml(row)[0]?.classes).toEqual({ done: 4, min: null });
    expect(parseLevelHistoryHtml(`<div>No level systhems</div>`)).toEqual([]);
  });

  it("fails loudly when a row lost its level name or date", () => {
    expect(() => parseLevelHistoryHtml(`<tr id="grad904"><td></td></tr>`)).toThrow(
      "Level history row grad904 markup changed",
    );
  });
});

describe("parseSkillScoresHtml", () => {
  it("reads the filled button, the hidden value, or nothing", () => {
    const html =
      `<div class="skill_aval" data-original-title="legend"></div>` +
      skillBlock("258", "1. Tie The Belt", 4, "4") +
      skillBlock("259", "2. Warm Up 2 - Bridges", null) +
      skillBlock("260", "3. Warm Up 3 - Front Breakfall", null, "3") +
      `<script>function on_off(id,val) {}</script>`;
    expect(parseSkillScoresHtml(html)).toEqual([
      { regyfitSkillId: "258", label: "1. Tie The Belt", score: 4 },
      { regyfitSkillId: "259", label: "2. Warm Up 2 - Bridges", score: null },
      { regyfitSkillId: "260", label: "3. Warm Up 3 - Front Breakfall", score: 3 },
    ]);
  });

  it("refuses a skill whose filled button and hidden value disagree", () => {
    expect(() => parseSkillScoresHtml(skillBlock("261", "4. Synthetic", 2, "5"))).toThrow(
      "Skill 261 has conflicting scores",
    );
  });
});

describe("normalisers", () => {
  it("normalises member numbers like BPT administrative identifiers", () => {
    expect(normalizeMemberNumber(" ab-９1 ")).toBe("AB-91");
    expect(normalizeMemberNumber("")).toBeNull();
    expect(normalizeMemberNumber(undefined)).toBeNull();
  });

  it("keys level names ignoring case and spacing", () => {
    expect(levelNameKey("  WHITE   Belt ")).toBe(levelNameKey("White belt"));
  });
});

describe("resolveMemberProfileTarget", () => {
  const production = { REGYFIT_IMPORT_TARGET: "production", GCLOUD_PROJECT: "bptjersey-f5a25" };

  it("accepts only this import's confirmation value for production", () => {
    expect(productionConfirmation).toBe("member-profile-levels-production-v1");
    expect(() =>
      resolveMemberProfileTarget({
        ...production,
        REGYFIT_OPERATOR_CONFIRMATION: classesConfirmation,
      }),
    ).toThrow("operator confirmation");
    expect(
      resolveMemberProfileTarget({
        ...production,
        REGYFIT_OPERATOR_CONFIRMATION: productionConfirmation,
      }),
    ).toEqual({ target: "production", projectId: "bptjersey-f5a25" });
  });

  it("keeps the loopback demo- emulator guard", () => {
    expect(() =>
      resolveMemberProfileTarget({
        REGYFIT_IMPORT_TARGET: "emulator",
        FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080",
      }),
    ).toThrow("loopback");
    expect(
      resolveMemberProfileTarget({
        REGYFIT_IMPORT_TARGET: "emulator",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toEqual({ target: "emulator", projectId: "demo-bpt-jersey" });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `corepack pnpm vitest run --project node qa/unit/regyfit-member-profile-map.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/regyfit-member-profile-map.mjs"`.

- [ ] **Step 4: Let `resolveTarget` take the confirmation value**

In `qa/scripts/regyfit-classes-services-map.mjs` change the signature and the one comparison:

```js
export function resolveTarget(env, confirmation = productionConfirmation) {
```

```js
    if (env.REGYFIT_OPERATOR_CONFIRMATION !== confirmation) {
```

In `qa/scripts/regyfit-classes-services-map.d.mts` replace the declaration with:

```ts
export function resolveTarget(
  env: Record<string, string | undefined>,
  confirmation?: string,
): {
  target: "emulator" | "production";
  projectId: string;
};
```

- [ ] **Step 5: Write the module (parsers, normalisers, target)**

Create `qa/scripts/regyfit-member-profile-map.mjs`:

```js
// Pure mapping for the assisted Regyfit member-profile import (T051V2, spec §6.5): HTML parsers
// used by the read-only capture script, member matching, level/skill planning and the empty-only
// DETAILS backfill. No I/O: import-regyfit-member-profile.mjs reads and writes Firestore.

import { parseRegyfitDate, resolveTarget, zonedIso } from "./regyfit-classes-services-map.mjs";

export const productionConfirmation = "member-profile-levels-production-v1";
export const importSource = "regyfit-import";

export function resolveMemberProfileTarget(env) {
  return resolveTarget(env, productionConfirmation);
}

const entities = new Map([
  ["&amp;", "&"],
  ["&quot;", '"'],
  ["&#039;", "'"],
  ["&#39;", "'"],
  ["&lt;", "<"],
  ["&gt;", ">"],
]);

function decode(text) {
  return text.replace(/&(?:amp|quot|#0?39|lt|gt);/gu, (entity) => entities.get(entity));
}

export function parseMemberListHtml(html) {
  const ids = [...new Set([...html.matchAll(/openMemberModal\('(\d{1,12})'/gu)].map((m) => m[1]))];
  const total = /members \((\d+)\)/iu.exec(html);
  return { ids, total: total ? Number(total[1]) : null };
}

function inputValue(html, name) {
  const tag = new RegExp(`<input\\b[^>]*\\b(?:name|id)="${name}"[^>]*>`, "u").exec(html)?.[0];
  if (tag === undefined) return undefined;
  return decode(/\svalue="([^"]*)"/u.exec(tag)?.[1] ?? "").trim();
}

export function parseMemberDetailsHtml(html) {
  const memberNumber = inputValue(html, "proc");
  const dateOfBirth = inputValue(html, "data_nasc");
  if (memberNumber === undefined || dateOfBirth === undefined) {
    throw new Error("DETAILS markup changed: proc or data_nasc input not found");
  }
  return {
    memberNumber: memberNumber === "" ? null : memberNumber,
    dateOfBirth: /^\d{4}-\d{2}-\d{2}$/u.test(dateOfBirth) ? dateOfBirth : null,
  };
}

function counter(body, id) {
  const match = new RegExp(`<span id="${id}">(\\d+)</span><span[^>]*>/(\\d*)</span>`, "u").exec(
    body,
  );
  if (!match) return null;
  return { done: Number(match[1]), min: match[2] === "" ? null : Number(match[2]) };
}

export function parseLevelHistoryHtml(html) {
  return [...html.matchAll(/<tr id="grad(\d+)"[^>]*>([\s\S]*?)<\/tr>/gu)].map(([, gradId, row]) => {
    // The delete button carries its own (empty) tooltip; the level name is the belt's tooltip.
    const body = row.replace(/<button[\s\S]*?<\/button>/gu, "");
    const levelName = /data-original-title="([^"]+)"/u.exec(body)?.[1];
    const assigned = /<td class="text-uppercase">\s*([^<]+?)\s*<\/td>/u.exec(body)?.[1];
    if (!levelName || !assigned) throw new Error(`Level history row grad${gradId} markup changed`);
    return {
      regyfitGradId: gradId,
      levelName: decode(levelName).trim(),
      assignedOn: parseRegyfitDate(assigned),
      classes: counter(body, "feed_aulas"),
      days: counter(body, "feed_dias"),
    };
  });
}

export function parseSkillScoresHtml(html) {
  const skills = [];
  for (const block of html.split('<div class="form-group mb-1">').slice(1)) {
    const buttons = [
      ...block.matchAll(/<div onClick="on_off\('(\d+)','([1-5])'\)" class="([^"]*)"/gu),
    ];
    if (buttons.length === 0) continue;
    const regyfitSkillId = buttons[0][1];
    const label = /data-original-title="([^"]+)"/u.exec(block)?.[1];
    if (!label) throw new Error(`Skill ${regyfitSkillId} markup changed: no label`);
    const filled = buttons
      .filter(([, , , classes]) => classes.split(/\s+/u).includes("aval_on"))
      .map(([, , value]) => Number(value));
    const hidden =
      new RegExp(`id="gest_${regyfitSkillId}" value="([1-5]?)"`, "u").exec(block)?.[1] ?? "";
    if (
      filled.length > 1 ||
      (filled.length === 1 && hidden !== "" && Number(hidden) !== filled[0])
    ) {
      throw new Error(`Skill ${regyfitSkillId} has conflicting scores`);
    }
    skills.push({
      regyfitSkillId,
      label: decode(label).trim(),
      score: filled[0] ?? (hidden === "" ? null : Number(hidden)),
    });
  }
  return skills;
}

// Same rule as normalizeAdministrativeIdentifier in packages/domain (not importable from .mjs).
export function normalizeMemberNumber(value) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  return normalized === "" ? null : normalized;
}

function squash(text) {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function levelNameKey(name) {
  return squash(name);
}

// Used by Task 2.
export { zonedIso };
```

- [ ] **Step 6: Write the type surface**

Create `qa/scripts/regyfit-member-profile-map.d.mts`:

```ts
// Type surface of regyfit-member-profile-map.mjs for the qa unit tests. Keep it in step with the
// exports of the .mjs.

export type RegyfitLevelCounter = { done: number; min: number | null };

export type RegyfitLevelHistoryRow = {
  regyfitGradId: string;
  levelName: string;
  assignedOn: string;
  classes: RegyfitLevelCounter | null;
  days: RegyfitLevelCounter | null;
};

export type RegyfitSkillScore = { regyfitSkillId: string; label: string; score: number | null };

export const productionConfirmation: "member-profile-levels-production-v1";
export const importSource: "regyfit-import";

export function resolveMemberProfileTarget(env: Record<string, string | undefined>): {
  target: "emulator" | "production";
  projectId: string;
};
export function parseMemberListHtml(html: string): { ids: string[]; total: number | null };
export function parseMemberDetailsHtml(html: string): {
  memberNumber: string | null;
  dateOfBirth: string | null;
};
export function parseLevelHistoryHtml(html: string): RegyfitLevelHistoryRow[];
export function parseSkillScoresHtml(html: string): RegyfitSkillScore[];
export function normalizeMemberNumber(value: unknown): string | null;
export function levelNameKey(name: string): string;
export function zonedIso(date: string, time: string, timezone: string): string;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project node qa/unit/regyfit-member-profile-map.test.ts qa/unit/regyfit-classes-services-map.test.ts`
Expected: PASS, both files (the classes-services tests are unchanged and still green).

- [ ] **Step 8: Prove the conflict guard is functioning**

Temporarily delete the `if (filled.length > 1 || ...) throw` block in `parseSkillScoresHtml`, rerun
Step 7, confirm `refuses a skill whose filled button and hidden value disagree` FAILS, restore the block,
rerun, PASS.

- [ ] **Step 9: Format, lint, commit**

```bash
corepack pnpm prettier --write qa/scripts/regyfit-member-profile-map.mjs qa/scripts/regyfit-member-profile-map.d.mts qa/scripts/regyfit-classes-services-map.mjs qa/scripts/regyfit-classes-services-map.d.mts qa/unit/regyfit-member-profile-map.test.ts
corepack pnpm lint
git add qa/scripts/regyfit-member-profile-map.mjs qa/scripts/regyfit-member-profile-map.d.mts qa/scripts/regyfit-classes-services-map.mjs qa/scripts/regyfit-classes-services-map.d.mts qa/unit/regyfit-member-profile-map.test.ts
git commit -m "$(cat <<'EOF'
feat(member-profile): Regyfit level/skill/details HTML parsers and import target guard (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Matching and level/skill planning

**Files:**

- Modify: `qa/scripts/regyfit-member-profile-map.mjs` (append; remove the trailing `export { zonedIso };`)
- Modify: `qa/scripts/regyfit-member-profile-map.d.mts` (append types; remove the `zonedIso` declaration)
- Test: `qa/unit/regyfit-member-profile-map.test.ts` (extend imports, append describes)

**Interfaces:**

- Consumes: Task 1 exports.
- Produces:
  - `reviewReasons` (frozen array, exact values below) and `type ReviewReason`.
  - `matchMembers(regyfit: { key: string; memberNumber: string | null | undefined; dateOfBirth: string | null | undefined }[], bpt: { studentId: string; membershipNumber: string | null | undefined; dateOfBirth: string }[]): { matches: { key: string; studentId: string }[]; review: { key: string; memberNumber: string | null; reason: ReviewReason }[] }`
  - `planMemberLevels(member: CapturedMember, context: { academyId: string; studentId: string; systemId: string; definitionsByName: ReadonlyMap<string, LevelDefinitionRow>; skillKeysByRegyfitId: ReadonlyMap<string, string>; cutoff: string; now: string; timezone: string }): { status: "no-level" } | { status: "review"; reason: ReviewReason } | { status: "planned"; head: LevelHeadDocument; promotions: PromotionDocument[]; evaluations: EvaluationDocument[]; skillsReason: "unmapped-skill" | null }`
  - `CapturedMember = { regyfitId: string; memberNumber: string | null; dateOfBirth: string | null; history: RegyfitLevelHistoryRow[]; skills: RegyfitSkillScore[]; capturedAt: string }`
  - `LevelDefinitionRow = { definitionKey: string; name: string; sequence: number }`
  - Document ids: promotion `grad_<studentId>_<toDefinitionKey>_<promotedOn>T00:00:00.000Z` (same as
    `buildGraduationId` with `decidedAt` = the promotion day), evaluation
    `eval_<studentId>_<skillKey>_<evaluatedAt>` (same as `buildEvaluationId`), head at
    `studentLevelProgress/<studentId>`. Field names match Plan C's head, promotion and assessment
    documents (Global Constraints).

- [ ] **Step 1: Write the failing tests**

Replace the import from `../scripts/regyfit-member-profile-map.mjs` with:

```ts
import {
  levelNameKey,
  matchMembers,
  normalizeMemberNumber,
  parseLevelHistoryHtml,
  parseMemberDetailsHtml,
  parseMemberListHtml,
  parseSkillScoresHtml,
  planMemberLevels,
  productionConfirmation,
  resolveMemberProfileTarget,
  reviewReasons,
  type CapturedMember,
  type LevelDefinitionRow,
} from "../scripts/regyfit-member-profile-map.mjs";
```

Append:

```ts
const now = "2026-09-11T08:00:00.000Z";
const cutoff = "2026-09-11";
const timezone = "Europe/Jersey";
const definitions: LevelDefinitionRow[] = [
  { definitionKey: "white-belt", name: "WHITE BELT", sequence: 148 },
  { definitionKey: "white-1st-stripe", name: "White - 1st Stripe", sequence: 149 },
  { definitionKey: "white-2nd-stripe", name: "White - 2nd Stripe", sequence: 150 },
];
const definitionsByName = new Map(definitions.map((d) => [levelNameKey(d.name), d]));
const skillKeysByRegyfitId = new Map([
  ["258", "tie-the-belt"],
  ["259", "warm-up-2-bridges"],
]);
const context = {
  academyId: "academy-a",
  studentId: "student-a",
  systemId: "ibjjf-v2",
  definitionsByName,
  skillKeysByRegyfitId,
  cutoff,
  now,
  timezone,
};

function member(overrides: Partial<CapturedMember> = {}): CapturedMember {
  return {
    regyfitId: "9101",
    memberNumber: "9101",
    dateOfBirth: "1990-01-01",
    history: [
      {
        regyfitGradId: "902",
        levelName: "White - 2nd Stripe",
        assignedOn: "2026-05-19",
        classes: { done: 9, min: 25 },
        days: { done: 121, min: 75 },
      },
      {
        regyfitGradId: "901",
        levelName: "WHITE BELT",
        assignedOn: "2026-01-10",
        classes: { done: 22, min: 20 },
        days: { done: 129, min: 60 },
      },
    ],
    skills: [
      { regyfitSkillId: "258", label: "1. Tie The Belt", score: 4 },
      { regyfitSkillId: "259", label: "2. Warm Up 2 - Bridges", score: null },
    ],
    capturedAt: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("matchMembers", () => {
  const bpt = [
    { studentId: "s1", membershipNumber: "9101", dateOfBirth: "1990-01-01" },
    { studentId: "s2", membershipNumber: "9102", dateOfBirth: "1991-02-03" },
    { studentId: "s3", membershipNumber: "9107", dateOfBirth: "1994-01-01" },
    { studentId: "s4", membershipNumber: " 9107", dateOfBirth: "1994-01-01" },
    { studentId: "s5", membershipNumber: undefined, dateOfBirth: "1995-01-01" },
  ];

  it("matches on member number AND date of birth, and says why everything else is not loaded", () => {
    const result = matchMembers(
      [
        { key: "r1", memberNumber: "9101", dateOfBirth: "1990-01-01" },
        { key: "r2", memberNumber: "9102", dateOfBirth: "1991-02-02" },
        { key: "r3", memberNumber: "9104", dateOfBirth: "1992-01-01" },
        { key: "r4", memberNumber: null, dateOfBirth: "1992-01-01" },
        { key: "r5", memberNumber: "9105", dateOfBirth: null },
        { key: "r6", memberNumber: "9106", dateOfBirth: "1993-01-01" },
        { key: "r7", memberNumber: "9106 ", dateOfBirth: "1993-01-01" },
        { key: "r8", memberNumber: "9107", dateOfBirth: "1994-01-01" },
      ],
      bpt,
    );
    expect(result.matches).toEqual([{ key: "r1", studentId: "s1" }]);
    expect(result.review).toEqual([
      { key: "r2", memberNumber: "9102", reason: "date-of-birth-mismatch" },
      { key: "r3", memberNumber: "9104", reason: "member-number-not-in-bpt" },
      { key: "r4", memberNumber: null, reason: "missing-member-number" },
      { key: "r5", memberNumber: "9105", reason: "missing-date-of-birth" },
      { key: "r6", memberNumber: "9106", reason: "duplicate-member-number-regyfit" },
      { key: "r7", memberNumber: "9106", reason: "duplicate-member-number-regyfit" },
      { key: "r8", memberNumber: "9107", reason: "duplicate-member-number-bpt" },
    ]);
    expect(result.review.every((entry) => reviewReasons.includes(entry.reason))).toBe(true);
  });

  it("never matches by name: an equal date of birth with another number is not a match", () => {
    expect(
      matchMembers([{ key: "r9", memberNumber: "9999", dateOfBirth: "1990-01-01" }], bpt).matches,
    ).toEqual([]);
  });
});

describe("planMemberLevels", () => {
  const audit = {
    schemaVersion: "1",
    createdAt: now,
    createdBy: "regyfit-import",
    updatedAt: now,
    updatedBy: "regyfit-import",
  };

  it("plans the Plan C head with the opening and baseline, voidable promotions and the scores", () => {
    const plan = planMemberLevels(member(), context);
    const promotionId = "grad_student-a_white-2nd-stripe_2026-05-19T00:00:00.000Z";
    expect(plan).toEqual({
      status: "planned",
      head: {
        academyId: "academy-a",
        studentId: "student-a",
        systemId: "ibjjf-v2",
        currentDefinitionKey: "white-2nd-stripe",
        currentLevelStartedAt: "2026-05-19T00:00:00.000Z",
        lastApprovedPromotionId: promotionId,
        openedByStaffId: null,
        openingNotes: "Imported from Regyfit",
        openedDefinitionKey: "white-belt",
        openedOn: "2026-01-10",
        openedByRole: null,
        source: "regyfit-import",
        state: "initialized",
        importedBaseline: { classes: 9, cutoff: "2026-09-11", source: "regyfit-import" },
        ...audit,
      },
      promotions: [
        {
          graduationId: promotionId,
          promotionId,
          academyId: "academy-a",
          studentId: "student-a",
          systemId: "ibjjf-v2",
          fromDefinitionKey: "white-belt",
          toDefinitionKey: "white-2nd-stripe",
          status: "approved",
          decisionStatus: "approved",
          decisionNotes: "Imported from Regyfit",
          decidedBy: "regyfit-import",
          decidedByRole: null,
          decidedByStaffId: null,
          decidedAt: "2026-05-19T00:00:00.000Z",
          ceremonyDate: null,
          promotedOn: "2026-05-19",
          note: null,
          gaps: [],
          atAssignment: { classes: { done: 22, min: 20 }, days: { done: 129, min: 60 } },
          restore: {
            currentDefinitionKey: "white-belt",
            currentLevelStartedAt: "2026-01-10T00:00:00.000Z",
            lastApprovedPromotionId: null,
            importedBaseline: null,
          },
          source: "regyfit-import",
          ...audit,
        },
      ],
      evaluations: [
        {
          evaluationId: "eval_student-a_tie-the-belt_2026-09-10T23:00:00.000Z",
          assessmentId: "eval_student-a_tie-the-belt_2026-09-10T23:00:00.000Z",
          academyId: "academy-a",
          studentId: "student-a",
          sessionId: "regyfit-import",
          definitionKey: "white-2nd-stripe",
          skillKey: "tie-the-belt",
          score: 4,
          evidenceNotes: "Imported from Regyfit",
          evaluatedAt: "2026-09-10T23:00:00.000Z",
          observedAt: "2026-09-10T23:00:00.000Z",
          dimensions: [{ definitionKey: "white-2nd-stripe", skillKey: "tie-the-belt", score: 4 }],
          status: "recorded",
          source: "regyfit-import",
          ...audit,
        },
      ],
      skillsReason: null,
    });
  });

  it("loads no evaluation for a member with no scores and nothing for a member with no level", () => {
    const unscored = planMemberLevels(
      member({ skills: [{ regyfitSkillId: "258", label: "1. Tie The Belt", score: null }] }),
      context,
    );
    expect(unscored.status === "planned" && unscored.evaluations).toEqual([]);
    expect(planMemberLevels(member({ history: [] }), context)).toEqual({ status: "no-level" });
  });

  it("opens a single-row history with no promotion and no last promotion id", () => {
    const [current] = member().history;
    const plan = planMemberLevels(member({ history: [current!] }), context);
    expect(
      plan.status === "planned" && [
        plan.promotions,
        plan.head.lastApprovedPromotionId,
        plan.head.openedOn,
      ],
    ).toEqual([[], null, "2026-05-19"]);
  });

  it("chains restore snapshots so only the latest imported promotion is voided first", () => {
    const [current, first] = member().history;
    const middle = {
      regyfitGradId: "9015",
      levelName: "White - 1st Stripe",
      assignedOn: "2026-03-01",
      classes: null,
      days: null,
    };
    const plan = planMemberLevels(member({ history: [current!, middle, first!] }), context);
    expect(
      plan.status === "planned" &&
        plan.promotions.map(({ restore, atAssignment }) => [restore, atAssignment]),
    ).toEqual([
      [
        {
          currentDefinitionKey: "white-belt",
          currentLevelStartedAt: "2026-01-10T00:00:00.000Z",
          lastApprovedPromotionId: null,
          importedBaseline: null,
        },
        { classes: { done: 22, min: 20 }, days: { done: 129, min: 60 } },
      ],
      [
        {
          currentDefinitionKey: "white-1st-stripe",
          currentLevelStartedAt: "2026-03-01T00:00:00.000Z",
          lastApprovedPromotionId: "grad_student-a_white-1st-stripe_2026-03-01T00:00:00.000Z",
          importedBaseline: null,
        },
        { classes: null, days: null },
      ],
    ]);
  });

  it("sends unmapped levels, out-of-order history and a missing current counter to review", () => {
    const [current, first] = member().history;
    expect(
      planMemberLevels(member({ history: [{ ...current!, levelName: "PINK BELT" }] }), context),
    ).toEqual({ status: "review", reason: "unmapped-level" });
    expect(
      planMemberLevels(
        member({
          history: [
            current!,
            { ...first!, levelName: "White - 2nd Stripe", assignedOn: "2026-06-01" },
          ],
        }),
        context,
      ),
    ).toEqual({ status: "review", reason: "history-out-of-order" });
    expect(
      planMemberLevels(member({ history: [{ ...current!, classes: null }, first!] }), context),
    ).toEqual({ status: "review", reason: "missing-current-classes" });
  });

  it("keeps the levels but loads no score when a scored Regyfit skill id is not in the catalogue", () => {
    const plan = planMemberLevels(
      member({ skills: [{ regyfitSkillId: "300", label: "58. Berimbolo", score: 2 }] }),
      context,
    );
    expect(plan.status).toBe("planned");
    expect(plan.status === "planned" && [plan.evaluations, plan.skillsReason]).toEqual([
      [],
      "unmapped-skill",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node qa/unit/regyfit-member-profile-map.test.ts`
Expected: FAIL — `matchMembers is not a function` (and the other new names).

- [ ] **Step 3: Implement**

In `qa/scripts/regyfit-member-profile-map.mjs` delete the trailing `// Used by Task 2.` and
`export { zonedIso };` lines, then append:

```js
export const reviewReasons = Object.freeze([
  "missing-member-number",
  "missing-date-of-birth",
  "duplicate-member-number-regyfit",
  "duplicate-member-number-bpt",
  "member-number-not-in-bpt",
  "date-of-birth-mismatch",
  "unmapped-level",
  "history-out-of-order",
  "missing-current-classes",
  "unmapped-skill",
]);

const importNote = "Imported from Regyfit";

export function matchMembers(regyfit, bpt) {
  const regyfitCounts = new Map();
  for (const { memberNumber } of regyfit) {
    const number = normalizeMemberNumber(memberNumber);
    if (number !== null) regyfitCounts.set(number, (regyfitCounts.get(number) ?? 0) + 1);
  }
  const bptByNumber = new Map();
  for (const student of bpt) {
    const number = normalizeMemberNumber(student.membershipNumber);
    if (number !== null) bptByNumber.set(number, [...(bptByNumber.get(number) ?? []), student]);
  }
  const matches = [];
  const review = [];
  for (const { key, memberNumber, dateOfBirth } of regyfit) {
    const number = normalizeMemberNumber(memberNumber);
    const candidates = number === null ? [] : (bptByNumber.get(number) ?? []);
    const reason =
      number === null
        ? "missing-member-number"
        : !dateOfBirth
          ? "missing-date-of-birth"
          : regyfitCounts.get(number) > 1
            ? "duplicate-member-number-regyfit"
            : candidates.length === 0
              ? "member-number-not-in-bpt"
              : candidates.length > 1
                ? "duplicate-member-number-bpt"
                : candidates[0].dateOfBirth !== dateOfBirth
                  ? "date-of-birth-mismatch"
                  : null;
    if (reason === null) matches.push({ key, studentId: candidates[0].studentId });
    else review.push({ key, memberNumber: number, reason });
  }
  return { matches, review };
}

export function planMemberLevels(member, context) {
  const { academyId, studentId, systemId, cutoff, now, timezone } = context;
  if (member.history.length === 0) return { status: "no-level" };
  const steps = [...member.history]
    .sort((left, right) => left.assignedOn.localeCompare(right.assignedOn))
    .map((row) => ({
      row,
      definition: context.definitionsByName.get(levelNameKey(row.levelName)),
    }));
  if (steps.some(({ definition }) => definition === undefined)) {
    return { status: "review", reason: "unmapped-level" };
  }
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index].definition.sequence <= steps[index - 1].definition.sequence) {
      return { status: "review", reason: "history-out-of-order" };
    }
  }
  const current = steps.at(-1);
  if (current.row.classes === null) return { status: "review", reason: "missing-current-classes" };

  const audit = {
    schemaVersion: "1",
    createdAt: now,
    createdBy: importSource,
    updatedAt: now,
    updatedBy: importSource,
  };
  // Plan C writes level days as UTC midnight of the chosen day (openStudentLevel, assignLevel).
  const dayStart = (day) => `${day}T00:00:00.000Z`;
  // Plan C shape: the oldest row is the head's opening (openedDefinitionKey/openedOn); every later
  // row is a promotion. atAssignment = counters of the row it leaves; restore = the head before it,
  // chained, so Plan C's voidPromotion can walk the imported history back one step at a time.
  const promotions = [];
  for (let index = 1; index < steps.length; index += 1) {
    const { row, definition } = steps[index];
    const previous = steps[index - 1];
    const decidedAt = dayStart(row.assignedOn);
    const graduationId = `grad_${studentId}_${definition.definitionKey}_${decidedAt}`;
    promotions.push({
      graduationId,
      promotionId: graduationId,
      academyId,
      studentId,
      systemId,
      fromDefinitionKey: previous.definition.definitionKey,
      toDefinitionKey: definition.definitionKey,
      status: "approved",
      decisionStatus: "approved",
      decisionNotes: importNote,
      decidedBy: importSource,
      decidedByRole: null,
      decidedByStaffId: null,
      decidedAt,
      ceremonyDate: null,
      promotedOn: row.assignedOn,
      note: null,
      gaps: [],
      atAssignment: { classes: previous.row.classes, days: previous.row.days },
      restore: {
        currentDefinitionKey: previous.definition.definitionKey,
        currentLevelStartedAt: dayStart(previous.row.assignedOn),
        lastApprovedPromotionId: promotions.at(-1)?.promotionId ?? null,
        // G10: a baseline belongs to the level it was imported at, never to a past level.
        importedBaseline: null,
      },
      source: importSource,
      ...audit,
    });
  }
  const head = {
    academyId,
    studentId,
    systemId,
    currentDefinitionKey: current.definition.definitionKey,
    currentLevelStartedAt: dayStart(current.row.assignedOn),
    lastApprovedPromotionId: promotions.at(-1)?.promotionId ?? null,
    openedByStaffId: null,
    openingNotes: importNote,
    openedDefinitionKey: steps[0].definition.definitionKey,
    openedOn: steps[0].row.assignedOn,
    openedByRole: null,
    source: importSource,
    state: "initialized",
    importedBaseline: { classes: current.row.classes.done, cutoff, source: importSource },
    ...audit,
  };

  const scored = member.skills.filter(({ score }) => score !== null);
  // Plan C Task 1: skills map by Regyfit id (docs/data/ibjjf-skills-observed.sanitized.json).
  const unmapped = scored.some(
    ({ regyfitSkillId }) => !context.skillKeysByRegyfitId.has(regyfitSkillId),
  );
  // ponytail: one unmapped skill holds back all of that member's scores; the review list names it.
  const evaluatedAt = zonedIso(cutoff, "00:00", timezone);
  const evaluations = unmapped
    ? []
    : scored.map(({ regyfitSkillId, score }) => {
        const skillKey = context.skillKeysByRegyfitId.get(regyfitSkillId);
        const evaluationId = `eval_${studentId}_${skillKey}_${evaluatedAt}`;
        const definitionKey = current.definition.definitionKey;
        return {
          evaluationId,
          assessmentId: evaluationId,
          academyId,
          studentId,
          sessionId: importSource,
          definitionKey,
          skillKey,
          score,
          evidenceNotes: importNote,
          evaluatedAt,
          observedAt: evaluatedAt,
          dimensions: [{ definitionKey, skillKey, score }],
          status: "recorded",
          source: importSource,
          ...audit,
        };
      });
  return {
    status: "planned",
    head,
    promotions,
    evaluations,
    skillsReason: unmapped ? "unmapped-skill" : null,
  };
}
```

In `qa/scripts/regyfit-member-profile-map.d.mts` delete the `zonedIso` declaration, add at the top
(`qa` already depends on `@bpt-jersey/domain`; Plan C exports the type through the levels subpath):

```ts
import type { ImportedBaseline } from "@bpt-jersey/domain/levels";
```

and append:

```ts
export type ReviewReason =
  | "missing-member-number"
  | "missing-date-of-birth"
  | "duplicate-member-number-regyfit"
  | "duplicate-member-number-bpt"
  | "member-number-not-in-bpt"
  | "date-of-birth-mismatch"
  | "unmapped-level"
  | "history-out-of-order"
  | "missing-current-classes"
  | "unmapped-skill";

export const reviewReasons: readonly ReviewReason[];

export type CapturedMember = {
  regyfitId: string;
  memberNumber: string | null;
  dateOfBirth: string | null;
  history: RegyfitLevelHistoryRow[];
  skills: RegyfitSkillScore[];
  capturedAt: string;
};

export type LevelDefinitionRow = { definitionKey: string; name: string; sequence: number };

type ImportAudit = {
  schemaVersion: "1";
  createdAt: string;
  createdBy: "regyfit-import";
  updatedAt: string;
  updatedBy: "regyfit-import";
};

export type LevelHeadDocument = ImportAudit & {
  academyId: string;
  studentId: string;
  systemId: string;
  currentDefinitionKey: string;
  currentLevelStartedAt: string;
  lastApprovedPromotionId: string | null;
  openedByStaffId: null;
  openingNotes: string;
  openedDefinitionKey: string;
  openedOn: string;
  openedByRole: null;
  source: "regyfit-import";
  state: "initialized";
  importedBaseline: ImportedBaseline;
};

export type PromotionDocument = ImportAudit & {
  graduationId: string;
  promotionId: string;
  academyId: string;
  studentId: string;
  systemId: string;
  fromDefinitionKey: string;
  toDefinitionKey: string;
  status: "approved";
  decisionStatus: "approved";
  decisionNotes: string;
  decidedBy: "regyfit-import";
  decidedByRole: null;
  decidedByStaffId: null;
  decidedAt: string;
  ceremonyDate: null;
  promotedOn: string;
  note: null;
  gaps: string[];
  atAssignment: { classes: RegyfitLevelCounter | null; days: RegyfitLevelCounter | null };
  restore: {
    currentDefinitionKey: string;
    currentLevelStartedAt: string;
    lastApprovedPromotionId: string | null;
    importedBaseline: null;
  };
  source: "regyfit-import";
};

export type EvaluationDocument = ImportAudit & {
  evaluationId: string;
  assessmentId: string;
  academyId: string;
  studentId: string;
  sessionId: "regyfit-import";
  definitionKey: string;
  skillKey: string;
  score: number;
  evidenceNotes: string;
  evaluatedAt: string;
  observedAt: string;
  dimensions: { definitionKey: string; skillKey: string; score: number }[];
  status: "recorded";
  source: "regyfit-import";
};

export function matchMembers(
  regyfit: {
    key: string;
    memberNumber: string | null | undefined;
    dateOfBirth: string | null | undefined;
  }[],
  bpt: { studentId: string; membershipNumber: string | null | undefined; dateOfBirth: string }[],
): {
  matches: { key: string; studentId: string }[];
  review: { key: string; memberNumber: string | null; reason: ReviewReason }[];
};

export function planMemberLevels(
  member: CapturedMember,
  context: {
    academyId: string;
    studentId: string;
    systemId: string;
    definitionsByName: ReadonlyMap<string, LevelDefinitionRow>;
    skillKeysByRegyfitId: ReadonlyMap<string, string>;
    cutoff: string;
    now: string;
    timezone: string;
  },
):
  | { status: "no-level" }
  | { status: "review"; reason: ReviewReason }
  | {
      status: "planned";
      head: LevelHeadDocument;
      promotions: PromotionDocument[];
      evaluations: EvaluationDocument[];
      skillsReason: "unmapped-skill" | null;
    };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project node qa/unit/regyfit-member-profile-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the matching guard is functioning**

Temporarily replace `: candidates[0].dateOfBirth !== dateOfBirth ? "date-of-birth-mismatch"` with
`: false ? "date-of-birth-mismatch"`, rerun Step 4, confirm `matches on member number AND date of
birth` FAILS (r2 appears in `matches`), restore, rerun, PASS.

- [ ] **Step 6: Format, lint, commit**

```bash
corepack pnpm prettier --write qa/scripts/regyfit-member-profile-map.mjs qa/scripts/regyfit-member-profile-map.d.mts qa/unit/regyfit-member-profile-map.test.ts
corepack pnpm lint
git add qa/scripts/regyfit-member-profile-map.mjs qa/scripts/regyfit-member-profile-map.d.mts qa/unit/regyfit-member-profile-map.test.ts
git commit -m "$(cat <<'EOF'
feat(member-profile): match Regyfit members by number and birth date, plan imported levels and scores (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Empty-only DETAILS backfill and `planImport`

**Files:**

- Modify: `qa/scripts/regyfit-member-profile-map.mjs` (append)
- Modify: `qa/scripts/regyfit-member-profile-map.d.mts` (append)
- Test: `qa/unit/regyfit-member-profile-map.test.ts` (extend imports, append describes)

**Interfaces:**

- Consumes: Tasks 1–2.
- Produces (used by the CLI in Task 4):
  - `detailsBackfillFields` (frozen `{ from, to, kind, max? }[]`)
  - `planDetailsBackfill(record: RegyfitRecordForBackfill, profile: Record<string, unknown>): { patch: DetailsPatch; filled: string[]; invalid: string[] }`
  - `DetailsPatch = { details?: Partial<Pick<StudentAdminDetails, "nickname" | "profession" | "city" | "idCardExpiresOn" | "registeredOn" | "internalNotes">>; postalAddress?: PostalAddress }` (Plan B types from `@bpt-jersey/domain/members/directory`)
  - `planImport(capture: { members: CapturedMember[]; records: RegyfitRecordForBackfill[] }, options: { academyId: string; cutoff: string; now: string; timezone: string; system: { systemId: string; skillCatalog: { key: string }[] }; regyfitSkills: { regyfitId: string; key: string }[]; definitions: LevelDefinitionRow[]; students: { studentId: string; dateOfBirth: string }[]; adminProfiles: ReadonlyMap<string, Record<string, unknown>>; existingHeadStudentIds: ReadonlySet<string> }): ImportPlan`
  - `ImportPlan = { levels: { studentId; head; promotions; evaluations }[]; details: { studentId: string; record: RegyfitRecordForBackfill }[]; review: { levels: ReviewEntry[]; details: ReviewEntry[] }; counts: ImportCounts }`
  - `ImportCounts` keys (exact): `membersCaptured, levelsMatched, levelsReview, skippedExistingHead, membersWithoutLevel, headsToCreate, promotionsToCreate, membersWithScores, scoresToCreate, recordsRead, detailsMatched, detailsReview, detailsStudentsToFill, detailsFieldFills, detailsInvalid`

- [ ] **Step 1: Write the failing tests**

Add `detailsBackfillFields`, `planDetailsBackfill`, `planImport` and `type RegyfitRecordForBackfill`
to the import list from `../scripts/regyfit-member-profile-map.mjs`, then append:

```ts
function record(overrides: Partial<RegyfitRecordForBackfill> = {}): RegyfitRecordForBackfill {
  return {
    recordId: "9101",
    memberNumber: "9101",
    birthDate: "1990-01-01",
    nickname: "Synthetic Nick",
    profession: "Synthetic Profession",
    locality: "Synthetic Town",
    idCardDue: "2030-01-01",
    registrationDate: "2020-01-01",
    notes: "Synthetic note",
    address: "1 Synthetic Road",
    postcode: "JE0 0AA",
    ...overrides,
  };
}

describe("planDetailsBackfill", () => {
  it("fills only empty Plan B DETAILS fields and never touches identity, contact, health or country", () => {
    expect(detailsBackfillFields.map(({ to }) => to)).toEqual([
      "nickname",
      "profession",
      "city",
      "idCardExpiresOn",
      "registeredOn",
      "internalNotes",
    ]);
    const result = planDetailsBackfill(
      record({
        healthNumber: "H1",
        idCardNumber: "X1",
        vatNumber: "V1",
        email: "a@example.test",
        country: "Jersey",
      } as never),
      { details: { profession: "Existing Profession", nickname: "" } },
    );
    expect(result).toEqual({
      patch: {
        details: {
          nickname: "Synthetic Nick",
          city: "Synthetic Town",
          idCardExpiresOn: "2030-01-01",
          registeredOn: "2020-01-01",
          internalNotes: "Synthetic note",
        },
        postalAddress: { line: "1 Synthetic Road", postCode: "JE0 0AA" },
      },
      filled: [
        "nickname",
        "city",
        "idCardExpiresOn",
        "registeredOn",
        "internalNotes",
        "postalAddress",
      ],
      invalid: [],
    });
  });

  it("keeps an existing top-level postal address and needs both address parts", () => {
    expect(
      planDetailsBackfill(record(), { postalAddress: { line: "Kept", postCode: "JE1 1AA" } })
        .filled,
    ).not.toContain("postalAddress");
    expect(planDetailsBackfill(record({ postcode: undefined }), {}).filled).not.toContain(
      "postalAddress",
    );
  });

  it("counts a value Plan B's schema would reject instead of writing it", () => {
    const result = planDetailsBackfill(
      record({ nickname: "x".repeat(65), idCardDue: "01/01/2030", notes: undefined }),
      {},
    );
    expect(result.invalid).toEqual(["nickname", "idCardExpiresOn"]);
    expect(result.patch.details).not.toHaveProperty("nickname");
    expect(result.patch.details).not.toHaveProperty("internalNotes");
  });
});

describe("planImport", () => {
  const system = {
    systemId: "ibjjf-v2",
    skillCatalog: [{ key: "tie-the-belt" }, { key: "warm-up-2-bridges" }],
  };
  const regyfitSkills = [
    { regyfitId: "258", key: "tie-the-belt" },
    { regyfitId: "259", key: "warm-up-2-bridges" },
  ];
  const students = [
    { studentId: "student-a", dateOfBirth: "1990-01-01" },
    { studentId: "student-b", dateOfBirth: "1991-02-03" },
    { studentId: "student-c", dateOfBirth: "1992-03-03" },
  ];
  const adminProfiles = new Map<string, Record<string, unknown>>([
    ["student-a", { membershipNumber: "9101", details: { profession: "Existing Profession" } }],
    ["student-b", { membershipNumber: "9102" }],
    ["student-c", { membershipNumber: "9103" }],
  ]);
  const options = {
    academyId: "academy-a",
    cutoff,
    now,
    timezone,
    system,
    regyfitSkills,
    definitions,
    students,
    adminProfiles,
    existingHeadStudentIds: new Set(["student-c"]),
  };
  const members = [
    member(),
    member({ regyfitId: "9102", memberNumber: "9102", dateOfBirth: "1991-02-02" }),
    member({ regyfitId: "9103", memberNumber: "9103", dateOfBirth: "1992-03-03" }),
  ];

  it("plans create-only levels, skips an open level and counts everything else", () => {
    const plan = planImport(
      {
        members,
        records: [
          record(),
          record({ recordId: "9102", memberNumber: "9102", birthDate: "1991-02-03" }),
        ],
      },
      options,
    );
    expect(
      plan.levels.map(({ studentId, promotions, evaluations }) => [
        studentId,
        promotions.length,
        evaluations.length,
      ]),
    ).toEqual([["student-a", 1, 1]]);
    expect(plan.details.map(({ studentId }) => studentId)).toEqual(["student-a", "student-b"]);
    expect(plan.review).toEqual({
      levels: [{ key: "9102", memberNumber: "9102", reason: "date-of-birth-mismatch" }],
      details: [],
    });
    expect(plan.counts).toEqual({
      membersCaptured: 3,
      levelsMatched: 2,
      levelsReview: { "date-of-birth-mismatch": 1 },
      skippedExistingHead: 1,
      membersWithoutLevel: 0,
      headsToCreate: 1,
      promotionsToCreate: 1,
      membersWithScores: 1,
      scoresToCreate: 1,
      recordsRead: 2,
      detailsMatched: 2,
      detailsReview: {},
      detailsStudentsToFill: 2,
      detailsFieldFills: {
        nickname: 2,
        profession: 1,
        city: 2,
        idCardExpiresOn: 2,
        registeredOn: 2,
        internalNotes: 2,
        postalAddress: 2,
      },
      detailsInvalid: {},
    });
  });

  it("refuses a cutoff that is not after the capture day, so no class is counted twice", () => {
    expect(() =>
      planImport({ members, records: [] }, { ...options, cutoff: "2026-09-10" }),
    ).toThrow("REGYFIT_IMPORT_CUTOFF must be after the capture day of every member");
  });

  it("refuses a catalogue where two levels share a name", () => {
    expect(() =>
      planImport(
        { members, records: [] },
        {
          ...options,
          definitions: [
            ...definitions,
            { definitionKey: "dup", name: "white belt", sequence: 999 },
          ],
        },
      ),
    ).toThrow('Two level definitions share the name "white belt"');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node qa/unit/regyfit-member-profile-map.test.ts`
Expected: FAIL — `planDetailsBackfill is not a function`.

- [ ] **Step 3: Implement**

Append to `qa/scripts/regyfit-member-profile-map.mjs`:

```js
// DETAILS filled from regyfitMemberRecords when empty in studentAdminProfiles (G8): `to` is a key of
// Plan B's studentAdminDetailsSchema, stored under `details`; limits mirror that schema. Not here, on
// purpose: membershipNumber/idCardNumber/vatNumber (they feed the member-directory identity-key
// index and must go through updateMember), email/phoneNumber (contact identity), details.healthNumber,
// details.weightKg and details.heightCm (health data behind the DPIA gate, spec §2.5/§8),
// details.country (Regyfit free text vs ISO 3166 alpha-2, no safe mapping).
export const detailsBackfillFields = Object.freeze([
  { from: "nickname", to: "nickname", kind: "text", max: 64 },
  { from: "profession", to: "profession", kind: "text", max: 120 },
  { from: "locality", to: "city", kind: "text", max: 120 },
  { from: "idCardDue", to: "idCardExpiresOn", kind: "date" },
  { from: "registrationDate", to: "registeredOn", kind: "date" },
  { from: "notes", to: "internalNotes", kind: "text", max: 2000 },
]);

const controlCharacters = /[\u0000-\u001f\u007f]/u;

function isEmpty(value) {
  return value === undefined || value === null || value === "";
}

function cleanValue(value, kind, max) {
  if (typeof value !== "string") return undefined;
  if (kind === "date") return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
  const text = value.trim();
  return text.length >= 1 && text.length <= max && !controlCharacters.test(text) ? text : undefined;
}

export function planDetailsBackfill(record, profile) {
  const details = {};
  const patch = {};
  const filled = [];
  const invalid = [];
  const stored = profile.details ?? {};
  for (const { from, to, kind, max } of detailsBackfillFields) {
    if (isEmpty(record[from]) || !isEmpty(stored[to])) continue;
    const value = cleanValue(record[from], kind, max);
    if (value === undefined) {
      invalid.push(to);
    } else {
      details[to] = value;
      filled.push(to);
    }
  }
  if (Object.keys(details).length > 0) patch.details = details;
  // Plan B keeps postalAddress at the top level of the admin profile, outside `details`.
  if (!isEmpty(record.address) && !isEmpty(record.postcode) && isEmpty(profile.postalAddress)) {
    const line = cleanValue(record.address, "text", 240);
    const postCode = cleanValue(record.postcode, "text", 16);
    if (line !== undefined && postCode !== undefined) {
      patch.postalAddress = { line, postCode };
      filled.push("postalAddress");
    } else {
      invalid.push("postalAddress");
    }
  }
  return { patch, filled, invalid };
}

function tally(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function planImport({ members, records }, options) {
  const { academyId, cutoff, now, timezone, system } = options;
  if (members.some(({ capturedAt }) => !(cutoff > capturedAt.slice(0, 10)))) {
    throw new Error("REGYFIT_IMPORT_CUTOFF must be after the capture day of every member");
  }
  const definitionsByName = new Map();
  for (const definition of options.definitions) {
    const key = levelNameKey(definition.name);
    if (definitionsByName.has(key))
      throw new Error(`Two level definitions share the name "${key}"`);
    definitionsByName.set(key, definition);
  }
  const catalogKeys = new Set(system.skillCatalog.map(({ key }) => key));
  // Plan C Task 1: every Regyfit skill id maps to its key; only keys the published catalogue holds.
  const skillKeysByRegyfitId = new Map(
    options.regyfitSkills
      .filter(({ key }) => catalogKeys.has(key))
      .map(({ regyfitId, key }) => [regyfitId, key]),
  );
  const bpt = options.students.map(({ studentId, dateOfBirth }) => ({
    studentId,
    dateOfBirth,
    membershipNumber: options.adminProfiles.get(studentId)?.membershipNumber,
  }));
  const counts = {
    membersCaptured: members.length,
    levelsMatched: 0,
    levelsReview: {},
    skippedExistingHead: 0,
    membersWithoutLevel: 0,
    headsToCreate: 0,
    promotionsToCreate: 0,
    membersWithScores: 0,
    scoresToCreate: 0,
    recordsRead: records.length,
    detailsMatched: 0,
    detailsReview: {},
    detailsStudentsToFill: 0,
    detailsFieldFills: {},
    detailsInvalid: {},
  };
  const review = { levels: [], details: [] };

  const levels = [];
  const membersById = new Map(members.map((member) => [member.regyfitId, member]));
  const levelMatch = matchMembers(
    members.map(({ regyfitId, memberNumber, dateOfBirth }) => ({
      key: regyfitId,
      memberNumber,
      dateOfBirth,
    })),
    bpt,
  );
  for (const entry of levelMatch.review) {
    review.levels.push(entry);
    tally(counts.levelsReview, entry.reason);
  }
  for (const { key, studentId } of levelMatch.matches) {
    counts.levelsMatched += 1;
    // Create-only (G2): a level already open in BPT wins over Regyfit.
    if (options.existingHeadStudentIds.has(studentId)) {
      counts.skippedExistingHead += 1;
      continue;
    }
    const plan = planMemberLevels(membersById.get(key), {
      academyId,
      studentId,
      systemId: system.systemId,
      definitionsByName,
      skillKeysByRegyfitId,
      cutoff,
      now,
      timezone,
    });
    if (plan.status === "no-level") {
      counts.membersWithoutLevel += 1;
      continue;
    }
    if (plan.status === "review") {
      review.levels.push({ key, studentId, reason: plan.reason });
      tally(counts.levelsReview, plan.reason);
      continue;
    }
    if (plan.skillsReason !== null) {
      review.levels.push({ key, studentId, reason: plan.skillsReason });
      tally(counts.levelsReview, plan.skillsReason);
    }
    counts.headsToCreate += 1;
    counts.promotionsToCreate += plan.promotions.length;
    if (plan.evaluations.length > 0) {
      counts.membersWithScores += 1;
      counts.scoresToCreate += plan.evaluations.length;
    }
    levels.push({
      studentId,
      head: plan.head,
      promotions: plan.promotions,
      evaluations: plan.evaluations,
    });
  }

  const details = [];
  const recordsById = new Map(records.map((item) => [item.recordId, item]));
  const detailsMatch = matchMembers(
    records.map(({ recordId, memberNumber, birthDate }) => ({
      key: recordId,
      memberNumber,
      dateOfBirth: birthDate,
    })),
    bpt,
  );
  for (const entry of detailsMatch.review) {
    review.details.push(entry);
    tally(counts.detailsReview, entry.reason);
  }
  for (const { key, studentId } of detailsMatch.matches) {
    counts.detailsMatched += 1;
    const item = recordsById.get(key);
    // A match needs the membership number of the admin profile, so the profile exists.
    const { filled, invalid } = planDetailsBackfill(item, options.adminProfiles.get(studentId));
    for (const field of filled) tally(counts.detailsFieldFills, field);
    for (const field of invalid) tally(counts.detailsInvalid, field);
    if (filled.length > 0) {
      counts.detailsStudentsToFill += 1;
      details.push({ studentId, record: item });
    }
  }
  return { levels, details, review, counts };
}
```

In `qa/scripts/regyfit-member-profile-map.d.mts` add below the Task 2 type import:

```ts
import type { PostalAddress, StudentAdminDetails } from "@bpt-jersey/domain/members/directory";
```

and append:

```ts
// Field names of regyfitMemberRecordSchema (packages/domain/src/members/regyfit-member-record-contracts.ts).
export type RegyfitRecordForBackfill = {
  recordId: string;
  memberNumber?: string;
  birthDate?: string;
  nickname?: string;
  profession?: string;
  locality?: string;
  idCardDue?: string;
  registrationDate?: string;
  notes?: string;
  address?: string;
  postcode?: string;
};

export type DetailsPatch = {
  details?: Partial<
    Pick<
      StudentAdminDetails,
      "nickname" | "profession" | "city" | "idCardExpiresOn" | "registeredOn" | "internalNotes"
    >
  >;
  postalAddress?: PostalAddress;
};

export type ReviewEntry = {
  key: string;
  memberNumber?: string | null;
  studentId?: string;
  reason: ReviewReason;
};

export type ImportCounts = {
  membersCaptured: number;
  levelsMatched: number;
  levelsReview: Partial<Record<ReviewReason, number>>;
  skippedExistingHead: number;
  membersWithoutLevel: number;
  headsToCreate: number;
  promotionsToCreate: number;
  membersWithScores: number;
  scoresToCreate: number;
  recordsRead: number;
  detailsMatched: number;
  detailsReview: Partial<Record<ReviewReason, number>>;
  detailsStudentsToFill: number;
  detailsFieldFills: Record<string, number>;
  detailsInvalid: Record<string, number>;
};

export const detailsBackfillFields: readonly {
  from: string;
  to: string;
  kind: "text" | "date";
  max?: number;
}[];

export function planDetailsBackfill(
  record: RegyfitRecordForBackfill,
  profile: Record<string, unknown>,
): { patch: DetailsPatch; filled: string[]; invalid: string[] };

export function planImport(
  capture: { members: CapturedMember[]; records: RegyfitRecordForBackfill[] },
  options: {
    academyId: string;
    cutoff: string;
    now: string;
    timezone: string;
    system: { systemId: string; skillCatalog: { key: string }[] };
    regyfitSkills: { regyfitId: string; key: string }[];
    definitions: LevelDefinitionRow[];
    students: { studentId: string; dateOfBirth: string }[];
    adminProfiles: ReadonlyMap<string, Record<string, unknown>>;
    existingHeadStudentIds: ReadonlySet<string>;
  },
): {
  levels: {
    studentId: string;
    head: LevelHeadDocument;
    promotions: PromotionDocument[];
    evaluations: EvaluationDocument[];
  }[];
  details: { studentId: string; record: RegyfitRecordForBackfill }[];
  review: { levels: ReviewEntry[]; details: ReviewEntry[] };
  counts: ImportCounts;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project node qa/unit/regyfit-member-profile-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the create-only and empty-only guards are functioning**

1. Temporarily delete the `if (options.existingHeadStudentIds.has(studentId)) { ... continue; }` block,
   rerun Step 4: `plans create-only levels` FAILS (`student-c` appears in `levels`). Restore.
2. Temporarily change `|| !isEmpty(stored[to])` to `|| false`, rerun Step 4: `fills only empty Plan B
DETAILS fields` FAILS (`profession` in `patch.details`). Restore. Rerun: PASS.

- [ ] **Step 6: Typecheck, format, lint, commit**

```bash
git sparse-checkout add Lista Listav2
corepack pnpm --filter @bpt-jersey/qa typecheck
git sparse-checkout set '/*' '!/Lista' '!/Listav2'
corepack pnpm prettier --write qa/scripts/regyfit-member-profile-map.mjs qa/scripts/regyfit-member-profile-map.d.mts qa/unit/regyfit-member-profile-map.test.ts
corepack pnpm lint
git add qa/scripts/regyfit-member-profile-map.mjs qa/scripts/regyfit-member-profile-map.d.mts qa/unit/regyfit-member-profile-map.test.ts
git commit -m "$(cat <<'EOF'
feat(member-profile): empty-only DETAILS backfill and counts-only import plan (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: typecheck exits 0.

---

### Task 4: Import CLI and emulator proof on synthetic data

**Files:**

- Create: `qa/scripts/import-regyfit-member-profile.mjs`
- Modify: `qa/package.json` (one script, next to `"import:regyfit-classes-services"`)
- Create: `qa/fixtures/regyfit-member-profile-synthetic/9101.json` … `9106.json`
- Create: `qa/integration/regyfit-member-profile-import.test.ts`

**Interfaces:**

- Consumes: `planImport`, `planDetailsBackfill`, `importSource`, `resolveMemberProfileTarget`.
- Produces: CLI driven by env —
  `REGYFIT_CAPTURE_DIR` (directory of `<regyfitId>.json`), `REGYFIT_ACADEMY_ID`,
  `REGYFIT_IMPORT_TARGET`, `REGYFIT_IMPORT_CUTOFF` (`YYYY-MM-DD`, required), optional
  `REGYFIT_IMPORT_NOW` (ISO instant with ms), optional `REGYFIT_REVIEW_DIR` (default
  `/root/regyfit-capture/raw/member-levels`, must be outside the repo), `REGYFIT_IMPORT_APPLY=true`
  to write. Prints one JSON line: `{ target, projectId, academyId, cutoff, applied, before: { students, adminProfiles, levelHeads, importedLevelHeads, regyfitMemberRecords }, ...ImportCounts, headsCreated, applySkippedExistingHead, applySkippedOrphanDocuments, detailsStudentsFilled, detailsFieldsFilled, reviewEntries, reviewFile }`.
  Review file `review-<now date>.json` = `{ target, academyId, cutoff, generatedAt, levels: ReviewEntry[], details: ReviewEntry[] }`, mode 0600.

- [ ] **Step 1: Write the synthetic fixture**

The CLI maps scores by Regyfit skill id through the committed structure file, so the two skill ids in
`9101.json` must be the real structure ids (skill structure is not personal data). Print them:

```bash
cd /root/BPT-Jersey
node -e 'const s=require("./docs/data/ibjjf-skills-observed.sanitized.json").skills;console.log(JSON.stringify(Object.fromEntries(s.filter(k=>k.key==="tie-the-belt"||k.key==="warm-up-2-bridges").map(k=>[k.key,k.regyfitId]))))'
```

Expected: one JSON object with both keys. In `9101.json` below replace `"258"` with the
`tie-the-belt` id and `"259"` with the `warm-up-2-bridges` id (the unit tests keep 258/259: they pass
their own map).

`qa/fixtures/regyfit-member-profile-synthetic/9101.json` (matched, opening + one promotion, one score):

```json
{
  "regyfitId": "9101",
  "memberNumber": "9101",
  "dateOfBirth": "1990-01-01",
  "history": [
    {
      "regyfitGradId": "902",
      "levelName": "White - 2nd Stripe",
      "assignedOn": "2026-05-19",
      "classes": { "done": 9, "min": 25 },
      "days": { "done": 121, "min": 75 }
    },
    {
      "regyfitGradId": "901",
      "levelName": "WHITE BELT",
      "assignedOn": "2026-01-10",
      "classes": null,
      "days": null
    }
  ],
  "skills": [
    { "regyfitSkillId": "258", "label": "1. Tie The Belt", "score": 4 },
    { "regyfitSkillId": "259", "label": "2. Warm Up 2 - Bridges", "score": null }
  ],
  "capturedAt": "2026-09-10T10:00:00.000Z"
}
```

`9102.json` (date of birth differs from BPT):

```json
{
  "regyfitId": "9102",
  "memberNumber": "9102",
  "dateOfBirth": "1991-02-02",
  "history": [
    {
      "regyfitGradId": "911",
      "levelName": "WHITE BELT",
      "assignedOn": "2026-02-01",
      "classes": { "done": 3, "min": 25 },
      "days": null
    }
  ],
  "skills": [],
  "capturedAt": "2026-09-10T10:00:00.000Z"
}
```

`9103.json` (student whose level is already open in BPT):

```json
{
  "regyfitId": "9103",
  "memberNumber": "9103",
  "dateOfBirth": "1992-03-03",
  "history": [
    {
      "regyfitGradId": "921",
      "levelName": "WHITE BELT",
      "assignedOn": "2026-03-01",
      "classes": { "done": 5, "min": 25 },
      "days": null
    }
  ],
  "skills": [],
  "capturedAt": "2026-09-10T10:00:00.000Z"
}
```

`9104.json` (member number not in BPT):

```json
{
  "regyfitId": "9104",
  "memberNumber": "9104",
  "dateOfBirth": "1993-04-04",
  "history": [
    {
      "regyfitGradId": "931",
      "levelName": "WHITE BELT",
      "assignedOn": "2026-04-01",
      "classes": { "done": 1, "min": 25 },
      "days": null
    }
  ],
  "skills": [],
  "capturedAt": "2026-09-10T10:00:00.000Z"
}
```

`9105.json` (level not in the catalogue):

```json
{
  "regyfitId": "9105",
  "memberNumber": "9105",
  "dateOfBirth": "1993-05-05",
  "history": [
    {
      "regyfitGradId": "941",
      "levelName": "SYNTHETIC PINK BELT",
      "assignedOn": "2026-04-01",
      "classes": { "done": 2, "min": 10 },
      "days": null
    }
  ],
  "skills": [],
  "capturedAt": "2026-09-10T10:00:00.000Z"
}
```

`9106.json` (no member number in Regyfit):

```json
{
  "regyfitId": "9106",
  "memberNumber": null,
  "dateOfBirth": "1994-06-06",
  "history": [],
  "skills": [],
  "capturedAt": "2026-09-10T10:00:00.000Z"
}
```

- [ ] **Step 2: Write the failing emulator test**

Create `qa/integration/regyfit-member-profile-import.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// T051V2 Plan D: the member-profile import against the real Firestore Emulator, on synthetic data.
const repositoryRoot = resolve(import.meta.dirname, "../..");
const host = process.env.FIRESTORE_EMULATOR_HOST?.trim() ?? "";
const useEmulator = /^(127\.0\.0\.1|localhost):\d+$/u.test(host);
const academyId = `rf-member-profile-${process.pid}`;
const reviewDir = mkdtempSync(join(tmpdir(), "rf-member-profile-review-"));
const app = useEmulator ? initializeApp({ projectId: "demo-bpt-jersey" }, academyId) : undefined;
const firestore = app ? getFirestore(app) : undefined;
const at = "2026-01-01T00:00:00.000Z";
const audit = {
  schemaVersion: "1",
  createdAt: at,
  createdBy: "synthetic",
  updatedAt: at,
  updatedBy: "synthetic",
};

function runImport(extra: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["qa/scripts/import-regyfit-member-profile.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GCLOUD_PROJECT: "demo-bpt-jersey",
      REGYFIT_CAPTURE_DIR: "qa/fixtures/regyfit-member-profile-synthetic",
      REGYFIT_ACADEMY_ID: academyId,
      REGYFIT_IMPORT_TARGET: "emulator",
      REGYFIT_IMPORT_CUTOFF: "2026-09-11",
      REGYFIT_IMPORT_NOW: "2026-09-11T08:00:00.000Z",
      REGYFIT_REVIEW_DIR: reviewDir,
      ...extra,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function summary(stdout: string) {
  return JSON.parse(stdout.trim().split("\n").at(-1)!) as Record<string, unknown>;
}

async function seed() {
  const db = firestore!;
  const base = `academies/${academyId}`;
  const batch = db.batch();
  // A reduced synthetic stand-in for the published ibjjf-v2 system (id and keys as Plan C seeds them).
  batch.set(db.doc(`${base}/levelSystems/ibjjf-v2`), {
    academyId,
    systemId: "ibjjf-v2",
    status: "published",
    skillCatalog: [
      { key: "tie-the-belt", displayLabel: "Tie The Belt" },
      { key: "warm-up-2-bridges", displayLabel: "Warm Up 2 - Bridges" },
    ],
  });
  for (const [definitionKey, name, sequence] of [
    ["white-belt", "WHITE BELT", 148],
    ["white-1st-stripe", "White - 1st Stripe", 149],
    ["white-2nd-stripe", "White - 2nd Stripe", 150],
  ] as const) {
    batch.set(db.doc(`${base}/levelDefinitions/${definitionKey}`), {
      academyId,
      definitionKey,
      systemId: "ibjjf-v2",
      name,
      sequence,
    });
  }
  const students = [
    ["student-a", "1990-01-01", "9101", { details: { profession: "Existing Profession" } }],
    ["student-b", "1991-02-03", "9102", {}],
    ["student-c", "1992-03-03", "9103", {}],
    ["student-e", "1993-05-05", "9105", {}],
  ] as const;
  for (const [studentId, dateOfBirth, membershipNumber, extra] of students) {
    batch.set(db.doc(`${base}/students/${studentId}`), {
      studentId,
      academyId,
      fullName: `Synthetic ${studentId}`,
      dateOfBirth,
      ...audit,
    });
    batch.set(db.doc(`${base}/studentAdminProfiles/${studentId}`), {
      studentId,
      academyId,
      membershipNumber,
      gender: "unknown",
      source: "admin",
      ...extra,
      ...audit,
    });
  }
  batch.set(db.doc(`${base}/studentLevelProgress/student-c`), {
    academyId,
    studentId: "student-c",
    state: "initialized",
    ...audit,
  });
  batch.set(db.doc(`${base}/regyfitMemberRecords/9101`), {
    recordId: "9101",
    memberNumber: "9101",
    fullName: "Synthetic Record A",
    birthDate: "1990-01-01",
    nickname: "Synthetic Nick",
    profession: "Synthetic Profession",
    locality: "Synthetic Town",
    registrationDate: "2020-01-01",
  });
  batch.set(db.doc(`${base}/regyfitMemberRecords/9102`), {
    recordId: "9102",
    memberNumber: "9102",
    fullName: "Synthetic Record B",
    birthDate: "1991-02-02",
    nickname: "Never Written",
  });
  await batch.commit();
}

beforeAll(async () => {
  if (useEmulator) await seed();
});

afterAll(async () => {
  if (app) await deleteApp(app);
});

describe("Regyfit member-profile import on the Firestore Emulator", () => {
  it.skipIf(!useEmulator)(
    "dry run reads the target, writes nothing and prints counts only",
    async () => {
      const run = runImport();
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).not.toMatch(/Synthetic|9101|9102|1990-01-01|student-a/u);
      expect(summary(run.stdout)).toMatchObject({
        target: "emulator",
        applied: false,
        before: {
          students: 4,
          adminProfiles: 4,
          levelHeads: 1,
          importedLevelHeads: 0,
          regyfitMemberRecords: 2,
        },
        membersCaptured: 6,
        levelsMatched: 3,
        levelsReview: {
          "date-of-birth-mismatch": 1,
          "member-number-not-in-bpt": 1,
          "missing-member-number": 1,
          "unmapped-level": 1,
        },
        skippedExistingHead: 1,
        headsToCreate: 1,
        promotionsToCreate: 1,
        scoresToCreate: 1,
        detailsMatched: 1,
        detailsReview: { "date-of-birth-mismatch": 1 },
        detailsStudentsToFill: 1,
        detailsFieldFills: { nickname: 1, city: 1, registeredOn: 1 },
        headsCreated: 0,
        reviewEntries: 5,
      });
      const review = JSON.parse(readFileSync(join(reviewDir, "review-2026-09-11.json"), "utf8"));
      expect(review.levels).toHaveLength(4);
      expect(review.details).toEqual([
        { key: "9102", memberNumber: "9102", reason: "date-of-birth-mismatch" },
      ]);
      const head = await firestore!
        .doc(`academies/${academyId}/studentLevelProgress/student-a`)
        .get();
      expect(head.exists).toBe(false);
    },
  );

  it.skipIf(!useEmulator)(
    "apply creates the level, history and score, and fills empty DETAILS only",
    async () => {
      const run = runImport({ REGYFIT_IMPORT_APPLY: "true" });
      expect(run.status, run.stderr).toBe(0);
      expect(summary(run.stdout)).toMatchObject({
        applied: true,
        headsCreated: 1,
        applySkippedExistingHead: 0,
        detailsStudentsFilled: 1,
        detailsFieldsFilled: 3,
      });
      const base = `academies/${academyId}`;
      const head = (await firestore!.doc(`${base}/studentLevelProgress/student-a`).get()).data();
      const promotionId = "grad_student-a_white-2nd-stripe_2026-05-19T00:00:00.000Z";
      expect(head).toMatchObject({
        currentDefinitionKey: "white-2nd-stripe",
        currentLevelStartedAt: "2026-05-19T00:00:00.000Z",
        lastApprovedPromotionId: promotionId,
        openedDefinitionKey: "white-belt",
        openedOn: "2026-01-10",
        openedByRole: null,
        source: "regyfit-import",
        importedBaseline: { classes: 9, cutoff: "2026-09-11", source: "regyfit-import" },
      });
      const promotions = await firestore!
        .collection(`${base}/levelPromotions`)
        .where("studentId", "==", "student-a")
        .get();
      expect(promotions.docs.map((doc) => doc.data())).toEqual([
        expect.objectContaining({
          promotionId,
          fromDefinitionKey: "white-belt",
          toDefinitionKey: "white-2nd-stripe",
          promotedOn: "2026-05-19",
          atAssignment: { classes: null, days: null },
          restore: {
            currentDefinitionKey: "white-belt",
            currentLevelStartedAt: "2026-01-10T00:00:00.000Z",
            lastApprovedPromotionId: null,
            importedBaseline: null,
          },
          source: "regyfit-import",
        }),
      ]);
      const scores = await firestore!
        .collection(`${base}/assessments`)
        .where("studentId", "==", "student-a")
        .get();
      expect(
        scores.docs.map((doc) => [
          doc.get("skillKey"),
          doc.get("score"),
          doc.get("sessionId"),
          doc.get("source"),
        ]),
      ).toEqual([["tie-the-belt", 4, "regyfit-import", "regyfit-import"]]);
      const profile = (await firestore!.doc(`${base}/studentAdminProfiles/student-a`).get()).data();
      expect(profile).toMatchObject({
        details: {
          profession: "Existing Profession",
          nickname: "Synthetic Nick",
          city: "Synthetic Town",
          registeredOn: "2020-01-01",
        },
        updatedBy: "regyfit-import",
      });
      const mismatched = (
        await firestore!.doc(`${base}/studentAdminProfiles/student-b`).get()
      ).data();
      expect(mismatched).not.toHaveProperty("details");
      const untouched = (
        await firestore!.doc(`${base}/studentLevelProgress/student-c`).get()
      ).data();
      expect(untouched).not.toHaveProperty("importedBaseline");
    },
  );

  it.skipIf(!useEmulator)("rerun is a no-op", async () => {
    const before = (
      await firestore!.doc(`academies/${academyId}/studentAdminProfiles/student-a`).get()
    ).updateTime;
    const run = runImport({
      REGYFIT_IMPORT_APPLY: "true",
      REGYFIT_IMPORT_NOW: "2026-09-12T08:00:00.000Z",
    });
    expect(run.status, run.stderr).toBe(0);
    expect(summary(run.stdout)).toMatchObject({
      skippedExistingHead: 2,
      headsToCreate: 0,
      detailsStudentsToFill: 0,
      headsCreated: 0,
      detailsStudentsFilled: 0,
      before: { importedLevelHeads: 1 },
    });
    const after = (
      await firestore!.doc(`academies/${academyId}/studentAdminProfiles/student-a`).get()
    ).updateTime;
    expect(after?.isEqual(before!)).toBe(true);
  });

  it.skipIf(!useEmulator)("refuses unsafe inputs before touching Firestore", () => {
    expect(runImport({ REGYFIT_CAPTURE_DIR: "qa" }).stderr).toContain(
      "The real capture must stay outside the repository",
    );
    expect(runImport({ REGYFIT_REVIEW_DIR: "qa" }).stderr).toContain(
      "The review list must be written outside the repository",
    );
    expect(runImport({ REGYFIT_IMPORT_CUTOFF: "2026-09-10" }).stderr).toContain(
      "REGYFIT_IMPORT_CUTOFF must be after the capture day",
    );
    const production = runImport({
      REGYFIT_IMPORT_TARGET: "production",
      GCLOUD_PROJECT: "bptjersey-f5a25",
    });
    expect(production.status).toBe(1);
    expect(production.stderr).toContain("must not run with FIRESTORE_EMULATOR_HOST set");
  });
});
```

Tests in this file run in order and share the seeded academy (the integration project sets
`fileParallelism: false`; tests inside a file run sequentially).

- [ ] **Step 3: Run it to verify it fails**

```bash
cd /root/BPT-Jersey
corepack pnpm --filter @bpt-jersey/domain build:runtime
docker run --rm --network none -e COREPACK_ENABLE_NETWORK=0 -e npm_config_verify_deps_before_run=false \
  -v /root/BPT-Jersey:/root/BPT-Jersey -v /root/.cache/firebase:/root/.cache/firebase \
  -v /root/.cache/node:/root/.cache/node -w /root/BPT-Jersey bpt-emu:local \
  bash -lc 'corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "corepack pnpm vitest run --project firestore-integration qa/integration/regyfit-member-profile-import.test.ts"'
```

Expected: FAIL — the CLI exits non-zero with `Cannot find module .../import-regyfit-member-profile.mjs`.

- [ ] **Step 4: Write the CLI**

Create `qa/scripts/import-regyfit-member-profile.mjs`:

```js
// Assisted Regyfit member-profile import (T051V2, spec §6.5): level history, current-level class
// baseline and skill scores from the read-only capture, plus empty-only DETAILS backfill from the
// already imported regyfitMemberRecords.
//
// usage (dry run: reads the target, writes only the review file outside the repo):
//   REGYFIT_CAPTURE_DIR=/root/regyfit-capture/raw/member-levels \
//   REGYFIT_ACADEMY_ID=<academyId> \
//   REGYFIT_IMPORT_TARGET=emulator|production \
//   REGYFIT_IMPORT_CUTOFF=<YYYY-MM-DD, the day after the capture> \
//   [REGYFIT_IMPORT_NOW=2026-09-18T08:00:00.000Z] [REGYFIT_REVIEW_DIR=<dir outside the repo>] \
//   [REGYFIT_IMPORT_APPLY=true] \
//   node qa/scripts/import-regyfit-member-profile.mjs
//
// Production additionally requires GCLOUD_PROJECT=bptjersey-f5a25 and
// REGYFIT_OPERATOR_CONFIRMATION=member-profile-levels-production-v1, and runs only after the
// operator confirms in chat. stdout carries counts only; identities go to the review file.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";

// Runs against the compiled domain runtime: build it first with
//   corepack pnpm --filter @bpt-jersey/domain build:runtime
import { importedBaselineSchema } from "../../packages/domain/lib/levels/level-contracts.js";
import {
  postalAddressSchema,
  studentAdminDetailsSchema,
} from "../../packages/domain/lib/members/member-directory-contracts.js";
import {
  importSource,
  planDetailsBackfill,
  planImport,
  resolveMemberProfileTarget,
} from "./regyfit-member-profile-map.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const syntheticFixture = resolve(repositoryRoot, "qa/fixtures/regyfit-member-profile-synthetic");
// Plan C Task 1: structure only (skill/level ids, keys, names); maps captured scores by Regyfit id.
const skillStructureFile = resolve(
  repositoryRoot,
  "docs/data/ibjjf-skills-observed.sanitized.json",
);
const requireFromFunctions = createRequire(join(repositoryRoot, "apps/functions/package.json"));
const { getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function insideRepository(directory) {
  return !relative(repositoryRoot, directory).startsWith("..");
}

function importNow() {
  const value = process.env.REGYFIT_IMPORT_NOW?.trim();
  if (!value) return new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error("REGYFIT_IMPORT_NOW must be an ISO instant like 2026-09-18T08:00:00.000Z");
  }
  return value;
}

function inputs() {
  const academyId = required("REGYFIT_ACADEMY_ID");
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/u.test(academyId)) {
    throw new Error("REGYFIT_ACADEMY_ID must be a lowercase slug");
  }
  const cutoff = required("REGYFIT_IMPORT_CUTOFF");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(cutoff))
    throw new Error("REGYFIT_IMPORT_CUTOFF must be YYYY-MM-DD");
  const captureDir = resolve(required("REGYFIT_CAPTURE_DIR"));
  if (insideRepository(captureDir) && captureDir !== syntheticFixture) {
    throw new Error("The real capture must stay outside the repository");
  }
  const reviewDir = resolve(
    process.env.REGYFIT_REVIEW_DIR?.trim() || "/root/regyfit-capture/raw/member-levels",
  );
  if (insideRepository(reviewDir)) {
    throw new Error("The review list must be written outside the repository");
  }
  return { academyId, cutoff, captureDir, reviewDir, now: importNow() };
}

// Plan B stores DETAILS in the strict `details` block and the address at the top level. Parse the
// merged block, then write only the filled keys as field paths so other `details` keys stay as they are.
function detailsUpdate(patch, storedDetails) {
  const update = {};
  if (patch.details !== undefined) {
    studentAdminDetailsSchema.parse({ ...(storedDetails ?? {}), ...patch.details });
    for (const [key, value] of Object.entries(patch.details)) update[`details.${key}`] = value;
  }
  if (patch.postalAddress !== undefined) {
    update.postalAddress = postalAddressSchema.parse(patch.postalAddress);
  }
  return update;
}

async function main() {
  const { target, projectId } = resolveMemberProfileTarget(process.env);
  const { academyId, cutoff, captureDir, reviewDir, now } = inputs();
  const members = readdirSync(captureDir)
    .filter((file) => /^\d{1,12}\.json$/u.test(file))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(captureDir, file), "utf8")));
  if (members.length === 0) throw new Error("No captured members in REGYFIT_CAPTURE_DIR");

  const firestore = getFirestore(getApps()[0] ?? initializeApp({ projectId }));
  const academy = `academies/${academyId}`;
  const [students, adminProfiles, heads, systems, definitions, records] = await Promise.all(
    [
      "students",
      "studentAdminProfiles",
      "studentLevelProgress",
      "levelSystems",
      "levelDefinitions",
      "regyfitMemberRecords",
    ].map((name) => firestore.collection(`${academy}/${name}`).get()),
  );
  const published = systems.docs.filter((doc) => doc.get("status") === "published");
  if (published.length !== 1 || published[0].get("systemId") !== "ibjjf-v2") {
    throw new Error("The one published level system must be ibjjf-v2");
  }
  const system = {
    systemId: published[0].get("systemId"),
    skillCatalog: published[0].get("skillCatalog") ?? [],
  };
  const regyfitSkills = JSON.parse(readFileSync(skillStructureFile, "utf8")).skills.map(
    ({ regyfitId, key }) => ({ regyfitId, key }),
  );
  const adminProfilesById = new Map(adminProfiles.docs.map((doc) => [doc.id, doc.data()]));
  const plan = planImport(
    { members, records: records.docs.map((doc) => doc.data()) },
    {
      academyId,
      cutoff,
      now,
      timezone: "Europe/Jersey",
      system,
      regyfitSkills,
      definitions: definitions.docs
        .map((doc) => doc.data())
        .filter((definition) => definition.systemId === system.systemId),
      students: students.docs.map((doc) => ({
        studentId: doc.id,
        dateOfBirth: doc.get("dateOfBirth"),
      })),
      adminProfiles: adminProfilesById,
      existingHeadStudentIds: new Set(heads.docs.map((doc) => doc.id)),
    },
  );

  // Fail closed before any write: every planned document must parse with the Plan B/C schemas.
  for (const { head } of plan.levels) importedBaselineSchema.parse(head.importedBaseline);
  for (const { studentId, record } of plan.details) {
    const profile = adminProfilesById.get(studentId);
    detailsUpdate(planDetailsBackfill(record, profile).patch, profile.details);
  }

  mkdirSync(reviewDir, { recursive: true, mode: 0o700 });
  const reviewFile = join(reviewDir, `review-${now.slice(0, 10)}.json`);
  writeFileSync(
    reviewFile,
    JSON.stringify({ target, academyId, cutoff, generatedAt: now, ...plan.review }, null, 1),
    { mode: 0o600 },
  );

  const applied = process.env.REGYFIT_IMPORT_APPLY === "true";
  const result = {
    headsCreated: 0,
    applySkippedExistingHead: 0,
    applySkippedOrphanDocuments: 0,
    detailsStudentsFilled: 0,
    detailsFieldsFilled: 0,
  };
  if (applied) {
    for (const { studentId, head, promotions, evaluations } of plan.levels) {
      const headRef = firestore.doc(`${academy}/studentLevelProgress/${studentId}`);
      const writes = [
        ...promotions.map((doc) => [
          firestore.doc(`${academy}/levelPromotions/${doc.promotionId}`),
          doc,
        ]),
        ...evaluations.map((doc) => [
          firestore.doc(`${academy}/assessments/${doc.assessmentId}`),
          doc,
        ]),
      ];
      const outcome = await firestore.runTransaction(async (transaction) => {
        const [headSnapshot, ...snapshots] = await transaction.getAll(
          headRef,
          ...writes.map(([ref]) => ref),
        );
        // Create-only, re-checked here: a level opened in BPT since the plan was read wins.
        if (headSnapshot.exists) return "applySkippedExistingHead";
        if (snapshots.some((snapshot) => snapshot.exists)) return "applySkippedOrphanDocuments";
        transaction.create(headRef, head);
        for (const [ref, doc] of writes) transaction.create(ref, doc);
        return "headsCreated";
      });
      result[outcome] += 1;
    }
    for (const { studentId, record } of plan.details) {
      const profileRef = firestore.doc(`${academy}/studentAdminProfiles/${studentId}`);
      const filled = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(profileRef);
        if (!snapshot.exists) return [];
        // Recomputed on the fresh document: a field an admin filled since the plan is kept.
        const backfill = planDetailsBackfill(record, snapshot.data());
        if (backfill.filled.length > 0) {
          transaction.update(profileRef, {
            ...detailsUpdate(backfill.patch, snapshot.get("details")),
            updatedAt: now,
            updatedBy: importSource,
          });
        }
        return backfill.filled;
      });
      if (filled.length > 0) {
        result.detailsStudentsFilled += 1;
        result.detailsFieldsFilled += filled.length;
      }
    }
  }

  console.log(
    JSON.stringify({
      target,
      projectId,
      academyId,
      cutoff,
      applied,
      before: {
        students: students.size,
        adminProfiles: adminProfiles.size,
        levelHeads: heads.size,
        importedLevelHeads: heads.docs.filter((doc) => doc.get("source") === importSource).length,
        regyfitMemberRecords: records.size,
      },
      ...plan.counts,
      ...result,
      reviewEntries: plan.review.levels.length + plan.review.details.length,
      reviewFile,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

Note on `before.importedLevelHeads` in the rerun test: the head written by the first apply carries
`source: "regyfit-import"`, so the rerun reads `1`.

In `qa/package.json`, after `"import:regyfit-classes-services": ...,` add:

```json
    "import:regyfit-member-profile": "corepack pnpm --filter @bpt-jersey/domain build:runtime && node scripts/import-regyfit-member-profile.mjs",
```

- [ ] **Step 5: Run the emulator test to verify it passes**

Run the Step 3 command again.
Expected: `4 passed`. A count that disagrees means the importer is wrong, not the test: investigate,
do not edit the expectation.

- [ ] **Step 6: Prove the transactional create-only guard is functioning**

Temporarily change `if (headSnapshot.exists) return "applySkippedExistingHead";` to
`if (false) return "applySkippedExistingHead";` **and** in `planImport` temporarily delete the
`existingHeadStudentIds` skip, rerun Step 3: `apply creates the level` FAILS (the transaction's
`create` on `studentLevelProgress/student-c` aborts with `ALREADY_EXISTS`). Restore both, rerun, PASS.

- [ ] **Step 7: Format, lint, commit**

```bash
corepack pnpm prettier --write qa/scripts/import-regyfit-member-profile.mjs qa/package.json qa/fixtures/regyfit-member-profile-synthetic qa/integration/regyfit-member-profile-import.test.ts
corepack pnpm lint
git add qa/scripts/import-regyfit-member-profile.mjs qa/package.json qa/fixtures/regyfit-member-profile-synthetic qa/integration/regyfit-member-profile-import.test.ts
git commit -m "$(cat <<'EOF'
feat(member-profile): Regyfit levels/skills/details import CLI, create-only, with emulator proof (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Read-only capture script (outside the repository) and operator probe

**Files:**

- Create: `/root/regyfit-capture/scripts/regyfit-member-levels.mjs` (not in git; nothing to commit)

**Interfaces:**

- Consumes: `parseMemberListHtml`, `parseMemberDetailsHtml`, `parseLevelHistoryHtml`,
  `parseSkillScoresHtml` from `/root/BPT-Jersey/qa/scripts/regyfit-member-profile-map.mjs`.
- Produces: `/root/regyfit-capture/raw/member-levels/<regyfitId>.json` in the `CapturedMember`
  shape (Task 2), directory mode 0700, files 0600; one stdout JSON line
  `{ listed, captured, skipped, failed }`. Env: `REGYFIT_CAPTURE_LIMIT` (optional, integer),
  `REGYFIT_MEMBER_IDS_FILE` (optional JSON array of Regyfit internal ids, used only when the list page
  does not return every member).

This task is **operator-run**: the Regyfit login blocks the VPS IP, so the visible Chrome must be up
with the SSH tunnel open (see memory note "Regyfit capture via visible Chrome + SSH tunnel"). The
operator authorised this read-only walk in chat on 2026-09-17. If the auto-mode classifier blocks
Step 2 or Step 3, **stop and report**; do not retry by another route.

- [ ] **Step 1: Write the capture script**

Create `/root/regyfit-capture/scripts/regyfit-member-levels.mjs`:

```js
// Read-only capture for T051V2 Plan D: for every Regyfit member, member No. and date of birth
// (DETAILS), JIU-JITSU IBJJF level history with current-level counters (grads_aluno.php) and skill
// scores (gerir_atleta.php). Same-origin GET from the logged-in Regyfit tab: no clicks, no POST,
// no navigation. Personal data: output stays in /root/regyfit-capture/raw/member-levels (0600).
//
// usage: [REGYFIT_CAPTURE_LIMIT=3] [REGYFIT_MEMBER_IDS_FILE=/root/regyfit-capture/ids.json] \
//        node /root/regyfit-capture/scripts/regyfit-member-levels.mjs
// Resumable: a member whose JSON already exists is skipped.
import { chromium } from "/root/BPT-Jersey/qa/node_modules/@playwright/test/index.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  parseLevelHistoryHtml,
  parseMemberDetailsHtml,
  parseMemberListHtml,
  parseSkillScoresHtml,
} from "/root/BPT-Jersey/qa/scripts/regyfit-member-profile-map.mjs";

const OUT = "/root/regyfit-capture/raw/member-levels";
const SYSTEM_ID = "501"; // JIU-JITSU - IBJJF level system in Regyfit
const PAUSE_MS = 2_000;
mkdirSync(OUT, { recursive: true, mode: 0o700 });

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((candidate) => candidate.url().includes("regyfit.com"));
if (!page) throw new Error("No regyfit.com tab: log in through the visible Chrome first");

async function getHtml(path) {
  const response = await page.evaluate(async (url) => {
    const reply = await fetch(url, { credentials: "same-origin", redirect: "manual" });
    return { status: reply.status, text: reply.status === 200 ? await reply.text() : "" };
  }, path);
  // ponytail: a redirect (opaque, status 0) stops the walk; a login page served with 200 fails the
  // parsers ("markup changed"), which also stops that member instead of guessing.
  if (response.status !== 200) {
    throw new Error(
      `GET ${path.split("?")[0]} returned ${response.status}; is the session logged in?`,
    );
  }
  return response.text;
}

let ids;
if (process.env.REGYFIT_MEMBER_IDS_FILE) {
  ids = JSON.parse(readFileSync(process.env.REGYFIT_MEMBER_IDS_FILE, "utf8")).map(String);
  if (!ids.every((id) => /^\d{1,12}$/u.test(id))) throw new Error("Member ids must be digits");
} else {
  const list = parseMemberListHtml(
    await getHtml("/php8/admin/modulos/alunos/pesquisar_alunos.php?id_quick=30"),
  );
  if (list.total === null || list.ids.length < list.total) {
    throw new Error(
      `The list returned ${list.ids.length} of ${list.total ?? "?"} members; pass REGYFIT_MEMBER_IDS_FILE`,
    );
  }
  ids = list.ids;
}

const limit = Number(process.env.REGYFIT_CAPTURE_LIMIT ?? ids.length);
let captured = 0;
let skipped = 0;
let failed = 0;
for (const id of ids.slice(0, limit)) {
  const file = `${OUT}/${id}.json`;
  if (existsSync(file)) {
    skipped += 1;
    continue;
  }
  try {
    const details = parseMemberDetailsHtml(
      await getHtml(`/php8/admin/modulos/alunos/dados_alunos.php?aluno_id=${id}&tab=1`),
    );
    const history = parseLevelHistoryHtml(
      await getHtml(
        `/php8/admin/modulos/graduacoes/grads_aluno.php?id_user=${id}&id_sistema=${SYSTEM_ID}`,
      ),
    );
    const skills = parseSkillScoresHtml(
      await getHtml(
        `/php8/admin/modulos/graduacoes/gerir_atleta.php?id_sistema=${SYSTEM_ID}&id_user=${id}&src=perfil`,
      ),
    );
    writeFileSync(
      file,
      JSON.stringify(
        { regyfitId: id, ...details, history, skills, capturedAt: new Date().toISOString() },
        null,
        1,
      ),
      { mode: 0o600 },
    );
    captured += 1;
  } catch (error) {
    failed += 1;
    console.error(`member ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  await page.waitForTimeout(PAUSE_MS);
}
console.log(JSON.stringify({ listed: ids.length, captured, skipped, failed }));
await browser.close().catch(() => {});
```

`browser.close()` on a CDP connection only disconnects; the operator's Chrome stays open.

- [ ] **Step 2: Operator probe on three members (operator-run, tunnel open)**

📍 VPS, user root, any directory:

```bash
REGYFIT_CAPTURE_LIMIT=3 node /root/regyfit-capture/scripts/regyfit-member-levels.mjs
node -e 'const fs=require("fs");const known=new Set(require("/root/BPT-Jersey/docs/data/ibjjf-skills-observed.sanitized.json").skills.map(s=>s.regyfitId));const d="/root/regyfit-capture/raw/member-levels";for(const f of fs.readdirSync(d).filter(f=>/^\d+\.json$/.test(f))){const m=JSON.parse(fs.readFileSync(d+"/"+f));console.log(JSON.stringify({history:m.history.length,withClasses:m.history.filter(r=>r.classes).length,skills:m.skills.length,unknownSkillIds:m.skills.filter(s=>!known.has(s.regyfitSkillId)).length,scored:m.skills.filter(s=>s.score!==null).length,hasNumber:m.memberNumber!==null,hasDob:m.dateOfBirth!==null}))}'
```

Expected: `{"listed":252,"captured":3,"skipped":0,"failed":0}` (or the list error, then build the ids
file below); per member `skills: 58`, `unknownSkillIds: 0` (the captured ids are the Plan C structure
ids) and `history ≥ 0`; for a member with a level, the newest row `withClasses ≥ 1`. Counts only are
printed.

If the list error appears, the operator builds the id list from the already captured member records
(internal ids are the `recordId`s) and reruns Step 2 with
`REGYFIT_MEMBER_IDS_FILE=/root/regyfit-capture/member-ids.json`:

```bash
node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync("/root/regyfit-capture/member-ids.json",JSON.stringify(r.map(x=>x.recordId)),{mode:0o600});console.log(r.length)' <PATH_TO_NORMALISED_REGYFIT_MEMBER_RECORDS_JSON>
```

`<PATH_TO_NORMALISED_REGYFIT_MEMBER_RECORDS_JSON>` is the file previously passed as
`REGYFIT_MEMBER_RECORDS_FILE` to `qa/scripts/import-regyfit-member-records.mjs`.

If `skills` is not 58, or `unknownSkillIds` is not 0, or a member with a visible level in Regyfit shows
`history: 0`, or a newest row has no classes: stop, keep the three JSON files, and report the counts; the markup differs from the
2026-09-17 observation and the parser needs a new synthetic test first (Task 1 pattern).

- [ ] **Step 3: Full capture (operator-run)**

```bash
node /root/regyfit-capture/scripts/regyfit-member-levels.mjs
```

Expected (~252 members × (3 GETs + 2 s) ≈ 15 minutes): `failed: 0`, `captured + skipped = listed`.
A failure prints only the internal id and the error; rerun the same command to resume.

---

### Task 6: Emulator UI proof — the record shows the imported level and the split counter

**Files:**

- Create: `qa/scripts/seed-regyfit-member-profile-emulator.mjs`
- Create: `qa/scripts/run-member-profile-import-ui-e2e.mjs`
- Create: `qa/tests/member-profile-import-emulator.spec.ts`
- Modify: `qa/run-e2e.mjs` (forwarded-variable array: add `"MEMBER_PROFILE_IMPORT_UI_EMULATOR_E2E",` after `"CS_IMPORT_UI_EMULATOR_E2E",`)

**Interfaces:**

- Consumes: CLI and fixture from Task 4; Plan B route `/admin/members/profile?id=`; Plan C IBJJF card
  copy "N from Regyfit + M in BPT" (spec §6.2); `apps/functions/scripts/seed-levels.mjs`;
  `qa/scripts/seed-auth-emulator.mjs`.
- Produces: opt-in flag `MEMBER_PROFILE_IMPORT_UI_EMULATOR_E2E=true`; never runs in CI.

- [ ] **Step 1: Write the failing spec**

Create `qa/tests/member-profile-import-emulator.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

/**
 * T051V2 Plan D: a student loaded by the Regyfit member-profile import shows the imported level and
 * the class counter split (G10) on the member record, through real Auth, Functions and Firestore
 * emulators. Data: synthetic fixture qa/fixtures/regyfit-member-profile-synthetic, imported by the
 * runner with cutoff 2026-09-11, plus one BPT attendance on 2026-09-12.
 */
test.describe("Member profile import on Firebase Emulators", () => {
  test("shows the imported level with Regyfit and BPT classes", async ({ page }) => {
    test.skip(
      process.env.MEMBER_PROFILE_IMPORT_UI_EMULATOR_E2E !== "true" ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== "demo-bpt-jersey" ||
        !process.env.AUTH_EMULATOR_E2E_EMAIL ||
        !process.env.AUTH_EMULATOR_E2E_PASSWORD,
      "Synthetic owner and imported emulator data are required.",
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.getByLabel("Email address").fill(process.env.AUTH_EMULATOR_E2E_EMAIL!);
    await page.getByLabel("Password").fill(process.env.AUTH_EMULATOR_E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin/u);

    await page.goto("/admin/members/profile?id=rf-import-student-a");
    await expect(page.getByText("White - 2nd Stripe", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("9 from Regyfit + 1 in BPT")).toBeVisible();
    await page.screenshot({
      path: "test-results/member-profile-import-record.png",
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText("9 from Regyfit + 1 in BPT")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: "test-results/member-profile-import-record-390.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the seed and the runner**

Create `qa/scripts/seed-regyfit-member-profile-emulator.mjs`:

```js
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Synthetic canonical data for the Plan D UI proof: two adults whose member numbers and dates of
// birth match fixture members 9101 (loaded) and 9102 (date of birth differs, not loaded), one past
// session after the cutoff and the first adult's attendance at it.
const projectId = "demo-bpt-jersey";
if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  (process.env.GCLOUD_PROJECT ?? projectId) !== projectId
) {
  throw new Error("Member profile import seed requires the loopback demo Firestore Emulator.");
}
const academyId = process.env.AUTH_EMULATOR_E2E_ACADEMY_ID?.trim();
if (!academyId) throw new Error("Missing required environment: AUTH_EMULATOR_E2E_ACADEMY_ID");

const app = initializeApp({ projectId }, "member-profile-import-seed");
const firestore = getFirestore(app);
const at = "2026-01-01T00:00:00.000Z";
const audit = {
  schemaVersion: "1",
  createdAt: at,
  createdBy: "synthetic-seed",
  updatedAt: at,
  updatedBy: "synthetic-seed",
};
const base = `academies/${academyId}`;

try {
  const batch = firestore.batch();
  for (const [studentId, fullName, dateOfBirth, membershipNumber] of [
    ["rf-import-student-a", "Synthetic Import Adult A", "1990-01-01", "9101"],
    ["rf-import-student-b", "Synthetic Import Adult B", "1991-02-03", "9102"],
  ]) {
    batch.set(firestore.doc(`${base}/students/${studentId}`), {
      studentId,
      academyId,
      fullName,
      dateOfBirth,
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active: true,
      status: "active",
      ...audit,
    });
    batch.set(firestore.doc(`${base}/studentAdminProfiles/${studentId}`), {
      studentId,
      academyId,
      membershipNumber,
      gender: "unknown",
      source: "admin",
      ...audit,
    });
  }
  batch.set(firestore.doc(`${base}/sessions/rf-import-session-1`), {
    sessionId: "rf-import-session-1",
    academyId,
    classId: null,
    programId: "rf-import-program",
    locationId: "town",
    instructorId: "rf-import-coach",
    instructorIds: ["rf-import-coach"],
    title: "Synthetic GI",
    startAt: "2026-09-12T17:00:00.000Z",
    endAt: "2026-09-12T18:00:00.000Z",
    capacity: 40,
    minParticipants: 0,
    status: "completed",
    isSeminar: false,
    cancellationReason: null,
    ...audit,
  });
  batch.set(firestore.doc(`${base}/attendance/rf-import-attendance-1`), {
    attendanceId: "rf-import-attendance-1",
    academyId,
    sessionId: "rf-import-session-1",
    studentId: "rf-import-student-a",
    method: "manual",
    state: "attended",
    occurredAt: "2026-09-12T17:00:00.000Z",
    notes: null,
    correctionOf: null,
    proximity: null,
    ...audit,
  });
  await batch.commit();
} finally {
  await deleteApp(app);
}
```

Create `qa/scripts/run-member-profile-import-ui-e2e.mjs`:

```js
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";
const academyId = "member-profile-import-e2e";

if (
  process.env.MEMBER_PROFILE_IMPORT_UI_EMULATOR_E2E !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_ENV !== "local" ||
  process.env.NEXT_PUBLIC_ADMIN_E2E ||
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
) {
  throw new Error(
    "Member profile import runner requires explicit local demo-project emulator flags.",
  );
}

function run(args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const owner = { AUTH_EMULATOR_E2E_ROLE: "owner", AUTH_EMULATOR_E2E_ACADEMY_ID: academyId };
run(["qa/scripts/seed-auth-emulator.mjs"], owner);
run([
  "apps/functions/scripts/seed-levels.mjs",
  "--target=emulator",
  `--academy-id=${academyId}`,
  "--system-id=ibjjf-v2",
]);
run(["qa/scripts/seed-regyfit-member-profile-emulator.mjs"], owner);
run(["qa/scripts/import-regyfit-member-profile.mjs"], {
  REGYFIT_CAPTURE_DIR: "qa/fixtures/regyfit-member-profile-synthetic",
  REGYFIT_ACADEMY_ID: academyId,
  REGYFIT_IMPORT_TARGET: "emulator",
  REGYFIT_IMPORT_CUTOFF: "2026-09-11",
  REGYFIT_IMPORT_NOW: "2026-09-11T08:00:00.000Z",
  REGYFIT_REVIEW_DIR: mkdtempSync(join(tmpdir(), "member-profile-import-review-")),
  REGYFIT_IMPORT_APPLY: "true",
});
run([
  "qa/run-e2e.mjs",
  "tests/member-profile-import-emulator.spec.ts",
  "--project=desktop-chromium",
  "--workers=1",
  "--retries=0",
]);
```

In `qa/run-e2e.mjs`, add `"MEMBER_PROFILE_IMPORT_UI_EMULATOR_E2E",` right after
`"CS_IMPORT_UI_EMULATOR_E2E",`.

- [ ] **Step 3: Build what the emulators and the static export need**

```bash
cd /root/BPT-Jersey
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm --filter @bpt-jersey/functions build
node apps/functions/scripts/build-deploy-artifact.mjs
NEXT_PUBLIC_FIREBASE_ENV=local NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bpt-jersey NEXT_PUBLIC_LEVELS_BACKEND=true \
corepack pnpm --filter @bpt-jersey/web build
```

(`NEXT_PUBLIC_LEVELS_BACKEND=true` as in Plan C Task 18: without it the IBJJF card does not read the
levels backend.)

Expected: each command exits 0.

- [ ] **Step 4: Run it in the emulator container and watch it pass**

```bash
cat > /root/.member-profile-import-e2e.env <<'EOF'
MEMBER_PROFILE_IMPORT_UI_EMULATOR_E2E=true
NEXT_PUBLIC_FIREBASE_ENV=local
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bpt-jersey
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
AUTH_EMULATOR_E2E_EMAIL=member-profile-import-owner@example.test
AUTH_EMULATOR_E2E_PASSWORD=Synthetic-Owner-2026
FUNCTIONS_DISCOVERY_TIMEOUT=300000
COREPACK_ENABLE_NETWORK=0
npm_config_verify_deps_before_run=false
EOF
docker run --rm --network none --env-file /root/.member-profile-import-e2e.env \
  -v /root/BPT-Jersey:/root/BPT-Jersey -v /root/.cache/firebase:/root/.cache/firebase \
  -v /root/.cache/node:/root/.cache/node -w /root/BPT-Jersey bpt-emu:local \
  bash -lc 'corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions "node qa/scripts/run-member-profile-import-ui-e2e.mjs"'
rm /root/.member-profile-import-e2e.env
```

Expected: importer line with `"applied":true,"headsCreated":1`, then `1 passed`. If the card shows
another wording for the split (Plan C owns the copy), the spec follows Plan C's merged copy only if it
still states both numbers: open `apps/web/src/app/admin/members/profile/ibjjf-card.tsx`, take the
exact string, and change only the two `getByText` literals.

- [ ] **Step 5: Prove the spec can fail**

Change `REGYFIT_IMPORT_APPLY: "true"` to `"false"` in the runner, rerun Step 4, confirm the spec fails
on `9 from Regyfit + 1 in BPT` (the card shows the "No level yet" empty state), restore `"true"`.

- [ ] **Step 6: Format, lint, commit**

```bash
corepack pnpm prettier --write qa/scripts/seed-regyfit-member-profile-emulator.mjs qa/scripts/run-member-profile-import-ui-e2e.mjs qa/tests/member-profile-import-emulator.spec.ts qa/run-e2e.mjs
corepack pnpm lint
git add qa/scripts/seed-regyfit-member-profile-emulator.mjs qa/scripts/run-member-profile-import-ui-e2e.mjs qa/tests/member-profile-import-emulator.spec.ts qa/run-e2e.mjs
git commit -m "$(cat <<'EOF'
test(member-profile): emulator proof that imported levels show on the record with the class split (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Screenshots under `qa/test-results/` are synthetic and are not committed.

---

### Task 7: Operator-gated production runbook and ledger evidence

**Files:**

- Modify: `tasksv2.md` (row T051V2 only; by hand, never prettier)

**Interfaces:**

- Consumes: Tasks 1–6; capture from Task 5 Step 3.
- Produces: evidence; no code. Every production step below is an **operator gate**.

Production state today (Plan C Global Constraints and Task 19 ledger row): **no level catalogue** is
seeded, `apps/functions/scripts/level-seed-target.mjs` refuses `--target=production`
("Production seed is strictly prohibited."), and `NEXT_PUBLIC_LEVELS_BACKEND` is false in the
Cloudflare Pages build. Plan D's dry run would stop at "The one published level system must be
ibjjf-v2". So, **before Step 2**, each of these is a separate operator gate, done in this order, each
with an explicit OK in chat and its evidence noted for Step 6. None is automated by this plan:

- (a) **Seed guard change + `ibjjf-v2` production seed.** Plans A–C merged to `main`; the operator has
  approved `docs/data/ibjjf-criteria-diff-bpt-vs-regyfit.md` (G9, Plan C Task 2 Step 6). A separate,
  operator-approved commit relaxes the guard in `level-seed-target.mjs` only for
  `--target=production --system-id=ibjjf-v2` with `GCLOUD_PROJECT=bptjersey-f5a25` and an explicit
  operator confirmation variable, keeps every other production path refused, and adds a test that
  fails when the confirmation is missing. Then the operator (or the agent with his permission, as in
  Step 1) runs the seed once against `demo-academy` and confirms 177 definitions / 58 skills / 165
  requirements.
- (b) **Levels backend flag.** `NEXT_PUBLIC_LEVELS_BACKEND=true` set in the Cloudflare Pages
  production build environment by the operator, after (a), so the web never calls a levels backend
  without a catalogue.
- (c) **Deploy Plans A–C.** Functions (Plan A security changes; Plan B `getMemberProfile`,
  `searchMemberNames`, extended `updateMember`; Plan C `assignLevel`, `voidPromotion`,
  `getStudentLevelHistory`, `openStudentLevel`, `recordEvaluation`, `getStudentProgressSummary`) and
  the web build carrying the flag from (b), deployed together after the operator's OK. The DETAILS
  health fields stay behind their own DPIA/policy gate (Plan B Global Constraints); this import never
  writes them.

Then, before Step 3 (check and state each in chat):

- (a)–(c) done, with their dates.
- The full capture from Task 5 Step 3 finished with `failed: 0`; its day is the capture day.
- `REGYFIT_IMPORT_CUTOFF` = the day **after** the capture day (e.g. capture on 2026-09-18 → cutoff
  `2026-09-19`). Plan C counts BPT attendance from the cutoff day inclusive on top of the Regyfit
  baseline.
- Unit and emulator tests of Tasks 1–6 green on the branch.

- [ ] **Step 1: Operator decision — production read credential**

The previous temporary-ADC approach was blocked by the auto-mode classifier in this session, so the
agent does not create production credentials by itself. The operator picks one in chat:

- **A (recommended):** the operator runs Steps 2 and 5 himself from the Claude Code prompt with the
  `!` prefix (the command runs in this session's shell under his authority).
- **B:** the operator explicitly grants the agent permission in chat to run the ADC login and the
  commands of Steps 2 and 5.

- [ ] **Step 2: Production dry run (read-only; operator gate)**

📍 VPS, user root, directory `/root/BPT-Jersey`. Log in with a user that can read Firestore in
`bptjersey-f5a25` (writes nothing; it stores a local credential until Step 7 revokes it):

```bash
gcloud auth application-default login --no-launch-browser
```

Then the dry run (no `REGYFIT_IMPORT_APPLY`, so nothing is written to Firestore):

```bash
REGYFIT_CAPTURE_DIR=/root/regyfit-capture/raw/member-levels \
REGYFIT_ACADEMY_ID=demo-academy \
REGYFIT_IMPORT_TARGET=production \
GCLOUD_PROJECT=bptjersey-f5a25 \
REGYFIT_OPERATOR_CONFIRMATION=member-profile-levels-production-v1 \
REGYFIT_IMPORT_CUTOFF=<DAY_AFTER_CAPTURE> \
node qa/scripts/import-regyfit-member-profile.mjs
```

`<DAY_AFTER_CAPTURE>`: `YYYY-MM-DD` of the day after Task 5 Step 3 ran (the `capturedAt` date of
the captured files plus one day).

Expected: one JSON line with `"applied":false`, `before.students` ≈ 249, `before.levelHeads` (0 if no
level was opened by hand), `before.importedLevelHeads: 0`, `membersCaptured` ≈ 252, and the counts.
The review list is at `/root/regyfit-capture/raw/member-levels/review-<today>.json`. If it fails with
`The one published level system must be ibjjf-v2`, prerequisite (a) is not met: stop.

- [ ] **Step 3: Operator reviews counts and review list (operator gate)**

Send the operator the JSON line (counts only) and the path of the review file. The operator opens the
review file himself (it holds Regyfit ids, member numbers and student ids). Typical fixes happen in
BPT or Regyfit by hand (a wrong date of birth, a missing member number), then Step 2 is rerun. Wait
for an explicit "apply" OK in chat. No OK, no Step 4.

- [ ] **Step 4: Apply (operator gate, only after the OK in chat)**

⚠️ Writes production data (create-only level heads, promotions, assessments; empty-field DETAILS
updates). Nothing existing is overwritten or deleted. Reversal, if the operator ever asks, is a manual
operator-approved deletion of documents with `source: "regyfit-import"` / `createdBy: "regyfit-import"`
and removal of the backfilled fields; it is not automated here.

Same command as Step 2 with the same cutoff plus `REGYFIT_IMPORT_APPLY=true`:

```bash
REGYFIT_CAPTURE_DIR=/root/regyfit-capture/raw/member-levels \
REGYFIT_ACADEMY_ID=demo-academy \
REGYFIT_IMPORT_TARGET=production \
GCLOUD_PROJECT=bptjersey-f5a25 \
REGYFIT_OPERATOR_CONFIRMATION=member-profile-levels-production-v1 \
REGYFIT_IMPORT_CUTOFF=<DAY_AFTER_CAPTURE> \
REGYFIT_IMPORT_APPLY=true \
node qa/scripts/import-regyfit-member-profile.mjs
```

Expected: `headsCreated` equals Step 2 `headsToCreate` (minus any level opened by hand since, shown as
`applySkippedExistingHead`), `applySkippedOrphanDocuments: 0`, `detailsStudentsFilled` equals Step 2
`detailsStudentsToFill`.

- [ ] **Step 5: Verification counts (read-only)**

Rerun the Step 2 dry-run command unchanged. Expected: `headsToCreate: 0`,
`before.importedLevelHeads` = Step 4 `headsCreated`, `skippedExistingHead` = Step 2
`skippedExistingHead` + Step 4 `headsCreated`, `detailsStudentsToFill: 0`. Then the operator opens two
imported members' records in production and confirms the level, the history rows and the
"N from Regyfit + M in BPT" line match Regyfit.

- [ ] **Step 6: Record evidence in the ledger**

In `tasksv2.md`, row T051V2, add a Spanish note by hand (no prettier): plan D path; commits; unit test
count of `qa/unit/regyfit-member-profile-map.test.ts`; emulator integration `4 passed` and UI proof
`1 passed` with date; capture `listed/captured/failed`; production dry-run counts (matched, review by
reason, headsToCreate, promotionsToCreate, scoresToCreate, detailsStudentsToFill); apply counts;
verification rerun `headsToCreate: 0`; operator OK dates in chat for prerequisites (a)–(c) and for the
apply; campos no importados a propósito (identificadores con clave de identidad, email/teléfono,
salud `healthNumber`/`weightKg`/`heightCm`, `country`). Counts only, no identities.
Then:

```bash
git sparse-checkout add Lista Listav2
corepack pnpm vitest run --project node qa/unit/listav2-ledger-sync.test.ts
git sparse-checkout set '/*' '!/Lista' '!/Listav2'
git add tasksv2.md
git commit -m "$(cat <<'EOF'
docs(tasks): T051V2 Plan D Regyfit member-profile import evidence (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: ledger sync test PASS.

- [ ] **Step 7: Close the production credential**

📍 VPS, user root:

```bash
gcloud auth application-default revoke
```

Expected: `Credentials revoked.` The raw capture and review file stay in
`/root/regyfit-capture/raw/member-levels/` until the operator decides to delete them.

---

## Self-review

**Spec coverage (§6.5, G2–G5, G8, G10, §9):**

- Capture of member No., DOB, full history, current classes, skill scores, read-only, ≥2 s, resumable,
  raw outside repo → Task 5 (parsers tested in Task 1).
- Matching by member number AND DOB, unique both sides, review list, never by name → Task 2
  (`matchMembers`), used for levels and DETAILS in Task 3.
- Levels: Plan C head (opening from the oldest row, real start date, `importedBaseline`,
  `source`), append-only promotions with `promotedOn`/`atAssignment`/`restore` (voidable) and
  `source: "regyfit-import"`, create-only rerun-safe → Tasks 2–4.
- Skills: non-empty scores only, mapped by Regyfit skill id through Plan C's structure file, one
  dated per-skill batch flagged `source` → Task 2; emulator proof Task 4.
- DETAILS backfill empty-only from `regyfitMemberRecords` into Plan B's `details` block (and top-level
  `postalAddress`), parsed with `studentAdminDetailsSchema` → Task 3, re-checked in the transaction in
  Task 4.
- Production prerequisites (seed guard + `ibjjf-v2` seed, Pages flag, Plans A–C deploy) → Task 7
  operator gates (a)–(c).
- Dry run counts only, review list with identities outside the repo → Task 4 (stdout assertion).
- Production guard with `GCLOUD_PROJECT` + confirmation token, operator OK → Tasks 1, 7.
- §9 emulator integration (dry run, create-only rerun, rejections, empty-only) → Task 4; record page
  shows imported level and split counter → Task 6.
- G10 no double counting at the cutoff: enforced by the cutoff-after-capture rule (Task 3 test);
  the attendance side of the formula is Plan C's.

**Placeholder scan:** the only angle-bracket values are operator inputs in Task 5 Step 2
(`<PATH_TO_NORMALISED_REGYFIT_MEMBER_RECORDS_JSON>`, with its source) and Task 7
(`<DAY_AFTER_CAPTURE>`, with the rule to compute it).

**Type consistency:** `planImport` returns `levels`/`details`/`review`/`counts` as consumed by the CLI;
`ImportCounts` keys in Task 3 equal the keys asserted in Task 4; review file name
`review-<now date>.json` is asserted as `review-2026-09-11.json` with `REGYFIT_IMPORT_NOW=2026-09-11…`;
promotion/evaluation ids follow `buildGraduationId`/`buildEvaluationId`. Head/promotion field names
are Plan C's "Interfaces produced for Plan D" and Tasks 7–10 (`openedDefinitionKey`, `openedOn`,
`openedByRole`, `source`, `importedBaseline`, `promotedOn`, `note`, `gaps`, `atAssignment`, `restore`);
DETAILS keys are Plan B Task 1's `studentAdminDetailsSchema`; `ImportedBaseline`,
`StudentAdminDetails` and `PostalAddress` types come from the domain subpaths.
