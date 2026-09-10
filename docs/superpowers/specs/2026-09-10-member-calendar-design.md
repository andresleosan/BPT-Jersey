# Member calendar (`/account`) — design spec

Date: 2026-09-10 · Status: approved in brainstorm (13 decisions) · Path: architectural

## 1. Goal

Replace the `/account` home (a list of eight links) with a **booking calendar for members
aged 12+**: the member sees the academy sessions of their group, books and cancels with one
touch, and reads their status at a glance through a traffic-light colour code. Guardians use
the same screen for each child. The screen must work today against fixture data on the
tailnet workbench (`:9471`) and be connectable to the existing Firebase callables by changing
one line — without this iteration connecting anything.

Out of scope: rewriting the other `/account/*` pages (they stay reachable by URL, unlinked),
waitlist from the calendar, account creation for teens, backend changes, Firestore/Functions
emulators.

## 2. Decisions (traceable)

| # | Decision | Chosen |
|---|----------|--------|
| 1 | Identity of 12+ member | **C** — own account (`teenStudent`) **and** guardian still sees/manages from theirs |
| 2 | Scope of "replace" | **A** — `/account` = calendar only; old routes live by URL, no links |
| 3 | Sessions outside the member's group | **C** — grey, not bookable; tapping explains why |
| 4 | Red / missed | **A** — only `no_show`; `attended`/`late` = dimmed green; range = current week |
| 5 | Navigation | **B** — forward-only arrows: day by day (phone), week by week (desktop); cap 14 days; Sunday skipped |
| 6 | Booking/cancel friction | **B** — book = one tap; cancel = native confirm dialog; £15 shown on card and after booking; persistent penalty banner **yes** |
| 7 | Visual direction | **C** — immersive purple header + day strip (GO Club adapted), light calendar body (project system); radius 1rem inside `/account` |
| 8 | Data architecture | **A** — `CalendarRepository` port + `fixture` impl (live) + `firebase` impl (written, untested) |
| 9 | `teenStudent` depth | **A** — role constant + gate + emulator seed only; account creation left as open decision |
| 10 | Card content / time axis | **A** — minimal card (time · title · site · status colour · one button); list per day, no empty hours, no seminar tag |
| 11 | Desktop layout | **B** — six columns Mon–Sat, today's column wider and highlighted; breakpoint 58rem |
| 12 | Guardian with several children | **A** — chip selector; traffic light (and greys) belong to the selected child |
| 13 | Done means | **A** — domain tests + component tests (vitest) + Playwright screenshots on :9471 |

Business rules confirmed from BRIEF decision 2 and `packages/domain`: booking **and**
cancellation close **60 minutes** before start, Open Mats included; a Town no-show proposes a
**£15** penalty (`noShowPenaltyAmountMinor = 1500`, Town only); claims go through the office.

## 3. Architecture

```
packages/domain/src/schedule/
  member-calendar-contracts.ts          pure rules + view types (tests beside it)

apps/web/src/lib/calendar/
  calendar-repository.ts                port (interface + shared types)
  fixture-calendar-repository.ts        deterministic fixtures, used on :9471 and in tests
  firebase-calendar-repository.ts       adapter over existing clients — written, NOT verified
  index.ts                              picks impl via NEXT_PUBLIC_CALENDAR_SOURCE=fixture|firebase

apps/web/src/app/account/
  page.tsx                              replaced: auth gate + <MemberCalendar/>
  account.css                           /account-only styles (radius 1rem, purple header)
  calendar/member-calendar.tsx          orchestration: load, viewport, offset, selected student
  calendar/calendar-header.tsx          purple block: name, child chips, day strip, arrows
  calendar/day-column.tsx               one day: heading + cards
  calendar/session-card.tsx             traffic-light card + single action
  calendar/penalty-banner.tsx
  calendar/cancel-dialog.tsx            native <dialog>
```

Touched existing files: `lib/client-account.ts` (`ClientAccountRole` + `"teenStudent"`),
`lib/client-auth.tsx` (`studentClientRoles` includes it), `deploy/seed-auth.mjs`
(`teen@bpt.test`, role `teenStudent`), `.env.local` (`NEXT_PUBLIC_CALENDAR_SOURCE=fixture`),
`DESIGN.md` (an `/account` addendum). `account/page.test.tsx` is rewritten for the new home.

## 4. Domain contracts (`member-calendar-contracts.ts`)

```ts
export type CalendarViewport = "phone" | "desktop";
export const calendarMaxOffsetDays = 14;

export type CalendarSessionStatus =
  | "open"      // yellow  — in group, bookable, not booked
  | "booked"    // green   — booking requested|confirmed
  | "attended"  // dimmed green — attendance attended|late
  | "missed"    // red     — attendance no_show
  | "closed"    // grey    — in group, < 60 min to start (or session active/completed) and not booked
  | "full"      // grey    — in group, capacity reached, not booked
  | "locked";   // grey    — outside group (reason attached)

export type LockedReason = "age_band" | "site" | "open_mat";

export type CalendarMemberContext = Readonly<{
  studentId: string;
  participantType: ParticipantType;       // from plan
  planClassSites: readonly Site[];
  planOpenMatSites: readonly Site[];
  membershipId: string;
}>;

export type CalendarDay = Readonly<{ dateKey: string /* YYYY-MM-DD Jersey */; label: string; isToday: boolean }>;

export function visibleDays(input: { now: Date; viewport: CalendarViewport; offset: number }): readonly CalendarDay[];
//  phone:   two consecutive days starting at today+offset, skipping Sunday (Sat→Sat,Mon; Sun→Mon,Tue)
//  desktop: Monday..Saturday of the week containing today, shifted by `offset` weeks
//  offset is clamped so the first visible day never exceeds today + calendarMaxOffsetDays
export function nextOffset / prevOffset(viewport, offset, now): number   // arrow helpers

export function deriveSessionStatus(input: {
  session: SessionRecord; program: ProgramRecord; member: CalendarMemberContext;
  booking?: BookingRecord; attendance?: AttendanceRecord; bookedCount: number; now: Date;
}): Readonly<{ status: CalendarSessionStatus; lockedReason?: LockedReason }>;
// order: locked → missed → attended → booked → closed → full → open
// group rule: program.ageBand === "all" || matches participantType (kids/teens/adult);
// site rule: session.locationId in plan sites (class sites, or open-mat sites when discipline === "open-mat")

export function canCancelBooking(session: SessionRecord, now: Date): boolean  // = isWithinBookingCutoff(startAt, now, 60)
export function cancelDeadlineLabel(session: SessionRecord): string           // "17:00" Jersey time
export function memberGroupLabel(participantType): "Kids" | "Teens" | "Adults"
```

All functions are pure, use `Europe/Jersey` for calendar days, and are tested.

## 5. Repository port (`calendar-repository.ts`)

```ts
export type CalendarParticipant = Readonly<{
  studentId: string; firstName: string; membershipId: string; planId: PlanId;
  participantType: ParticipantType; planClassSites: readonly Site[]; planOpenMatSites: readonly Site[];
}>;
export type CalendarMember = Readonly<{
  role: "guardian" | "adultStudent" | "teenStudent"; displayName: string;
  participants: readonly CalendarParticipant[];        // one for adult/teen, N for guardian
}>;
export type CalendarWeekData = Readonly<{
  sessions: readonly SessionRecord[]; programs: readonly ProgramRecord[];
  bookings: readonly BookingRecord[]; attendance: readonly AttendanceRecord[];
  bookedCounts: Readonly<Record<string, number>>;       // sessionId → confirmed bookings
}>;
export interface CalendarRepository {
  loadMember(): Promise<CalendarMember>;
  loadWeek(studentId: string, fromIso: string, toIso: string): Promise<CalendarWeekData>;
  book(input: RequestBookingInput): Promise<BookingRecord>;
  cancel(input: CancelBookingInput): Promise<BookingRecord>;
  loadPenalties(studentId: string): Promise<readonly NoShowPenaltyRecord[]>;
}
```

- **fixture**: in-memory; `book`/`cancel` mutate the fixture so the UI round-trips. Seeds: one
  guardian with two children (Maya · teens · Town Teens; Leo · kids · West Kids 2x), one teen
  (Sam · teens · Town Teens), one adult. A week of sessions across Town/West, kids/teens/adult/
  open-mat, with one `no_show`, one `attended`, one `confirmed` booking, one full class.
  Fixture "now" is real `Date.now()` so cut-offs behave.
- **firebase**: `loadMember` = `listClientMemberships()` + (guardian) `getFamily()` for
  names, plan lookup from `PLAN_CATALOG`; `loadWeek` = `listSessions` + `getScheduleCatalog`
  + `listStudentBookings(studentId)` + `listStudentAttendance(studentId)`; `bookedCounts` left
  `{}` with a `// TODO(connect)` note (needs a callable); `book`/`cancel` = `requestBooking`/
  `cancelBooking`; `loadPenalties` = `listNoShowPenalties()` filtered by `studentId`. Marked
  `// UNVERIFIED — written against the client signatures, never run against Firebase`.
- `index.ts`: `NEXT_PUBLIC_CALENDAR_SOURCE === "firebase"` → firebase, otherwise fixture.

## 6. UI

**Shell** (`page.tsx`): `ClientAuthProvider` → `ClientAuthGate returnPath="/account"` (allows
guardian, adultStudent, teenStudent) → `<MemberCalendar/>`. No other links. Sign-out stays
(small link in header).

**Header** (purple `#2F2483`, GO Club adapted):
eyebrow `BPT JERSEY / MEMBER` · first name in Barlow Condensed (`clamp(2.4rem, 8vw, 4rem)`) ·
guardian with >1 participant: chips (selected = lime `#D9F36A` fill, ink text) · day strip:
one pill per visible day (weekday letter + number; today = lime fill) · arrows `‹ ›` (44px
targets; `‹` disabled at offset 0, `›` disabled at cap).

**Penalty banner**: rendered only when the selected student has a penalty with status
`proposed` or `charged` and no resolution: red-rule band — "A £15 no-show penalty will be added
to your next booking. Claims are handled by the office."

**Body** (canvas `#F2F1ED`): phone (< 58rem) = day blocks stacked; desktop (≥ 58rem) =
`grid-template-columns` with today `1.6fr`, others `1fr`; today's column heading purple.
Each day: heading (`Monday 14`) + cards sorted by `startAt`; empty day → "No sessions".
Sessions with status `cancelled` are not listed.

**Card** (`session-card.tsx`): whole background = status colour; content: `18:00–19:00`,
title, site (`Town`/`West`); one action:

| status | background | action |
|---|---|---|
| open | yellow `#FFE66D` | `Book` → optimistic booked; 4 s note "Booked. Missing it costs £15." |
| booked | green `#D7F0E2`, left rule `#176B49` | `Booked · Cancel` (opens dialog); if !canCancel → `Booked` + "Cancellations closed" |
| attended | dimmed green `#E7F6EE`, muted text | `Attended` (static) |
| missed | red `#FFE1E6`, left rule `#8D1C2F` | `Missed` (static) |
| closed | grey `#E8E7E3` | `Closed` (static) |
| full | grey `#E8E7E3` | `Full` (static) |
| locked | grey `#E8E7E3`, muted text | tapping toggles inline reason: "Teens only" / "Kids only" / "Adults only" / "Your plan doesn't cover Town" / "Open Mats at West aren't in your plan" |

**Cancel dialog** (native `<dialog>`): "Cancel Monday 18:00 · Teens BJJ?" + "Cancellations
close at 17:00." + `Keep booking` / `Cancel booking`. On confirm → repository.cancel with
reason `"member_cancelled"`; card returns to `open`.

**Status refresh**: `setInterval` 60 s re-derives statuses so `closed` appears without reload.

**Loading**: three skeleton cards per visible day. **Errors**: load failure → red-rule panel
"Couldn't load your calendar." + `Try again`; booking failure → reuse `bookingFailure`
mapping from the old classes page (moved to `lib/calendar/booking-messages.ts`).

Design tokens for `/account` are appended to `DESIGN.md` as section "9. Member app (/account)".

## 7. Roles

`ClientAccountRole = "guardian" | "adultStudent" | "teenStudent" | "shopper"`.
`studentClientRoles` = guardian, adultStudent, teenStudent. Emulator seed adds
`teen@bpt.test` / `Passw0rd!` with `role: teenStudent`.

Open decision for the connecting model: how a teen account is created (proposal: office
creates it linked to the family, claim `{ role: "teenStudent", studentId }`; the fixture assumes
`studentId` arrives via `loadMember`).

## 8. Testing

- `member-calendar-contracts.test.ts`: `visibleDays` (weekday, Saturday, Sunday, offset,
  cap, desktop week shift), `deriveSessionStatus` (one per status; three locked reasons;
  priority order), `canCancelBooking` at exactly 60 min, `cancelDeadlineLabel`.
- `fixture-calendar-repository.test.ts`: book then cancel round-trips.
- Component tests (jsdom): phone renders two days; desktop renders six columns with today
  wider (class assertion); guardian chips switch colours; cancel dialog flow; penalty banner
  present/absent; locked reason toggles.
- Playwright on `https://optimyze-vps-de-prod.tail29c816.ts.net:9471`: screenshots at
  390×844 and 1280×800 for `teen@bpt.test` and `tutor@bpt.test`; loop build→verify against
  this spec until it matches.
