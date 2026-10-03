# Levels: direct editing, techniques library, one catalogue — design

Date: 2026-10-03 · Status: approved in chat, pending written review · Owner: operator (Luis)

## Goal

In `/admin/levels` the office (owner, administrator) edits every belt and every stripe of the
live catalogue in place, manages techniques as one library (add, rename, delete), and sees
techniques without the current wall of text. The versions machinery (drafts, publish, activate)
disappears: only the current catalogue exists, in code and in Firestore.

Graduation rules (`/root/secrets/Graduaciones.drawio.html`, summarised): a student graduates once
they reach the level's minimum classes and minimum time; the coach approves or refuses at the
graduation class; approval resets the class count and the time window. This work does **not**
build that flow. It must keep the data that flow reads (`criteria.minClasses`,
`criteria.minimumTime` per belt and per stripe, techniques and their minimum ratings) editable and
intact.

## Decisions (operator, 2026-10-03)

1. **Direct save.** A Save applies immediately to everyone. No draft, no publish, no version list.
   Every save writes an audit event.
2. **Edit, never add or remove levels.** Name, colours and criteria of each belt and of each
   stripe are editable. The set of belts and stripes (keys, kind, parent, order, stripe count) is
   fixed; the IBJJF ladder never changes from this screen, so no student can lose their level.
3. **Techniques library + collapsible list.** A Techniques tab holds the single list
   (add/rename/delete). Belt cards show a collapsed "N techniques" list.
4. **Techniques are assigned per belt.** One list per belt applies to the belt and all its stripes.
   The one-off migration unifies today's per-stripe lists (report shown before applying).
5. **Approach A.** One-off adoption: copy `ibjjf-v3` into a custom system, activate it, delete the
   unused catalogues; afterwards one callable edits the active system in place.

## Current state (verified 2026-10-03)

- Production `academies/demo-academy`: `levelSystems` = `ibjjf-v3` (published, active),
  `ibjjf-v2` (published, unused), `bpt-20260926-1` (custom draft, unused). `levelCatalogState/active`
  → `ibjjf-v3`. v3: 27 belts, 150 stripes, 58 skills, 165 requirements, 11 progress heads.
- Reads of the active catalogue (`level-service.ts` `getPublishedCatalog`) do not check hashes,
  so an in-place edit of a custom system is safe. Code versions `ibjjf-v1..v3` stay hash-pinned
  for seeding (`level-source.ts`) and are never edited.
- Firestore rules deny all client access to `levelSystems`, `levelDefinitions`,
  `levelRequirements`, `levelCatalogManifests` (`firestore.rules:182-196`); unchanged.

## 1. Data and backend

**Model.** No schema change. One active custom system (`bpt-<yyyymmdd>-<n>`) in `levelSystems`,
its `levelDefinitions` and `levelRequirements`, techniques in `skillCatalog`.

**New callable `saveLevelCatalog`** (`apps/functions/src/levels/level-editor-callables.ts`,
exported from `index.ts`):

- Auth: `requireAdminActor` with role owner or administrator, `assertAcademyScope`.
- Input (`packages/domain/src/levels/level-editor-contracts.ts`, `strictObject`):
  `{ expectedUpdatedAt, displayName, levels, skills, beltTechniques }` where
  `beltTechniques` is `{ beltKey, skillKey, minimumRating }[]` (belt keys only). Existing level and
  skill schemas are reused (hex `#RRGGBB`, bounded ints, label 1–80 chars, ≤ 300 skills).
- Checks inside the write transaction, all reads before writes:
  - The active system is custom; otherwise `failed-precondition` ("Run the catalogue adoption
    first").
  - `expectedUpdatedAt` equals the stored `updatedAt`; otherwise `aborted` → client shows the
    conflict notice.
  - Structure unchanged: same set of `definitionKey`, and for each the same `kind`,
    `parentDefinitionKey`, `sequence`, `stripeNumber`, `visual.stripeCount`. Any difference →
    `invalid-argument`.
  - Skill keys unique; every `beltTechniques` entry points at an existing belt and skill; no
    duplicate (belt, skill).
- Writes: definitions (name, colours, criteria; stripe visuals follow their belt's colours as
  today), requirements rebuilt as `beltTechniques` fanned out to the belt and each of its
  stripes (stale requirement docs deleted), `skillCatalog`, `counts`, new `contentHash` (same
  hashing as `publishDraft` today), `updatedAt`, `updatedBy`; audit event
  `level.catalog.updated` with previous and new hash.
- New skill keys are generated server-side from the label (same slug rule the editor uses today);
  a rename keeps the key so assessment history follows it. Deleting a skill removes its
  requirements; past `assessments` keep their `skillKey` as history.
- Output: the saved catalogue in editor form plus the new `updatedAt`.

**New callable `getEditableLevelCatalog`** (owner/administrator only, no input): returns the
active custom system in editor form — `{ updatedAt, displayName, levels, skills, beltTechniques }`
— where `beltTechniques` is read from each belt's own requirements (the adoption guarantees
stripes match their belt). The shared `listLevelCatalog` projection and its strict parser are
**not** changed: members, coaches and the read-only Belts view keep using it, so a partial deploy
cannot break them (lesson: strict parsers + partial deploy, 2026-09-30).

**Removed** (code, contracts, web client, tests that only cover them):
`listLevelCatalogVersions`, `getLevelCatalogVersion`, `createLevelCatalogDraft`,
`saveLevelCatalogDraft`, `publishLevelCatalogDraft`, `activateLevelCatalog`, and in the service
`listVersions`, `getVersion`, `createDraft`, `saveDraft`, `publishDraft`, `activate`. The adoption
CLI carries its own copy/activate logic, so nothing in the service survives for it. `ibjjf-v1..v3` builders, seed CLI and source hashes stay: emulator seeding
and tests depend on them.

**One-off adoption CLI** `apps/functions/scripts/adopt-level-catalog.mjs` (run by the operator
from the repo root, `--key=value` flags like the other level CLIs):

1. `--dry-run` (default): read active `ibjjf-v3`; build the custom copy `bpt-<yyyymmdd>-1`
   with techniques unified per belt (the belt's list wins; if the belt has none, the union of its
   stripes' lists with the highest minimum per skill); print a report: belts whose stripes change,
   per stripe the techniques added/removed; count documents outside the catalogue that still
   reference `ibjjf-v2`, `ibjjf-v3` or `bpt-20260926-1` (`studentLevelProgress.systemId`, other
   level collections found during planning). Print the plan hash and the exact confirmation
   literal.
2. `--apply --confirmation=<literal> --actor-id=<uid> --generated-at=<from dry-run>`: in
   transactions with all reads first: create the custom system (status published, contentHash),
   point `levelCatalogState/active` at it, move every progress head's `systemId` (held level and
   start date unchanged), write audit + activation receipt.
3. Delete step (same apply, after activation succeeds): delete `levelSystems`,
   `levelDefinitions`, `levelRequirements`, `levelCatalogManifests` docs of `ibjjf-v2`,
   `ibjjf-v3`, `bpt-20260926-1`. Abort the delete if any outside reference remains. Never delete
   `auditEvents` or `levelCatalogActivations`.
4. Idempotent: rerunning after success reports "already adopted" and does nothing.

## 2. Interface (`/admin/levels`)

- Tabs: **Belts** | **Techniques** (Techniques only for owner/administrator). The Versions tab,
  `level-versions.tsx` and `level-draft-editor.tsx` are removed; coach, head coach and staff keep
  the read-only Belts view.
- **Belts tab** keeps the belt-card grid (`levels-browser.tsx`, DESIGN §10). Per card:
  - Techniques: a native `<details>` collapsed by default, summary "N techniques", body a plain
    list "Technique · min ★N" (tabular numbers). `techniqueSets` and its paragraph rendering are
    deleted.
  - "Edit belt" (editors only) switches that card to inline edit, one card at a time: name;
    colours (native colour input + hex, `#RRGGBB` rule, `.belt-bar` preview); belt criteria
    (min/max age, min classes, min days); a table with one row per stripe (1st, 2nd…) with min
    classes and min days; techniques of the belt (list with rating 1–5 select and Remove, plus
    "Add technique" via `<input list>` + `<datalist>` from the library); Save (primary) and
    Cancel. Cancel with unsaved changes asks via native `<dialog>`.
  - Conflict on save → amber notice "Someone else changed the levels. Reload to see their
    changes." with a Reload button.
- **Techniques tab**: admin table (1 px rules), search field and "Add technique" field above.
  Columns: Technique | Used in (belts) | Actions. Rename edits in the row; Delete confirms via
  `<dialog>`: "Used by N belts. Students' past ratings stay in their history." Every action saves
  through `saveLevelCatalog`.
- Edit code (inline belt editor, Techniques tab) is loaded with `next/dynamic` so read-only roles
  never download it.
- Rules applied (DESIGN.md + impeccable/taste/antislop): radius 0, no pills, no gradients or blur
  shadows, status as text + left rule, skeletons not spinners, inputs ≥ 16 px, targets ≥ 44 px,
  one column under 48rem, UK English plain copy, belt colours only in bar and swatches, errors as
  safe strings from `level-editor-client.ts`. DESIGN §10 is updated (no more "Versions").

## 3. Security, verification, deploy

- Server is the only authority (zod `strictObject`, structure lock, references, transaction).
  Client never writes the catalogue; rules unchanged. React text rendering only, no
  `dangerouslySetInnerHTML`; hex reaches CSS only when valid. Audit on every save.
- Tests: per AGENTS.md no new automated tests and none run; tests that only cover removed code are
  deleted, tests that would stop compiling are adjusted.
- Verification after build, with Playwright MCP against emulators (`demo-bpt-jersey`, Docker
  `bpt-emu:local`, synthetic data only), emulator seeded with v2, v3 and a custom draft:
  1. adoption CLI `--dry-run` then `--apply`; only the custom system remains, heads moved;
  2. edit a belt's name, colour, criteria and one stripe's criteria → Save → reload → persisted;
  3. add, rename, delete a technique; "Used in" counts update;
  4. assign/remove a technique on a belt; the `<details>` count updates;
  5. two tabs → second save gets the conflict notice;
  6. coach login: read-only, no Edit, no Techniques tab;
  7. 375 px width: no horizontal scroll; console clean.
- Deploy (each step only on explicit operator confirmation in chat; runbook with copy-paste
  commands): (1) push `main` (Cloudflare publishes web) together with (2) `firebase deploy` of
  `getEditableLevelCatalog` and `saveLevelCatalog`, batches of ≤ 20 with 120 s waits; (3) adoption
  CLI in production, dry-run reviewed before apply; (4) `functions:delete` of the six removed
  callables.

## Out of scope

Graduation flow (Next Graduation, Today's Graduations, coach approval, notifications, animations);
adding/removing belts or stripes; editing ages/criteria of code versions; member-facing level UI.
