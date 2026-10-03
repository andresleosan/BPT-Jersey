# Levels Direct Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office edits every belt and stripe of the one live level catalogue in place, manages techniques as a library, and the versions machinery is gone from code and Firestore.

**Architecture:** The academy's active catalogue becomes one custom system (`bpt-<yyyymmdd>-<n>`) produced by a one-off operator CLI that copies `ibjjf-v3`, unifies techniques per belt, activates it and deletes every other system. Two callables replace six: `getEditableLevelCatalog` reads it in editor form, `saveLevelCatalog` writes the whole catalogue in one transaction (structure locked, only changed docs written, optimistic `updatedAt` check, audit). The web keeps the read-only belt grid for everyone; editors get inline per-belt editing and a Techniques tab, loaded with `next/dynamic`.

**Tech Stack:** TypeScript strict, zod 4 (`z.strictObject`), Firebase Functions v2 `onCall`, firebase-admin Firestore, Next.js 16 / React 19 static export, plain CSS, Playwright MCP for verification.

**Spec:** `docs/superpowers/specs/2026-10-03-levels-direct-editing-design.md`

## Global Constraints

- Work on local `main`; commit per task; never push or deploy without the operator's explicit "yes" in chat (push to `main` publishes the web on Cloudflare).
- AGENTS.md: do not add or run automated tests (unit, rules, integration, e2e). Delete tests that only cover removed code; adjust tests that would no longer compile; do not run them. Verification is the Playwright MCP pass in Task 9.
- `packages/domain` never imports Firebase.
- Callables: `enforceAppCheck: true`, roles `owner` and `administrator` only, zod `strictObject` input, safe error strings in the web client (never raw Firebase errors).
- DESIGN.md: radius 0, no pills, no gradients except the existing `.belt-bar`, no blur shadows, status = text + coloured left rule, skeletons not spinners, inputs ≥ 16px, touch targets ≥ 44px, one column below `48rem`, UK English plain copy, no emojis or star glyphs, belt colours only in `.belt-bar`/`.belt-tip`/`.levels-colour` and the native colour input.
- Hex reaches CSS only when it matches `#RRGGBB`; until then the field says "Enter a colour like #1A2B3C".
- Levels and stripes cannot be added or removed from the UI or the callable.
- Techniques are assigned per belt and apply to the belt and all its stripes.
- Firestore transactions: all reads before any write; ≤ 450 writes per save transaction; batches ≤ 400 in the CLI.
- Commands run from `/root/BPT-Jersey` via `corepack pnpm`; Node `>=22.13 <25`.

## Review Focus

1. Two office users save on top of each other → the second gets "Someone else changed the levels. Reload to see their changes." and nothing is overwritten (Task 9 check 5).
2. Minimum age above maximum age, or an empty name → the editor refuses before calling and the server refuses with `invalid-argument` if bypassed (Task 9 check 2).
3. A half-typed hex (`#1A2`) → the field shows the hint, the preview keeps the last valid colour, Save is disabled (Task 9 check 2).
4. A technique added with a label that already exists in any letter case → "That technique already exists." and no save (Task 9 check 3).
5. Deleting a technique used by belts → it disappears from every belt's list and the "Used in" column; other techniques are untouched (Task 9 check 3).

---

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `packages/domain/src/levels/level-editor-contracts.ts` | Rewrite | Editable catalogue schemas, save input, technique key slug |
| `packages/domain/src/levels/level-editor-contracts.test.ts` | Delete | Covered removed draft/version contracts only |
| `apps/functions/src/levels/level-editor-service.ts` | Rewrite | `getEditable`, `save`; shared audit helpers for the adoption |
| `apps/functions/src/levels/level-editor-service.test.ts` | Delete | Covered removed draft/publish/activate |
| `apps/functions/src/levels/level-editor-callables.ts` | Rewrite | `getEditableLevelCatalog`, `saveLevelCatalog` |
| `apps/functions/src/levels/level-editor-callables.test.ts` | Delete | Covered removed callables |
| `apps/functions/src/index.ts` | Modify | Export the two new callables, drop six |
| `apps/functions/src/levels/level-catalog-adoption.ts` | Create | Plan and apply the one-off adoption |
| `apps/functions/scripts/adopt-level-catalog.mjs` | Create | Operator CLI around the adoption |
| `apps/web/src/lib/level-editor-client.ts` | Rewrite | Typed client for the two callables |
| `apps/web/src/app/levels/levels-grouping.ts` | Modify | Drop `techniqueSets`; add `beltTechniques` |
| `apps/web/src/app/levels/levels-grouping.test.ts` | Modify | Drop `techniqueSets` cases (do not run) |
| `apps/web/src/app/levels/levels-browser.tsx` | Modify | `<details>` techniques, `version` and `renderBeltEditor` props |
| `apps/web/src/app/levels/levels.css` | Modify | `.belt-techniques` replaces `.belt-skills`; editing card spans the grid |
| `apps/web/src/app/admin/levels/levels-editor.tsx` | Create | Editor root: loads, saves, notices, tab content |
| `apps/web/src/app/admin/levels/belt-editor.tsx` | Create | Inline editor for one belt and its stripes |
| `apps/web/src/app/admin/levels/techniques-library.tsx` | Create | Techniques tab |
| `apps/web/src/app/admin/levels/page.tsx` | Modify | Tabs Belts / Techniques; dynamic editor |
| `apps/web/src/app/admin/levels/levels-editor.css` | Rewrite | Editor styles only |
| `apps/web/src/app/admin/levels/level-versions.tsx`, `level-versions.test.tsx`, `level-draft-editor.tsx`, `level-draft-editor.test.tsx` | Delete | Versions UI |
| `apps/web/src/app/admin/levels/page.test.tsx` | Modify | Drop Versions cases (do not run) |
| `DESIGN.md` | Modify | §10 names the inline editor, not Versions |

---

### Task 1: Domain contracts for the editable catalogue

**Files:**
- Rewrite: `packages/domain/src/levels/level-editor-contracts.ts`
- Delete: `packages/domain/src/levels/level-editor-contracts.test.ts`

**Interfaces:**
- Produces (import path `@bpt-jersey/domain/levels/editor`, subpath already exported in `packages/domain/package.json`):
  - `customLevelSystemIdPattern`, `isCustomLevelSystemId(value: unknown): value is string` (unchanged; used by `level-contracts.ts`, `level-catalog-integrity.ts`, `level-seed.ts`, `level-source.ts`)
  - `maxStripesPerBelt = 11`
  - `catalogLevelSchema`, `type CatalogLevel`
  - `catalogSkillSchema`, `type CatalogSkill`
  - `beltTechniqueSchema`, `type BeltTechnique = { beltKey: string; skillKey: string; minimumRating: number }`
  - `editableLevelCatalogSchema`, `type EditableLevelCatalog = { systemId; updatedAt; displayName; levels: CatalogLevel[]; skills: CatalogSkill[]; beltTechniques: BeltTechnique[] }`
  - `saveLevelCatalogInputSchema`, `type SaveLevelCatalogInput = { expectedUpdatedAt; displayName; levels; skills; beltTechniques }`
  - `techniqueKey(label: string, taken: ReadonlySet<string>): string`

- [ ] **Step 1: Confirm nothing else imports the names being removed**

Run: `grep -rnE "levelDraft|LevelDraft|saveLevelCatalogDraft|createLevelCatalogDraft|publishLevelCatalogDraft|activateLevelCatalog|getLevelCatalogVersion|listLevelCatalogVersions|levelCatalogVersion|LevelCatalogVersion|missingProgressKeys|LevelCatalogMissingKey|levelCatalogActivation" apps packages qa --include=*.ts --include=*.tsx --include=*.mjs | grep -vE "/lib/|\.firebase-functions|node_modules"`

Expected: matches only in files this plan rewrites or deletes (`level-editor-contracts*`, `level-editor-service*`, `level-editor-callables*`, `index.ts`, `level-editor-client.ts`, `level-versions*`, `level-draft-editor*`, `admin/levels/page*`). Any other file: stop and report it.

- [ ] **Step 2: Replace the contracts file**

Write `packages/domain/src/levels/level-editor-contracts.ts`:

```ts
import { z } from "zod";

/**
 * The academy's belt catalogue is one `custom` system named `bpt-<yyyymmdd>-<n>`, edited in place.
 * Code versions `ibjjf-v1..v3` only seed fresh environments and are never edited. Which belts and
 * stripes exist is fixed; their names, colours, criteria and the techniques they require are not.
 */
export const customLevelSystemIdPattern = /^bpt-\d{8}-\d{1,3}$/u;

export function isCustomLevelSystemId(value: unknown): value is string {
  return typeof value === "string" && customLevelSystemIdPattern.test(value);
}

/** ibjjf-v3 kids belts carry 11 degrees. */
export const maxStripesPerBelt = 11;

const hexColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const customSystemIdSchema = z.string().regex(customLevelSystemIdPattern);
const labelSchema = z.string().trim().min(1).max(80);
const ageSchema = z.number().int().min(3).max(99);
const ratingSchema = z.number().int().min(1).max(5);
const stampSchema = z.string().min(1).max(64);

const criteriaSchema = z.strictObject({
  minAge: ageSchema.nullable(),
  maxAge: ageSchema.nullable(),
  minClasses: z.number().int().min(0).max(10_000).nullable(),
  minimumTime: z
    .strictObject({
      years: z.number().int().min(0).max(99),
      months: z.number().int().min(0).max(1_200),
      days: z.number().int().min(0).max(36_500),
    })
    .nullable(),
});

export const catalogLevelSchema = z.strictObject({
  definitionKey: identifierSchema,
  kind: z.enum(["belt", "stripe"]),
  parentDefinitionKey: identifierSchema.nullable(),
  name: labelSchema,
  sequence: z.number().int().min(1).max(10_000),
  stripeNumber: z.number().int().min(1).max(maxStripesPerBelt).nullable(),
  criteria: criteriaSchema,
  visual: z.strictObject({
    colors: z.array(hexColourSchema).min(1).max(4),
    stripeColor: hexColourSchema.nullable(),
    // Read-only: the number of stripes under a belt. The server never takes it from the client.
    stripeCount: z.number().int().min(0).max(maxStripesPerBelt),
  }),
});
export type CatalogLevel = z.infer<typeof catalogLevelSchema>;

export const catalogSkillSchema = z.strictObject({
  key: identifierSchema,
  displayLabel: labelSchema,
  minimumRating: ratingSchema,
  sequence: z.number().int().min(1).max(10_000),
});
export type CatalogSkill = z.infer<typeof catalogSkillSchema>;

/** A technique a belt requires; it applies to the belt and every stripe under it. */
export const beltTechniqueSchema = z.strictObject({
  beltKey: identifierSchema,
  skillKey: identifierSchema,
  minimumRating: ratingSchema,
});
export type BeltTechnique = z.infer<typeof beltTechniqueSchema>;

const contentShape = {
  displayName: labelSchema,
  levels: z.array(catalogLevelSchema).min(1).max(400),
  skills: z.array(catalogSkillSchema).max(300),
  beltTechniques: z.array(beltTechniqueSchema).max(3_000),
};

type Content = Readonly<{
  levels: readonly CatalogLevel[];
  skills: readonly CatalogSkill[];
  beltTechniques: readonly BeltTechnique[];
}>;

function checkContent(value: Content, context: z.RefinementCtx): void {
  const levels = new Map<string, CatalogLevel>();
  value.levels.forEach((level, index) => {
    if (levels.has(level.definitionKey)) {
      context.addIssue({ code: "custom", path: ["levels", index], message: "Duplicate level" });
    }
    levels.set(level.definitionKey, level);
    const { minAge, maxAge } = level.criteria;
    if (minAge !== null && maxAge !== null && minAge > maxAge) {
      context.addIssue({ code: "custom", path: ["levels", index], message: "Age range" });
    }
  });
  value.levels.forEach((level, index) => {
    const parent =
      level.parentDefinitionKey === null ? undefined : levels.get(level.parentDefinitionKey);
    const valid =
      level.kind === "belt"
        ? level.parentDefinitionKey === null
        : parent !== undefined && parent.kind === "belt";
    if (!valid) {
      context.addIssue({ code: "custom", path: ["levels", index], message: "Invalid parent" });
    }
  });
  const skills = new Set<string>();
  value.skills.forEach((skill, index) => {
    if (skills.has(skill.key)) {
      context.addIssue({ code: "custom", path: ["skills", index], message: "Duplicate skill" });
    }
    skills.add(skill.key);
  });
  const pairs = new Set<string>();
  value.beltTechniques.forEach((technique, index) => {
    const pair = `${technique.beltKey}__${technique.skillKey}`;
    if (
      levels.get(technique.beltKey)?.kind !== "belt" ||
      !skills.has(technique.skillKey) ||
      pairs.has(pair)
    ) {
      context.addIssue({
        code: "custom",
        path: ["beltTechniques", index],
        message: "Invalid technique",
      });
    }
    pairs.add(pair);
  });
}

export const editableLevelCatalogSchema = z
  .strictObject({ systemId: customSystemIdSchema, updatedAt: stampSchema, ...contentShape })
  .superRefine(checkContent);
export type EditableLevelCatalog = z.infer<typeof editableLevelCatalogSchema>;

export const saveLevelCatalogInputSchema = z
  .strictObject({ expectedUpdatedAt: stampSchema, ...contentShape })
  .superRefine(checkContent);
export type SaveLevelCatalogInput = z.infer<typeof saveLevelCatalogInputSchema>;

/** A new technique's key: its label as a slug, suffixed until it is free. */
export function techniqueKey(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 100) || "technique";
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`;
  return key;
}
```

- [ ] **Step 3: Delete the obsolete contract test**

Run: `git rm packages/domain/src/levels/level-editor-contracts.test.ts`

- [ ] **Step 4: Typecheck the domain package**

Run: `corepack pnpm --filter @bpt-jersey/domain typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/levels/level-editor-contracts.ts
git commit -m "feat(levels): editable catalogue contracts replace draft/version contracts"
```

---

### Task 2: Editor service and callables

**Files:**
- Rewrite: `apps/functions/src/levels/level-editor-service.ts`
- Rewrite: `apps/functions/src/levels/level-editor-callables.ts`
- Modify: `apps/functions/src/index.ts:119-126`
- Delete: `apps/functions/src/levels/level-editor-service.test.ts`, `apps/functions/src/levels/level-editor-callables.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `hashLevelCatalogValue`, `levelCatalogStorageId` from `./level-catalog-integrity.js`; `appendAuditEventInTransaction` from `../audit/audit-writer.js`; `parseAuditEventDraft` from `@bpt-jersey/domain/audit`.
- Produces:
  - `LevelEditorError` with `code: "invalid" | "not-found" | "conflict" | "stale"`
  - types `LevelEditorFirestore`, `LevelEditorTransaction`
  - `createLevelEditorService({ firestore, now?, newOperationId? }): { getEditable(academyId): Promise<EditableLevelCatalog>; save({ academyId, catalog: SaveLevelCatalogInput, actorId }): Promise<EditableLevelCatalog> }`
  - `levelCatalogAuditDraft(value: Record<string, unknown>): AuditEventDraft`, `catalogueCorrelationId(action, academyId, systemId, operationId): string` (used by Task 3)
  - callables `getEditableLevelCatalog` (no input) and `saveLevelCatalog` (`SaveLevelCatalogInput`), both returning `EditableLevelCatalog`; a stale save is `HttpsError("aborted")`.

- [ ] **Step 1: Replace the service**

Write `apps/functions/src/levels/level-editor-service.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";

import { parseAuditEventDraft, type AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  isCustomLevelSystemId,
  type CatalogLevel,
  type CatalogSkill,
  type EditableLevelCatalog,
  type SaveLevelCatalogInput,
} from "@bpt-jersey/domain/levels/editor";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { hashLevelCatalogValue, levelCatalogStorageId } from "./level-catalog-integrity.js";

/**
 * The academy's one belt catalogue, edited in place. The active system must be custom (the
 * adoption CLI makes it so). A save may change names, colours, criteria and techniques; the set
 * of belts and stripes is locked. Only documents whose content changed are written.
 */
export type LevelEditorErrorCode = "invalid" | "not-found" | "conflict" | "stale";

export class LevelEditorError extends Error {
  public readonly code: LevelEditorErrorCode;

  public constructor(code: LevelEditorErrorCode, message: string) {
    super(message);
    this.name = "LevelEditorError";
    this.code = code;
  }
}

type StoredData = Record<string, unknown>;
type EditorSnapshot = Readonly<{ exists: boolean; data: () => StoredData | undefined }>;
type EditorDocumentReference = Readonly<{ id: string; path?: string }>;
type EditorQueryDocument = Readonly<{
  id: string;
  data: () => StoredData;
  ref: EditorDocumentReference;
}>;
type EditorQuerySnapshot = Readonly<{ docs: readonly EditorQueryDocument[] }>;
type EditorQuery = Readonly<{ get: () => Promise<EditorQuerySnapshot> }>;
type EditorCollection = EditorQuery &
  Readonly<{ where: (field: string, operator: "==", value: unknown) => EditorQuery }>;
export type LevelEditorTransaction = Readonly<{
  get: {
    (reference: EditorDocumentReference): Promise<EditorSnapshot>;
    (query: EditorQuery): Promise<EditorQuerySnapshot>;
  };
  create: (reference: EditorDocumentReference, data: unknown) => void;
  set: (reference: EditorDocumentReference, data: unknown, options?: { merge: boolean }) => void;
  delete: (reference: EditorDocumentReference) => void;
}>;
export type LevelEditorFirestore = Readonly<{
  doc: (path: string) => EditorDocumentReference;
  collection: (path: string) => EditorCollection;
  runTransaction: <T>(callback: (transaction: LevelEditorTransaction) => Promise<T>) => Promise<T>;
}>;

export type LevelEditorService = Readonly<{
  getEditable: (academyId: string) => Promise<EditableLevelCatalog>;
  save: (input: {
    academyId: string;
    catalog: SaveLevelCatalogInput;
    actorId: string;
  }) => Promise<EditableLevelCatalog>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const activeStateId = "active";
// ponytail: one transaction per save; a save touching more docs than this is refused, not split.
const maxWritesPerSave = 450;

function assertIdentifier(value: string): void {
  if (!identifierPattern.test(value)) {
    throw new LevelEditorError("invalid", "Invalid level catalogue identifier.");
  }
}

function isRecord(value: unknown): value is StoredData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr<T>(value: unknown, fallback: T): string | T {
  return typeof value === "string" ? value : fallback;
}

function numberOr<T>(value: unknown, fallback: T): number | T {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function storedSkills(system: StoredData): StoredData[] {
  return Array.isArray(system.skillCatalog) ? system.skillCatalog.filter(isRecord) : [];
}

function bySequence(left: StoredData, right: StoredData): number {
  return numberOr(left.sequence, 0) - numberOr(right.sequence, 0);
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function criteriaOf(value: unknown): CatalogLevel["criteria"] {
  const criteria = isRecord(value) ? value : {};
  const time = isRecord(criteria.minimumTime) ? criteria.minimumTime : null;
  return {
    minAge: numberOr(criteria.minAge, null),
    maxAge: numberOr(criteria.maxAge, null),
    minClasses: numberOr(criteria.minClasses, null),
    minimumTime:
      time === null
        ? null
        : {
            years: numberOr(time.years, 0),
            months: numberOr(time.months, 0),
            days: numberOr(time.days, 0),
          },
  };
}

/** Stored documents in editor form. A belt's techniques are the requirements on the belt itself. */
export function editableContent(
  systemId: string,
  system: StoredData,
  definitions: readonly StoredData[],
  requirements: readonly StoredData[],
): EditableLevelCatalog {
  const children = new Map<string, number>();
  const belts = new Set<string>();
  for (const definition of definitions) {
    const parent = definition.parentDefinitionKey;
    if (definition.kind === "stripe" && typeof parent === "string") {
      children.set(parent, (children.get(parent) ?? 0) + 1);
    } else {
      belts.add(String(definition.definitionKey));
    }
  }
  return {
    systemId,
    updatedAt: stringOr(system.updatedAt, "never"),
    displayName: stringOr(system.displayName, systemId),
    levels: [...definitions].sort(bySequence).map((definition) => {
      const visual = isRecord(definition.visual) ? definition.visual : {};
      const key = String(definition.definitionKey);
      return {
        definitionKey: key,
        kind: definition.kind === "stripe" ? ("stripe" as const) : ("belt" as const),
        parentDefinitionKey: stringOr(definition.parentDefinitionKey, null),
        name: String(definition.name ?? key),
        sequence: numberOr(definition.sequence, 1),
        stripeNumber: numberOr(definition.stripeNumber, null),
        criteria: criteriaOf(definition.criteria),
        visual: {
          colors: Array.isArray(visual.colors) ? visual.colors.map(String) : [],
          stripeColor: stringOr(visual.stripeColor, null),
          stripeCount: definition.kind === "stripe" ? 0 : (children.get(key) ?? 0),
        },
      };
    }),
    skills: storedSkills(system)
      .sort(bySequence)
      .map((skill) => ({
        key: String(skill.key),
        displayLabel: String(skill.displayLabel ?? skill.key),
        minimumRating: numberOr(skill.minimumRating, 1),
        sequence: numberOr(skill.sequence, 1),
      })),
    beltTechniques: requirements
      .filter((requirement) => belts.has(String(requirement.definitionKey)))
      .map((requirement) => ({
        beltKey: String(requirement.definitionKey),
        skillKey: String(requirement.skillKey),
        minimumRating: numberOr(requirement.minimumRating, 1),
      }))
      .sort((left, right) =>
        `${left.beltKey}__${left.skillKey}`.localeCompare(`${right.beltKey}__${right.skillKey}`),
      ),
  };
}

function sameStructure(stored: StoredData, level: CatalogLevel): boolean {
  return (
    stored.kind === level.kind &&
    (stored.parentDefinitionKey ?? null) === level.parentDefinitionKey &&
    stored.sequence === level.sequence &&
    (stored.stripeNumber ?? null) === level.stripeNumber
  );
}

/** A stripe always wears its belt's colours. */
function nextDefinition(
  previous: StoredData,
  level: CatalogLevel,
  colours: CatalogLevel["visual"],
): StoredData {
  const visual = isRecord(previous.visual) ? previous.visual : {};
  return {
    ...previous,
    name: level.name,
    criteria: level.criteria,
    visual: { ...visual, colors: [...colours.colors], stripeColor: colours.stripeColor },
  };
}

export function requirementDocument(
  academyId: string,
  systemId: string,
  definitionKey: string,
  skillKey: string,
  minimumRating: number,
  previous: StoredData | undefined,
): StoredData {
  return {
    requirementKey: `${definitionKey}__${skillKey}`,
    systemId,
    definitionKey,
    skillKey,
    minimumRating,
    inheritance: stringOr(previous?.inheritance, "inherit"),
    schemaVersion: 1,
    academyId,
  };
}

function storedSkill(skill: CatalogSkill, sequence: number, previous: StoredData | undefined) {
  return {
    key: skill.key,
    displayLabel: skill.displayLabel,
    observedLabel: stringOr(previous?.observedLabel, null),
    minimumRating: skill.minimumRating,
    sequence,
  };
}

/** sha256 of a catalogue's content, the same shape `publishDraft` sealed before. */
export function catalogueContentHash(
  systemId: string,
  system: StoredData,
  definitions: readonly { id: string; data: StoredData }[],
  requirements: readonly { id: string; data: StoredData }[],
): string {
  return hashLevelCatalogValue({
    system: {
      systemId,
      displayName: system.displayName,
      counts: system.counts,
      skillCatalog: system.skillCatalog,
    },
    definitions: [...definitions].sort(byId),
    requirements: [...requirements].sort(byId),
  });
}

export function catalogueCorrelationId(
  action: string,
  academyId: string,
  systemId: string,
  operationId: string,
): string {
  const digest = createHash("sha256");
  for (const value of [action, academyId, systemId, operationId]) {
    digest.update(`${Buffer.byteLength(value, "utf8")}:`, "utf8");
    digest.update(value, "utf8");
  }
  return `level-catalog-${digest.digest("hex")}`;
}

export function levelCatalogAuditDraft(value: Record<string, unknown>): AuditEventDraft {
  const parsed = parseAuditEventDraft(value);
  if (!parsed.ok) throw new LevelEditorError("invalid", "Invalid level catalogue audit event.");
  return parsed.value;
}

export function createLevelEditorService({
  firestore,
  now = () => new Date().toISOString(),
  newOperationId = randomUUID,
}: {
  firestore: LevelEditorFirestore;
  now?: () => string;
  newOperationId?: () => string;
}): LevelEditorService {
  const ofSystem = (academyId: string, collection: string, systemId: string) =>
    firestore
      .collection(`academies/${academyId}/${collection}`)
      .where("systemId", "==", systemId);

  async function readActive(transaction: LevelEditorTransaction, academyId: string) {
    const state = await transaction.get(
      firestore.doc(`academies/${academyId}/levelCatalogState/${activeStateId}`),
    );
    const systemId = state.data()?.activeSystemId;
    if (!isCustomLevelSystemId(systemId)) {
      throw new LevelEditorError("conflict", "Run the catalogue adoption first.");
    }
    const systemRef = firestore.doc(`academies/${academyId}/levelSystems/${systemId}`);
    const [system, definitions, requirements] = await Promise.all([
      transaction.get(systemRef),
      transaction.get(ofSystem(academyId, "levelDefinitions", systemId)),
      transaction.get(ofSystem(academyId, "levelRequirements", systemId)),
    ]);
    const systemData = system.data();
    if (!system.exists || systemData?.academyId !== academyId) {
      throw new LevelEditorError("not-found", "The belt catalogue does not exist.");
    }
    const own = (snapshot: EditorQuerySnapshot) =>
      snapshot.docs.filter((document) => document.data().academyId === academyId);
    return {
      systemId,
      systemRef,
      system: systemData,
      definitions: own(definitions),
      requirements: own(requirements),
    };
  }

  return {
    async getEditable(academyId) {
      assertIdentifier(academyId);
      return firestore.runTransaction(async (transaction) => {
        const active = await readActive(transaction, academyId);
        return editableContent(
          active.systemId,
          active.system,
          active.definitions.map((document) => document.data()),
          active.requirements.map((document) => document.data()),
        );
      });
    },

    async save({ academyId, catalog, actorId }) {
      for (const value of [academyId, actorId]) assertIdentifier(value);
      const operationId = newOperationId();
      const at = now();
      return firestore.runTransaction(async (transaction) => {
        const { systemId, systemRef, system, definitions, requirements } = await readActive(
          transaction,
          academyId,
        );
        if (stringOr(system.updatedAt, "never") !== catalog.expectedUpdatedAt) {
          throw new LevelEditorError("stale", "The belt catalogue changed since it was loaded.");
        }
        const stored = new Map(
          definitions.map((document) => [String(document.data().definitionKey), document]),
        );
        if (
          stored.size !== catalog.levels.length ||
          catalog.levels.some((level) => {
            const document = stored.get(level.definitionKey);
            return document === undefined || !sameStructure(document.data(), level);
          })
        ) {
          throw new LevelEditorError("invalid", "Belts and stripes cannot be added or removed.");
        }

        const writes: (() => void)[] = [];
        const levels = new Map(catalog.levels.map((level) => [level.definitionKey, level]));
        const stripesOf = new Map<string, string[]>();
        const nextDefinitions: { id: string; data: StoredData }[] = [];
        for (const level of catalog.levels) {
          const document = stored.get(level.definitionKey)!;
          const belt =
            level.kind === "stripe" ? levels.get(level.parentDefinitionKey ?? "")! : level;
          if (level.kind === "stripe") {
            const list = stripesOf.get(belt.definitionKey) ?? [];
            list.push(level.definitionKey);
            stripesOf.set(belt.definitionKey, list);
          }
          const next = nextDefinition(document.data(), level, belt.visual);
          nextDefinitions.push({ id: document.id, data: next });
          if (hashLevelCatalogValue(next) !== hashLevelCatalogValue(document.data())) {
            writes.push(() => transaction.set(document.ref, next));
          }
        }

        const previous = new Map(requirements.map((document) => [document.id, document]));
        const desired = new Map<string, StoredData>();
        for (const technique of catalog.beltTechniques) {
          for (const key of [technique.beltKey, ...(stripesOf.get(technique.beltKey) ?? [])]) {
            const id = levelCatalogStorageId(systemId, `${key}__${technique.skillKey}`);
            desired.set(
              id,
              requirementDocument(
                academyId,
                systemId,
                key,
                technique.skillKey,
                technique.minimumRating,
                previous.get(id)?.data(),
              ),
            );
          }
        }
        for (const document of requirements) {
          if (!desired.has(document.id)) writes.push(() => transaction.delete(document.ref));
        }
        for (const [id, data] of desired) {
          const before = previous.get(id)?.data();
          if (before === undefined || hashLevelCatalogValue(before) !== hashLevelCatalogValue(data)) {
            writes.push(() =>
              transaction.set(firestore.doc(`academies/${academyId}/levelRequirements/${id}`), data),
            );
          }
        }
        // +2: the system document and the audit event.
        if (writes.length + 2 > maxWritesPerSave) {
          throw new LevelEditorError("conflict", "Too many changes in one save.");
        }

        const previousSkills = new Map(
          storedSkills(system).map((skill) => [String(skill.key), skill]),
        );
        const nextSystem: StoredData = {
          ...system,
          displayName: catalog.displayName,
          skillCatalog: catalog.skills.map((skill, index) =>
            storedSkill(skill, index + 1, previousSkills.get(skill.key)),
          ),
          updatedAt: at,
          updatedBy: actorId,
        };
        const nextRequirements = [...desired].map(([id, data]) => ({ id, data }));
        const contentHash = catalogueContentHash(
          systemId,
          nextSystem,
          nextDefinitions,
          nextRequirements,
        );
        nextSystem.contentHash = contentHash;
        nextSystem.sourceHash = contentHash;
        const audit = levelCatalogAuditDraft({
          academyId,
          actorId,
          action: "level.catalog.published",
          targetRef: `academies/${academyId}/levelSystems/${systemId}`,
          purpose: "level-catalog-maintenance",
          correlationId: catalogueCorrelationId(
            "level.catalog.published",
            academyId,
            systemId,
            operationId,
          ),
        });

        for (const write of writes) write();
        transaction.set(systemRef, nextSystem);
        appendAuditEventInTransaction(
          transaction,
          firestore.doc(`academies/${academyId}/auditEvents/audit-${audit.correlationId}`),
          audit,
        );
        return editableContent(
          systemId,
          nextSystem,
          nextDefinitions.map(({ data }) => data),
          nextRequirements.map(({ data }) => data),
        );
      });
    },
  };
}
```

- [ ] **Step 2: Replace the callables**

Write `apps/functions/src/levels/level-editor-callables.ts`:

```ts
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  saveLevelCatalogInputSchema,
  type EditableLevelCatalog,
} from "@bpt-jersey/domain/levels/editor";

import {
  createFirebaseLevelAuthorization,
  type AuthorizedLevelActor,
  type LevelAuthorizationService,
} from "./level-authorization.js";
import {
  createLevelEditorService,
  LevelEditorError,
  type LevelEditorService,
} from "./level-editor-service.js";

type EditorDependencies = Readonly<{
  service: LevelEditorService;
  authorization: LevelAuthorizationService;
}>;

const editorRoles = new Set(["owner", "administrator"]);

async function requireEditor(
  dependencies: EditorDependencies,
  request: CallableRequest<unknown>,
): Promise<AuthorizedLevelActor> {
  const actor = await dependencies.authorization.requireActor(request);
  if (!editorRoles.has(actor.role)) {
    throw new HttpsError("permission-denied", "An administrator or owner is required");
  }
  return actor;
}

function mapEditorError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof LevelEditorError) {
    if (error.code === "stale") {
      throw new HttpsError("aborted", "The belt catalogue changed since it was loaded");
    }
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Belt catalogue request is invalid");
    }
    if (error.code === "not-found") {
      throw new HttpsError("not-found", "Belt catalogue is not available");
    }
    throw new HttpsError("failed-precondition", error.message);
  }
  throw new HttpsError("internal", "Unable to update the belt catalogue");
}

export function createGetEditableLevelCatalogHandler(dependencies: EditorDependencies) {
  return async (request: CallableRequest<unknown>): Promise<EditableLevelCatalog> => {
    const actor = await requireEditor(dependencies, request);
    if (request.data !== null && request.data !== undefined) {
      throw new HttpsError("invalid-argument", "Belt catalogue payload is invalid");
    }
    try {
      return await dependencies.service.getEditable(actor.academyId);
    } catch (error) {
      return mapEditorError(error);
    }
  };
}

export function createSaveLevelCatalogHandler(dependencies: EditorDependencies) {
  return async (request: CallableRequest<unknown>): Promise<EditableLevelCatalog> => {
    const actor = await requireEditor(dependencies, request);
    const parsed = saveLevelCatalogInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", "Belt catalogue payload is invalid");
    }
    try {
      return await dependencies.service.save({
        academyId: actor.academyId,
        catalog: parsed.data,
        actorId: actor.userId,
      });
    } catch (error) {
      return mapEditorError(error);
    }
  };
}

let defaultDependencies: EditorDependencies | undefined;

function dependencies(): EditorDependencies {
  defaultDependencies ??= {
    service: createLevelEditorService({ firestore: getFirestore() as never }),
    authorization: createFirebaseLevelAuthorization(),
  };
  return defaultDependencies;
}

const options = { enforceAppCheck: true } as const;

export const getEditableLevelCatalog = onCall(options, (request) =>
  createGetEditableLevelCatalogHandler(dependencies())(request),
);
export const saveLevelCatalog = onCall(options, (request) =>
  createSaveLevelCatalogHandler(dependencies())(request),
);
```

- [ ] **Step 3: Update the deploy surface**

In `apps/functions/src/index.ts` replace the block

```ts
export {
  activateLevelCatalog,
  createLevelCatalogDraft,
  getLevelCatalogVersion,
  listLevelCatalogVersions,
  publishLevelCatalogDraft,
  saveLevelCatalogDraft,
} from "./levels/level-editor-callables.js";
```

with

```ts
export { getEditableLevelCatalog, saveLevelCatalog } from "./levels/level-editor-callables.js";
```

- [ ] **Step 4: Delete obsolete tests**

Run: `git rm apps/functions/src/levels/level-editor-service.test.ts apps/functions/src/levels/level-editor-callables.test.ts`

Then: `grep -rn "level-editor-service\|level-editor-callables\|reconcileDraftLevels" apps/functions/src --include=*.ts | grep -v "^apps/functions/src/levels/level-editor-"`
Expected: only `index.ts` (and, after Task 3, `level-catalog-adoption.ts`). If a test file still imports removed names, delete only the cases that use them.

- [ ] **Step 5: Typecheck the functions package**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A apps/functions/src/levels/level-editor-service.ts apps/functions/src/levels/level-editor-callables.ts apps/functions/src/index.ts
git commit -m "feat(levels): getEditableLevelCatalog and saveLevelCatalog replace the six version callables"
```

---

### Task 3: One-off adoption module and operator CLI

**Files:**
- Create: `apps/functions/src/levels/level-catalog-adoption.ts`
- Create: `apps/functions/scripts/adopt-level-catalog.mjs`

**Interfaces:**
- Consumes: `levelCatalogStorageId`, `hashLevelCatalogValue` (`./level-catalog-integrity.js`); `requirementDocument`, `catalogueContentHash`, `catalogueCorrelationId`, `levelCatalogAuditDraft` (`./level-editor-service.js`, Task 2); `appendAuditEventInTransaction`; `isCustomLevelSystemId`.
- Produces:
  - `planLevelCatalogAdoption(firestore: AdoptionFirestore, { academyId, generatedAt }): Promise<AdoptionPlan>`
  - `expectedAdoptionConfirmation(plan: AdoptionPlan): string`
  - `applyLevelCatalogAdoption(firestore, plan, { actorId, confirmation }): Promise<AdoptionResult>`
  - CLI: `node apps/functions/scripts/adopt-level-catalog.mjs --target=<emulator|production> --academy-id=<id> [--generated-at=<iso>] [--apply --actor-id=<uid> --confirmation=<exact> --target-confirmation=LEVELS-ADOPT-PRODUCTION-APPLY]`

- [ ] **Step 1: Write the adoption module**

Write `apps/functions/src/levels/level-catalog-adoption.ts`:

```ts
import { isCustomLevelSystemId } from "@bpt-jersey/domain/levels/editor";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { hashLevelCatalogValue, levelCatalogStorageId } from "./level-catalog-integrity.js";
import {
  catalogueContentHash,
  catalogueCorrelationId,
  levelCatalogAuditDraft,
  requirementDocument,
  type LevelEditorFirestore,
} from "./level-editor-service.js";

/**
 * One-off (2026-10-03): the active code catalogue (ibjjf-v3) becomes the academy's one editable
 * custom system. Techniques are unified per belt: the belt's own list wins; a belt with none takes
 * the union of its stripes' lists at the highest minimum. Then the pointer and every progress head
 * move to it and every other level system is deleted. Rerunning after success does nothing.
 */
type Data = Record<string, unknown>;
type Write = Readonly<{ path: string; data: Data }>;
type Batch = Readonly<{
  set: (reference: unknown, data: unknown) => void;
  delete: (reference: unknown) => void;
  commit: () => Promise<unknown>;
}>;
export type AdoptionFirestore = LevelEditorFirestore & Readonly<{ batch: () => Batch }>;

export type StripeChange = Readonly<{
  belt: string;
  stripe: string;
  added: readonly string[];
  removed: readonly string[];
}>;

export type AdoptionPlan = Readonly<{
  status: "ready" | "retire-only" | "already-adopted";
  academyId: string;
  generatedAt: string;
  fromSystemId: string;
  newSystemId: string;
  system: Data;
  definitions: readonly Write[];
  requirements: readonly Write[];
  retire: readonly string[];
  heads: number;
  stripeChanges: readonly StripeChange[];
  contentHash: string;
}>;

export type AdoptionResult = Readonly<{
  status: AdoptionPlan["status"];
  newSystemId: string;
  movedHeads: number;
  deletedDocuments: number;
}>;

const batchSize = 400;
const maxHeads = 450;

async function inBatches(
  firestore: AdoptionFirestore,
  items: readonly ((batch: Batch) => void)[],
): Promise<void> {
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = firestore.batch();
    for (const item of items.slice(start, start + batchSize)) item(batch);
    await batch.commit();
  }
}

export async function planLevelCatalogAdoption(
  firestore: AdoptionFirestore,
  { academyId, generatedAt }: { academyId: string; generatedAt: string },
): Promise<AdoptionPlan> {
  const base = `academies/${academyId}`;
  const [state, systems, heads] = await Promise.all([
    firestore.runTransaction((transaction) =>
      transaction.get(firestore.doc(`${base}/levelCatalogState/active`)),
    ),
    firestore.collection(`${base}/levelSystems`).get(),
    firestore.collection(`${base}/studentLevelProgress`).where("academyId", "==", academyId).get(),
  ]);
  const fromSystemId = String(state.data()?.activeSystemId ?? "");
  const others = systems.docs.map((document) => document.id).filter((id) => id !== fromSystemId);
  const empty = {
    academyId,
    generatedAt,
    fromSystemId,
    newSystemId: fromSystemId,
    system: {},
    definitions: [],
    requirements: [],
    retire: others,
    heads: heads.docs.length,
    stripeChanges: [],
  };
  if (isCustomLevelSystemId(fromSystemId)) {
    const status = others.length === 0 ? "already-adopted" : "retire-only";
    return { ...empty, status, contentHash: hashLevelCatalogValue({ ...empty, status }) };
  }
  const source = systems.docs.find((document) => document.id === fromSystemId)?.data();
  if (source === undefined) throw new Error("Active level system is missing.");

  const day = generatedAt.slice(0, 10).replaceAll("-", "");
  let n = 1;
  while (systems.docs.some((document) => document.id === `bpt-${day}-${n}`)) n += 1;
  const newSystemId = `bpt-${day}-${n}`;

  const [definitionsSnapshot, requirementsSnapshot] = await Promise.all([
    firestore.collection(`${base}/levelDefinitions`).where("systemId", "==", fromSystemId).get(),
    firestore.collection(`${base}/levelRequirements`).where("systemId", "==", fromSystemId).get(),
  ]);
  const sourceDefinitions = definitionsSnapshot.docs
    .map((document) => document.data())
    .filter((data) => data.academyId === academyId);
  const definitionKeys = new Set(sourceDefinitions.map((data) => String(data.definitionKey)));
  const stranded = heads.docs.filter(
    (document) => !definitionKeys.has(String(document.data().currentDefinitionKey ?? "")),
  );
  if (stranded.length > 0) {
    throw new Error(`${stranded.length} progress heads hold levels the active system lacks.`);
  }
  if (heads.docs.length > maxHeads) throw new Error("Too many progress heads for one adoption.");

  const ratings = new Map<string, Map<string, number>>();
  for (const document of requirementsSnapshot.docs) {
    const data = document.data();
    if (data.academyId !== academyId) continue;
    const list = ratings.get(String(data.definitionKey)) ?? new Map<string, number>();
    list.set(String(data.skillKey), Number(data.minimumRating));
    ratings.set(String(data.definitionKey), list);
  }
  const belts = sourceDefinitions.filter((data) => data.kind !== "stripe");
  const stripesOf = (beltKey: string) =>
    sourceDefinitions.filter((data) => data.kind === "stripe" && data.parentDefinitionKey === beltKey);
  const requirements: Write[] = [];
  const stripeChanges: StripeChange[] = [];
  for (const belt of belts) {
    const beltKey = String(belt.definitionKey);
    let unified = ratings.get(beltKey) ?? new Map<string, number>();
    if (unified.size === 0) {
      unified = new Map();
      for (const stripe of stripesOf(beltKey)) {
        for (const [skill, rating] of ratings.get(String(stripe.definitionKey)) ?? []) {
          unified.set(skill, Math.max(rating, unified.get(skill) ?? 0));
        }
      }
    }
    for (const level of [belt, ...stripesOf(beltKey)]) {
      const key = String(level.definitionKey);
      if (level !== belt) {
        const had = ratings.get(key) ?? new Map<string, number>();
        const added = [...unified.keys()].filter((skill) => !had.has(skill)).sort();
        const removed = [...had.keys()].filter((skill) => !unified.has(skill)).sort();
        if (added.length > 0 || removed.length > 0) {
          stripeChanges.push({ belt: String(belt.name), stripe: String(level.name), added, removed });
        }
      }
      for (const [skill, rating] of unified) {
        requirements.push({
          path: `${base}/levelRequirements/${levelCatalogStorageId(newSystemId, `${key}__${skill}`)}`,
          data: requirementDocument(academyId, newSystemId, key, skill, rating, undefined),
        });
      }
    }
  }
  const definitions: Write[] = sourceDefinitions.map((data) => ({
    path: `${base}/levelDefinitions/${levelCatalogStorageId(newSystemId, String(data.definitionKey))}`,
    data: { ...data, systemId: newSystemId, academyId },
  }));
  const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const system: Data = {
    ...source,
    systemId: newSystemId,
    academyId,
    origin: "custom",
    status: "published",
    publishedAt: generatedAt,
    updatedAt: generatedAt,
  };
  delete system.manifestId;
  const contentHash = catalogueContentHash(
    newSystemId,
    system,
    definitions.map((write) => ({ id: idOf(write.path), data: write.data })),
    requirements.map((write) => ({ id: idOf(write.path), data: write.data })),
  );
  system.contentHash = contentHash;
  system.sourceHash = contentHash;
  return {
    ...empty,
    status: "ready",
    newSystemId,
    system,
    definitions,
    requirements,
    retire: systems.docs.map((document) => document.id).filter((id) => id !== newSystemId),
    stripeChanges,
    contentHash,
  };
}

export function expectedAdoptionConfirmation(plan: AdoptionPlan): string {
  return `ADOPT-${plan.academyId}-${plan.newSystemId}-${plan.contentHash.slice(0, 12)}`;
}

export async function applyLevelCatalogAdoption(
  firestore: AdoptionFirestore,
  plan: AdoptionPlan,
  { actorId, confirmation }: { actorId: string; confirmation: string },
): Promise<AdoptionResult> {
  if (confirmation !== expectedAdoptionConfirmation(plan)) {
    throw new Error("The exact dry-run confirmation is required.");
  }
  const base = `academies/${plan.academyId}`;
  let movedHeads = 0;
  if (plan.status === "ready") {
    await inBatches(
      firestore,
      [...plan.definitions, ...plan.requirements].map(
        (write) => (batch) => batch.set(firestore.doc(write.path), write.data),
      ),
    );
    await inBatches(firestore, [
      (batch) =>
        batch.set(firestore.doc(`${base}/levelSystems/${plan.newSystemId}`), {
          ...plan.system,
          publishedBy: actorId,
          updatedBy: actorId,
        }),
    ]);
    movedHeads = await firestore.runTransaction(async (transaction) => {
      const stateRef = firestore.doc(`${base}/levelCatalogState/active`);
      const [state, heads] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(
          firestore
            .collection(`${base}/studentLevelProgress`)
            .where("academyId", "==", plan.academyId),
        ),
      ]);
      if (state.data()?.activeSystemId !== plan.fromSystemId) {
        throw new Error("The active level system changed since the dry-run.");
      }
      const operationId = `adopt-${plan.newSystemId}`;
      const audit = levelCatalogAuditDraft({
        academyId: plan.academyId,
        actorId,
        action: "level.catalog.activated",
        targetRef: `${base}/levelSystems/${plan.newSystemId}`,
        purpose: "level-catalog-maintenance",
        correlationId: catalogueCorrelationId(
          "level.catalog.activated",
          plan.academyId,
          plan.newSystemId,
          operationId,
        ),
        fromSystemId: plan.fromSystemId,
        toSystemId: plan.newSystemId,
      });
      transaction.set(stateRef, {
        academyId: plan.academyId,
        activeSystemId: plan.newSystemId,
        previousSystemId: plan.fromSystemId,
        operationId,
        contentHash: plan.contentHash,
        activatedAt: plan.generatedAt,
        activatedBy: actorId,
        schemaVersion: "1",
      });
      transaction.set(firestore.doc(`${base}/levelCatalogActivations/${operationId}`), {
        academyId: plan.academyId,
        fromSystemId: plan.fromSystemId,
        toSystemId: plan.newSystemId,
        operationId,
        contentHash: plan.contentHash,
        actorId,
        activatedAt: plan.generatedAt,
        movedStudents: heads.docs.length,
        schemaVersion: "1",
      });
      // Only the version pointer changes: the held level and its start date stay as they are.
      for (const head of heads.docs) {
        transaction.set(head.ref, { systemId: plan.newSystemId }, { merge: true });
      }
      appendAuditEventInTransaction(
        transaction,
        firestore.doc(`${base}/auditEvents/audit-${audit.correlationId}`),
        audit,
      );
      return heads.docs.length;
    });
  }

  if (plan.status === "already-adopted") {
    return { status: plan.status, newSystemId: plan.newSystemId, movedHeads: 0, deletedDocuments: 0 };
  }
  const heads = await firestore
    .collection(`${base}/studentLevelProgress`)
    .where("academyId", "==", plan.academyId)
    .get();
  if (heads.docs.some((head) => head.data().systemId !== plan.newSystemId)) {
    throw new Error("A progress head still points at an old level system; nothing was deleted.");
  }
  const deletions: ((batch: Batch) => void)[] = [];
  for (const systemId of plan.retire) {
    const [definitions, requirements] = await Promise.all([
      firestore.collection(`${base}/levelDefinitions`).where("systemId", "==", systemId).get(),
      firestore.collection(`${base}/levelRequirements`).where("systemId", "==", systemId).get(),
    ]);
    for (const document of [...definitions.docs, ...requirements.docs]) {
      if (document.data().academyId === plan.academyId) {
        deletions.push((batch) => batch.delete(document.ref));
      }
    }
    deletions.push((batch) => batch.delete(firestore.doc(`${base}/levelCatalogManifests/${systemId}`)));
    deletions.push((batch) => batch.delete(firestore.doc(`${base}/levelSystems/${systemId}`)));
  }
  await inBatches(firestore, deletions);
  return {
    status: plan.status,
    newSystemId: plan.newSystemId,
    movedHeads,
    deletedDocuments: deletions.length,
  };
}
```

- [ ] **Step 2: Write the CLI**

Write `apps/functions/scripts/adopt-level-catalog.mjs` (same structure, flags and target guard as `migrate-level-progress.mjs`; it imports the compiled module from `.firebase-functions`, so it runs from the repo root after `build-deploy-artifact.mjs`):

```js
#!/usr/bin/env node

import { createRequire } from "node:module";

import { assertLevelSeedTargetEnvironment } from "./level-seed-target.mjs";

class CliError extends Error {}

const allowed = new Set([
  "target",
  "academy-id",
  "generated-at",
  "apply",
  "confirmation",
  "target-confirmation",
  "actor-id",
]);
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function parseArguments(values) {
  const options = Object.create(null);
  for (const argument of values) {
    if (!argument.startsWith("--")) throw new CliError("Invalid adoption arguments.");
    const option = argument.slice(2);
    if (option === "apply") {
      if (options.apply === true) throw new CliError("Duplicate --apply.");
      options.apply = true;
      continue;
    }
    const separator = option.indexOf("=");
    if (separator < 1) throw new CliError("Invalid adoption arguments.");
    const key = option.slice(0, separator);
    const value = option.slice(separator + 1);
    if (!allowed.has(key) || value.length === 0 || Object.hasOwn(options, key)) {
      throw new CliError("Invalid adoption arguments.");
    }
    options[key] = value;
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || !identifier.test(value)) {
    throw new CliError(`Missing or invalid --${name}.`);
  }
  return value;
}

let deleteInitializedApp;
try {
  const options = parseArguments(process.argv.slice(2));
  const target = required(options, "target");
  const academyId = required(options, "academy-id");
  const generatedAt = options["generated-at"] ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt)) || new Date(generatedAt).toISOString() !== generatedAt) {
    throw new CliError("Invalid --generated-at.");
  }
  const initialEnvironment = {
    gcloudProjectId: process.env.GCLOUD_PROJECT,
    firebaseConfig: process.env.FIREBASE_CONFIG,
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    nodeEnvironment: process.env.NODE_ENV,
  };
  const binding = assertLevelSeedTargetEnvironment(target, initialEnvironment);
  let actorId;
  if (options.apply === true) {
    actorId = required(options, "actor-id");
    if (target === "production" && options["target-confirmation"] !== "LEVELS-ADOPT-PRODUCTION-APPLY") {
      throw new CliError("Confirmation required for production: LEVELS-ADOPT-PRODUCTION-APPLY");
    }
  }

  const modulePath = "../../../.firebase-functions/lib/src/levels/level-catalog-adoption.js";
  const artifactRequire = createRequire(new URL(modulePath, import.meta.url));
  const firebaseApp = artifactRequire("firebase-admin/app");
  const existingApp = firebaseApp.getApps()[0];
  const verified = assertLevelSeedTargetEnvironment(target, {
    ...initialEnvironment,
    existingAppPresent: existingApp !== undefined,
    existingAppProjectId: existingApp?.options.projectId,
  });
  if (verified.projectId !== binding.projectId) throw new CliError("Adoption target changed.");
  const app = existingApp ?? firebaseApp.initializeApp({ projectId: binding.projectId });
  if (existingApp === undefined) deleteInitializedApp = () => firebaseApp.deleteApp(app);
  const firestore = artifactRequire("firebase-admin/firestore").getFirestore(app);
  const adoption = await import(modulePath);

  const plan = await adoption.planLevelCatalogAdoption(firestore, { academyId, generatedAt });
  const exactConfirmation = adoption.expectedAdoptionConfirmation(plan);
  if (options.apply !== true) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "dry-run",
          target,
          academyId,
          generatedAt,
          status: plan.status,
          fromSystemId: plan.fromSystemId,
          newSystemId: plan.newSystemId,
          definitions: plan.definitions.length,
          requirements: plan.requirements.length,
          heads: plan.heads,
          retire: plan.retire,
          stripeChanges: plan.stripeChanges,
          exactConfirmation,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const result = await adoption.applyLevelCatalogAdoption(firestore, plan, {
      actorId,
      confirmation: options.confirmation,
    });
    process.stdout.write(`${JSON.stringify({ mode: "apply", target, academyId, ...result }, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof CliError ? error.message : "Level catalogue adoption failed."}\n`);
  if (process.env.BPT_OPERATOR_DEBUG === "1") console.error(error);
  process.exitCode = 1;
} finally {
  if (deleteInitializedApp !== undefined) await deleteInitializedApp();
}
```

- [ ] **Step 3: Typecheck and syntax-check**

Run: `corepack pnpm --filter @bpt-jersey/functions typecheck && node --check apps/functions/scripts/adopt-level-catalog.mjs`
Expected: exit 0 for both.

- [ ] **Step 4: Commit**

```bash
git add apps/functions/src/levels/level-catalog-adoption.ts apps/functions/scripts/adopt-level-catalog.mjs
git commit -m "feat(levels): one-off adoption CLI copies ibjjf-v3 into the editable catalogue and retires the rest"
```

---

### Task 4: Web client

**Files:**
- Rewrite: `apps/web/src/lib/level-editor-client.ts`

**Interfaces:**
- Consumes: Task 1 schemas/types.
- Produces:
  - `levelEditorSafeErrors = { load: string; save: string }`
  - `getEditableLevelCatalog(): Promise<EditableLevelCatalog>`
  - `type SaveLevelCatalogOutcome = { kind: "saved"; catalog: EditableLevelCatalog } | { kind: "stale" }`
  - `saveLevelCatalog(input: SaveLevelCatalogInput): Promise<SaveLevelCatalogOutcome>` (throws `Error(levelEditorSafeErrors.save)` on any other failure)

- [ ] **Step 1: Replace the client**

```ts
import {
  editableLevelCatalogSchema,
  saveLevelCatalogInputSchema,
  type EditableLevelCatalog,
  type SaveLevelCatalogInput,
} from "@bpt-jersey/domain/levels/editor";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

export const levelEditorSafeErrors = Object.freeze({
  load: "Unable to load the belt catalogue. Please try again.",
  save: "Unable to save. Check the fields and try again.",
});

export async function getEditableLevelCatalog(): Promise<EditableLevelCatalog> {
  try {
    const response = await httpsCallable<null, unknown>(
      getFirebaseFunctions(),
      "getEditableLevelCatalog",
    )(null);
    const parsed = editableLevelCatalogSchema.safeParse(response.data);
    if (parsed.success) return parsed.data;
  } catch {
    // Firebase errors never reach the screen.
  }
  throw new Error(levelEditorSafeErrors.load);
}

export type SaveLevelCatalogOutcome =
  | Readonly<{ kind: "saved"; catalog: EditableLevelCatalog }>
  | Readonly<{ kind: "stale" }>;

/** Someone else saving first is an expected answer, not a failure: it comes back as `stale`. */
export async function saveLevelCatalog(
  input: SaveLevelCatalogInput,
): Promise<SaveLevelCatalogOutcome> {
  const request = saveLevelCatalogInputSchema.safeParse(input);
  if (!request.success) throw new Error(levelEditorSafeErrors.save);
  try {
    const response = await httpsCallable<unknown, unknown>(
      getFirebaseFunctions(),
      "saveLevelCatalog",
    )(request.data);
    const parsed = editableLevelCatalogSchema.safeParse(response.data);
    if (parsed.success) return { kind: "saved", catalog: parsed.data };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code: unknown }).code
        : undefined;
    if (code === "functions/aborted") return { kind: "stale" };
  }
  throw new Error(levelEditorSafeErrors.save);
}
```

- [ ] **Step 2: Commit** (typecheck runs in Task 8 once the old UI is gone)

```bash
git add apps/web/src/lib/level-editor-client.ts
git commit -m "feat(levels): web client for getEditableLevelCatalog and saveLevelCatalog"
```

---

### Task 5: Read-only belt grid without the techniques wall

**Files:**
- Modify: `apps/web/src/app/levels/levels-grouping.ts` (delete `TechniqueSet`, `describeStripeRange`, `techniqueSets`)
- Modify: `apps/web/src/app/levels/levels-grouping.test.ts` (delete the `techniqueSets` describe block and its import; do not run)
- Modify: `apps/web/src/app/levels/levels-browser.tsx`
- Modify: `apps/web/src/app/levels/levels.css:177-190`

**Interfaces:**
- Produces: `LevelsBrowser` props `{ roleContext?; version?: number; renderBeltEditor?: (beltKey: string) => React.ReactNode }`; `version` changing reloads the catalogue.

- [ ] **Step 1: Remove `techniqueSets` from grouping**

Delete from `levels-grouping.ts` the `TechniqueSet` type, `describeStripeRange` and `techniqueSets` (the block between `export type TechniqueSet` and `export function formatAgeRange`). Remove the matching `describe("techniqueSets", …)` block and the `techniqueSets` import in `levels-grouping.test.ts`.

- [ ] **Step 2: Browser props, reload and techniques per belt**

In `levels-browser.tsx`:

1. Remove `techniqueSets` and `SkillDefinition` from the imports.
2. Replace the props type and signature:

```tsx
export type LevelsBrowserProps = Readonly<{
  roleContext?: "admin" | "coach" | "client";
  /** Changing it reloads the catalogue (after an edit is saved). */
  version?: number;
  /** Editors only: rendered at the bottom of each belt card. */
  renderBeltEditor?: (beltKey: string) => React.ReactNode;
}>;
```

```tsx
export function LevelsBrowser({
  roleContext = "admin",
  version = 0,
  renderBeltEditor,
}: LevelsBrowserProps) {
```

3. Change the loading effect's dependency array from `[]` to `[version]`.
4. Replace the `skillsMap` and `requirementsByDefKey` memos with:

```tsx
  // A belt's techniques are the requirements on the belt itself; its stripes carry the same list.
  const techniquesByBelt = useMemo(() => {
    const map = new Map<string, { key: string; label: string; rating: number }[]>();
    if (!catalog) return map;
    const labels = new Map(catalog.skills.map((skill) => [skill.key, skill.displayLabel]));
    for (const requirement of catalog.requirements) {
      const list = map.get(requirement.definitionKey) ?? [];
      list.push({
        key: requirement.skillKey,
        label: labels.get(requirement.skillKey) ?? requirement.skillKey,
        rating: requirement.minimumRating,
      });
      map.set(requirement.definitionKey, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.label.localeCompare(b.label));
    return map;
  }, [catalog]);
```

5. Replace the `techniqueSets(...)` JSX block inside the card with:

```tsx
                {(() => {
                  const techniques = techniquesByBelt.get(belt.definitionKey) ?? [];
                  return techniques.length > 0 ? (
                    <details className="belt-techniques">
                      <summary>
                        {techniques.length} {techniques.length === 1 ? "technique" : "techniques"}
                      </summary>
                      <ul>
                        {techniques.map((technique) => (
                          <li key={technique.key}>
                            <span>{technique.label}</span>
                            <span>Min {technique.rating}/5</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null;
                })()}
                {renderBeltEditor?.(belt.definitionKey)}
```

- [ ] **Step 3: CSS**

In `levels.css` replace the `.belt-skills` and `.belt-skills span` rules with:

```css
.belt-techniques {
  border-left: 0.35rem solid var(--bpt-purple);
  margin: 0 1.1rem;
  padding-left: 0.75rem;
}
.belt-techniques summary {
  color: var(--bpt-purple);
  cursor: pointer;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  min-height: 44px;
  display: flex;
  align-items: center;
  text-transform: uppercase;
}
.belt-techniques summary:focus-visible {
  outline: 3px solid var(--bpt-purple);
  outline-offset: 4px;
}
.belt-techniques ul {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
}
.belt-techniques li {
  border-top: 1px solid var(--paper-edge, #e8e7e3);
  color: var(--muted);
  display: flex;
  font-size: 0.9rem;
  gap: 1rem;
  justify-content: space-between;
  padding: 0.35rem 0;
}
.belt-techniques li span:last-child {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* The belt being edited takes the whole row so its form has room. */
.belt-card:has(.belt-editor[data-editing]) {
  grid-column: 1 / -1;
}
```

Before writing, check the custom property names used elsewhere in `levels.css` (`grep -n "var(--" apps/web/src/app/levels/levels.css | head`) and use the same ones for purple, muted and paper edge.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/levels/
git commit -m "feat(levels): belt cards list techniques in a collapsed list instead of paragraphs"
```

---

### Task 6: Inline belt editor

**Files:**
- Create: `apps/web/src/app/admin/levels/belt-editor.tsx`

**Interfaces:**
- Consumes: `EditableLevelCatalog`, `CatalogLevel`, `BeltTechnique` (Task 1); `BeltBar` from `../../levels/levels-browser`.
- Produces:
  - `type CatalogContent = Omit<EditableLevelCatalog, "systemId" | "updatedAt">`
  - `BeltEditor(props: { catalog: EditableLevelCatalog; beltKey: string; editing: boolean; locked: boolean; busy: boolean; onEdit: () => void; onClose: () => void; onSave: (next: CatalogContent) => Promise<boolean> })`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import type {
  BeltTechnique,
  CatalogLevel,
  EditableLevelCatalog,
} from "@bpt-jersey/domain/levels/editor";

import { BeltBar } from "../../levels/levels-browser";
import { ordinal } from "../../levels/levels-grouping";

export type CatalogContent = Omit<EditableLevelCatalog, "systemId" | "updatedAt">;

const hexPattern = /^#[0-9a-fA-F]{6}$/u;
const maxColours = 3;

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function minimumDays(level: CatalogLevel): number | null {
  const time = level.criteria.minimumTime;
  return time === null ? null : time.years * 365 + time.months * 30 + time.days;
}

function withDays(level: CatalogLevel, days: number | null): CatalogLevel {
  return {
    ...level,
    criteria: {
      ...level.criteria,
      minimumTime: days === null ? null : { years: 0, months: 0, days },
    },
  };
}

/**
 * One colour: native picker plus the hex it mirrors. A hex is applied only once it is a full
 * `#RRGGBB`; until then the field says so and the preview keeps the last valid colour.
 */
function ColourField({
  id,
  label,
  value,
  onColour,
  onInvalid,
}: {
  id: string;
  label: string;
  value: string;
  onColour: (colour: string) => void;
  onInvalid: (id: string, invalid: boolean) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <div className="levels-editor-colour">
      <input
        aria-label={`${label} picker`}
        className="levels-editor-picker"
        onChange={(event) => {
          setRaw(null);
          onInvalid(id, false);
          onColour(event.target.value.toUpperCase());
        }}
        type="color"
        value={value.toLowerCase()}
      />
      <label className="levels-editor-field">
        <span>{label} hex</span>
        <input
          aria-describedby={raw === null ? undefined : `${id}-hint`}
          aria-invalid={raw !== null}
          maxLength={7}
          onChange={(event) => {
            const next = event.target.value.trim();
            if (hexPattern.test(next)) {
              setRaw(null);
              onInvalid(id, false);
              onColour(next.toUpperCase());
            } else {
              setRaw(next);
              onInvalid(id, true);
            }
          }}
          spellCheck={false}
          value={raw ?? value}
        />
      </label>
      {raw === null ? null : (
        <p className="levels-editor-hint" id={`${id}-hint`} role="alert">
          Enter a colour like #1A2B3C
        </p>
      )}
    </div>
  );
}

export function BeltEditor({
  catalog,
  beltKey,
  editing,
  locked,
  busy,
  onEdit,
  onClose,
  onSave,
}: {
  catalog: EditableLevelCatalog;
  beltKey: string;
  editing: boolean;
  locked: boolean;
  busy: boolean;
  onEdit: () => void;
  onClose: () => void;
  onSave: (next: CatalogContent) => Promise<boolean>;
}) {
  const original = useMemo(() => {
    const belt = catalog.levels.find((level) => level.definitionKey === beltKey)!;
    const stripes = catalog.levels
      .filter((level) => level.parentDefinitionKey === beltKey)
      .sort((a, b) => a.sequence - b.sequence);
    const techniques = catalog.beltTechniques.filter((t) => t.beltKey === beltKey);
    return { belt, stripes, techniques };
  }, [catalog, beltKey]);
  const [belt, setBelt] = useState(original.belt);
  const [stripes, setStripes] = useState(original.stripes);
  const [techniques, setTechniques] = useState<BeltTechnique[]>(original.techniques);
  const [invalidHex, setInvalidHex] = useState<ReadonlySet<string>>(new Set());
  const [pick, setPick] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const labels = useMemo(
    () => new Map(catalog.skills.map((skill) => [skill.key, skill.displayLabel])),
    [catalog.skills],
  );
  const available = catalog.skills.filter(
    (skill) => !techniques.some((technique) => technique.skillKey === skill.key),
  );
  const dirty =
    JSON.stringify({ belt, stripes, techniques }) !== JSON.stringify(original);
  const ageError =
    belt.criteria.minAge !== null &&
    belt.criteria.maxAge !== null &&
    belt.criteria.minAge > belt.criteria.maxAge
      ? "Minimum age must not be above maximum age."
      : null;
  const nameError = belt.name.trim() === "" ? "Enter a belt name." : null;
  const blocked = busy || invalidHex.size > 0 || ageError !== null || nameError !== null;

  function reset(): void {
    setBelt(original.belt);
    setStripes(original.stripes);
    setTechniques(original.techniques);
    setInvalidHex(new Set());
    setPick("");
    setPickError(null);
  }

  if (!editing) {
    return (
      <div className="belt-editor">
        <button
          className="levels-editor-button"
          disabled={locked}
          onClick={() => {
            reset();
            onEdit();
          }}
          type="button"
        >
          Edit belt
        </button>
      </div>
    );
  }

  function markHex(id: string, invalid: boolean): void {
    setInvalidHex((current) => {
      const next = new Set(current);
      if (invalid) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setColours(colors: string[]): void {
    setBelt((current) => ({ ...current, visual: { ...current.visual, colors } }));
  }

  function addPicked(): void {
    const skill = available.find(
      (item) => item.displayLabel.toLowerCase() === pick.trim().toLowerCase(),
    );
    if (skill === undefined) {
      setPickError("Pick a technique from the list. New ones are added in the Techniques tab.");
      return;
    }
    setTechniques((current) => [
      ...current,
      { beltKey, skillKey: skill.key, minimumRating: skill.minimumRating },
    ]);
    setPick("");
    setPickError(null);
  }

  async function save(): Promise<void> {
    const replaced = new Map(
      [belt, ...stripes].map((level) => [level.definitionKey, { ...level, name: level.name.trim() }]),
    );
    const saved = await onSave({
      displayName: catalog.displayName,
      levels: catalog.levels.map((level) => replaced.get(level.definitionKey) ?? level),
      skills: catalog.skills,
      beltTechniques: [
        ...catalog.beltTechniques.filter((technique) => technique.beltKey !== beltKey),
        ...techniques,
      ],
    });
    if (saved) onClose();
  }

  function cancel(): void {
    if (dirty) dialog.current?.showModal();
    else onClose();
  }

  const id = `belt-editor-${beltKey}`;
  return (
    <section aria-labelledby={`${id}-title`} className="belt-editor" data-editing="">
      <h3 id={`${id}-title`}>Edit {original.belt.name}</h3>
      <BeltBar
        name={belt.name}
        stripeCount={stripes.length}
        visual={{
          colorMode: 1,
          colors: belt.visual.colors,
          stripeColor: belt.visual.stripeColor,
          stripeCenter: null,
          stripeWidth: null,
          stripePosition: null,
        }}
      />
      <label className="levels-editor-field">
        <span>Name</span>
        <input
          aria-describedby={nameError ? `${id}-name-error` : undefined}
          aria-invalid={nameError !== null}
          maxLength={80}
          onChange={(event) => setBelt({ ...belt, name: event.target.value })}
          value={belt.name}
        />
      </label>
      {nameError ? (
        <p className="levels-editor-hint" id={`${id}-name-error`} role="alert">
          {nameError}
        </p>
      ) : null}

      <fieldset className="levels-editor-group">
        <legend>Colours</legend>
        {belt.visual.colors.map((colour, index) => (
          <ColourField
            id={`${id}-colour-${index}`}
            key={index}
            label={`Belt colour ${index + 1}`}
            onColour={(next) =>
              setColours(belt.visual.colors.map((value, at) => (at === index ? next : value)))
            }
            onInvalid={markHex}
            value={colour}
          />
        ))}
        <div className="levels-editor-row">
          {belt.visual.colors.length < maxColours ? (
            <button
              className="levels-editor-button"
              onClick={() => setColours([...belt.visual.colors, belt.visual.colors.at(-1)!])}
              type="button"
            >
              Add colour
            </button>
          ) : null}
          {belt.visual.colors.length > 1 ? (
            <button
              className="levels-editor-button"
              onClick={() => {
                markHex(`${id}-colour-${belt.visual.colors.length - 1}`, false);
                setColours(belt.visual.colors.slice(0, -1));
              }}
              type="button"
            >
              Remove last colour
            </button>
          ) : null}
        </div>
        <ColourField
          id={`${id}-stripe`}
          label="Stripe colour"
          onColour={(next) =>
            setBelt({ ...belt, visual: { ...belt.visual, stripeColor: next } })
          }
          onInvalid={markHex}
          value={belt.visual.stripeColor ?? "#FFFFFF"}
        />
      </fieldset>

      <fieldset className="levels-editor-group levels-editor-grid">
        <legend>Belt criteria</legend>
        {(
          [
            ["Minimum age", "minAge", 3, 99],
            ["Maximum age", "maxAge", 3, 99],
            ["Minimum classes", "minClasses", 0, 10_000],
          ] as const
        ).map(([label, field, min, max]) => (
          <label className="levels-editor-field" key={field}>
            <span>{label}</span>
            <input
              inputMode="numeric"
              max={max}
              min={min}
              onChange={(event) =>
                setBelt({
                  ...belt,
                  criteria: { ...belt.criteria, [field]: numberOrNull(event.target.value) },
                })
              }
              type="number"
              value={belt.criteria[field] ?? ""}
            />
          </label>
        ))}
        <label className="levels-editor-field">
          <span>Minimum days</span>
          <input
            inputMode="numeric"
            min={0}
            onChange={(event) => setBelt(withDays(belt, numberOrNull(event.target.value)))}
            type="number"
            value={minimumDays(belt) ?? ""}
          />
        </label>
      </fieldset>
      {ageError ? (
        <p className="levels-editor-hint" role="alert">
          {ageError}
        </p>
      ) : null}

      {stripes.length > 0 ? (
        <div className="belt-editor-stripes">
          <table>
            <caption>Stripes</caption>
            <thead>
              <tr>
                <th scope="col">Stripe</th>
                <th scope="col">Minimum classes</th>
                <th scope="col">Minimum days</th>
              </tr>
            </thead>
            <tbody>
              {stripes.map((stripe, index) => {
                const name = `${ordinal(stripe.stripeNumber ?? index + 1)} stripe`;
                const update = (next: CatalogLevel) =>
                  setStripes(stripes.map((item, at) => (at === index ? next : item)));
                return (
                  <tr key={stripe.definitionKey}>
                    <th scope="row">{name}</th>
                    <td>
                      <input
                        aria-label={`${name} minimum classes`}
                        inputMode="numeric"
                        min={0}
                        onChange={(event) =>
                          update({
                            ...stripe,
                            criteria: {
                              ...stripe.criteria,
                              minClasses: numberOrNull(event.target.value),
                            },
                          })
                        }
                        type="number"
                        value={stripe.criteria.minClasses ?? ""}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${name} minimum days`}
                        inputMode="numeric"
                        min={0}
                        onChange={(event) =>
                          update(withDays(stripe, numberOrNull(event.target.value)))
                        }
                        type="number"
                        value={minimumDays(stripe) ?? ""}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <fieldset className="levels-editor-group">
        <legend>Techniques for this belt and its stripes</legend>
        {techniques.length === 0 ? (
          <p className="levels-editor-muted">No techniques required.</p>
        ) : (
          <ul className="levels-editor-list">
            {techniques.map((technique) => {
              const label = labels.get(technique.skillKey) ?? technique.skillKey;
              return (
                <li key={technique.skillKey}>
                  <span>{label}</span>
                  <label className="levels-editor-field levels-editor-inline">
                    <span>Minimum rating</span>
                    <select
                      onChange={(event) =>
                        setTechniques(
                          techniques.map((item) =>
                            item === technique
                              ? { ...item, minimumRating: Number(event.target.value) }
                              : item,
                          ),
                        )
                      }
                      value={technique.minimumRating}
                    >
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <option key={rating} value={rating}>
                          {rating} of 5
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    aria-label={`Remove ${label}`}
                    className="levels-editor-button"
                    onClick={() => setTechniques(techniques.filter((item) => item !== technique))}
                    type="button"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {available.length > 0 ? (
          <div className="levels-editor-row">
            <label className="levels-editor-field">
              <span>Add technique</span>
              <input
                aria-describedby={pickError ? `${id}-pick-error` : undefined}
                list={`${id}-options`}
                maxLength={80}
                onChange={(event) => {
                  setPick(event.target.value);
                  setPickError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addPicked();
                  }
                }}
                value={pick}
              />
              <datalist id={`${id}-options`}>
                {available.map((skill) => (
                  <option key={skill.key} value={skill.displayLabel} />
                ))}
              </datalist>
            </label>
            <button className="levels-editor-button" onClick={addPicked} type="button">
              Add
            </button>
          </div>
        ) : null}
        {pickError ? (
          <p className="levels-editor-hint" id={`${id}-pick-error`} role="alert">
            {pickError}
          </p>
        ) : null}
      </fieldset>

      <div className="levels-editor-actions">
        <button
          className="levels-editor-button"
          data-variant="primary"
          disabled={blocked || !dirty}
          onClick={() => void save()}
          type="button"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="levels-editor-button" disabled={busy} onClick={cancel} type="button">
          Cancel
        </button>
      </div>

      <dialog aria-labelledby={`${id}-discard`} className="levels-editor-dialog" ref={dialog}>
        <p id={`${id}-discard`}>Discard the changes to {original.belt.name}?</p>
        <div className="levels-editor-row">
          <button
            className="levels-editor-button"
            data-variant="primary"
            onClick={() => {
              dialog.current?.close();
              onClose();
            }}
            type="button"
          >
            Discard changes
          </button>
          <button
            className="levels-editor-button"
            onClick={() => dialog.current?.close()}
            type="button"
          >
            Keep editing
          </button>
        </div>
      </dialog>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/admin/levels/belt-editor.tsx
git commit -m "feat(levels): inline belt editor for names, colours, belt and stripe criteria and techniques"
```

---

### Task 7: Techniques library

**Files:**
- Create: `apps/web/src/app/admin/levels/techniques-library.tsx`

**Interfaces:**
- Consumes: `EditableLevelCatalog`, `techniqueKey` (Task 1); `CatalogContent` (Task 6).
- Produces: `TechniquesLibrary(props: { catalog: EditableLevelCatalog; busy: boolean; onSave: (next: CatalogContent) => Promise<boolean> })`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { techniqueKey, type EditableLevelCatalog } from "@bpt-jersey/domain/levels/editor";

import type { CatalogContent } from "./belt-editor";

const duplicate = "That technique already exists.";

export function TechniquesLibrary({
  catalog,
  busy,
  onSave,
}: {
  catalog: EditableLevelCatalog;
  busy: boolean;
  onSave: (next: CatalogContent) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; label: string; error: string | null } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const usedIn = useMemo(() => {
    const counts = new Map<string, number>();
    for (const technique of catalog.beltTechniques) {
      counts.set(technique.skillKey, (counts.get(technique.skillKey) ?? 0) + 1);
    }
    return counts;
  }, [catalog.beltTechniques]);
  const visible = catalog.skills.filter((skill) =>
    skill.displayLabel.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const base = {
    displayName: catalog.displayName,
    levels: catalog.levels,
    skills: catalog.skills,
    beltTechniques: catalog.beltTechniques,
  };

  function taken(label: string, exceptKey?: string): boolean {
    const wanted = label.trim().toLowerCase();
    return catalog.skills.some(
      (skill) => skill.key !== exceptKey && skill.displayLabel.toLowerCase() === wanted,
    );
  }

  async function add(): Promise<void> {
    const label = newLabel.trim();
    if (label === "") return setAddError("Enter a technique name.");
    if (taken(label)) return setAddError(duplicate);
    const key = techniqueKey(label, new Set(catalog.skills.map((skill) => skill.key)));
    const saved = await onSave({
      ...base,
      skills: [
        ...catalog.skills,
        { key, displayLabel: label, minimumRating: 1, sequence: catalog.skills.length + 1 },
      ],
    });
    if (saved) setNewLabel("");
  }

  async function rename(): Promise<void> {
    if (renaming === null) return;
    const label = renaming.label.trim();
    if (label === "") return setRenaming({ ...renaming, error: "Enter a technique name." });
    if (taken(label, renaming.key)) return setRenaming({ ...renaming, error: duplicate });
    const saved = await onSave({
      ...base,
      skills: catalog.skills.map((skill) =>
        skill.key === renaming.key ? { ...skill, displayLabel: label } : skill,
      ),
    });
    if (saved) setRenaming(null);
  }

  async function remove(): Promise<void> {
    if (deleting === null) return;
    const saved = await onSave({
      ...base,
      skills: catalog.skills.filter((skill) => skill.key !== deleting),
      beltTechniques: catalog.beltTechniques.filter((t) => t.skillKey !== deleting),
    });
    if (saved) {
      dialog.current?.close();
      setDeleting(null);
    }
  }

  const deletingLabel = catalog.skills.find((skill) => skill.key === deleting)?.displayLabel;
  const deletingUses = deleting === null ? 0 : (usedIn.get(deleting) ?? 0);

  return (
    <section aria-labelledby="levels-techniques-title" className="levels-techniques">
      <h2 id="levels-techniques-title">Techniques</h2>
      <p className="levels-editor-muted">
        {catalog.skills.length} techniques. A belt requires them from its card on the Belts tab.
      </p>
      <div className="levels-editor-row">
        <label className="levels-editor-field">
          <span>New technique</span>
          <input
            aria-describedby={addError ? "levels-techniques-add-error" : undefined}
            aria-invalid={addError !== null}
            maxLength={80}
            onChange={(event) => {
              setNewLabel(event.target.value);
              setAddError(null);
            }}
            value={newLabel}
          />
        </label>
        <button
          className="levels-editor-button"
          data-variant="primary"
          disabled={busy}
          onClick={() => void add()}
          type="button"
        >
          Add technique
        </button>
      </div>
      {addError ? (
        <p className="levels-editor-hint" id="levels-techniques-add-error" role="alert">
          {addError}
        </p>
      ) : null}
      <label className="levels-editor-field">
        <span>Search techniques</span>
        <input onChange={(event) => setQuery(event.target.value)} type="search" value={query} />
      </label>

      <div className="levels-techniques-table-wrap">
        <table className="levels-techniques-table">
          <thead>
            <tr>
              <th scope="col">Technique</th>
              <th scope="col">Used in</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((skill) => {
              const uses = usedIn.get(skill.key) ?? 0;
              const editing = renaming?.key === skill.key;
              return (
                <tr key={skill.key}>
                  <td>
                    {editing ? (
                      <label className="levels-editor-field">
                        <span>New name for {skill.displayLabel}</span>
                        <input
                          aria-invalid={renaming.error !== null}
                          autoFocus
                          maxLength={80}
                          onChange={(event) =>
                            setRenaming({ ...renaming, label: event.target.value, error: null })
                          }
                          value={renaming.label}
                        />
                        {renaming.error ? (
                          <span className="levels-editor-hint" role="alert">
                            {renaming.error}
                          </span>
                        ) : null}
                      </label>
                    ) : (
                      skill.displayLabel
                    )}
                  </td>
                  <td>
                    {uses} {uses === 1 ? "belt" : "belts"}
                  </td>
                  <td>
                    <div className="levels-editor-row">
                      {editing ? (
                        <>
                          <button
                            className="levels-editor-button"
                            data-variant="primary"
                            disabled={busy}
                            onClick={() => void rename()}
                            type="button"
                          >
                            Save
                          </button>
                          <button
                            className="levels-editor-button"
                            onClick={() => setRenaming(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            aria-label={`Rename ${skill.displayLabel}`}
                            className="levels-editor-button"
                            disabled={busy}
                            onClick={() =>
                              setRenaming({ key: skill.key, label: skill.displayLabel, error: null })
                            }
                            type="button"
                          >
                            Rename
                          </button>
                          <button
                            aria-label={`Delete ${skill.displayLabel}`}
                            className="levels-editor-button"
                            disabled={busy}
                            onClick={() => {
                              setDeleting(skill.key);
                              dialog.current?.showModal();
                            }}
                            type="button"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 ? (
        <p className="levels-editor-muted" role="status">
          No techniques match this search.
        </p>
      ) : null}

      <dialog
        aria-labelledby="levels-techniques-delete"
        className="levels-editor-dialog"
        onClose={() => setDeleting(null)}
        ref={dialog}
      >
        <p id="levels-techniques-delete">
          Delete {deletingLabel}? Used by {deletingUses} {deletingUses === 1 ? "belt" : "belts"}.
          Students&apos; past ratings stay in their history.
        </p>
        <div className="levels-editor-row">
          <button
            className="levels-editor-button"
            data-variant="primary"
            disabled={busy}
            onClick={() => void remove()}
            type="button"
          >
            Delete technique
          </button>
          <button
            className="levels-editor-button"
            onClick={() => dialog.current?.close()}
            type="button"
          >
            Keep it
          </button>
        </div>
      </dialog>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/admin/levels/techniques-library.tsx
git commit -m "feat(levels): techniques library with add, rename and delete"
```

---

### Task 8: Editor root, page tabs, styles, cleanup

**Files:**
- Create: `apps/web/src/app/admin/levels/levels-editor.tsx`
- Modify: `apps/web/src/app/admin/levels/page.tsx`
- Rewrite: `apps/web/src/app/admin/levels/levels-editor.css`
- Delete: `level-versions.tsx`, `level-versions.test.tsx`, `level-draft-editor.tsx`, `level-draft-editor.test.tsx` (in `apps/web/src/app/admin/levels/`)
- Modify: `apps/web/src/app/admin/levels/page.test.tsx` (remove Versions cases and mocks; do not run)
- Modify: `DESIGN.md` §10

**Interfaces:**
- Consumes: Tasks 4, 5, 6, 7.
- Produces: `LevelsEditor({ tab }: { tab: "belts" | "techniques" })`.

- [ ] **Step 1: Editor root**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { EditableLevelCatalog } from "@bpt-jersey/domain/levels/editor";

import { getEditableLevelCatalog, saveLevelCatalog } from "../../../lib/level-editor-client";
import { LevelsBrowser } from "../../levels/levels-browser";
import { BeltEditor, type CatalogContent } from "./belt-editor";
import { TechniquesLibrary } from "./techniques-library";
import "./levels-editor.css";

type Notice = Readonly<{ kind: "success" | "error" | "stale"; message: string }>;

export function LevelsEditor({ tab }: { tab: "belts" | "techniques" }) {
  const [catalog, setCatalog] = useState<EditableLevelCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setCatalog(await getEditableLevelCatalog());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load the belt catalogue.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: CatalogContent): Promise<boolean> {
    if (catalog === null) return false;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await saveLevelCatalog({ expectedUpdatedAt: catalog.updatedAt, ...next });
      if (outcome.kind === "stale") {
        setNotice({
          kind: "stale",
          message: "Someone else changed the levels. Reload to see their changes.",
        });
        return false;
      }
      setCatalog(outcome.catalog);
      setVersion((current) => current + 1);
      setNotice({ kind: "success", message: "Saved." });
      return true;
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const banner = notice ? (
    <div
      className="levels-editor-notice"
      data-kind={notice.kind}
      role={notice.kind === "success" ? "status" : "alert"}
    >
      <p>{notice.message}</p>
      {notice.kind === "stale" ? (
        <button
          className="levels-editor-button"
          onClick={() => {
            setNotice(null);
            setEditing(null);
            setVersion((current) => current + 1);
            void load();
          }}
          type="button"
        >
          Reload
        </button>
      ) : null}
    </div>
  ) : null;

  if (loadError) {
    return (
      <div className="levels-editor-notice" data-kind="error" role="alert">
        <p>{loadError}</p>
        <button className="levels-editor-button" onClick={() => void load()} type="button">
          Retry
        </button>
      </div>
    );
  }

  if (tab === "techniques") {
    return catalog === null ? (
      <div aria-busy="true" aria-label="Loading techniques" className="levels-editor-skeleton" />
    ) : (
      <>
        {banner}
        <TechniquesLibrary busy={busy} catalog={catalog} onSave={save} />
      </>
    );
  }

  return (
    <>
      {banner}
      <LevelsBrowser
        renderBeltEditor={(beltKey) =>
          catalog === null ? null : (
            <BeltEditor
              beltKey={beltKey}
              busy={busy}
              catalog={catalog}
              editing={editing === beltKey}
              key={`${beltKey}-${catalog.updatedAt}`}
              locked={editing !== null && editing !== beltKey}
              onClose={() => setEditing(null)}
              onEdit={() => {
                setNotice(null);
                setEditing(beltKey);
              }}
              onSave={save}
            />
          )
        }
        roleContext="admin"
        version={version}
      />
    </>
  );
}
```

- [ ] **Step 2: Page tabs**

Replace `apps/web/src/app/admin/levels/page.tsx` with:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { LevelsBrowser } from "../../levels/levels-browser";
import { useAdminOrStaffSession } from "../admin-gate";
import { AdminSectionHeader } from "../admin-ui";
import "../admin.css";
import "./levels-editor.css";

// Only the office edits, so everyone else never downloads the editor.
const LevelsEditor = dynamic(() => import("./levels-editor").then((m) => m.LevelsEditor), {
  loading: () => (
    <div aria-busy="true" aria-label="Loading editor" className="levels-editor-skeleton" />
  ),
});

type LevelsTab = "belts" | "techniques";

export default function AdminLevelsPage() {
  const session = useAdminOrStaffSession();
  const canEdit = session.role === "owner" || session.role === "administrator";
  const [tab, setTab] = useState<LevelsTab>("belts");

  return (
    <div className="admin-page-container">
      <AdminSectionHeader
        eyebrow="Admin / Levels"
        title="IBJJF Levels & Belts"
        description="Belts by colour and age group, with the stripes, minimum classes and time behind each one."
      />
      {canEdit ? (
        <>
          <nav aria-label="Levels views" className="levels-tabs">
            <ul role="tablist">
              {(["belts", "techniques"] as const).map((value) => (
                <li key={value} role="presentation">
                  <button
                    aria-selected={tab === value}
                    className="levels-tab"
                    onClick={() => setTab(value)}
                    role="tab"
                    type="button"
                  >
                    {value === "belts" ? "Belts" : "Techniques"}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <LevelsEditor tab={tab} />
        </>
      ) : (
        <LevelsBrowser roleContext="admin" />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Styles**

Rewrite `levels-editor.css`: keep from the current file, unchanged, the rules for `.levels-tabs ul`, `.levels-tab`, `.levels-tab[aria-selected="true"]`, the focus-visible block, `.levels-editor-muted`, `.levels-editor-button` (all variants), `.levels-editor-row`, `.levels-editor-field` (all), `.levels-editor-hint`, `.levels-editor-notice` (all kinds), `.levels-editor-group`, `.levels-editor-group legend`, `.levels-editor-grid`, `.levels-editor-colour`, `.levels-editor-picker`, `.levels-editor-list`, `.levels-editor-list li`, `.levels-editor-inline`, `.levels-editor-actions`. Delete every `.levels-versions*`, `.levels-editor-belts`, `.levels-editor-belt`, `.levels-editor-techniques`, `.levels-editor-header`, `.levels-editor-eyebrow`, `.levels-editor-name` rule. Rename `.levels-versions-loading`/`-skeleton` to `.levels-editor-skeleton` (same declarations). Then append:

```css
.levels-editor-notice[data-kind="stale"] {
  background: #fff8e6;
  border-left: 0.35rem solid #c98b00;
  color: #765400;
}
.levels-editor-notice {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
}
.belt-editor {
  border-top: 1px solid #d9d8d2;
  display: grid;
  gap: 1rem;
  margin: 0 1.1rem 1.1rem;
  padding-top: 1rem;
}
.belt-editor h3 {
  font-family: var(--font-display);
  font-size: 1.5rem;
  letter-spacing: 0.035em;
  line-height: 1;
  margin: 0;
  text-transform: uppercase;
}
.belt-editor-stripes {
  overflow-x: auto;
}
.belt-editor-stripes table,
.levels-techniques-table {
  border-collapse: collapse;
  width: 100%;
}
.belt-editor-stripes caption {
  color: var(--bpt-purple);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  padding-bottom: 0.5rem;
  text-align: left;
  text-transform: uppercase;
}
.belt-editor-stripes th,
.belt-editor-stripes td,
.levels-techniques-table th,
.levels-techniques-table td {
  border-bottom: 1px solid #8a8880;
  padding: 0.5rem;
  text-align: left;
  vertical-align: middle;
}
.belt-editor-stripes thead th,
.levels-techniques-table thead th {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}
.belt-editor-stripes input {
  border: 1px solid #8a8880;
  border-radius: 0;
  font-size: 1rem;
  min-height: 3rem;
  width: 100%;
}
.levels-techniques {
  display: grid;
  gap: 1rem;
}
.levels-techniques-table-wrap {
  overflow-x: auto;
}
.levels-techniques-table td:nth-child(2) {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.levels-editor-dialog {
  border: 2px solid #1a1a18;
  border-radius: 0;
  max-width: min(32rem, calc(100vw - 2rem));
  padding: 1.25rem;
}
.levels-editor-dialog::backdrop {
  background: rgb(26 26 24 / 0.5);
}
@media (max-width: 47.99rem) {
  .levels-techniques-table thead {
    display: none;
  }
  .levels-techniques-table tr {
    border-bottom: 1px solid #8a8880;
    display: grid;
    gap: 0.25rem;
    padding: 0.5rem 0;
  }
  .levels-techniques-table td {
    border: 0;
    padding: 0.25rem 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .belt-editor *,
  .levels-techniques * {
    transition: none;
  }
}
```

Before writing, read the current file once and reuse its custom properties (e.g. `var(--bpt-purple)`, ink, line) instead of the raw hex values above wherever the file already defines them.

- [ ] **Step 4: Delete the Versions UI and adjust the page test**

Run: `git rm apps/web/src/app/admin/levels/level-versions.tsx apps/web/src/app/admin/levels/level-versions.test.tsx apps/web/src/app/admin/levels/level-draft-editor.tsx apps/web/src/app/admin/levels/level-draft-editor.test.tsx`

In `page.test.tsx` delete every case and `vi.mock` that mentions `Versions`, `level-versions` or `level-draft-editor`; mock `./levels-editor` instead if a remaining case renders the page as owner (`vi.mock("./levels-editor", () => ({ LevelsEditor: () => <p>Editor</p> }))`). Do not run it.

- [ ] **Step 5: DESIGN.md §10**

Replace the paragraph that starts "In the catalogue editor (`/admin/levels` → Versions)" with:

```markdown
In the catalogue editor (`/admin/levels`, owner and administrator) a belt is edited inline in its
own card, which then spans the grid row; the preview is that same `.belt-bar`, and the native
`<input type="color">` beside each hex field is the only other place a belt colour shows. A hex
reaches CSS only once it matches `#RRGGBB`; until then the field says "Enter a colour like
#1A2B3C" and the preview keeps the last valid colour. A card lists its techniques in a collapsed
`<details>` ("12 techniques"), never as running text; the Techniques tab is a plain admin table.
```

- [ ] **Step 6: Typecheck and lint the web package**

Run: `corepack pnpm --filter @bpt-jersey/web typecheck && corepack pnpm exec eslint --max-warnings 0 apps/web/src/app/admin/levels apps/web/src/app/levels apps/web/src/lib/level-editor-client.ts apps/functions/src/levels/level-editor-service.ts apps/functions/src/levels/level-editor-callables.ts apps/functions/src/levels/level-catalog-adoption.ts packages/domain/src/levels/level-editor-contracts.ts && corepack pnpm exec prettier --write apps/web/src/app/admin/levels apps/web/src/app/levels apps/web/src/lib/level-editor-client.ts apps/functions/src/levels apps/functions/scripts/adopt-level-catalog.mjs packages/domain/src/levels/level-editor-contracts.ts`

Expected: exit 0. Fix any error in the files this plan touched only. If typecheck fails in a test file that only referenced removed code, delete those cases.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src/app/admin/levels apps/web/src/app/levels apps/web/src/lib DESIGN.md apps/functions packages/domain
git commit -m "feat(levels): Belts and Techniques tabs replace Versions; office edits the live catalogue"
```

---

### Task 9: Verification with Playwright MCP on the emulators

No commits except fixes. Synthetic data only. Port 8080 is code-server, so this bench uses 18080/19099/15001.

- [ ] **Step 1: Build the deploy artifact**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/functions build && node apps/functions/scripts/build-deploy-artifact.mjs`
Expected: exit 0 and `.firebase-functions/lib/src/levels/level-catalog-adoption.js` exists.

- [ ] **Step 2: Bench config and secrets (untracked, deleted in Step 9)**

```bash
python3 - <<'EOF'
import json
d = json.load(open("firebase.json"))
d["emulators"] = {
  "auth": {"host": "127.0.0.1", "port": 19099},
  "functions": {"host": "127.0.0.1", "port": 15001},
  "firestore": {"host": "127.0.0.1", "port": 18080},
  "ui": {"enabled": False},
  "singleProjectMode": True,
}
d.pop("hosting", None); d.pop("database", None)
json.dump(d, open("firebase.levels-emu.json", "w"), indent=2)
EOF
mkdir -p .tmp && GCLOUD_PROJECT=demo-bpt-jersey node qa/scripts/generate-synthetic-emulator-secrets.mjs --confirmation=SYNTHETIC-EMULATOR-SECRETS --env-file=.tmp/levels-emu.env
printf 'FUNCTIONS_DISCOVERY_TIMEOUT=300000\nCOREPACK_ENABLE_NETWORK=0\nBPT_SYNTHETIC_PILOT=true\n' >> .tmp/levels-emu.env
```

- [ ] **Step 3: Start the emulators (host network, loopback only)**

```bash
docker run -d --name bpt-levels-emu --network host --env-file .tmp/levels-emu.env \
  -v /root/BPT-Jersey:/root/BPT-Jersey -v /root/.cache/firebase:/root/.cache/firebase \
  -v /root/.cache/node:/root/.cache/node -w /root/BPT-Jersey bpt-emu:local \
  bash -lc 'node_modules/.bin/firebase emulators:start --project demo-bpt-jersey --config firebase.levels-emu.json --only auth,firestore,functions'
```

Wait until `docker logs bpt-levels-emu 2>&1 | grep -q "All emulators ready"`. Expected: functions list includes `getEditableLevelCatalog` and `saveLevelCatalog` and none of the six removed names.

- [ ] **Step 4: Seed actors, catalogues, a draft and a progress head**

Mirror `qa/scripts/run-member-profile-ui-e2e.mjs` with academy `demo-academy` (its env names list what each seed script needs). With `FIRESTORE_EMULATOR_HOST=127.0.0.1:18080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:19099 GCLOUD_PROJECT=demo-bpt-jersey` and the bench env file loaded:

1. `qa/scripts/seed-auth-emulator.mjs` once with `AUTH_EMULATOR_E2E_ROLE=owner` (`owner@example.test`) and once with `coach` (`coach@example.test`), `AUTH_EMULATOR_E2E_ACADEMY_ID=demo-academy`, password ≥ 12 chars.
2. `qa/scripts/seed-member-profile-actors-emulator.mjs` (staff/users docs the actor check reads).
3. `node apps/functions/scripts/seed-levels.mjs --target=emulator --academy-id=demo-academy --system-id=ibjjf-v2`, then the same with `ibjjf-v3`.
4. A throwaway fixture `.tmp/levels-fixture.mjs` (firebase-admin from `.firebase-functions/node_modules`) that sets `academies/demo-academy/levelCatalogState/active.activeSystemId = "ibjjf-v3"`, creates `levelSystems/bpt-20260926-1` `{ systemId, academyId: "demo-academy", origin: "custom", status: "draft", displayName: "JIU-JITSU - IBJJF" }`, and creates `studentLevelProgress/student-fixture-1` `{ academyId: "demo-academy", studentId: "student-fixture-1", systemId: "ibjjf-v3", state: "initialized", currentDefinitionKey: <first belt key of ibjjf-v3> }`.

- [ ] **Step 5: Adoption CLI**

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:18080 GCLOUD_PROJECT=demo-bpt-jersey node apps/functions/scripts/adopt-level-catalog.mjs --target=emulator --academy-id=demo-academy --generated-at=2026-10-03T10:00:00.000Z > .tmp/adopt-dry.json
```

Expected: `status: "ready"`, `fromSystemId: "ibjjf-v3"`, `newSystemId: "bpt-20261003-1"`, `definitions: 177`, `heads: 1`, `retire` = `["bpt-20260926-1","ibjjf-v2","ibjjf-v3"]`, `stripeChanges` listed. Then apply with `--apply --actor-id=<owner uid> --confirmation=<exactConfirmation>` and the same `--generated-at`. Expected: `movedHeads: 1`, `deletedDocuments > 0`. Rerun the dry-run: `status: "already-adopted"`.

- [ ] **Step 6: Web dev server against the bench**

```bash
cd apps/web && NEXT_PUBLIC_FIREBASE_ENV=local NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true \
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bpt-jersey \
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT=19099 NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT=15001 \
  NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT=18080 \
  corepack pnpm exec next dev -p 3100 -H 127.0.0.1
```

(run in background; add any other `NEXT_PUBLIC_*` the config demands for local mode, read from `apps/web/next.config.ts`).

- [ ] **Step 7: Playwright MCP checks** (owner unless stated; screenshot each; read console after each)

1. `/admin/levels`: tabs Belts and Techniques, no Versions; each card shows "N techniques" collapsed; opening one lists "Technique — Min N/5".
2. Edit belt on White: change name, first colour via hex, belt min classes, 1st stripe min days → Save → "Saved." → reload page → values persisted. Then type `#1A2` in a hex field: hint shows, Save disabled; set min age 20, max age 10: "Minimum age must not be above maximum age.", Save disabled; empty name: "Enter a belt name.".
3. Techniques tab: add "Zz test technique" → row appears with "0 belts"; add "zz TEST technique" → "That technique already exists."; rename to "Zz renamed"; assign it on a belt (Belts tab → Add technique → Add → Save) → "1 belt"; delete it → dialog text "Used by 1 belt…" → Delete technique → row gone, the belt's `<details>` count back to before.
4. Assign/remove a technique on a belt and change its minimum rating; the card's `<details>` updates after save.
5. Conflict: open `/admin/levels` in a second tab, save a change in tab 1, then save in tab 2 → amber "Someone else changed the levels. Reload to see their changes." → Reload shows tab 1's change.
6. Sign out, sign in as coach: no Techniques tab, no Edit belt buttons.
7. Resize to 375×812: no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`), editing card full width, tables usable. Console: no errors on any step.

Any failure: fix in the owning task's file, commit `fix(levels): …`, repeat the failing check.

- [ ] **Step 8: Record the result**

Write the outcome of each check (pass/fail + screenshot path under `.tmp/levels-shots/`) in the chat report.

- [ ] **Step 9: Tear down**

```bash
docker rm -f bpt-levels-emu; rm -f firebase.levels-emu.json .tmp/levels-emu.env .tmp/levels-fixture.mjs; pkill -f "next dev -p 3100" || true
```

---

### Task 10: Production runbook (operator; each step needs Luis's "sí" in chat)

Written to the chat in Spanish following Luis's step rules (summary, one action per step, terminal labels, expected output, ⚠️ before destructive steps, final verification). Run out of office hours, steps 1–4 back to back (grill decision 9). Content:

1. 📍 VPS, `/root/BPT-Jersey`: `git push origin main` (Cloudflare publishes the web; until step 2 the office editor shows "Unable to load the belt catalogue").
2. 📍 VPS: build artifact, then `firebase deploy --only functions:getEditableLevelCatalog,functions:saveLevelCatalog --project bptjersey-f5a25`.
3. 📍 VPS (ADC logged in): dry-run `node apps/functions/scripts/adopt-level-catalog.mjs --target=production --academy-id=demo-academy > /root/bpt-runbook/adopt-dry.json`; Claude reads the file and reviews `stripeChanges`, `heads: 11`, `retire`.
4a. 📍 VPS: backup (grill decision 10). If no private bucket exists: `gcloud storage buckets create gs://bptjersey-f5a25-backups --project=bptjersey-f5a25 --location=<Firestore location from gcloud firestore databases describe> --uniform-bucket-level-access --public-access-prevention`. Then `gcloud firestore export gs://bptjersey-f5a25-backups/levels-2026-10-03 --collection-ids=levelSystems,levelDefinitions,levelRequirements,levelCatalogManifests,levelCatalogState,studentLevelProgress --project=bptjersey-f5a25`; expected `done: true`. Restore if needed: `gcloud firestore import gs://bptjersey-f5a25-backups/levels-2026-10-03 --collection-ids=… --project=bptjersey-f5a25`.
4. ⚠️ 📍 VPS: apply with `--apply --actor-id=<owner uid> --confirmation=<exactConfirmation> --target-confirmation=LEVELS-ADOPT-PRODUCTION-APPLY --generated-at=<same as dry-run>` → `/root/bpt-runbook/adopt-apply.json`. Deletes ibjjf-v2, ibjjf-v3, bpt-20260926-1 catalogue docs (irreversible; audit and activation history stay).
5. ⚠️ 📍 VPS: `firebase functions:delete listLevelCatalogVersions getLevelCatalogVersion createLevelCatalogDraft saveLevelCatalogDraft publishLevelCatalogDraft activateLevelCatalog --region <region from firebase functions:list> --project bptjersey-f5a25 --force`.
6. Verification: rerun the dry-run → `status: "already-adopted"`; open `https://www.<domain>/admin/levels` on the laptop as owner, edit one belt name and revert it.
```
