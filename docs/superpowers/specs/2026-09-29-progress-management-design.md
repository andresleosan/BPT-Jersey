# Progress Management — design

Date: 2026-09-29 · Owner request (Luis) · Status: approved in chat, pending spec review

## Goal

Give the owner one place in `/admin/members` to set a member's belt/stripe progress exactly as the
academy sees it: current level and its start date, classes at the current level, and the attendance
dates behind the streak. Also: **Open Mat never counts as a class** for belt progress, streak or the
Competitors ranking.

## Decisions (traceable)

| # | Decision | Who / where |
|---|---|---|
| D1 | Owner-only. Administrator, headCoach and coaches do not see the tab nor can call the new functions. | Luis, question round 1 |
| D2 | Editing = attendance history (add/remove dates) + manual class count. | Luis, round 1 |
| D3 | Open Mat does not count, retroactively (recomputed on read, past open mats stop counting). | Luis, round 1 |
| D4 | Lives in a new tab "Progress management" inside `/admin/members` (next to All / Families / Review) with its own member search. | Luis, round 2 |
| D5 | An added attendance is a free date (no class chosen). It always counts as a class (never Open Mat). | Luis, round 2 |
| D6 | Removing an attendance voids it (optional reason), kept for audit, restorable. Never deleted. | Luis, round 2 (reason made optional in D10) |
| D7 | Open Mat exclusion also applies to the Competitors ranking (attendances + streak). | Luis, round 2 |
| D8 | Owner can set any level (up or down) and its start date; stored in level history and undoable. | Luis, round 3 |
| D9 | Class count: the owner picks how many classes the member has at the current belt/stripe; the screen shows the `/levels` requirement for the next level ("32 of 40 classes for Stripe 3"). | Luis, round 3 (own words) |
| D10 | Free-date attendances count for belt, streak and season ranking. | Luis, round 3 |
| D11 | Reason is optional on every change. | Luis, round 3 |
| D12 | The count set by the owner is the total up to today; counted attendances from tomorrow add on top. Changing the level resets the count to 0 unless a count is set in the same save. | Claude, approved design (§B.3) |
| D13 | A past date added AFTER setting the count does not change the count (already inside it) but does count for streak/ranking; the UI says so. | Claude, approved design (§D) |
| D14 | No migration: Open Mat is resolved on read via attendance → session → program. | Claude, approved design (§A) |
| D15 | No automated tests (repo rule); verification in production with a member Luis picks; functions deploy only with Luis's OK. | AGENTS.md + approved design (§E) |

## Current state (facts from code, 2026-09-29)

- Attendance: `academies/{a}/attendance/{sessionId__studentId}`; no `programId` and no session date on
  the record; `occurredAt` = check-in instant. Counted = `attended|late`, not a correction, no
  `courseId`, deduped by session (`countedAttendance`, `apps/functions/src/levels/level-service.ts:1245`).
- Belt head: `academies/{a}/studentLevelProgress/{studentId}` (`currentDefinitionKey`,
  `currentLevelStartedAt`, `importedBaseline{classes,cutoff,source}`). Class count =
  `countClassesAtLevel` (`packages/domain/src/levels/level-progress.ts:69`). Next-level requirement =
  `criteria.minClasses` / `minimumTime` of the target definition.
- Streak `streak/streak-service.ts` and leaderboard `competitors/public-card.ts` use the same
  `countedAttendance` + `sessionStreak`. None filter Open Mat.
- Open Mat test: `isOpenMatProgram` (`packages/domain/src/schedule/self-check-in-contracts.ts:23`).
- `assignLevel` only moves forward; nothing edits the start date, sets the baseline, adds a past
  attendance or removes one. All these collections are callable-only in `firestore.rules`.

## Design

### A. Counting rule (one shared place)

`countedAttendance` gains two exclusions: voided records (`progressVoid` set) and Open Mat sessions.
Open Mat lookup: collect unique `sessionId`s → `getAll` sessions → unique `programId`s → `getAll`
programs (cached per call) → `isOpenMatProgram`. A session/program that cannot be read counts as a
class (fail open for the member, same as booking's "missing program counts as a class").
Manual attendances (§C) are merged into the counted list. Every consumer (level card, Manage,
member progress, streak, leaderboard) goes through this one path.

### B. UI — tab "Progress management" (`/admin/members?view=progress`, ownerOnly)

1. Member search (reuse the existing members search).
2. **Current level**: belt/stripe select (any level of the published catalogue) + start date.
   Below: "N days at this level of M required for <next level>".
3. **Classes at this level**: number input + meter "X of N classes for <next level>" (N from `/levels`
   `minClasses`; no meter when the level has no minimum).
4. **Attendance** list (current level by default, toggle "this season"): date, source
   (class name / "Added by owner"), Open Mat tagged "doesn't count", voided shown struck with Restore.
   Actions: Remove (optional reason), Add date (date input, optional reason).
5. **Change history**: who, when, what, reason.
One Save for level + start date + class count; attendance actions apply immediately.

### C. Data

- New `academies/{a}/memberManualAttendance/{id}`: `studentId, date (YYYY-MM-DD), reason|null,
  createdBy, createdAt, progressVoid|null`. Counted as a class on that date (noon Europe/Jersey).
- Void on a real attendance: field `progressVoid: {at, by, reason|null}` on the attendance doc;
  restore sets it to `null`. Same field on manual attendances.
- Class count: written to the head's `importedBaseline` with `source: "owner-set"`,
  `classes = X`, `cutoff = tomorrow (Jersey)`. Schema widened to accept the new source.
- Level + start date: new promotion kind in `levelPromotions` (with `restore` snapshot) so the
  existing `voidPromotion` undoes it; head updated (`currentDefinitionKey`, `currentLevelStartedAt`).
- Every action writes an `auditEvents` entry (`progress.level.set`, `progress.classes.set`,
  `progress.attendance.added|voided|restored`).
- Firestore rules: unchanged (catch-all already denies client access).

### D. Backend (europe-west9, owner-only: `actor.role !== "owner"` → permission-denied)

- `getProgressManagement({studentId})` → head, catalogue level + next requirement, counts, attendance
  list (real + manual, with openMat/void flags), history.
- `setProgressLevel({studentId, definitionKey, startedOn, classes?, reason?})`.
- `setProgressClassCount({studentId, classes, reason?})`.
- `addManualAttendance({studentId, date, reason?})` — date not in the future.
- `setAttendanceVoid({studentId, kind: "attendance"|"manual", id, voided, reason?})`.
Layering: contracts in `packages/domain/src/levels/progress-management-contracts.ts` → service +
Firestore adapter in `apps/functions/src/levels/` → callables exported in `index.ts` →
`apps/web/src/lib/progress-management-client.ts` → UI.

### E. Delivery

Web via push to `main` (Cloudflare Pages). Functions to deploy after Luis confirms: the five new
callables + those that read counted attendance (level summary/card/history/manage, streak,
competitors). No tests (D15). Verify in production on a member Luis picks: Open Mat excluded, count
edit, add/void/restore a date, level + date change and undo.

## Out of scope

Coach/administrator access; bulk edits; editing skills scores (already in Manage); changing how
bookings count Open Mat (already excluded from weekly limits).
