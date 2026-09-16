"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

import type { SessionRecord } from "@bpt-jersey/domain/schedule";
import { localMidnightUtc, weekRangeFor } from "@bpt-jersey/domain/schedule/classes-services";

import {
  getScheduleCatalog,
  listSessionBookedCounts,
  listSessions,
  type ScheduleCatalogResponse,
} from "../../../../lib/schedule-client";
import { listStaffProfiles } from "../../../../lib/staff-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import { CalendarView } from "./calendar-view";
import {
  ClassesFilters,
  emptyClassFilters,
  statusMatches,
  type ClassFilters,
} from "./classes-filters";
import { ListView, type DateRange } from "./list-view";
import { SessionPanel, type StaffOption } from "./session-panel";
import { WeekActions, addDays } from "./week-actions";
import { dayLabel, localParts, mondayOf, type GridSession } from "./week-grid";

type View = "calendar" | "list";
type Range = "week" | "month" | "day";
type Panel =
  | null
  | Readonly<{ mode: "create"; defaults: { date: string; startTime: string } }>
  | Readonly<{ mode: "edit"; sessionId: string }>;

const fallbackTimezone = "Europe/Jersey";
const fallbackColour = "#F0EFFF";
const gridWindow = { fromHour: 6, toHour: 23 };
const monthNames = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const ranges: readonly { id: Range; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
];

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function monthOf(date: string): { year: number; month: number } {
  const [year, month] = date.split("-").map(Number);
  return { year: year!, month: month! - 1 };
}

/** The instant range the callables must be asked for, in the academy timezone. */
function queryFor(
  range: Range,
  anchor: string,
  timezone: string,
  dateRange: DateRange | null,
): { from: string; to: string } {
  if (dateRange) return boundsOf(dateRange.from, dateRange.to, timezone);
  if (range === "month") {
    const { year, month } = monthOf(anchor);
    const first = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const last = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    const lastOffset = (new Date(`${last}T00:00:00.000Z`).getUTCDay() + 6) % 7;
    return boundsOf(mondayOf(first), addDays(last, 6 - lastOffset), timezone);
  }
  const week = weekRangeFor(mondayOf(anchor), timezone);
  return week.ok ? week.value : boundsOf(mondayOf(anchor), addDays(mondayOf(anchor), 6), timezone);
}

function boundsOf(from: string, to: string, timezone: string): { from: string; to: string } {
  return {
    from: new Date(localMidnightUtc(from, timezone)).toISOString(),
    to: new Date(localMidnightUtc(addDays(to, 1), timezone) - 1).toISOString(),
  };
}

function yearQueryFor(today: string, timezone: string): { from: string; to: string } {
  const year = today.slice(0, 4);
  return boundsOf(`${year}-01-01`, `${year}-12-31`, timezone);
}

function titleOf(range: Range, anchor: string): string {
  if (range === "day") return dayLabel(anchor);
  const { year, month } = monthOf(anchor);
  if (range === "month") return `${monthNames[month]} ${year}`;
  const start = mondayOf(anchor);
  const end = addDays(start, 6);
  const startParts = monthOf(start);
  const endParts = monthOf(end);
  const startDay = Number(start.slice(8));
  const endDay = Number(end.slice(8));
  const head =
    startParts.month === endParts.month
      ? `${startDay}`
      : `${startDay} ${monthNames[startParts.month]}`;
  return `${head} – ${endDay} ${monthNames[endParts.month]} ${endParts.year}`;
}

export function ClassesPage(): ReactElement {
  const session = useAdminOrStaffSession();
  const canEdit = session.role !== "coach";
  const actorId = session.uid;

  const [view, setView] = useState<View>("calendar");
  const [range, setRange] = useState<Range>("week");
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date().toISOString().slice(0, 10)));
  const [catalog, setCatalog] = useState<ScheduleCatalogResponse | null>(null);
  const [staff, setStaff] = useState<readonly StaffOption[]>([]);
  const [sessions, setSessions] = useState<readonly SessionRecord[]>([]);
  const [booked, setBooked] = useState<Readonly<Record<string, number>>>({});
  const [total, setTotal] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [filters, setFilters] = useState<ClassFilters>(emptyClassFilters);

  const totalRef = useRef<number | null>(null);
  const timezone = catalog?.locations[0]?.timezone ?? fallbackTimezone;

  useEffect(() => {
    let abandoned = false;
    void (async () => {
      try {
        const [loaded, staffRows] = await Promise.all([getScheduleCatalog(), listStaffProfiles()]);
        if (abandoned) return;
        setCatalog(loaded);
        setStaff(staffRows);
      } catch (failure) {
        if (!abandoned) {
          setError(messageOf(failure, "Unable to load the schedule catalogue"));
          setLoading(false);
        }
      }
    })();
    return () => {
      abandoned = true;
    };
  }, []);

  const listRange = view === "list" ? dateRange : null;

  useEffect(() => {
    if (catalog === null) return undefined;
    let abandoned = false;
    setLoading(true);
    void (async () => {
      try {
        const query = queryFor(range, weekStart, timezone, listRange);
        const [rows, counts] = await Promise.all([
          listSessions(query),
          listSessionBookedCounts(query),
        ]);
        // The TOTAL counter is a whole-year figure: one extra query, kept for the session.
        const cached =
          totalRef.current ??
          (
            await listSessions(
              yearQueryFor(localParts(new Date().toISOString(), timezone).date, timezone),
            )
          ).length;
        totalRef.current = cached;
        if (abandoned) return;
        setSessions(rows);
        setBooked(counts);
        setTotal(cached);
        setError(null);
      } catch (failure) {
        if (!abandoned) setError(messageOf(failure, "Unable to load the classes"));
      } finally {
        if (!abandoned) setLoading(false);
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [catalog, range, weekStart, timezone, listRange, reload]);

  const locations = catalog?.locations ?? [];
  const programs = catalog?.programs ?? [];
  const today = localParts(new Date().toISOString(), timezone).date;

  const grid: readonly GridSession[] = sessions.map((row) => ({
    sessionId: row.sessionId,
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    colour:
      programs.find((program) => program.programId === row.programId)?.colour ?? fallbackColour,
    booked: booked[row.sessionId] ?? 0,
    capacity: row.capacity,
    status: row.status,
    locationId: row.locationId,
    programId: row.programId,
    instructorIds: row.instructorIds ?? [row.instructorId],
  }));

  const visible = grid.filter(
    (row) =>
      (filters.locations.length === 0 || filters.locations.includes(row.locationId)) &&
      (filters.programs.length === 0 || filters.programs.includes(row.programId)) &&
      (filters.staff.length === 0 || row.instructorIds.some((id) => filters.staff.includes(id))) &&
      (!filters.mine || row.instructorIds.includes(actorId)) &&
      statusMatches(row.status, filters.status) &&
      (range !== "day" ||
        listRange !== null ||
        localParts(row.startAt, timezone).date === weekStart),
  );

  const live = visible.filter((row) => row.status !== "cancelled");
  const registrations = live.reduce((sum, row) => sum + row.booked, 0);
  const seats = live.reduce((sum, row) => sum + (row.capacity ?? 0), 0);
  const occupancy = seats > 0 ? `${Math.round((100 * registrations) / seats)}%` : "—";

  /** Week and month always sit on a Monday; the month keeps its own month when the two disagree. */
  function anchorFor(date: string): string {
    if (range === "day") return date;
    const monday = mondayOf(date);
    return range === "month" && monday.slice(0, 7) !== date.slice(0, 7) ? date : monday;
  }

  function step(direction: 1 | -1): void {
    if (range === "day") setWeekStart(addDays(weekStart, direction));
    else if (range === "week") setWeekStart(addDays(mondayOf(weekStart), 7 * direction));
    else {
      const { year, month } = monthOf(weekStart);
      setWeekStart(new Date(Date.UTC(year, month + direction, 1)).toISOString().slice(0, 10));
    }
  }

  function selectRange(next: Range): void {
    setRange(next);
    setWeekStart(next === "week" ? mondayOf(weekStart) : weekStart);
  }

  function afterChange(): void {
    setPanel(null);
    setReload((previous) => previous + 1);
  }

  const edited =
    panel?.mode === "edit" ? sessions.find((row) => row.sessionId === panel.sessionId) : undefined;

  return (
    <section className="cs-card cs-classes">
      <h2>Classes &amp; Services 2.0</h2>
      <div className="cs-classes-header">
        <div role="tablist" aria-label="View" className="cs-subtabs">
          {(["calendar", "list"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              className="cs-subtab"
              aria-selected={view === candidate}
              onClick={() => setView(candidate)}
            >
              {candidate === "calendar" ? "Calendar" : "List"}
            </button>
          ))}
        </div>
        <dl className="cs-counters">
          <div>
            <dt>Classes</dt>
            <dd>{live.length}</dd>
          </div>
          <div>
            <dt>Registrations</dt>
            <dd>{registrations}</dd>
          </div>
          <div>
            <dt>Occupancy %</dt>
            <dd>{occupancy}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{total ?? "—"}</dd>
          </div>
        </dl>
      </div>
      <div className="cs-toolbar">
        <button
          type="button"
          className="cs-button"
          aria-label={`Previous ${range}`}
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <button type="button" className="cs-button" onClick={() => setWeekStart(anchorFor(today))}>
          Today
        </button>
        <button
          type="button"
          className="cs-button"
          aria-label={`Next ${range}`}
          onClick={() => step(1)}
        >
          ›
        </button>
        <label className="cs-field">
          <span className="cs-visually-hidden">Go to date</span>
          <input
            type="date"
            value={weekStart}
            onChange={(event) => setWeekStart(anchorFor(event.target.value))}
          />
        </label>
        <p className="cs-range-title">{titleOf(range, weekStart)}</p>
        <div className="cs-range-buttons">
          {ranges.map((option) => (
            <button
              key={option.id}
              type="button"
              className="cs-button"
              aria-pressed={range === option.id}
              onClick={() => selectRange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {canEdit ? (
          <>
            <WeekActions weekStart={mondayOf(weekStart)} onChanged={afterChange} />
            <button
              type="button"
              className="cs-button cs-button-primary"
              onClick={() =>
                setPanel({ mode: "create", defaults: { date: weekStart, startTime: "17:00" } })
              }
            >
              Add a class
            </button>
          </>
        ) : null}
      </div>
      <ClassesFilters
        locations={locations}
        programs={programs}
        staff={staff}
        filters={filters}
        onChange={setFilters}
      />
      {error === null ? null : (
        <p className="cs-notice" data-kind="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="cs-placeholder" role="status">
          Loading the schedule…
        </p>
      ) : null}
      {view === "calendar" ? (
        <CalendarView
          view={range}
          weekStart={weekStart}
          sessions={visible}
          timezone={timezone}
          window={gridWindow}
          canEdit={canEdit}
          onOpen={(sessionId) => setPanel({ mode: "edit", sessionId })}
          onCreate={(date, startTime) =>
            setPanel({ mode: "create", defaults: { date, startTime } })
          }
          onSelectWeek={(monday) => {
            setRange("week");
            setWeekStart(monday);
          }}
        />
      ) : (
        <ListView
          sessions={visible}
          locations={locations}
          programs={programs}
          timezone={timezone}
          today={today}
          dateRange={dateRange}
          onDateRange={setDateRange}
          onOpen={(sessionId) => setPanel({ mode: "edit", sessionId })}
        />
      )}
      {catalog !== null && panel !== null && (panel.mode === "create" || edited !== undefined) ? (
        <SessionPanel
          mode={panel.mode}
          session={edited}
          catalog={catalog}
          staff={staff}
          timezone={timezone}
          defaults={panel.mode === "create" ? panel.defaults : undefined}
          canEdit={canEdit}
          onSaved={afterChange}
          onCancelled={afterChange}
          onClose={() => setPanel(null)}
        />
      ) : null}
    </section>
  );
}

export default function ClassesRoute(): ReactElement {
  return <ClassesPage />;
}
