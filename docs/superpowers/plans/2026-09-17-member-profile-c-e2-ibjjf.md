# Member profile Plan C: E2 JIU-JITSU IBJJF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every canonical member record a JIU-JITSU IBJJF card and a Manage view (level history,
open level, assign next level with explicit gaps, void promotion, skills assessment) driven by a
Regyfit-sourced catalogue version `ibjjf-v2`, then prove Plans B and C end to end on emulators.

**Architecture:** A read-only extraction (outside the repo) produces a structure-only JSON of
Regyfit's 58 skills and 177 levels; a pure domain builder turns it plus the approved v1 visuals into
catalogue sources for `ibjjf-v2`, published through the existing seed/publication path, which becomes
version-aware. Progress becomes one pure formula (`computeLevelProgress`) fed by attendance since the
level start plus an optional imported baseline. New store operations (`assignLevel`, `voidPromotion`,
`getStudentLevelHistory`, `recordSkillRatings`) live beside the existing ones in `level-service.ts`,
are exposed as callables with head coach / owner / coach roles, and the web adds three components
under `apps/web/src/app/admin/members/profile/`.

**Tech Stack:** TypeScript strict, zod 4.4.3 (new contracts only), Firebase Functions v2 `onCall`,
Firestore transactions, Next.js 16 static export / React 19, Vitest (`node` + `web` projects),
Playwright 1.61.1 against Firebase Emulators in Docker.

**Spec:** `docs/superpowers/specs/2026-09-17-member-profile-e0-e2-design.md` (§6.1–6.4, §9; grill
G6, G7, G9, G10). Executes after Plan B (`docs/superpowers/plans/2026-09-17-member-profile-b-*.md`).

## Decisions this plan settles (read before Task 1)

1. **Assignment is a new callable `assignLevel`**, not a change to `approvePromotion`.
   `approvePromotion` (`apps/functions/src/levels/level-service.ts:1305-1405`) is the head-coach-only,
   next-sequence-only, dated-now flow used by the recognition panel; the spec needs skipping, a past
   promotion date, owner access and a gap list. `assignLevel` writes the same `levelPromotions`
   document shape (`status: "approved"`, same audit action `level.promotion.approved`) plus
   `promotedOn`, `note`, `gaps`, `atAssignment` and `restore`, so every existing reader keeps working.
   `approvePromotion` is only changed to drop `importedBaseline` from the head and store `restore`.
2. **Void restores from the promotion's own `restore` snapshot** (head fields before the change), so a
   void never has to reconstruct history. Only the promotion named by
   `head.lastApprovedPromotionId` can be voided; voiding walks back one step at a time.
3. **Batch ratings go through the `recordEvaluation` callable** with a second payload shape
   `{ studentId, definitionKey, ratings, evidenceNotes? }`; the store method is `recordSkillRatings`.
   It writes one `assessments` document per rating (the reader contract is one skill per document,
   `level-service.ts:931-953`) with `sessionId: null`, because the Manage view has no session.
4. **Catalogue versions:** `ibjjf-v1` stays the approved default (tests, bundled web catalogue).
   `ibjjf-v2` is built at load time from `docs/data/ibjjf-levels-observed.sanitized.json` (keys and
   belt visuals) + `docs/data/ibjjf-skills-observed.sanitized.json` (Regyfit structure). One academy
   holds exactly one published system: seeding v2 where v1 exists is refused (ponytail; production has
   no catalogue seeded, `docs/operations/t058-release-rollback-runbook.md:148`).
5. **Skill minimum semantics stay as today:** a level's skill minimums apply when moving _into_ it
   (`buildStudentProgressSummary` reads the target definition's requirements,
   `packages/domain/src/levels/level-contracts.ts:976-979`). The assessment marks "Minimum N" for the
   next level.
6. **`startedOn` is optional in the contract** (the coach roster panel
   `apps/web/src/app/coach/open-level-panel.tsx` opens "today"); the Manage form always sends it and the
   UI requires it.
7. **Owner may rate skills** (G6 "owner everything"), so the §9 owner-only E2E needs no second session.

## Global Constraints

- CLAUDE.md layering: domain contract → functions service → Firestore adapter → callable → web
  client → route. `packages/domain` never imports Firebase. New domain modules
  (`level-progress.ts`, `level-manage-contracts.ts`, `level-catalog-v2.ts`) are re-exported from
  `packages/domain/src/levels/level-contracts.ts` and therefore reachable through the existing
  `@bpt-jersey/domain/levels` subpath (`packages/domain/package.json:113-117`); no new subpath.
- New callables (`assignLevel`, `voidPromotion`, `getStudentLevelHistory`) are exported from
  `apps/functions/src/index.ts:78-90` and use `levelCallableOptions = { enforceAppCheck: true }`.
- Roles: coach and head coach rate; head coach and owner open, assign and void; card and history
  readable by owner, administrator, head coach, coach. Guardians and adult students never reach the
  new callables. Every new guard has a test that fails when the guard is removed (LECCIONES §5).
- Backend security: `requireActor` from `level-authorization.ts`, academy scope from the actor,
  strict zod input (`z.strictObject`), `assertTransactionalActor` inside every write transaction,
  audit event appended in the same transaction, append-only (`transaction.create` for records, only
  the head is `set`), Firestore rules stay deny-direct for `levelPromotions` and
  `studentLevelProgress`.
- Frontend security: no `dangerouslySetInnerHTML`; every new callable response parsed with a zod
  schema from the domain; only the fixed safe error strings reach the UI; `studentId` validated with
  the identifier pattern `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` before any call; no restricted value
  in URLs, `console`, analytics or web storage; no new origins.
- DESIGN.md: purple `#2F2483` (`--bpt-purple`), canvas `#F2F1ED`, ink `#1A1A18`, muted `#65635D`,
  line `#8A8880`, Purple Wash `#F0EFFF`/`#D9D6FF`; square corners; hard offset shadows only; status =
  text + coloured left border (`0.35rem solid #176B49` met / `#C98B00` not met), never a pill;
  Barlow Condensed display / Source Sans 3 body; eyebrow `0.72rem` 700 uppercase `0.15em`;
  `font-variant-numeric: tabular-nums` on counts; buttons ≥ `3.15rem`, `3px` purple focus outline;
  labels above inputs; inline row actions, no kebab; skeletons not spinners; empty state = eyebrow +
  headline + one sentence + one button; one column below `50rem`; no horizontal scroll; ≥44px
  targets; `prefers-reduced-motion`; UK English; no emojis; no icon-only buttons. Belt colours only
  inside `.belt-bar`/`.belt-tip` (DESIGN.md §10) — reuse `BeltBar` from
  `apps/web/src/app/levels/levels-browser.tsx:30-64`. Reuse `admin.css` classes
  (`.admin-auth-button`, `.admin-eyebrow`, `.admin-data-table`, `.admin-empty-state`,
  `.admin-text-link`) before adding new ones; new CSS goes in
  `apps/web/src/app/admin/admin.css` under a `/* T051V2 IBJJF */` block.
- Ponytail: smallest diff, no new runtime dependencies, no speculative abstractions; deliberate
  simplifications carry a `// ponytail:` comment naming the ceiling. The only dependency change is
  the `axe-core` dev dependency of `qa`, behind an operator gate (Task 18).
- Raw Regyfit captures stay in `/root/regyfit-capture/raw/` and contain member data in page chrome:
  scripts read only skill labels/ids, level names, level rule strings and level hierarchy. Nothing
  else from those files is printed, logged or committed.
- **Operator gates (never automated):** publishing `ibjjf-v2` beyond the emulator (Task 2 Step 6);
  adding `axe-core` to `qa` (Task 18 Step 1); any production deploy, seed or write. Production has no
  level catalogue and `seed-levels.mjs` rejects production; this plan does not change that.
- Commands: always `corepack pnpm …` from `/root/BPT-Jersey`; Node `>=22.13 <25`.
- On this VPS: the checkout is sparse; before `typecheck`, full `test` or `verify:mvp` run
  `git sparse-checkout add Lista Listav2 .cronos` and restore afterwards with
  `git sparse-checkout set '/*' '!/.cronos' '!/Lista' '!/Listav2'`. Emulators run only inside Docker
  image `bpt-emu:local` with `--network none` (host port 8080 is code-server). Inside the container
  call `node_modules/.bin/firebase emulators:exec …` directly (pnpm 11 deps check aborts). Emulator
  runs need JDK 21 (in the image), project `demo-bpt-jersey`,
  `FUNCTIONS_DISCOVERY_TIMEOUT=300000`.
- Never run prettier on `tasksv2.md`; edit it by hand.
- Every commit message ends with the task tag `(T051V2)` and the line
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Interfaces consumed from Plan B (exact names from the shared brief)

- Route `apps/web/src/app/admin/members/profile/page.tsx`; `member-record.tsx` (header + ARIA tabs,
  reads `?id`, `?tab`, `&view`), `profile-tab.tsx` (renders the PROFILE cards and exposes the slot
  where the IBJJF card goes), `details-tab.tsx`.
- `apps/web/src/lib/member-profile-client.ts`: `getMemberProfile(studentId)` returning
  `MemberProfile` (discriminated on `view: "full" | "coach"`), header type
  `MemberProfileHeader = { studentId, fullName, age, participantType, status, maskedMemberReference?, birthdayBadge }`.
- From `docs/superpowers/plans/2026-09-17-member-profile-b-e1-record.md` (Tasks 9, 11–13):
  `ProfileTab({ profile, ibjjfCardSlot?: ReactNode })`; inside `MemberRecord` the constant
  `const ibjjfCardSlot: ReactNode = undefined;` and the function `panel(profile)` are the insertion
  points; `readRecordLocation(search)` returns `{ studentId, tab, manage }`;
  `recordHref(studentId, tab = "profile", manage = false)` builds
  `/admin/members/profile?id=<id>[&tab=<tab>][&view=manage]`. Accessible names: search input
  "Member name", button "Search", links "Open record for <name>"; DETAILS field "Nickname", button
  "Save details", status "Details saved."; header birthday text "Birthday in N days".

## Interfaces produced for Plan D (import)

- Head document `academies/{academyId}/studentLevelProgress/{studentId}` fields added:
  `openedDefinitionKey: string`, `openedOn: "YYYY-MM-DD"`, `openedByRole: "headCoach" | "owner" | null`,
  `source?: "regyfit-import"`, `importedBaseline?: { classes: number; cutoff: "YYYY-MM-DD"; source: "regyfit-import" }`.
  `cutoff` is the **first date counted from BPT attendance** (BPT attendance with Jersey-agnostic
  `occurredAt.slice(0, 10) >= cutoff` is added to the baseline).
- Promotion document `academies/{academyId}/levelPromotions/{promotionId}` fields added:
  `promotedOn`, `note: string | null`, `gaps: string[]`, `atAssignment: { classes: {done,min}, days: {done,min} }`,
  `restore: { currentDefinitionKey, currentLevelStartedAt, lastApprovedPromotionId, importedBaseline }`,
  `source?: "regyfit-import"`. Imported promotions must carry `restore` to be voidable.
- Void document (same collection) `{ kind: "void", promotionId: "void_<voided id>", voidsPromotionId, reason, decidedBy, decidedByRole, decidedByStaffId, decidedAt, … }`.
- Assessment documents written by `recordSkillRatings`: one per skill, `sessionId: null`,
  optional `source: "regyfit-import"`.
- Catalogue data `docs/data/ibjjf-skills-observed.sanitized.json` carries `regyfitId` for every skill
  and level, so Plan D maps captured scores and grads by Regyfit id.

---

## File Structure

| File                                                                                                | Responsibility                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/root/regyfit-capture/scripts/extract-ibjjf-skills-structure.mjs` (outside repo)                   | Read two saved Regyfit pages, emit structure-only JSON                                     |
| `docs/data/ibjjf-skills-observed.sanitized.json` (create)                                           | Regyfit skills (58) and levels (177) with rules, no member data                            |
| `qa/unit/ibjjf-skills-observed-structure.test.ts` (create)                                          | Proves the committed JSON is structure only and complete                                   |
| `qa/scripts/ibjjf-criteria-diff.mjs` + `.d.mts` (create)                                            | Pure diff builder + CLI writing the report                                                 |
| `qa/unit/ibjjf-criteria-diff.test.ts` (create)                                                      | Diff builder tests                                                                         |
| `docs/data/ibjjf-criteria-diff-bpt-vs-regyfit.md` (generated)                                       | Operator review before publishing v2                                                       |
| `packages/domain/src/levels/level-catalog-v2.ts` (create)                                           | `levelCatalogVersionShapes`, `buildIbjjfV2CatalogSources`                                  |
| `packages/domain/src/levels/level-contracts.ts` (modify)                                            | Version-aware parsers, type widening, re-exports, summary fields                           |
| `packages/domain/src/levels/level-progress.ts` (create)                                             | `computeLevelProgress`, `countClassesAtLevel`, `listPromotionGaps`, `skillCategory`, dates |
| `packages/domain/src/levels/level-manage-contracts.ts` (create)                                     | zod schemas for assign/void/history/ratings/card                                           |
| `packages/domain/src/audit/audit-event.ts` (modify)                                                 | `level.promotion.voided` action                                                            |
| `apps/functions/src/levels/level-source.ts`, `level-catalog-integrity.ts`, `level-seed.ts` (modify) | Version-aware approval, shape and loading                                                  |
| `apps/functions/scripts/level-seed-target.mjs`, `seed-levels.mjs` (modify)                          | `--system-id` on seed                                                                      |
| `apps/functions/src/levels/level-service.ts` (modify)                                               | Summary baseline, open, assign, void, history, ratings                                     |
| `apps/functions/src/levels/level-manage-service.test.ts` (create)                                   | Store tests on an in-memory Firestore fake                                                 |
| `apps/functions/src/levels/level-callables.ts` (+ tests) (modify)                                   | New handlers and role guards                                                               |
| `apps/functions/src/index.ts` (modify)                                                              | Export new callables                                                                       |
| `qa/rules/client-data-boundary.test.ts` (modify)                                                    | Deny-direct for level head and promotions                                                  |
| `qa/integration/level-manage.test.ts` (create)                                                      | Emulator Firestore proof of open/assign/void/baseline                                      |
| `apps/web/src/lib/levels-client.ts` (+ test) (modify)                                               | Card, history, assign, void, ratings, scores clients                                       |
| `apps/web/src/app/levels/levels-browser.tsx`, `levels-grouping.ts` (modify)                         | Export `BeltBar`, add `beltPosition`                                                       |
| `apps/web/src/app/admin/members/profile/ibjjf-card.tsx` (+ test) (create)                           | PROFILE card                                                                               |
| `apps/web/src/app/admin/members/profile/manage-view.tsx` (+ test) (create)                          | `&view=manage` screen                                                                      |
| `apps/web/src/app/admin/members/profile/skills-assessment.tsx` (+ test) (create)                    | Ratings form                                                                               |
| `apps/web/src/app/admin/admin.css` (modify)                                                         | `/* T051V2 IBJJF */` block                                                                 |
| `qa/scripts/run-member-profile-ui-e2e.mjs` (create), `qa/run-e2e.mjs` (modify)                      | Emulator runner                                                                            |
| `qa/tests/member-profile.spec.ts` (create)                                                          | B+C end-to-end, desktop + 390px, axe, screenshots                                          |
| `tasksv2.md`, `Listav2/Listav2.data.js`, `Listav2/Listav2.js` (modify)                              | T051V2 row                                                                                 |

---

### Task 1: Sanitized skill and level structure from the Regyfit capture

**Files:**

- Create (outside repo, not committed): `/root/regyfit-capture/scripts/extract-ibjjf-skills-structure.mjs`
- Create: `docs/data/ibjjf-skills-observed.sanitized.json` (generated by the script)
- Test: `qa/unit/ibjjf-skills-observed-structure.test.ts`

**Interfaces:**

- Consumes: raw pages `/root/regyfit-capture/raw/member-profile/src-gerir_atleta_160.html` (skill rows
  `data-original-title="<label>" … on_off('<id>','1')`, level `<select id="nivel">` whose options carry
  `value="<levelId>"`, `dados2="minAge*maxAge*minClasses*minDays*skillId+score-…"` and the level
  name as text) and `src-grad-niveis.html` (hierarchy: `class="drop-card row_sub<id> todas_faixas faixa<parentId>"`
  for stripes, `class="drop-card row_sub<id> "` for belts); v1 keys from
  `docs/data/ibjjf-levels-observed.sanitized.json` (`skillCatalog[].displayLabel` → `key`).
- Produces: JSON with exactly this shape (used by Tasks 2, 3 and Plan D):

```ts
type RegyfitLevelStructure = {
  schemaVersion: 1;
  observedAt: "2026-09-17";
  source: {
    system: "Regyfit";
    levelSystem: "JIU-JITSU - IBJJF";
    method: string;
    mutationsPerformed: false;
  };
  skills: {
    regyfitId: string;
    key: string;
    displayLabel: string;
    observedLabel: string | null;
    category: string;
    sequence: number;
  }[]; // 58
  levels: {
    regyfitId: string;
    name: string;
    kind: "belt" | "stripe";
    parentName: string | null;
    sequence: number;
    criteria: {
      minAge: number | null;
      maxAge: number | null;
      minClasses: number | null;
      minDays: number | null;
    };
    skillMinimums: { skillKey: string; minimumRating: number }[];
  }[]; // 177
};
```

- [ ] **Step 1: Write the failing structure test**

Create `qa/unit/ibjjf-skills-observed-structure.test.ts`:

```ts
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const structure = JSON.parse(
  readFileSync(
    new URL("../../docs/data/ibjjf-skills-observed.sanitized.json", import.meta.url),
    "utf8",
  ),
) as {
  skills: {
    regyfitId: string;
    key: string;
    displayLabel: string;
    observedLabel: string | null;
    category: string;
    sequence: number;
  }[];
  levels: {
    regyfitId: string;
    name: string;
    kind: string;
    parentName: string | null;
    sequence: number;
    criteria: Record<string, number | null>;
    skillMinimums: { skillKey: string; minimumRating: number }[];
  }[];
} & Record<string, unknown>;

describe("ibjjf-skills-observed.sanitized.json", () => {
  it("holds only the allowlisted structure keys", () => {
    expect(Object.keys(structure).sort()).toEqual([
      "levels",
      "observedAt",
      "schemaVersion",
      "skills",
      "source",
    ]);
    for (const skill of structure.skills) {
      expect(Object.keys(skill).sort()).toEqual([
        "category",
        "displayLabel",
        "key",
        "observedLabel",
        "regyfitId",
        "sequence",
      ]);
    }
    for (const level of structure.levels) {
      expect(Object.keys(level).sort()).toEqual([
        "criteria",
        "kind",
        "name",
        "parentName",
        "regyfitId",
        "sequence",
        "skillMinimums",
      ]);
      expect(Object.keys(level.criteria).sort()).toEqual([
        "maxAge",
        "minAge",
        "minClasses",
        "minDays",
      ]);
    }
  });

  it("carries no personal data shapes", () => {
    // The only date allowed is the capture date; no e-mail, phone or other date may appear.
    const text = JSON.stringify(structure).replaceAll('"observedAt":"2026-09-17"', "");
    expect(text).not.toMatch(/@|\+44|\d{4}-\d{2}-\d{2}/u);
  });

  it("captures the 58 skills with v1 keys preserved and categories from the label prefix", () => {
    expect(structure.skills).toHaveLength(58);
    expect(new Set(structure.skills.map((skill) => skill.key)).size).toBe(58);
    expect(structure.skills.map((skill) => skill.sequence)).toEqual(
      Array.from({ length: 58 }, (_, i) => i + 1),
    );
    const tie = structure.skills.find((skill) => skill.key === "tie-the-belt");
    expect(tie).toMatchObject({
      displayLabel: "Tie The Belt",
      observedLabel: "1. Tie The Belt",
      category: "Fundamentals",
    });
    expect(
      structure.skills.find((skill) => skill.key === "warm-up-9-hip-shuffles-forward-and-back"),
    ).toMatchObject({
      displayLabel: "Warm Up 9 - Hip Shuffles Forward And Back",
      observedLabel: "Warm Up 9 - Hip Shuffles Foward And Back",
      category: "Warm Up",
    });
    const counts = Object.fromEntries(
      [...new Set(structure.skills.map((skill) => skill.category))].map((category) => [
        category,
        structure.skills.filter((skill) => skill.category === category).length,
      ]),
    );
    expect(counts).toEqual({
      Fundamentals: 6,
      "Dominant Positions": 9,
      Escapes: 1,
      Guard: 5,
      "Guard Passing": 6,
      Submissions: 13,
      Sweeps: 8,
      "Warm Up": 10,
    });
  });

  it("captures 177 levels (27 belts, 150 stripes) with 15 skill minimum sets", () => {
    expect(structure.levels).toHaveLength(177);
    expect(structure.levels.filter((level) => level.kind === "belt")).toHaveLength(27);
    expect(structure.levels.filter((level) => level.kind === "stripe")).toHaveLength(150);
    expect(structure.levels.filter((level) => level.skillMinimums.length > 0)).toHaveLength(15);
    const names = new Set(structure.levels.map((level) => level.name));
    for (const level of structure.levels) {
      if (level.parentName !== null) expect(names.has(level.parentName)).toBe(true);
    }
    const skillKeys = new Set(structure.skills.map((skill) => skill.key));
    for (const level of structure.levels) {
      for (const minimum of level.skillMinimums) expect(skillKeys.has(minimum.skillKey)).toBe(true);
    }
    expect(structure.levels.find((level) => level.name === "WHITE BELT")?.criteria).toEqual({
      minAge: 16,
      maxAge: null,
      minClasses: 20,
      minDays: 60,
    });
    // The captured structure keeps Regyfit's 20/60; the G11 operator override to 25/90 is applied
    // later, by buildIbjjfV2CatalogSources (Task 3), not by the capture.
    expect(structure.levels.find((level) => level.name === "Black - 1st Degree")).toMatchObject({
      kind: "stripe",
      parentName: "BLACK BELT",
      criteria: { minAge: 22, maxAge: null, minClasses: 150, minDays: 1095 },
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `corepack pnpm vitest run --project node qa/unit/ibjjf-skills-observed-structure.test.ts`
Expected: FAIL with `ENOENT` for `ibjjf-skills-observed.sanitized.json`.

- [ ] **Step 3: Write the extraction script (outside the repo)**

Create `/root/regyfit-capture/scripts/extract-ibjjf-skills-structure.mjs`:

```js
// Read-only: parses two saved Regyfit pages and writes ONLY skill and level structure.
// The pages also contain one member's data in the page chrome; nothing outside the regexes below
// is read into memory as data, and nothing is printed except counts.
import { readFileSync, writeFileSync } from "node:fs";

const rawDirectory = "/root/regyfit-capture/raw/member-profile";
const v1Path = "/root/BPT-Jersey/docs/data/ibjjf-levels-observed.sanitized.json";
const outputPath = "/root/BPT-Jersey/docs/data/ibjjf-skills-observed.sanitized.json";

const athletePage = readFileSync(`${rawDirectory}/src-gerir_atleta_160.html`, "utf8");
const levelsPage = readFileSync(`${rawDirectory}/src-grad-niveis.html`, "utf8");
const v1 = JSON.parse(readFileSync(v1Path, "utf8"));

function decode(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&nbsp;", " ")
    .trim();
}

function slug(text) {
  return text
    .toLowerCase()
    .replaceAll("&", "and")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

// Regyfit typos are corrected in displayLabel and kept verbatim in observedLabel.
const labelFixes = [
  [/^\d+\.\s+/u, ""],
  [/^Submissions -guillotine Choke$/u, "Submissions - Guillotine Choke"],
  [/Foward/gu, "Forward"],
];

function skillCategory(label) {
  if (/^Warm Up \d+ - /u.test(label)) return "Warm Up";
  const match = /^(.+?) - /u.exec(label);
  return match ? match[1] : "Fundamentals";
}

const v1KeyByLabel = new Map(v1.skillCatalog.map((skill) => [skill.displayLabel, skill.key]));
const skillPattern =
  /data-original-title="([^"]*)" class="form-control[^>]*>[^<]*<\/div>\s*<div onClick="on_off\('(\d+)','1'\)"/gu;
const skills = [...athletePage.matchAll(skillPattern)].map((match, index) => {
  const observed = decode(match[1]);
  const displayLabel = labelFixes.reduce(
    (label, [pattern, replacement]) => label.replace(pattern, replacement),
    observed,
  );
  return {
    regyfitId: match[2],
    key: v1KeyByLabel.get(displayLabel) ?? slug(displayLabel),
    displayLabel,
    observedLabel: observed === displayLabel ? null : observed,
    category: skillCategory(displayLabel),
    sequence: index + 1,
  };
});
const skillKeyById = new Map(skills.map((skill) => [skill.regyfitId, skill.key]));

const parentById = new Map(
  [
    ...levelsPage.matchAll(/class="drop-card row_sub(\d+)\s*(?:todas_faixas faixa(\d+))?\s*"/gu),
  ].map((match) => [match[1], match[2] ?? null]),
);

const selectStart = athletePage.indexOf('<select id="nivel"');
const selectEnd = athletePage.indexOf("</select>", selectStart);
const options = athletePage.slice(selectStart, selectEnd).split("<option").slice(1);
const rows = options.flatMap((option) => {
  const valueAt = option.indexOf('value="');
  const id = option.slice(valueAt + 7, option.indexOf('"', valueAt + 7));
  if (id === "") return [];
  const name = decode(option.slice(option.indexOf(">", valueAt) + 1).replace("</option>", ""));
  const rule = /dados2="([^"]*)"/u.exec(option)?.[1] ?? "";
  return [{ id, name, rule }];
});
const nameById = new Map(rows.map((row) => [row.id, row.name]));

const whole = (text) => (text === "" ? null : Number.parseInt(text, 10));
const levels = rows.map((row, index) => {
  const [minAge, maxAge, minClasses, minDays, minimums = ""] = row.rule.split("*");
  if (!parentById.has(row.id)) throw new Error("Level hierarchy is missing a level");
  const parentId = parentById.get(row.id);
  return {
    regyfitId: row.id,
    name: row.name,
    kind: parentId === null ? "belt" : "stripe",
    parentName: parentId === null ? null : nameById.get(parentId),
    sequence: index + 1,
    criteria: {
      minAge: whole(minAge),
      maxAge: whole(maxAge),
      minClasses: whole(minClasses),
      minDays: whole(minDays),
    },
    skillMinimums: minimums
      .split("-")
      .filter(Boolean)
      .map((pair) => {
        const [skillId, score] = pair.split("+");
        const skillKey = skillKeyById.get(skillId);
        if (skillKey === undefined) throw new Error("A level minimum names an unknown skill");
        return { skillKey, minimumRating: Number.parseInt(score, 10) };
      }),
  };
});

if (skills.length !== 58 || levels.length !== 177) {
  throw new Error(`Unexpected structure: ${skills.length} skills, ${levels.length} levels`);
}

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      observedAt: "2026-09-17",
      source: {
        system: "Regyfit",
        levelSystem: "JIU-JITSU - IBJJF",
        method: "saved read-only pages: member skill manager and levels list (structure only)",
        mutationsPerformed: false,
      },
      skills,
      levels,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify({ skills: skills.length, levels: levels.length }));
```

- [ ] **Step 4: Run the extraction**

Run: `node /root/regyfit-capture/scripts/extract-ibjjf-skills-structure.mjs`
Expected: exactly `{"skills":58,"levels":177}`. Then
`corepack pnpm exec prettier --write docs/data/ibjjf-skills-observed.sanitized.json`.

- [ ] **Step 5: Run the structure test and watch it pass**

Run: `corepack pnpm vitest run --project node qa/unit/ibjjf-skills-observed-structure.test.ts`
Expected: PASS (4 tests). If the personal-data test fails, do not loosen it: open the JSON, find
the offending value, fix the script, re-run Step 4.

- [ ] **Step 6: Commit**

```bash
git add docs/data/ibjjf-skills-observed.sanitized.json qa/unit/ibjjf-skills-observed-structure.test.ts
git commit -m "feat(levels): sanitized Regyfit skill and level structure, 58 skills / 177 levels (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Criteria diff report BPT vs Regyfit, then operator gate

**Files:**

- Create: `qa/scripts/ibjjf-criteria-diff.mjs`
- Create: `qa/scripts/ibjjf-criteria-diff.d.mts`
- Create (generated): `docs/data/ibjjf-criteria-diff-bpt-vs-regyfit.md`
- Test: `qa/unit/ibjjf-criteria-diff.test.ts`

**Interfaces:**

- Consumes: Task 1 JSON; `docs/data/ibjjf-levels-observed.sanitized.json` (v1 names, keys, skill
  sets); `docs/data/ibjjf-levels-business-criteria.sanitized.json` (v1 criteria by key).
- Produces: `buildCriteriaDiff(input: { v1Observed: unknown; v1Business: unknown; regyfit: unknown }): { markdown: string; counts: { regyfitLevels: number; bptLevels: number; onlyRegyfit: number; onlyBpt: number; criteriaDiffLevels: number; regyfitSkills: number; bptSkills: number; onlyRegyfitSkills: number; skillMinimumDiffLevels: number } }`
  and `minimumDaysOf(time: { years: number; months: number; days: number } | null): number | null`.

- [ ] **Step 1: Write the failing test**

Create `qa/unit/ibjjf-criteria-diff.test.ts`:

```ts
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildCriteriaDiff, minimumDaysOf } from "../scripts/ibjjf-criteria-diff.mjs";

const read = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as unknown;

const tinyV1Observed = {
  skillCatalog: [{ key: "tie-the-belt", displayLabel: "Tie The Belt" }],
  skillRequirementSets: [
    { key: "set-a", requirements: [{ skillKey: "tie-the-belt", minimumRating: 2 }] },
  ],
  levels: [
    { key: "white-belt", name: "WHITE BELT", observedSkillRequirementSetKey: "set-a" },
    { key: "blue-belt", name: "BLUE BELT", observedSkillRequirementSetKey: null },
  ],
};
const tinyV1Business = {
  levels: {
    "white-belt": {
      minAge: 16,
      maxAge: null,
      minClasses: 25,
      minimumTime: { years: 0, months: 2, days: 30 },
    },
    "blue-belt": {
      minAge: 16,
      maxAge: null,
      minClasses: 50,
      minimumTime: { years: 0, months: 5, days: 28 },
    },
  },
};
const tinyRegyfit = {
  skills: [
    { key: "tie-the-belt", displayLabel: "Tie The Belt", category: "Fundamentals" },
    { key: "berimbolo", displayLabel: "Berimbolo", category: "Fundamentals" },
  ],
  levels: [
    {
      name: "WHITE BELT",
      kind: "belt",
      parentName: null,
      criteria: { minAge: 16, maxAge: null, minClasses: 20, minDays: 60 },
      skillMinimums: [{ skillKey: "tie-the-belt", minimumRating: 3 }],
    },
    {
      name: "BLUE BELT",
      kind: "belt",
      parentName: null,
      criteria: { minAge: 16, maxAge: null, minClasses: 50, minDays: 178 },
      skillMinimums: [],
    },
    {
      name: "Black - 1st Degree",
      kind: "stripe",
      parentName: "BLUE BELT",
      criteria: { minAge: 22, maxAge: null, minClasses: 150, minDays: 1095 },
      skillMinimums: [],
    },
  ],
};

describe("IBJJF criteria diff", () => {
  it("converts BPT minimum time with the rule the platform applies today", () => {
    expect(minimumDaysOf({ years: 0, months: 1, days: 14 })).toBe(44);
    expect(minimumDaysOf({ years: 2, months: 11, days: 30 })).toBe(1090);
    expect(minimumDaysOf(null)).toBeNull();
  });

  it("lists new levels, criteria rows and skill minimum rows", () => {
    const { markdown, counts } = buildCriteriaDiff({
      v1Observed: tinyV1Observed,
      v1Business: tinyV1Business,
      regyfit: tinyRegyfit,
    });
    expect(counts).toEqual({
      regyfitLevels: 3,
      bptLevels: 2,
      onlyRegyfit: 1,
      onlyBpt: 0,
      criteriaDiffLevels: 1,
      regyfitSkills: 2,
      bptSkills: 1,
      onlyRegyfitSkills: 1,
      skillMinimumDiffLevels: 1,
    });
    expect(markdown).toContain("| Black - 1st Degree | stripe | BLUE BELT | 22 | — | 150 | 1095 |");
    expect(markdown).toContain("| WHITE BELT | Min classes | 25 | 20 |");
    expect(markdown).toContain("| WHITE BELT | Min days | 90 | 60 |");
    expect(markdown).not.toContain("| BLUE BELT | Min days |");
    expect(markdown).toContain("| WHITE BELT | Tie The Belt | 2 | 3 |");
    expect(markdown).toContain("| Fundamentals | Berimbolo |");
  });

  it("matches the real committed files", () => {
    const { counts } = buildCriteriaDiff({
      v1Observed: read("docs/data/ibjjf-levels-observed.sanitized.json"),
      v1Business: read("docs/data/ibjjf-levels-business-criteria.sanitized.json"),
      regyfit: read("docs/data/ibjjf-skills-observed.sanitized.json"),
    });
    expect(counts).toEqual({
      regyfitLevels: 177,
      bptLevels: 171,
      onlyRegyfit: 6,
      onlyBpt: 0,
      criteriaDiffLevels: 74,
      regyfitSkills: 58,
      bptSkills: 11,
      onlyRegyfitSkills: 47,
      skillMinimumDiffLevels: 0,
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `corepack pnpm vitest run --project node qa/unit/ibjjf-criteria-diff.test.ts`
Expected: FAIL, cannot resolve `../scripts/ibjjf-criteria-diff.mjs`.

- [ ] **Step 3: Implement the builder and CLI**

Create `qa/scripts/ibjjf-criteria-diff.d.mts`:

```ts
export type CriteriaDiffCounts = {
  regyfitLevels: number;
  bptLevels: number;
  onlyRegyfit: number;
  onlyBpt: number;
  criteriaDiffLevels: number;
  regyfitSkills: number;
  bptSkills: number;
  onlyRegyfitSkills: number;
  skillMinimumDiffLevels: number;
};
export function minimumDaysOf(
  time: { years: number; months: number; days: number } | null,
): number | null;
export function buildCriteriaDiff(input: {
  v1Observed: unknown;
  v1Business: unknown;
  regyfit: unknown;
}): {
  markdown: string;
  counts: CriteriaDiffCounts;
};
```

Create `qa/scripts/ibjjf-criteria-diff.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dash = "—";
const show = (value) => (value === null || value === undefined ? dash : String(value));

/** Same conversion as buildStudentProgressSummary (level-contracts.ts:1000-1004). */
export function minimumDaysOf(time) {
  if (time === null || time === undefined) return null;
  return time.years * 365 + time.months * 30 + time.days;
}

export function buildCriteriaDiff({ v1Observed, v1Business, regyfit }) {
  const bptByName = new Map(v1Observed.levels.map((level) => [level.name, level]));
  const regyfitNames = new Set(regyfit.levels.map((level) => level.name));
  const bptSkillLabel = new Map(
    v1Observed.skillCatalog.map((skill) => [skill.key, skill.displayLabel]),
  );
  const regyfitSkillLabel = new Map(regyfit.skills.map((skill) => [skill.key, skill.displayLabel]));
  const sets = new Map(v1Observed.skillRequirementSets.map((set) => [set.key, set.requirements]));

  const onlyRegyfit = regyfit.levels.filter((level) => !bptByName.has(level.name));
  const onlyBpt = v1Observed.levels.filter((level) => !regyfitNames.has(level.name));

  const criteriaRows = [];
  const criteriaLevels = new Set();
  const skillRows = [];
  const skillLevels = new Set();
  for (const level of regyfit.levels) {
    const bpt = bptByName.get(level.name);
    if (bpt === undefined) continue;
    const business = v1Business.levels[bpt.key];
    const pairs = [
      ["Min age", business.minAge, level.criteria.minAge],
      ["Max age", business.maxAge, level.criteria.maxAge],
      ["Min classes", business.minClasses, level.criteria.minClasses],
      ["Min days", minimumDaysOf(business.minimumTime), level.criteria.minDays],
    ];
    for (const [criterion, before, after] of pairs) {
      if ((before ?? null) === (after ?? null)) continue;
      criteriaRows.push(`| ${level.name} | ${criterion} | ${show(before)} | ${show(after)} |`);
      criteriaLevels.add(level.name);
    }
    const bptMinimums = new Map(
      (bpt.observedSkillRequirementSetKey
        ? (sets.get(bpt.observedSkillRequirementSetKey) ?? [])
        : []
      ).map((r) => [r.skillKey, r.minimumRating]),
    );
    const regyfitMinimums = new Map(level.skillMinimums.map((r) => [r.skillKey, r.minimumRating]));
    for (const skillKey of [
      ...new Set([...bptMinimums.keys(), ...regyfitMinimums.keys()]),
    ].sort()) {
      const before = bptMinimums.get(skillKey) ?? null;
      const after = regyfitMinimums.get(skillKey) ?? null;
      if (before === after) continue;
      const label = regyfitSkillLabel.get(skillKey) ?? bptSkillLabel.get(skillKey) ?? skillKey;
      skillRows.push(`| ${level.name} | ${label} | ${show(before)} | ${show(after)} |`);
      skillLevels.add(level.name);
    }
  }
  const onlyRegyfitSkills = regyfit.skills.filter((skill) => !bptSkillLabel.has(skill.key));

  const counts = {
    regyfitLevels: regyfit.levels.length,
    bptLevels: v1Observed.levels.length,
    onlyRegyfit: onlyRegyfit.length,
    onlyBpt: onlyBpt.length,
    criteriaDiffLevels: criteriaLevels.size,
    regyfitSkills: regyfit.skills.length,
    bptSkills: v1Observed.skillCatalog.length,
    onlyRegyfitSkills: onlyRegyfitSkills.length,
    skillMinimumDiffLevels: skillLevels.size,
  };
  const table = (header, rows) =>
    rows.length === 0 ? "None." : [header, header.replace(/[^|]+/gu, " --- "), ...rows].join("\n");
  const markdown = [
    "# IBJJF level criteria: BPT (ibjjf-v1) vs Regyfit (capture 2026-09-17)",
    "",
    "Structure only. Generated by `node qa/scripts/ibjjf-criteria-diff.mjs`; do not edit by hand.",
    "BPT minimum time is shown in days with the rule the platform applies today",
    "(years × 365 + months × 30 + days). Operator ruling G9: the new catalogue version `ibjjf-v2`",
    "takes Regyfit's values. Publication waits for the operator's OK in chat.",
    "",
    "## Summary",
    "",
    `- Levels in Regyfit: ${counts.regyfitLevels}; in BPT: ${counts.bptLevels}.`,
    `- Levels only in Regyfit: ${counts.onlyRegyfit}. Levels only in BPT: ${counts.onlyBpt}.`,
    `- Levels whose criteria differ: ${counts.criteriaDiffLevels}.`,
    `- Skills in Regyfit: ${counts.regyfitSkills}; in BPT: ${counts.bptSkills}; only in Regyfit: ${counts.onlyRegyfitSkills}.`,
    `- Levels whose skill minimums differ: ${counts.skillMinimumDiffLevels}.`,
    "",
    "## Levels only in Regyfit",
    "",
    table(
      "| Level | Kind | Parent | Min age | Max age | Min classes | Min days |",
      onlyRegyfit.map(
        (level) =>
          `| ${level.name} | ${level.kind} | ${show(level.parentName)} | ${show(level.criteria.minAge)} | ${show(level.criteria.maxAge)} | ${show(level.criteria.minClasses)} | ${show(level.criteria.minDays)} |`,
      ),
    ),
    "",
    "## Levels only in BPT",
    "",
    table(
      "| Level |",
      onlyBpt.map((level) => `| ${level.name} |`),
    ),
    "",
    "## Criteria differences",
    "",
    table("| Level | Criterion | BPT | Regyfit |", criteriaRows),
    "",
    "## Skill minimum differences",
    "",
    table("| Level | Skill | BPT | Regyfit |", skillRows),
    "",
    "## Skills only in Regyfit (no level minimum unless listed above)",
    "",
    table(
      "| Category | Skill |",
      onlyRegyfitSkills.map((skill) => `| ${skill.category} | ${skill.displayLabel} |`),
    ),
    "",
  ].join("\n");
  return { markdown, counts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, "../..");
  const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
  const { markdown, counts } = buildCriteriaDiff({
    v1Observed: read("docs/data/ibjjf-levels-observed.sanitized.json"),
    v1Business: read("docs/data/ibjjf-levels-business-criteria.sanitized.json"),
    regyfit: read("docs/data/ibjjf-skills-observed.sanitized.json"),
  });
  writeFileSync(resolve(root, "docs/data/ibjjf-criteria-diff-bpt-vs-regyfit.md"), markdown);
  console.log(JSON.stringify(counts));
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `corepack pnpm vitest run --project node qa/unit/ibjjf-criteria-diff.test.ts`
Expected: PASS (3 tests). If the real-file counts differ, trust the data, re-check the Task 1 JSON,
and only then correct the expectation with the reason in the commit message.

- [ ] **Step 5: Generate the report and commit**

```bash
node qa/scripts/ibjjf-criteria-diff.mjs
corepack pnpm exec prettier --write docs/data/ibjjf-criteria-diff-bpt-vs-regyfit.md
git add qa/scripts/ibjjf-criteria-diff.mjs qa/scripts/ibjjf-criteria-diff.d.mts qa/unit/ibjjf-criteria-diff.test.ts docs/data/ibjjf-criteria-diff-bpt-vs-regyfit.md
git commit -m "docs(levels): BPT vs Regyfit criteria diff report for the ibjjf-v2 catalogue (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected console line: `{"regyfitLevels":177,"bptLevels":171,"onlyRegyfit":6,"onlyBpt":0,"criteriaDiffLevels":74,"regyfitSkills":58,"bptSkills":11,"onlyRegyfitSkills":47,"skillMinimumDiffLevels":0}`.

- [ ] **Step 6: OPERATOR GATE — criteria approval (do not automate)**

Stop and ask the operator in chat, in Spanish, with the summary counts and the path
`docs/data/ibjjf-criteria-diff-bpt-vs-regyfit.md`: "¿Apruebas que `ibjjf-v2` tome estos criterios de
Regyfit (74 niveles cambian, 6 grados de negro nuevos, 47 habilidades nuevas sin mínimo)?".
Record the answer and date in the T051V2 evidence (Task 19). Tasks 3–17 may proceed on the emulator
and in tests either way (they seed v1 in unit tests); if the operator rejects or asks for changes,
amend `docs/data/ibjjf-skills-observed.sanitized.json` via the script, regenerate this report and
re-pin the hashes in Task 4 Step 5 before Task 18.

---

### Task 3: Version-aware catalogue parsing and the `ibjjf-v2` source builder (domain)

**Files:**

- Create: `packages/domain/src/levels/level-catalog-v2.ts`
- Modify: `packages/domain/src/levels/level-contracts.ts:219-527` (parsers) and top-of-file exports
- Test: `packages/domain/src/levels/level-catalog-v2.test.ts`

**Interfaces:**

- Consumes: Task 1 JSON shape.
- Produces:
  - `levelCatalogVersions = ["ibjjf-v1", "ibjjf-v2"] as const`; `type LevelCatalogVersion`.
  - `isLevelCatalogVersion(value: unknown): value is LevelCatalogVersion`.
  - `levelCatalogVersionShapes: Readonly<Record<LevelCatalogVersion, { definitions: number; belts: number; stripes: number; skills: number; requirements: number; displayName: string; precedence: { businessRules: string; hierarchyVisualsAndObservedSkills: string; conflicts: string } }>>`
    (v1 = 171/27/144/11/165, v2 = 177/27/150/58/165).
  - `buildIbjjfV2CatalogSources(v1Observed: unknown, regyfit: unknown): { observed: Record<string, unknown>; business: Record<string, unknown> }` (throws on invalid input).
  - `parseLevelCatalogSource` reads `observed.systemId` (absent ⇒ `"ibjjf-v1"`); issue code
    `unsupported_level_system` for unknown ids; count issue codes become
    `expected_${shape.skills}_skills` etc. (v1 codes unchanged).
  - `parseLevelCatalogProjection` checks counts against `system.systemId`'s shape.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/levels/level-catalog-v2.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import regyfitJson from "../../../../docs/data/ibjjf-skills-observed.sanitized.json";
import { buildIbjjfV2CatalogSources, levelCatalogVersionShapes } from "./level-catalog-v2";
import { parseLevelCatalogProjection, parseLevelCatalogSource } from "./level-contracts";

describe("ibjjf-v2 catalogue sources", () => {
  const sources = buildIbjjfV2CatalogSources(observedJson, regyfitJson);
  const parsed = parseLevelCatalogSource(sources.observed, sources.business);

  it("parses into 177 definitions, 58 skills and 165 requirements", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.system.systemId).toBe("ibjjf-v2");
    expect(parsed.value.system.counts).toEqual({ definitions: 177, belts: 27, stripes: 150 });
    expect(parsed.value.skills).toHaveLength(58);
    expect(parsed.value.requirements).toHaveLength(165);
    expect(parsed.value.system.precedence).toEqual(
      levelCatalogVersionShapes["ibjjf-v2"].precedence,
    );
  });

  it("keeps v1 keys and visuals, takes Regyfit criteria in days", () => {
    if (!parsed.ok) throw new Error("parse failed");
    const white = parsed.value.definitions.find(
      (definition) => definition.definitionKey === "white-belt",
    );
    const v1White = observedJson.levels.find((level) => level.key === "white-belt");
    // G11 operator override: adult WHITE BELT keeps BPT's 25 classes / 90 days, not Regyfit's 20/60.
    expect(white?.criteria).toEqual({
      minAge: 16,
      maxAge: null,
      minClasses: 25,
      minimumTime: { years: 0, months: 0, days: 90 },
    });
    expect(white?.visual).toEqual(v1White?.visual);
    const blue = parsed.value.definitions.find(
      (definition) => definition.definitionKey === "blue-belt",
    );
    expect(blue?.criteria.minClasses).toBe(50);
    const degree = parsed.value.definitions.find(
      (definition) => definition.definitionKey === "black-1st-degree",
    );
    expect(degree).toMatchObject({
      kind: "stripe",
      parentDefinitionKey: "black-belt",
      name: "Black - 1st Degree",
    });
    expect(degree?.visual).toEqual(
      observedJson.levels.find((level) => level.key === "black-belt")?.visual,
    );
    const redAndBlack = parsed.value.definitions.find(
      (definition) => definition.name === "RED AND BLACK BELT",
    );
    expect(redAndBlack?.sequence).toBe(175);
  });

  it("keeps v1 skill keys and minimum ratings, rating 1 for skills with no level minimum", () => {
    if (!parsed.ok) throw new Error("parse failed");
    const bySkill = new Map(parsed.value.skills.map((skill) => [skill.key, skill]));
    expect(bySkill.get("tie-the-belt")?.minimumRating).toBe(2);
    expect(bySkill.get("warm-up-2-bridges")?.minimumRating).toBe(3);
    expect(bySkill.get("berimbolo")?.minimumRating).toBe(1);
    expect(bySkill.get("warm-up-9-hip-shuffles-forward-and-back")?.observedLabel).toBe(
      "Warm Up 9 - Hip Shuffles Foward And Back",
    );
  });

  it("still parses v1 unchanged and rejects an unknown system", () => {
    const v1 = parseLevelCatalogSource(observedJson, businessCriteriaJson);
    expect(v1.ok && v1.value.system.systemId).toBe("ibjjf-v1");
    const unknown = parseLevelCatalogSource(
      { ...observedJson, systemId: "ibjjf-v9" },
      businessCriteriaJson,
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok)
      expect(unknown.error.map((issue) => issue.code)).toContain("unsupported_level_system");
    const prototypeKey = parseLevelCatalogSource(
      { ...observedJson, systemId: "constructor" },
      businessCriteriaJson,
    );
    expect(prototypeKey.ok).toBe(false);
  });

  it("checks v2 counts against the v2 shape", () => {
    const shortSkills = {
      ...sources.observed,
      skillCatalog: (sources.observed.skillCatalog as unknown[]).slice(0, 11),
    };
    const result = parseLevelCatalogSource(shortSkills, sources.business);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.map((issue) => issue.code)).toContain("expected_58_skills");
  });

  it("validates projections against the version of their system", () => {
    if (!parsed.ok) throw new Error("parse failed");
    const projection = { ...parsed.value, sourceHash: "v2-hash" };
    expect(parseLevelCatalogProjection(projection).ok).toBe(true);
    expect(
      parseLevelCatalogProjection({
        ...projection,
        definitions: projection.definitions.slice(0, 171),
      }).ok,
    ).toBe(false);
  });

  it("refuses a Regyfit structure with unexpected keys", () => {
    expect(() =>
      buildIbjjfV2CatalogSources(observedJson, { ...regyfitJson, members: [] }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/levels/level-catalog-v2.test.ts`
Expected: FAIL, cannot resolve `./level-catalog-v2`.

- [ ] **Step 3: Implement `level-catalog-v2.ts`**

Create `packages/domain/src/levels/level-catalog-v2.ts`:

```ts
import { z } from "zod";

export const levelCatalogVersions = Object.freeze(["ibjjf-v1", "ibjjf-v2"] as const);
export type LevelCatalogVersion = (typeof levelCatalogVersions)[number];

export function isLevelCatalogVersion(value: unknown): value is LevelCatalogVersion {
  return typeof value === "string" && (levelCatalogVersions as readonly string[]).includes(value);
}

export type LevelCatalogVersionShape = Readonly<{
  definitions: number;
  belts: number;
  stripes: number;
  skills: number;
  requirements: number;
  displayName: string;
  precedence: Readonly<{
    businessRules: string;
    hierarchyVisualsAndObservedSkills: string;
    conflicts: string;
  }>;
}>;

export const levelCatalogVersionShapes: Readonly<
  Record<LevelCatalogVersion, LevelCatalogVersionShape>
> = Object.freeze({
  "ibjjf-v1": Object.freeze({
    definitions: 171,
    belts: 27,
    stripes: 144,
    skills: 11,
    requirements: 165,
    displayName: "JIU-JITSU - IBJJF",
    precedence: Object.freeze({
      businessRules: "BPTJ FUNCTIONS APP.docx and BPT-memberships.docx",
      hierarchyVisualsAndObservedSkills: "Regyfit",
      conflicts: "DOCX wins; unresolved Regyfit anomalies remain flagged",
    }),
  }),
  "ibjjf-v2": Object.freeze({
    definitions: 177,
    belts: 27,
    stripes: 150,
    skills: 58,
    requirements: 165,
    displayName: "JIU-JITSU - IBJJF",
    precedence: Object.freeze({
      businessRules: "Regyfit capture 2026-09-17 (operator ruling G9)",
      hierarchyVisualsAndObservedSkills: "Regyfit; belt visuals from ibjjf-v1",
      conflicts:
        "Regyfit wins; differences listed in docs/data/ibjjf-criteria-diff-bpt-vs-regyfit.md",
    }),
  }),
});

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const regyfitId = z.string().regex(/^\d{1,9}$/u);
const label = z.string().min(1).max(160);
const nullableCount = z.number().int().min(0).max(100_000).nullable();

const regyfitStructureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  source: z.strictObject({
    system: z.literal("Regyfit"),
    levelSystem: z.literal("JIU-JITSU - IBJJF"),
    method: z.string().min(1).max(200),
    mutationsPerformed: z.literal(false),
  }),
  skills: z.array(
    z.strictObject({
      regyfitId,
      key: identifier,
      displayLabel: label,
      observedLabel: label.nullable(),
      category: z.string().min(1).max(60),
      sequence: z.number().int().min(1),
    }),
  ),
  levels: z.array(
    z.strictObject({
      regyfitId,
      name: label,
      kind: z.enum(["belt", "stripe"]),
      parentName: label.nullable(),
      sequence: z.number().int().min(1),
      criteria: z.strictObject({
        minAge: nullableCount,
        maxAge: nullableCount,
        minClasses: nullableCount,
        minDays: nullableCount,
      }),
      skillMinimums: z.array(
        z.strictObject({ skillKey: identifier, minimumRating: z.number().int().min(1).max(5) }),
      ),
    }),
  ),
});

function levelKeyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * ibjjf-v2 = Regyfit hierarchy, criteria and skills (operator ruling G9) with the v1 keys and belt
 * visuals, so existing records keep their definition keys. Levels new in Regyfit take the visual of
 * their parent belt.
 *
 * Operator override (2026-09-17, G11): adult WHITE BELT keeps BPT's own rule, 25 classes and 90
 * days, instead of Regyfit's 20/60. It is the only genuine rule difference in the diff report; every
 * other difference is the years/months/days rounding. The override lives here, in one table, so the
 * report stays a faithful BPT-vs-Regyfit comparison and the deviation is visible in one place.
 */
const operatorCriteriaOverrides: Readonly<
  Record<string, Readonly<{ minClasses: number; minDays: number }>>
> = {
  "WHITE BELT": { minClasses: 25, minDays: 90 },
};
export function buildIbjjfV2CatalogSources(
  v1Observed: unknown,
  regyfit: unknown,
): Readonly<{ observed: Record<string, unknown>; business: Record<string, unknown> }> {
  const structure = regyfitStructureSchema.parse(regyfit);
  const v1Levels = record(v1Observed)?.levels;
  if (!Array.isArray(v1Levels)) throw new Error("Level catalogue v1 source is invalid");
  const v1ByName = new Map(
    v1Levels.flatMap((level) => {
      const value = record(level);
      return value !== null && typeof value.name === "string" ? [[value.name, value] as const] : [];
    }),
  );
  const keyByName = new Map(
    structure.levels.map((level) => {
      const v1Key = v1ByName.get(level.name)?.key;
      return [
        level.name,
        typeof v1Key === "string" ? v1Key : levelKeyFromName(level.name),
      ] as const;
    }),
  );

  const setKeyBySignature = new Map<string, string>();
  const skillRequirementSets: Record<string, unknown>[] = [];
  const lowestRatingBySkill = new Map<string, number>();
  const levels = structure.levels.map((level) => {
    const parentKey = level.parentName === null ? null : keyByName.get(level.parentName);
    if (parentKey === undefined) throw new Error("Level parent is missing");
    const visual =
      v1ByName.get(level.name)?.visual ??
      (level.parentName === null ? undefined : v1ByName.get(level.parentName)?.visual);
    if (visual === undefined) throw new Error("Level visual is missing");

    let setKey: string | null = null;
    if (level.skillMinimums.length > 0) {
      const signature = JSON.stringify(
        [...level.skillMinimums].sort((left, right) => left.skillKey.localeCompare(right.skillKey)),
      );
      setKey = setKeyBySignature.get(signature) ?? `regyfit-skills-${setKeyBySignature.size + 1}`;
      if (!setKeyBySignature.has(signature)) {
        setKeyBySignature.set(signature, setKey);
        skillRequirementSets.push({ key: setKey, requirements: level.skillMinimums });
      }
      for (const minimum of level.skillMinimums) {
        const lowest = lowestRatingBySkill.get(minimum.skillKey);
        lowestRatingBySkill.set(
          minimum.skillKey,
          lowest === undefined ? minimum.minimumRating : Math.min(lowest, minimum.minimumRating),
        );
      }
    }
    const override = operatorCriteriaOverrides[level.name];
    const minClasses = override?.minClasses ?? level.criteria.minClasses;
    const minDays = override?.minDays ?? level.criteria.minDays;
    const criteria = {
      minAge: level.criteria.minAge,
      maxAge: level.criteria.maxAge,
      minClasses,
      minimumTime: minDays === null ? null : { years: 0, months: 0, days: minDays },
    };
    return {
      key: keyByName.get(level.name)!,
      parentKey,
      kind: level.kind,
      name: level.name,
      sequence: level.sequence,
      stripeNumber: null,
      observedCriteria: criteria,
      visual,
      observedSkillRequirementSetKey: setKey,
      observedSkillRequirementsState: setKey === null ? "none" : "configured",
      anomalyFlags: [],
    };
  });

  // ponytail: a skill with no level minimum gets rating 1; SkillDefinition requires 1..5 and nothing
  // reads SkillDefinition.minimumRating for gating (requirements carry the real minimums).
  const skillCatalog = structure.skills.map((skill) => ({
    key: skill.key,
    displayLabel: skill.displayLabel,
    observedLabel: skill.observedLabel,
    minimumRating: lowestRatingBySkill.get(skill.key) ?? 1,
    sequence: skill.sequence,
  }));

  return Object.freeze({
    observed: {
      schemaVersion: 1,
      systemId: "ibjjf-v2",
      observedAt: structure.observedAt,
      source: structure.source,
      skillRequirementSets,
      skillCatalog,
      levels,
    },
    business: {
      schemaVersion: 1,
      systemId: "ibjjf-v2",
      levels: Object.fromEntries(levels.map((level) => [level.key, level.observedCriteria])),
    },
  });
}
```

- [ ] **Step 4: Make the parsers version-aware**

In `packages/domain/src/levels/level-contracts.ts`:

1. Directly under the existing imports (line 2) add:

```ts
import { isLevelCatalogVersion, levelCatalogVersionShapes } from "./level-catalog-v2";

export * from "./level-catalog-v2";
```

2. In `parseLevelCatalogSource`, right after the two `schemaVersion` checks (after line 237) add:

```ts
const requestedSystemId =
  observedInput.systemId === undefined ? "ibjjf-v1" : observedInput.systemId;
if (!isLevelCatalogVersion(requestedSystemId)) {
  return err([issue(["observed", "systemId"], "unsupported_level_system")]);
}
const shape = levelCatalogVersionShapes[requestedSystemId];
```

3. Replace line 297-299:

```ts
if (parsedSkills.length !== shape.skills) {
  issues.push(issue(["observed", "skillCatalog"], `expected_${shape.skills}_skills`));
}

const systemId = requestedSystemId;
```

4. Replace lines 425-432:

```ts
if (parsedDefinitions.length !== shape.definitions) {
  issues.push(issue(["observed", "levels"], `expected_${shape.definitions}_definitions`));
}

const belts = parsedDefinitions.filter((d) => d.kind === "belt");
const stripes = parsedDefinitions.filter((d) => d.kind === "stripe");
if (belts.length !== shape.belts)
  issues.push(issue(["observed", "levels"], `expected_${shape.belts}_belts`));
if (stripes.length !== shape.stripes) {
  issues.push(issue(["observed", "levels"], `expected_${shape.stripes}_stripes`));
}
```

5. In the `systemRecord` literal (lines 471-484) replace `displayName` and `precedence` with
   `displayName: shape.displayName,` and `precedence: shape.precedence,`.

6. In `parseLevelCatalogProjection` replace lines 499-512 with:

```ts
const systemId = isPlainRecord(system) ? system.systemId : undefined;
if (!isPlainRecord(system) || !isLevelCatalogVersion(systemId)) {
  issues.push(issue(["projection", "system"], "invalid_system"));
  return err(Object.freeze(issues));
}
const shape = levelCatalogVersionShapes[systemId];
if (!Array.isArray(definitions) || definitions.length !== shape.definitions) {
  issues.push(issue(["projection", "definitions"], `expected_${shape.definitions}_definitions`));
}
if (!Array.isArray(skills) || skills.length !== shape.skills) {
  issues.push(issue(["projection", "skills"], `expected_${shape.skills}_skills`));
}
if (!Array.isArray(requirements) || requirements.length !== shape.requirements) {
  issues.push(issue(["projection", "requirements"], `expected_${shape.requirements}_requirements`));
}
```

- [ ] **Step 5: Run the new and existing level contract tests**

Run: `corepack pnpm vitest run --project node packages/domain/src/levels`
Expected: PASS, including every pre-existing test in `level-contracts.test.ts` (v1 issue codes are
unchanged: `expected_11_skills`, `expected_171_definitions`).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/levels/level-catalog-v2.ts packages/domain/src/levels/level-catalog-v2.test.ts packages/domain/src/levels/level-contracts.ts
git commit -m "feat(levels): version-aware catalogue parsing and ibjjf-v2 sources from the Regyfit structure (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Version-aware approval, integrity and seed for `ibjjf-v2` (functions)

**Files:**

- Modify: `apps/functions/src/levels/level-source.ts:14-38`
- Modify: `apps/functions/src/levels/level-catalog-integrity.ts:5-106`
- Modify: `apps/functions/src/levels/level-seed.ts:36-99,188-216`
- Modify: `apps/functions/src/levels/level-service.ts:587-685` (Firestore seed) and `:1664-1750` (in-memory seed)
- Modify: `apps/functions/scripts/level-seed-target.mjs:76-88`, `apps/functions/scripts/seed-levels.mjs:65-73`
- Test: `apps/functions/src/levels/level-seed.test.ts`, `apps/functions/src/levels/level-catalog-integrity.test.ts`, `apps/functions/src/levels/level-source.test.ts`

**Interfaces:**

- Consumes: Task 3 `buildIbjjfV2CatalogSources`, `levelCatalogVersionShapes`, `isLevelCatalogVersion`, `LevelCatalogVersion`.
- Produces:
  - `approvedLevelCatalogSourceHashesBySystem: Readonly<Record<LevelCatalogVersion, { observed: string; businessCriteria: string; combined: string }>>` (v1 entry = the existing `approvedLevelCatalogSourceHashes`, which stays exported).
  - `loadApprovedLevelCatalog(input?: { customObserved?: unknown; customBusiness?: unknown; systemId?: LevelCatalogVersion }): NormalizedLevelCatalog`.
  - `seedLevelCatalog(input: SeedLevelCatalogInput & { systemId?: LevelCatalogVersion })`; `rollbackLevelCatalog` accepts both versions.
  - `levelCatalogSourcePaths.regyfitStructure` path.
  - `LevelCatalogStore.seed` refuses with `LevelStoreError("conflict", "Another level catalogue is already published.")` when a different system exists in the academy.
  - CLI: `seed-levels.mjs --target=emulator --academy-id=<id> --system-id=ibjjf-v2`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/functions/src/levels/level-seed.test.ts` inside the top `describe` (before its closing `});`):

```ts
it("seeds the approved ibjjf-v2 catalogue into an emulator target", async () => {
  const store = createInMemoryLevelStore();
  const result = await seedLevelCatalog({
    target: "emulator",
    academyId: "demo-academy-v2",
    systemId: "ibjjf-v2",
    environment: emulatorEnvironment(),
    store,
  });
  expect(result).toMatchObject({
    systemId: "ibjjf-v2",
    definitionCount: 177,
    beltCount: 27,
    stripeCount: 150,
    skillCount: 58,
    requirementCount: 165,
    idempotent: false,
  });
  const rollback = await rollbackLevelCatalog({
    target: "emulator",
    academyId: "demo-academy-v2",
    systemId: "ibjjf-v2",
    environment: emulatorEnvironment(),
    store,
  });
  expect(rollback.deletedDefinitions).toBe(177);
});

it("refuses a second catalogue version in the same academy", async () => {
  const store = createInMemoryLevelStore();
  await seedLevelCatalog({
    target: "emulator",
    academyId: "demo-academy",
    environment: emulatorEnvironment(),
    store,
  });
  await expect(
    seedLevelCatalog({
      target: "emulator",
      academyId: "demo-academy",
      systemId: "ibjjf-v2",
      environment: emulatorEnvironment(),
      store,
    }),
  ).rejects.toThrow(/Another level catalogue is already published/);
});
```

In the same file, in `it("rejects ambiguous, unsupported, or misleading CLI options", …)` replace the
assertion that `--system-id=ibjjf-v1` without `--rollback` throws with:

```ts
expect(
  parseArguments(["--target=emulator", "--academy-id=demo-academy", "--system-id=ibjjf-v2"]),
).toEqual({ "academy-id": "demo-academy", "system-id": "ibjjf-v2", target: "emulator" });
```

Append to `apps/functions/src/levels/level-catalog-integrity.test.ts` inside its `describe`:

```ts
it("binds the ibjjf-v2 publication to its own counts", () => {
  const v2 = loadApprovedLevelCatalog({ systemId: "ibjjf-v2" });
  const v2Publication = buildLevelCatalogPublication({
    academyId: "demo-academy",
    normalized: v2,
    operationId: "seed-operation-v2",
    publishedAuditEventId: "audit-level-catalog-published-v2",
  });
  expect(v2Publication.manifest).toMatchObject({
    systemId: "ibjjf-v2",
    catalogDocumentCount: 343,
    definitionCount: 177,
    requirementCount: 165,
  });
});
```

and add `import { loadApprovedLevelCatalog } from "./level-seed";` to its imports.

Append to `apps/functions/src/levels/level-source.test.ts` (add imports
`import regyfitJson from "../../../../docs/data/ibjjf-skills-observed.sanitized.json";`,
`import { buildIbjjfV2CatalogSources } from "@bpt-jersey/domain/levels";` and
`approvedLevelCatalogSourceHashesBySystem` from `./level-source`, reusing the file's existing
`observedJson` import):

```ts
describe("approved ibjjf-v2 source hashes", () => {
  it("pins the v2 sources built from the committed files", () => {
    const sources = buildIbjjfV2CatalogSources(observedJson, regyfitJson);
    const normalized = normalizeLevelCatalogSource(sources.observed, sources.business);
    expect({
      observed: normalized.sourceHashes.observed,
      businessCriteria: normalized.sourceHashes.businessCriteria,
      combined: normalized.sourceHash,
    }).toEqual(approvedLevelCatalogSourceHashesBySystem["ibjjf-v2"]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels/level-seed.test.ts apps/functions/src/levels/level-catalog-integrity.test.ts apps/functions/src/levels/level-source.test.ts`
Expected: FAIL (`systemId` not accepted, `approvedLevelCatalogSourceHashesBySystem` undefined).

- [ ] **Step 3: Implement version-aware source approval**

In `apps/functions/src/levels/level-source.ts` replace lines 3 and 30-38:

```ts
import {
  parseLevelCatalogSource,
  type CanonicalLevelCatalog,
  type LevelCatalogVersion,
} from "@bpt-jersey/domain/levels";
```

```ts
export const approvedLevelCatalogSourceHashesBySystem: Readonly<
  Record<
    LevelCatalogVersion,
    Readonly<{ observed: string; businessCriteria: string; combined: string }>
  >
> = Object.freeze({
  "ibjjf-v1": approvedLevelCatalogSourceHashes,
  "ibjjf-v2": Object.freeze({
    observed: "0000000000000000000000000000000000000000000000000000000000000000",
    businessCriteria: "0000000000000000000000000000000000000000000000000000000000000000",
    combined: "0000000000000000000000000000000000000000000000000000000000000000",
  }),
});

export function assertApprovedLevelCatalogSource(normalized: NormalizedLevelCatalog): void {
  const systemId = normalized.system.systemId;
  const approved = Object.hasOwn(approvedLevelCatalogSourceHashesBySystem, systemId)
    ? approvedLevelCatalogSourceHashesBySystem[systemId as LevelCatalogVersion]
    : undefined;
  if (
    approved === undefined ||
    normalized.sourceHash !== approved.combined ||
    normalized.sourceHashes.observed !== approved.observed ||
    normalized.sourceHashes.businessCriteria !== approved.businessCriteria
  ) {
    throw new Error("Level catalog sources do not match the approved hashes.");
  }
}
```

(The all-zero values are replaced with the real hashes in Step 5; they make the pin test fail first.)

- [ ] **Step 4: Implement version-aware integrity, loading, seed guard and CLI**

`apps/functions/src/levels/level-catalog-integrity.ts`:

- Add import `import { levelCatalogVersionShapes, isLevelCatalogVersion } from "@bpt-jersey/domain/levels";`.
- In `LevelCatalogManifest` change the three count fields to `catalogDocumentCount: number; definitionCount: number; requirementCount: number;` (the exported v1 constants stay for existing tests).
- Replace `assertApprovedCatalogShape` (lines 77-88):

```ts
function assertApprovedCatalogShape(normalized: NormalizedLevelCatalog): void {
  const systemId = normalized.system.systemId;
  const shape = isLevelCatalogVersion(systemId) ? levelCatalogVersionShapes[systemId] : undefined;
  if (
    shape === undefined ||
    normalized.definitions.length !== shape.definitions ||
    normalized.requirements.length !== shape.requirements ||
    normalized.definitions.filter((definition) => definition.kind === "belt").length !==
      shape.belts ||
    normalized.definitions.filter((definition) => definition.kind === "stripe").length !==
      shape.stripes ||
    normalized.skills.length !== shape.skills
  ) {
    throw new Error("Level catalog does not match the approved publication shape.");
  }
}
```

- In the manifest literal (lines 156-158) use the normalized counts:

```ts
    catalogDocumentCount: input.normalized.definitions.length + input.normalized.requirements.length + 1,
    definitionCount: input.normalized.definitions.length,
    requirementCount: input.normalized.requirements.length,
```

`apps/functions/src/levels/level-seed.ts`:

- Add imports `import { buildIbjjfV2CatalogSources, isLevelCatalogVersion, type LevelCatalogVersion } from "@bpt-jersey/domain/levels";`.
- Add `systemId?: LevelCatalogVersion;` to `SeedLevelCatalogInput`.
- Add to `levelCatalogSourcePaths`: `regyfitStructure: resolve(repositoryRoot, "docs/data/ibjjf-skills-observed.sanitized.json"),`.
- Replace `loadApprovedLevelCatalog` (lines 89-99):

```ts
export function loadApprovedLevelCatalog(
  input: Readonly<{
    customObserved?: unknown;
    customBusiness?: unknown;
    systemId?: LevelCatalogVersion;
  }> = {},
): NormalizedLevelCatalog {
  const { observed, business } =
    input.systemId === "ibjjf-v2" &&
    input.customObserved === undefined &&
    input.customBusiness === undefined
      ? buildIbjjfV2CatalogSources(
          readApprovedSourceFile(levelCatalogSourcePaths.observed),
          readApprovedSourceFile(levelCatalogSourcePaths.regyfitStructure),
        )
      : loadLevelCatalogSources(input);
  const normalized = normalizeLevelCatalogSource(observed, business);
  // Fail before any store access when the sources are not the exact approved files.
  assertApprovedLevelCatalogSource(normalized);
  return normalized;
}
```

- In `rollbackLevelCatalog` replace lines 207-210:

```ts
if (!isLevelCatalogVersion(input.systemId)) {
  throw new Error("Unsupported level system rollback target.");
}
const normalized = loadApprovedLevelCatalog({ systemId: input.systemId });
```

`apps/functions/src/levels/level-service.ts` Firestore `seed` (inside the transaction at line 622,
add a fifth read and the guard before the existing `if (systemSnapshot.exists || …)`):

```ts
const systemsSnapshot = await transaction.get(
  firestore.collection(`academies/${academyId}/levelSystems`),
);
if (systemsSnapshot.docs.some((document) => document.id !== systemId)) {
  // ponytail: one published catalogue per academy; switching versions is rollback + seed.
  throw new LevelStoreError("conflict", "Another level catalogue is already published.");
}
```

In-memory `seed` (after `const existingManifest = manifests.get(manifestKey);`, line 1675):

```ts
if (
  [...systems.values()].some(
    (system) => system["academyId"] === academyId && system["systemId"] !== systemId,
  )
) {
  throw new LevelStoreError("conflict", "Another level catalogue is already published.");
}
```

`apps/functions/scripts/level-seed-target.mjs` lines 80-88:

```js
if (
  !hasTarget ||
  !hasAcademyId ||
  (isRollback && !hasSystemId) ||
  (hasSystemId && options["system-id"] !== "ibjjf-v1" && options["system-id"] !== "ibjjf-v2")
) {
  throw new Error("Invalid level seed arguments.");
}
```

`apps/functions/scripts/seed-levels.mjs` seed call (lines 65-71) adds `systemId,` after `academyId,`.

- [ ] **Step 5: Pin the v2 hashes**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels/level-source.test.ts`
Expected: FAIL in "pins the v2 sources" showing `Received` with three 64-hex values. Copy the three
received values (not the zeros) into the `"ibjjf-v2"` entry of
`approvedLevelCatalogSourceHashesBySystem`. Re-run: PASS.

- [ ] **Step 6: Run all level function tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels`
Expected: PASS, including every pre-existing test (v1 counts 171/165, 337 documents).

- [ ] **Step 7: Commit**

```bash
git add apps/functions/src/levels/level-source.ts apps/functions/src/levels/level-source.test.ts apps/functions/src/levels/level-catalog-integrity.ts apps/functions/src/levels/level-catalog-integrity.test.ts apps/functions/src/levels/level-seed.ts apps/functions/src/levels/level-seed.test.ts apps/functions/src/levels/level-service.ts apps/functions/scripts/level-seed-target.mjs apps/functions/scripts/seed-levels.mjs
git commit -m "feat(levels): approve, verify and seed the ibjjf-v2 catalogue version; one catalogue per academy (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Single progress formula and level helpers (domain, pure)

**Files:**

- Create: `packages/domain/src/levels/level-progress.ts`
- Modify: `packages/domain/src/levels/level-contracts.ts:642-700` (summary types) and `:937-1085` (`buildStudentProgressSummary`)
- Test: `packages/domain/src/levels/level-progress.test.ts`

**Interfaces:**

- Consumes: `LevelCriteria`, `LevelDefinitionRecord`, `LevelRequirementRecord` (type-only imports from `./level-contracts`).
- Produces (all re-exported through `@bpt-jersey/domain/levels`):
  - `computeLevelProgress(input: { classes: { done: number; min: number | null }; days: { done: number; min: number | null }; skills: readonly { score: number; required: number }[] }): number` — integer 0–100.
  - `type ImportedBaseline = Readonly<{ classes: number; cutoff: string; source: "regyfit-import" }>`.
  - `type ClassesAtLevel = Readonly<{ imported: number; bpt: number; total: number }>`.
  - `countClassesAtLevel(input: { attendedAt: readonly string[]; currentLevelStartedAt: string | null; importedBaseline: ImportedBaseline | null; until?: string }): ClassesAtLevel`.
  - `daysAtLevel(currentLevelStartedAt: string | null, onIso: string): number`.
  - `minimumDaysOf(time: LevelCriteria["minimumTime"]): number | null`.
  - `skillCategory(displayLabel: string): string`.
  - `jerseyDateOf(iso: string): string` (`YYYY-MM-DD` in Europe/Jersey).
  - `isLevelCalendarDate(value: string): boolean`.
  - `listPromotionGaps(input: { definitions: readonly LevelDefinitionRecord[]; requirements: readonly LevelRequirementRecord[]; fromDefinitionKey: string; toDefinitionKey: string; classesDone: number; daysDone: number; skillScores: Readonly<Record<string, number>>; ageYears: number | null }): readonly string[]`.
  - `buildStudentProgressSummary` option `classesAtLevel?: ClassesAtLevel`; summary gains
    `progressPercent: number` and `criteria.classes.imported: number`.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/levels/level-progress.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { buildStudentProgressSummary, parseLevelCatalogSource } from "./level-contracts";
import {
  computeLevelProgress,
  countClassesAtLevel,
  daysAtLevel,
  isLevelCalendarDate,
  jerseyDateOf,
  listPromotionGaps,
  minimumDaysOf,
  skillCategory,
} from "./level-progress";

const catalogResult = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!catalogResult.ok) throw new Error("v1 catalogue must parse");
const catalog = catalogResult.value;

describe("computeLevelProgress", () => {
  it("averages capped criteria and floors to an integer", () => {
    expect(
      computeLevelProgress({
        classes: { done: 6, min: 10 },
        days: { done: 30, min: 30 },
        skills: [],
      }),
    ).toBe(80);
    expect(
      computeLevelProgress({
        classes: { done: 40, min: 10 },
        days: { done: 90, min: 30 },
        skills: [],
      }),
    ).toBe(100);
    expect(
      computeLevelProgress({
        classes: { done: 2, min: 3 },
        days: { done: 0, min: null },
        skills: [],
      }),
    ).toBe(66);
  });

  it("weights skills by their required scores and caps each score", () => {
    expect(
      computeLevelProgress({
        classes: { done: 10, min: 10 },
        days: { done: 30, min: 30 },
        skills: [
          { score: 5, required: 3 },
          { score: 1, required: 3 },
        ],
      }),
    ).toBe(88);
  });

  it("excludes criteria without a minimum and returns 100 when nothing is required", () => {
    expect(
      computeLevelProgress({
        classes: { done: 0, min: 0 },
        days: { done: 0, min: null },
        skills: [],
      }),
    ).toBe(100);
    expect(
      computeLevelProgress({
        classes: { done: 29, min: 100 },
        days: { done: 0, min: null },
        skills: [],
      }),
    ).toBe(29);
  });
});

describe("countClassesAtLevel", () => {
  const attendedAt = [
    "2026-06-30T18:00:00.000Z",
    "2026-08-31T18:00:00.000Z",
    "2026-09-01T06:00:00.000Z",
    "2026-09-05T18:00:00.000Z",
  ];

  it("counts BPT attendance since the level start without a baseline", () => {
    expect(
      countClassesAtLevel({
        attendedAt,
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        importedBaseline: null,
      }),
    ).toEqual({ imported: 0, bpt: 3, total: 3 });
  });

  it("adds the baseline and counts BPT attendance from the cutoff day, once", () => {
    expect(
      countClassesAtLevel({
        attendedAt,
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        importedBaseline: { classes: 9, cutoff: "2026-09-01", source: "regyfit-import" },
      }),
    ).toEqual({ imported: 9, bpt: 2, total: 11 });
  });

  it("stops at an inclusive end day", () => {
    expect(
      countClassesAtLevel({
        attendedAt,
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        importedBaseline: null,
        until: "2026-09-01",
      }),
    ).toEqual({ imported: 0, bpt: 2, total: 2 });
  });
});

describe("dates and categories", () => {
  it("measures whole days at a level", () => {
    expect(daysAtLevel("2026-07-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z")).toBe(71);
    expect(daysAtLevel(null, "2026-09-10T00:00:00.000Z")).toBe(0);
    expect(daysAtLevel("2026-09-11T00:00:00.000Z", "2026-09-10T00:00:00.000Z")).toBe(0);
  });

  it("converts minimum time with the existing rule", () => {
    expect(minimumDaysOf({ years: 0, months: 2, days: 15 })).toBe(75);
    expect(minimumDaysOf(null)).toBeNull();
  });

  it("reads the Jersey calendar day and validates dates", () => {
    expect(jerseyDateOf("2026-09-10T23:30:00.000Z")).toBe("2026-09-11");
    expect(jerseyDateOf("2026-12-10T23:30:00.000Z")).toBe("2026-12-10");
    expect(isLevelCalendarDate("2026-02-28")).toBe(true);
    expect(isLevelCalendarDate("2026-02-30")).toBe(false);
    expect(isLevelCalendarDate("2026-9-1")).toBe(false);
  });

  it("derives skill categories from the label prefix", () => {
    expect(skillCategory("Warm Up 10 - Sprawl Walking Backwards")).toBe("Warm Up");
    expect(skillCategory("Guard Passing - Knee Cut")).toBe("Guard Passing");
    expect(skillCategory("Guard Passing")).toBe("Fundamentals");
    expect(skillCategory("Takedowns & Throws")).toBe("Fundamentals");
  });
});

describe("listPromotionGaps", () => {
  const base = {
    definitions: catalog.definitions,
    requirements: catalog.requirements,
    fromDefinitionKey: "white-belt",
    skillScores: {},
    ageYears: 30,
  };

  it("is empty when the next level is met", () => {
    expect(
      listPromotionGaps({
        ...base,
        toDefinitionKey: "white-1st-stripe",
        classesDone: 25,
        daysDone: 75,
      }),
    ).toEqual([]);
  });

  it("names skipped stripes and unmet criteria in plain text", () => {
    expect(
      listPromotionGaps({
        ...base,
        toDefinitionKey: "white-2nd-stripe",
        classesDone: 11,
        daysDone: 71,
      }),
    ).toEqual(["Skips 1 stripe", "Classes 11/25 not met", "Days 71/75 not met"]);
  });

  it("names skipped belts, unmet skill minimums and the age band", () => {
    expect(
      listPromotionGaps({
        ...base,
        fromDefinitionKey: "white-belt-kids-4-5-and-5-7-yo",
        toDefinitionKey: "white-4-5-and-5-7yo-2nd-stripe",
        classesDone: 4,
        daysDone: 30,
        skillScores: { "tie-the-belt": 2 },
        ageYears: 9,
      }),
    ).toEqual(["Skips 1 stripe", "Skills 1/11 at minimum not met", "Age band not met"]);
    expect(
      listPromotionGaps({ ...base, toDefinitionKey: "blue-belt", classesDone: 50, daysDone: 400 }),
    ).toEqual(["Skips 4 stripes"]);
  });

  it("refuses unknown definitions", () => {
    expect(() =>
      listPromotionGaps({ ...base, toDefinitionKey: "unknown", classesDone: 0, daysDone: 0 }),
    ).toThrow("Level definition is not available");
  });
});

describe("buildStudentProgressSummary with the single formula", () => {
  it("counts the imported baseline and reports progressPercent from computeLevelProgress", () => {
    const summary = buildStudentProgressSummary({
      catalog,
      studentId: "student-1",
      currentDefinitionKey: "white-belt",
      evaluations: [],
      attendedClassesCount: 40,
      classesAtLevel: { imported: 9, bpt: 2, total: 11 },
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      dateOfBirth: "1990-01-01",
      now: "2026-09-10T00:00:00.000Z",
    });
    expect(summary.criteria.classes).toEqual({
      required: 25,
      completed: 11,
      imported: 9,
      met: false,
    });
    expect(summary.criteria.time).toEqual({ requiredDays: 75, elapsedDays: 71, met: false });
    expect(summary.totalAttendedClasses).toBe(40);
    expect(summary.progressPercent).toBe(
      computeLevelProgress({
        classes: { done: 11, min: 25 },
        days: { done: 71, min: 75 },
        skills: [],
      }),
    );
    expect(summary.progressPercent).toBe(69);
  });
});
```

(`blue-belt` sits after `white-1st-stripe`…`white-4th-stripe`, so it skips 4 stripes and no belt;
its skill requirements are empty in v1.)

- [ ] **Step 2: Run it and watch it fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/levels/level-progress.test.ts`
Expected: FAIL, cannot resolve `./level-progress`.

- [ ] **Step 3: Implement `level-progress.ts`**

Create `packages/domain/src/levels/level-progress.ts`:

```ts
import type {
  LevelCriteria,
  LevelDefinitionRecord,
  LevelRequirementRecord,
} from "./level-contracts";

const dayMs = 86_400_000;

export type ImportedBaseline = Readonly<{
  classes: number;
  cutoff: string;
  source: "regyfit-import";
}>;
export type ClassesAtLevel = Readonly<{ imported: number; bpt: number; total: number }>;

/**
 * Spec §6.2: the mean of the capped class ratio, the capped day ratio and, when the level defines
 * skill minimums, Σmin(score, required) / Σrequired. A criterion without a minimum is left out of
 * the mean. The card and Manage call this one function, so they can never disagree.
 */
export function computeLevelProgress(
  input: Readonly<{
    classes: Readonly<{ done: number; min: number | null }>;
    days: Readonly<{ done: number; min: number | null }>;
    skills: readonly Readonly<{ score: number; required: number }>[];
  }>,
): number {
  const ratios: number[] = [];
  for (const { done, min } of [input.classes, input.days]) {
    if (min !== null && min > 0) ratios.push(Math.min(Math.max(done, 0) / min, 1));
  }
  const required = input.skills.reduce((total, skill) => total + skill.required, 0);
  if (required > 0) {
    const achieved = input.skills.reduce(
      (total, skill) => total + Math.min(Math.max(skill.score, 0), skill.required),
      0,
    );
    ratios.push(achieved / required);
  }
  if (ratios.length === 0) return 100;
  const mean = ratios.reduce((total, ratio) => total + ratio, 0) / ratios.length;
  // The epsilon keeps binary rounding (0.29 * 100 = 28.999…) from dropping a whole point.
  return Math.min(100, Math.floor(mean * 100 + 1e-9));
}

/**
 * Grill G10: classes = imported Regyfit baseline + BPT attended/late attendance on or after the
 * level start. With a baseline, BPT attendance counts from the cutoff day (inclusive); the importer
 * guarantees the baseline stops the day before, so nothing is counted twice.
 */
export function countClassesAtLevel(
  input: Readonly<{
    attendedAt: readonly string[];
    currentLevelStartedAt: string | null;
    importedBaseline: ImportedBaseline | null;
    until?: string;
  }>,
): ClassesAtLevel {
  const startMs =
    input.currentLevelStartedAt === null
      ? Number.NEGATIVE_INFINITY
      : Date.parse(input.currentLevelStartedAt);
  const bpt = input.attendedAt.filter((attendedAt) => {
    const attendedMs = Date.parse(attendedAt);
    if (Number.isNaN(attendedMs) || attendedMs < startMs) return false;
    const day = attendedAt.slice(0, 10);
    if (input.importedBaseline !== null && day < input.importedBaseline.cutoff) return false;
    return input.until === undefined || day <= input.until;
  }).length;
  const imported = input.importedBaseline?.classes ?? 0;
  return Object.freeze({ imported, bpt, total: imported + bpt });
}

export function daysAtLevel(currentLevelStartedAt: string | null, onIso: string): number {
  if (currentLevelStartedAt === null) return 0;
  const elapsed = Date.parse(onIso) - Date.parse(currentLevelStartedAt);
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed / dayMs) : 0;
}

/** Same conversion buildStudentProgressSummary has always used. */
export function minimumDaysOf(time: LevelCriteria["minimumTime"]): number | null {
  return time === null ? null : time.years * 365 + time.months * 30 + time.days;
}

export function skillCategory(displayLabel: string): string {
  if (/^Warm Up \d+ - /u.test(displayLabel)) return "Warm Up";
  const prefix = /^(.+?) - /u.exec(displayLabel);
  return prefix?.[1] ?? "Fundamentals";
}

const jerseyDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Jersey",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function jerseyDateOf(iso: string): string {
  return jerseyDay.format(new Date(iso));
}

export function isLevelCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
    number,
  ];
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Grill G7: every reason an assignment is below criteria, in the words the dialog shows. */
export function listPromotionGaps(
  input: Readonly<{
    definitions: readonly LevelDefinitionRecord[];
    requirements: readonly LevelRequirementRecord[];
    fromDefinitionKey: string;
    toDefinitionKey: string;
    classesDone: number;
    daysDone: number;
    skillScores: Readonly<Record<string, number>>;
    ageYears: number | null;
  }>,
): readonly string[] {
  const from = input.definitions.find(
    (definition) => definition.definitionKey === input.fromDefinitionKey,
  );
  const to = input.definitions.find(
    (definition) => definition.definitionKey === input.toDefinitionKey,
  );
  if (from === undefined || to === undefined) throw new Error("Level definition is not available");

  const gaps: string[] = [];
  const skipped = input.definitions.filter(
    (definition) => definition.sequence > from.sequence && definition.sequence < to.sequence,
  );
  const skippedStripes = skipped.filter((definition) => definition.kind === "stripe").length;
  const skippedBelts = skipped.length - skippedStripes;
  if (skippedBelts > 0) gaps.push(`Skips ${plural(skippedBelts, "belt")}`);
  if (skippedStripes > 0) gaps.push(`Skips ${plural(skippedStripes, "stripe")}`);

  const minClasses = to.criteria.minClasses;
  if (minClasses !== null && input.classesDone < minClasses) {
    gaps.push(`Classes ${input.classesDone}/${minClasses} not met`);
  }
  const minDays = minimumDaysOf(to.criteria.minimumTime);
  if (minDays !== null && input.daysDone < minDays)
    gaps.push(`Days ${input.daysDone}/${minDays} not met`);

  const requirements = input.requirements.filter(
    (requirement) => requirement.definitionKey === to.definitionKey,
  );
  const met = requirements.filter(
    (requirement) => (input.skillScores[requirement.skillKey] ?? 0) >= requirement.minimumRating,
  ).length;
  if (met < requirements.length)
    gaps.push(`Skills ${met}/${requirements.length} at minimum not met`);

  const { minAge, maxAge } = to.criteria;
  if (
    (minAge !== null || maxAge !== null) &&
    (input.ageYears === null ||
      (minAge !== null && input.ageYears < minAge) ||
      (maxAge !== null && input.ageYears > maxAge))
  ) {
    gaps.push("Age band not met");
  }
  return Object.freeze(gaps);
}
```

- [ ] **Step 4: Wire the formula into the summary**

In `packages/domain/src/levels/level-contracts.ts`:

1. Under the Task 3 re-export add:

```ts
import { computeLevelProgress, minimumDaysOf, type ClassesAtLevel } from "./level-progress";

export * from "./level-progress";
```

2. In `ProgressCriteriaSummary.classes` (lines 643-647) add `imported: number;` after `completed`.
3. In `InitializedStudentProgressSummary` (line 673) add `progressPercent: number;` after `criteria`.
4. In `buildStudentProgressSummary` options add
   `/** Grill G10: classes at the current level (baseline + BPT). Omitted by legacy callers. */ classesAtLevel?: ClassesAtLevel;`
   and destructure `classesAtLevel,`.
5. Replace lines 997-1004 (classes and required days):

```ts
const requiredClasses = targetDefinition?.criteria.minClasses ?? null;
const completedClasses = classesAtLevel?.total ?? attendedClassesCount;
const classesMet = requiredClasses === null || completedClasses >= requiredClasses;

const requiredDays = minimumDaysOf(targetDefinition?.criteria.minimumTime ?? null);
```

6. In the `criteria.classes` literal use `completed: completedClasses, imported: classesAtLevel?.imported ?? 0,`.
7. In the returned object add, after `criteria,`:

```ts
    progressPercent:
      targetDefinition === null
        ? 100
        : computeLevelProgress({
            classes: { done: completedClasses, min: requiredClasses },
            days: { done: elapsedDays, min: requiredDays },
            skills: skillChecklist.map((item) => ({ score: item.currentScore, required: item.requiredScore })),
          }),
```

- [ ] **Step 5: Run the domain level tests**

Run: `corepack pnpm vitest run --project node packages/domain/src/levels`
Expected: PASS. Pre-existing summary tests keep passing (`completed` still equals
`attendedClassesCount` when `classesAtLevel` is omitted; `toEqual` checks on `criteria.classes`, if
any fail, add `imported: 0` to that expectation only).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/levels/level-progress.ts packages/domain/src/levels/level-progress.test.ts packages/domain/src/levels/level-contracts.ts
git commit -m "feat(levels): single progress formula, classes at level with imported baseline, promotion gaps (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Manage contracts, type widening and the void audit action (domain)

**Files:**

- Create: `packages/domain/src/levels/level-manage-contracts.ts`
- Modify: `packages/domain/src/levels/level-contracts.ts:533-559` (EvaluationRecord), `:1440-1457` (GraduationRecord), `:1539-1581` (open input)
- Modify: `packages/domain/src/audit/audit-event.ts:20-21,150-151,294-295,650-657`
- Modify: `packages/domain/src/contracts.test.ts:195`
- Test: `packages/domain/src/levels/level-manage-contracts.test.ts`

**Interfaces:**

- Consumes: `isLevelCalendarDate` (Task 5).
- Produces:
  - `assignLevelInputSchema`, `AssignLevelInput = { studentId; fromDefinitionKey; toDefinitionKey; promotedOn; note? }`.
  - `assignLevelResultSchema`, `AssignLevelResult = { promotionId; toDefinitionKey; promotedOn; gaps: string[] }`.
  - `voidPromotionInputSchema`, `VoidPromotionInput = { studentId; promotionId; reason }`.
  - `voidPromotionResultSchema`, `VoidPromotionResult = { voidId; voidsPromotionId; restoredDefinitionKey }`.
  - `studentLevelHistoryRequestSchema`; `levelHistoryEntrySchema`; `studentLevelHistorySchema`,
    `StudentLevelHistory = { studentId; currentDefinitionKey: string | null; entries: LevelHistoryEntry[] }`,
    `LevelHistoryEntry = { entryId; kind: "opening" | "promotion"; definitionKey; fromDefinitionKey: string | null; assignedOn; classes: {done,min} | null; days: {done,min} | null; decidedByRole: "headCoach" | "owner" | null; source: "bpt" | "regyfit-import"; note: string | null; gaps: string[]; voided: { reason; voidedByRole: "headCoach" | "owner"; voidedOn } | null }`.
  - `recordSkillRatingsInputSchema`, `RecordSkillRatingsInput = { studentId; definitionKey; ratings: { skillKey; score: 1|2|3|4|5 }[]; evidenceNotes? }`; `recordSkillRatingsResultSchema = { recorded }`.
  - `importedBaselineSchema`.
  - `studentLevelCardSchema`, `StudentLevelCard` (subset of the progress summary the card reads).
  - `studentSkillSummaryResponseSchema` (parses `{ summary }` of `listStudentEvaluations`).
  - Type widening: `EvaluationRecord.sessionId: string | null`, `EvaluationRecord.evaluatorRole: "headCoach" | "coach" | "owner"`,
    `EvaluationRecord.source?: "regyfit-import"`; `GraduationRecord.decidedByRole: "headCoach" | "owner"`;
    `OpenStudentLevelInput.startedOn?: string`.
  - Audit action `"level.promotion.voided"` (target `levelPromotions`, purpose `student-level-promotion`).

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/levels/level-manage-contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseAuditEventDraft } from "../audit/audit-event";
import { parseOpenStudentLevelInput } from "./level-contracts";
import {
  assignLevelInputSchema,
  recordSkillRatingsInputSchema,
  studentLevelCardSchema,
  studentLevelHistorySchema,
  voidPromotionInputSchema,
} from "./level-manage-contracts";

const note = "Promoted after a competition result.";

describe("level manage contracts", () => {
  it("accepts an assignment with an optional 10-500 character note and a real date", () => {
    const base = {
      studentId: "student-1",
      fromDefinitionKey: "white-belt",
      toDefinitionKey: "white-2nd-stripe",
      promotedOn: "2026-09-10",
    };
    expect(assignLevelInputSchema.safeParse(base).success).toBe(true);
    expect(assignLevelInputSchema.safeParse({ ...base, note }).success).toBe(true);
    expect(assignLevelInputSchema.safeParse({ ...base, note: "too short" }).success).toBe(false);
    expect(assignLevelInputSchema.safeParse({ ...base, note: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(assignLevelInputSchema.safeParse({ ...base, promotedOn: "2026-02-30" }).success).toBe(
      false,
    );
    expect(assignLevelInputSchema.safeParse({ ...base, decidedBy: "someone" }).success).toBe(false);
  });

  it("requires a void reason of 10-500 characters", () => {
    const base = {
      studentId: "student-1",
      promotionId: "grad_student-1_white-2nd-stripe_2026-09-10T12:00:00.000Z",
    };
    expect(voidPromotionInputSchema.safeParse({ ...base, reason: note }).success).toBe(true);
    expect(voidPromotionInputSchema.safeParse({ ...base, reason: "wrong" }).success).toBe(false);
    expect(
      voidPromotionInputSchema.safeParse({ ...base, reason: note, restore: true }).success,
    ).toBe(false);
  });

  it("accepts many distinct 1-5 ratings in one call", () => {
    const base = { studentId: "student-1", definitionKey: "white-belt" };
    expect(
      recordSkillRatingsInputSchema.safeParse({
        ...base,
        ratings: [
          { skillKey: "tie-the-belt", score: 3 },
          { skillKey: "warm-up-2-bridges", score: 5 },
        ],
      }).success,
    ).toBe(true);
    expect(recordSkillRatingsInputSchema.safeParse({ ...base, ratings: [] }).success).toBe(false);
    expect(
      recordSkillRatingsInputSchema.safeParse({
        ...base,
        ratings: [{ skillKey: "tie-the-belt", score: 6 }],
      }).success,
    ).toBe(false);
    expect(
      recordSkillRatingsInputSchema.safeParse({
        ...base,
        ratings: [
          { skillKey: "tie-the-belt", score: 3 },
          { skillKey: "tie-the-belt", score: 4 },
        ],
      }).success,
    ).toBe(false);
  });

  it("parses a history with a voided promotion and an imported opening", () => {
    const history = {
      studentId: "student-1",
      currentDefinitionKey: "white-belt",
      entries: [
        {
          entryId: "grad_student-1_white-2nd-stripe_2026-09-10T12:00:00.000Z",
          kind: "promotion",
          definitionKey: "white-2nd-stripe",
          fromDefinitionKey: "white-belt",
          assignedOn: "2026-09-10",
          classes: { done: 11, min: 25 },
          days: { done: 71, min: 75 },
          decidedByRole: "owner",
          source: "bpt",
          note,
          gaps: ["Skips 1 stripe"],
          voided: {
            reason: "Assigned to the wrong member.",
            voidedByRole: "headCoach",
            voidedOn: "2026-09-11",
          },
        },
        {
          entryId: "opening_student-1",
          kind: "opening",
          definitionKey: "white-belt",
          fromDefinitionKey: null,
          assignedOn: "2026-07-01",
          classes: null,
          days: null,
          decidedByRole: null,
          source: "regyfit-import",
          note: null,
          gaps: [],
          voided: null,
        },
      ],
    };
    expect(studentLevelHistorySchema.safeParse(history).success).toBe(true);
    expect(
      studentLevelHistorySchema.safeParse({
        ...history,
        entries: [{ ...history.entries[0], decidedBy: "uid" }],
      }).success,
    ).toBe(false);
  });

  it("reads only the card fields from a progress summary", () => {
    const parsed = studentLevelCardSchema.parse({
      state: "initialized",
      studentId: "student-1",
      currentDefinition: { definitionKey: "white-belt", name: "WHITE BELT" },
      targetDefinition: { definitionKey: "white-1st-stripe" },
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      progressPercent: 69,
      criteria: {
        classes: { required: 25, completed: 11, imported: 9, met: false },
        time: { requiredDays: 75, elapsedDays: 71, met: false },
        skills: { total: 0, completed: 0, met: true, percentage: 100 },
      },
      skillChecklist: [],
      totalHours: 3,
    });
    expect(parsed).not.toHaveProperty("totalHours");
    expect(
      studentLevelCardSchema.safeParse({ state: "uninitialized", studentId: "student-1" }).success,
    ).toBe(true);
  });

  it("accepts an optional real startedOn when opening a level", () => {
    const base = {
      studentId: "student-1",
      definitionKey: "white-1st-stripe",
      decisionNotes: "Holds this stripe already.",
    };
    expect(parseOpenStudentLevelInput({ ...base, startedOn: "2026-07-01" }).ok).toBe(true);
    expect(parseOpenStudentLevelInput(base).ok).toBe(true);
    expect(parseOpenStudentLevelInput({ ...base, startedOn: "01/07/2026" }).ok).toBe(false);
  });

  it("accepts the void audit only against levelPromotions with the promotion purpose", () => {
    const draft = {
      academyId: "academy-1",
      actorId: "owner-1",
      action: "level.promotion.voided",
      targetRef: "academies/academy-1/levelPromotions/void_grad_student-1",
      purpose: "student-level-promotion",
      correlationId: `level-write-${"b".repeat(64)}`,
    };
    expect(parseAuditEventDraft(draft).ok).toBe(true);
    expect(parseAuditEventDraft({ ...draft, purpose: "student-level-opening" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/levels/level-manage-contracts.test.ts`
Expected: FAIL, cannot resolve `./level-manage-contracts`.

- [ ] **Step 3: Implement the contracts**

Create `packages/domain/src/levels/level-manage-contracts.ts`:

```ts
import { z } from "zod";

import { isLevelCalendarDate } from "./level-progress";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
// Promotion ids embed the student id, the level key and an ISO instant, so they outgrow 128.
const recordIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,383}$/u);
const dateOnlySchema = z.string().refine(isLevelCalendarDate);
const countSchema = z.number().int().min(0).max(1_000_000);
const decisionRoleSchema = z.enum(["headCoach", "owner"]);
const noteSchema = z.string().trim().min(10).max(500);
const gapsSchema = z.array(z.string().min(1).max(120)).max(10);
const scoreSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export const importedBaselineSchema = z.strictObject({
  classes: countSchema,
  cutoff: dateOnlySchema,
  source: z.literal("regyfit-import"),
});

export const assignLevelInputSchema = z.strictObject({
  studentId: identifierSchema,
  fromDefinitionKey: identifierSchema,
  toDefinitionKey: identifierSchema,
  promotedOn: dateOnlySchema,
  note: noteSchema.optional(),
});
export type AssignLevelInput = z.infer<typeof assignLevelInputSchema>;

export const assignLevelResultSchema = z.strictObject({
  promotionId: recordIdSchema,
  toDefinitionKey: identifierSchema,
  promotedOn: dateOnlySchema,
  gaps: gapsSchema,
});
export type AssignLevelResult = z.infer<typeof assignLevelResultSchema>;

export const voidPromotionInputSchema = z.strictObject({
  studentId: identifierSchema,
  promotionId: recordIdSchema,
  reason: noteSchema,
});
export type VoidPromotionInput = z.infer<typeof voidPromotionInputSchema>;

export const voidPromotionResultSchema = z.strictObject({
  voidId: recordIdSchema,
  voidsPromotionId: recordIdSchema,
  restoredDefinitionKey: identifierSchema,
});
export type VoidPromotionResult = z.infer<typeof voidPromotionResultSchema>;

export const studentLevelHistoryRequestSchema = z.strictObject({ studentId: identifierSchema });

const criterionAtAssignmentSchema = z.strictObject({
  done: countSchema,
  min: countSchema.nullable(),
});

export const levelHistoryEntrySchema = z.strictObject({
  entryId: recordIdSchema,
  kind: z.enum(["opening", "promotion"]),
  definitionKey: identifierSchema,
  fromDefinitionKey: identifierSchema.nullable(),
  assignedOn: dateOnlySchema,
  classes: criterionAtAssignmentSchema.nullable(),
  days: criterionAtAssignmentSchema.nullable(),
  decidedByRole: decisionRoleSchema.nullable(),
  source: z.enum(["bpt", "regyfit-import"]),
  note: z.string().max(1000).nullable(),
  gaps: gapsSchema,
  voided: z
    .strictObject({
      reason: noteSchema,
      voidedByRole: decisionRoleSchema,
      voidedOn: dateOnlySchema,
    })
    .nullable(),
});
export type LevelHistoryEntry = z.infer<typeof levelHistoryEntrySchema>;

export const studentLevelHistorySchema = z.strictObject({
  studentId: identifierSchema,
  currentDefinitionKey: identifierSchema.nullable(),
  entries: z.array(levelHistoryEntrySchema).max(400),
});
export type StudentLevelHistory = z.infer<typeof studentLevelHistorySchema>;

export const recordSkillRatingsInputSchema = z.strictObject({
  studentId: identifierSchema,
  definitionKey: identifierSchema,
  ratings: z
    .array(z.strictObject({ skillKey: identifierSchema, score: scoreSchema }))
    .min(1)
    .max(100)
    .refine((ratings) => new Set(ratings.map((rating) => rating.skillKey)).size === ratings.length),
  evidenceNotes: z.string().trim().max(1000).optional(),
});
export type RecordSkillRatingsInput = z.infer<typeof recordSkillRatingsInputSchema>;

export const recordSkillRatingsResultSchema = z.strictObject({
  recorded: z.number().int().min(1).max(100),
});
export type RecordSkillRatingsResult = z.infer<typeof recordSkillRatingsResultSchema>;

/** The part of getStudentProgressSummary the IBJJF card reads; unknown keys are dropped. */
export const studentLevelCardSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("uninitialized"), studentId: identifierSchema }),
  z.object({
    state: z.literal("initialized"),
    studentId: identifierSchema,
    currentDefinition: z.object({ definitionKey: identifierSchema }),
    targetDefinition: z.object({ definitionKey: identifierSchema }).nullable(),
    currentLevelStartedAt: z.string().nullable(),
    progressPercent: z.number().int().min(0).max(100),
    criteria: z.object({
      classes: z.object({
        required: countSchema.nullable(),
        completed: countSchema,
        imported: countSchema,
        met: z.boolean(),
      }),
      time: z.object({
        requiredDays: countSchema.nullable(),
        elapsedDays: countSchema,
        met: z.boolean(),
      }),
    }),
  }),
]);
export type StudentLevelCard = z.infer<typeof studentLevelCardSchema>;

export const studentSkillSummaryResponseSchema = z.object({
  summary: z.record(
    identifierSchema,
    z.object({
      count: countSchema,
      maxScore: scoreSchema,
      latestScore: scoreSchema,
      lastEvaluatedAt: z.string(),
    }),
  ),
});
```

- [ ] **Step 4: Widen the existing level types and the open parser**

In `packages/domain/src/levels/level-contracts.ts`:

1. Add `export * from "./level-manage-contracts";` next to the other re-exports.
2. `EvaluationRecord` (lines 533-550): `sessionId: string | null;`,
   `evaluatorRole: "headCoach" | "coach" | "owner";` and add `source?: "regyfit-import";`.
3. `GraduationRecord.decidedByRole` (line 1448): `"headCoach" | "owner";`.
4. `OpenStudentLevelInput` (lines 1539-1543): add `startedOn?: string;`.
5. In `parseOpenStudentLevelInput`: allowed set becomes
   `new Set(["studentId", "definitionKey", "decisionNotes", "startedOn"])`; after the notes check add

```ts
const startedOn = record["startedOn"];
if (startedOn !== undefined && (typeof startedOn !== "string" || !isLevelCalendarDate(startedOn))) {
  issues.push(issue(["input", "startedOn"], "invalid_started_on_date"));
}
```

and in the returned object add `...(startedOn === undefined ? {} : { startedOn: startedOn as string }),`.
Add `isLevelCalendarDate` to the `./level-progress` import line.

- [ ] **Step 5: Add the audit action**

In `packages/domain/src/audit/audit-event.ts`:

- `auditActions` (after `"level.opened",` at line 21): add `"level.promotion.voided",`.
- The union at lines 146-151: add `| "level.promotion.voided"` after `| "level.opened"`.
- `fieldsByAction` (after `"level.opened": commonFields,` line 295): add `"level.promotion.voided": commonFields,`.
- The level-write branch condition (lines 650-656): add `parsedAction === "level.promotion.voided" ||`
  (it falls through to `levelPromotions` / `student-level-promotion`).

In `packages/domain/src/contracts.test.ts` after `"level.opened",` (line 195) add
`"level.promotion.voided",`.

In `apps/functions/src/levels/canonical-level-security.test.ts` add to the `cases` array (line 318):
`["level.promotion.voided", "levelPromotions", "student-level-promotion"],`.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run --project node packages/domain/src/levels packages/domain/src/contracts.test.ts packages/domain/src/audit apps/functions/src/levels/canonical-level-security.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck the workspace**

Run (with Lista/Listav2 materialised, see Global Constraints): `corepack pnpm typecheck`
Expected: exit 0. If a consumer of `EvaluationRecord.sessionId` or `GraduationRecord.decidedByRole`
fails, fix that consumer with the narrowest change (`?? ""` for display, never a cast).

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/levels/level-manage-contracts.ts packages/domain/src/levels/level-manage-contracts.test.ts packages/domain/src/levels/level-contracts.ts packages/domain/src/audit/audit-event.ts packages/domain/src/contracts.test.ts apps/functions/src/levels/canonical-level-security.test.ts
git commit -m "feat(levels): assign, void, history and ratings contracts; level.promotion.voided audit action (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Progress summary counts classes at the level; promotions drop the baseline

**Files:**

- Modify: `apps/functions/src/levels/level-service.ts:1-37` (imports), `:174-189` (head type), `:990-1085` (summary), `:1305-1405` (approvePromotion)
- Create: `apps/functions/src/levels/level-manage-service.test.ts`

**Interfaces:**

- Consumes: `countClassesAtLevel`, `importedBaselineSchema`, `ImportedBaseline` (Tasks 5–6).
- Produces:
  - Module-private helpers in `level-service.ts`: `storedImportedBaseline(value: unknown): ImportedBaseline | null`
    and `countedAttendance(snapshot: GenericQuerySnapshot, academyId: string, studentId: string): readonly Record<string, unknown>[]` (used again by Task 9).
  - `StudentLevelHead` optional fields `openedDefinitionKey`, `openedOn`, `openedByRole`, `source`, `importedBaseline`; `openedByStaffId: string | null`.
  - Test helpers in `level-manage-service.test.ts` reused by Tasks 8–11 (same file):
    `fakeFirestore(records)`, `seededStore()`, `head(overrides)`, `attendance(id, occurredAt)`,
    constants `academyId = "academy-1"`, `decidedAt = "2026-09-10T12:00:00.000Z"`,
    `baseline = { classes: 9, cutoff: "2026-09-01", source: "regyfit-import" }`.

- [ ] **Step 1: Write the failing test file with its helpers**

Create `apps/functions/src/levels/level-manage-service.test.ts`:

```ts
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { computeLevelProgress } from "@bpt-jersey/domain/levels";
import { createLevelCatalogStore } from "./level-service";
import { normalizeLevelCatalogSource } from "./level-source";

const academyId = "academy-1";
const decidedAt = "2026-09-10T12:00:00.000Z";
const created = "2026-06-01T00:00:00.000Z";
const baseline = { classes: 9, cutoff: "2026-09-01", source: "regyfit-import" } as const;
const normalized = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);

type Stored = Map<string, Record<string, unknown>>;
type Ref = { kind: "doc" | "collection"; path: string };

/** In-memory Firestore with transactional reads before buffered writes. */
function fakeFirestore(records: Stored) {
  const writes: { op: "create" | "set"; path: string; data: Record<string, unknown> }[] = [];
  const snapshotOf = (path: string) => ({
    id: path.split("/").at(-1) ?? "",
    exists: records.has(path),
    data: () => records.get(path),
  });
  const docRef = (path: string) => ({
    kind: "doc" as const,
    id: path.split("/").at(-1) ?? "",
    path,
    get: async () => snapshotOf(path),
    set: async (data: Record<string, unknown>) => void records.set(path, data),
    delete: async () => void records.delete(path),
  });
  const children = (path: string) =>
    [...records.entries()]
      .filter(
        ([candidate]) =>
          candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes("/"),
      )
      .map(([candidate, data]) => ({
        id: candidate.split("/").at(-1) ?? "",
        data: () => data,
        ref: docRef(candidate),
      }));
  const firestore = {
    doc: docRef,
    collection: (path: string) => ({
      kind: "collection" as const,
      path,
      get: async () => ({ docs: children(path) }),
    }),
    batch: () => {
      throw new Error("level writes must use a transaction");
    },
    runTransaction: async <T>(update: (transaction: unknown) => Promise<T>): Promise<T> => {
      const pending: (() => void)[] = [];
      const result = await update({
        get: async (ref: Ref) =>
          ref.kind === "collection" ? { docs: children(ref.path) } : snapshotOf(ref.path),
        create: (ref: Ref, data: Record<string, unknown>) => {
          if (records.has(ref.path)) throw new Error(`create collision ${ref.path}`);
          pending.push(() => {
            records.set(ref.path, data);
            writes.push({ op: "create", path: ref.path, data });
          });
        },
        set: (ref: Ref, data: Record<string, unknown>) => {
          pending.push(() => {
            records.set(ref.path, data);
            writes.push({ op: "set", path: ref.path, data });
          });
        },
        delete: (ref: Ref) => pending.push(() => void records.delete(ref.path)),
      });
      for (const apply of pending) apply();
      return result;
    },
  };
  return { firestore, writes, records };
}

function head(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    academyId,
    studentId: "student-1",
    systemId: "ibjjf-v1",
    currentDefinitionKey: "white-belt",
    currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
    lastApprovedPromotionId: null,
    openedByStaffId: "staff-head-1",
    openingNotes: "Synthetic opening note.",
    openedDefinitionKey: "white-belt",
    openedOn: "2026-07-01",
    openedByRole: "headCoach",
    state: "initialized",
    schemaVersion: "1",
    createdAt: created,
    createdBy: "head-user-1",
    updatedAt: created,
    updatedBy: "head-user-1",
    ...overrides,
  };
}

function attendance(id: string, occurredAt: string): [string, Record<string, unknown>] {
  return [
    `academies/${academyId}/attendance/${id}`,
    {
      attendanceId: id,
      academyId,
      studentId: "student-1",
      sessionId: "session-1",
      state: "attended",
      correctionOf: null,
      occurredAt,
    },
  ];
}

async function seededStore(extra: [string, Record<string, unknown>][] = []) {
  const records: Stored = new Map<string, Record<string, unknown>>([
    [
      `academies/${academyId}/users/head-user-1`,
      { userId: "head-user-1", academyId, accountType: "staff", active: true, status: "active" },
    ],
    [
      `academies/${academyId}/staff/staff-head-1`,
      {
        staffId: "staff-head-1",
        academyId,
        userId: "head-user-1",
        role: "headCoach",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: created,
        createdBy: "owner-user-1",
        updatedAt: created,
        updatedBy: "owner-user-1",
      },
    ],
    [
      `academies/${academyId}/users/coach-user-1`,
      { userId: "coach-user-1", academyId, accountType: "staff", active: true, status: "active" },
    ],
    [
      `academies/${academyId}/staff/staff-coach-1`,
      {
        staffId: "staff-coach-1",
        academyId,
        userId: "coach-user-1",
        role: "coach",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: created,
        createdBy: "owner-user-1",
        updatedAt: created,
        updatedBy: "owner-user-1",
      },
    ],
    [
      `academies/${academyId}/users/owner-user-1`,
      {
        userId: "owner-user-1",
        academyId,
        accountType: "staff",
        displayName: "Synthetic Owner",
        email: "owner@example.test",
        authProvider: "google",
        active: true,
        adminRole: "owner",
        lastRoleChangeAuditId: "audit-owner-1",
        createdAt: Timestamp.fromMillis(0),
        createdBy: "system",
        updatedAt: Timestamp.fromMillis(0),
        updatedBy: "system",
        status: "active",
        schemaVersion: 1,
      },
    ],
    [
      `academies/${academyId}/students/student-1`,
      {
        studentId: "student-1",
        academyId,
        fullName: "Synthetic Adult",
        dateOfBirth: "1990-01-01",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        participantType: "adult",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: created,
        createdBy: "owner-user-1",
        updatedAt: created,
        updatedBy: "owner-user-1",
      },
    ],
    [
      `academies/${academyId}/sessions/session-1`,
      {
        sessionId: "session-1",
        academyId,
        startAt: "2026-09-01T18:00:00.000Z",
        endAt: "2026-09-01T19:00:00.000Z",
      },
    ],
    ...extra,
  ]);
  const fake = fakeFirestore(records);
  const store = createLevelCatalogStore({ firestore: fake.firestore as never });
  await store.seed({ academyId, normalized });
  fake.writes.length = 0;
  return { store, ...fake };
}

const baselineAttendance = [
  attendance("att-1", "2026-08-20T18:00:00.000Z"),
  attendance("att-2", "2026-09-01T18:00:00.000Z"),
  attendance("att-3", "2026-09-05T18:00:00.000Z"),
];

describe("progress summary at the current level (T051V2)", () => {
  it("adds the imported baseline to BPT attendance from the cutoff and reports progressPercent", async () => {
    const { store } = await seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({ importedBaseline: baseline }),
      ],
      ...baselineAttendance,
    ]);
    const progress = await store.getStudentProgressSummary(academyId, "student-1");
    if (progress.state !== "initialized") throw new Error("expected an initialized head");
    expect(progress.criteria.classes).toEqual({
      required: 25,
      completed: 11,
      imported: 9,
      met: false,
    });
    expect(progress.totalAttendedClasses).toBe(3);
    expect(progress.progressPercent).toBe(
      computeLevelProgress({
        classes: { done: 11, min: 25 },
        days: { done: progress.criteria.time.elapsedDays, min: 75 },
        skills: [],
      }),
    );
  });

  it("counts attendance since the level start when there is no baseline", async () => {
    const { store } = await seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({ currentLevelStartedAt: "2026-08-25T00:00:00.000Z" }),
      ],
      ...baselineAttendance,
    ]);
    const progress = await store.getStudentProgressSummary(academyId, "student-1");
    if (progress.state !== "initialized") throw new Error("expected an initialized head");
    expect(progress.criteria.classes).toMatchObject({ completed: 2, imported: 0 });
  });

  it("fails closed on a malformed baseline", async () => {
    const { store } = await seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({ importedBaseline: { classes: -1, cutoff: "yesterday" } }),
      ],
    ]);
    await expect(store.getStudentProgressSummary(academyId, "student-1")).rejects.toMatchObject({
      code: "tenant",
    });
  });

  it("drops the baseline on approvePromotion and keeps it in the restore snapshot", async () => {
    const { store, records } = await seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({ importedBaseline: baseline }),
      ],
    ]);
    const graduation = await store.approvePromotion({
      academyId,
      input: {
        studentId: "student-1",
        fromDefinitionKey: "white-belt",
        toDefinitionKey: "white-1st-stripe",
        decisionNotes: "Met in person.",
      },
      decidedBy: "head-user-1",
      decidedByStaffId: "staff-head-1",
      decidedByRole: "headCoach",
      decidedAt,
    });
    const stored = records.get(`academies/${academyId}/studentLevelProgress/student-1`)!;
    expect(stored.currentDefinitionKey).toBe("white-1st-stripe");
    expect(stored).not.toHaveProperty("importedBaseline");
    expect(
      records.get(`academies/${academyId}/levelPromotions/${graduation.graduationId}`)?.restore,
    ).toEqual({
      currentDefinitionKey: "white-belt",
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      lastApprovedPromotionId: null,
      importedBaseline: baseline,
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels/level-manage-service.test.ts`
Expected: FAIL — `completed` is 3 (all attendance, no baseline), `imported` undefined, restore missing.

- [ ] **Step 3: Implement the summary and approvePromotion changes**

In `apps/functions/src/levels/level-service.ts`:

1. Extend the domain import (lines 3-25) with `countClassesAtLevel, importedBaselineSchema, type ImportedBaseline,`.
2. Replace `StudentLevelHead` (lines 174-189):

```ts
export type StudentLevelHead = Readonly<{
  academyId: string;
  studentId: string;
  systemId: string;
  currentDefinitionKey: string;
  currentLevelStartedAt: string;
  lastApprovedPromotionId: string | null;
  openedByStaffId: string | null;
  openingNotes: string;
  openedDefinitionKey?: string;
  openedOn?: string;
  openedByRole?: "headCoach" | "owner" | null;
  source?: "regyfit-import";
  importedBaseline?: ImportedBaseline;
  state: "initialized";
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;
```

3. After `withinLimit` (line 521) add:

```ts
function storedImportedBaseline(value: unknown): ImportedBaseline | null {
  if (value === undefined) return null;
  const parsed = importedBaselineSchema.safeParse(value);
  if (!parsed.success) throw new LevelStoreError("tenant", "Imported baseline is invalid");
  return parsed.data;
}

/** The student's attended/late, uncorrected attendance; every record must carry a real time. */
function countedAttendance(
  snapshot: GenericQuerySnapshot,
  academyId: string,
  studentId: string,
): readonly Record<string, unknown>[] {
  return withinLimit(snapshot, "Attendance").docs.flatMap((document) => {
    const value = document.data();
    if (
      value.academyId !== academyId ||
      value.attendanceId !== document.id ||
      typeof value.studentId !== "string" ||
      typeof value.sessionId !== "string"
    ) {
      throw new LevelStoreError("tenant", "Attendance scope is invalid");
    }
    if (
      value.studentId !== studentId ||
      value.correctionOf !== null ||
      (value.state !== "attended" && value.state !== "late")
    ) {
      return [];
    }
    if (typeof value.occurredAt !== "string" || Number.isNaN(Date.parse(value.occurredAt))) {
      throw new LevelStoreError("conflict", "Attendance time is invalid");
    }
    return [value];
  });
}
```

4. In `getStudentProgressSummary` replace the attendance block (lines 1027-1045) with
   `const attendance = countedAttendance(attendanceSnapshot, academyId, studentId);`
   and in the final `buildStudentProgressSummary({...})` call add:

```ts
        classesAtLevel: countClassesAtLevel({
          attendedAt: attendance.map((record) => record.occurredAt as string),
          currentLevelStartedAt: (headData.currentLevelStartedAt as string | null) ?? null,
          importedBaseline: storedImportedBaseline(headData.importedBaseline),
        }),
```

(`ponytail:` note above the collection reads: `// ponytail: reads the whole attendance and sessions collections under the existing 400-record ceiling (withinLimit); a per-student query on the existing (studentId, occurredAt) index replaces it when an academy passes 400 records.`)

5. In `approvePromotion` replace the `transaction.create(promotionRef, …)` and `transaction.set(headRef, …)` calls (lines 1380-1401):

```ts
transaction.create(promotionRef, {
  ...record,
  promotionId: graduationId,
  systemId: headData.systemId,
  decisionStatus: "approved",
  proposedBy: decidedByStaffId,
  decidedByStaffId,
  restore: {
    currentDefinitionKey: headData.currentDefinitionKey,
    currentLevelStartedAt: headData.currentLevelStartedAt ?? null,
    lastApprovedPromotionId: headData.lastApprovedPromotionId ?? null,
    importedBaseline: storedImportedBaseline(headData.importedBaseline),
  },
});
const nextHead: Record<string, unknown> = {
  ...headData,
  studentId: input.studentId,
  academyId,
  currentDefinitionKey: input.toDefinitionKey,
  currentLevelStartedAt: now,
  lastApprovedPromotionId: graduationId,
  state: "initialized",
  schemaVersion: "1",
  updatedAt: now,
  updatedBy: decidedBy,
};
// Grill G10: the imported baseline belongs to the level it was imported at.
delete nextHead.importedBaseline;
transaction.set(headRef, nextHead);
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels`
Expected: PASS (new file 4 tests; existing level tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/levels/level-service.ts apps/functions/src/levels/level-manage-service.test.ts
git commit -m "feat(levels): classes since level start plus imported baseline in the progress summary (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Open a level at any definition with a start date (head coach or owner)

**Files:**

- Modify: `apps/functions/src/levels/level-service.ts:140-147` (store type), `:1407-1480` (Firestore), `:2072-2108` (in-memory)
- Modify: `apps/functions/src/levels/canonical-level-security.test.ts:513-647`, `apps/functions/src/levels/level-service.test.ts:280-357`
- Test: `apps/functions/src/levels/level-manage-service.test.ts`

**Interfaces:**

- Consumes: Task 7 test helpers; `jerseyDateOf` (Task 5); `OpenStudentLevelInput.startedOn` (Task 6).
- Produces: `LevelCatalogStore.openStudentLevel(params: { academyId; input: OpenStudentLevelInput; openedBy: string; openedByStaffId: string | null; openedByRole: "headCoach" | "owner"; openedAt?: string }): Promise<OpenedStudentLevel>`;
  head carries `openedDefinitionKey`, `openedOn`, `openedByRole`; stripes may be opened.

- [ ] **Step 1: Write the failing tests**

Append to `apps/functions/src/levels/level-manage-service.test.ts`:

```ts
describe("openStudentLevel at any definition (T051V2)", () => {
  const open = (overrides: Record<string, unknown> = {}) => ({
    academyId,
    input: {
      studentId: "student-1",
      definitionKey: "white-2nd-stripe",
      decisionNotes: "Holds this stripe from Regyfit.",
      startedOn: "2026-07-01",
    },
    openedBy: "owner-user-1",
    openedByStaffId: null,
    openedByRole: "owner" as const,
    openedAt: decidedAt,
    ...overrides,
  });

  it("lets the owner open a stripe at a past start date, audited", async () => {
    const { store, writes } = await seededStore();
    const { head: opened } = await store.openStudentLevel(open());
    expect(opened).toMatchObject({
      currentDefinitionKey: "white-2nd-stripe",
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      openedDefinitionKey: "white-2nd-stripe",
      openedOn: "2026-07-01",
      openedByRole: "owner",
      openedByStaffId: null,
    });
    expect(writes.map((write) => write.path)).toEqual([
      `academies/${academyId}/studentLevelProgress/student-1`,
      expect.stringMatching(/^academies\/academy-1\/auditEvents\/audit-level-write-/u),
    ]);
  });

  it("keeps the legacy behaviour without startedOn", async () => {
    const { store } = await seededStore();
    const { input } = open();
    const { head: opened } = await store.openStudentLevel(
      open({
        input: {
          studentId: input.studentId,
          definitionKey: "white-belt",
          decisionNotes: input.decisionNotes,
        },
        openedBy: "head-user-1",
        openedByStaffId: "staff-head-1",
        openedByRole: "headCoach",
      }),
    );
    expect(opened).toMatchObject({
      currentLevelStartedAt: decidedAt,
      openedOn: "2026-09-10",
      openedByRole: "headCoach",
    });
  });

  it("refuses a future start date, a coach and an unknown definition", async () => {
    const { store, writes } = await seededStore();
    await expect(
      store.openStudentLevel(open({ input: { ...open().input, startedOn: "2026-09-11" } })),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      store.openStudentLevel(
        open({
          openedBy: "coach-user-1",
          openedByStaffId: "staff-coach-1",
          openedByRole: "coach" as never,
        }),
      ),
    ).rejects.toMatchObject({ code: "tenant" });
    await expect(
      store.openStudentLevel(open({ input: { ...open().input, definitionKey: "unknown-level" } })),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(writes).toHaveLength(0);
  });
});
```

In `apps/functions/src/levels/canonical-level-security.test.ts` (test at line 513) change the
stripe expectation (lines 638-640) to prove stripes now open:

```ts
const stripe = await fixture().store.openStudentLevel(open("white-1"));
expect(stripe.head.currentDefinitionKey).toBe("white-1");
```

and rename the test to `"opens a student level atomically with its audit and never a second head"`.

In `apps/functions/src/levels/level-service.test.ts` (test at line 281) replace the stripe
rejection block (lines 331-343) with:

```ts
const openedStripe = await store.openStudentLevel({
  academyId: "demo-academy",
  input: {
    studentId: "student-2",
    definitionKey: stripe!.definitionKey,
    decisionNotes: "Holds this stripe.",
  },
  openedBy: "headcoach-1",
  openedByStaffId: "staff-head-1",
  openedByRole: "headCoach",
});
expect(openedStripe.head.currentDefinitionKey).toBe(stripe!.definitionKey);
```

and rename it to `"opens any definition once per student and refuses unknown definitions"`.

- [ ] **Step 2: Run them and watch them fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels/level-manage-service.test.ts apps/functions/src/levels/canonical-level-security.test.ts apps/functions/src/levels/level-service.test.ts`
Expected: FAIL (owner rejected as `tenant`, stripes rejected as `conflict`).

- [ ] **Step 3: Implement**

In `apps/functions/src/levels/level-service.ts`:

1. Import `jerseyDateOf` from `@bpt-jersey/domain/levels`.
2. Store type `openStudentLevel` params: `openedByStaffId: string | null; openedByRole: "headCoach" | "owner";`.
3. Firestore `openStudentLevel` (lines 1407-1480):
   - Role check: `if (openedByRole !== "headCoach" && openedByRole !== "owner") { throw new LevelStoreError("tenant", "Level opening role is invalid"); }`
   - After `const now = …;` add:

```ts
if (input.startedOn !== undefined && input.startedOn > jerseyDateOf(now)) {
  throw new LevelStoreError("invalid", "Level start date is in the future");
}
```

- `assertTransactionalActor(... actorRole: openedByRole, actorStaffId: openedByStaffId })`.
- Delete the belt-only block (lines 1450-1453) and its comment.
- The head record becomes:

```ts
const record: StudentLevelHead = Object.freeze({
  academyId,
  studentId: input.studentId,
  systemId: definitionData.systemId,
  currentDefinitionKey: input.definitionKey,
  currentLevelStartedAt: input.startedOn === undefined ? now : `${input.startedOn}T00:00:00.000Z`,
  lastApprovedPromotionId: null,
  openedByStaffId,
  openingNotes: input.decisionNotes,
  openedDefinitionKey: input.definitionKey,
  openedOn: input.startedOn ?? jerseyDateOf(now),
  openedByRole,
  state: "initialized",
  schemaVersion: "1",
  createdAt: now,
  createdBy: openedBy,
  updatedAt: now,
  updatedBy: openedBy,
});
```

4. In-memory `openStudentLevel` (lines 2072-2108): same role check, delete the belt-only block,
   same record fields (compute `now` before the record as today).

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels`
Expected: PASS, except `level-callables.test.ts` "denies coaches, administrators and students" which
still passes because the handler is unchanged until Task 12.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/levels/level-service.ts apps/functions/src/levels/level-manage-service.test.ts apps/functions/src/levels/canonical-level-security.test.ts apps/functions/src/levels/level-service.test.ts
git commit -m "feat(levels): open a level at any belt or stripe with a start date, head coach or owner (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `assignLevel` with server-computed gaps and a mandatory note

**Files:**

- Modify: `apps/functions/src/levels/level-service.ts` (store type after `openStudentLevel`; Firestore implementation after `openStudentLevel`; in-memory stub)
- Test: `apps/functions/src/levels/level-manage-service.test.ts`

**Interfaces:**

- Consumes: `countedAttendance`, `storedImportedBaseline` (Task 7); `countClassesAtLevel`, `daysAtLevel`, `listPromotionGaps`, `minimumDaysOf`, `jerseyDateOf`, `ageInCompletedYears`, `AssignLevelInput`, `AssignLevelResult` (Tasks 5–6).
- Produces: `LevelCatalogStore.assignLevel(params: { academyId: string; input: AssignLevelInput; decidedBy: string; decidedByStaffId: string | null; decidedByRole: "headCoach" | "owner"; decidedAt?: string }): Promise<AssignLevelResult>`.
  Promotion id = `buildGraduationId(studentId, toDefinitionKey, decidedAt)`. Head after assignment:
  `currentDefinitionKey = to`, `currentLevelStartedAt = "<promotedOn>T00:00:00.000Z"`,
  `lastApprovedPromotionId = promotionId`, no `importedBaseline`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/functions/src/levels/level-manage-service.test.ts`:

```ts
describe("assignLevel (T051V2, grill G7)", () => {
  const assign = (
    input: Record<string, unknown> = {},
    overrides: Record<string, unknown> = {},
  ) => ({
    academyId,
    input: {
      studentId: "student-1",
      fromDefinitionKey: "white-belt",
      toDefinitionKey: "white-2nd-stripe",
      promotedOn: "2026-09-10",
      ...input,
    },
    decidedBy: "owner-user-1",
    decidedByStaffId: null,
    decidedByRole: "owner" as const,
    decidedAt,
    ...overrides,
  });
  const withHead = () =>
    seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({ importedBaseline: baseline }),
      ],
      ...baselineAttendance,
    ]);

  it("requires a note when the server finds gaps", async () => {
    const { store, writes } = await withHead();
    await expect(store.assignLevel(assign())).rejects.toMatchObject({ code: "invalid" });
    expect(writes).toHaveLength(0);
  });

  it("stores gaps, the note, the criteria at assignment and a restore snapshot", async () => {
    const { store, records, writes } = await withHead();
    const result = await store.assignLevel(assign({ note: "Competition result justifies it." }));
    expect(result).toEqual({
      promotionId: `grad_student-1_white-2nd-stripe_${decidedAt}`,
      toDefinitionKey: "white-2nd-stripe",
      promotedOn: "2026-09-10",
      gaps: ["Skips 1 stripe", "Classes 11/25 not met", "Days 71/75 not met"],
    });
    const promotion = records.get(`academies/${academyId}/levelPromotions/${result.promotionId}`)!;
    expect(promotion).toMatchObject({
      status: "approved",
      decisionStatus: "approved",
      fromDefinitionKey: "white-belt",
      toDefinitionKey: "white-2nd-stripe",
      decidedByRole: "owner",
      decidedByStaffId: null,
      promotedOn: "2026-09-10",
      note: "Competition result justifies it.",
      atAssignment: { classes: { done: 11, min: 25 }, days: { done: 71, min: 75 } },
      restore: {
        currentDefinitionKey: "white-belt",
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        lastApprovedPromotionId: null,
        importedBaseline: baseline,
      },
    });
    const stored = records.get(`academies/${academyId}/studentLevelProgress/student-1`)!;
    expect(stored).toMatchObject({
      currentDefinitionKey: "white-2nd-stripe",
      currentLevelStartedAt: "2026-09-10T00:00:00.000Z",
      lastApprovedPromotionId: result.promotionId,
    });
    expect(stored).not.toHaveProperty("importedBaseline");
    expect(writes.find((write) => write.path.includes("/auditEvents/"))?.data).toMatchObject({
      action: "level.promotion.approved",
      targetRef: `academies/${academyId}/levelPromotions/${result.promotionId}`,
    });
  });

  it("assigns the next level without a note when criteria are met", async () => {
    const { store } = await seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({
          currentLevelStartedAt: "2026-06-01T00:00:00.000Z",
          importedBaseline: { ...baseline, classes: 30 },
        }),
      ],
    ]);
    const result = await store.assignLevel(
      assign({ toDefinitionKey: "white-1st-stripe", promotedOn: "2026-09-10" }),
    );
    expect(result.gaps).toEqual([]);
  });

  it("refuses future dates, dates before the level start, stale levels, backwards moves and coaches", async () => {
    const { store, writes } = await withHead();
    const note = "Competition result justifies it.";
    await expect(
      store.assignLevel(assign({ note, promotedOn: "2026-09-11" })),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      store.assignLevel(assign({ note, promotedOn: "2026-06-30" })),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      store.assignLevel(assign({ note, fromDefinitionKey: "white-1st-stripe" })),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      store.assignLevel(assign({ note, toDefinitionKey: "white-belt-kids-4-5-and-5-7-yo" })),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      store.assignLevel(
        assign(
          { note },
          { decidedBy: "coach-user-1", decidedByStaffId: "staff-coach-1", decidedByRole: "coach" },
        ),
      ),
    ).rejects.toMatchObject({ code: "tenant" });
    await expect(
      store.assignLevel(
        assign(
          { note },
          { decidedBy: "head-user-1", decidedByStaffId: "staff-other", decidedByRole: "headCoach" },
        ),
      ),
    ).rejects.toMatchObject({ code: "tenant" });
    expect(writes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels/level-manage-service.test.ts -t "assignLevel"`
Expected: FAIL with `store.assignLevel is not a function`.

- [ ] **Step 3: Implement**

In `apps/functions/src/levels/level-service.ts`:

1. Extend the domain import with `ageInCompletedYears, daysAtLevel, jerseyDateOf, listPromotionGaps, minimumDaysOf, type AssignLevelInput, type AssignLevelResult,`.
2. Add to `LevelCatalogStore` after `openStudentLevel`:

```ts
assignLevel: (params: {
  academyId: string;
  input: AssignLevelInput;
  decidedBy: string;
  decidedByStaffId: string | null;
  decidedByRole: "headCoach" | "owner";
  decidedAt?: string;
}) => Promise<AssignLevelResult>;
```

3. Add a helper next to `countedAttendance`:

```ts
function bestScores(evaluations: readonly EvaluationRecord[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const evaluation of evaluations) {
    scores[evaluation.skillKey] = Math.max(scores[evaluation.skillKey] ?? 0, evaluation.score);
  }
  return scores;
}
```

4. Add the Firestore implementation after `openStudentLevel`:

```ts
    async assignLevel(params): Promise<AssignLevelResult> {
      const { academyId, input, decidedBy, decidedByStaffId, decidedByRole } = params;
      assertValidAcademyId(academyId);
      if (decidedByRole !== "headCoach" && decidedByRole !== "owner") {
        throw new LevelStoreError("tenant", "Promotion decision role is invalid");
      }
      const now = params.decidedAt ?? new Date().toISOString();
      if (input.promotedOn > jerseyDateOf(now)) {
        throw new LevelStoreError("invalid", "Promotion date is in the future");
      }
      const promotionId = buildGraduationId(input.studentId, input.toDefinitionKey, now);
      const promotionRef = firestore.doc(`academies/${academyId}/levelPromotions/${promotionId}`);
      const headRef = firestore.doc(`academies/${academyId}/studentLevelProgress/${input.studentId}`);
      const audit = levelAuditDraft({
        academyId,
        actorId: decidedBy,
        action: "level.promotion.approved",
        targetCollection: "levelPromotions",
        targetId: promotionId,
        purpose: "student-level-promotion",
      });
      const auditRef = firestore.doc(`academies/${academyId}/auditEvents/${auditEventId(audit)}`);
      // Catalogue, assessments and attendance are read before the transaction, as
      // getStudentProgressSummary does; the head and the student are re-read inside it.
      const [catalog, evaluations, attendanceSnapshot] = await Promise.all([
        this.listPublished(academyId),
        this.listStudentEvaluations(academyId, input.studentId),
        firestore.collection(`academies/${academyId}/attendance`).get(),
      ]);
      const attendedAt = countedAttendance(attendanceSnapshot, academyId, input.studentId).map(
        (record) => record.occurredAt as string,
      );
      return firestore.runTransaction(async (transaction) => {
        await assertTransactionalActor(transaction, firestore, {
          academyId,
          actorId: decidedBy,
          actorRole: decidedByRole,
          actorStaffId: decidedByStaffId,
        });
        const student = storedStudent(
          await transaction.get(firestore.doc(`academies/${academyId}/students/${input.studentId}`)),
          academyId,
          input.studentId,
        );
        assertActiveStudent(student);
        const [head, existing] = await Promise.all([transaction.get(headRef), transaction.get(promotionRef)]);
        const headData = head.data();
        const from = catalog.definitions.find((definition) => definition.definitionKey === input.fromDefinitionKey);
        const to = catalog.definitions.find((definition) => definition.definitionKey === input.toDefinitionKey);
        if (
          !head.exists ||
          headData?.academyId !== academyId ||
          headData.studentId !== input.studentId ||
          headData.state !== "initialized" ||
          headData.systemId !== catalog.system.systemId ||
          headData.currentDefinitionKey !== input.fromDefinitionKey ||
          typeof headData.currentLevelStartedAt !== "string" ||
          from === undefined ||
          to === undefined ||
          to.sequence <= from.sequence ||
          existing.exists
        ) {
          throw new LevelStoreError("conflict", "Promotion references are not current");
        }
        const startedAt = headData.currentLevelStartedAt;
        if (input.promotedOn < startedAt.slice(0, 10)) {
          throw new LevelStoreError("invalid", "Promotion date is before the current level start");
        }
        const importedBaseline = storedImportedBaseline(headData.importedBaseline);
        const promotedAt = `${input.promotedOn}T00:00:00.000Z`;
        const classes = countClassesAtLevel({
          attendedAt,
          currentLevelStartedAt: startedAt,
          importedBaseline,
          until: input.promotedOn,
        });
        const daysDone = daysAtLevel(startedAt, promotedAt);
        const gaps = listPromotionGaps({
          definitions: catalog.definitions,
          requirements: catalog.requirements,
          fromDefinitionKey: from.definitionKey,
          toDefinitionKey: to.definitionKey,
          classesDone: classes.total,
          daysDone,
          skillScores: bestScores(evaluations),
          ageYears: ageInCompletedYears(student.dateOfBirth, promotedAt),
        });
        if (gaps.length > 0 && input.note === undefined) {
          throw new LevelStoreError("invalid", "A note is required when criteria are not met");
        }
        const record: GraduationRecord = Object.freeze({
          graduationId: promotionId,
          academyId,
          studentId: input.studentId,
          fromDefinitionKey: from.definitionKey,
          toDefinitionKey: to.definitionKey,
          status: "approved",
          decisionNotes: input.note ?? "",
          decidedBy,
          decidedByRole,
          decidedAt: now,
          ceremonyDate: null,
          schemaVersion: "1",
          createdAt: now,
          createdBy: decidedBy,
          updatedAt: now,
          updatedBy: decidedBy,
        });
        transaction.create(promotionRef, {
          ...record,
          promotionId,
          systemId: headData.systemId,
          decisionStatus: "approved",
          proposedBy: decidedByStaffId ?? decidedBy,
          decidedByStaffId,
          promotedOn: input.promotedOn,
          note: input.note ?? null,
          gaps: [...gaps],
          atAssignment: {
            classes: { done: classes.total, min: to.criteria.minClasses },
            days: { done: daysDone, min: minimumDaysOf(to.criteria.minimumTime) },
          },
          restore: {
            currentDefinitionKey: from.definitionKey,
            currentLevelStartedAt: startedAt,
            lastApprovedPromotionId: headData.lastApprovedPromotionId ?? null,
            importedBaseline,
          },
        });
        const nextHead: Record<string, unknown> = {
          ...headData,
          currentDefinitionKey: to.definitionKey,
          currentLevelStartedAt: promotedAt,
          lastApprovedPromotionId: promotionId,
          updatedAt: now,
          updatedBy: decidedBy,
        };
        delete nextHead.importedBaseline;
        transaction.set(headRef, nextHead);
        appendAuditEventInTransaction(transaction, auditRef, audit);
        return { promotionId, toDefinitionKey: to.definitionKey, promotedOn: input.promotedOn, gaps: [...gaps] };
      });
    },
```

5. In `createInMemoryLevelStore` add:

```ts
    // ponytail: the in-memory store keeps no heads-with-attendance model; assignment is proven on
    // the Firestore store (level-manage-service.test.ts) and the emulator (qa/integration).
    async assignLevel(): Promise<AssignLevelResult> {
      throw new LevelStoreError("conflict", "Level assignment is not available in memory");
    },
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels`
Expected: PASS.

- [ ] **Step 5: Mutation check on the note guard**

Temporarily change `if (gaps.length > 0 && input.note === undefined)` to `if (false)`, run
`corepack pnpm vitest run --project node apps/functions/src/levels/level-manage-service.test.ts -t "requires a note"`,
confirm FAIL, restore the line, confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/levels/level-service.ts apps/functions/src/levels/level-manage-service.test.ts
git commit -m "feat(levels): assignLevel with server gaps, mandatory note, dated promotion and restore snapshot (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `voidPromotion` and `getStudentLevelHistory`

**Files:**

- Modify: `apps/functions/src/levels/level-service.ts` (store type, audit draft union at `:400-431`, Firestore implementations, `listGraduations` at `:1564-1598`, in-memory stubs)
- Test: `apps/functions/src/levels/level-manage-service.test.ts`

**Interfaces:**

- Consumes: Task 9 `assignLevel`; `VoidPromotionInput`, `VoidPromotionResult`, `StudentLevelHistory`, `studentLevelHistorySchema` (Task 6).
- Produces:
  - `LevelCatalogStore.voidPromotion(params: { academyId: string; input: VoidPromotionInput; decidedBy: string; decidedByStaffId: string | null; decidedByRole: "headCoach" | "owner"; decidedAt?: string }): Promise<VoidPromotionResult>`; void id `void_<promotionId>`; audit `level.promotion.voided`.
  - `LevelCatalogStore.getStudentLevelHistory(academyId: string, studentId: string): Promise<StudentLevelHistory>` (newest first).
  - `listGraduations` never returns void documents.

- [ ] **Step 1: Write the failing tests**

Append to `apps/functions/src/levels/level-manage-service.test.ts`:

```ts
describe("voidPromotion and getStudentLevelHistory (T051V2)", () => {
  const note = "Competition result justifies it.";
  const reason = "Assigned to the wrong member by mistake.";
  const voidAt = "2026-09-11T09:00:00.000Z";

  async function assigned() {
    const seeded = await seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({ importedBaseline: baseline }),
      ],
      ...baselineAttendance,
    ]);
    const result = await seeded.store.assignLevel({
      academyId,
      input: {
        studentId: "student-1",
        fromDefinitionKey: "white-belt",
        toDefinitionKey: "white-2nd-stripe",
        promotedOn: "2026-09-10",
        note,
      },
      decidedBy: "owner-user-1",
      decidedByStaffId: null,
      decidedByRole: "owner",
      decidedAt,
    });
    seeded.writes.length = 0;
    return { ...seeded, promotionId: result.promotionId };
  }
  const voidInput = (promotionId: string, overrides: Record<string, unknown> = {}) => ({
    academyId,
    input: { studentId: "student-1", promotionId, reason },
    decidedBy: "head-user-1",
    decidedByStaffId: "staff-head-1",
    decidedByRole: "headCoach" as const,
    decidedAt: voidAt,
    ...overrides,
  });

  it("appends a void record, restores the previous head exactly and audits", async () => {
    const { store, records, writes, promotionId } = await assigned();
    const promotionBefore = structuredClone(
      records.get(`academies/${academyId}/levelPromotions/${promotionId}`),
    );
    const result = await store.voidPromotion(voidInput(promotionId));
    expect(result).toEqual({
      voidId: `void_${promotionId}`,
      voidsPromotionId: promotionId,
      restoredDefinitionKey: "white-belt",
    });
    expect(records.get(`academies/${academyId}/levelPromotions/${promotionId}`)).toEqual(
      promotionBefore,
    );
    expect(records.get(`academies/${academyId}/levelPromotions/void_${promotionId}`)).toMatchObject(
      {
        kind: "void",
        voidsPromotionId: promotionId,
        reason,
        decidedByRole: "headCoach",
        decidedAt: voidAt,
      },
    );
    expect(records.get(`academies/${academyId}/studentLevelProgress/student-1`)).toMatchObject({
      currentDefinitionKey: "white-belt",
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      lastApprovedPromotionId: null,
      importedBaseline: baseline,
    });
    expect(writes.find((write) => write.path.includes("/auditEvents/"))?.data).toMatchObject({
      action: "level.promotion.voided",
      targetRef: `academies/${academyId}/levelPromotions/void_${promotionId}`,
      purpose: "student-level-promotion",
    });
  });

  it("voids only the latest promotion, once, by a head coach or the owner", async () => {
    const { store, writes, promotionId } = await assigned();
    await expect(
      store.voidPromotion(voidInput("grad_student-1_white-1st-stripe_2026-08-01T00:00:00.000Z")),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      store.voidPromotion(
        voidInput(promotionId, {
          decidedBy: "coach-user-1",
          decidedByStaffId: "staff-coach-1",
          decidedByRole: "coach",
        }),
      ),
    ).rejects.toMatchObject({ code: "tenant" });
    expect(writes).toHaveLength(0);
    await store.voidPromotion(voidInput(promotionId));
    await expect(store.voidPromotion(voidInput(promotionId))).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("lists the opening and the voided promotion, newest first, and hides voids from listGraduations", async () => {
    const { store, promotionId } = await assigned();
    await store.voidPromotion(voidInput(promotionId));
    const history = await store.getStudentLevelHistory(academyId, "student-1");
    expect(history).toEqual({
      studentId: "student-1",
      currentDefinitionKey: "white-belt",
      entries: [
        {
          entryId: promotionId,
          kind: "promotion",
          definitionKey: "white-2nd-stripe",
          fromDefinitionKey: "white-belt",
          assignedOn: "2026-09-10",
          classes: { done: 11, min: 25 },
          days: { done: 71, min: 75 },
          decidedByRole: "owner",
          source: "bpt",
          note,
          gaps: ["Skips 1 stripe", "Classes 11/25 not met", "Days 71/75 not met"],
          voided: { reason, voidedByRole: "headCoach", voidedOn: "2026-09-11" },
        },
        {
          entryId: "opening_student-1",
          kind: "opening",
          definitionKey: "white-belt",
          fromDefinitionKey: null,
          assignedOn: "2026-07-01",
          classes: null,
          days: null,
          decidedByRole: "headCoach",
          source: "bpt",
          note: "Synthetic opening note.",
          gaps: [],
          voided: null,
        },
      ],
    });
    const graduations = await store.listGraduations(academyId, "student-1");
    expect(graduations.map((graduation) => graduation.graduationId)).toEqual([promotionId]);
  });

  it("returns an empty history for a student without a level", async () => {
    const { store } = await seededStore();
    expect(await store.getStudentLevelHistory(academyId, "student-1")).toEqual({
      studentId: "student-1",
      currentDefinitionKey: null,
      entries: [],
    });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels/level-manage-service.test.ts -t "voidPromotion"`
Expected: FAIL with `store.voidPromotion is not a function`.

- [ ] **Step 3: Implement**

In `apps/functions/src/levels/level-service.ts`:

1. Extend the domain import with `studentLevelHistorySchema, type LevelHistoryEntry, type StudentLevelHistory, type VoidPromotionInput, type VoidPromotionResult,`.
2. In `levelAuditDraft` add `| "level.promotion.voided"` to `action`.
3. Store type additions:

```ts
voidPromotion: (params: {
  academyId: string;
  input: VoidPromotionInput;
  decidedBy: string;
  decidedByStaffId: string | null;
  decidedByRole: "headCoach" | "owner";
  decidedAt?: string;
}) => Promise<VoidPromotionResult>;
getStudentLevelHistory: (academyId: string, studentId: string) => Promise<StudentLevelHistory>;
```

4. Module helper (after `bestScores`):

```ts
function decisionRole(value: unknown): "headCoach" | "owner" | null {
  return value === "headCoach" || value === "owner" ? value : null;
}

function criterionAt(value: unknown): { done: number; min: number | null } | null {
  if (typeof value !== "object" || value === null) return null;
  const { done, min } = value as Record<string, unknown>;
  return typeof done === "number" && (typeof min === "number" || min === null)
    ? { done, min }
    : null;
}

function buildLevelHistory(
  studentId: string,
  headData: Record<string, unknown> | undefined,
  promotions: readonly Record<string, unknown>[],
): StudentLevelHistory {
  const voids = new Map(
    promotions
      .filter((record) => record.kind === "void")
      .map((record) => [String(record.voidsPromotionId), record] as const),
  );
  const entries: LevelHistoryEntry[] = promotions
    .filter((record) => record.kind !== "void" && record.status === "approved")
    .map((record): LevelHistoryEntry => {
      const voided = voids.get(String(record.promotionId));
      const imported = record.source === "regyfit-import";
      return {
        entryId: String(record.promotionId),
        kind: "promotion",
        definitionKey: String(record.toDefinitionKey),
        fromDefinitionKey: String(record.fromDefinitionKey),
        assignedOn:
          typeof record.promotedOn === "string"
            ? record.promotedOn
            : String(record.decidedAt).slice(0, 10),
        classes: criterionAt((record.atAssignment as Record<string, unknown> | undefined)?.classes),
        days: criterionAt((record.atAssignment as Record<string, unknown> | undefined)?.days),
        decidedByRole: imported ? null : decisionRole(record.decidedByRole),
        source: imported ? "regyfit-import" : "bpt",
        note:
          typeof record.note === "string"
            ? record.note
            : typeof record.decisionNotes === "string" && record.decisionNotes !== ""
              ? record.decisionNotes
              : null,
        gaps: Array.isArray(record.gaps)
          ? record.gaps.filter((gap): gap is string => typeof gap === "string")
          : [],
        voided:
          voided === undefined
            ? null
            : {
                reason: String(voided.reason),
                voidedByRole: decisionRole(voided.decidedByRole) ?? "owner",
                voidedOn: String(voided.decidedAt).slice(0, 10),
              },
      };
    });
  if (
    headData !== undefined &&
    typeof headData.openedDefinitionKey === "string" &&
    typeof headData.openedOn === "string"
  ) {
    const imported = headData.source === "regyfit-import";
    entries.push({
      entryId: `opening_${studentId}`,
      kind: "opening",
      definitionKey: headData.openedDefinitionKey,
      fromDefinitionKey: null,
      assignedOn: headData.openedOn,
      classes: null,
      days: null,
      decidedByRole: imported ? null : decisionRole(headData.openedByRole),
      source: imported ? "regyfit-import" : "bpt",
      note:
        typeof headData.openingNotes === "string" && headData.openingNotes !== ""
          ? headData.openingNotes
          : null,
      gaps: [],
      voided: null,
    });
  }
  entries.sort(
    (left, right) =>
      right.assignedOn.localeCompare(left.assignedOn) || (left.kind === "opening" ? 1 : -1),
  );
  const parsed = studentLevelHistorySchema.safeParse({
    studentId,
    currentDefinitionKey:
      typeof headData?.currentDefinitionKey === "string" ? headData.currentDefinitionKey : null,
    entries,
  });
  if (!parsed.success) throw new LevelStoreError("conflict", "Level history is invalid");
  return parsed.data;
}
```

5. Firestore implementations (after `assignLevel`):

```ts
    async voidPromotion(params): Promise<VoidPromotionResult> {
      const { academyId, input, decidedBy, decidedByStaffId, decidedByRole } = params;
      assertValidAcademyId(academyId);
      if (decidedByRole !== "headCoach" && decidedByRole !== "owner") {
        throw new LevelStoreError("tenant", "Promotion decision role is invalid");
      }
      const now = params.decidedAt ?? new Date().toISOString();
      const voidId = `void_${input.promotionId}`;
      const promotionRef = firestore.doc(`academies/${academyId}/levelPromotions/${input.promotionId}`);
      const voidRef = firestore.doc(`academies/${academyId}/levelPromotions/${voidId}`);
      const headRef = firestore.doc(`academies/${academyId}/studentLevelProgress/${input.studentId}`);
      const audit = levelAuditDraft({
        academyId,
        actorId: decidedBy,
        action: "level.promotion.voided",
        targetCollection: "levelPromotions",
        targetId: voidId,
        purpose: "student-level-promotion",
      });
      const auditRef = firestore.doc(`academies/${academyId}/auditEvents/${auditEventId(audit)}`);
      return firestore.runTransaction(async (transaction) => {
        await assertTransactionalActor(transaction, firestore, {
          academyId,
          actorId: decidedBy,
          actorRole: decidedByRole,
          actorStaffId: decidedByStaffId,
        });
        storedStudent(
          await transaction.get(firestore.doc(`academies/${academyId}/students/${input.studentId}`)),
          academyId,
          input.studentId,
        );
        const [head, promotion, existingVoid] = await Promise.all([
          transaction.get(headRef),
          transaction.get(promotionRef),
          transaction.get(voidRef),
        ]);
        const headData = head.data();
        const promotionData = promotion.data();
        const restore = promotionData?.restore as Record<string, unknown> | undefined;
        if (
          !head.exists ||
          headData?.academyId !== academyId ||
          headData.studentId !== input.studentId ||
          headData.lastApprovedPromotionId !== input.promotionId ||
          !promotion.exists ||
          promotionData?.academyId !== academyId ||
          promotionData.studentId !== input.studentId ||
          promotionData.status !== "approved" ||
          promotionData.kind === "void" ||
          existingVoid.exists ||
          restore === undefined ||
          typeof restore.currentDefinitionKey !== "string" ||
          typeof restore.currentLevelStartedAt !== "string" ||
          (restore.lastApprovedPromotionId !== null && typeof restore.lastApprovedPromotionId !== "string")
        ) {
          throw new LevelStoreError("conflict", "Promotion cannot be voided");
        }
        const restoredBaseline = storedImportedBaseline(restore.importedBaseline ?? undefined);
        transaction.create(voidRef, {
          promotionId: voidId,
          kind: "void",
          academyId,
          studentId: input.studentId,
          systemId: promotionData.systemId,
          voidsPromotionId: input.promotionId,
          reason: input.reason,
          decidedBy,
          decidedByRole,
          decidedByStaffId,
          decidedAt: now,
          schemaVersion: "1",
          createdAt: now,
          createdBy: decidedBy,
          updatedAt: now,
          updatedBy: decidedBy,
        });
        const nextHead: Record<string, unknown> = {
          ...headData,
          currentDefinitionKey: restore.currentDefinitionKey,
          currentLevelStartedAt: restore.currentLevelStartedAt,
          lastApprovedPromotionId: restore.lastApprovedPromotionId,
          updatedAt: now,
          updatedBy: decidedBy,
        };
        delete nextHead.importedBaseline;
        if (restoredBaseline !== null) nextHead.importedBaseline = restoredBaseline;
        transaction.set(headRef, nextHead);
        appendAuditEventInTransaction(transaction, auditRef, audit);
        return { voidId, voidsPromotionId: input.promotionId, restoredDefinitionKey: restore.currentDefinitionKey };
      });
    },

    async getStudentLevelHistory(academyId: string, studentId: string): Promise<StudentLevelHistory> {
      assertValidAcademyId(academyId);
      storedStudent(await firestore.doc(`academies/${academyId}/students/${studentId}`).get(), academyId, studentId);
      const [head, snapshot] = await Promise.all([
        firestore.doc(`academies/${academyId}/studentLevelProgress/${studentId}`).get(),
        firestore.collection(`academies/${academyId}/levelPromotions`).get(),
      ]);
      const headData = head.data();
      if (head.exists && (headData?.academyId !== academyId || headData.studentId !== studentId)) {
        throw new LevelStoreError("tenant", "Progress head is invalid");
      }
      const promotions = withinLimit(snapshot, "Level promotions").docs.flatMap((document) => {
        const data = document.data();
        if (data.academyId !== academyId || data.promotionId !== document.id) {
          throw new LevelStoreError("tenant", "Promotion scope is invalid");
        }
        return data.studentId === studentId ? [data] : [];
      });
      return buildLevelHistory(studentId, head.exists ? headData : undefined, promotions);
    },
```

(`storedImportedBaseline(restore.importedBaseline ?? undefined)` maps a stored `null` to "no baseline".)

6. In Firestore `listGraduations` (line 1583) add `if (data.kind === "void") return [];` by turning
   the `.map` into `.flatMap` returning `[data as unknown as GraduationRecord]` for the rest.
7. In-memory stubs:

```ts
    async voidPromotion(): Promise<VoidPromotionResult> {
      throw new LevelStoreError("conflict", "Promotion voiding is not available in memory");
    },
    async getStudentLevelHistory(_academyId: string, studentId: string): Promise<StudentLevelHistory> {
      return { studentId, currentDefinitionKey: null, entries: [] };
    },
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels`
Expected: PASS.

- [ ] **Step 5: Mutation check on "only the latest promotion"**

Remove `headData.lastApprovedPromotionId !== input.promotionId ||` temporarily, run
`-t "voids only the latest"`, confirm FAIL, restore, confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/levels/level-service.ts apps/functions/src/levels/level-manage-service.test.ts
git commit -m "feat(levels): voidPromotion restores the previous head append-only; student level history (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `recordSkillRatings` — many ratings in one transaction

**Files:**

- Modify: `apps/functions/src/levels/level-service.ts` (store type, Firestore implementation after `recordEvaluation`, in-memory stub)
- Test: `apps/functions/src/levels/level-manage-service.test.ts`

**Interfaces:**

- Consumes: `RecordSkillRatingsInput`, `RecordSkillRatingsResult` (Task 6); `buildEvaluationId`.
- Produces: `LevelCatalogStore.recordSkillRatings(params: { academyId: string; input: RecordSkillRatingsInput; evaluatorId: string; evaluatorStaffId: string | null; evaluatorRole: "headCoach" | "coach" | "owner"; evaluatedAt?: string }): Promise<RecordSkillRatingsResult>`;
  one `assessments` document + one audit per rating, `sessionId: null`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/functions/src/levels/level-manage-service.test.ts`:

```ts
describe("recordSkillRatings (T051V2)", () => {
  const rate = (overrides: Record<string, unknown> = {}, input: Record<string, unknown> = {}) => ({
    academyId,
    input: {
      studentId: "student-1",
      definitionKey: "white-belt",
      ratings: [
        { skillKey: "tie-the-belt", score: 3 },
        { skillKey: "warm-up-2-bridges", score: 4 },
      ],
      ...input,
    },
    evaluatorId: "coach-user-1",
    evaluatorStaffId: "staff-coach-1",
    evaluatorRole: "coach" as const,
    evaluatedAt: decidedAt,
    ...overrides,
  });

  it("writes one assessment and one audit per rating without a session", async () => {
    const { store, writes } = await seededStore();
    expect(await store.recordSkillRatings(rate())).toEqual({ recorded: 2 });
    const assessments = writes.filter((write) => write.path.includes("/assessments/"));
    expect(assessments.map((write) => write.data)).toEqual([
      expect.objectContaining({
        skillKey: "tie-the-belt",
        score: 3,
        sessionId: null,
        evaluatorRole: "coach",
        coachStaffId: "staff-coach-1",
        status: "recorded",
      }),
      expect.objectContaining({ skillKey: "warm-up-2-bridges", score: 4, sessionId: null }),
    ]);
    expect(writes.filter((write) => write.path.includes("/auditEvents/"))).toHaveLength(2);
    const summary = await store.getStudentSkillSummary(academyId, "student-1");
    expect(summary["warm-up-2-bridges"]).toMatchObject({ latestScore: 4, maxScore: 4 });
  });

  it("lets the owner rate and refuses unknown skills and non-rating roles", async () => {
    const { store, writes } = await seededStore();
    await expect(
      store.recordSkillRatings(
        rate({ evaluatorId: "owner-user-1", evaluatorStaffId: null, evaluatorRole: "owner" }),
      ),
    ).resolves.toEqual({ recorded: 2 });
    writes.length = 0;
    await expect(
      store.recordSkillRatings(rate({}, { ratings: [{ skillKey: "not-in-catalogue", score: 2 }] })),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      store.recordSkillRatings(rate({ evaluatorRole: "administrator" as never })),
    ).rejects.toMatchObject({ code: "tenant" });
    expect(writes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels/level-manage-service.test.ts -t "recordSkillRatings"`
Expected: FAIL with `store.recordSkillRatings is not a function`.

- [ ] **Step 3: Implement**

In `apps/functions/src/levels/level-service.ts`:

1. Extend the domain import with `type RecordSkillRatingsInput, type RecordSkillRatingsResult,`.
2. Store type:

```ts
recordSkillRatings: (params: {
  academyId: string;
  input: RecordSkillRatingsInput;
  evaluatorId: string;
  evaluatorStaffId: string | null;
  evaluatorRole: "headCoach" | "coach" | "owner";
  evaluatedAt?: string;
}) => Promise<RecordSkillRatingsResult>;
```

3. Firestore implementation after `recordEvaluation`:

```ts
    async recordSkillRatings(params): Promise<RecordSkillRatingsResult> {
      assertValidAcademyId(params.academyId);
      const { academyId, input, evaluatorId, evaluatorStaffId, evaluatorRole } = params;
      if (evaluatorRole !== "headCoach" && evaluatorRole !== "coach" && evaluatorRole !== "owner") {
        throw new LevelStoreError("tenant", "Assessment actor role is invalid");
      }
      const now = params.evaluatedAt ?? new Date().toISOString();
      const planned = input.ratings.map((rating) => {
        const evaluationId = buildEvaluationId(input.studentId, rating.skillKey, now);
        const audit = levelAuditDraft({
          academyId,
          actorId: evaluatorId,
          action: "level.assessment.recorded",
          targetCollection: "assessments",
          targetId: evaluationId,
          purpose: "student-development-assessment",
        });
        return {
          rating,
          evaluationId,
          ref: firestore.doc(`academies/${academyId}/assessments/${evaluationId}`),
          audit,
          auditRef: firestore.doc(`academies/${academyId}/auditEvents/${auditEventId(audit)}`),
        };
      });
      return firestore.runTransaction(async (transaction) => {
        await assertTransactionalActor(transaction, firestore, {
          academyId,
          actorId: evaluatorId,
          actorRole: evaluatorRole,
          actorStaffId: evaluatorStaffId,
        });
        const student = storedStudent(
          await transaction.get(firestore.doc(`academies/${academyId}/students/${input.studentId}`)),
          academyId,
          input.studentId,
        );
        assertActiveStudent(student);
        const definition = await transaction.get(
          firestore.doc(`academies/${academyId}/levelDefinitions/${input.definitionKey}`),
        );
        const definitionData = definition.data();
        if (
          !definition.exists ||
          definitionData?.academyId !== academyId ||
          definitionData.definitionKey !== input.definitionKey ||
          typeof definitionData.systemId !== "string"
        ) {
          throw new LevelStoreError("conflict", "Assessment references are not current");
        }
        const system = await transaction.get(
          firestore.doc(`academies/${academyId}/levelSystems/${definitionData.systemId}`),
        );
        const systemData = system.data();
        const catalogKeys = new Set(
          Array.isArray(systemData?.skillCatalog)
            ? systemData.skillCatalog.flatMap((skill) =>
                typeof skill === "object" && skill !== null && typeof (skill as Record<string, unknown>).key === "string"
                  ? [(skill as Record<string, unknown>).key as string]
                  : [],
              )
            : [],
        );
        const existing = await Promise.all(planned.map((entry) => transaction.get(entry.ref)));
        if (
          !system.exists ||
          systemData?.academyId !== academyId ||
          systemData.status !== "published" ||
          planned.some((entry) => !catalogKeys.has(entry.rating.skillKey)) ||
          existing.some((snapshot) => snapshot.exists)
        ) {
          throw new LevelStoreError("conflict", "Assessment catalog is not current");
        }
        for (const entry of planned) {
          const record: EvaluationRecord = {
            evaluationId: entry.evaluationId,
            academyId,
            studentId: input.studentId,
            sessionId: null,
            definitionKey: input.definitionKey,
            skillKey: entry.rating.skillKey,
            score: entry.rating.score,
            evidenceNotes: input.evidenceNotes ?? "",
            evaluatorId,
            evaluatorRole,
            evaluatedAt: now,
            schemaVersion: "1",
            createdAt: now,
            createdBy: evaluatorId,
            updatedAt: now,
            updatedBy: evaluatorId,
          };
          transaction.create(entry.ref, {
            ...record,
            assessmentId: entry.evaluationId,
            coachStaffId: evaluatorStaffId,
            observedAt: now,
            dimensions: [{ definitionKey: input.definitionKey, skillKey: entry.rating.skillKey, score: entry.rating.score }],
            status: "recorded",
          });
          appendAuditEventInTransaction(transaction, entry.auditRef, entry.audit);
        }
        return { recorded: planned.length };
      });
    },
```

4. In-memory stub:

```ts
    async recordSkillRatings(params): Promise<RecordSkillRatingsResult> {
      for (const rating of params.input.ratings) {
        await this.recordEvaluation({
          academyId: params.academyId,
          input: { studentId: params.input.studentId, sessionId: "manage-view", definitionKey: params.input.definitionKey, skillKey: rating.skillKey, score: rating.score, evidenceNotes: params.input.evidenceNotes ?? "" },
          evaluatorId: params.evaluatorId,
          evaluatorStaffId: params.evaluatorStaffId ?? params.evaluatorId,
          evaluatorRole: params.evaluatorRole === "owner" ? "headCoach" : params.evaluatorRole,
          evaluatedAt: params.evaluatedAt,
        });
      }
      return { recorded: params.input.ratings.length };
    },
```

(`recordEvaluation` store params keep `evaluatorRole: "headCoach" | "coach"`; the in-memory mapping is
test-only, marked `// ponytail: in-memory store maps owner to headCoach; Firestore keeps the real role.`)

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/levels/level-service.ts apps/functions/src/levels/level-manage-service.test.ts
git commit -m "feat(levels): record many skill ratings in one audited transaction without a session (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Callables, role guards and exports

**Files:**

- Modify: `apps/functions/src/levels/level-callables.ts:1-27` (imports), `:363-392` (open handler), new handlers before `let defaultStore`, `:437-457` (onCall exports)
- Modify: `apps/functions/src/index.ts:78-90`
- Test: `apps/functions/src/levels/level-callables.test.ts:499-516` (update) and new `apps/functions/src/levels/level-manage-callables.test.ts`

**Interfaces:**

- Consumes: store methods from Tasks 8–11; schemas from Task 6.
- Produces (callable names used by the web client and Plan D):
  - `assignLevel(AssignLevelInput) → AssignLevelResult` — head coach (with staff profile) or owner.
  - `voidPromotion(VoidPromotionInput) → VoidPromotionResult` — head coach or owner.
  - `getStudentLevelHistory({ studentId }) → StudentLevelHistory` — owner, administrator, head coach, coach.
  - `recordEvaluation` dispatches to `createRecordSkillRatingsHandler` when the payload has `ratings`
    (`→ { recorded }`, roles head coach, coach, owner); the legacy single-rating shape is unchanged.
  - `openStudentLevel` now accepts head coach or owner and the optional `startedOn`.
  - Exported factories: `createAssignLevelHandler`, `createVoidPromotionHandler`,
    `createGetStudentLevelHistoryHandler`, `createRecordSkillRatingsHandler`.

- [ ] **Step 1: Write the failing tests**

Create `apps/functions/src/levels/level-manage-callables.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import type { LevelAuthorizationService } from "./level-authorization";
import {
  createAssignLevelHandler,
  createGetStudentLevelHistoryHandler,
  createOpenStudentLevelHandler,
  createRecordSkillRatingsHandler,
  createVoidPromotionHandler,
} from "./level-callables";
import { LevelStoreError, type LevelCatalogStore } from "./level-service";

function request(data: unknown, role: string, uid = `${role}-user`) {
  return {
    auth: { uid, token: { academyId: "academy-1", role } },
    app: { appId: "test-app" },
    data,
  } as never;
}

const authorization: LevelAuthorizationService = {
  requireActor: async (callable) => {
    const { auth } = callable as unknown as {
      auth: { uid: string; token: { academyId: string; role: string } };
    };
    return {
      kind: "user",
      userId: auth.uid as never,
      academyId: auth.token.academyId as never,
      role: auth.token.role as never,
      staffId: auth.token.role === "headCoach" || auth.token.role === "coach" ? "staff-1" : null,
    };
  },
  resolveStudent: async (_actor, studentId) => ({ studentId }) as never,
};

function storeWith(overrides: Partial<Record<keyof LevelCatalogStore, unknown>>) {
  return overrides as unknown as LevelCatalogStore;
}

const assignPayload = {
  studentId: "student-1",
  fromDefinitionKey: "white-belt",
  toDefinitionKey: "white-2nd-stripe",
  promotedOn: "2026-09-10",
  note: "Competition result justifies it.",
};
const voidPayload = {
  studentId: "student-1",
  promotionId: "grad_student-1_white-2nd-stripe_2026-09-10T12:00:00.000Z",
  reason: "Assigned to the wrong member.",
};
const ratingsPayload = {
  studentId: "student-1",
  definitionKey: "white-belt",
  ratings: [{ skillKey: "tie-the-belt", score: 3 }],
};

describe("assignLevel and voidPromotion callables", () => {
  it("pass the owner without a staff id and the head coach with one", async () => {
    const assignLevel = vi.fn(async () => ({
      promotionId: "p",
      toDefinitionKey: "white-2nd-stripe",
      promotedOn: "2026-09-10",
      gaps: [],
    }));
    const handler = createAssignLevelHandler({ store: storeWith({ assignLevel }), authorization });
    await handler(request(assignPayload, "owner"));
    await handler(request(assignPayload, "headCoach"));
    expect(assignLevel).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        decidedByRole: "owner",
        decidedByStaffId: null,
        decidedBy: "owner-user",
      }),
    );
    expect(assignLevel).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ decidedByRole: "headCoach", decidedByStaffId: "staff-1" }),
    );
  });

  it("deny every other role before the store is touched", async () => {
    const assignLevel = vi.fn();
    const voidPromotion = vi.fn();
    const assign = createAssignLevelHandler({ store: storeWith({ assignLevel }), authorization });
    const voidHandler = createVoidPromotionHandler({
      store: storeWith({ voidPromotion }),
      authorization,
    });
    for (const role of ["administrator", "coach", "guardian", "adultStudent"]) {
      await expect(assign(request(assignPayload, role))).rejects.toMatchObject({
        code: "permission-denied",
      });
      await expect(voidHandler(request(voidPayload, role))).rejects.toMatchObject({
        code: "permission-denied",
      });
    }
    expect(assignLevel).not.toHaveBeenCalled();
    expect(voidPromotion).not.toHaveBeenCalled();
  });

  it("reject extra keys, short notes and map store errors to safe codes", async () => {
    const assignLevel = vi.fn(async () => {
      throw new LevelStoreError("invalid", "A note is required when criteria are not met");
    });
    const handler = createAssignLevelHandler({ store: storeWith({ assignLevel }), authorization });
    await expect(
      handler(request({ ...assignPayload, decidedBy: "x" }, "owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      handler(request({ ...assignPayload, note: "short" }, "owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    const failure = await handler(request(assignPayload, "owner")).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "invalid-argument",
      message: "Levels request is invalid",
    });
    const voidHandler = createVoidPromotionHandler({
      store: storeWith({ voidPromotion: vi.fn() }),
      authorization,
    });
    await expect(
      voidHandler(request({ ...voidPayload, reason: "no" }, "owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

describe("getStudentLevelHistory callable", () => {
  it("serves staff roles only", async () => {
    const getStudentLevelHistory = vi.fn(async () => ({
      studentId: "student-1",
      currentDefinitionKey: null,
      entries: [],
    }));
    const handler = createGetStudentLevelHistoryHandler({
      store: storeWith({ getStudentLevelHistory }),
      authorization,
    });
    for (const role of ["owner", "administrator", "headCoach", "coach"]) {
      await expect(handler(request({ studentId: "student-1" }, role))).resolves.toMatchObject({
        entries: [],
      });
    }
    for (const role of ["guardian", "adultStudent"]) {
      await expect(handler(request({ studentId: "student-1" }, role))).rejects.toMatchObject({
        code: "permission-denied",
      });
    }
    await expect(
      handler(request({ studentId: "student-1", all: true }, "owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(getStudentLevelHistory).toHaveBeenCalledTimes(4);
  });
});

describe("recordSkillRatings callable", () => {
  it("lets coaches, head coaches and the owner rate, nobody else", async () => {
    const recordSkillRatings = vi.fn(async () => ({ recorded: 1 }));
    const handler = createRecordSkillRatingsHandler({
      store: storeWith({ recordSkillRatings }),
      authorization,
    });
    await handler(request(ratingsPayload, "coach"));
    await handler(request(ratingsPayload, "owner"));
    expect(recordSkillRatings).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ evaluatorRole: "coach", evaluatorStaffId: "staff-1" }),
    );
    expect(recordSkillRatings).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ evaluatorRole: "owner", evaluatorStaffId: null }),
    );
    for (const role of ["administrator", "guardian", "adultStudent"]) {
      await expect(handler(request(ratingsPayload, role))).rejects.toMatchObject({
        code: "permission-denied",
      });
    }
    expect(recordSkillRatings).toHaveBeenCalledTimes(2);
  });
});

describe("openStudentLevel callable roles (T051V2)", () => {
  it("accepts the owner with a start date", async () => {
    const openStudentLevel = vi.fn(async () => ({
      head: {
        studentId: "student-1",
        currentDefinitionKey: "white-belt",
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        state: "initialized",
      },
      ageBand: { requiredMinAge: 16, requiredMaxAge: null, ageYears: 30, met: true },
    }));
    const handler = createOpenStudentLevelHandler({
      store: storeWith({ openStudentLevel }),
      authorization,
    });
    await handler(
      request(
        {
          studentId: "student-1",
          definitionKey: "white-belt",
          decisionNotes: "Imported level.",
          startedOn: "2026-07-01",
        },
        "owner",
      ),
    );
    expect(openStudentLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        openedByRole: "owner",
        openedByStaffId: null,
        input: expect.objectContaining({ startedOn: "2026-07-01" }),
      }),
    );
  });
});
```

In `apps/functions/src/levels/level-callables.test.ts` "denies coaches, administrators and students"
(lines 499-516): replace `["owner", "owner-1"],` with `["administrator", "administrator-1"],` and the
expected message with `/head coach or the owner is required/u`.

- [ ] **Step 2: Run them and watch them fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels/level-manage-callables.test.ts apps/functions/src/levels/level-callables.test.ts`
Expected: FAIL (factories not exported; owner denied).

- [ ] **Step 3: Implement**

In `apps/functions/src/levels/level-callables.ts`:

1. Extend the domain import:

```ts
  assignLevelInputSchema,
  recordSkillRatingsInputSchema,
  studentLevelHistoryRequestSchema,
  voidPromotionInputSchema,
  type AssignLevelResult,
  type RecordSkillRatingsResult,
  type StudentLevelHistory,
  type VoidPromotionResult,
```

2. After `const assessmentRoles = …` add:

```ts
const ratingRoles = new Set(["headCoach", "coach", "owner"]);

function decisionActor(
  actor: AuthorizedLevelActor,
): Readonly<{ role: "headCoach" | "owner"; staffId: string | null }> {
  if (actor.role === "owner") return { role: "owner", staffId: null };
  if (actor.role === "headCoach" && actor.staffId !== null) {
    return { role: "headCoach", staffId: actor.staffId };
  }
  throw new HttpsError("permission-denied", "The head coach or the owner is required");
}

export function hasSkillRatings(data: unknown): boolean {
  return isPlainRecord(data) && Object.hasOwn(data, "ratings");
}
```

3. In `createOpenStudentLevelHandler` replace the role check and store call:

```ts
    const actor = await dependencies.authorization.requireActor(request);
    const decider = decisionActor(actor);
    const parsed = parseOpenStudentLevelInput(request.data);
    if (!parsed.ok) invalidPayload();
    try {
      const { head, ageBand } = await dependencies.store.openStudentLevel({
        academyId: actor.academyId,
        input: parsed.value,
        openedBy: actor.userId,
        openedByStaffId: decider.staffId,
        openedByRole: decider.role,
      });
```

4. New handlers (before `let defaultStore`):

```ts
export function createAssignLevelHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<AssignLevelResult> => {
    const actor = await dependencies.authorization.requireActor(request);
    const decider = decisionActor(actor);
    const parsed = assignLevelInputSchema.safeParse(request.data);
    if (!parsed.success) invalidPayload();
    const studentId = await targetStudent(dependencies.authorization, actor, parsed.data.studentId);
    try {
      return await dependencies.store.assignLevel({
        academyId: actor.academyId,
        input: { ...parsed.data, studentId },
        decidedBy: actor.userId,
        decidedByStaffId: decider.staffId,
        decidedByRole: decider.role,
      });
    } catch (error) {
      return mapStoreError(error, "assign level");
    }
  };
}

export function createVoidPromotionHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<VoidPromotionResult> => {
    const actor = await dependencies.authorization.requireActor(request);
    const decider = decisionActor(actor);
    const parsed = voidPromotionInputSchema.safeParse(request.data);
    if (!parsed.success) invalidPayload();
    const studentId = await targetStudent(dependencies.authorization, actor, parsed.data.studentId);
    try {
      return await dependencies.store.voidPromotion({
        academyId: actor.academyId,
        input: { ...parsed.data, studentId },
        decidedBy: actor.userId,
        decidedByStaffId: decider.staffId,
        decidedByRole: decider.role,
      });
    } catch (error) {
      return mapStoreError(error, "void promotion");
    }
  };
}

export function createGetStudentLevelHistoryHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<StudentLevelHistory> => {
    const actor = await dependencies.authorization.requireActor(request);
    if (!staffRoles.has(actor.role)) {
      throw new HttpsError("permission-denied", "A current staff role is required");
    }
    const parsed = studentLevelHistoryRequestSchema.safeParse(request.data);
    if (!parsed.success) invalidPayload();
    const studentId = await targetStudent(dependencies.authorization, actor, parsed.data.studentId);
    try {
      return await dependencies.store.getStudentLevelHistory(actor.academyId, studentId);
    } catch (error) {
      return mapStoreError(error, "retrieve level history");
    }
  };
}

export function createRecordSkillRatingsHandler(dependencies: HandlerDependencies) {
  return async (request: CallableRequest<unknown>): Promise<RecordSkillRatingsResult> => {
    const actor = await dependencies.authorization.requireActor(request);
    if (!ratingRoles.has(actor.role) || (actor.role !== "owner" && actor.staffId === null)) {
      throw new HttpsError("permission-denied", "A current coach role is required");
    }
    const parsed = recordSkillRatingsInputSchema.safeParse(request.data);
    if (!parsed.success) invalidPayload();
    const studentId = await targetStudent(dependencies.authorization, actor, parsed.data.studentId);
    try {
      return await dependencies.store.recordSkillRatings({
        academyId: actor.academyId,
        input: { ...parsed.data, studentId },
        evaluatorId: actor.userId,
        evaluatorStaffId: actor.staffId,
        evaluatorRole: actor.role as "headCoach" | "coach" | "owner",
      });
    } catch (error) {
      return mapStoreError(error, "record assessment");
    }
  };
}
```

5. Replace the `recordEvaluation` export and append the three new callables:

```ts
export const recordEvaluation = onCall(levelCallableOptions, (request) =>
  hasSkillRatings(request.data)
    ? createRecordSkillRatingsHandler(dependencies())(request)
    : createRecordEvaluationHandler(dependencies())(request),
);
export const assignLevel = onCall(levelCallableOptions, (request) =>
  createAssignLevelHandler(dependencies())(request),
);
export const voidPromotion = onCall(levelCallableOptions, (request) =>
  createVoidPromotionHandler(dependencies())(request),
);
export const getStudentLevelHistory = onCall(levelCallableOptions, (request) =>
  createGetStudentLevelHistoryHandler(dependencies())(request),
);
```

In `apps/functions/src/index.ts` (lines 78-90) add `assignLevel,`, `getStudentLevelHistory,` and
`voidPromotion,` in alphabetical order inside the existing `export { … } from "./levels/level-callables.js";`.

- [ ] **Step 4: Run the tests, then mutation-check one guard**

Run: `corepack pnpm vitest run --project node apps/functions/src/levels`
Expected: PASS. Then change `decisionActor` to `return { role: "owner", staffId: null };` for every
role, run `level-manage-callables.test.ts`, confirm "deny every other role" FAILS, restore, PASS.

- [ ] **Step 5: Build the functions artifact to prove the deploy surface compiles**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/functions build`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/levels/level-callables.ts apps/functions/src/levels/level-callables.test.ts apps/functions/src/levels/level-manage-callables.test.ts apps/functions/src/index.ts
git commit -m "feat(levels): assignLevel, voidPromotion, getStudentLevelHistory callables and batch ratings (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Rules stay deny-direct; emulator proof of open, assign, void and baseline

**Files:**

- Modify: `qa/rules/client-data-boundary.test.ts:61-72`
- Create: `qa/integration/level-manage.test.ts`

**Interfaces:**

- Consumes: `createLevelCatalogStore` (Tasks 7–11), `loadApprovedLevelCatalog({ systemId: "ibjjf-v2" })` (Task 4).
- Produces: evidence only.

- [ ] **Step 1: Add the collections to the deny-direct rules test**

In `qa/rules/client-data-boundary.test.ts`, inside `academyBackendOnlyCollections` after
`"waitlistPositionStates",` add:

```ts
  // T051V2: level heads (with the imported baseline) and promotion/void records reach clients
  // only through the level callables.
  "studentLevelProgress",
  "levelPromotions",
```

- [ ] **Step 2: Write the emulator integration test**

Create `qa/integration/level-manage.test.ts`:

```ts
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { createLevelCatalogStore } from "../../apps/functions/src/levels/level-service";
import { loadApprovedLevelCatalog } from "../../apps/functions/src/levels/level-seed";

const runId = `level-manage-${process.pid}-${randomUUID().slice(0, 8)}`;
const academyId = `${runId}-academy`;
const host = process.env.FIRESTORE_EMULATOR_HOST?.trim() ?? "";
const useEmulator = /^(127\.0\.0\.1|localhost):\d{2,5}$/u.test(host);
const app = useEmulator ? initializeApp({ projectId: "demo-bpt-jersey" }, runId) : undefined;
const firestore = app ? getFirestore(app) : undefined;
const store = firestore
  ? createLevelCatalogStore({
      firestore: firestore as unknown as Parameters<typeof createLevelCatalogStore>[0]["firestore"],
    })
  : undefined;
const created = "2026-06-01T00:00:00.000Z";

afterAll(async () => {
  // Emulator data is throwaway; rollback is refused once promotions reference the catalogue.
  if (app) await deleteApp(app);
});

async function put(path: string, data: Record<string, unknown>) {
  await firestore!.doc(`academies/${academyId}/${path}`).set(data);
}

describe("level manage on the Firestore emulator (T051V2)", () => {
  it.skipIf(!useEmulator)(
    "opens, counts the baseline, assigns with a note, voids and lists history",
    async () => {
      if (!store) throw new Error("store required");
      await store.seed({
        academyId,
        normalized: loadApprovedLevelCatalog({ systemId: "ibjjf-v2" }),
      });
      await put("users/head-user-1", {
        userId: "head-user-1",
        academyId,
        accountType: "staff",
        active: true,
        status: "active",
      });
      await put("staff/staff-head-1", {
        staffId: "staff-head-1",
        academyId,
        userId: "head-user-1",
        role: "headCoach",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: created,
        createdBy: "owner",
        updatedAt: created,
        updatedBy: "owner",
      });
      await put("students/student-1", {
        studentId: "student-1",
        academyId,
        fullName: "Synthetic Adult",
        dateOfBirth: "1990-01-01",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        participantType: "adult",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: created,
        createdBy: "owner",
        updatedAt: created,
        updatedBy: "owner",
      });
      await put("sessions/session-1", {
        sessionId: "session-1",
        academyId,
        startAt: "2026-09-02T18:00:00.000Z",
        endAt: "2026-09-02T19:00:00.000Z",
      });
      for (const [id, occurredAt] of [
        ["att-1", "2026-08-20T18:00:00.000Z"],
        ["att-2", "2026-09-02T18:00:00.000Z"],
        ["att-3", "2026-09-05T18:00:00.000Z"],
      ] as const) {
        await put(`attendance/${id}`, {
          attendanceId: id,
          academyId,
          studentId: "student-1",
          sessionId: "session-1",
          state: "attended",
          correctionOf: null,
          occurredAt,
        });
      }

      const actor = {
        openedBy: "head-user-1",
        openedByStaffId: "staff-head-1",
        openedByRole: "headCoach" as const,
      };
      await store.openStudentLevel({
        academyId,
        input: {
          studentId: "student-1",
          definitionKey: "white-belt",
          decisionNotes: "Holds a white belt from Regyfit.",
          startedOn: "2026-07-01",
        },
        ...actor,
        openedAt: "2026-09-10T12:00:00.000Z",
      });
      // Plan D writes the baseline on import; here it is added directly to prove the count.
      await firestore!.doc(`academies/${academyId}/studentLevelProgress/student-1`).update({
        importedBaseline: { classes: 9, cutoff: "2026-09-01", source: "regyfit-import" },
      });

      const progress = await store.getStudentProgressSummary(academyId, "student-1");
      if (progress.state !== "initialized") throw new Error("expected initialized");
      // v2 white-1st-stripe: 25 classes, 75 days.
      expect(progress.criteria.classes).toEqual({
        required: 25,
        completed: 11,
        imported: 9,
        met: false,
      });

      const decision = {
        decidedBy: "head-user-1",
        decidedByStaffId: "staff-head-1",
        decidedByRole: "headCoach" as const,
        decidedAt: "2026-09-10T12:00:00.000Z",
      };
      await expect(
        store.assignLevel({
          academyId,
          input: {
            studentId: "student-1",
            fromDefinitionKey: "white-belt",
            toDefinitionKey: "white-2nd-stripe",
            promotedOn: "2026-09-10",
          },
          ...decision,
        }),
      ).rejects.toMatchObject({ code: "invalid" });
      const assigned = await store.assignLevel({
        academyId,
        input: {
          studentId: "student-1",
          fromDefinitionKey: "white-belt",
          toDefinitionKey: "white-2nd-stripe",
          promotedOn: "2026-09-10",
          note: "Competition result justifies it.",
        },
        ...decision,
      });
      expect(assigned.gaps).toEqual([
        "Skips 1 stripe",
        "Classes 11/25 not met",
        "Days 71/75 not met",
      ]);

      const voided = await store.voidPromotion({
        academyId,
        input: {
          studentId: "student-1",
          promotionId: assigned.promotionId,
          reason: "Assigned to the wrong member by mistake.",
        },
        ...decision,
        decidedAt: "2026-09-11T09:00:00.000Z",
      });
      expect(voided.restoredDefinitionKey).toBe("white-belt");
      const head = (
        await firestore!.doc(`academies/${academyId}/studentLevelProgress/student-1`).get()
      ).data();
      expect(head).toMatchObject({
        currentDefinitionKey: "white-belt",
        importedBaseline: { classes: 9 },
      });

      const history = await store.getStudentLevelHistory(academyId, "student-1");
      expect(
        history.entries.map((entry) => [
          entry.kind,
          entry.definitionKey,
          entry.voided?.reason ?? null,
        ]),
      ).toEqual([
        ["promotion", "white-2nd-stripe", "Assigned to the wrong member by mistake."],
        ["opening", "white-belt", null],
      ]);
    },
  );
});
```

(v2 `white-2nd-stripe` keeps 25 classes / 75 days from Regyfit, `16**25*75*`; if the Task 2 gate
changed those values, update the two numbers from `docs/data/ibjjf-criteria-diff-bpt-vs-regyfit.md`.)

- [ ] **Step 3: Run the rules test and the integration file in the emulator container**

Materialise the sparse directories first (Global Constraints). Then:

```bash
docker run --rm --network none \
  -v /root/BPT-Jersey:/root/BPT-Jersey -v /root/.cache/firebase:/root/.cache/firebase \
  -v /root/.cache/node:/root/.cache/node -e COREPACK_ENABLE_NETWORK=0 \
  -w /root/BPT-Jersey bpt-emu:local \
  bash -lc 'node_modules/.bin/firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,database "node_modules/.bin/vitest run --project rules qa/rules/client-data-boundary.test.ts" && node_modules/.bin/firebase emulators:exec --project demo-bpt-jersey --only firestore "node_modules/.bin/vitest run --project firestore-integration qa/integration/level-manage.test.ts"'
```

Expected: rules file passes (the two new collections deny every actor); integration `1 passed`
(not skipped — if it reports `skipped`, `FIRESTORE_EMULATOR_HOST` did not reach vitest; fix before
continuing, a skipped proof is not a proof).

- [ ] **Step 4: Commit**

```bash
git add qa/rules/client-data-boundary.test.ts qa/integration/level-manage.test.ts
git commit -m "test(levels): deny-direct level heads and promotions; emulator proof of open, baseline, assign and void (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Web client for the card, history, assignment, void and ratings

**Files:**

- Modify: `apps/web/src/lib/levels-client.ts` (append; imports at top)
- Test: `apps/web/src/lib/levels-manage-client.test.ts` (create)

**Interfaces:**

- Consumes: Task 6 schemas and types; callables from Task 12.
- Produces (exact exports used by Tasks 15–17):
  - `getStudentLevelCard(studentId: string): Promise<StudentLevelCard>` — calls `getStudentProgressSummary`.
  - `getStudentLevelHistory(studentId: string): Promise<StudentLevelHistory>`.
  - `assignLevel(input: AssignLevelInput): Promise<AssignLevelResult>`.
  - `voidPromotion(input: VoidPromotionInput): Promise<VoidPromotionResult>`.
  - `recordSkillRatings(input: RecordSkillRatingsInput): Promise<RecordSkillRatingsResult>` — calls `recordEvaluation`.
  - `getStudentSkillScores(studentId: string): Promise<{ latest: Readonly<Record<string, number>>; best: Readonly<Record<string, number>> }>` — calls `listStudentEvaluations`.
  - Safe messages (exported for tests and UI): `levelsSafeErrors = { card, history, assign, void, ratings, scores }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/levels-manage-client.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { name: string; data: unknown }[] = [];
let result: unknown;
let failure: Error | null = null;

vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => {
    calls.push({ name, data });
    if (failure) throw failure;
    return { data: result };
  },
}));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import {
  assignLevel,
  getStudentLevelCard,
  getStudentLevelHistory,
  getStudentSkillScores,
  levelsSafeErrors,
  recordSkillRatings,
  voidPromotion,
} from "./levels-client";

beforeEach(() => {
  calls.length = 0;
  failure = null;
  result = undefined;
});

describe("levels manage client", () => {
  it("validates the student id before calling and parses the card", async () => {
    await expect(getStudentLevelCard("../students")).rejects.toThrow(levelsSafeErrors.card);
    expect(calls).toHaveLength(0);
    result = {
      progress: {
        state: "initialized",
        studentId: "student-1",
        currentDefinition: { definitionKey: "white-belt" },
        targetDefinition: { definitionKey: "white-1st-stripe" },
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        progressPercent: 69,
        criteria: {
          classes: { required: 25, completed: 11, imported: 9, met: false },
          time: { requiredDays: 75, elapsedDays: 71, met: false },
        },
      },
    };
    const card = await getStudentLevelCard("student-1");
    expect(calls).toEqual([
      { name: "getStudentProgressSummary", data: { studentId: "student-1" } },
    ]);
    expect(card.state === "initialized" && card.progressPercent).toBe(69);
  });

  it("turns malformed responses and backend errors into the safe message", async () => {
    result = { progress: { state: "initialized", studentId: "student-1" } };
    await expect(getStudentLevelCard("student-1")).rejects.toThrow(levelsSafeErrors.card);
    failure = Object.assign(new Error("FirebaseError: permission-denied at academies/x"), {
      code: "functions/permission-denied",
    });
    await expect(getStudentLevelHistory("student-1")).rejects.toThrow(levelsSafeErrors.history);
  });

  it("assigns and voids with parsed inputs and matching results", async () => {
    const input = {
      studentId: "student-1",
      fromDefinitionKey: "white-belt",
      toDefinitionKey: "white-2nd-stripe",
      promotedOn: "2026-09-10",
      note: "Competition result justifies it.",
    };
    result = {
      promotionId: "grad_1",
      toDefinitionKey: "white-2nd-stripe",
      promotedOn: "2026-09-10",
      gaps: ["Skips 1 stripe"],
    };
    await expect(assignLevel(input)).resolves.toMatchObject({ gaps: ["Skips 1 stripe"] });
    expect(calls.at(-1)).toEqual({ name: "assignLevel", data: input });
    await expect(assignLevel({ ...input, note: "short" })).rejects.toThrow(levelsSafeErrors.assign);
    result = {
      promotionId: "grad_other",
      toDefinitionKey: "blue-belt",
      promotedOn: "2026-09-10",
      gaps: [],
    };
    await expect(assignLevel(input)).rejects.toThrow(levelsSafeErrors.assign);

    result = {
      voidId: "void_grad_1",
      voidsPromotionId: "grad_1",
      restoredDefinitionKey: "white-belt",
    };
    await expect(
      voidPromotion({
        studentId: "student-1",
        promotionId: "grad_1",
        reason: "Assigned to the wrong member.",
      }),
    ).resolves.toMatchObject({
      restoredDefinitionKey: "white-belt",
    });
    expect(calls.at(-1)?.name).toBe("voidPromotion");
  });

  it("sends ratings through recordEvaluation and reads latest and best scores", async () => {
    result = { recorded: 2 };
    await recordSkillRatings({
      studentId: "student-1",
      definitionKey: "white-belt",
      ratings: [
        { skillKey: "tie-the-belt", score: 3 },
        { skillKey: "warm-up-2-bridges", score: 4 },
      ],
    });
    expect(calls.at(-1)?.name).toBe("recordEvaluation");
    result = { recorded: 1 };
    await expect(
      recordSkillRatings({
        studentId: "student-1",
        definitionKey: "white-belt",
        ratings: [
          { skillKey: "tie-the-belt", score: 3 },
          { skillKey: "warm-up-2-bridges", score: 4 },
        ],
      }),
    ).rejects.toThrow(levelsSafeErrors.ratings);

    result = {
      evaluations: [{ evidenceNotes: "not needed by the view" }],
      summary: {
        "tie-the-belt": {
          count: 2,
          maxScore: 4,
          latestScore: 3,
          lastEvaluatedAt: "2026-09-10T12:00:00.000Z",
        },
      },
    };
    await expect(getStudentSkillScores("student-1")).resolves.toEqual({
      latest: { "tie-the-belt": 3 },
      best: { "tie-the-belt": 4 },
    });
    expect(calls.at(-1)).toEqual({
      name: "listStudentEvaluations",
      data: { studentId: "student-1" },
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/levels-manage-client.test.ts`
Expected: FAIL, `getStudentLevelCard` is not exported.

- [ ] **Step 3: Implement**

Append to `apps/web/src/lib/levels-client.ts` (and add `import { z } from "zod";` plus the named
imports below to the existing `@bpt-jersey/domain/levels` import):

```ts
// imports to add to the domain import list:
//   assignLevelInputSchema, assignLevelResultSchema, recordSkillRatingsInputSchema,
//   recordSkillRatingsResultSchema, studentLevelCardSchema, studentLevelHistorySchema,
//   studentSkillSummaryResponseSchema, voidPromotionInputSchema, voidPromotionResultSchema,
//   type AssignLevelInput, type AssignLevelResult, type RecordSkillRatingsInput,
//   type RecordSkillRatingsResult, type StudentLevelCard, type StudentLevelHistory,
//   type VoidPromotionInput, type VoidPromotionResult,

export type { StudentLevelCard, StudentLevelHistory };

export const levelsSafeErrors = Object.freeze({
  card: "Levels are unavailable right now. Please try again later.",
  history: "Unable to load the level history. Please try again.",
  assign: "Unable to assign the level. Check the date and the note, then try again.",
  void: "Unable to void the promotion. Please try again.",
  ratings: "Unable to save the ratings. Please try again.",
  scores: "Unable to load the skill ratings. Please try again.",
});

const opaqueStudentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Calls one callable and returns only what the schema accepts; every failure becomes `safeError`. */
async function callValidated<Output>(
  name: string,
  data: unknown,
  schema: z.ZodType<Output>,
  safeError: string,
): Promise<Output> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(data);
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) throw new Error(safeError);
    return parsed.data;
  } catch {
    throw new Error(safeError);
  }
}

function requireStudentId(studentId: string, safeError: string): void {
  if (!opaqueStudentIdPattern.test(studentId)) throw new Error(safeError);
}

export async function getStudentLevelCard(studentId: string): Promise<StudentLevelCard> {
  requireStudentId(studentId, levelsSafeErrors.card);
  const response = await callValidated(
    "getStudentProgressSummary",
    { studentId },
    z.object({ progress: studentLevelCardSchema }),
    levelsSafeErrors.card,
  );
  if (response.progress.studentId !== studentId) throw new Error(levelsSafeErrors.card);
  return response.progress;
}

export async function getStudentLevelHistory(studentId: string): Promise<StudentLevelHistory> {
  requireStudentId(studentId, levelsSafeErrors.history);
  const history = await callValidated(
    "getStudentLevelHistory",
    { studentId },
    studentLevelHistorySchema,
    levelsSafeErrors.history,
  );
  if (history.studentId !== studentId) throw new Error(levelsSafeErrors.history);
  return history;
}

export async function assignLevel(input: AssignLevelInput): Promise<AssignLevelResult> {
  const parsed = assignLevelInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(levelsSafeErrors.assign);
  const result = await callValidated(
    "assignLevel",
    parsed.data,
    assignLevelResultSchema,
    levelsSafeErrors.assign,
  );
  if (
    result.toDefinitionKey !== parsed.data.toDefinitionKey ||
    result.promotedOn !== parsed.data.promotedOn
  ) {
    throw new Error(levelsSafeErrors.assign);
  }
  return result;
}

export async function voidPromotion(input: VoidPromotionInput): Promise<VoidPromotionResult> {
  const parsed = voidPromotionInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(levelsSafeErrors.void);
  const result = await callValidated(
    "voidPromotion",
    parsed.data,
    voidPromotionResultSchema,
    levelsSafeErrors.void,
  );
  if (result.voidsPromotionId !== parsed.data.promotionId) throw new Error(levelsSafeErrors.void);
  return result;
}

export async function recordSkillRatings(
  input: RecordSkillRatingsInput,
): Promise<RecordSkillRatingsResult> {
  const parsed = recordSkillRatingsInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(levelsSafeErrors.ratings);
  const result = await callValidated(
    "recordEvaluation",
    parsed.data,
    recordSkillRatingsResultSchema,
    levelsSafeErrors.ratings,
  );
  if (result.recorded !== parsed.data.ratings.length) throw new Error(levelsSafeErrors.ratings);
  return result;
}

export async function getStudentSkillScores(
  studentId: string,
): Promise<
  Readonly<{ latest: Readonly<Record<string, number>>; best: Readonly<Record<string, number>> }>
> {
  requireStudentId(studentId, levelsSafeErrors.scores);
  const { summary } = await callValidated(
    "listStudentEvaluations",
    { studentId },
    studentSkillSummaryResponseSchema,
    levelsSafeErrors.scores,
  );
  const latest: Record<string, number> = {};
  const best: Record<string, number> = {};
  for (const [skillKey, item] of Object.entries(summary)) {
    latest[skillKey] = item.latestScore;
    best[skillKey] = item.maxScore;
  }
  return { latest, best };
}
```

- [ ] **Step 4: Run the web client tests**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/levels-manage-client.test.ts apps/web/src/lib/levels-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/levels-client.ts apps/web/src/lib/levels-manage-client.test.ts
git commit -m "feat(web): validated level card, history, assignment, void and ratings clients (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: IBJJF card on the PROFILE tab

**Files:**

- Modify: `apps/web/src/app/levels/levels-browser.tsx:30` (`function BeltBar` → `export function BeltBar`)
- Modify: `apps/web/src/app/levels/levels-grouping.ts` (append `beltPosition`), `apps/web/src/app/levels/levels-grouping.test.ts`
- Create: `apps/web/src/app/admin/members/profile/ibjjf-card.tsx`
- Create: `apps/web/src/app/admin/members/profile/ibjjf-card.test.tsx`
- Modify: `apps/web/src/app/admin/members/profile/member-record.tsx` (Plan B's `ibjjfCardSlot`), `member-record.test.tsx`
- Modify: `apps/web/src/app/admin/admin.css` (append the `/* T051V2 IBJJF */` block)

**Interfaces:**

- Consumes: `getStudentLevelCard`, `getLevelCatalog` (Task 14); `BeltBar`, `groupBelts`.
- Produces:
  - `beltPosition(groups: readonly BeltGroup[], definitionKey: string): { belt: LevelDefinitionRecord; definition: LevelDefinitionRecord; stripeCount: number } | null`.
  - `IbjjfCard({ studentId, canOpenLevel, manageHref }: { studentId: string; canOpenLevel: boolean; manageHref: string })` — a `<section aria-label="JIU-JITSU IBJJF">`.
  - `formatCriterion(done: number, min: number | null): string` (`"12/25"` or `"12"`).
  - CSS classes used by Tasks 16–17: `.ibjjf-card`, `.ibjjf-skeleton`, `.ibjjf-muted`, `.ibjjf-number`, `.ibjjf-progress`, `.ibjjf-criteria`, `.ibjjf-met`, `.ibjjf-unmet`, `.ibjjf-status`, `.ibjjf-manage`, `.ibjjf-form`, `.ibjjf-button`, `.ibjjf-dialog`, `.ibjjf-dialog-actions`, `.ibjjf-error`, `.ibjjf-notice`, `.ibjjf-history`, `.ibjjf-voided`, `.ibjjf-belt-mini`, `.ibjjf-skills`, `.ibjjf-skill-group`, `.ibjjf-skill`, `.ibjjf-minimum-text`, `.ibjjf-scores`, `.ibjjf-score`, `.ibjjf-score-minimum`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/app/levels/levels-grouping.test.ts` (add `beltPosition` to its import):

```ts
describe("beltPosition", () => {
  const belt = def({ definitionKey: "white-belt", kind: "belt", sequence: 1, name: "WHITE BELT" });
  const first = def({
    definitionKey: "white-1",
    kind: "stripe",
    sequence: 2,
    parentDefinitionKey: "white-belt",
    name: "White - 1st Stripe",
  });
  const second = def({
    definitionKey: "white-2",
    kind: "stripe",
    sequence: 3,
    parentDefinitionKey: "white-belt",
    name: "White - 2nd Stripe",
  });
  const groups = groupBelts({ definitions: [second, belt, first] });

  it("returns the parent belt and the stripe count for a stripe", () => {
    expect(beltPosition(groups, "white-2")).toEqual({ belt, definition: second, stripeCount: 2 });
    expect(beltPosition(groups, "white-belt")).toEqual({ belt, definition: belt, stripeCount: 0 });
    expect(beltPosition(groups, "missing")).toBeNull();
  });
});
```

Create `apps/web/src/app/admin/members/profile/ibjjf-card.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import businessCriteriaJson from "../../../../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { parseLevelCatalogSource } from "@bpt-jersey/domain/levels";

const levelsApi = vi.hoisted(() => ({
  getLevelCatalog: vi.fn(),
  getStudentLevelCard: vi.fn(),
}));
vi.mock("../../../../lib/levels-client", () => levelsApi);

import { IbjjfCard } from "./ibjjf-card";

const manageHref = "/admin/members/profile?id=student-1&view=manage";
const parsed = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!parsed.ok) throw new Error("catalogue must parse");
const catalog = { ...parsed.value, sourceHash: "test" };

const initialized = {
  state: "initialized",
  studentId: "student-1",
  currentDefinition: { definitionKey: "white-belt" },
  targetDefinition: { definitionKey: "white-1st-stripe" },
  currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
  progressPercent: 44,
  criteria: {
    classes: { required: 25, completed: 12, imported: 9, met: false },
    time: { requiredDays: 75, elapsedDays: 80, met: true },
  },
};

beforeEach(() => {
  levelsApi.getLevelCatalog.mockResolvedValue(catalog);
  levelsApi.getStudentLevelCard.mockReset();
});

describe("IbjjfCard", () => {
  it("renders the belt, one progress value and both criteria with met state as text", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue(initialized);
    render(<IbjjfCard canOpenLevel manageHref={manageHref} studentId="student-1" />);
    const card = await screen.findByRole("region", { name: "JIU-JITSU IBJJF" });
    expect(within(card).getByRole("img", { name: "WHITE BELT belt" })).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "WHITE BELT" })).toBeInTheDocument();
    expect(within(card).getByText("Promoted on 1 Jul 2026")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar", { name: "Next graduation" })).toHaveAttribute(
      "value",
      "44",
    );
    expect(within(card).getByText("44%")).toBeInTheDocument();
    const classes = within(card).getByText("Classes since last promotion").closest("div")!;
    expect(classes).toHaveClass("ibjjf-unmet");
    expect(within(classes).getByText("12/25")).toBeInTheDocument();
    expect(within(classes).getByText("Not met")).toBeInTheDocument();
    expect(within(classes).getByText("9 from Regyfit + 3 in BPT")).toBeInTheDocument();
    const days = within(card).getByText("Days at this level").closest("div")!;
    expect(days).toHaveClass("ibjjf-met");
    expect(within(days).getByText("80/75")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Manage" })).toHaveAttribute("href", manageHref);
  });

  it("shows the empty state with Open level only for deciders", async () => {
    levelsApi.getStudentLevelCard.mockResolvedValue({
      state: "uninitialized",
      studentId: "student-1",
    });
    const { rerender } = render(<IbjjfCard canOpenLevel manageHref="/m" studentId="student-1" />);
    expect(await screen.findByRole("heading", { name: "No level yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open level" })).toHaveAttribute("href", "/m");
    rerender(<IbjjfCard canOpenLevel={false} manageHref="/m" studentId="student-1" />);
    expect(screen.queryByRole("link", { name: "Open level" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage" })).toBeInTheDocument();
  });

  it("shows a skeleton while loading and a safe retry on failure", async () => {
    levelsApi.getStudentLevelCard.mockRejectedValueOnce(
      new Error("Levels are unavailable right now. Please try again later."),
    );
    render(<IbjjfCard canOpenLevel manageHref="/m" studentId="student-1" />);
    expect(screen.getByRole("region", { name: "JIU-JITSU IBJJF" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Levels are unavailable right now. Please try again later.",
    );
    levelsApi.getStudentLevelCard.mockResolvedValue(initialized);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "WHITE BELT" })).toBeInTheDocument(),
    );
  });
});
```

(The JSON import climbs seven levels: `profile → members → admin → app → src → web → apps → repo`.)

- [ ] **Step 2: Run them and watch them fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/levels/levels-grouping.test.ts apps/web/src/app/admin/members/profile/ibjjf-card.test.tsx`
Expected: FAIL (`beltPosition` and `./ibjjf-card` missing).

- [ ] **Step 3: Implement**

Append to `apps/web/src/app/levels/levels-grouping.ts`:

```ts
export type BeltPosition = Readonly<{
  belt: LevelDefinitionRecord;
  definition: LevelDefinitionRecord;
  stripeCount: number;
}>;

/** The belt a level sits on and how many stripe marks its bar carries. */
export function beltPosition(
  groups: readonly BeltGroup[],
  definitionKey: string,
): BeltPosition | null {
  for (const group of groups) {
    if (group.belt.definitionKey === definitionKey) {
      return { belt: group.belt, definition: group.belt, stripeCount: 0 };
    }
    const index = group.stripes.findIndex((stripe) => stripe.definitionKey === definitionKey);
    if (index >= 0)
      return { belt: group.belt, definition: group.stripes[index]!, stripeCount: index + 1 };
  }
  return null;
}
```

In `apps/web/src/app/levels/levels-browser.tsx` line 30: `export function BeltBar({`.

Create `apps/web/src/app/admin/members/profile/ibjjf-card.tsx`:

```tsx
"use client";

// Plain anchors, not next/link: MemberRecord reads ?id/&view on mount and on popstate only, so a
// full navigation is what switches between the record and the Manage view.
import { useEffect, useState } from "react";
import type { LevelCatalogProjection } from "@bpt-jersey/domain/levels";

import {
  getLevelCatalog,
  getStudentLevelCard,
  type StudentLevelCard,
} from "../../../../lib/levels-client";
import { BeltBar } from "../../../levels/levels-browser";
import { beltPosition, groupBelts } from "../../../levels/levels-grouping";

type CardState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; card: StudentLevelCard; catalog: LevelCatalogProjection }>;

const promotionDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Jersey",
});

export function formatCriterion(done: number, min: number | null): string {
  return min === null ? String(done) : `${done}/${min}`;
}

export function IbjjfCard({
  studentId,
  canOpenLevel,
  manageHref,
}: Readonly<{ studentId: string; canOpenLevel: boolean; manageHref: string }>) {
  const [state, setState] = useState<CardState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([getStudentLevelCard(studentId), getLevelCatalog()])
      .then(([card, catalog]) => {
        if (active) setState({ status: "ready", card, catalog });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [studentId, attempt]);

  if (state.status === "loading") {
    return (
      <section
        aria-busy="true"
        aria-label="JIU-JITSU IBJJF"
        className="ibjjf-card ibjjf-skeleton"
      />
    );
  }
  if (state.status === "error") {
    return (
      <section aria-label="JIU-JITSU IBJJF" className="ibjjf-card">
        <p className="admin-eyebrow">JIU-JITSU IBJJF</p>
        <h3>Levels unavailable</h3>
        <p className="ibjjf-error" role="alert">
          Levels are unavailable right now. Please try again later.
        </p>
        <button
          className="admin-auth-button"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((value) => value + 1);
          }}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }

  const { card, catalog } = state;
  if (card.state === "uninitialized") {
    return (
      <section aria-label="JIU-JITSU IBJJF" className="ibjjf-card">
        <p className="admin-eyebrow">JIU-JITSU IBJJF</p>
        <h3>No level yet</h3>
        <p>This member has no IBJJF level on record.</p>
        <a className="admin-auth-button" href={manageHref}>
          {canOpenLevel ? "Open level" : "Manage"}
        </a>
      </section>
    );
  }

  const position = beltPosition(groupBelts(catalog), card.currentDefinition.definitionKey);
  const { classes, time } = card.criteria;
  return (
    <section aria-label="JIU-JITSU IBJJF" className="ibjjf-card">
      <p className="admin-eyebrow">JIU-JITSU IBJJF</p>
      {position === null ? null : (
        <BeltBar
          name={position.belt.name}
          stripeCount={position.stripeCount}
          visual={position.belt.visual}
        />
      )}
      <h3>{position?.definition.name ?? "Level not in the current catalogue"}</h3>
      {card.currentLevelStartedAt === null ? null : (
        <p className="ibjjf-muted">
          Promoted on {promotionDate.format(new Date(card.currentLevelStartedAt))}
        </p>
      )}
      {card.targetDefinition === null ? (
        <p>Highest level reached</p>
      ) : (
        <div className="ibjjf-progress">
          <p id={`ibjjf-next-${studentId}`}>Next graduation</p>
          <progress
            aria-labelledby={`ibjjf-next-${studentId}`}
            max={100}
            value={card.progressPercent}
          />
          <strong className="ibjjf-number">{card.progressPercent}%</strong>
        </div>
      )}
      <dl className="ibjjf-criteria">
        <div className={classes.met ? "ibjjf-met" : "ibjjf-unmet"}>
          <dt>Classes since last promotion</dt>
          <dd>
            <span className="ibjjf-number">
              {formatCriterion(classes.completed, classes.required)}
            </span>{" "}
            <span className="ibjjf-status">{classes.met ? "Met" : "Not met"}</span>
          </dd>
          {classes.imported > 0 ? (
            <dd className="ibjjf-muted">
              {`${classes.imported} from Regyfit + ${classes.completed - classes.imported} in BPT`}
            </dd>
          ) : null}
        </div>
        <div className={time.met ? "ibjjf-met" : "ibjjf-unmet"}>
          <dt>Days at this level</dt>
          <dd>
            <span className="ibjjf-number">
              {formatCriterion(time.elapsedDays, time.requiredDays)}
            </span>{" "}
            <span className="ibjjf-status">{time.met ? "Met" : "Not met"}</span>
          </dd>
        </div>
      </dl>
      <a className="admin-auth-button" href={manageHref}>
        Manage
      </a>
    </section>
  );
}
```

The split text uses one template literal so `getByText("9 from Regyfit + 3 in BPT")` matches a
single text node; `getByText("12/25")` matches the `<span>`.

Append to `apps/web/src/app/admin/admin.css`:

```css
/* T051V2 IBJJF */
.ibjjf-card,
.ibjjf-form,
.ibjjf-history-section,
.ibjjf-skills {
  background: var(--gi-white);
  border: 2px solid var(--mat-ink);
  display: grid;
  gap: 0.75rem;
  min-width: 0;
  padding: 1.25rem;
}
.ibjjf-card h3,
.ibjjf-manage h2,
.ibjjf-manage h3,
.ibjjf-dialog h3 {
  font-family: var(--font-display), Impact, sans-serif;
  letter-spacing: 0.035em;
  line-height: 1;
  margin: 0;
  overflow-wrap: anywhere;
  text-transform: uppercase;
}
.ibjjf-skeleton {
  background: var(--paper-edge);
  border-color: var(--paper-edge);
  min-height: 16rem;
}
.ibjjf-muted {
  color: var(--muted);
  margin: 0;
}
.ibjjf-number {
  font-variant-numeric: tabular-nums;
}
.ibjjf-progress {
  align-items: center;
  display: grid;
  gap: 0.5rem 0.75rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
}
.ibjjf-progress p {
  font-weight: 600;
  margin: 0;
}
.ibjjf-progress progress {
  accent-color: var(--bpt-purple);
  height: 0.75rem;
  width: 100%;
}
.ibjjf-criteria {
  display: grid;
  gap: 0.5rem;
  margin: 0;
}
.ibjjf-criteria > div {
  padding: 0.35rem 0.75rem;
}
.ibjjf-criteria dt {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}
.ibjjf-criteria dd {
  margin: 0;
}
.ibjjf-met {
  border-left: 0.35rem solid #176b49;
}
.ibjjf-unmet {
  border-left: 0.35rem solid #c98b00;
}
.ibjjf-met .ibjjf-status {
  color: #176b49;
  font-weight: 700;
}
.ibjjf-unmet .ibjjf-status {
  color: #765400;
  font-weight: 700;
}
.ibjjf-manage {
  display: grid;
  gap: 1.5rem;
  max-width: 72rem;
  min-width: 0;
}
.ibjjf-form label,
.ibjjf-dialog label {
  display: grid;
  font-weight: 600;
  gap: 0.35rem;
}
.ibjjf-form select,
.ibjjf-form input,
.ibjjf-form textarea,
.ibjjf-dialog textarea {
  background: var(--gi-white);
  border: 1px solid var(--line);
  border-radius: 0;
  font: inherit;
  max-width: 100%;
  min-height: 3rem;
  padding: 0.6rem 0.75rem;
}
.ibjjf-form :focus-visible,
.ibjjf-dialog :focus-visible,
.ibjjf-button:focus-visible,
.ibjjf-skill-group summary:focus-visible,
.ibjjf-score input:focus-visible + span {
  outline: 3px solid var(--bpt-purple);
  outline-offset: 3px;
}
.ibjjf-button {
  background: var(--gi-white);
  border: 2px solid var(--mat-ink);
  border-radius: 0;
  color: var(--mat-ink);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  min-height: 3.15rem;
  padding: 0.5rem 1rem;
}
.ibjjf-dialog {
  background: var(--gi-white);
  border: 2px solid var(--mat-ink);
  box-shadow: 0 1.5rem 0 rgba(47, 36, 131, 0.12);
  display: grid;
  gap: 0.75rem;
  max-width: min(36rem, calc(100vw - 2rem));
  padding: 1.25rem;
  z-index: 20;
}
.ibjjf-dialog-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: flex-end;
}
.ibjjf-error {
  background: #fff0f2;
  border-left: 0.35rem solid #8d1c2f;
  color: #721626;
  margin: 0;
  padding: 0.5rem 0.75rem;
}
.ibjjf-notice {
  background: #e7f6ee;
  border-left: 0.35rem solid #176b49;
  margin: 0;
  padding: 0.5rem 0.75rem;
}
.ibjjf-history .ibjjf-voided td:nth-child(-n + 4) {
  color: var(--muted);
  text-decoration: line-through;
}
.ibjjf-belt-mini {
  display: inline-block;
  margin-right: 0.5rem;
  vertical-align: middle;
  width: 4rem;
}
.ibjjf-belt-mini .belt-bar {
  height: 1rem;
}
.ibjjf-belt-mini .belt-tip {
  gap: 0.1rem;
  min-width: 1.6rem;
  padding: 0 0.2rem;
}
.ibjjf-belt-mini .belt-tip i {
  height: 0.6rem;
  width: 0.15rem;
}
.ibjjf-belt-mini .belt-tip b {
  font-size: 0.55rem;
}
.ibjjf-skill-group {
  border: 1px solid var(--line);
}
.ibjjf-skill-group summary {
  align-items: center;
  cursor: pointer;
  display: flex;
  flex-wrap: wrap;
  font-weight: 700;
  gap: 0.5rem;
  justify-content: space-between;
  min-height: 44px;
  padding: 0.5rem 0.75rem;
}
.ibjjf-skill {
  border: 0;
  border-top: 1px solid var(--paper-edge);
  margin: 0;
  min-width: 0;
  padding: 0.75rem;
}
.ibjjf-skill legend {
  font-weight: 600;
  padding: 0;
}
.ibjjf-minimum-text {
  color: var(--muted);
  font-weight: 400;
}
.ibjjf-scores {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.ibjjf-score {
  position: relative;
}
.ibjjf-score input {
  height: 1px;
  margin: 0;
  opacity: 0;
  position: absolute;
  width: 1px;
}
.ibjjf-score span {
  align-items: center;
  border: 1px solid var(--line);
  cursor: pointer;
  display: inline-flex;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  height: 44px;
  justify-content: center;
  width: 44px;
}
.ibjjf-score-minimum span {
  box-shadow: inset 0 0 0 2px var(--mat-ink);
}
.ibjjf-score input:checked + span {
  background: var(--bpt-purple);
  border-color: var(--bpt-purple);
  color: var(--gi-white);
}
@media (max-width: 50rem) {
  .ibjjf-progress {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .ibjjf-progress p {
    grid-column: 1 / -1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ibjjf-card *,
  .ibjjf-manage * {
    transition: none;
  }
}
```

- [ ] **Step 4: Fill Plan B's `ibjjfCardSlot` in `member-record.tsx`**

In `apps/web/src/app/admin/members/profile/member-record.tsx` add the imports

```tsx
import { useAdminOrStaffSession } from "../../admin-gate";
import { IbjjfCard } from "./ibjjf-card";
```

at the top of `MemberRecord` add `const { role } = useAdminOrStaffSession();`, and replace Plan B's

```tsx
const ibjjfCardSlot: ReactNode = undefined;
```

with

```tsx
const ibjjfCardSlot: ReactNode =
  readyStudentId === undefined ? undefined : (
    <IbjjfCard
      canOpenLevel={role === "owner" || role === "headCoach"}
      manageHref={recordHref(readyStudentId, "profile", true)}
      studentId={readyStudentId}
    />
  );
```

In Plan B's `member-record.test.tsx`, add (next to its existing mocks)

```tsx
vi.mock("./ibjjf-card", () => ({ IbjjfCard: () => <section aria-label="JIU-JITSU IBJJF" /> }));
```

and, if that file does not already mock `../../admin-gate`, also
`vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: () => ({ role: "owner" }) }));`.
Add one assertion to its "ready" test: `expect(screen.getByRole("region", { name: "JIU-JITSU IBJJF" })).toBeTruthy();`.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/app/levels apps/web/src/app/admin/members/profile`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/levels/levels-browser.tsx apps/web/src/app/levels/levels-grouping.ts apps/web/src/app/levels/levels-grouping.test.ts apps/web/src/app/admin/members/profile/ibjjf-card.tsx apps/web/src/app/admin/members/profile/ibjjf-card.test.tsx apps/web/src/app/admin/members/profile/member-record.tsx apps/web/src/app/admin/members/profile/member-record.test.tsx apps/web/src/app/admin/admin.css
git commit -m "feat(web): JIU-JITSU IBJJF card with belt, single progress value and classes/days criteria (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Manage view — history, open level, assign with gaps, void

**Files:**

- Create: `apps/web/src/app/admin/members/profile/manage-view.tsx`
- Create: `apps/web/src/app/admin/members/profile/manage-view.test.tsx`
- Modify: `apps/web/src/app/admin/members/profile/member-record.tsx` (Plan B's `view` handling)

**Interfaces:**

- Consumes: Task 14 clients (`getLevelCatalog`, `getStudentLevelCard`, `getStudentLevelHistory`, `getStudentSkillScores`, `openStudentLevel`, `assignLevel`, `voidPromotion`); Task 15 `formatCriterion`, `beltPosition`, `BeltBar`; domain `listPromotionGaps`, `daysAtLevel`, `jerseyDateOf`; Task 17 `SkillsAssessment` (rendered here; until Task 17 lands, Step 3 below imports it — implement Task 17 Step 3 first if executing out of order).
- Produces: `ManageView({ studentId, fullName, age, role, recordHref }: { studentId: string; fullName: string; age: number | null; role: string; recordHref: string })`.
  Visible copy used by the E2E: headings "Level history", "Open level", "Assign next level";
  labels "Level", "Start date", "Notes", "Next level", "Promotion date", "Note", "Reason";
  buttons "Open level", "Review promotion", "Confirm promotion", "Void", "Void promotion", "Cancel";
  notices "Level opened.", "Level assigned.", "Promotion voided.", "Ratings saved.";
  dialog titles "Promote <name> from <X> to <Y> on <d MMM yyyy>?" and "Void the promotion of <name> to <Y>?".

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/admin/members/profile/manage-view.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import businessCriteriaJson from "../../../../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { parseLevelCatalogSource } from "@bpt-jersey/domain/levels";

const api = vi.hoisted(() => ({
  getLevelCatalog: vi.fn(),
  getStudentLevelCard: vi.fn(),
  getStudentLevelHistory: vi.fn(),
  getStudentSkillScores: vi.fn(),
  openStudentLevel: vi.fn(),
  assignLevel: vi.fn(),
  voidPromotion: vi.fn(),
  recordSkillRatings: vi.fn(),
}));
vi.mock("../../../../lib/levels-client", () => api);

import { ManageView } from "./manage-view";

const parsed = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!parsed.ok) throw new Error("catalogue must parse");
const catalog = { ...parsed.value, sourceHash: "test" };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Jersey" }).format(new Date());
const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

const card = {
  state: "initialized",
  studentId: "student-1",
  currentDefinition: { definitionKey: "white-belt" },
  targetDefinition: { definitionKey: "white-1st-stripe" },
  currentLevelStartedAt: `${thirtyDaysAgo}T00:00:00.000Z`,
  progressPercent: 44,
  criteria: {
    classes: { required: 25, completed: 12, imported: 9, met: false },
    time: { requiredDays: 75, elapsedDays: 30, met: false },
  },
};
const promotion = {
  entryId: "grad_student-1_white-1st-stripe_x",
  kind: "promotion",
  definitionKey: "white-belt",
  fromDefinitionKey: "grey-belt",
  assignedOn: thirtyDaysAgo,
  classes: { done: 30, min: 25 },
  days: { done: 90, min: 75 },
  decidedByRole: "owner",
  source: "bpt",
  note: null,
  gaps: [],
  voided: null,
};
const opening = {
  ...promotion,
  entryId: "opening_student-1",
  kind: "opening",
  definitionKey: "grey-belt",
  fromDefinitionKey: null,
  assignedOn: "2026-01-01",
  classes: null,
  days: null,
  source: "regyfit-import",
  decidedByRole: null,
};

function renderView(role = "owner") {
  return render(
    <ManageView
      age={30}
      fullName="Synthetic Member"
      recordHref="/admin/members/profile?id=student-1"
      role={role}
      studentId="student-1"
    />,
  );
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.getLevelCatalog.mockResolvedValue(catalog);
  api.getStudentLevelCard.mockResolvedValue(card);
  api.getStudentLevelHistory.mockResolvedValue({
    studentId: "student-1",
    currentDefinitionKey: "white-belt",
    entries: [promotion, opening],
  });
  api.getStudentSkillScores.mockResolvedValue({ latest: {}, best: {} });
});

describe("ManageView", () => {
  it("lists history with the current row, the importer and a void action on the latest promotion", async () => {
    renderView();
    const table = await screen.findByRole("table", { name: "Level history" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("WHITE BELT");
    expect(rows[1]).toHaveTextContent("30/25");
    expect(rows[1]).toHaveTextContent("Owner");
    expect(rows[1]).toHaveTextContent("Current");
    expect(within(rows[1]!).getByRole("button", { name: "Void" })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("Regyfit import");
    expect(within(rows[2]!).queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
  });

  it("assigns a later level only after the dialog lists gaps and a 10-500 character note is given", async () => {
    api.assignLevel.mockResolvedValue({
      promotionId: "grad_new",
      toDefinitionKey: "white-2nd-stripe",
      promotedOn: today,
      gaps: ["Skips 1 stripe"],
    });
    renderView();
    const form = await screen.findByRole("form", { name: "Assign next level" });
    const options = within(within(form).getByLabelText("Next level"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).not.toContain("WHITE BELT");
    expect(options).toContain("White - 2nd Stripe");
    fireEvent.change(within(form).getByLabelText("Next level"), {
      target: { value: "white-2nd-stripe" },
    });
    expect(within(form).getByLabelText("Promotion date")).toHaveValue("");
    expect(within(form).getByLabelText("Promotion date")).toHaveAttribute("max", today);
    fireEvent.change(within(form).getByLabelText("Promotion date"), { target: { value: today } });
    fireEvent.click(within(form).getByRole("button", { name: "Review promotion" }));

    const dialog = await screen.findByRole("dialog", {
      name: /^Promote Synthetic Member from WHITE BELT to White - 2nd Stripe on /,
    });
    expect(within(dialog).getByRole("list", { name: "Criteria not met" })).toHaveTextContent(
      "Skips 1 stripe",
    );
    expect(within(dialog).getByRole("list", { name: "Criteria not met" })).toHaveTextContent(
      "Classes 12/25 not met",
    );
    const confirm = within(dialog).getByRole("button", { name: "Confirm promotion" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^Note/), { target: { value: "too short" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^Note/), {
      target: { value: "Competition result justifies it." },
    });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(api.assignLevel).toHaveBeenCalledWith({
        studentId: "student-1",
        fromDefinitionKey: "white-belt",
        toDefinitionKey: "white-2nd-stripe",
        promotedOn: today,
        note: "Competition result justifies it.",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Level assigned.");
  });

  it("voids the latest promotion with a mandatory reason", async () => {
    api.voidPromotion.mockResolvedValue({
      voidId: "void_x",
      voidsPromotionId: promotion.entryId,
      restoredDefinitionKey: "grey-belt",
    });
    renderView("headCoach");
    fireEvent.click(await screen.findByRole("button", { name: "Void" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Void the promotion of Synthetic Member to WHITE BELT?",
    });
    const confirm = within(dialog).getByRole("button", { name: "Void promotion" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), {
      target: { value: "Assigned to the wrong member." },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.voidPromotion).toHaveBeenCalledWith({
        studentId: "student-1",
        promotionId: promotion.entryId,
        reason: "Assigned to the wrong member.",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Promotion voided.");
  });

  it("gives coaches the history and skills but no decisions", async () => {
    renderView("coach");
    await screen.findByRole("table", { name: "Level history" });
    expect(screen.queryByRole("form", { name: "Assign next level" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skills assessment" })).toBeInTheDocument();
  });

  it("opens a level with a required start date for a member without one", async () => {
    api.getStudentLevelCard.mockResolvedValue({ state: "uninitialized", studentId: "student-1" });
    api.getStudentLevelHistory.mockResolvedValue({
      studentId: "student-1",
      currentDefinitionKey: null,
      entries: [],
    });
    api.openStudentLevel.mockResolvedValue({});
    renderView();
    const form = await screen.findByRole("form", { name: "Open level" });
    fireEvent.change(within(form).getByLabelText("Level"), {
      target: { value: "white-1st-stripe" },
    });
    fireEvent.change(within(form).getByLabelText("Start date"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(within(form).getByLabelText("Notes"), {
      target: { value: "Holds this stripe from Regyfit." },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Open level" }));
    await waitFor(() =>
      expect(api.openStudentLevel).toHaveBeenCalledWith({
        studentId: "student-1",
        definitionKey: "white-1st-stripe",
        startedOn: "2026-07-01",
        decisionNotes: "Holds this stripe from Regyfit.",
      }),
    );
    expect(screen.getByText("No level history yet.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile/manage-view.test.tsx`
Expected: FAIL, cannot resolve `./manage-view`.

- [ ] **Step 3: Implement `manage-view.tsx`**

Create `apps/web/src/app/admin/members/profile/manage-view.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  daysAtLevel,
  jerseyDateOf,
  listPromotionGaps,
  type LevelCatalogProjection,
  type LevelHistoryEntry,
} from "@bpt-jersey/domain/levels";

import {
  assignLevel,
  getLevelCatalog,
  getStudentLevelCard,
  getStudentLevelHistory,
  getStudentSkillScores,
  openStudentLevel,
  voidPromotion,
  type StudentLevelCard,
  type StudentLevelHistory,
} from "../../../../lib/levels-client";
import { BeltBar } from "../../../levels/levels-browser";
import { beltPosition, groupBelts } from "../../../levels/levels-grouping";
import { formatCriterion } from "./ibjjf-card";
import { SkillsAssessment } from "./skills-assessment";

type Scores = Awaited<ReturnType<typeof getStudentSkillScores>>;
type Loaded = Readonly<{
  catalog: LevelCatalogProjection;
  card: StudentLevelCard;
  history: StudentLevelHistory;
  scores: Scores;
}>;
type ViewState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; data: Loaded }>;

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const formatDay = (day: string) => dayLabel.format(new Date(`${day}T00:00:00.000Z`));
const roleLabel = (role: "headCoach" | "owner" | null) =>
  role === "headCoach" ? "Head coach" : role === "owner" ? "Owner" : "—";
const noteIsValid = (value: string) => value.trim().length >= 10 && value.trim().length <= 500;

function ConfirmDialog({
  title,
  confirmLabel,
  confirmDisabled,
  busy,
  onCancel,
  onConfirm,
  children,
}: Readonly<{
  title: string;
  confirmLabel: string;
  confirmDisabled: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.querySelector<HTMLElement>("textarea, button")?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  return (
    <dialog
      aria-labelledby="ibjjf-dialog-title"
      className="ibjjf-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      open
      ref={ref}
    >
      <h3 id="ibjjf-dialog-title">{title}</h3>
      {children}
      <div className="ibjjf-dialog-actions">
        <button className="ibjjf-button" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="admin-auth-button"
          disabled={confirmDisabled || busy}
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

function OpenLevelForm({
  studentId,
  catalog,
  today,
  onDone,
}: Readonly<{
  studentId: string;
  catalog: LevelCatalogProjection;
  today: string;
  onDone: (notice: string) => void;
}>) {
  const [definitionKey, setDefinitionKey] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const levels = [...catalog.definitions].sort((left, right) => left.sequence - right.sequence);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!definitionKey || !startedOn || notes.trim().length < 3) {
      setError("Choose a level, a start date and write a short note.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await openStudentLevel({ studentId, definitionKey, startedOn, decisionNotes: notes.trim() });
      onDone("Level opened.");
    } catch {
      setError("Unable to open the level. It may already be open.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-labelledby="ibjjf-open-title"
      className="ibjjf-form"
      onSubmit={(event) => void submit(event)}
    >
      <h3 id="ibjjf-open-title">Open level</h3>
      <label htmlFor="ibjjf-open-level">Level</label>
      <select
        id="ibjjf-open-level"
        onChange={(event) => setDefinitionKey(event.target.value)}
        required
        value={definitionKey}
      >
        <option value="">Select a level</option>
        {levels.map((level) => (
          <option key={level.definitionKey} value={level.definitionKey}>
            {level.name}
          </option>
        ))}
      </select>
      <label htmlFor="ibjjf-open-date">Start date</label>
      <input
        id="ibjjf-open-date"
        max={today}
        onChange={(event) => setStartedOn(event.target.value)}
        required
        type="date"
        value={startedOn}
      />
      <label htmlFor="ibjjf-open-notes">Notes</label>
      <textarea
        id="ibjjf-open-notes"
        maxLength={1000}
        onChange={(event) => setNotes(event.target.value)}
        required
        value={notes}
      />
      {error === null ? null : (
        <p className="ibjjf-error" role="alert">
          {error}
        </p>
      )}
      <button className="admin-auth-button" disabled={busy} type="submit">
        Open level
      </button>
    </form>
  );
}

function AssignLevelForm({
  studentId,
  fullName,
  age,
  data,
  today,
  onDone,
}: Readonly<{
  studentId: string;
  fullName: string;
  age: number | null;
  data: Loaded;
  today: string;
  onDone: (notice: string) => void;
}>) {
  const { catalog, card, scores } = data;
  const [toKey, setToKey] = useState("");
  const [promotedOn, setPromotedOn] = useState("");
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (card.state !== "initialized") return null;

  const current = catalog.definitions.find(
    (definition) => definition.definitionKey === card.currentDefinition.definitionKey,
  );
  if (current === undefined) return null;
  const later = [...catalog.definitions]
    .filter((definition) => definition.sequence > current.sequence)
    .sort((left, right) => left.sequence - right.sequence);
  const target = later.find((definition) => definition.definitionKey === toKey);
  const startedOn = card.currentLevelStartedAt?.slice(0, 10);
  // ponytail: classes are the count as of today; the server recounts up to the promotion date and
  // refuses a missing note if its own gap list is not empty.
  const gaps =
    target === undefined || promotedOn === ""
      ? []
      : listPromotionGaps({
          definitions: catalog.definitions,
          requirements: catalog.requirements,
          fromDefinitionKey: current.definitionKey,
          toDefinitionKey: target.definitionKey,
          classesDone: card.criteria.classes.completed,
          daysDone: daysAtLevel(card.currentLevelStartedAt, `${promotedOn}T00:00:00.000Z`),
          skillScores: scores.best,
          ageYears: age,
        });
  const noteRequired = gaps.length > 0;
  const confirmDisabled = noteRequired
    ? !noteIsValid(note)
    : note.trim() !== "" && !noteIsValid(note);

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (target === undefined || promotedOn === "") {
      setError("Choose a level and a promotion date.");
      return;
    }
    setError(null);
    setReviewing(true);
  }

  async function confirm() {
    if (target === undefined || current === undefined) return;
    setBusy(true);
    try {
      await assignLevel({
        studentId,
        fromDefinitionKey: current.definitionKey,
        toDefinitionKey: target.definitionKey,
        promotedOn,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      });
      setReviewing(false);
      onDone("Level assigned.");
    } catch (failure) {
      setReviewing(false);
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to assign the level. Check the date and the note, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-labelledby="ibjjf-assign-title" className="ibjjf-form" onSubmit={review}>
      <h3 id="ibjjf-assign-title">Assign next level</h3>
      <label htmlFor="ibjjf-assign-level">Next level</label>
      <select
        id="ibjjf-assign-level"
        onChange={(event) => setToKey(event.target.value)}
        required
        value={toKey}
      >
        <option value="">Select a level</option>
        {later.map((level) => (
          <option key={level.definitionKey} value={level.definitionKey}>
            {level.name}
          </option>
        ))}
      </select>
      <label htmlFor="ibjjf-assign-date">Promotion date</label>
      <input
        id="ibjjf-assign-date"
        max={today}
        min={startedOn}
        onChange={(event) => setPromotedOn(event.target.value)}
        required
        type="date"
        value={promotedOn}
      />
      {error === null ? null : (
        <p className="ibjjf-error" role="alert">
          {error}
        </p>
      )}
      <button className="admin-auth-button" type="submit">
        Review promotion
      </button>
      {reviewing && target !== undefined ? (
        <ConfirmDialog
          busy={busy}
          confirmDisabled={confirmDisabled}
          confirmLabel="Confirm promotion"
          onCancel={() => setReviewing(false)}
          onConfirm={() => void confirm()}
          title={`Promote ${fullName} from ${current.name} to ${target.name} on ${formatDay(promotedOn)}?`}
        >
          {gaps.length === 0 ? (
            <p>All criteria for this level are met.</p>
          ) : (
            <ul aria-label="Criteria not met">
              {gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          )}
          <label htmlFor="ibjjf-assign-note">
            {noteRequired
              ? "Note (required, 10 to 500 characters)"
              : "Note (optional, 10 to 500 characters)"}
          </label>
          <textarea
            id="ibjjf-assign-note"
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            required={noteRequired}
            value={note}
          />
        </ConfirmDialog>
      ) : null}
    </form>
  );
}

function HistoryTable({
  history,
  catalog,
  canDecide,
  onVoid,
}: Readonly<{
  history: StudentLevelHistory;
  catalog: LevelCatalogProjection;
  canDecide: boolean;
  onVoid: (entry: LevelHistoryEntry) => void;
}>) {
  const groups = groupBelts(catalog);
  const names = new Map(
    catalog.definitions.map((definition) => [definition.definitionKey, definition.name]),
  );
  const current = history.entries.find(
    (entry) => entry.voided === null && entry.definitionKey === history.currentDefinitionKey,
  );
  const voidable = history.entries.find(
    (entry) => entry.kind === "promotion" && entry.voided === null,
  );

  return (
    <section aria-labelledby="ibjjf-history-title" className="ibjjf-history-section">
      <h3 id="ibjjf-history-title">Level history</h3>
      {history.entries.length === 0 ? (
        <p>No level history yet.</p>
      ) : (
        <div className="admin-data-table-wrap">
          <table aria-labelledby="ibjjf-history-title" className="admin-data-table ibjjf-history">
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Assigned on</th>
                <th scope="col">Classes</th>
                <th scope="col">Days</th>
                <th scope="col">Promoted by</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.entries.map((entry) => {
                const position = beltPosition(groups, entry.definitionKey);
                return (
                  <tr
                    className={entry.voided === null ? undefined : "ibjjf-voided"}
                    key={entry.entryId}
                  >
                    <td>
                      {position === null ? null : (
                        <span aria-hidden="true" className="ibjjf-belt-mini">
                          <BeltBar
                            name={position.belt.name}
                            stripeCount={position.stripeCount}
                            visual={position.belt.visual}
                          />
                        </span>
                      )}
                      {names.get(entry.definitionKey) ?? entry.definitionKey}
                    </td>
                    <td className="ibjjf-number">{formatDay(entry.assignedOn)}</td>
                    <td className="ibjjf-number">
                      {entry.classes === null
                        ? "—"
                        : formatCriterion(entry.classes.done, entry.classes.min)}
                    </td>
                    <td className="ibjjf-number">
                      {entry.days === null ? "—" : formatCriterion(entry.days.done, entry.days.min)}
                    </td>
                    <td>
                      {entry.source === "regyfit-import"
                        ? "Regyfit import"
                        : roleLabel(entry.decidedByRole)}
                    </td>
                    <td>
                      {entry.voided !== null
                        ? `Voided by ${roleLabel(entry.voided.voidedByRole)} on ${formatDay(entry.voided.voidedOn)}: ${entry.voided.reason}`
                        : entry.entryId === current?.entryId
                          ? "Current"
                          : "Previous"}
                    </td>
                    <td>
                      {canDecide &&
                      voidable?.entryId === entry.entryId &&
                      entry.entryId === current?.entryId ? (
                        <button
                          className="ibjjf-button"
                          onClick={() => onVoid(entry)}
                          type="button"
                        >
                          Void
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ManageView({
  studentId,
  fullName,
  age,
  role,
  recordHref,
}: Readonly<{
  studentId: string;
  fullName: string;
  age: number | null;
  role: string;
  recordHref: string;
}>) {
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<LevelHistoryEntry | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [dirtyRatings, setDirtyRatings] = useState(false);
  const canDecide = role === "owner" || role === "headCoach";
  const canRate = canDecide || role === "coach";
  const today = jerseyDateOf(new Date().toISOString());

  useEffect(() => {
    let active = true;
    Promise.all([
      getLevelCatalog(),
      getStudentLevelCard(studentId),
      getStudentLevelHistory(studentId),
      getStudentSkillScores(studentId),
    ])
      .then(([catalog, card, history, scores]) => {
        if (active) setState({ status: "ready", data: { catalog, card, history, scores } });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [studentId, attempt]);

  const reload = useCallback((message: string) => {
    setNotice(message);
    setAttempt((value) => value + 1);
  }, []);

  async function confirmVoid() {
    if (voiding === null) return;
    setBusy(true);
    setVoidError(null);
    try {
      await voidPromotion({ studentId, promotionId: voiding.entryId, reason: reason.trim() });
      setVoiding(null);
      setReason("");
      reload("Promotion voided.");
    } catch (failure) {
      setVoidError(
        failure instanceof Error
          ? failure.message
          : "Unable to void the promotion. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const data = state.status === "ready" ? state.data : null;
  const targetKey =
    data?.card.state === "initialized" ? data.card.targetDefinition?.definitionKey : undefined;
  const minimums = Object.fromEntries(
    (data?.catalog.requirements ?? [])
      .filter((requirement) => requirement.definitionKey === targetKey)
      .map((requirement) => [requirement.skillKey, requirement.minimumRating]),
  );

  return (
    <section aria-labelledby="ibjjf-manage-title" className="ibjjf-manage">
      <a
        className="admin-text-link"
        href={recordHref}
        onClick={(event) => {
          if (dirtyRatings && !window.confirm("Discard unsaved ratings?")) event.preventDefault();
        }}
      >
        Back to record
      </a>
      <p className="admin-eyebrow">JIU-JITSU IBJJF / MANAGE</p>
      <h2 id="ibjjf-manage-title">{fullName}</h2>
      <p className="ibjjf-muted">
        {age === null ? "Age unknown" : `${age} years old`} ·{" "}
        {data?.catalog.system.displayName ?? "JIU-JITSU - IBJJF"}
      </p>
      {notice === null ? null : (
        <p className="ibjjf-notice" role="status">
          {notice}
        </p>
      )}
      {state.status === "loading" ? (
        <div aria-busy="true" className="ibjjf-card ibjjf-skeleton" />
      ) : null}
      {state.status === "error" ? (
        <p className="ibjjf-error" role="alert">
          Levels are unavailable right now. Please try again later.
        </p>
      ) : null}
      {data === null ? null : (
        <>
          {data.card.state === "uninitialized" ? (
            canDecide ? (
              <OpenLevelForm
                catalog={data.catalog}
                onDone={reload}
                studentId={studentId}
                today={today}
              />
            ) : (
              <p>No level yet. A head coach or the owner opens it.</p>
            )
          ) : canDecide ? (
            <AssignLevelForm
              age={age}
              data={data}
              fullName={fullName}
              onDone={reload}
              studentId={studentId}
              today={today}
            />
          ) : null}
          <HistoryTable
            canDecide={canDecide}
            catalog={data.catalog}
            history={data.history}
            onVoid={(entry) => {
              setReason("");
              setVoidError(null);
              setVoiding(entry);
            }}
          />
          {data.card.state === "initialized" && canRate ? (
            <SkillsAssessment
              definitionKey={data.card.currentDefinition.definitionKey}
              initialScores={data.scores.latest}
              key={`skills-${attempt}`}
              minimums={minimums}
              onDirtyChange={setDirtyRatings}
              onSaved={() => reload("Ratings saved.")}
              skills={data.catalog.skills}
              studentId={studentId}
            />
          ) : null}
        </>
      )}
      {voiding === null || data === null ? null : (
        <ConfirmDialog
          busy={busy}
          confirmDisabled={!noteIsValid(reason)}
          confirmLabel="Void promotion"
          onCancel={() => setVoiding(null)}
          onConfirm={() => void confirmVoid()}
          title={`Void the promotion of ${fullName} to ${data.catalog.definitions.find((definition) => definition.definitionKey === voiding.definitionKey)?.name ?? voiding.definitionKey}?`}
        >
          <p>
            The previous level is restored. The promotion stays in the history, marked as voided.
          </p>
          <label htmlFor="ibjjf-void-reason">Reason (required, 10 to 500 characters)</label>
          <textarea
            id="ibjjf-void-reason"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
          {voidError === null ? null : (
            <p className="ibjjf-error" role="alert">
              {voidError}
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
```

Notes that make the test pass exactly:

- `<form aria-labelledby>` gives the form role `form` with the heading as its name.
- The table is named by the `Level history` heading through `aria-labelledby`.
- `formatDay` uses `timeZone: "UTC"` because history days are calendar dates, not instants.

- [ ] **Step 4: Route `&view=manage` in Plan B's record**

In `member-record.tsx` add `import { ManageView } from "./manage-view";` and change the first branch
of Plan B's `panel(profile)` from

```tsx
if (activeTab === "profile") {
  return <ProfileTab profile={profile} ibjjfCardSlot={ibjjfCardSlot} />;
}
```

to

```tsx
if (activeTab === "profile") {
  return location?.manage ? (
    <ManageView
      age={profile.header.age}
      fullName={profile.header.fullName}
      recordHref={recordHref(profile.header.studentId)}
      role={role}
      studentId={profile.header.studentId}
    />
  ) : (
    <ProfileTab profile={profile} ibjjfCardSlot={ibjjfCardSlot} />
  );
}
```

(`role` is the value added in Task 15 Step 4.) In `member-record.test.tsx` add
`vi.mock("./manage-view", () => ({ ManageView: () => <section aria-label="Manage IBJJF" /> }));` and a
test that sets `window.history.replaceState(null, "", "/admin/members/profile?id=student-1&view=manage")`
before rendering the record (with the ready profile mock Plan B's tests already use) and asserts
`await screen.findByRole("region", { name: "Manage IBJJF" })` and
`screen.queryByRole("region", { name: "JIU-JITSU IBJJF" })` is null.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile`
Expected: PASS (requires Task 17 Step 3 file to exist; if executing strictly in order, create
`skills-assessment.tsx` from Task 17 Step 3 before this run).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/members/profile/manage-view.tsx apps/web/src/app/admin/members/profile/manage-view.test.tsx apps/web/src/app/admin/members/profile/member-record.tsx apps/web/src/app/admin/members/profile/member-record.test.tsx
git commit -m "feat(web): IBJJF manage view with history, open level, gap-aware assignment and void (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Skills assessment

**Files:**

- Create: `apps/web/src/app/admin/members/profile/skills-assessment.tsx`
- Create: `apps/web/src/app/admin/members/profile/skills-assessment.test.tsx`

**Interfaces:**

- Consumes: `recordSkillRatings` (Task 14); `skillCategory` (Task 5); `SkillDefinition`.
- Produces: `SkillsAssessment({ studentId, definitionKey, skills, minimums, initialScores, onDirtyChange, onSaved })` with
  `minimums: Readonly<Record<string, number>>`, `initialScores: Readonly<Record<string, number>>`,
  `onDirtyChange: (dirty: boolean) => void`, `onSaved: () => void`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/admin/members/profile/skills-assessment.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ recordSkillRatings: vi.fn() }));
vi.mock("../../../../lib/levels-client", () => api);

import { SkillsAssessment } from "./skills-assessment";

const skills = [
  {
    key: "tie-the-belt",
    displayLabel: "Tie The Belt",
    observedLabel: "1. Tie The Belt",
    minimumRating: 2,
    sequence: 1,
  },
  {
    key: "warm-up-1-technical-stand-up",
    displayLabel: "Warm Up 1 - Technical Stand Up",
    observedLabel: null,
    minimumRating: 3,
    sequence: 2,
  },
  {
    key: "warm-up-2-bridges",
    displayLabel: "Warm Up 2 - Bridges",
    observedLabel: null,
    minimumRating: 3,
    sequence: 3,
  },
];

function renderAssessment(overrides: Partial<Parameters<typeof SkillsAssessment>[0]> = {}) {
  const props = {
    studentId: "student-1",
    definitionKey: "white-belt",
    skills,
    minimums: { "warm-up-1-technical-stand-up": 3, "warm-up-2-bridges": 3 },
    initialScores: { "warm-up-1-technical-stand-up": 4 },
    onDirtyChange: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  render(<SkillsAssessment {...props} />);
  return props;
}

beforeEach(() => api.recordSkillRatings.mockReset());

describe("SkillsAssessment", () => {
  it("groups skills by category with rated and minimum counts, collapsed by default", () => {
    renderAssessment();
    const warmUp = screen.getByText("Warm Up").closest("details")!;
    expect(warmUp).not.toHaveAttribute("open");
    expect(within(warmUp).getByText("1/2 rated · 1/2 minimum met")).toBeInTheDocument();
    const fundamentals = screen.getByText("Fundamentals").closest("details")!;
    expect(within(fundamentals).getByText("0/1 rated")).toBeInTheDocument();
  });

  it("marks the minimum with text and an outlined option", () => {
    renderAssessment();
    const bridges = screen.getByRole("group", { name: /Warm Up 2 - Bridges/ });
    expect(within(bridges).getByText("Minimum 3")).toBeInTheDocument();
    expect(within(bridges).getByRole("radio", { name: "3" }).closest("label")).toHaveClass(
      "ibjjf-score-minimum",
    );
    expect(within(bridges).getAllByRole("radio")).toHaveLength(5);
  });

  it("saves only changed ratings explicitly and reports dirty state", async () => {
    api.recordSkillRatings.mockResolvedValue({ recorded: 1 });
    const props = renderAssessment();
    const save = screen.getByRole("button", { name: "Save ratings" });
    expect(save).toBeDisabled();
    const bridges = screen.getByRole("group", { name: /Warm Up 2 - Bridges/ });
    fireEvent.click(within(bridges).getByRole("radio", { name: "4" }));
    expect(screen.getByRole("status")).toHaveTextContent("You have unsaved ratings.");
    await waitFor(() => expect(props.onDirtyChange).toHaveBeenLastCalledWith(true));
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.recordSkillRatings).toHaveBeenCalledWith({
        studentId: "student-1",
        definitionKey: "white-belt",
        ratings: [{ skillKey: "warm-up-2-bridges", score: 4 }],
      }),
    );
    expect(props.onSaved).toHaveBeenCalled();
  });

  it("shows the safe error when saving fails and keeps the ratings", async () => {
    api.recordSkillRatings.mockRejectedValue(
      new Error("Unable to save the ratings. Please try again."),
    );
    renderAssessment();
    fireEvent.click(
      within(screen.getByRole("group", { name: /Tie The Belt/ })).getByRole("radio", { name: "2" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save ratings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to save the ratings. Please try again.",
    );
    expect(
      within(screen.getByRole("group", { name: /Tie The Belt/ })).getByRole("radio", { name: "2" }),
    ).toBeChecked();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile/skills-assessment.test.tsx`
Expected: FAIL, cannot resolve `./skills-assessment`.

- [ ] **Step 3: Implement**

Create `apps/web/src/app/admin/members/profile/skills-assessment.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { skillCategory, type SkillDefinition } from "@bpt-jersey/domain/levels";

import { recordSkillRatings } from "../../../../lib/levels-client";

const scoreValues = [1, 2, 3, 4, 5] as const;
type Score = (typeof scoreValues)[number];

export function SkillsAssessment({
  studentId,
  definitionKey,
  skills,
  minimums,
  initialScores,
  onDirtyChange,
  onSaved,
}: Readonly<{
  studentId: string;
  definitionKey: string;
  skills: readonly SkillDefinition[];
  minimums: Readonly<Record<string, number>>;
  initialScores: Readonly<Record<string, number>>;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}>) {
  const [scores, setScores] = useState<Record<string, Score>>(
    () => ({ ...initialScores }) as Record<string, Score>,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = skills.filter(
    (skill) => scores[skill.key] !== undefined && scores[skill.key] !== initialScores[skill.key],
  );
  const dirty = changed.length > 0;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, SkillDefinition[]>();
    for (const skill of [...skills].sort((left, right) => left.sequence - right.sequence)) {
      const category = skillCategory(skill.displayLabel);
      byCategory.set(category, [...(byCategory.get(category) ?? []), skill]);
    }
    return [...byCategory.entries()];
  }, [skills]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await recordSkillRatings({
        studentId,
        definitionKey,
        ratings: changed.map((skill) => ({ skillKey: skill.key, score: scores[skill.key]! })),
      });
      onDirtyChange(false);
      onSaved();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to save the ratings. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ibjjf-skills-title" className="ibjjf-skills">
      <h3 id="ibjjf-skills-title">Skills assessment</h3>
      <p className="ibjjf-muted">Rate each skill from 1 to 5. Minimums apply to the next level.</p>
      {groups.map(([category, groupSkills]) => {
        const rated = groupSkills.filter((skill) => scores[skill.key] !== undefined).length;
        const withMinimum = groupSkills.filter((skill) => minimums[skill.key] !== undefined);
        const met = withMinimum.filter(
          (skill) => (scores[skill.key] ?? 0) >= minimums[skill.key]!,
        ).length;
        return (
          <details className="ibjjf-skill-group" key={category}>
            <summary>
              <span>{category}</span>
              <span className="ibjjf-number">
                {`${rated}/${groupSkills.length} rated${withMinimum.length > 0 ? ` · ${met}/${withMinimum.length} minimum met` : ""}`}
              </span>
            </summary>
            {groupSkills.map((skill) => {
              const minimum = minimums[skill.key];
              return (
                <fieldset className="ibjjf-skill" key={skill.key}>
                  <legend>
                    {skill.displayLabel}
                    {minimum === undefined ? null : (
                      <span className="ibjjf-minimum-text">{` Minimum ${minimum}`}</span>
                    )}
                  </legend>
                  <div className="ibjjf-scores">
                    {scoreValues.map((score) => (
                      <label
                        className={
                          score === minimum ? "ibjjf-score ibjjf-score-minimum" : "ibjjf-score"
                        }
                        key={score}
                      >
                        <input
                          checked={scores[skill.key] === score}
                          name={`skill-${skill.key}`}
                          onChange={() =>
                            setScores((current) => ({ ...current, [skill.key]: score }))
                          }
                          type="radio"
                          value={score}
                        />
                        <span>{score}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </details>
        );
      })}
      {dirty ? (
        <p className="ibjjf-notice ibjjf-unmet" role="status">
          You have unsaved ratings.
        </p>
      ) : null}
      {error === null ? null : (
        <p className="ibjjf-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="admin-auth-button"
        disabled={!dirty || busy}
        onClick={() => void save()}
        type="button"
      >
        Save ratings
      </button>
    </section>
  );
}
```

(The legend's minimum text is `" Minimum 3"` in its own `<span>`, so `getByText("Minimum 3")` matches
after the default whitespace normalisation.)

- [ ] **Step 4: Run all profile component tests**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile`
Expected: PASS (card, manage view, skills assessment, Plan B tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/members/profile/skills-assessment.tsx apps/web/src/app/admin/members/profile/skills-assessment.test.tsx
git commit -m "feat(web): skills assessment with collapsible categories, 1-5 ratings, minimum markers and explicit save (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: End-to-end proof of Plans B and C on emulators (desktop and 390px, axe, screenshots)

**Files:**

- Modify: `qa/package.json` (devDependency `axe-core`, operator gate)
- Create: `qa/scripts/run-member-profile-ui-e2e.mjs`
- Modify: `qa/run-e2e.mjs:36-137` (forward the two new variables)
- Create: `qa/tests/member-profile.spec.ts`
- Create (evidence): `qa/screenshots/t051-*.png`

**Interfaces:**

- Consumes: every earlier task and Plan B's search, record, DETAILS and birthday chip; T093 seeding
  (`qa/scripts/seed-member-directory-emulator.mjs`, `apps/functions/scripts/member-directory-empty-initialize.mjs`);
  level seed CLI (Task 4).
- Produces: evidence recorded in Task 19.

- [ ] **Step 1: OPERATOR GATE — axe dependency**

Ask the operator in chat: "¿Autorizas añadir `axe-core@4.13.0` como devDependency de `qa`? Ya está en
el lockfile vía `eslint-plugin-jsx-a11y`, no descarga nada nuevo." On yes:

```bash
corepack pnpm --filter @bpt-jersey/qa add -D axe-core@4.13.0 --offline
git diff --stat pnpm-lock.yaml qa/package.json
```

Expected: only `qa/package.json` and the importer block of `pnpm-lock.yaml` change. On no: delete
the `expectNoSeriousAxeViolations` helper and its calls from Step 3 and record "axe no autorizado"
in the evidence; the ARIA role assertions in the spec remain the accessibility check.

- [ ] **Step 2: Forward the variables and write the runner**

In `qa/run-e2e.mjs`, add to the forwarded list (after `"CS_IMPORT_UI_EMULATOR_E2E",`):

```js
  "MEMBER_PROFILE_UI_EMULATOR_E2E",
  "MEMBER_PROFILE_E2E_ACADEMY_ID",
```

Create `qa/scripts/run-member-profile-ui-e2e.mjs`:

```js
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// T051V2: member record (Plan B) + JIU-JITSU IBJJF (Plan C) through the static web build, real Auth,
// Functions and Firestore emulators. Run inside `firebase emulators:exec --only auth,firestore,functions`.
const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";
const academyId = "member-profile-e2e";

if (
  process.env.MEMBER_PROFILE_UI_EMULATOR_E2E !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_ENV !== "local" ||
  process.env.NEXT_PUBLIC_ADMIN_E2E ||
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
) {
  throw new Error("Member profile runner requires explicit local demo-project emulator flags.");
}
for (const name of [
  "AUTH_EMULATOR_E2E_EMAIL",
  "AUTH_EMULATOR_E2E_PASSWORD",
  "MEMBER_DIRECTORY_IDENTITY_KEY_SECRET",
  "MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET",
  "MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET",
]) {
  if (!process.env[name]?.trim()) throw new Error(`Missing required environment: ${name}`);
}

const suiteEnvironment = {
  ...process.env,
  AUTH_EMULATOR_E2E: "true",
  AUTH_EMULATOR_E2E_ROLE: "owner",
  AUTH_EMULATOR_E2E_ACADEMY_ID: academyId,
  T093_E2E_ACADEMY_ID: academyId,
  MEMBER_PROFILE_E2E_ACADEMY_ID: academyId,
  GCLOUD_PROJECT: projectId,
};

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: suiteEnvironment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["qa/scripts/seed-auth-emulator.mjs"]);
run(["qa/scripts/seed-member-directory-emulator.mjs"]);
run([
  "apps/functions/scripts/member-directory-empty-initialize.mjs",
  `--academy-id=${academyId}`,
  "--confirmation=T093-EMPTY-CANONICAL-INITIALIZE",
]);
run([
  "apps/functions/scripts/seed-levels.mjs",
  "--target=emulator",
  `--academy-id=${academyId}`,
  "--system-id=ibjjf-v2",
]);
run([
  "qa/run-e2e.mjs",
  "tests/member-profile.spec.ts",
  "--project=desktop-chromium",
  "--workers=1",
  "--retries=0",
]);
```

- [ ] **Step 3: Write the spec**

Create `qa/tests/member-profile.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const enabled = process.env.MEMBER_PROFILE_UI_EMULATOR_E2E === "true";
const projectId = "demo-bpt-jersey";
const academyId = process.env.MEMBER_PROFILE_E2E_ACADEMY_ID ?? "member-profile-e2e";
const functionsBaseUrl = `http://127.0.0.1:5001/${projectId}/us-central1`;
const authUrl =
  "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo";
const require = createRequire(import.meta.url);
const dayMs = 86_400_000;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:member-profile-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

const jerseyDay = (instant: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Jersey" }).format(instant);
const utcDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * dayMs).toISOString().slice(0, 10);

let studentId = "";
let fullName = "";

async function ownerIdToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(authUrl, {
    data: {
      email: process.env.AUTH_EMULATOR_E2E_EMAIL,
      password: process.env.AUTH_EMULATOR_E2E_PASSWORD,
      returnSecureToken: true,
    },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { idToken: string }).idToken;
}

async function signInOwner(page: Page): Promise<void> {
  await page.route("http://127.0.0.1:5001/**", (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-firebase-appcheck": syntheticAppCheckToken() },
    }),
  );
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.AUTH_EMULATOR_E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.AUTH_EMULATOR_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account/u);
}

async function expectNoSeriousAxeViolations(page: Page, label: string): Promise<void> {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: Document,
          ) => Promise<{ violations: { id: string; impact: string | null; nodes: unknown[] }[] }>;
        };
      }
    ).axe;
    const result = await axe.run(document);
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
      }));
  });
  expect(violations, label).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("T051V2 member record and JIU-JITSU IBJJF on Firebase Emulators", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !enabled || !process.env.AUTH_EMULATOR_E2E_EMAIL,
    "Member profile emulator flags and synthetic owner are required.",
  );

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const idToken = await ownerIdToken(request);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toUpperCase();
    fullName = `Synthetic Profile ${suffix}`;
    // Birthday in three days, thirty years ago, so the chip reads "Birthday in 3 days".
    const birthday = new Date(Date.now() + 3 * dayMs);
    const dateOfBirth = `${birthday.getUTCFullYear() - 30}-${String(birthday.getUTCMonth() + 1).padStart(2, "0")}-${String(birthday.getUTCDate()).padStart(2, "0")}`;
    const created = await request.post(`${functionsBaseUrl}/createMember`, {
      headers: {
        Authorization: `Bearer ${idToken}`,
        "X-Firebase-AppCheck": syntheticAppCheckToken(),
      },
      data: {
        data: {
          requestId: `t051-create-${suffix}`,
          fullName,
          dateOfBirth,
          phoneNumber: "+441534000051",
          email: `t051-${suffix.toLowerCase()}@example.test`,
          trainingCenter: "Town",
          trainingTimePreferences: ["evening"],
          membershipNumber: `BPT T051 ${suffix}`,
          gender: "unknown",
          emergencyContact: {
            fullName: "Synthetic T051 Contact",
            relationship: "Spouse",
            phoneNumber: "+441534000052",
          },
          postalAddress: { line: "1 Synthetic Street, St Helier", postCode: "JE2 3AB" },
        },
      },
    });
    expect(created.status(), await created.text()).toBe(200);
    studentId = ((await created.json()) as { result: { studentId: string } }).result.studentId;
    await request.dispose();

    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
    const app: App = initializeApp({ projectId }, `t051-member-profile-${suffix}`);
    try {
      const firestore = getFirestore(app);
      const root = `academies/${academyId}`;
      const startedAt = `${utcDay(-30)}T00:00:00.000Z`;
      await firestore.doc(`${root}/studentLevelProgress/${studentId}`).set({
        academyId,
        studentId,
        systemId: "ibjjf-v2",
        currentDefinitionKey: "white-belt",
        currentLevelStartedAt: startedAt,
        lastApprovedPromotionId: null,
        openedByStaffId: null,
        openingNotes: "Synthetic imported level.",
        openedDefinitionKey: "white-belt",
        openedOn: utcDay(-30),
        openedByRole: null,
        source: "regyfit-import",
        importedBaseline: { classes: 9, cutoff: utcDay(-10), source: "regyfit-import" },
        state: "initialized",
        schemaVersion: "1",
        createdAt: startedAt,
        createdBy: "system:t051-e2e",
        updatedAt: startedAt,
        updatedBy: "system:t051-e2e",
      });
      for (const [index, offset] of [-20, -5, -4, -3].entries()) {
        const sessionId = `t051-session-${suffix}-${index}`;
        const startAt = `${utcDay(offset)}T18:00:00.000Z`;
        await firestore
          .doc(`${root}/sessions/${sessionId}`)
          .set({ sessionId, academyId, startAt, endAt: `${utcDay(offset)}T19:00:00.000Z` });
        const attendanceId = `t051-attendance-${suffix}-${index}`;
        await firestore.doc(`${root}/attendance/${attendanceId}`).set({
          attendanceId,
          academyId,
          studentId,
          sessionId,
          state: "attended",
          correctionOf: null,
          occurredAt: startAt,
        });
      }
    } finally {
      await deleteApp(app);
    }
  });

  test("search, record, details, birthday, IBJJF card, assign, void, rate and reload @critical", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInOwner(page);

    // Plan B: canonical search opens the record.
    await page.goto("/admin/members/search");
    await page.getByLabel("Member name").fill(fullName);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByRole("link", { name: `Open record for ${fullName}` })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/members/profile\\?id=${studentId}`, "u"), {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: fullName })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Birthday in 3 days")).toBeVisible();

    // Plan B: DETAILS saves and survives a reload.
    await page.getByRole("tab", { name: /details/iu }).click();
    await page.getByLabel("Nickname").fill("Synthetic Nick");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Details saved.")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await page.getByRole("tab", { name: /details/iu }).click();
    await expect(page.getByLabel("Nickname")).toHaveValue("Synthetic Nick", { timeout: 30_000 });

    // Plan C: the card on PROFILE.
    await page.getByRole("tab", { name: /profile/iu }).click();
    const card = page.getByRole("region", { name: "JIU-JITSU IBJJF" });
    await expect(card.getByRole("heading", { name: "WHITE BELT" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(card.getByText("12/25")).toBeVisible();
    await expect(card.getByText("9 from Regyfit + 3 in BPT")).toBeVisible();
    await expect(card.getByText("44%")).toBeVisible();
    await page.screenshot({ path: "screenshots/t051-member-record-profile.png", fullPage: true });
    await expectNoSeriousAxeViolations(page, "record profile tab");

    // Manage: assign below criteria with a note.
    await card.getByRole("link", { name: "Manage" }).click();
    await expect(page).toHaveURL(/view=manage/u);
    const assign = page.getByRole("form", { name: "Assign next level" });
    await assign.getByLabel("Next level").selectOption({ label: "White - 2nd Stripe" });
    await expect(assign.getByLabel("Promotion date")).toHaveValue("");
    await assign.getByLabel("Promotion date").fill(jerseyDay(new Date()));
    await assign.getByRole("button", { name: "Review promotion" }).click();
    const promote = page.getByRole("dialog", {
      name: /^Promote .* from WHITE BELT to White - 2nd Stripe on /,
    });
    await expect(promote.getByRole("list", { name: "Criteria not met" })).toContainText(
      "Skips 1 stripe",
    );
    await expect(promote.getByRole("list", { name: "Criteria not met" })).toContainText(
      "Classes 12/25 not met",
    );
    await expect(promote.getByRole("button", { name: "Confirm promotion" })).toBeDisabled();
    await page.screenshot({ path: "screenshots/t051-ibjjf-assign-dialog.png", fullPage: true });
    await promote.getByLabel(/^Note/u).fill("Synthetic competition result justifies it.");
    await promote.getByRole("button", { name: "Confirm promotion" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Level assigned." })).toBeVisible({
      timeout: 30_000,
    });
    const history = page.getByRole("table", { name: "Level history" });
    await expect(history.getByRole("row").nth(1)).toContainText("White - 2nd Stripe");
    await expect(history.getByRole("row").nth(1)).toContainText("Current");

    // Void it with a reason.
    await history.getByRole("button", { name: "Void" }).click();
    const voidDialog = page.getByRole("dialog", {
      name: `Void the promotion of ${fullName} to White - 2nd Stripe?`,
    });
    await voidDialog.getByLabel(/^Reason/u).fill("Synthetic promotion assigned by mistake.");
    await voidDialog.getByRole("button", { name: "Void promotion" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Promotion voided." })).toBeVisible({
      timeout: 30_000,
    });
    await expect(history.getByRole("row").nth(1)).toContainText("Voided by Owner");

    // Rate a skill and save.
    await page.locator("summary", { hasText: "Warm Up" }).click();
    const bridges = page.getByRole("group", { name: /Warm Up 2 - Bridges/u });
    await bridges.locator("label", { hasText: "4" }).click();
    await page.getByRole("button", { name: "Save ratings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Ratings saved." })).toBeVisible({
      timeout: 30_000,
    });
    await page.screenshot({ path: "screenshots/t051-ibjjf-manage.png", fullPage: true });
    await expectNoSeriousAxeViolations(page, "manage view");

    // Reload keeps every state.
    await page.reload();
    await expect(
      page.getByRole("table", { name: "Level history" }).getByRole("row").nth(1),
    ).toContainText("Voided by Owner", { timeout: 30_000 });
    await page.locator("summary", { hasText: "Warm Up" }).click();
    await expect(
      page.getByRole("group", { name: /Warm Up 2 - Bridges/u }).getByRole("radio", { name: "4" }),
    ).toBeChecked();
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("record and manage view fit a 390px phone", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await signInOwner(page);
    await page.goto(`/admin/members/profile?id=${encodeURIComponent(studentId)}&tab=profile`);
    await expect(
      page
        .getByRole("region", { name: "JIU-JITSU IBJJF" })
        .getByRole("heading", { name: "WHITE BELT" }),
    ).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: "screenshots/t051-member-record-profile-phone.png",
      fullPage: true,
    });
    await expectNoSeriousAxeViolations(page, "record profile tab at 390px");
    await page.goto(
      `/admin/members/profile?id=${encodeURIComponent(studentId)}&tab=profile&view=manage`,
    );
    await expect(page.getByRole("table", { name: "Level history" })).toBeVisible({
      timeout: 30_000,
    });
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "screenshots/t051-ibjjf-manage-phone.png", fullPage: true });
    await expectNoSeriousAxeViolations(page, "manage view at 390px");
  });
});
```

(Screenshot paths are relative to `qa/`, the Playwright working directory, so files land in
`qa/screenshots/`. The data is synthetic.)

- [ ] **Step 4: Build what the emulators and the static server load**

```bash
cd /root/BPT-Jersey
git sparse-checkout add Lista Listav2 .cronos
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm --filter @bpt-jersey/functions build
node apps/functions/scripts/build-deploy-artifact.mjs
NEXT_PUBLIC_FIREBASE_ENV=local NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bpt-jersey NEXT_PUBLIC_LEVELS_BACKEND=true \
corepack pnpm --filter @bpt-jersey/web build
```

Expected: each command exits 0.

- [ ] **Step 5: Run the suite in the emulator container**

```bash
mv .tmp/member-directory-baselines .tmp/member-directory-baselines.bak-t051 2>/dev/null || true
GCLOUD_PROJECT=demo-bpt-jersey node qa/scripts/generate-synthetic-emulator-secrets.mjs \
  --confirmation=SYNTHETIC-EMULATOR-SECRETS --env-file=/root/.t051-member-profile-e2e.env
cat >> /root/.t051-member-profile-e2e.env <<'EOF'
MEMBER_PROFILE_UI_EMULATOR_E2E=true
NEXT_PUBLIC_FIREBASE_ENV=local
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bpt-jersey
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
AUTH_EMULATOR_E2E_EMAIL=t051-owner@example.test
AUTH_EMULATOR_E2E_PASSWORD=Synthetic-Owner-2026
BPT_SYNTHETIC_PILOT=true
FUNCTIONS_DISCOVERY_TIMEOUT=300000
COREPACK_ENABLE_NETWORK=0
EOF
docker run --rm --network none --env-file /root/.t051-member-profile-e2e.env \
  -v /root/BPT-Jersey:/root/BPT-Jersey -v /root/.cache/firebase:/root/.cache/firebase \
  -v /root/.cache/node:/root/.cache/node -v /root/.cache/ms-playwright:/root/.cache/ms-playwright \
  -w /root/BPT-Jersey bpt-emu:local \
  bash -lc 'node_modules/.bin/firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions "node qa/scripts/run-member-profile-ui-e2e.mjs"'
rm /root/.t051-member-profile-e2e.env
```

Expected: seed lines for auth, directory and `{"systemId":"ibjjf-v2","definitionCount":177,…}`,
then `2 passed`. Screenshots exist:
`ls qa/screenshots/t051-*.png` → 5 files. If a Plan B locator ("Member name", "Search", "Open record for …", "Nickname", "Save details")
does not match the built UI, read Plan B's component and use its real accessible name — never
weaken an assertion about behaviour.

- [ ] **Step 6: Prove the spec can fail**

Temporarily change `expect(card.getByText("12/25"))` to `"13/25"`, re-run Step 5, confirm
`1 failed`, undo that one edit by hand, re-run Step 5 and confirm `2 passed` again.

- [ ] **Step 7: Commit**

```bash
git sparse-checkout set '/*' '!/.cronos' '!/Lista' '!/Listav2'
git add qa/scripts/run-member-profile-ui-e2e.mjs qa/run-e2e.mjs qa/tests/member-profile.spec.ts qa/screenshots/t051-*.png qa/package.json pnpm-lock.yaml
git commit -m "test(e2e): member record and JIU-JITSU IBJJF on emulators, desktop and 390px, axe and screenshots (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Design audit, full gate and ledger

**Files:**

- Modify (only if the audit finds issues): files from Tasks 15–17 and their tests
- Modify: `tasksv2.md` (row T051V2, by hand), `Listav2/Listav2.data.js`, `Listav2/Listav2.js` (generated)

**Interfaces:**

- Consumes: everything above.
- Produces: gate evidence.

- [ ] **Step 1: impeccable / taste audit of the finished screens**

Invoke the `impeccable` skill in audit mode on `apps/web/src/app/admin/members/profile/ibjjf-card.tsx`,
`manage-view.tsx`, `skills-assessment.tsx` and the five `qa/screenshots/t051-*.png`, against
`DESIGN.md` §2–§8 and §10. Checklist the audit must answer with evidence (file:line or screenshot):
square corners; purple the only accent; belt colours only inside `.belt-bar`/`.belt-tip`; status is
text + left border (no pill); eyebrow style; tabular numbers; ≥44px targets (score options 44×44,
buttons ≥3.15rem); labels above inputs; skeleton not spinner; empty state = eyebrow + headline +
sentence + one button; no horizontal scroll at 390px; UK English copy; no emoji, no icon-only
button. Fix every finding inside Plan C's files, re-run
`corepack pnpm vitest run --project web apps/web/src/app/admin/members/profile` (PASS) and, if markup
changed, Task 18 Step 5 (2 passed). Record findings and fixes for Step 4.

- [ ] **Step 2: Full local gate**

```bash
cd /root/BPT-Jersey
git sparse-checkout add Lista Listav2 .cronos
corepack pnpm install --frozen-lockfile
corepack pnpm verify:mvp
```

Expected: `verify:mvp: all local gates passed.` On this VPS the `test:rules` step cannot bind
host port 8080 (code-server). If it fails there and only there, run the remaining steps on the host
and the rules step in the container, recording both:

```bash
corepack pnpm format:check && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm build && corepack pnpm test:unit
docker run --rm --network none -v /root/BPT-Jersey:/root/BPT-Jersey -v /root/.cache/firebase:/root/.cache/firebase \
  -v /root/.cache/node:/root/.cache/node -e COREPACK_ENABLE_NETWORK=0 -w /root/BPT-Jersey bpt-emu:local \
  bash -lc 'node_modules/.bin/firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,database "node_modules/.bin/vitest run --project rules"'
NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm --filter @bpt-jersey/web build
NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm test:load:synthetic
NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm test:e2e:smoke
```

Expected: every command exits 0. Known pre-existing flakes (member-calendar real date,
schedule-security-boundary under the full suite) are re-run in isolation and noted, never ignored.

- [ ] **Step 3: Board item and parallel report**

In `Listav2/Listav2.data.js`:

- In `TASK_SURFACES` add:

```js
  T051V2: [
    "packages/domain/src/levels",
    "apps/functions/src/levels",
    "apps/web/src/lib/levels-client.ts",
    "apps/web/src/app/levels",
    "apps/web/src/app/admin/members/profile",
    "docs/data",
    "qa/tests/member-profile.spec.ts",
  ],
```

(if Plans A/B already added a `T051V2` surface entry, merge these paths into it).

- In `adminItems`, if no `task("T051V2", …)` exists, add:

```js
  task(
    "T051V2",
    "Ficha de miembro E0–E2: seguridad, registro canónico con cumpleaños y JIU-JITSU IBJJF",
    "revision",
    "Registro canónico en students con PROFILE y DETAILS, cumpleaños, y tarjeta + Manage de IBJJF (historial, asignar con huecos, anular, evaluación de habilidades) sobre el catálogo ibjjf-v2.",
    "-",
    "Rama feature/member-profile-e0-e2. Evidencia en tasksv2.md. Despliegue, importación y siembra de ibjjf-v2 fuera del emulador solo con confirmación del operador en chat.",
    [
      REF_TASKS,
      "docs/superpowers/specs/2026-09-17-member-profile-e0-e2-design.md",
      "docs/superpowers/plans/2026-09-17-member-profile-c-e2-ibjjf.md",
    ],
    "funcion",
  ),
```

otherwise set its status to `"revision"` and append the plan path to its references.

```bash
node Listav2/build.mjs
node Listav2/parallel-report.mjs
node Listav2/parallel-report.mjs --check
```

Expected: the last command exits 0.

- [ ] **Step 4: Ledger row, by hand (never prettier)**

In `tasksv2.md`, in the `## V2-E - Interfaz de administracion y entrenadores` table: if a `T051V2`
row exists, change only its `Estado` to `revision` and append to its evidence; otherwise add after
the section's last row:

```markdown
| T051V2 | Ficha de miembro E0–E2: seguridad del panel Regyfit, registro canónico con cumpleaños y JIU-JITSU IBJJF (tarjeta, Manage, evaluación de habilidades) | - | revision | Spec `docs/superpowers/specs/2026-09-17-member-profile-e0-e2-design.md`; plan C `docs/superpowers/plans/2026-09-17-member-profile-c-e2-ibjjf.md`; rama `feature/member-profile-e0-e2`. Evidencia E2 (<fecha>, sobre `<sha>`): catálogo `ibjjf-v2` (177 niveles, 58 habilidades, 165 requisitos) con informe `docs/data/ibjjf-criteria-diff-bpt-vs-regyfit.md` aprobado por el operador el <fecha y cita> ; unitarias <n> ficheros / <n> pruebas; reglas <n>; integración `qa/integration/level-manage.test.ts` 1/1 en emulador; Playwright `qa/tests/member-profile.spec.ts` 2/2 (escritorio 1440 y 390 px, axe sin violaciones serias o críticas / axe no autorizado) con capturas `qa/screenshots/t051-*`; auditoría impeccable: <hallazgos y arreglos>; `verify:mvp` <resultado exacto>. Pendiente con confirmación en chat: desplegar functions (`assignLevel`, `voidPromotion`, `getStudentLevelHistory`, `openStudentLevel`, `recordEvaluation`, `getStudentProgressSummary`) y web; sembrar `ibjjf-v2` fuera del emulador (hoy `seed-levels.mjs` rechaza producción); `NEXT_PUBLIC_LEVELS_BACKEND=true` en Pages tras la siembra. |
```

Replace every `<…>` with the measured value from Steps 1–2 and Tasks 2, 13 and 18 before saving;
a row with a placeholder left in it is not evidence.

Also by hand (never prettier), in `tasks.md` row **T125** (plaintext Regyfit passwords, decided
2026-09-07 as option (c) "keep the field and accept the risk"): append a Spanish note dated
2026-09-17 that the decision is **superseded** by spec
`docs/superpowers/specs/2026-09-17-member-profile-e0-e2-design.md` §2 decision 4 (operator in chat,
2026-09-17: the imported app password is removed entirely — contract, panel and importer), and that
the risk acceptance **D11** in section 3.1 of the T011 acta
(`docs/operations/t011-controller-approval-acta-draft.md`) no longer covers a live field once Plan A
ships; the production purge of already stored passwords stays a separate operator-gated step (spec
§8). Change nothing else in T125 or in the acta.

```bash
corepack pnpm vitest run --project node qa/unit/listav2-ledger-sync.test.ts qa/unit/listav2-interference.test.ts qa/unit/listav2-checklist.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit and restore the sparse checkout**

```bash
git add tasksv2.md tasks.md Listav2/Listav2.data.js Listav2/Listav2.js
git add -u apps/web/src/app/admin/members/profile
git commit -m "docs(tasks): T051V2 E2 evidence — ibjjf-v2, manage view, emulator E2E and gate (T051V2)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git sparse-checkout set '/*' '!/.cronos' '!/Lista' '!/Listav2'
```

---

## Self-review

**Spec coverage**

| Spec item                                                                                                                                                                                              | Task                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| §6.1 card: belt (§10 components), name, promotion date, single progress, classes x/y, days x/y (met = green left border + text), Manage, empty state "No level yet" + "Open level"                     | 15                                                                                             |
| §6.1 roles: card for owner/administrator/headCoach/coach                                                                                                                                               | 12 (`getStudentProgressSummary` unchanged roles), 15                                           |
| §6.2 formula, excluded criteria, floor, same function for card and Manage                                                                                                                              | 5 (domain), 7 (summary), 16 (client gaps use the same catalogue data)                          |
| §6.2 / G10 baseline + BPT attendance ≥ max(start, cutoff), disappears on promotion, "9 from Regyfit + 3 in BPT", no double count at cutoff                                                             | 5, 7, 9, 13, 15                                                                                |
| §6.3 history table (belt icon, assigned on, classes/days x/min, promoted by, status; voided struck through with reason and who)                                                                        | 10, 16                                                                                         |
| §6.3 open level: any definition, `startedOn` required in UI and not future, notes, audited                                                                                                             | 6, 8, 12, 16                                                                                   |
| §6.3 / G7 assign: later levels only, skipping allowed, date required with no default, not future, not before start, confirmation text, gap list, note 10–500 mandatory with gaps, append-only, audited | 5, 6, 9, 12, 16                                                                                |
| §6.3 void: latest non-voided only, reason 10–500, confirmation, restores previous head, audit, never deletes                                                                                           | 6, 10, 12, 16                                                                                  |
| §6.3 skills: categories from label prefix, collapsible, rated/min-met count, 1–5 radio groups, 44px, "Minimum N" + outline, explicit save, dirty warning, batch `recordEvaluation`, coaches rate       | 1, 5, 11, 12, 14, 17                                                                           |
| §6.4 / G9 sanitized capture, per-level minimums, new catalogue version via seed/publication, `expected_11_skills` version-aware, diff report + operator gate                                           | 1, 2, 3, 4                                                                                     |
| §7 cross-cutting design, frontend and backend security                                                                                                                                                 | Global Constraints; 12–19                                                                      |
| §8 composite index if needed                                                                                                                                                                           | 7 (`ponytail:` note; existing `(studentId, occurredAt)` index already covers the future query) |
| §9 unit, rules, emulator integration (void, open, attendance with baseline), Playwright B+C desktop + 390, axe, screenshots, `verify:mvp`, ledger                                                      | 1–17, 13, 18, 19                                                                               |
| G6 role-trimmed record (coach sees card + Manage)                                                                                                                                                      | 12 (roles), 16 (coach test); header/tabs trimming is Plan B                                    |

**Placeholder scan:** the only intentional fill-ins are measured values in the ledger row (Task 19
Step 4, which forbids saving them unfilled) and the all-zero hashes in Task 4 Step 3 that Step 5
replaces from the failing test's output. Plan B names are consumed through the brief's fixed
interfaces plus an explicit grep.

**Type consistency:** `assignLevel`, `voidPromotion`, `getStudentLevelHistory`,
`recordSkillRatings` share the same signatures in the store type (Tasks 9–11), the handlers (Task 12),
the web client (Task 14) and the components (Tasks 16–17). `StudentLevelHead` optional fields
(Task 7) match the head written in Tasks 8, 13 and 18 and the Plan D interface block. History entry
fields (Task 6 schema) match `buildLevelHistory` (Task 10) and `HistoryTable` (Task 16).
