# Progress Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a "Progress management" tab in `/admin/members` to set a member's level + start date, their class count at that level and the attendance dates behind it, and stop Open Mat from counting as a class everywhere (belt, streak, Competitors).

**Architecture:** One shared async counting path (`countedClassInstants` in `apps/functions/src/levels/progress-adjustments.ts`) that removes owner-voided attendance and Open Mat sessions and adds owner-added dates. Every reader that counts classes (progress summary, assign level, recognition candidates, streak, leaderboard) goes through it. Five owner-only callables in `apps/functions/src/levels/progress-management-callables.ts` write the changes and a `progressChanges` history row. One web client and one React tab.

**Tech Stack:** TypeScript strict, zod 4, Firebase Functions v2 `onCall`, firebase-admin Firestore, Next.js 16 static export, React 19.

**Spec:** `docs/superpowers/specs/2026-09-29-progress-management-design.md` (decisions D1–D15). Read it before starting any task.

## Global Constraints

- Work directly on local `main`; `git fetch` + integrate `origin/main` first; never `git add -A` (other sessions share the repo) — add only the files you touched; never force-push.
- **No automated tests** (repo rule, spec D15): do not add, run or fix tests. Verification = the per-package type check named in each task + code inspection.
- Never deploy or push without the operator's explicit OK in chat (Task 6 is the only task that pushes/deploys).
- `packages/domain` never imports Firebase.
- Owner only (D1): every new callable refuses any role other than `owner` with `permission-denied`.
- Reason is optional on every change (D11); blank = `null`.
- Europe/Jersey calendar days for "today", "tomorrow" and "not in the future" (`jerseyDateOf` from `@bpt-jersey/domain/levels`).
- Manual attendance counts at `${date}T12:00:00.000Z` (UTC noon is the same calendar day in Jersey in GMT and BST).
- UI copy in English (the product UI is English); code and identifiers in English.
- Region/CORS/App Check: reuse `browserAdminCallableOptions` from `apps/functions/src/auth/callable-options.ts`.

## Spec deviations (decided while planning, 2026-09-30)

1. **Attendance voids live in `academies/{a}/attendanceVoids/{attendanceId}`**, not as a `progressVoid` field on the attendance doc (spec §C). Reason: other readers parse attendance docs strictly (e.g. `retention-alert-producer.ts` uses exact-key checks), and on 2026-09-30 an extra field on staff docs took the calendar down (memory `strict-parsers-partial-deploy`). The attendance record itself is never modified. Manual attendances keep `progressVoid` on their own doc (new collection, nobody else reads it).
2. **History lives in `academies/{a}/progressChanges`** (one row per change: who, when, summary, reason) instead of `auditEvents`: the audit writer validates a fixed action enum (`parseAuditEventDraft`). "Undo" of a level change reuses the existing `voidPromotion`; its void record is shown in the history by reading `levelPromotions`.
3. **A member with no level yet** (no `studentLevelProgress` head) cannot be set here: `setProgressLevel` answers `failed-precondition` "Open this member's level first from their record, then set it here." The existing Manage panel opens levels.
4. New contracts are exported through the existing `@bpt-jersey/domain/levels` barrel (`level-contracts.ts` already re-exports `level-progress` and `level-manage-contracts`), no new `package.json` subpath.

## Review Focus

1. **Partial deploy with the widened baseline schema** — once a head stores `importedBaseline.source: "owner-set"`, any function still running the old bundle throws "Imported baseline is invalid" for that member. Task 6 deploys the full list before the tab is used; the reviewer checks the list covers every bundle that imports `importedBaselineSchema` (all exports of `level-callables.ts`, `level-editor-callables.ts`, `family-achievement-callables.ts`, `progress-report-callables.ts`, `member-profile-callables.ts`, `promotion-callables.ts`, `streak-callables.ts`, `competitors-callables.ts`).
2. **A voided or Open Mat attendance still counted by one reader** — every reader in Task 2 must use the shared helpers; the reviewer greps for `countedAttendance(` and checks each call site is followed by `countedClassInstants` (or the bulk equivalent).
3. **Owner sets a count, then adds a past date** (D13) — the date must not raise the belt count (it falls before the baseline cutoff) but must appear in streak/leaderboard; the UI says so.
4. **Future dates** — `addManualAttendance` and `setProgressLevel` refuse dates after today (Jersey) with a readable message.
5. **Voiding someone else's attendance** — `setAttendanceVoid` checks the attendance doc belongs to one of the member's canonical identities and the manual doc's `studentId` matches.

---

### Task 1: Domain contracts and widened baseline

**Files:**
- Create: `packages/domain/src/levels/progress-management-contracts.ts`
- Modify: `packages/domain/src/levels/level-progress.ts:10-14` (`ImportedBaseline` type)
- Modify: `packages/domain/src/levels/level-manage-contracts.ts:63-67` (`importedBaselineSchema`)
- Modify: `packages/domain/src/levels/level-contracts.ts:14-15` (barrel export)

**Interfaces:**
- Produces (all from `@bpt-jersey/domain/levels`): `progressStudentInputSchema`, `setProgressLevelInputSchema`, `setProgressClassCountInputSchema`, `addManualAttendanceInputSchema`, `setAttendanceVoidInputSchema`, `progressManagementSchema`, types `ProgressManagement`, `ProgressAttendanceRow`, `SetProgressLevelInput`, `SetProgressClassCountInput`, `AddManualAttendanceInput`, `SetAttendanceVoidInput` (all `z.input<…>`), function `manualAttendanceInstant(date: string): string`.
- `ImportedBaseline.source` becomes `"regyfit-import" | "owner-set"`.

- [ ] **Step 1: Widen the baseline source**

In `packages/domain/src/levels/level-progress.ts` replace

```ts
export type ImportedBaseline = Readonly<{
  classes: number;
  cutoff: string;
  source: "regyfit-import";
}>;
```

with

```ts
/** `owner-set` (spec D12): the owner's count up to today; `cutoff` is tomorrow (Jersey). */
export type ImportedBaseline = Readonly<{
  classes: number;
  cutoff: string;
  source: "regyfit-import" | "owner-set";
}>;
```

In `packages/domain/src/levels/level-manage-contracts.ts` change `source: z.literal("regyfit-import"),` inside `importedBaselineSchema` to `source: z.enum(["regyfit-import", "owner-set"]),`.

- [ ] **Step 2: Create the contracts file**

`packages/domain/src/levels/progress-management-contracts.ts`:

```ts
import { z } from "zod";

import { isLevelCalendarDate } from "./level-progress";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
// Promotion ids embed an ISO instant; attendance ids are `sessionId__studentId`.
const recordIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,383}$/u);
const daySchema = z.string().refine(isLevelCalendarDate, "Use a real date (YYYY-MM-DD).");
const classesSchema = z.number().int().min(0).max(10_000);
/** D11: optional everywhere; blank or missing is stored as null. */
const reasonSchema = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((value) => (value ? value : null));

export const progressStudentInputSchema = z.strictObject({ studentId: identifierSchema });

export const setProgressLevelInputSchema = z.strictObject({
  studentId: identifierSchema,
  definitionKey: identifierSchema,
  startedOn: daySchema,
  /** D12: omitted means the count restarts at 0 for the new level. */
  classes: classesSchema.optional(),
  reason: reasonSchema,
});
export type SetProgressLevelInput = z.input<typeof setProgressLevelInputSchema>;

export const setProgressClassCountInputSchema = z.strictObject({
  studentId: identifierSchema,
  classes: classesSchema,
  reason: reasonSchema,
});
export type SetProgressClassCountInput = z.input<typeof setProgressClassCountInputSchema>;

export const addManualAttendanceInputSchema = z.strictObject({
  studentId: identifierSchema,
  date: daySchema,
  reason: reasonSchema,
});
export type AddManualAttendanceInput = z.input<typeof addManualAttendanceInputSchema>;

export const setAttendanceVoidInputSchema = z.strictObject({
  studentId: identifierSchema,
  kind: z.enum(["attendance", "manual"]),
  id: recordIdSchema,
  voided: z.boolean(),
  reason: reasonSchema,
});
export type SetAttendanceVoidInput = z.input<typeof setAttendanceVoidInputSchema>;

export const progressAttendanceRowSchema = z.strictObject({
  id: recordIdSchema,
  kind: z.enum(["attendance", "manual"]),
  date: daySchema,
  /** The class title, or "Added by owner". */
  label: z.string().max(200),
  openMat: z.boolean(),
  voided: z.boolean(),
  reason: z.string().max(300).nullable(),
});
export type ProgressAttendanceRow = z.infer<typeof progressAttendanceRowSchema>;

export const progressChangeSchema = z.strictObject({
  at: z.string().max(40),
  by: z.string().max(200),
  summary: z.string().max(300),
  reason: z.string().max(300).nullable(),
});

export const progressManagementSchema = z.strictObject({
  studentId: identifierSchema,
  /** False when the member has no level head yet (spec deviation 3). */
  initialized: z.boolean(),
  currentDefinitionKey: identifierSchema.nullable(),
  startedOn: daySchema.nullable(),
  classesAtLevel: z.number().int().min(0),
  /** D13: attendance dated before this day is already inside the owner's count. */
  baselineCutoff: daySchema.nullable(),
  /** The head's latest promotion when it is an owner level change, so the tab can offer Undo. */
  undoPromotionId: recordIdSchema.nullable(),
  attendance: z.array(progressAttendanceRowSchema).max(1000),
  history: z.array(progressChangeSchema).max(200),
});
export type ProgressManagement = z.infer<typeof progressManagementSchema>;

/** Spec §C. ponytail: UTC noon is the same calendar day in Jersey in both GMT and BST. */
export function manualAttendanceInstant(date: string): string {
  return `${date}T12:00:00.000Z`;
}
```

- [ ] **Step 3: Export from the barrel**

In `packages/domain/src/levels/level-contracts.ts`, after the line `export * from "./level-manage-contracts";` add:

```ts
export * from "./progress-management-contracts";
```

Check no name clash: `grep -rn "progressManagementSchema\|manualAttendanceInstant\|progressStudentInputSchema" packages/domain/src` must show only the new file (plus the export line).

- [ ] **Step 4: Type-check the domain**

Run: `corepack pnpm --filter @bpt-jersey/domain exec tsc --noEmit`
Expected: no errors. (An error in a consumer that switches on `source === "regyfit-import"` is fine to leave if it still compiles; fix only real type errors caused by the widening.)

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/levels/progress-management-contracts.ts packages/domain/src/levels/level-progress.ts packages/domain/src/levels/level-manage-contracts.ts packages/domain/src/levels/level-contracts.ts
git commit -m "feat(levels): progress management contracts and owner-set class baseline"
```

---

### Task 2: One counting path — voids, Open Mat, owner-added dates

**Files:**
- Create: `apps/functions/src/levels/progress-adjustments.ts`
- Modify: `apps/functions/src/levels/level-service.ts` — `promotionRestoreOf` (~line 781, export it), `getStudentProgressSummary` (~2034-2150), `listRecognitionCandidates` (~2237-2346), `assignLevel` (~2596-2612)
- Modify: `apps/functions/src/streak/streak-service.ts`
- Modify: `apps/functions/src/competitors/public-card.ts` (~lines 57-180)

**Interfaces:**
- Consumes: `manualAttendanceInstant` (Task 1), `isOpenMatProgram` from `@bpt-jersey/domain/schedule/self-check-in`, existing `countedAttendance` (unchanged).
- Produces:
  - `readDocuments(db: Firestore, paths: readonly string[]): Promise<DocumentSnapshot[]>`
  - `openMatSessionIds(db: Firestore, academyId: string, sessionIds: Iterable<string>): Promise<Set<string>>`
  - `readProgressAdjustments(db: Firestore, academyId: string, scope: { studentId: string } | { sinceDate: string | null }): Promise<ProgressAdjustments>` where `ProgressAdjustments = { voidedAttendanceIds: Set<string>; manualByStudent: Map<string, string[]> }`
  - `countedClassInstants(db: Firestore, academyId: string, studentId: string, records: readonly Record<string, unknown>[]): Promise<CountedClass[]>` where `CountedClass = { occurredAt: string; sessionId: string | null }`
  - `promotionRestoreOf` exported from `level-service.ts` (used by Task 3).

- [ ] **Step 1: Create the helper**

`apps/functions/src/levels/progress-adjustments.ts`:

```ts
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { manualAttendanceInstant } from "@bpt-jersey/domain/levels";
import { isOpenMatProgram } from "@bpt-jersey/domain/schedule/self-check-in";

/** ponytail: getAll in chunks of 300; no documented cap, this keeps one call bounded. */
export async function readDocuments(
  db: Firestore,
  paths: readonly string[],
): Promise<DocumentSnapshot[]> {
  const out: DocumentSnapshot[] = [];
  for (let index = 0; index < paths.length; index += 300) {
    const refs = paths.slice(index, index + 300).map((path) => db.doc(path));
    if (refs.length > 0) out.push(...(await db.getAll(...refs)));
  }
  return out;
}

/**
 * D3/D14: sessions whose program is an Open Mat, resolved on read (attendance → session → program).
 * A session or program that cannot be read is NOT in the set: it counts as a class (fail open).
 */
export async function openMatSessionIds(
  db: Firestore,
  academyId: string,
  sessionIds: Iterable<string>,
): Promise<Set<string>> {
  const base = `academies/${academyId}`;
  const sessions = await readDocuments(
    db,
    [...new Set(sessionIds)].map((id) => `${base}/sessions/${id}`),
  );
  const programBySession = new Map<string, string>();
  for (const session of sessions) {
    const programId = session.get("programId");
    if (session.exists && typeof programId === "string") programBySession.set(session.id, programId);
  }
  const programs = await readDocuments(
    db,
    [...new Set(programBySession.values())].map((id) => `${base}/programs/${id}`),
  );
  const openMat = new Set(
    programs
      .filter((program) => program.exists && isOpenMatProgram(program.data() as never))
      .map((program) => program.id),
  );
  return new Set(
    [...programBySession].filter(([, programId]) => openMat.has(programId)).map(([id]) => id),
  );
}

export type ProgressAdjustments = {
  /** Attendance ids the owner removed (D6); the attendance doc itself is never touched. */
  voidedAttendanceIds: Set<string>;
  /** Canonical studentId → owner-added class instants (§C), voided ones left out. */
  manualByStudent: Map<string, string[]>;
};

/** One member (`studentId`) or the whole academy from `sinceDate` (null = all time). */
export async function readProgressAdjustments(
  db: Firestore,
  academyId: string,
  scope: { studentId: string } | { sinceDate: string | null },
): Promise<ProgressAdjustments> {
  const base = `academies/${academyId}`;
  const voids = db.collection(`${base}/attendanceVoids`);
  const manual = db.collection(`${base}/memberManualAttendance`);
  const [voidSnapshot, manualSnapshot] = await Promise.all([
    ("studentId" in scope ? voids.where("studentId", "==", scope.studentId) : voids).get(),
    ("studentId" in scope
      ? manual.where("studentId", "==", scope.studentId)
      : scope.sinceDate === null
        ? manual
        : manual.where("date", ">=", scope.sinceDate)
    ).get(),
  ]);
  const voidedAttendanceIds = new Set(
    voidSnapshot.docs
      .filter((document) => document.get("academyId") === academyId && document.get("voided") === true)
      .map((document) => document.id),
  );
  const manualByStudent = new Map<string, string[]>();
  for (const document of manualSnapshot.docs) {
    const value = document.data();
    if (
      value.academyId !== academyId ||
      typeof value.studentId !== "string" ||
      typeof value.date !== "string" ||
      (value.progressVoid !== null && value.progressVoid !== undefined)
    )
      continue;
    manualByStudent.set(value.studentId, [
      ...(manualByStudent.get(value.studentId) ?? []),
      manualAttendanceInstant(value.date),
    ]);
  }
  return { voidedAttendanceIds, manualByStudent };
}

export type CountedClass = { occurredAt: string; sessionId: string | null };

/**
 * Spec §A — THE counting rule for one member: `countedAttendance` output minus owner voids and
 * Open Mat sessions, plus owner-added dates. Oldest first. Every per-member progress reader uses it.
 */
export async function countedClassInstants(
  db: Firestore,
  academyId: string,
  studentId: string,
  records: readonly Record<string, unknown>[],
): Promise<CountedClass[]> {
  const [adjustments, openMat] = await Promise.all([
    readProgressAdjustments(db, academyId, { studentId }),
    openMatSessionIds(db, academyId, records.map((record) => String(record.sessionId))),
  ]);
  const real = records
    .filter(
      (record) =>
        !adjustments.voidedAttendanceIds.has(String(record.attendanceId)) &&
        !openMat.has(String(record.sessionId)),
    )
    .map((record) => ({ occurredAt: String(record.occurredAt), sessionId: String(record.sessionId) }));
  const manual = (adjustments.manualByStudent.get(studentId) ?? []).map((occurredAt) => ({
    occurredAt,
    sessionId: null,
  }));
  return [...real, ...manual].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
```

- [ ] **Step 2: Export `promotionRestoreOf`**

In `apps/functions/src/levels/level-service.ts` change `function promotionRestoreOf(` to `export function promotionRestoreOf(`. Add at the top, with the other relative imports:

```ts
import {
  countedClassInstants,
  openMatSessionIds,
  readProgressAdjustments,
} from "./progress-adjustments.js";
```

- [ ] **Step 3: Progress summary (level card, Manage, member progress, leaderboard belt)**

In `getStudentProgressSummary`, directly after

```ts
      const attendance = countedAttendance(
        attendanceSnapshot,
        academyId,
        studentId,
        attendanceSnapshot.ids,
      );
```

add

```ts
      const counted = await countedClassInstants(
        firestore as unknown as Firestore,
        academyId,
        studentId,
        attendance,
      );
      const realClasses = counted.filter((record) => record.sessionId !== null);
```

Then change the following, all inside the same method:
- `const sessionIds = [...new Set(attendance.map((record) => String(record.sessionId)))];` → `const sessionIds = [...new Set(realClasses.map((record) => String(record.sessionId)))];`
- The minutes loop `for (const attendanceRecord of attendance) {` → `for (const attendanceRecord of realClasses) {` (its body compares `session.sessionId !== attendanceRecord.sessionId`, still valid).
- After the loop add `// ponytail: an owner-added date has no session; it counts as one hour.` and `totalMinutes += (counted.length - realClasses.length) * 60;`
- `attendedClassesCount: attendance.length,` → `attendedClassesCount: counted.length,`
- `attendedAt: attendance.map((record) => record.occurredAt as string),` → `attendedAt: counted.map((record) => record.occurredAt),`

- [ ] **Step 4: Assign level**

In `assignLevel`, replace

```ts
      const attendedAt = countedAttendance(
        attendanceSnapshot,
        academyId,
        input.studentId,
        attendanceSnapshot.ids,
      ).map((record) => record.occurredAt as string);
```

with

```ts
      const attendedAt = (
        await countedClassInstants(
          firestore as unknown as Firestore,
          academyId,
          input.studentId,
          countedAttendance(attendanceSnapshot, academyId, input.studentId, attendanceSnapshot.ids),
        )
      ).map((record) => record.occurredAt);
```

- [ ] **Step 5: Recognition candidates (bulk)**

In `listRecognitionCandidates`, the `attendances` flatMap returns `[{ studentId: record.studentId, attendedAt: record.occurredAt }]`. Change that return to

```ts
        return [
          {
            studentId: record.studentId,
            attendedAt: record.occurredAt,
            attendanceId: document.id,
            sessionId: String(record.sessionId),
          },
        ];
```

and rename the variable from `attendances` to `rawAttendances`. Before `return generateRecognitionCandidates({`, add:

```ts
      const [adjustments, openMat] = await Promise.all([
        readProgressAdjustments(firestore as unknown as Firestore, academyId, { sinceDate: null }),
        openMatSessionIds(
          firestore as unknown as Firestore,
          academyId,
          rawAttendances.map((record) => record.sessionId),
        ),
      ]);
      // Spec §A: the same rule as countedClassInstants, for every student at once.
      const attendances = [
        ...rawAttendances
          .filter(
            (record) =>
              !adjustments.voidedAttendanceIds.has(record.attendanceId) &&
              !openMat.has(record.sessionId),
          )
          .map(({ studentId, attendedAt }) => ({ studentId, attendedAt })),
        ...[...adjustments.manualByStudent]
          .filter(([studentId]) => studentIds.has(studentId))
          .flatMap(([studentId, instants]) =>
            instants.map((attendedAt) => ({ studentId, attendedAt })),
          ),
      ];
```

`generateRecognitionCandidates({ …, attendances, … })` stays as it is.

- [ ] **Step 6: Streak**

In `apps/functions/src/streak/streak-service.ts`:
- Add import: `import { countedClassInstants } from "../levels/progress-adjustments.js";`
- Replace from `const records = countedAttendance(snapshot, academyId, studentId, identityIds);` down to the end of the function with:

```ts
  const records = (
    await countedClassInstants(
      db,
      academyId,
      studentId,
      countedAttendance(snapshot, academyId, studentId, identityIds),
    )
  ).filter((record) => record.occurredAt >= sinceIso);
  if (records.length === 0) return [];

  const sessionIds = [
    ...new Set(records.flatMap((record) => (record.sessionId === null ? [] : [record.sessionId]))),
  ];
  const sessions =
    sessionIds.length === 0
      ? []
      : await db.getAll(...sessionIds.map((id) => db.doc(`academies/${academyId}/sessions/${id}`)));
  const minutesBySession = new Map<string, number>();
  for (const snapshot of sessions) {
    const value = snapshot.data();
    const minutes =
      snapshot.exists &&
      value?.academyId === academyId &&
      typeof value.startAt === "string" &&
      typeof value.endAt === "string"
        ? (Date.parse(value.endAt) - Date.parse(value.startAt)) / 60_000
        : Number.NaN;
    if (Number.isFinite(minutes) && minutes > 0) {
      minutesBySession.set(snapshot.id, minutes);
    } else {
      warn("Attended session has no usable duration; counting 60 minutes", {
        academyId,
        sessionId: snapshot.id,
      });
    }
  }
  return records.map((record) => ({
    occurredAt: record.occurredAt,
    durationMinutes:
      (record.sessionId === null ? undefined : minutesBySession.get(record.sessionId)) ??
      defaultDurationMinutes,
  }));
}
```

- [ ] **Step 7: Competitors leaderboard (D7)**

In `apps/functions/src/competitors/public-card.ts`:
- Add import: `import { openMatSessionIds, readProgressAdjustments } from "../levels/progress-adjustments.js";`
- After the `Promise.all([... attendance])` block (the one that reads `${root}/attendance` from `seasonStartIso`), add:

```ts
  const [adjustments, openMat] = await Promise.all([
    readProgressAdjustments(db, academyId, { sinceDate: seasonStart }),
    openMatSessionIds(
      db,
      academyId,
      attendance.docs.map((document) => String(document.get("sessionId"))),
    ),
  ]);
```

- In the loop that fills `attendanceByIdentity`, skip removed and Open Mat records — after `if (typeof identity !== "string") continue;` add:

```ts
    if (
      adjustments.voidedAttendanceIds.has(document.id) ||
      openMat.has(String(document.get("sessionId")))
    )
      continue;
```

- In `attendedAtOf`, replace

```ts
      return countedAttendance({ docs } as never, academyId, studentId, identityIds)
        .map((record) => String(record.occurredAt))
        .filter((occurredAt) => occurredAt <= nowIso);
```

with

```ts
      return [
        ...countedAttendance({ docs } as never, academyId, studentId, identityIds).map((record) =>
          String(record.occurredAt),
        ),
        ...(adjustments.manualByStudent.get(studentId) ?? []),
      ]
        .filter((occurredAt) => occurredAt <= nowIso)
        .sort();
```

- [ ] **Step 8: Type-check functions**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/functions exec tsc --noEmit`
Expected: no errors. Then `grep -n "countedAttendance(" apps/functions/src --include=*.ts -r | grep -v test` and confirm each non-test call site feeds `countedClassInstants` or is the leaderboard path covered in Step 7.

- [ ] **Step 9: Commit**

```bash
git add apps/functions/src/levels/progress-adjustments.ts apps/functions/src/levels/level-service.ts apps/functions/src/streak/streak-service.ts apps/functions/src/competitors/public-card.ts
git commit -m "feat(levels): open mat, owner-removed and owner-added dates share one class count"
```

---

### Task 3: Owner-only callables

**Files:**
- Create: `apps/functions/src/levels/progress-management-callables.ts`
- Modify: `apps/functions/src/index.ts` (add one export line next to the other levels exports)

**Interfaces:**
- Consumes: Task 1 schemas/types; Task 2 `countedClassInstants`, `openMatSessionIds`, `readDocuments`, `promotionRestoreOf`; existing `countedAttendance`, `createLevelCatalogStore` (`level-service.ts`), `readCanonicalMemberHistoryDocuments`, `readCanonicalMemberIdentityIds` (`members/member-identity-firestore.ts`), `requireActiveOfficeActor` (`auth/office-actor.ts`).
- Produces callables: `getProgressManagement({studentId}) → ProgressManagement`, `setProgressLevel(SetProgressLevelInput) → { promotionId }`, `setProgressClassCount(SetProgressClassCountInput) → { classes }`, `addManualAttendance(AddManualAttendanceInput) → { id }`, `setAttendanceVoid(SetAttendanceVoidInput) → { voided }`.
- Firestore writes: `levelPromotions/{owner-set_<studentId>_<iso>}` (kind `owner-set`, `status: "approved"`, `restore`), `studentLevelProgress/{studentId}` (level, start, `lastApprovedPromotionId`, `importedBaseline` owner-set), `memberManualAttendance/{auto}`, `attendanceVoids/{attendanceId}`, `progressChanges/{auto}`.

- [ ] **Step 1: Create the callables file**

`apps/functions/src/levels/progress-management-callables.ts`:

```ts
import { getFirestore, type Firestore, type Transaction, type WriteBatch } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import type { z } from "zod";
import {
  addManualAttendanceInputSchema,
  countClassesAtLevel,
  importedBaselineSchema,
  jerseyDateOf,
  progressManagementSchema,
  progressStudentInputSchema,
  setAttendanceVoidInputSchema,
  setProgressClassCountInputSchema,
  setProgressLevelInputSchema,
  type ProgressManagement,
} from "@bpt-jersey/domain/levels";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import {
  readCanonicalMemberHistoryDocuments,
  readCanonicalMemberIdentityIds,
} from "../members/member-identity-firestore.js";
import { countedAttendance, createLevelCatalogStore, promotionRestoreOf } from "./level-service.js";
import { countedClassInstants, openMatSessionIds, readDocuments } from "./progress-adjustments.js";

/** D1: owner only. */
async function requireOwner(request: CallableRequest<unknown>) {
  const actor = await requireActiveOfficeActor(request);
  if (actor.role !== "owner") {
    throw new HttpsError("permission-denied", "Only an owner can manage progress.");
  }
  const token = request.auth?.token;
  const name = String(token?.name ?? token?.email ?? actor.userId).slice(0, 200);
  return { userId: actor.userId, academyId: actor.academyId, name };
}

function parse<T>(schema: z.ZodType<T>, data: unknown, message: string): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpsError("invalid-argument", message);
  return result.data;
}

function tomorrowInJersey(now: string): string {
  return new Date(Date.parse(`${jerseyDateOf(now)}T00:00:00.000Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

type Owner = Awaited<ReturnType<typeof requireOwner>>;

/** The tab's history row (spec deviation 2): who, when, what, reason. */
function logChange(
  writer: Transaction | WriteBatch,
  db: Firestore,
  owner: Owner,
  studentId: string,
  now: string,
  summary: string,
  reason: string | null,
) {
  writer.create(db.collection(`academies/${owner.academyId}/progressChanges`).doc(), {
    academyId: owner.academyId,
    studentId,
    at: now,
    by: owner.userId,
    byName: owner.name,
    summary: summary.slice(0, 300),
    reason,
    schemaVersion: "1",
  });
}

async function assertStudent(db: Firestore, academyId: string, studentId: string) {
  const student = await db.doc(`academies/${academyId}/students/${studentId}`).get();
  if (!student.exists || student.get("academyId") !== academyId) {
    throw new HttpsError("not-found", "This member no longer exists.");
  }
}

export const getProgressManagement = onCall(browserAdminCallableOptions, async (request) => {
  const owner = await requireOwner(request);
  const { studentId } = parse(progressStudentInputSchema, request.data, "Choose a member.");
  const db = getFirestore();
  const { academyId } = owner;
  const base = `academies/${academyId}`;
  await assertStudent(db, academyId, studentId);

  const [head, attendanceSnapshot, manual, voids, changes, promotions] = await Promise.all([
    db.doc(`${base}/studentLevelProgress/${studentId}`).get(),
    readCanonicalMemberHistoryDocuments(db, academyId, studentId, "attendance", 400),
    db.collection(`${base}/memberManualAttendance`).where("studentId", "==", studentId).get(),
    db.collection(`${base}/attendanceVoids`).where("studentId", "==", studentId).get(),
    db.collection(`${base}/progressChanges`).where("studentId", "==", studentId).get(),
    readCanonicalMemberHistoryDocuments(db, academyId, studentId, "levelPromotions", 400),
  ]);
  const real = countedAttendance(
    attendanceSnapshot as never,
    academyId,
    studentId,
    attendanceSnapshot.ids,
  );
  const sessionIds = real.map((record) => String(record.sessionId));
  const [counted, openMat, sessions] = await Promise.all([
    countedClassInstants(db, academyId, studentId, real),
    openMatSessionIds(db, academyId, sessionIds),
    readDocuments(db, [...new Set(sessionIds)].map((id) => `${base}/sessions/${id}`)),
  ]);

  const headData = head.data();
  const initialized = head.exists && headData?.state === "initialized";
  const startedAt =
    initialized && typeof headData?.currentLevelStartedAt === "string"
      ? headData.currentLevelStartedAt
      : null;
  const baseline = importedBaselineSchema.safeParse(headData?.importedBaseline);
  const classesAtLevel = initialized
    ? countClassesAtLevel({
        attendedAt: counted.map((record) => record.occurredAt),
        currentLevelStartedAt: startedAt,
        importedBaseline: baseline.success ? baseline.data : null,
      }).total
    : 0;

  const titleOf = new Map(
    sessions.map((session) => [
      session.id,
      typeof session.get("title") === "string" ? String(session.get("title")).slice(0, 200) : "Class",
    ]),
  );
  const voidReason = new Map(
    voids.docs
      .filter((document) => document.get("voided") === true)
      .map((document) => [document.id, (document.get("reason") as string | null) ?? null]),
  );
  const attendance = [
    ...real.map((record) => ({
      id: String(record.attendanceId),
      kind: "attendance" as const,
      date: jerseyDateOf(String(record.occurredAt)),
      label: titleOf.get(String(record.sessionId)) ?? "Class",
      openMat: openMat.has(String(record.sessionId)),
      voided: voidReason.has(String(record.attendanceId)),
      reason: voidReason.get(String(record.attendanceId)) ?? null,
    })),
    ...manual.docs.map((document) => {
      const progressVoid = document.get("progressVoid") as { reason?: string | null } | null;
      return {
        id: document.id,
        kind: "manual" as const,
        date: String(document.get("date")),
        label: "Added by owner",
        openMat: false,
        voided: progressVoid !== null && progressVoid !== undefined,
        reason: (progressVoid ? progressVoid.reason : document.get("reason")) ?? null,
      };
    }),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 1000);

  const lastPromotionId =
    typeof headData?.lastApprovedPromotionId === "string" ? headData.lastApprovedPromotionId : null;
  const lastPromotion = promotions.docs.find((document) => document.id === lastPromotionId);
  const undone = promotions.docs
    .filter(
      (document) =>
        document.get("kind") === "void" &&
        String(document.get("voidsPromotionId")).startsWith("owner-set_"),
    )
    .map((document) => ({
      at: String(document.get("decidedAt")),
      by: "Owner",
      summary: "Level change undone",
      reason: (document.get("reason") as string | null) ?? null,
    }));
  const history = [
    ...changes.docs.map((document) => ({
      at: String(document.get("at")),
      by: String(document.get("byName") ?? document.get("by")),
      summary: String(document.get("summary")),
      reason: (document.get("reason") as string | null) ?? null,
    })),
    ...undone,
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 200);

  const result: ProgressManagement = {
    studentId,
    initialized,
    currentDefinitionKey: initialized ? String(headData?.currentDefinitionKey) : null,
    startedOn: startedAt === null ? null : startedAt.slice(0, 10),
    classesAtLevel,
    baselineCutoff: baseline.success && baseline.data.source === "owner-set" ? baseline.data.cutoff : null,
    undoPromotionId: lastPromotion?.get("kind") === "owner-set" ? lastPromotionId : null,
    attendance,
    history,
  };
  return progressManagementSchema.parse(result);
});

export const setProgressLevel = onCall(browserAdminCallableOptions, async (request) => {
  const owner = await requireOwner(request);
  const input = parse(
    setProgressLevelInputSchema,
    request.data,
    "Check the level, the start date and the class count.",
  );
  const now = new Date().toISOString();
  if (input.startedOn > jerseyDateOf(now)) {
    throw new HttpsError("invalid-argument", "The start date cannot be in the future.");
  }
  const db = getFirestore();
  const base = `academies/${owner.academyId}`;
  const catalog = await createLevelCatalogStore({ firestore: db as never }).listPublished(
    owner.academyId,
  );
  const target = catalog.definitions.find(
    (definition) => definition.definitionKey === input.definitionKey,
  );
  if (!target) throw new HttpsError("invalid-argument", "Choose a level from the published list.");
  const headRef = db.doc(`${base}/studentLevelProgress/${input.studentId}`);
  const promotionId = `owner-set_${input.studentId}_${now}`;
  const classes = input.classes ?? 0;
  await db.runTransaction(async (transaction) => {
    const head = await transaction.get(headRef);
    const headData = head.data();
    if (
      !head.exists ||
      headData?.academyId !== owner.academyId ||
      headData.state !== "initialized" ||
      headData.systemId !== catalog.system.systemId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Open this member's level first from their record, then set it here.",
      );
    }
    // Same shape as an assignLevel promotion, so the level history shows it and voidPromotion
    // (the existing Undo) restores the head from `restore` (D8).
    transaction.create(db.doc(`${base}/levelPromotions/${promotionId}`), {
      promotionId,
      kind: "owner-set",
      academyId: owner.academyId,
      studentId: input.studentId,
      systemId: headData.systemId,
      fromDefinitionKey: headData.currentDefinitionKey,
      toDefinitionKey: target.definitionKey,
      promotedOn: input.startedOn,
      status: "approved",
      decisionStatus: "approved",
      decidedBy: owner.userId,
      decidedByRole: "owner",
      decidedAt: now,
      note: input.reason,
      gaps: [],
      restore: promotionRestoreOf(headData),
      schemaVersion: "1",
      createdAt: now,
      createdBy: owner.userId,
      updatedAt: now,
      updatedBy: owner.userId,
    });
    transaction.set(headRef, {
      ...headData,
      currentDefinitionKey: target.definitionKey,
      currentLevelStartedAt: `${input.startedOn}T00:00:00.000Z`,
      lastApprovedPromotionId: promotionId,
      // D12: the owner's count is the total up to today; attendance from tomorrow adds on top.
      importedBaseline: { classes, cutoff: tomorrowInJersey(now), source: "owner-set" },
      updatedAt: now,
      updatedBy: owner.userId,
    });
    logChange(
      transaction,
      db,
      owner,
      input.studentId,
      now,
      `Level set to ${target.name} from ${input.startedOn}, ${classes} classes`,
      input.reason,
    );
  });
  return { promotionId };
});

export const setProgressClassCount = onCall(browserAdminCallableOptions, async (request) => {
  const owner = await requireOwner(request);
  const input = parse(setProgressClassCountInputSchema, request.data, "Enter a whole number of classes.");
  const now = new Date().toISOString();
  const db = getFirestore();
  const headRef = db.doc(`academies/${owner.academyId}/studentLevelProgress/${input.studentId}`);
  await db.runTransaction(async (transaction) => {
    const head = await transaction.get(headRef);
    const headData = head.data();
    if (!head.exists || headData?.academyId !== owner.academyId || headData.state !== "initialized") {
      throw new HttpsError(
        "failed-precondition",
        "Open this member's level first from their record, then set it here.",
      );
    }
    transaction.set(headRef, {
      ...headData,
      importedBaseline: { classes: input.classes, cutoff: tomorrowInJersey(now), source: "owner-set" },
      updatedAt: now,
      updatedBy: owner.userId,
    });
    logChange(
      transaction,
      db,
      owner,
      input.studentId,
      now,
      `Classes at this level set to ${input.classes}`,
      input.reason,
    );
  });
  return { classes: input.classes };
});

export const addManualAttendance = onCall(browserAdminCallableOptions, async (request) => {
  const owner = await requireOwner(request);
  const input = parse(addManualAttendanceInputSchema, request.data, "Choose a valid date.");
  const now = new Date().toISOString();
  if (input.date > jerseyDateOf(now)) {
    throw new HttpsError("invalid-argument", "The date cannot be in the future.");
  }
  const db = getFirestore();
  await assertStudent(db, owner.academyId, input.studentId);
  const ref = db.collection(`academies/${owner.academyId}/memberManualAttendance`).doc();
  const batch = db.batch();
  // D5: a free date, always a class (never Open Mat).
  batch.create(ref, {
    manualAttendanceId: ref.id,
    academyId: owner.academyId,
    studentId: input.studentId,
    date: input.date,
    reason: input.reason,
    createdBy: owner.userId,
    createdAt: now,
    progressVoid: null,
    schemaVersion: "1",
  });
  logChange(batch, db, owner, input.studentId, now, `Attendance added on ${input.date}`, input.reason);
  await batch.commit();
  return { id: ref.id };
});

export const setAttendanceVoid = onCall(browserAdminCallableOptions, async (request) => {
  const owner = await requireOwner(request);
  const input = parse(setAttendanceVoidInputSchema, request.data, "Choose an attendance to change.");
  const now = new Date().toISOString();
  const db = getFirestore();
  const base = `academies/${owner.academyId}`;
  const identityIds =
    input.kind === "attendance"
      ? await readCanonicalMemberIdentityIds(db, owner.academyId, input.studentId)
      : [input.studentId];
  const verb = input.voided ? "removed" : "restored";
  await db.runTransaction(async (transaction) => {
    if (input.kind === "manual") {
      const ref = db.doc(`${base}/memberManualAttendance/${input.id}`);
      const record = await transaction.get(ref);
      if (
        !record.exists ||
        record.get("academyId") !== owner.academyId ||
        record.get("studentId") !== input.studentId
      ) {
        throw new HttpsError("not-found", "This attendance no longer exists.");
      }
      transaction.update(ref, {
        progressVoid: input.voided ? { at: now, by: owner.userId, reason: input.reason } : null,
      });
      logChange(
        transaction,
        db,
        owner,
        input.studentId,
        now,
        `Attendance on ${String(record.get("date"))} ${verb}`,
        input.reason,
      );
      return;
    }
    const attendance = await transaction.get(db.doc(`${base}/attendance/${input.id}`));
    if (
      !attendance.exists ||
      attendance.get("academyId") !== owner.academyId ||
      !identityIds.includes(String(attendance.get("studentId")))
    ) {
      throw new HttpsError("not-found", "This attendance no longer exists.");
    }
    // Spec deviation 1: the attendance record is never modified; the void lives beside it.
    transaction.set(db.doc(`${base}/attendanceVoids/${input.id}`), {
      attendanceId: input.id,
      academyId: owner.academyId,
      studentId: input.studentId,
      voided: input.voided,
      reason: input.reason,
      updatedAt: now,
      updatedBy: owner.userId,
      schemaVersion: "1",
    });
    logChange(
      transaction,
      db,
      owner,
      input.studentId,
      now,
      `Attendance on ${jerseyDateOf(String(attendance.get("occurredAt")))} ${verb}`,
      input.reason,
    );
  });
  return { voided: input.voided };
});
```

Notes for the implementer:
- `readCanonicalMemberIdentityIds` runs its own transaction, so it is called before `runTransaction`.
- `countedAttendance(attendanceSnapshot as never, …)` is exactly how `level-service.ts` calls it with the same reader output.
- All queries are single-field equality/range → no composite index needed; do NOT add one.

- [ ] **Step 2: Export from `index.ts`**

In `apps/functions/src/index.ts`, near the other levels exports (after the `} from "./levels/level-callables.js";` block, ~line 107), add:

```ts
export {
  addManualAttendance,
  getProgressManagement,
  setAttendanceVoid,
  setProgressClassCount,
  setProgressLevel,
} from "./levels/progress-management-callables.js";
```

- [ ] **Step 3: Type-check functions**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/functions exec tsc --noEmit`
Expected: no errors. If `requireActiveOfficeActor`'s return type lacks `userId`/`academyId`/`role`, read `apps/functions/src/auth/office-actor.ts` and `requireUserActor` and use the real field names.

- [ ] **Step 4: Commit**

```bash
git add apps/functions/src/levels/progress-management-callables.ts apps/functions/src/index.ts
git commit -m "feat(levels): owner-only callables to set level, class count and attendance dates"
```

---

### Task 4: Web client

**Files:**
- Create: `apps/web/src/lib/progress-management-client.ts`

**Interfaces:**
- Consumes: Task 1 schemas/types from `@bpt-jersey/domain/levels`; `httpsCallable` from `./callable`, `getFirebaseFunctions` from `./firebase-client` (same as `team-access-client.ts`).
- Produces: `getProgressManagement(studentId: string): Promise<ProgressManagement>`, `setProgressLevel(input: SetProgressLevelInput)`, `setProgressClassCount(input: SetProgressClassCountInput)`, `addManualAttendance(input: AddManualAttendanceInput)`, `setAttendanceVoid(input: SetAttendanceVoidInput)` — each rejects with an `Error` whose message is safe to show.

- [ ] **Step 1: Create the client**

```ts
"use client";
import { z } from "zod";
import {
  progressManagementSchema,
  type AddManualAttendanceInput,
  type ProgressManagement,
  type SetAttendanceVoidInput,
  type SetProgressClassCountInput,
  type SetProgressLevelInput,
} from "@bpt-jersey/domain/levels";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

/** Our callables send short owner-facing sentences for these codes; anything else gets the fallback. */
const ownMessageCodes = new Set([
  "functions/invalid-argument",
  "functions/failed-precondition",
  "functions/not-found",
  "functions/permission-denied",
]);

async function call<T>(name: string, input: unknown, schema: z.ZodType<T>, fallback: string): Promise<T> {
  try {
    return schema.parse((await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(input)).data);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && ownMessageCodes.has(code) && error instanceof Error && error.message) {
      throw new Error(error.message);
    }
    throw new Error(fallback);
  }
}

export function getProgressManagement(studentId: string): Promise<ProgressManagement> {
  return call("getProgressManagement", { studentId }, progressManagementSchema, "Unable to load this member's progress. Please try again.");
}
export function setProgressLevel(input: SetProgressLevelInput) {
  return call("setProgressLevel", input, z.object({ promotionId: z.string() }), "Unable to save the level. Please try again.");
}
export function setProgressClassCount(input: SetProgressClassCountInput) {
  return call("setProgressClassCount", input, z.object({ classes: z.number() }), "Unable to save the class count. Please try again.");
}
export function addManualAttendance(input: AddManualAttendanceInput) {
  return call("addManualAttendance", input, z.object({ id: z.string() }), "Unable to add this date. Please try again.");
}
export function setAttendanceVoid(input: SetAttendanceVoidInput) {
  return call("setAttendanceVoid", input, z.object({ voided: z.boolean() }), "Unable to change this attendance. Please try again.");
}
```

Run `corepack pnpm exec prettier --write apps/web/src/lib/progress-management-client.ts` so the long lines match the repo format.

- [ ] **Step 2: Commit** (together with Task 5 is fine; if separate:)

```bash
git add apps/web/src/lib/progress-management-client.ts
git commit -m "feat(web): progress management client"
```

---

### Task 5: The "Progress management" tab

**Files:**
- Create: `apps/web/src/app/admin/members/progress-management.tsx`
- Modify: `apps/web/src/app/admin/members/members-workspace.tsx` (views list ~line 17-21, session, tabs ~335-352, view switch ~367-373)
- Modify: `apps/web/src/app/admin/admin.css` (append a small block at the end)

**Interfaces:**
- Consumes: Task 4 client; `getLevelCatalog`, `voidPromotion` from `apps/web/src/lib/levels-client.ts`; `daysAtLevel`, `minimumDaysOf`, `jerseyDateOf`, types `LevelCatalogProjection`, `ProgressManagement` from `@bpt-jersey/domain/levels`; `seasonStartFor` from `@bpt-jersey/domain/members/engagement`; `useAdminGateSession` from `../admin-gate`; `MemberOverviewRow` from `@bpt-jersey/domain/members/overview`.
- Produces: `export function ProgressManagementTab({ rows }: { rows: readonly MemberOverviewRow[] })`.

Before writing UI, skim `DESIGN.md` (admin section) and reuse existing classes: `admin-panel-card`, `admin-filter-control`, `admin-filter-bar`, `button`, `membership-table-button`, `membership-table-button-danger`, `admin-no-results`, `members-count`. Apply `impeccable`/`accessibility` judgement: every input has a visible `<label>`, status text uses `role="status"`, errors use `role="alert"`.

- [ ] **Step 1: Create the tab component**

`apps/web/src/app/admin/members/progress-management.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  daysAtLevel,
  jerseyDateOf,
  minimumDaysOf,
  type LevelCatalogProjection,
  type ProgressManagement,
} from "@bpt-jersey/domain/levels";
import { seasonStartFor } from "@bpt-jersey/domain/members/engagement";
import type { MemberOverviewRow } from "@bpt-jersey/domain/members/overview";

import { getLevelCatalog, voidPromotion } from "../../../lib/levels-client";
import {
  addManualAttendance,
  getProgressManagement,
  setAttendanceVoid,
  setProgressClassCount,
  setProgressLevel,
} from "../../../lib/progress-management-client";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function ProgressManagementTab({ rows }: { rows: readonly MemberOverviewRow[] }) {
  const today = jerseyDateOf(new Date().toISOString());
  const [query, setQuery] = useState("");
  const [member, setMember] = useState<MemberOverviewRow | null>(null);
  const [catalog, setCatalog] = useState<LevelCatalogProjection | null>(null);
  const [data, setData] = useState<ProgressManagement | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [definitionKey, setDefinitionKey] = useState("");
  const [startedOn, setStartedOn] = useState(today);
  const [classes, setClasses] = useState(0);
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"level" | "season">("level");
  const [addDate, setAddDate] = useState("");
  const [addReason, setAddReason] = useState("");

  useEffect(() => {
    getLevelCatalog().then(setCatalog, (failure: unknown) => setError(messageOf(failure)));
  }, []);

  useEffect(() => {
    if (member === null) return undefined;
    let live = true;
    setData(null);
    getProgressManagement(member.studentId).then(
      (next) => {
        if (!live) return;
        setData(next);
        setDefinitionKey(next.currentDefinitionKey ?? "");
        setStartedOn(next.startedOn ?? today);
        setClasses(next.classesAtLevel);
        setReason("");
      },
      (failure: unknown) => live && setError(messageOf(failure)),
    );
    return () => {
      live = false;
    };
  }, [member, reloadToken, today]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return rows.filter((row) => row.fullName.toLowerCase().includes(needle)).slice(0, 8);
  }, [rows, query]);

  const definitions = useMemo(
    () => [...(catalog?.definitions ?? [])].sort((a, b) => a.sequence - b.sequence),
    [catalog],
  );
  const current = definitions.find((definition) => definition.definitionKey === definitionKey);
  const next = current ? definitions.find((definition) => definition.sequence > current.sequence) : undefined;
  const minClasses = next?.criteria.minClasses ?? null;
  const minDays = next ? minimumDaysOf(next.criteria.minimumTime) : null;
  const days = daysAtLevel(`${startedOn}T00:00:00.000Z`, new Date().toISOString());
  const since = scope === "level" ? (data?.startedOn ?? "0000-01-01") : seasonStartFor(new Date().toISOString());
  const visible = (data?.attendance ?? []).filter((row) => row.date >= since);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      setReloadToken((token) => token + 1);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!data || !member) return;
    const levelChanged = definitionKey !== data.currentDefinitionKey || startedOn !== data.startedOn;
    void run(() =>
      levelChanged
        ? setProgressLevel({ studentId: member.studentId, definitionKey, startedOn, classes, reason })
        : setProgressClassCount({ studentId: member.studentId, classes, reason }),
    );
  }

  function removeRow(kind: "attendance" | "manual", id: string) {
    if (!member) return;
    const why = window.prompt("Reason for removing this date (optional)");
    if (why === null) return;
    void run(() => setAttendanceVoid({ studentId: member.studentId, kind, id, voided: true, reason: why }));
  }

  function undoLevel() {
    if (!member || !data?.undoPromotionId) return;
    const why = window.prompt(
      "Why undo this level change? (at least 10 characters)",
      "Undone from Progress management",
    );
    if (!why) return;
    const promotionId = data.undoPromotionId;
    void run(() => voidPromotion({ studentId: member.studentId, promotionId, reason: why }));
  }

  return (
    <section className="admin-panel-card progress-manage" aria-label="Progress management">
      <div className="admin-filter-bar">
        <label className="admin-filter-control members-search">
          Member
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type at least 2 letters of a name"
            type="search"
            value={query}
          />
        </label>
      </div>
      {matches.length > 0 ? (
        <ul className="progress-manage-matches" aria-label="Matching members">
          {matches.map((row) => (
            <li key={row.studentId}>
              <button
                className="membership-table-button"
                onClick={() => {
                  setMember(row);
                  setQuery("");
                  setError(undefined);
                }}
                type="button"
              >
                {row.fullName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="progress-manage-error" role="alert">
          {error}
        </p>
      ) : null}

      {member === null ? (
        <p className="admin-no-results" role="status">
          Search a member to see and correct their progress.
        </p>
      ) : data === null ? (
        <p className="admin-no-results" role="status">
          Loading {member.fullName}…
        </p>
      ) : !data.initialized ? (
        <p className="admin-no-results" role="status">
          {member.fullName} has no level yet. Open their level from their member record first.
        </p>
      ) : (
        <>
          <h3 className="progress-manage-name">{member.fullName}</h3>

          <div className="progress-manage-grid">
            <fieldset className="progress-manage-block">
              <legend>Current level</legend>
              <label className="admin-filter-control">
                Belt / stripe
                <select
                  onChange={(event) => {
                    setDefinitionKey(event.target.value);
                    setClasses(0); // D12: a new level restarts the count unless you type one.
                  }}
                  value={definitionKey}
                >
                  {definitions.map((definition) => (
                    <option key={definition.definitionKey} value={definition.definitionKey}>
                      {definition.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-filter-control">
                Started on
                <input max={today} onChange={(event) => setStartedOn(event.target.value)} type="date" value={startedOn} />
              </label>
              <p className="progress-manage-note">
                {days} days at this level
                {next && minDays !== null ? ` of ${minDays} required for ${next.name}` : ""}.
              </p>
              {data.undoPromotionId ? (
                <button className="membership-table-button" disabled={busy} onClick={undoLevel} type="button">
                  Undo last level change
                </button>
              ) : null}
            </fieldset>

            <fieldset className="progress-manage-block">
              <legend>Classes at this level</legend>
              <label className="admin-filter-control">
                Classes up to today
                <input
                  min={0}
                  onChange={(event) => setClasses(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
                  type="number"
                  value={classes}
                />
              </label>
              {next && minClasses !== null ? (
                <>
                  <meter max={minClasses} min={0} value={Math.min(classes, minClasses)} />
                  <p className="progress-manage-note">
                    {classes} of {minClasses} classes for {next.name}
                  </p>
                </>
              ) : null}
              <label className="admin-filter-control">
                Reason (optional)
                <input maxLength={300} onChange={(event) => setReason(event.target.value)} value={reason} />
              </label>
              <button className="button" disabled={busy} onClick={save} type="button">
                {busy ? "Saving…" : "Save level and classes"}
              </button>
            </fieldset>
          </div>

          <section className="progress-manage-block" aria-label="Attendance">
            <div className="progress-manage-head">
              <h4>Attendance</h4>
              <div role="group" aria-label="Attendance range">
                <button aria-pressed={scope === "level"} className="membership-table-button" onClick={() => setScope("level")} type="button">
                  This level
                </button>
                <button aria-pressed={scope === "season"} className="membership-table-button" onClick={() => setScope("season")} type="button">
                  This season
                </button>
              </div>
            </div>
            <div className="admin-filter-bar">
              <label className="admin-filter-control">
                Add a date
                <input max={today} onChange={(event) => setAddDate(event.target.value)} type="date" value={addDate} />
              </label>
              <label className="admin-filter-control">
                Reason (optional)
                <input maxLength={300} onChange={(event) => setAddReason(event.target.value)} value={addReason} />
              </label>
              <button
                className="button"
                disabled={busy || addDate === ""}
                onClick={() =>
                  void run(async () => {
                    await addManualAttendance({ studentId: member.studentId, date: addDate, reason: addReason });
                    setAddDate("");
                    setAddReason("");
                  })
                }
                type="button"
              >
                Add date
              </button>
            </div>
            {data.baselineCutoff ? (
              <p className="progress-manage-note">
                Dates before {data.baselineCutoff} are already inside the class count; adding one still
                counts for the streak and the season ranking.
              </p>
            ) : null}
            <p className="members-count" role="status">
              {visible.filter((row) => !row.voided && !row.openMat).length} counted classes shown
            </p>
            <ul className="progress-attendance">
              {visible.map((row) => (
                <li key={`${row.kind}:${row.id}`} className={row.voided ? "is-voided" : undefined}>
                  <span className="progress-attendance-date">{row.date}</span>
                  <span>{row.label}</span>
                  {row.openMat ? <span className="progress-tag">Open Mat · doesn&apos;t count</span> : null}
                  {row.voided ? <span className="progress-tag">Removed{row.reason ? `: ${row.reason}` : ""}</span> : null}
                  {row.voided ? (
                    <button
                      className="membership-table-button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          setAttendanceVoid({ studentId: member.studentId, kind: row.kind, id: row.id, voided: false }),
                        )
                      }
                      type="button"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      className="membership-table-button membership-table-button-danger"
                      disabled={busy}
                      onClick={() => removeRow(row.kind, row.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="progress-manage-block" aria-label="Change history">
            <h4>Change history</h4>
            {data.history.length === 0 ? (
              <p className="admin-no-results">No changes yet.</p>
            ) : (
              <ul className="progress-history">
                {data.history.map((change, index) => (
                  <li key={`${change.at}-${index}`}>
                    <strong>{change.summary}</strong>
                    <span>
                      {change.by} · {new Date(change.at).toLocaleString("en-GB", { timeZone: "Europe/Jersey" })}
                    </span>
                    {change.reason ? <span>Reason: {change.reason}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
```

Check before moving on: `getLevelCatalog` and `voidPromotion` really are exported from `apps/web/src/lib/levels-client.ts` (they are at ~line 170 and ~595), and `voidPromotion` takes `{ studentId, promotionId, reason }` (`voidPromotionInputSchema`, reason 10–500 chars — hence the default text in the prompt).

- [ ] **Step 2: Wire the tab into the members workspace (owner only)**

In `apps/web/src/app/admin/members/members-workspace.tsx`:
1. Imports: add `import { useAdminGateSession } from "../admin-gate";` and `import { ProgressManagementTab } from "./progress-management";`.
2. `memberViews`: add a fourth entry `{ value: "progress", label: "Progress management" },`.
3. In `MembersWorkspace()` first lines: `const isOwner = useAdminGateSession().role === "owner";`
4. Tabs: change `{memberViews.map((item) => (` to `{memberViews.filter((item) => item.value !== "progress" || isOwner).map((item) => (`.
5. View switch: before `) : view === "families" ? (` add

```tsx
      ) : view === "progress" && isOwner ? (
        <ProgressManagementTab rows={state.overview.rows} />
```

(A non-owner who opens `?view=progress` simply falls through to the directory.)

- [ ] **Step 3: Styles**

Append to `apps/web/src/app/admin/admin.css`:

```css
/* Progress management tab (owner) */
.progress-manage { display: grid; gap: 1.25rem; }
.progress-manage-name { margin: 0; }
.progress-manage-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
.progress-manage-block { border: 1px solid var(--line); display: grid; gap: 0.75rem; margin: 0; min-width: 0; padding: 1rem; }
.progress-manage-block legend, .progress-manage-block h4 { font-weight: 700; margin: 0; }
.progress-manage-head { align-items: center; display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: space-between; }
.progress-manage-note { color: var(--muted); margin: 0; }
.progress-manage-error { color: #721626; margin: 0; }
.progress-manage-matches { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; margin: 0; padding: 0; }
.progress-manage meter { width: 100%; }
.progress-attendance, .progress-history { display: grid; gap: 0.4rem; list-style: none; margin: 0; padding: 0; }
.progress-attendance li { align-items: center; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; padding: 0.4rem 0; }
.progress-attendance li.is-voided > span:not(.progress-tag) { color: var(--muted); text-decoration: line-through; }
.progress-attendance-date { font-variant-numeric: tabular-nums; min-width: 6.5rem; }
.progress-tag { background: var(--canvas); border-left: 0.25rem solid var(--bpt-purple); font-size: 0.8rem; padding: 0.1rem 0.4rem; }
.progress-history li { display: grid; gap: 0.15rem; }
```

Then run `corepack pnpm exec prettier --write apps/web/src/app/admin/admin.css apps/web/src/app/admin/members/progress-management.tsx apps/web/src/app/admin/members/members-workspace.tsx`.

- [ ] **Step 4: Type-check the web app**

Run: `corepack pnpm --filter @bpt-jersey/web exec tsc --noEmit`
Expected: no errors in the new/changed files (fix any real type error; do not touch unrelated files or tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/progress-management-client.ts apps/web/src/app/admin/members/progress-management.tsx apps/web/src/app/admin/members/members-workspace.tsx apps/web/src/app/admin/admin.css
git commit -m "feat(admin): owner Progress management tab in Members"
```

---

### Task 6: Delivery (controller only — needs the operator's OK in chat)

**Files:**
- Create: `/root/bpt-runbook/deploy-2026-09-30/progress-management.txt` (function list; outside the repo)

- [ ] **Step 1: Review before shipping** — run `/code-review` (high: it touches member data and permissions) on the diff of Tasks 1–5 and fix what it confirms.

- [ ] **Step 2: Integrate and push (publishes the web in ~90 s)**

```bash
git fetch origin && git rebase origin/main
git push origin main
git rev-parse main origin/main   # both SHAs must match
```

- [ ] **Step 3: Function list** — every bundle that parses `importedBaseline` or counts classes (Review Focus 1), plus the five new ones. Write it with:

```bash
cd /root/BPT-Jersey && {
  printf '%s\n' getProgressManagement setProgressLevel setProgressClassCount addManualAttendance setAttendanceVoid
  for f in levels/level-callables levels/level-editor-callables levels/family-achievement-callables levels/progress-report-callables members/member-profile-callables promotion/promotion-callables streak/streak-callables competitors/competitors-callables; do
    grep -oE '^export const [a-zA-Z]+ = on' "apps/functions/src/$f.ts" | awk '{print $3}'
  done
} | sort -u > /root/bpt-runbook/deploy-2026-09-30/progress-management.txt && wc -l /root/bpt-runbook/deploy-2026-09-30/progress-management.txt
```

- [ ] **Step 4: Deploy (operator runs it)** — `bash /root/bpt-runbook/deploy-2026-09-30/desplegar.sh /root/bpt-runbook/deploy-2026-09-30/progress-management.txt` (batches of 20, 120 s pause). **Nobody uses the tab until every batch says OK** (Review Focus 1).

- [ ] **Step 5: Verify in production** with a member the operator picks (spec §E): the tab shows only for the owner; an Open Mat attendance is tagged "doesn't count" and the class count ignores it; set a count → the meter shows it; add a past date → count unchanged, streak/season list includes it; remove and restore a date; change level + date → history row; Undo → level back. Confirm with `functions_get_logs` that the new callables answer 200. Report anything not tested.

- [ ] **Step 6: Memory** — write `project-bpt-jersey-progress-management.md` (commits, LIVE state, deviations 1–4, pending) and its line in `MEMORY.md`.
