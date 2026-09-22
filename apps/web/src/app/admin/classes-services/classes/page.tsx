"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

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
import { useCompactCalendar } from "./use-compact-calendar";
import { CalendarView } from "./calendar-view";
import {
  ClassesFilters,
  emptyClassFilters,
  statusMatches,
  type ClassFilters,
} from "./classes-filters";
import { ListView, type DateRange } from "./list-view";
import { SessionPanel, type StaffOption } from "./session-panel";
import { trainerOptions } from "./trainer-options";
import { WeekActions, addDays } from "./week-actions";
import { dayLabel, localParts, mondayOf, weekDays, type GridSession } from "./week-grid";

type View = "calendar" | "list";
type StaffStatus = "loading" | "ready" | "unavailable";
type Range = "week" | "month" | "day";
type Panel =
  | null
  | Readonly<{ mode: "create"; defaults: { date: string; startTime: string } }>
  | Readonly<{ mode: "edit"; sessionId: string }>;

const fallbackTimezone = "Europe/Jersey";
const fallbackColour = "#F0EFFF";
const gridWindow = { fromHour: 6, toHour: 23 };
const maxWindowMs = 90 * 86_400_000;
const viewPanelId = "cs-classes-view";
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
  // The caller runs inside the load's try: a rejected week surfaces in the notice.
  if (!week.ok) throw new Error(week.error);
  return week.value;
}

/**
 * `parseListSessionsQuery` refuses a range wider than 90 days, so a wider one is asked for in
 * consecutive windows and put back together. A range that already fits makes exactly one call.
 */
function windowsFor(query: { from: string; to: string }): { from: string; to: string }[] {
  const windows: { from: string; to: string }[] = [];
  const to = Date.parse(query.to);
  for (let from = Date.parse(query.from); from <= to;) {
    const end = Math.min(from + maxWindowMs, to);
    windows.push({ from: new Date(from).toISOString(), to: new Date(end).toISOString() });
    from = end + 1;
  }
  return windows;
}

async function loadRange(query: { from: string; to: string }): Promise<readonly SessionRecord[]> {
  const loaded = await Promise.all(windowsFor(query).map((window) => listSessions(window)));
  const byId = new Map<string, SessionRecord>();
  for (const rows of loaded) for (const row of rows) byId.set(row.sessionId, row);
  return [...byId.values()];
}

function boundsOf(from: string, to: string, timezone: string): { from: string; to: string } {
  return {
    from: new Date(localMidnightUtc(from, timezone)).toISOString(),
    to: new Date(localMidnightUtc(addDays(to, 1), timezone) - 1).toISOString(),
  };
}

function yearQueryFor(year: string, timezone: string): { from: string; to: string } {
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
      : startParts.year === endParts.year
        ? `${startDay} ${monthNames[startParts.month]}`
        : `${startDay} ${monthNames[startParts.month]} ${startParts.year}`;
  return `${head} – ${endDay} ${monthNames[endParts.month]} ${endParts.year}`;
}

function ClassesContent(): ReactElement {
  const session = useAdminOrStaffSession();
  const compact = useCompactCalendar();
  const canEdit = session.role !== "coach";
  // `listMemberships` is reserved for the office: a head coach may edit a class but not enrol.
  const canReadMemberships = session.role === "owner" || session.role === "administrator";

  const [view, setView] = useState<View>("calendar");
  const [range, setRange] = useState<Range>("week");
  const [weekStart, setWeekStart] = useState(() =>
    mondayOf(localParts(new Date().toISOString(), fallbackTimezone).date),
  );
  const [agendaDate, setAgendaDate] = useState(
    () => localParts(new Date().toISOString(), fallbackTimezone).date,
  );
  const [catalog, setCatalog] = useState<ScheduleCatalogResponse | null>(null);
  const [staff, setStaff] = useState<readonly StaffOption[]>([]);
  const [staffStatus, setStaffStatus] = useState<StaffStatus>("loading");
  const [sessions, setSessions] = useState<readonly SessionRecord[]>([]);
  const [booked, setBooked] = useState<Readonly<Record<string, number>>>({});
  const [total, setTotal] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [loading, setLoading] = useState(true);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [countsStatus, setCountsStatus] = useState<StaffStatus>("loading");
  const [countsReload, setCountsReload] = useState(0);
  const [totalRequested, setTotalRequested] = useState(false);
  const [totalLoading, setTotalLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [catalogReload, setCatalogReload] = useState(0);
  const lastRangeKey = useRef("");
  const [filters, setFilters] = useState<ClassFilters>(emptyClassFilters);

  const rangeCache = useRef(
    new Map<string, { at: number; value: Awaited<ReturnType<typeof loadRange>> }>(),
  );
  const countsCache = useRef(
    new Map<string, { at: number; value: Readonly<Record<string, number>> }>(),
  );
  const timezone = catalog?.locations[0]?.timezone ?? fallbackTimezone;

  useEffect(() => {
    let abandoned = false;
    void (async () => {
      try {
        const loaded = await getScheduleCatalog();
        if (!abandoned) {
          setCatalog(loaded);
          setCatalogError(null);
        }
      } catch (failure) {
        if (!abandoned) {
          setCatalogError(messageOf(failure, "Unable to load the schedule catalogue"));
        }
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [catalogReload, session.uid, session.academyId, session.role]);

  // Load staff after the first week. The public academy roster is available immediately.
  useEffect(() => {
    if (!scheduleLoaded) return undefined;
    let abandoned = false;
    void (async () => {
      try {
        const rows = await listStaffProfiles();
        if (abandoned) return;
        setStaff(rows);
        setStaffStatus("ready");
      } catch {
        if (abandoned) return;
        setStaff([]);
        setStaffStatus("unavailable");
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [scheduleLoaded, session.uid, session.academyId, session.role]);

  const listRange = view === "list" ? dateRange : null;

  useEffect(() => {
    // The week does not wait for the catalogue: sessions only need the timezone, which falls back to
    // the academy's own until the catalogue arrives.
    let abandoned = false;
    setLoading(true);
    void (async () => {
      try {
        const query = queryFor(range, weekStart, timezone, listRange);
        const key = JSON.stringify([session.uid, session.academyId, session.role, query]);
        if (lastRangeKey.current !== key) {
          setSessions([]);
          setBooked({});
          lastRangeKey.current = key;
        }
        const cached = rangeCache.current.get(key);
        const loaded =
          cached && Date.now() - cached.at < 30000 ? cached.value : await loadRange(query);
        if (!abandoned) {
          if (rangeCache.current.size >= 8)
            rangeCache.current.delete(rangeCache.current.keys().next().value!);
          rangeCache.current.set(key, {
            at: cached?.value === loaded ? cached.at : Date.now(),
            value: loaded,
          });
        }
        if (abandoned) return;
        setSessions(loaded);
        setScheduleLoaded(true);
        setError(null);
      } catch (failure) {
        if (!abandoned) setError(messageOf(failure, "Unable to load the classes"));
      } finally {
        if (!abandoned) {
          setLoading(false);
        }
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [range, weekStart, timezone, listRange, reload, session.uid, session.academyId, session.role]);

  // Registration counts are independent: slow or failed counts must never hide the classes.
  useEffect(() => {
    let abandoned = false;
    setCountsStatus("loading");
    void (async () => {
      try {
        const query = queryFor(range, weekStart, timezone, listRange);
        const key = JSON.stringify([session.uid, session.academyId, session.role, query]);
        const cached = countsCache.current.get(key);
        const counts =
          cached && Date.now() - cached.at < 30000
            ? cached.value
            : (Object.assign(
                {},
                ...(await Promise.all(
                  windowsFor(query).map((window) => listSessionBookedCounts(window)),
                )),
              ) as Record<string, number>);
        if (abandoned) return;
        if (countsCache.current.size >= 8)
          countsCache.current.delete(countsCache.current.keys().next().value!);
        countsCache.current.set(key, {
          at: cached?.value === counts ? cached.at : Date.now(),
          value: counts,
        });
        setBooked(counts);
        setCountsStatus("ready");
      } catch {
        if (!abandoned) setCountsStatus("unavailable");
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [
    range,
    weekStart,
    timezone,
    listRange,
    reload,
    countsReload,
    session.uid,
    session.academyId,
    session.role,
  ]);

  useEffect(() => {
    if (!totalRequested || catalog === null) {
      setTotalLoading(false);
      return undefined;
    }
    let abandoned = false;
    setTotalLoading(true);
    void (async () => {
      try {
        const year = localParts(new Date().toISOString(), timezone).date.slice(0, 4);
        const rows = await loadRange(yearQueryFor(year, timezone));
        if (!abandoned) setTotal(rows.length);
      } catch {
        if (!abandoned) setTotalRequested(false);
      } finally {
        if (!abandoned) setTotalLoading(false);
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [catalog, totalRequested, timezone, session.uid, session.academyId, session.role]);

  const trainers = trainerOptions(staff);
  const canCreate =
    canEdit && catalog !== null && trainers.some((row) => row.active && row.status === "active");
  const locations = catalog?.locations ?? [];
  const programs = useMemo(() => catalog?.programs ?? [], [catalog]);
  const today = localParts(new Date().toISOString(), timezone).date;
  // Sessions name their trainers by staffKey, never by auth uid, so "Mine" matches on the keys the
  // server flagged as the actor's own.
  const mineKeys = useMemo(
    () => staff.filter((row) => row.self).map((row) => row.staffKey),
    [staff],
  );

  const grid: readonly GridSession[] = useMemo(
    () =>
      sessions.map((row) => ({
        sessionId: row.sessionId,
        title: row.title,
        startAt: row.startAt,
        endAt: row.endAt,
        colour:
          programs.find((program) => program.programId === row.programId)?.colour ?? fallbackColour,
        booked: countsStatus === "ready" ? (booked[row.sessionId] ?? 0) : null,
        capacity: row.capacity,
        status: row.status,
        locationId: row.locationId,
        programId: row.programId,
        instructorIds: row.instructorIds ?? [row.instructorId],
      })),
    [sessions, programs, booked, countsStatus],
  );

  const visible = useMemo(
    () =>
      grid.filter(
        (row) =>
          (filters.locations.length === 0 || filters.locations.includes(row.locationId)) &&
          (filters.programs.length === 0 || filters.programs.includes(row.programId)) &&
          (filters.staff.length === 0 ||
            row.instructorIds.some((id) => filters.staff.includes(id))) &&
          (!filters.mine || row.instructorIds.some((id) => mineKeys.includes(id))) &&
          statusMatches(row.status, filters.status) &&
          (range !== "day" ||
            listRange !== null ||
            localParts(row.startAt, timezone).date === weekStart),
      ),
    [grid, filters, mineKeys, range, listRange, timezone, weekStart],
  );

  const live = visible.filter((row) => row.status !== "cancelled");
  const registrations = live.reduce((sum, row) => sum + (row.booked ?? 0), 0);
  const seats = live.reduce((sum, row) => sum + (row.capacity ?? 0), 0);
  const occupancy =
    countsStatus === "ready" && seats > 0 ? `${Math.round((100 * registrations) / seats)}%` : "—";

  /** Week and month always sit on a Monday; the month keeps its own month when the two disagree. */
  function anchorFor(date: string): string {
    if (range === "day") return date;
    const monday = mondayOf(date);
    return range === "month" && monday.slice(0, 7) !== date.slice(0, 7) ? date : monday;
  }

  function step(direction: 1 | -1): void {
    if (range === "day") goTo(addDays(weekStart, direction));
    else if (range === "week") goTo(addDays(mondayOf(weekStart), 7 * direction));
    else {
      const { year, month } = monthOf(weekStart);
      goTo(new Date(Date.UTC(year, month + direction, 1)).toISOString().slice(0, 10));
    }
  }

  function selectRange(next: Range): void {
    setRange(next);
    setWeekStart(
      next === "week"
        ? mondayOf(weekStart)
        : compact && next === "day" && weekDays(mondayOf(weekStart)).includes(agendaDate)
          ? agendaDate
          : weekStart,
    );
  }

  function afterChange(changed?: SessionRecord): void {
    setPanel(null);
    if (changed)
      setSessions((previous) => [
        ...previous.filter((row) => row.sessionId !== changed.sessionId),
        changed,
      ]);
    // A create, a cancellation or a whole week moved: the year's count is no longer valid.
    setTotal(null);
    setTotalRequested(false);
    rangeCache.current.clear();
    countsCache.current.clear();
    setReload((previous) => previous + 1);
  }

  /** Moving the calendar drops any list date-range preset, so the query follows the title again. */
  function goTo(date: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return;
    setDateRange(null);
    setWeekStart(date);
    setAgendaDate(date);
  }

  const edited =
    panel?.mode === "edit" ? sessions.find((row) => row.sessionId === panel.sessionId) : undefined;

  return (
    <section className="cs-card cs-calendar-page">
      <h2>Classes &amp; Services 2.0</h2>
      <div className="cs-classes-header">
        <div role="tablist" aria-label="View" className="cs-subtabs">
          {(["calendar", "list"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              className="cs-subtab"
              aria-controls={viewPanelId}
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
            <dd>{loading ? "—" : live.length}</dd>
          </div>
          <div>
            <dt>Registrations</dt>
            <dd>{countsStatus === "ready" ? registrations : "—"}</dd>
          </div>
          <div>
            <dt>Occupancy %</dt>
            <dd>{occupancy}</dd>
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
        <button
          type="button"
          className="cs-button"
          onClick={() => {
            goTo(anchorFor(today));
            setAgendaDate(today);
          }}
        >
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
          <span className="visually-hidden">Go to date</span>
          <input
            type="date"
            value={weekStart}
            onChange={(event) => {
              if (event.target.value) {
                goTo(anchorFor(event.target.value));
                setAgendaDate(event.target.value);
              }
            }}
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
        {(session.role === "owner" || session.role === "administrator") && (
          <a className="cs-button" href="/admin/courses?create=1">Create course / seminar</a>
        )}
        {canCreate && (!compact || range === "month" || view === "list") ? (
          <button
            type="button"
            className="cs-button cs-button-primary"
            onClick={() =>
              setPanel({ mode: "create", defaults: { date: weekStart, startTime: "17:00" } })
            }
          >
            Add a class
          </button>
        ) : null}
      </div>
      <details className="cs-calendar-options" open={!compact}>
        <summary>Filters and options</summary>
        <div className="cs-calendar-options-body">
          <ClassesFilters
            locations={locations}
            programs={programs}
            staff={trainers}
            filters={filters}
            onChange={setFilters}
          />
          <button
            type="button"
            className="cs-button"
            onClick={() => {
              rangeCache.current.clear();
              countsCache.current.clear();
              setReload((value) => value + 1);
            }}
          >
            Refresh schedule
          </button>
          {canEdit ? <WeekActions weekStart={mondayOf(weekStart)} onChanged={afterChange} /> : null}
          <button
            type="button"
            className="cs-button"
            disabled={totalRequested || !catalog}
            onClick={() => setTotalRequested(true)}
          >
            {totalLoading
              ? "Counting this year…"
              : total !== null
                ? `Year total: ${total}`
                : "Calculate year total"}
          </button>
        </div>
      </details>
      {canEdit && staffStatus === "unavailable" ? (
        <p className="cs-notice" data-kind="error" role="status">
          Staff profiles unavailable. Academy trainers are still available.
        </p>
      ) : null}
      {catalogError ? (
        <p className="cs-notice" data-kind="error" role="alert">
          {catalogError}{" "}
          <button
            type="button"
            className="cs-button"
            onClick={() => setCatalogReload((value) => value + 1)}
          >
            Retry catalogue
          </button>
        </p>
      ) : null}
      {countsStatus === "loading" && !loading ? (
        <p className="cs-placeholder" role="status">
          Loading registrations…
        </p>
      ) : null}
      {countsStatus === "unavailable" ? (
        <p className="cs-notice" data-kind="error" role="status">
          Registration counts unavailable. Classes are still available.
          <button
            type="button"
            className="cs-button"
            onClick={() => {
              countsCache.current.clear();
              setCountsReload((value) => value + 1);
            }}
          >
            Retry registrations
          </button>
        </p>
      ) : null}
      {error === null ? null : (
        <p className="cs-notice" data-kind="error" role="alert">
          {error}
          <button
            type="button"
            className="cs-button"
            onClick={() => {
              if (!catalog) setCatalogReload((value) => value + 1);
              setReload((value) => value + 1);
            }}
          >
            Retry schedule
          </button>
        </p>
      )}
      {loading ? (
        <p className="cs-placeholder" role="status">
          Loading the schedule…
        </p>
      ) : null}
      <div id={viewPanelId} role="tabpanel" aria-label={view === "calendar" ? "Calendar" : "List"}>
        {view === "calendar" ? (
          <CalendarView
            loading={loading || error !== null}
            locations={locations}
            selectedDate={agendaDate}
            onSelectDate={setAgendaDate}
            view={range}
            weekStart={weekStart}
            sessions={visible}
            timezone={timezone}
            window={gridWindow}
            canEdit={canCreate}
            onOpen={(sessionId) => setPanel({ mode: "edit", sessionId })}
            onCreate={(date, startTime) =>
              setPanel({ mode: "create", defaults: { date, startTime } })
            }
            onSelectWeek={(monday) => {
              setRange("week");
              goTo(monday);
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
      </div>
      {catalog !== null && panel !== null && (panel.mode === "create" || edited !== undefined) ? (
        <SessionPanel
          mode={panel.mode}
          session={edited}
          catalog={catalog}
          staff={trainers}
          timezone={timezone}
          defaults={panel.mode === "create" ? panel.defaults : undefined}
          canEdit={canEdit && !edited?.courseId}
          canReadMemberships={canReadMemberships}
          onSaved={afterChange}
          onCancelled={afterChange}
          onClose={() => setPanel(null)}
        />
      ) : null}
    </section>
  );
}

/** An identity/role change discards private state and in-flight responses together. */
export function ClassesPage(): ReactElement {
  const session = useAdminOrStaffSession();
  return <ClassesContent key={JSON.stringify([session.uid, session.academyId, session.role])} />;
}

export default function ClassesRoute(): ReactElement {
  return <ClassesPage />;
}
