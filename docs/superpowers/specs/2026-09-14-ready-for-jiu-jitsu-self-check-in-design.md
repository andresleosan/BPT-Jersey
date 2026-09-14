# Ready for Jiu Jitsu — member self check-in (`/account`) — design spec

Date: 2026-09-14 · Status: spec reviewed and grilled 2026-09-15 (decisions 14–20) · Path: architectural ·
Ledger row to open: **T040V2** (T032V2–T039V2 are reserved by the 2026-09-14 classes plan)

## 1. Goal

A member with a booked session starting within the hour sees, at the very top of `/account`, a big
slider reading **READY / FOR JIU JITSU**. Sliding it to the end clocks the member in, but only when the
server has confirmed the phone is within 50 m of the session's site. The check-in records punctuality
(`attended` before the start, `late` after). A guardian does the same for the child selected in the
calendar.

Source requirement (operator, 2026-09-14): *"Clock in for sessions: through a big button slider that
says for the members 'Ready for Jiu Jitsu' (in two lines and massive font black bold). Members can only
clock in when they are less than 50 metres from the gym; this clock in needs to record the punctuality.
This button only appears when they have their next session in 1 hour. Should appear on the very top of
the whole page of /account."* Visual reference: `Assets/ReadyForJiuJitsu.png` (Lifesum slider).

Out of scope: the coach-side check-in screen (another team is building it on the existing staff
`checkIn`), QR/PIN check-in, teen account creation (T009V2), check-out, no-show penalties.

## 2. Decisions (traceable)

| # | Decision | Chosen | Why |
|---|----------|--------|-----|
| 1 | What happens outside 50 m or with no usable reading | **Hard gate** for self check-in: refused. Staff check-in keeps BRIEF decision 5 unchanged (signal + reasoned override) | Operator: "can only clock in when less than 50 m" |
| 2 | Who decides the distance | **Server computes** from latitude/longitude/accuracy sent over HTTPS; coordinates are used in memory and discarded, only distance and accuracy are stored | A distance number in the request is trivially forged; web GPS can still be faked, accepted as residual risk |
| 3 | Time window | Opens **60 min before** start, closes **20 min after** start, judged on server time | Matches T015V2 (place lost at +20 min) and lets punctuality record `late` |
| 4 | Who can slide | **adultStudent** and **teenStudent** for themselves; **guardian** for the child selected in the calendar | Covers the new docx under-12 flow and T008V2 |
| 5 | Architecture | **New `selfCheckIn` callable**, separate from staff `checkIn`, reusing the existing check-in transaction, punctuality rule and audit event | Keeps the staff override path and the member hard gate in different handlers |
| 6 | Coach seam | Attendance is the single source of truth. The slider hides when **any** attendance exists for the session, whatever the method. While a window is open the calendar re-reads the week every **60 s** | Operator: leave it connectable for the coach team |
| 7 | Method recorded | New check-in method **`self`** | Roster can tell a self check-in from a coach one |
| 8 | Surface | **Gi White card** on the canvas, above the purple header; purple fill follows the thumb; lime thumb | Chosen from three previews; stays inside DESIGN.md (no large lime surface) |
| 9 | "Massive font black bold" | Barlow Condensed **700** (the heaviest weight loaded), colour **Mat Ink `#1A1A18`**, uppercase, `clamp(3rem, 14vw, 6rem)` | DESIGN.md bans pure black; a heavier weight would add a font file. To confirm in grilling |
| 10 | Control | Native `<input type="range">` styled as the slider. Commit at ≥ 95 %, snap back below | Keyboard and screen reader support without a dependency |
| 11 | Location prompt | Requested **only after the slide commits**, never on page load | Least privilege; the prompt is tied to a user gesture |
| 12 | Refusals | One reason code per refusal, shown as one plain sentence with a red left rule, plus "a coach can check you in" | DESIGN.md: honest, short failure copy |
| 13 | Done means | Domain + server + component tests, Playwright on `:9471` at 390 and 1280 px with real browser geolocation, then the review skills | Operator's requested sequence |
| 14 | Reading precision | Accept readings with accuracy **≤ 100 m**; the distance itself must still be **≤ 50 m** | Fewer refusals at the door (grill, 2026-09-15) |
| 15 | Site coordinates | Town **49.1839542, −2.1071416** (Brazilian Power Team Jersey pin); West **49.2058242, −2.1858174** (Strive Health Club pin). Seeded in the fixture; in production an admin records them in the existing site geofence panel before rollout | Operator supplied both Google Maps pins (grill) |
| 16 | Already checked in | Show a **confirmation card** ("YOU'RE IN · 17:52 · On time/Late") built from the attendance record, whatever the method, until the window closes; survives reloads | Grill |
| 17 | Typeface weight | Confirmed **700**, Mat Ink; no new font file | Grill |
| 18 | Guardian with two children in window | One slider for the selected child + a hint line naming the other child with an open window ("Leo is ready too — switch to Leo") | One audited record per child (grill) |
| 19 | Where it is built | **Same worktree and branch** (`/root/BPT-Jersey`, `feature/admin-classes-billing-levels`), visible on `:9471`. Another session edits `admin/classes` on this branch: keep this feature in new files, commit small, never touch `admin/*` | Operator's choice (grill) |
| 20 | Open mat window | For programs with `discipline === "open-mat"` the window closes at **`endAt`**, not +20 min | T015V2 excludes open mats from the 20-minute loss (grill) |

Amendments this creates, to be written with the date where they live (not silently):
- **BRIEF decision 5**: add that *member self check-in* is a hard 50 m gate with no override; staff
  check-in is unchanged.
- **`LocationGeofence` doc comment** (`packages/domain/src/schedule/schedule-contracts.ts`): today it
  says "no member coordinate is ever accepted or stored". It becomes "accepted only by `selfCheckIn`,
  used in memory for one distance, never stored or logged".

## 3. Rules (pure, `packages/domain/src/schedule/self-check-in-contracts.ts`)

```ts
export const selfCheckInOpensBeforeStartMs = 60 * 60 * 1000;
export const selfCheckInClosesAfterStartMs = 20 * 60 * 1000;

export const selfCheckInMaxAccuracyMeters = 100;

export function selfCheckInWindow(session: Pick<SessionRecord, "startAt" | "endAt">, isOpenMat: boolean):
  { opensAtMs: number; closesAtMs: number };
// opens = startAt − 60 min; closes = isOpenMat ? endAt : startAt + 20 min
export function isSelfCheckInWindowOpen(session, isOpenMat, nowMs): boolean;  // invalid dates → false
export function selfCheckInWindowLabels(session, isOpenMat): { opens: string; closes: string }; // "17:00" / "18:20", Europe/Jersey

export type SelfCheckInCandidate =
  | { kind: "ready"; session: SessionRecord }
  | { kind: "checkedIn"; session: SessionRecord; attendance: AttendanceRecord };

export function nextSelfCheckInSession(input: {
  sessions: readonly SessionRecord[];
  programs: readonly ProgramRecord[];      // to know open mats
  bookings: readonly BookingRecord[];      // for the selected student
  attendance: readonly AttendanceRecord[]; // for the selected student, any method
  nowMs: number;
}): SelfCheckInCandidate | undefined;
// earliest by startAt where status is not cancelled, a booking with status "confirmed" exists and the
// window is open. With an attendance record (any method) → "checkedIn" (decision 16); otherwise "ready".

export type SelfCheckInPosition = Readonly<{ latitude: number; longitude: number; accuracyMeters: number }>;
export const selfCheckInRefusals = ["window_closed", "site_not_ready", "imprecise", "outside",
  "not_booked", "already_checked_in"] as const;
export type SelfCheckInRefusal = (typeof selfCheckInRefusals)[number];

export function parseSelfCheckInInput(input: unknown):
  Result<{ sessionId: string; studentId: string; position: SelfCheckInPosition }, string>;
// strict object: exactly sessionId, studentId, position; position exactly latitude/longitude/accuracyMeters;
// finite; |lat| <= 90, |lng| <= 180, 0 <= accuracy <= 100_000; identifiers non-empty, trimmed

export function decideSelfCheckIn(input: {
  session: Pick<SessionRecord, "startAt" | "endAt">;
  isOpenMat: boolean;
  site: LocationGeofence | null | undefined;
  position: SelfCheckInPosition;
  nowMs: number;
}): Result<AttendanceProximity /* signal "within", overrideReason null */, SelfCheckInRefusal>;
// order: window_closed → site_not_ready → imprecise (accuracy > 100) → outside (distance > 50)
// distance = Math.round(distanceInMetres(position, site))
```

Punctuality keeps `determinePunctuality(session.startAt, occurredAt)` (threshold 0). `checkInMethods`
gains `"self"`. `not_booked` and `already_checked_in` are decided by the transaction, not by
`decideSelfCheckIn`, because only the transaction reads bookings and attendance consistently.

## 4. Server

**Callable** `selfCheckIn` in `apps/functions/src/schedule/schedule-callables.ts`, exported from
`index.ts`, options `scheduleCallableOptions` (App Check enforced and consumed).

Handler order:
1. `requireUserActor`. Staff roles → `permission-denied` ("Staff check in members from the coach screen").
2. `parseSelfCheckInInput` → `invalid-argument` with a message that never echoes values.
3. Scope: `requireStudentScope`, extended so the canonical resolver accepts `teenStudent`: exactly one
   student profile whose `userId` is the caller, `participantType === "minor"` (profiles only know
   `adult`/`minor`; `teens` exists only on plans), active, and **aged 12 or over today in
   Europe/Jersey** from `dateOfBirth` (the D1/T009V2 floor). `adultStudent` and `guardian` unchanged.
   Failure → `permission-denied`. Until T009V2 links teen accounts, no teen profile carries a `userId`,
   so this branch refuses everyone, which is the safe default.
4. `store.recordSelfCheckIn(academyId, { sessionId, studentId, position }, actorId, actorRole)`.
5. Map errors: refusal → `failed-precondition` with `details: { reason }`; unexpected → `internal` via
   the existing honest mapping, logging the error only (never `request.data`).

**Transaction** (`apps/functions/src/schedule/attendance-transaction-service.ts`), new method
`recordSelfCheckIn`, sharing helpers with `recordCheckIn`:
- Allowed actor roles: `adultStudent`, `teenStudent`, `guardian`; anything else → `credential`.
- Reads in one transaction: session, student, confirmed booking, existing attendance, audit doc,
  session location, and the session's program (for `discipline === "open-mat"`, the same derivation
  `booking-transaction-service.ts` already does).
- `requireSession` (not cancelled), `requireStudent`; no confirmed booking → refusal `not_booked`.
- Existing attendance: same `createdBy` and method `self` → return it (replay); otherwise refusal
  `already_checked_in` (this is how a coach check-in wins).
- `decideSelfCheckIn` with the location's geofence and server `now`; refusal → `failed-precondition`.
- Write `AttendanceRecord` with `method: "self"`, `state: determinePunctuality(startAt, now)`,
  `proximity: { signal: "within", distanceMeters, accuracyMeters, overrideReason: null }`, and the
  `attendance.checked_in` audit event with the member as actor. Ids stay deterministic
  (`${sessionId}__${studentId}`), so a coach and a member can never create two records.
- The `position` object is never spread into the record, the audit draft, or any error.

Staff `checkIn` is untouched; its existing `method !== "manual"` guard already refuses `"self"`.

## 5. Web

**Repository port** (`apps/web/src/lib/calendar/calendar-repository.ts`):

```ts
clockIn(input: { sessionId: string; studentId: string; position: SelfCheckInPosition }): Promise<AttendanceRecord>;
```

- **firebase**: `httpsCallable("selfCheckIn")`; errors keep `details.reason` so the UI can map it.
  Marked unverified until the emulator run in §7 passes.
- **fixture**: sites get the real coordinates from decision 15; `clockIn` applies
  `decideSelfCheckIn` with real `Date.now()`, requires a confirmed booking, rejects a second record,
  and appends the attendance so the UI round-trips. Seed one confirmed booking starting 30 min from
  load for each participant so the slider is visible on the workbench.

**Position helper** (`apps/web/src/lib/self-check-in-position.ts`): wraps
`navigator.geolocation.getCurrentPosition` (`enableHighAccuracy: true`, `timeout: 10000`,
`maximumAge: 0`) and returns `{ status: "ok", position } | { status: "denied" | "unavailable" }`.
Coordinates exist only in this call and the request body.

**Component** `apps/web/src/app/account/calendar/ready-for-jiu-jitsu.tsx`, rendered first inside
`<main className="member-app">`, before `<CalendarHeader>`. Input: the session from
`nextSelfCheckInSession`, the selected participant, the repository, `onCheckedIn(attendance)`.

| State | What shows |
|---|---|
| idle | Card: READY / FOR JIU JITSU; range track with purple fill and lime thumb; "Teens BJJ · 18:00 · Town"; "Opens 17:00 · closes 18:20" |
| locating | Thumb held at end; "Checking you're at the gym…" (no spinner) |
| sending | Same, input disabled |
| done | "YOU'RE IN" / "17:52 · On time" or "17:52 · Late", from the attendance record (own slide or a coach's check-in, decision 16); stays until the window closes |
| sibling hint | Under the card, when the guardian has another child with an open window: "Leo is ready too — switch to Leo" (decision 18) |
| refused | Thumb snaps back; red-rule line with the sentence for the reason; retry allowed |

Refusal sentences: `outside` "You're {n} m away. Get to the gym and try again."; `imprecise` "Your
location isn't precise enough yet. Turn on Precise Location, step near the entrance and try again."; `denied` "Location
is off. Allow it for this site, or ask a coach to check you in."; `site_not_ready` "This gym can't take
self check-ins yet. Ask a coach to check you in."; `window_closed` "Check-in for this class has
closed."; `not_booked` "You need a confirmed booking for this class."; `already_checked_in` "You're
already checked in."; anything else "Couldn't check you in. Try again or ask a coach."

Accessibility: `aria-label="Slide to clock in for {title}, {time}, {site}"`, `aria-valuetext` shows
progress, arrow keys step, End commits, live region announces state changes, 44 px minimum thumb,
visible focus ring (3 px purple). `prefers-reduced-motion` removes the 220 ms snap-back transition.

**Orchestration** (`member-calendar.tsx`): compute the session with `nextSelfCheckInSession` from the
already-loaded `week` for the selected participant and the minute clock; when one exists, bump the
reload token every 60 s; `onCheckedIn` appends the attendance to `week` so the card and the calendar
card (attended/late) update without a reload.

**Styles** in `account.css` under `.ready-card`: radius `var(--radius)`, Gi White, `border-top: 0.35rem
solid var(--bpt-purple)`, no blur shadows, Barlow Condensed 700 uppercase headline.

## 6. Security notes

- Server is the only authority for window, distance, booking and scope; the client computes nothing
  the server trusts.
- App Check enforced; Auth required; strict input schema; roles least-privilege; guardian scope via the
  family relationship.
- Coordinates: sent over HTTPS, never persisted, logged, audited or echoed. A test asserts the written
  attendance, audit event and error messages contain neither value.
- Residual risk accepted (decisions 2 and 14): a member faking browser GPS, or a reading up to 100 m
  wide that happens to centre near the mat, can pass the gate. Self check-ins
  carry `method: "self"` so staff can spot patterns.
- No new dependency. No `dangerouslySetInnerHTML`. Location permission only after a user gesture.

## 7. Testing

- **Domain** (`self-check-in-contracts.test.ts`): window at −60 min, −60 min −1 s, +20 min, +20 min +1 s;
  next-session pick (no booking, requested-only booking, cancelled, attended by coach, two overlapping);
  every refusal order case; exactly 50 m distance and exactly 100 m accuracy pass, 51 m and 101 m fail;
  open mat window closes at `endAt`; `checkedIn` candidate when a coach record exists; parser rejects extra keys,
  strings, NaN, out-of-range.
- **Functions** (handler with fake store, existing pattern): staff refused; adult/teen/guardian with a
  foreign student refused; each refusal code mapped to `failed-precondition` + reason; happy path
  `attended` and `late`; replay returns the same record; coach attendance first → `already_checked_in`;
  coordinate leak assertion; mutation check on each guard.
- **Web** (vitest + jsdom): hidden without a window session; rendered as the first child of `main`;
  follows the child chip; keyboard End commits, early release snaps back; each state and sentence;
  geolocation requested only after commit.
- **Playwright** (`qa/tests/account-self-check-in.spec.ts`, against the `:9471` fixture through
  `BASE_URL=https://optimyze-vps-de-prod.tail29c816.ts.net:9471`, projects desktop-chromium and
  mobile-chromium): `context.grantPermissions(["geolocation"])` +
  `setGeolocation` inside 50 m → done; 120 m → refused sentence; permissions denied → denied sentence;
  keyboard-only flow; no console errors; screenshots of idle/locating/done/refused at 390 and 1280 px.
- **Emulator** (best effort): the callable end-to-end in a throwaway container with Java, following
  `qa/tests/schedule-auth-emulator.spec.ts`. Java is not on the host; if the container run fails, the
  report says so and the firebase adapter stays marked unverified.
- **Reviews** after green tests: `impeccable`, `taste-skill`, `redesign-skill` (screen);
  `security-best-practices`, `frontend-security-coder` (callable + component); `ponytail` (whole diff).

## 8. Rollout note

Production has no site coordinates yet. Before the slider goes live, an owner/admin records the two
pins of decision 15 in `/admin/classes` (site geofence panel). Until then every self check-in answers
`site_not_ready` and the card says to ask a coach, which is the intended fail-closed behaviour. The
`selfCheckIn` function deploys separately (`firebase deploy --only functions:selfCheckIn`).

Ledger: row **T040V2** in `tasksv2.md`, mirrored in `Listav2/Listav2.data.js` (`TASK_SURFACES`
declares the files above so the parallel report stays honest; `qa/unit/listav2-ledger-sync.test.ts`
fails otherwise).
