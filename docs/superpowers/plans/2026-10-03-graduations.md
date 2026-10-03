# Graduations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Graduations** tab (owner/administrator) with Next graduation → Today's graduations → Graduation approval, owner-only **Promote / Not yet**, animated graduation notices and a one-time new-level celebration in `/account`, and the level catalogue aligned with the academy PDF.

**Architecture:** One pure domain function (`assessGraduation`) decides each student's stage from data the server already has (level head, counted classes, recent/upcoming sessions, bookings, Not-yet reviews). Functions compute it on read for the board and for a member's notices; only decisions are stored (Promote reuses the existing `assignLevel` store write; Not yet writes `graduationReviews`). The catalogue change is a one-off plan/apply CLI with a dry-run confirmation, the same pattern as the 2026-10-03 adoption.

**Tech Stack:** TypeScript strict, zod, Firebase Functions v2 (`onCall`, europe-west9), Firestore, Next.js 16 static export / React 19, CSS keyframes.

**Spec:** `docs/superpowers/specs/2026-10-03-graduations-design.md` (approved 2026-10-03).

## Global Constraints

- BPT `AGENTS.md`: work on local `main`, push to `origin/main`, never `git add -A` (other sessions share the repo), no branches/worktrees/PRs.
- BPT `AGENTS.md`: do NOT add or run automated tests (unit, rules, integration, e2e) — the operator has not requested them. Verification = code inspection + compiling what is deployed + production check.
- `packages/domain` never imports Firebase; new module added to `packages/domain/package.json` subpath exports.
- Functions region `europe-west9`; every new callable re-exported from `apps/functions/src/index.ts`; options `{ enforceAppCheck: true }` (same as `levelCallableOptions`).
- Production (functions deploy, catalogue apply) only after explicit operator confirmation in chat.
- Copy is English in the UI; operator talks Spanish.
- Buttons are exactly **Promote** and **Not yet** (D9). Only role `owner` may decide (D8). Tab visible to `owner` and `administrator`, not in the coach menu, not in `coachRoutes` (D7).
- Only classes + time gate graduation (D6). Members do not see techniques (D6).
- Not-yet note: optional, max 280 characters, trimmed, no control characters except tab/newline.
- Animations: CSS only, no new dependencies, all disabled under `prefers-reduced-motion: reduce`.
- Existing progress notices (`PromotionBar`, `GraduationNotice`) stay (D13).

## Review Focus

1. **The graduation class counted twice.** `countClassesAtLevel` counts classes on a day ≥ the level start day, and a promotion starts the new level at 00:00 of the promotion day — so the graduation class itself shows as class 1 of the new level. This is existing behaviour of every promotion; Promote must keep using the same rule (one counting rule everywhere) and the final report must tell the operator.
2. **Owner promotes twice / board is stale.** `decideGraduation` must re-run `assessGraduation` server-side and refuse unless the student is still in `approval` for that exact `sessionId`; `assignLevel` also refuses when `fromDefinitionKey` is no longer current.
3. **A member with no habit and no booking.** `likelyNext` is `null`; the board shows "Next class not predicted" and the member notice omits the date — never a crash or an empty string date.
4. **Top rank / no target / uninitialised head.** `assessGraduation` returns stage `none` for `target === null`; students without an `initialized` head are skipped by the service.
5. **Kids 7-10 stripes 7/8 removal with members on them.** The catalogue CLI must move those heads to stripe 6 of the same belt, renumber `sequence` contiguously (the engine finds the next level by `sequence + 1`), and refuse when any `levelPromotions` row references a removed key (stop and ask the operator).

---

## File Structure

| File | Responsibility |
|---|---|
| Create `packages/domain/src/graduations/graduation-contracts.ts` | Stage engine `assessGraduation`, zod schemas for the three callables |
| Modify `packages/domain/package.json` | Subpath export `./graduations` |
| Modify `packages/domain/src/memberships/subscription-admin-contracts.ts:45-51` | Add admin notification kind `"level"` |
| Modify `apps/functions/src/levels/level-service.ts:754` | Export `storedImportedBaseline` |
| Create `apps/functions/src/graduations/graduation-firestore.ts` | Reads (heads, students, sessions, bookings, counted classes, reviews) and the review write |
| Create `apps/functions/src/graduations/graduation-service.ts` | Board, notices and decision orchestration (pure over the adapter) |
| Create `apps/functions/src/graduations/graduation-callables.ts` | `listGraduationBoard`, `decideGraduation`, `getGraduationNotices` |
| Modify `apps/functions/src/index.ts` | Export the three callables |
| Create `apps/functions/src/levels/level-catalog-pdf-alignment.ts` | Plan/apply for the PDF catalogue changes |
| Create `apps/functions/scripts/align-level-catalog-pdf.mjs` | CLI with dry-run and confirmation |
| Create `apps/web/src/lib/graduations-client.ts` | `httpsCallable` + zod + safe messages |
| Create `apps/web/src/app/admin/graduations/page.tsx` + `graduations.css` | Board page |
| Modify `apps/web/src/app/admin/admin-shell.tsx:30-34` | Nav item between Overview and Attendance |
| Create `apps/web/src/app/account/graduation/graduation-notices.tsx` + `graduation.css` | Member notices + celebration |
| Modify `apps/web/src/app/account/page.tsx:58-63` | Mount notices in `topSlot` |
| Modify `apps/web/src/app/account/progress/member-progress.tsx:282-310` | Remove techniques section from member view |

---

### Task 1: Domain stage engine and contracts

**Files:**
- Create: `packages/domain/src/graduations/graduation-contracts.ts`
- Modify: `packages/domain/package.json` (exports block, next to `"./levels"`)
- Modify: `packages/domain/src/memberships/subscription-admin-contracts.ts:45-51`

**Interfaces:**
- Consumes: `countClassesAtLevel`, `daysAtLevel`, `jerseyDateOf`, `minimumDaysOf`, `ImportedBaseline` from `../levels/level-progress`; `LevelDefinitionRecord` from `../levels/level-contracts`; `isComparablePreClassSession`, `preClassMinAttendances` from `../schedule/pre-class-contracts`; `SessionRecord` from `../schedule/schedule-contracts`.
- Produces:
  - `assessGraduation(input: GraduationInput): GraduationAssessment`
  - types `GraduationStage`, `GraduationInput`, `GraduationAssessment`, `GraduationReview`
  - schemas `graduationBoardSchema`, `decideGraduationInputSchema`, `graduationNoticesSchema`, `graduationNoteSchema`

- [ ] **Step 1: Write the module**

```ts
import { z } from "zod";

import type { LevelDefinitionRecord } from "../levels/level-contracts";
import {
  countClassesAtLevel,
  daysAtLevel,
  jerseyDateOf,
  minimumDaysOf,
  type ImportedBaseline,
} from "../levels/level-progress";
import { isComparablePreClassSession, preClassMinAttendances } from "../schedule/pre-class-contracts";
import type { SessionRecord } from "../schedule/schedule-contracts";

/**
 * Graduations (spec 2026-10-03). One rule for the owner's board and the member's notices:
 * classes + minimum time of the NEXT level (`sequence + 1`), counted exactly like the progress bars.
 */
export const graduationStages = ["approval", "today", "next", "twoLeft", "none"] as const;
export type GraduationStage = (typeof graduationStages)[number];

export type CountedClassInstant = Readonly<{ occurredAt: string; sessionId: string | null }>;
export type GraduationReview = Readonly<{
  sessionId: string;
  definitionKey: string;
  decidedAt: string;
  note: string | null;
}>;

export type GraduationInput = Readonly<{
  target: LevelDefinitionRecord | null;
  currentLevelStartedAt: string;
  importedBaseline: ImportedBaseline | null;
  /** `countedClassInstants` output, oldest first. */
  counted: readonly CountedClassInstant[];
  /** Sessions from `now - 56 days` to `now + 21 days`, any status. */
  sessions: readonly SessionRecord[];
  bookedSessionIds: ReadonlySet<string>;
  reviews: readonly GraduationReview[];
  now: string;
}>;

export type LikelyClass = Readonly<{ sessionId: string; startAt: string; title: string }>;

export type GraduationAssessment = Readonly<{
  stage: GraduationStage;
  classesDone: number;
  minClasses: number | null;
  daysDone: number;
  minDays: number | null;
  /** UTC day (`YYYY-MM-DD`) from which the minimum time is met; null without a target. */
  periodEndsOn: string | null;
  graduationClass: CountedClassInstant | null;
  likelyNext: LikelyClass | null;
  /** In `next`/`today`, a habitual class in the last 7 days was missed (spec D14). */
  missedLikely: boolean;
  lastNotYetNote: string | null;
}>;

const dayMs = 86_400_000;
const nearPeriodDays = 7;

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * dayMs).toISOString().slice(0, 10);
}

export function assessGraduation(input: GraduationInput): GraduationAssessment {
  const none = (extra: Partial<GraduationAssessment> = {}): GraduationAssessment =>
    Object.freeze({
      stage: "none",
      classesDone: 0,
      minClasses: null,
      daysDone: 0,
      minDays: null,
      periodEndsOn: null,
      graduationClass: null,
      likelyNext: null,
      missedLikely: false,
      lastNotYetNote: null,
      ...extra,
    });
  const { target, now } = input;
  if (target === null) return none();

  const minClasses = target.criteria.minClasses;
  const minDays = minimumDaysOf(target.criteria.minimumTime);
  const startDay = input.currentLevelStartedAt.slice(0, 10);
  const periodEndsOn = addDays(startDay, minDays ?? 0);
  const attendedAt = input.counted.map((entry) => entry.occurredAt);
  const classesUntil = (until?: string) =>
    countClassesAtLevel({
      attendedAt,
      currentLevelStartedAt: input.currentLevelStartedAt,
      importedBaseline: input.importedBaseline,
      ...(until === undefined ? {} : { until }),
    }).total;
  const classesDone = classesUntil();
  const daysDone = daysAtLevel(input.currentLevelStartedAt, now);
  const reviews = input.reviews
    .filter((review) => review.definitionKey === target.definitionKey)
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  const lastReview = reviews.at(-1) ?? null;
  const reviewedAt =
    lastReview === null
      ? null
      : (input.counted.find((entry) => entry.sessionId === lastReview.sessionId)?.occurredAt ??
        lastReview.decidedAt);
  const base = {
    classesDone,
    minClasses,
    daysDone,
    minDays,
    periodEndsOn,
    lastNotYetNote: lastReview?.note ?? null,
  };

  // 1. approval: the first real class at this level that completes both criteria, after any Not yet.
  for (const entry of input.counted) {
    const day = entry.occurredAt.slice(0, 10);
    if (entry.sessionId === null || day < startDay) continue;
    if (reviewedAt !== null && entry.occurredAt <= reviewedAt) continue;
    if (day >= periodEndsOn && classesUntil(day) >= (minClasses ?? 0)) {
      return none({ ...base, stage: "approval", graduationClass: entry });
    }
  }

  // Habit: 2+ attended comparable sessions in the 56-day window (pre-class rule, spec D12).
  const attended = new Set(input.counted.flatMap((entry) => (entry.sessionId ? [entry.sessionId] : [])));
  const habitual = (session: SessionRecord) =>
    input.sessions.filter(
      (candidate) =>
        attended.has(candidate.sessionId) &&
        isComparablePreClassSession(session, candidate, { now }),
    ).length >= preClassMinAttendances;
  const likely = (session: SessionRecord) =>
    input.bookedSessionIds.has(session.sessionId) || habitual(session);

  const today = jerseyDateOf(now);
  const fromDay = periodEndsOn > now.slice(0, 10) ? periodEndsOn : now.slice(0, 10);
  const upcoming = input.sessions
    .filter((s) => s.status === "scheduled" && s.startAt > now && s.startAt.slice(0, 10) >= fromDay)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const next = upcoming.find(likely) ?? null;
  const likelyNext: LikelyClass | null =
    next === null ? null : { sessionId: next.sessionId, startAt: next.startAt, title: next.title };

  const classesLeft = Math.max(0, (minClasses ?? 0) - classesDone);
  const daysToPeriod = Math.round(
    (Date.parse(`${periodEndsOn}T00:00:00.000Z`) - Date.parse(`${now.slice(0, 10)}T00:00:00.000Z`)) /
      dayMs,
  );
  const graduatesNext =
    (classesLeft === 1 && likelyNext !== null) || (classesLeft === 0 && daysToPeriod < nearPeriodDays);
  if (graduatesNext) {
    const lastClassAt = input.counted.at(-1)?.occurredAt ?? input.currentLevelStartedAt;
    const weekAgo = new Date(Date.parse(now) - nearPeriodDays * dayMs).toISOString();
    const missedLikely = input.sessions.some(
      (s) =>
        s.status !== "cancelled" &&
        s.endAt < now &&
        s.startAt > lastClassAt &&
        s.startAt > weekAgo &&
        !attended.has(s.sessionId) &&
        likely(s),
    );
    const stage =
      likelyNext !== null && jerseyDateOf(likelyNext.startAt) === today ? "today" : "next";
    return none({ ...base, stage, likelyNext, missedLikely });
  }
  if (classesLeft === 2 && daysToPeriod <= 0) return none({ ...base, stage: "twoLeft", likelyNext });
  return none({ ...base, likelyNext });
}

const id = z.string().min(1).max(384);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const instant = z.string().datetime({ offset: true });
// Tab and newline allowed; every other C0 control and DEL refused (same rule as level notes).
export const graduationNoteSchema = z
  .string()
  .trim()
  .min(1)
  .max(280)
  .refine((value) => !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value));

export const decideGraduationInputSchema = z.strictObject({
  studentId: z.string().min(1).max(128),
  sessionId: id,
  decision: z.enum(["promote", "not-yet"]),
  note: graduationNoteSchema.optional(),
});
export type DecideGraduationInput = z.infer<typeof decideGraduationInputSchema>;

const levelChipSchema = z.strictObject({
  definitionKey: z.string().max(128),
  name: z.string().max(120),
  beltColor: z.string().max(40).nullable(),
});
const likelySchema = z.strictObject({ sessionId: id, startAt: instant, title: z.string().max(160) }).nullable();

export const graduationBoardRowSchema = z.strictObject({
  studentId: z.string().max(128),
  fullName: z.string().max(160),
  stage: z.enum(["approval", "today", "next"]),
  current: levelChipSchema,
  target: levelChipSchema,
  classesDone: z.number().int().min(0),
  minClasses: z.number().int().min(0).nullable(),
  daysDone: z.number().int().min(0),
  minDays: z.number().int().min(0).nullable(),
  likelyNext: likelySchema,
  graduationClass: z
    .strictObject({ sessionId: id, occurredAt: instant, title: z.string().max(160) })
    .nullable(),
  lastNotYetNote: z.string().max(280).nullable(),
});
export type GraduationBoardRow = z.infer<typeof graduationBoardRowSchema>;
export const graduationBoardSchema = z.strictObject({
  rows: z.array(graduationBoardRowSchema).max(1000),
  canDecide: z.boolean(),
  generatedAt: instant,
});
export type GraduationBoard = z.infer<typeof graduationBoardSchema>;

export const graduationNoticesSchema = z.strictObject({
  firstName: z.string().max(80),
  stage: z.enum(graduationStages),
  targetName: z.string().max(120).nullable(),
  likelyNext: likelySchema,
  missedLikely: z.boolean(),
  lastNotYetNote: z.string().max(280).nullable(),
  classesLeft: z.number().int().min(0).nullable(),
  latestPromotion: z
    .strictObject({
      promotionId: z.string().max(384),
      fromName: z.string().max(120),
      toName: z.string().max(120),
      toBeltColor: z.string().max(40).nullable(),
      promotedOn: day,
    })
    .nullable(),
});
export type GraduationNotices = z.infer<typeof graduationNoticesSchema>;
```

Before writing `levelChipSchema.beltColor`, open `packages/domain/src/levels/level-contracts.ts:38` (`LevelVisual`) and use its primary colour field name; if it has no single colour string, drop `beltColor` from both schemas and the rows (the UI then shows the name only).

- [ ] **Step 2: Export the module** — in `packages/domain/package.json` add next to `"./levels"`:

```json
    "./graduations": {
      "types": "./src/graduations/graduation-contracts.ts",
      "import": "./src/graduations/graduation-contracts.ts",
      "default": "./lib/graduations/graduation-contracts.js"
    },
```

- [ ] **Step 3: Admin notification kind** — in `subscription-admin-contracts.ts` append `"level",` to `adminNotificationKinds` (after `"class"`). Then `grep -rn "adminNotificationKinds\|AdminNotificationKind" apps/web/src` and give `"level"` the label `"Levels"` in any `Record<AdminNotificationKind, …>` it finds.

- [ ] **Step 4: Compile the domain**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime`
Expected: exits 0. Check `ls packages/domain/lib/graduations/graduation-contracts.js` exists (if `prepare-runtime.mjs` lists modules explicitly, add the new one there).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/graduations/graduation-contracts.ts packages/domain/package.json packages/domain/src/memberships/subscription-admin-contracts.ts
git commit -m "feat(graduations): stage engine and contracts in the domain"
```

---

### Task 2: Functions — adapter, service, callables

**Files:**
- Modify: `apps/functions/src/levels/level-service.ts:754` (`function storedImportedBaseline` → `export function storedImportedBaseline`)
- Create: `apps/functions/src/graduations/graduation-firestore.ts`
- Create: `apps/functions/src/graduations/graduation-service.ts`
- Create: `apps/functions/src/graduations/graduation-callables.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**
- Consumes: Task 1 exports; `createLevelCatalogStore`, `countedAttendance`, `storedImportedBaseline` (`../levels/level-service.js`); `countedClassInstants` (`../levels/progress-adjustments.js`); `readCanonicalMemberHistoryDocuments` (`../members/member-identity-firestore.js`); `createFirebaseLevelAuthorization` (`../levels/level-authorization.js`); `requireMemberAccountActor` (`../members/member-access-callables.js`); `createFirestoreMemberAccessService` (`../members/member-access-service.js`); `adminNotificationSchema`.
- Produces callables: `listGraduationBoard({}) → GraduationBoard`, `decideGraduation(DecideGraduationInput) → { ok: true }`, `getGraduationNotices({ studentId }) → GraduationNotices`.

Firestore facts used (verified in code): heads `academies/{a}/studentLevelProgress/{studentId}` (`state`, `systemId`, `currentDefinitionKey`, `currentLevelStartedAt`, `importedBaseline`, `lastApprovedPromotionId`); students `academies/{a}/students/{id}` (`fullName`, `active`, `status`); sessions `academies/{a}/sessions` (`startAt` ISO string); bookings `academies/{a}/bookings` (`sessionId`, `studentId`, `status`); promotions `academies/{a}/levelPromotions/{id}` (`toDefinitionKey`, `fromDefinitionKey`, `promotedOn`); new `academies/{a}/graduationReviews/{studentId}__{sessionId}`. Firestore rules end with `match /{document=**} { allow read, write: if false; }`, so `graduationReviews` is already closed to clients — no rules change.

- [ ] **Step 1: Adapter** `graduation-firestore.ts`

```ts
import type { Firestore } from "firebase-admin/firestore";
import type { GraduationReview } from "@bpt-jersey/domain/graduations";
import type { SessionRecord } from "@bpt-jersey/domain/schedule";

import { countedAttendance, storedImportedBaseline } from "../levels/level-service.js";
import { countedClassInstants, type CountedClass } from "../levels/progress-adjustments.js";
import { readCanonicalMemberHistoryDocuments } from "../members/member-identity-firestore.js";

const dayMs = 86_400_000;
export type Head = Readonly<{
  studentId: string;
  systemId: string;
  currentDefinitionKey: string;
  currentLevelStartedAt: string;
  importedBaseline: ReturnType<typeof storedImportedBaseline>;
  lastApprovedPromotionId: string | null;
}>;
export type StudentName = Readonly<{ fullName: string; active: boolean }>;

export function createGraduationFirestore(db: Firestore, academyId: string) {
  const base = `academies/${academyId}`;
  const headOf = (id: string, data: Record<string, unknown>): Head | null =>
    data.state === "initialized" &&
    typeof data.currentDefinitionKey === "string" &&
    typeof data.currentLevelStartedAt === "string"
      ? {
          studentId: id,
          systemId: String(data.systemId ?? ""),
          currentDefinitionKey: data.currentDefinitionKey,
          currentLevelStartedAt: data.currentLevelStartedAt,
          importedBaseline: storedImportedBaseline(data.importedBaseline),
          lastApprovedPromotionId:
            typeof data.lastApprovedPromotionId === "string" ? data.lastApprovedPromotionId : null,
        }
      : null;
  return {
    async heads(studentId?: string): Promise<Head[]> {
      if (studentId !== undefined) {
        const doc = await db.doc(`${base}/studentLevelProgress/${studentId}`).get();
        const head = doc.exists ? headOf(doc.id, doc.data()!) : null;
        return head ? [head] : [];
      }
      const snap = await db.collection(`${base}/studentLevelProgress`).get();
      return snap.docs.flatMap((doc) => headOf(doc.id, doc.data()) ?? []);
    },
    async students(ids: readonly string[]): Promise<Map<string, StudentName>> {
      const out = new Map<string, StudentName>();
      for (let i = 0; i < ids.length; i += 300) {
        const refs = ids.slice(i, i + 300).map((id) => db.doc(`${base}/students/${id}`));
        for (const doc of refs.length ? await db.getAll(...refs) : []) {
          const data = doc.data();
          if (!data) continue;
          out.set(doc.id, {
            fullName: String(data.fullName ?? "").trim(),
            active: data.active === true && data.status === "active",
          });
        }
      }
      return out;
    },
    /** Window used by the engine: 56 days back (habit) to 21 days ahead (next likely class). */
    async sessions(now: string): Promise<SessionRecord[]> {
      const from = new Date(Date.parse(now) - 56 * dayMs).toISOString();
      const to = new Date(Date.parse(now) + 21 * dayMs).toISOString();
      const snap = await db
        .collection(`${base}/sessions`)
        .where("startAt", ">=", from)
        .where("startAt", "<=", to)
        .get();
      return snap.docs.map((doc) => ({ ...doc.data(), sessionId: doc.id }) as SessionRecord);
    },
    async session(sessionId: string): Promise<SessionRecord | null> {
      const doc = await db.doc(`${base}/sessions/${sessionId}`).get();
      return doc.exists ? ({ ...doc.data(), sessionId: doc.id } as SessionRecord) : null;
    },
    /** studentId → confirmed booking session ids, among the given sessions. */
    async bookings(sessionIds: readonly string[]): Promise<Map<string, Set<string>>> {
      const out = new Map<string, Set<string>>();
      for (let i = 0; i < sessionIds.length; i += 30) {
        const chunk = sessionIds.slice(i, i + 30);
        if (chunk.length === 0) continue;
        const snap = await db.collection(`${base}/bookings`).where("sessionId", "in", chunk).get();
        for (const doc of snap.docs) {
          const data = doc.data();
          if (data.status !== "confirmed" || typeof data.studentId !== "string") continue;
          const set = out.get(data.studentId) ?? new Set<string>();
          set.add(String(data.sessionId));
          out.set(data.studentId, set);
        }
      }
      return out;
    },
    /** The same counting rule as the progress bars (spec §A). */
    async counted(studentId: string): Promise<CountedClass[]> {
      const snapshot = await readCanonicalMemberHistoryDocuments(db, academyId, studentId, "attendance", 5000);
      return countedClassInstants(
        db,
        academyId,
        studentId,
        countedAttendance(snapshot as never, academyId, studentId, snapshot.ids),
      );
    },
    async reviews(studentId?: string): Promise<Map<string, GraduationReview[]>> {
      const collection = db.collection(`${base}/graduationReviews`);
      const snap = await (studentId ? collection.where("studentId", "==", studentId) : collection).get();
      const out = new Map<string, GraduationReview[]>();
      for (const doc of snap.docs) {
        const d = doc.data();
        const list = out.get(String(d.studentId)) ?? [];
        list.push({
          sessionId: String(d.sessionId),
          definitionKey: String(d.definitionKey),
          decidedAt: String(d.decidedAt),
          note: typeof d.note === "string" ? d.note : null,
        });
        out.set(String(d.studentId), list);
      }
      return out;
    },
    async writeNotYet(input: {
      studentId: string;
      sessionId: string;
      definitionKey: string;
      note: string | null;
      decidedBy: string;
      decidedAt: string;
    }): Promise<void> {
      await db
        .doc(`${base}/graduationReviews/${input.studentId}__${input.sessionId}`)
        .create({ academyId, decision: "not-yet", ...input });
    },
    async latestPromotion(promotionId: string): Promise<Record<string, unknown> | null> {
      const doc = await db.doc(`${base}/levelPromotions/${promotionId}`).get();
      return doc.exists ? (doc.data() ?? null) : null;
    },
    async writeLevelNotice(input: { id: string; title: string; message: string; studentId: string; at: string; who: string }) {
      await db.doc(`${base}/adminNotifications/${input.id}`).create({
        notificationId: input.id,
        kind: "level",
        title: input.title,
        message: input.message,
        href: `/admin/members/profile?id=${input.studentId}`,
        createdAt: input.at,
        readAt: null,
        resolvedAt: null,
        membershipId: null,
        studentId: input.studentId,
        endsAt: null,
        details: { from: input.who, amount: null, facts: [] },
      });
    },
  };
}
export type GraduationFirestore = ReturnType<typeof createGraduationFirestore>;
```

Before writing: open `readCanonicalMemberHistoryDocuments` in `apps/functions/src/members/member-identity-firestore.ts` and match its exact parameter order and the limit constant `MAX_LEVEL_RECORDS` used at `level-service.ts:2103` (import and use that constant instead of `5000` if it is exported; otherwise keep the literal with a `ponytail:` comment). Also check `sessionId` is a stored field on session docs; if it is, drop the spread override.

- [ ] **Step 2: Service** `graduation-service.ts`

```ts
import {
  assessGraduation,
  type GraduationAssessment,
  type GraduationBoard,
  type GraduationBoardRow,
  type GraduationNotices,
} from "@bpt-jersey/domain/graduations";
import type { LevelCatalogProjection, LevelDefinitionRecord } from "@bpt-jersey/domain/levels";
import type { SessionRecord } from "@bpt-jersey/domain/schedule";

import type { GraduationFirestore, Head } from "./graduation-firestore.js";

type Catalog = LevelCatalogProjection;
const chip = (d: LevelDefinitionRecord) => ({
  definitionKey: d.definitionKey,
  name: d.name,
  beltColor: d.visual?.primaryColor ?? null, // field name per Task 1 Step 1 check
});

function levels(catalog: Catalog, head: Head) {
  const current = catalog.definitions.find((d) => d.definitionKey === head.currentDefinitionKey);
  if (!current || catalog.system.systemId !== head.systemId) return null;
  const target = catalog.definitions.find((d) => d.sequence === current.sequence + 1) ?? null;
  return { current, target };
}

export async function assessStudent(
  store: GraduationFirestore,
  catalog: Catalog,
  head: Head,
  context: { sessions: SessionRecord[]; booked: Map<string, Set<string>>; reviews: Map<string, import("@bpt-jersey/domain/graduations").GraduationReview[]>; now: string },
): Promise<{ assessment: GraduationAssessment; current: LevelDefinitionRecord; target: LevelDefinitionRecord | null } | null> {
  const pair = levels(catalog, head);
  if (pair === null) return null;
  const assessment = assessGraduation({
    target: pair.target,
    currentLevelStartedAt: head.currentLevelStartedAt,
    importedBaseline: head.importedBaseline,
    counted: await store.counted(head.studentId),
    sessions: context.sessions,
    bookedSessionIds: context.booked.get(head.studentId) ?? new Set(),
    reviews: context.reviews.get(head.studentId) ?? [],
    now: context.now,
  });
  return { assessment, ...pair };
}

async function context(store: GraduationFirestore, now: string, studentId?: string) {
  const sessions = await store.sessions(now);
  const upcomingIds = sessions.filter((s) => s.startAt > now).map((s) => s.sessionId);
  const [booked, reviews] = await Promise.all([store.bookings(upcomingIds), store.reviews(studentId)]);
  return { sessions, booked, reviews, now };
}

/** ponytail: one counted-classes read per student (N reads); fine for one academy of ~100 heads,
 * batch the attendance read if the head count grows past a few hundred. */
export async function buildBoard(
  store: GraduationFirestore,
  catalog: Catalog,
  now: string,
  canDecide: boolean,
): Promise<GraduationBoard> {
  const heads = await store.heads();
  const [names, ctx] = await Promise.all([
    store.students(heads.map((h) => h.studentId)),
    context(store, now),
  ]);
  const titles = new Map(ctx.sessions.map((s) => [s.sessionId, s.title]));
  const rows: GraduationBoardRow[] = [];
  for (const head of heads) {
    const student = names.get(head.studentId);
    if (!student?.active) continue;
    const result = await assessStudent(store, catalog, head, ctx);
    if (!result || result.target === null) continue;
    const { assessment: a, current, target } = result;
    if (a.stage !== "approval" && a.stage !== "today" && a.stage !== "next") continue;
    let graduationClass = null;
    if (a.graduationClass?.sessionId) {
      const title =
        titles.get(a.graduationClass.sessionId) ??
        (await store.session(a.graduationClass.sessionId))?.title ??
        "Class";
      graduationClass = { sessionId: a.graduationClass.sessionId, occurredAt: a.graduationClass.occurredAt, title };
    }
    rows.push({
      studentId: head.studentId,
      fullName: student.fullName,
      stage: a.stage,
      current: chip(current),
      target: chip(target),
      classesDone: a.classesDone,
      minClasses: a.minClasses,
      daysDone: a.daysDone,
      minDays: a.minDays,
      likelyNext: a.likelyNext,
      graduationClass,
      lastNotYetNote: a.lastNotYetNote,
    });
  }
  rows.sort((x, y) =>
    (x.likelyNext?.startAt ?? x.graduationClass?.occurredAt ?? "9").localeCompare(
      y.likelyNext?.startAt ?? y.graduationClass?.occurredAt ?? "9",
    ),
  );
  return { rows, canDecide, generatedAt: now };
}

export async function buildNotices(
  store: GraduationFirestore,
  catalog: Catalog,
  studentId: string,
  now: string,
): Promise<GraduationNotices | null> {
  const [head] = await store.heads(studentId);
  if (!head) return null;
  const [names, ctx] = await Promise.all([store.students([studentId]), context(store, now, studentId)]);
  const result = await assessStudent(store, catalog, head, ctx);
  if (!result) return null;
  const { assessment: a, target } = result;
  let latestPromotion = null;
  if (head.lastApprovedPromotionId) {
    const p = await store.latestPromotion(head.lastApprovedPromotionId);
    const from = catalog.definitions.find((d) => d.definitionKey === p?.fromDefinitionKey);
    const to = catalog.definitions.find((d) => d.definitionKey === p?.toDefinitionKey);
    if (p && from && to && typeof p.promotedOn === "string" && p.decisionStatus !== "rejected") {
      latestPromotion = {
        promotionId: head.lastApprovedPromotionId,
        fromName: from.name,
        toName: to.name,
        toBeltColor: chip(to).beltColor,
        promotedOn: p.promotedOn,
      };
    }
  }
  return {
    firstName: (names.get(studentId)?.fullName ?? "").split(/\s+/u)[0] ?? "",
    stage: a.stage,
    targetName: target?.name ?? null,
    likelyNext: a.likelyNext,
    missedLikely: a.missedLikely,
    lastNotYetNote: a.lastNotYetNote,
    classesLeft: a.minClasses === null ? null : Math.max(0, a.minClasses - a.classesDone),
    latestPromotion,
  };
}
```

Fix the inline `import(...)` type: import `GraduationReview` at the top instead. Check the real `LevelVisual` field and use it in `chip` (or drop `beltColor` everywhere, consistent with Task 1).

- [ ] **Step 3: Callables** `graduation-callables.ts`

```ts
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { assessGraduation, decideGraduationInputSchema, graduationBoardSchema, graduationNoticesSchema } from "@bpt-jersey/domain/graduations";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { createFirebaseLevelAuthorization } from "../levels/level-authorization.js";
import { createLevelCatalogStore } from "../levels/level-service.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";
import { createGraduationFirestore } from "./graduation-firestore.js";
import { assessStudent, buildBoard, buildNotices } from "./graduation-service.js";

const options = { enforceAppCheck: true } as const;
const store = () => createLevelCatalogStore({ firestore: getFirestore() as never });

/** Spec D7: the board is for the office (owner, administrator). */
export const listGraduationBoard = onCall(options, async (request) => {
  const actor = await createFirebaseLevelAuthorization().requireActor(request);
  if (actor.role !== "owner" && actor.role !== "administrator")
    throw new HttpsError("permission-denied", "The office reviews graduations.");
  const now = new Date().toISOString();
  const catalog = await store().listPublished(actor.academyId);
  const board = await buildBoard(createGraduationFirestore(getFirestore(), actor.academyId), catalog, now, actor.role === "owner");
  return graduationBoardSchema.parse(board);
});

/** Spec D8: only the owner decides. Re-assessed here, so a stale board cannot promote twice. */
export const decideGraduation = onCall(options, async (request) => {
  const actor = await createFirebaseLevelAuthorization().requireActor(request);
  if (actor.role !== "owner") throw new HttpsError("permission-denied", "Only the owner decides graduations.");
  const parsed = decideGraduationInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid graduation decision.");
  const input = parsed.data;
  const now = new Date().toISOString();
  const levels = store();
  const catalog = await levels.listPublished(actor.academyId);
  const db = createGraduationFirestore(getFirestore(), actor.academyId);
  const [head] = await db.heads(input.studentId);
  if (!head) throw new HttpsError("failed-precondition", "This graduation is no longer pending.");
  const sessions = await db.sessions(now);
  const reviews = await db.reviews(input.studentId);
  const result = await assessStudent(db, catalog, head, { sessions, booked: new Map(), reviews, now });
  const pending = result?.assessment.graduationClass;
  if (!result || result.target === null || result.assessment.stage !== "approval" || pending?.sessionId !== input.sessionId)
    throw new HttpsError("failed-precondition", "This graduation is no longer pending.");
  if (input.decision === "not-yet") {
    await db.writeNotYet({
      studentId: input.studentId,
      sessionId: input.sessionId,
      definitionKey: result.target.definitionKey,
      note: input.note ?? null,
      decidedBy: actor.userId,
      decidedAt: now,
    });
    return { ok: true };
  }
  const promotedOn = pending.occurredAt.slice(0, 10);
  await levels.assignLevel({
    academyId: actor.academyId,
    input: {
      studentId: input.studentId,
      fromDefinitionKey: result.current.definitionKey,
      toDefinitionKey: result.target.definitionKey,
      promotedOn,
      ...(input.note ? { note: input.note } : {}),
    },
    decidedBy: actor.userId,
    decidedByStaffId: null,
    decidedByRole: "owner",
  });
  const names = await db.students([input.studentId]);
  const name = names.get(input.studentId)?.fullName || "A member";
  await db.writeLevelNotice({
    id: `level-${input.studentId}-${result.target.definitionKey}-${promotedOn}`.slice(0, 380),
    title: `${name} reached ${result.target.name}`,
    message: `Promoted from ${result.current.name} to ${result.target.name} on ${promotedOn}.`,
    studentId: input.studentId,
    at: now,
    who: name,
  }).catch(() => undefined); // the promotion is the record; a lost notice is not worth failing it
  return { ok: true };
});

const noticesRequest = z.strictObject({ studentId: z.string().min(1).max(128) });

/** The member's own (or a linked child's) graduation notices; never another member's data. */
export const getGraduationNotices = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireMemberAccountActor(request);
  const parsed = noticesRequest.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const access = await createFirestoreMemberAccessService().authorise(actor.academyId, actor.userId, parsed.data.studentId);
  if (!access.allowed) throw new HttpsError("permission-denied", "This member is not available to your account.");
  const catalog = await store().listPublished(actor.academyId);
  const notices = await buildNotices(createGraduationFirestore(getFirestore(), actor.academyId), catalog, parsed.data.studentId, new Date().toISOString());
  return notices === null ? null : graduationNoticesSchema.parse(notices);
});
```

Checks while writing: (a) the region — open `apps/functions/src/index.ts` and confirm how europe-west9 is set (global `setGlobalOptions` or per-callable); follow it. (b) `assignLevel` errors are `LevelStoreError`; wrap the promote call in `try/catch` and map to `HttpsError("failed-precondition", "This graduation is no longer pending.")` for `conflict`/`invalid`, rethrow otherwise. (c) Remove the unused `assessGraduation` import. (d) `AuthorizedLevelActor.role` values — confirm `"owner"`/`"administrator"` spelling in `UserActorContext`. (e) the notification id must match `adminNotificationSchema`'s `id` regex — read it in `subscription-admin-contracts.ts`; if definition keys contain characters it refuses, hash the id like `admin-notification-triggers.ts:164`.

- [ ] **Step 4: Export** — in `apps/functions/src/index.ts`, next to the level callables:

```ts
export {
  decideGraduation,
  getGraduationNotices,
  listGraduationBoard,
} from "./graduations/graduation-callables.js";
```

- [ ] **Step 5: Compile**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/functions build`
Expected: exits 0, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/graduations apps/functions/src/index.ts apps/functions/src/levels/level-service.ts
git commit -m "feat(graduations): board, owner decision and member notice callables"
```

---

### Task 3: Catalogue aligned with the PDF (plan/apply CLI)

**Files:**
- Create: `apps/functions/src/levels/level-catalog-pdf-alignment.ts`
- Create: `apps/functions/scripts/align-level-catalog-pdf.mjs`

**Interfaces:**
- Consumes: `catalogueContentHash`, `levelCatalogAuditDraft` (`./level-editor-service.js`), `hashLevelCatalogValue` (`./level-catalog-integrity.js`), `appendAuditEventInTransaction` — same imports as `level-catalog-adoption.ts`.
- Produces: `planPdfAlignment(firestore, { academyId, generatedAt }) → AlignmentPlan`, `expectedAlignmentConfirmation(plan) → string`, `applyPdfAlignment(firestore, plan, { actorId, confirmation }) → { updated, deleted, movedHeads }`.

Changes (spec §3), matched by definition `name` in the active system (`levelCatalogState/active.activeSystemId`):

| Match | Change |
|---|---|
| stripes whose parent belt name contains `7-8 and 8-10` and `stripeNumber` 7 or 8 | delete (definition + its `levelRequirements`) |
| belt `WHITE BELT TEENS 10-12 AND 13-15 YO` (case-insensitive) | `minClasses 6`, `minimumTime {years:0, months:1, days:15}` |
| belt `WHITE BELT` (exact) | `minClasses 20`, `minimumTime {years:0, months:2, days:0}` |
| stripes of `WHITE BELT` with `stripeNumber` 2, 3, 4 | `minClasses 25`, `minimumTime {years:0, months:3, days:0}` |

`minimumDaysOf` = years·365 + months·30 + days, so 45 days = 1 month 15 days, 60 = 2 months, 90 = 3 months. Before writing, read one stored definition's `criteria.minimumTime` and use the same shape (if stored as days, write days).

- [ ] **Step 1: Write `planPdfAlignment`** — read state, definitions (`levelDefinitions` where `systemId ==`), requirements, heads, and `levelPromotions`. Build:
  - `deletes`: definition doc paths + requirement doc paths for removed stripes.
  - `blockers`: promotions whose `fromDefinitionKey` or `toDefinitionKey` is a removed key → if non-empty the plan status is `"blocked"` and apply refuses.
  - `headMoves`: heads on a removed stripe → `currentDefinitionKey` = stripe 6 of the same belt (keep `currentLevelStartedAt`).
  - `updates`: changed criteria (above) plus `sequence` renumbered `1..n` in current order after removals, for every definition whose sequence changes.
  - `system`: the system doc with `counts` recomputed (`definitions`, `belts`, `stripes`), `updatedAt = generatedAt`, and `contentHash`/`sourceHash` from `catalogueContentHash(systemId, system, definitions, requirements)` over the final state.
  - `summary` lines for the operator: each criteria change `name: a/b → c/d`, removed stripe names, moved heads (studentId only), blockers.

- [ ] **Step 2: Write `expectedAlignmentConfirmation`** — `ALIGN-${academyId}-${systemId}-${hashLevelCatalogValue({ contentHash, headMoves, deletes }).slice(0,12)}`.

- [ ] **Step 3: Write `applyPdfAlignment`** — refuse unless confirmation matches and status is `"ready"`; re-read `system.updatedAt` and refuse if it changed since the plan (`"The belt catalogue changed since the dry run."`); then in batches of 400: head moves, definition updates, deletes, system doc; finally one audit event (`levelCatalogAuditDraft`, action `level.catalog.saved`, purpose `"pdf-alignment"`).

- [ ] **Step 4: CLI** — copy `apps/functions/scripts/adopt-level-catalog.mjs`, rename the module path to `level-catalog-pdf-alignment.js`, the production confirmation to `LEVELS-PDF-ALIGN-PRODUCTION-APPLY`, print `plan.summary` and the confirmation in dry-run, call apply with `--apply --confirmation=… --actor-id=…`.

- [ ] **Step 5: Compile** — `corepack pnpm --filter @bpt-jersey/functions build` exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/levels/level-catalog-pdf-alignment.ts apps/functions/scripts/align-level-catalog-pdf.mjs
git commit -m "feat(levels): one-off CLI aligns the catalogue with the academy rules PDF"
```

(Running it against production is Task 7, with operator confirmation.)

---

### Task 4: Web client

**Files:**
- Create: `apps/web/src/lib/graduations-client.ts`

**Interfaces:**
- Produces: `listGraduationBoard(): Promise<GraduationBoard>`, `decideGraduation(input: DecideGraduationInput): Promise<void>`, `getGraduationNotices(studentId: string): Promise<GraduationNotices | null>`, `graduationErrorMessage(error: unknown): string`.

- [ ] **Step 1: Write the client**

```ts
import { z } from "zod";
import {
  graduationBoardSchema,
  graduationNoticesSchema,
  type DecideGraduationInput,
  type GraduationBoard,
  type GraduationNotices,
} from "@bpt-jersey/domain/graduations";

import { httpsCallable } from "./callable";
import { getFirebaseFunctions } from "./firebase-client";

const pendingGone = "This graduation is no longer pending. The list has been refreshed.";
const generic = "Graduations are unavailable right now. Try again in a moment.";

export function graduationErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? "";
  if (code.endsWith("failed-precondition")) return pendingGone;
  if (code.endsWith("permission-denied")) return "Only the owner can decide graduations.";
  return generic;
}

async function call<T>(name: string, data: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(data);
  return schema.parse(response.data);
}

export const listGraduationBoard = (): Promise<GraduationBoard> =>
  call("listGraduationBoard", {}, graduationBoardSchema);
export const decideGraduation = async (input: DecideGraduationInput): Promise<void> => {
  await call("decideGraduation", input, z.strictObject({ ok: z.literal(true) }));
};
export const getGraduationNotices = (studentId: string): Promise<GraduationNotices | null> =>
  call("getGraduationNotices", { studentId }, graduationNoticesSchema.nullable());
```

Check `apps/web/src/lib/callable.ts` signature matches `streak-client.ts` usage (it does there).

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/graduations-client.ts
git commit -m "feat(graduations): web client"
```

---

### Task 5: Admin Graduations page and nav

**Files:**
- Create: `apps/web/src/app/admin/graduations/page.tsx`
- Create: `apps/web/src/app/admin/graduations/graduations.css`
- Modify: `apps/web/src/app/admin/admin-shell.tsx:30-34`

Apply skills: `frontend-design`, `impeccable`, `accessibility`; follow `DESIGN.md` and reuse `AdminSectionHeader`, `AdminStatusBadge`, `admin-auth-button`, `ConfirmDialog` (import path as used in `members/profile/manage-view.tsx`).

- [ ] **Step 1: Nav** — in `navigationGroups[0].items`:

```ts
      { label: "Overview", href: "/admin" },
      { label: "Graduations", href: "/admin/graduations", officeOnly: true },
      { label: "Attendance", href: "/admin/attendance" },
```

Add `officeOnly?: boolean` to `NavigationItem` and, in the filter at `admin-shell.tsx:~136` (`(!item.ownerOnly || session.role === "owner")`), add `&& (!item.officeOnly || session.role === "owner" || session.role === "administrator")`. Do NOT add the path to `coachRoutes` — `isStaffRouteAllowed` then keeps coaches out. If `AdminIcon` needs an icon per href, map `/admin/graduations` to the same icon as `/admin/levels`.

- [ ] **Step 2: Page** — `"use client"`; state `loading | ready(board) | error`; load with `listGraduationBoard()`; three `<section>`s with `<h2>` and a count:

```tsx
const sections = [
  { stage: "next", title: "Next graduation", empty: "Nobody is one class away yet." },
  { stage: "today", title: "Today's graduations", empty: "No graduation classes today." },
  { stage: "approval", title: "Graduation approval", empty: "Nothing waiting for a decision." },
] as const;
```

Each row (a list item, not a table, so it reads well on a phone):
- name; `current.name → target.name`;
- `Classes {classesDone}/{minClasses ?? "—"} · Days {daysDone}/{minDays ?? "—"}`;
- next/today: `Likely next class: {weekday d MMM, HH:mm} {title}` via `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Jersey", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })`, or `Next class not predicted`;
- approval: `Graduation class: {date} {title}`; if `lastNotYetNote`, `Last note: …`;
- approval + `board.canDecide`: buttons **Promote** (primary) and **Not yet** (secondary). Otherwise a muted `Owner decides`.

Promote → `ConfirmDialog` "Promote {name} to {target.name}? Dated {graduation day}." → `decideGraduation({ studentId, sessionId, decision: "promote" })`.
Not yet → inline form: `<label>What to work on (the member will see this)<textarea maxLength={280}/></label>` + confirm → `decideGraduation({ …, decision: "not-yet", note: trimmed || undefined })`.
One request in flight (`useRef` flag, like `manage-view.tsx`); on success reload the board and show `role="status"` "Promoted." / "Saved — back to Next graduation."; on failure show `graduationErrorMessage(error)` with `role="alert"` and reload.

- [ ] **Step 3: CSS** — `graduations.css` with the admin tokens already used in `admin.css`; rows as cards with 16px gap; buttons ≥44px tall; stack on <640px.

- [ ] **Step 4: Build** — `corepack pnpm --filter @bpt-jersey/web build` exits 0 (Cloudflare builds the same on push).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/graduations apps/web/src/app/admin/admin-shell.tsx
git commit -m "feat(graduations): office board with owner Promote and Not yet"
```

---

### Task 6: Member notices, celebration, techniques hidden

**Files:**
- Create: `apps/web/src/app/account/graduation/graduation-notices.tsx`
- Create: `apps/web/src/app/account/graduation/graduation.css`
- Modify: `apps/web/src/app/account/page.tsx:58-63`
- Modify: `apps/web/src/app/account/progress/member-progress.tsx:282-310`

Apply skills: `frontend-design`, `impeccable`, `antislop-copywriting`, `accessibility`.

- [ ] **Step 1: Component** — `GraduationNotices({ studentId })`: loads `getGraduationNotices(studentId)`; renders nothing on error/null (like `StreakPanel`). Copy (D11: when the account holder is a guardian looking at a child, prefix with the child's first name — the component receives `firstName` from the callable; show it when the selected participant is not the signed-in member; simplest rule: always show `{firstName}:` as the card eyebrow).

| Condition | Card |
|---|---|
| `stage === "twoLeft"` | eyebrow "Graduation"; title "Only 2 classes to {targetName}"; two class marks that pulse |
| `stage === "next"` or `"today"` | title "Your next class could be a graduation"; body `{date of likelyNext}` or "Keep training — your next class can count"; ribbon shimmer on the belt chip |
| same + `missedLikely` | body "We missed you — {targetName} is still one class away. Next: {date}" |
| `stage === "approval"` | title "Graduation class done"; body "The owner will confirm soon." ; calm pulse |
| `lastNotYetNote` and stage ≠ approval | small card "Keep going" + the note (no celebration motion) |

Celebration: if `latestPromotion` and `localStorage["bpt.graduation.seen.{studentId}.{promotionId}"]` is not set (read/write in try/catch; if storage throws, show once per page view via `useRef`), show a modal `role="dialog" aria-modal="true" aria-labelledby` with the new belt colour bar sliding in, "New level: {toName}", "From {fromName} · {promotedOn}", two bars (Classes, Time) animating from full to empty, and a **Continue** button that sets the key and closes. Focus moves to Continue on open; Escape closes.

- [ ] **Step 2: CSS keyframes** in `graduation.css`: `grad-pulse` (scale 1→1.06, 1.6s infinite), `grad-shimmer` (background-position sweep 2.4s), `grad-belt-in` (translateX(-100%)→0, 600ms ease-out), `grad-bar-reset` (width 100%→0 over 900ms then a 120ms bounce). Wrap all in `@media (prefers-reduced-motion: no-preference)`; outside it, no animation.

- [ ] **Step 3: Mount** — in `account/page.tsx` `topSlot`, after `<StreakPanel …/>`:

```tsx
                <GraduationNotices key={`grad-${studentId}`} studentId={studentId} />
```

- [ ] **Step 4: Hide techniques from members (D6)** — in `member-progress.tsx` delete the `<section className="rank-card" aria-labelledby="rank-techniques-title">…</section>` block (lines ~282-310), then delete what only it used: `labels`, `beltSkills`, `stripeSkills` in the `useMemo`, the `Techniques` component and `skillsOf`; change the muted copy at line ~276 to "Classes count from your last promotion. Time at the level also matters: the owner makes every graduation decision."

- [ ] **Step 5: Build** — `corepack pnpm --filter @bpt-jersey/web build` exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/account/graduation apps/web/src/app/account/page.tsx apps/web/src/app/account/progress/member-progress.tsx
git commit -m "feat(graduations): member notices, new-level celebration, techniques hidden"
```

---

### Task 7: Review, deliver, deploy (operator confirmation)

- [ ] **Step 1: Review** — `/code-review` (high: member data + permissions) over `git diff 818fe4c..HEAD`; fix findings.
- [ ] **Step 2: Push** — `git fetch origin && git rebase origin/main` (no force) then `git push origin main`; confirm `git rev-parse HEAD` = `git rev-parse origin/main`.
- [ ] **Step 3: Deploy functions** (ask operator first): `npx -y firebase-tools@latest deploy --only functions:listGraduationBoard,functions:decideGraduation,functions:getGraduationNotices --force`. Expected `✔ Deploy complete!`. If CPU quota error, wait 2 min and retry.
- [ ] **Step 4: Catalogue dry-run** (ask operator first — production read): `node apps/functions/scripts/align-level-catalog-pdf.mjs --target=production --academy-id=demo-academy`. Show the summary to the operator; if `blocked`, stop and ask.
- [ ] **Step 5: Catalogue apply** (explicit confirmation): same command with `--apply --confirmation=<printed> --target-confirmation=LEVELS-PDF-ALIGN-PRODUCTION-APPLY --actor-id=<owner uid>`.
- [ ] **Step 6: Verify** — open `/admin/graduations` as owner: three sections load; `/account` for a member in `next` shows the card; `/admin/levels` shows Kids 7-10 with 6 stripes and the new White/Teens criteria.
- [ ] **Step 7: Memory** — write `project-bpt-jersey-graduations.md` + `MEMORY.md` line.
