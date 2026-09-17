"use client";

import Link from "next/link";
import { useEffect, useState, type ReactElement } from "react";

import type { LocationRecord, ProgramRecord } from "@bpt-jersey/domain/schedule";

import { addDays } from "./week-actions";
import { localParts, mondayOf, type GridSession } from "./week-grid";

export type DateRange = Readonly<{ from: string; to: string }>;

export type ListViewProps = Readonly<{
  sessions: readonly GridSession[];
  locations: readonly LocationRecord[];
  programs: readonly ProgramRecord[];
  timezone: string;
  today: string;
  dateRange: DateRange | null;
  onDateRange: (range: DateRange | null) => void;
  onOpen: (sessionId: string) => void;
}>;

type Preset =
  | "custom"
  | "today"
  | "yesterday"
  | "before-yesterday"
  | "last-7"
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "this-year";

const presets: readonly { id: Preset; label: string }[] = [
  { id: "custom", label: "Custom" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "before-yesterday", label: "Day before yesterday" },
  { id: "last-7", label: "Last 7 days" },
  { id: "this-week", label: "This week" },
  { id: "last-week", label: "Last week" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-year", label: "This year" },
];

const recordOptions = [10, 25, 50, 100, 190] as const;
const sortOptions = [
  { id: "date", label: "Date/time" },
  { id: "type", label: "Class type" },
  { id: "location", label: "Location" },
] as const;

type Sort = (typeof sortOptions)[number]["id"];

function monthBounds(date: string, offset: number): DateRange {
  const [year, month] = date.split("-").map(Number);
  const first = new Date(Date.UTC(year!, month! - 1 + offset, 1));
  const last = new Date(Date.UTC(year!, month! + offset, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

function rangeForPreset(preset: Preset, today: string): DateRange | null {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "before-yesterday":
      return { from: addDays(today, -2), to: addDays(today, -2) };
    case "last-7":
      return { from: addDays(today, -6), to: today };
    case "this-week":
      return { from: mondayOf(today), to: addDays(mondayOf(today), 6) };
    case "last-week":
      return { from: addDays(mondayOf(today), -7), to: addDays(mondayOf(today), -1) };
    case "this-month":
      return monthBounds(today, 0);
    case "last-month":
      return monthBounds(today, -1);
    case "this-year":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    default:
      return null;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function timeOf(iso: string, timezone: string): string {
  const { hour } = localParts(iso, timezone);
  return `${pad(Math.floor(hour))}:${pad(Math.round((hour % 1) * 60))}`;
}

// A cell a spreadsheet would run as a formula is neutralised with a leading apostrophe, so a
// class titled "=1+1" travels as text instead of executing when the file is opened.
const formulaLead = /^[=+\-@\t\r]/u;

function csvCell(value: string): string {
  const safe = formulaLead.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/gu, '""')}"`;
}

export function ListView({
  sessions,
  locations,
  programs,
  timezone,
  today,
  dateRange,
  onDateRange,
  onOpen,
}: ListViewProps): ReactElement {
  const [preset, setPreset] = useState<Preset>("custom");
  const [locationId, setLocationId] = useState("");
  const [programId, setProgramId] = useState("");
  const [trainer, setTrainer] = useState("");
  const [sort, setSort] = useState<Sort>("date");
  const [records, setRecords] = useState<number>(25);
  const [search, setSearch] = useState("");

  useEffect(() => {
    // The page drops the range when the calendar is navigated; the preset must follow it.
    if (dateRange === null) setPreset("custom");
  }, [dateRange]);

  const nameOfLocation = (id: string) =>
    locations.find((location) => location.locationId === id)?.name ?? id;
  const programOf = (id: string) => programs.find((program) => program.programId === id);

  const trainers = [...new Set(sessions.flatMap((row) => row.instructorIds))].sort();

  const term = search.trim().toLowerCase();
  const ordered = sessions
    .filter(
      (row) =>
        (locationId === "" || row.locationId === locationId) &&
        (programId === "" || row.programId === programId) &&
        (trainer === "" || row.instructorIds.includes(trainer)) &&
        (term === "" ||
          row.title.toLowerCase().includes(term) ||
          nameOfLocation(row.locationId).toLowerCase().includes(term) ||
          row.instructorIds.some((id) => id.toLowerCase().includes(term))),
    )
    .slice()
    .sort((left, right) => {
      if (sort === "type") return left.title.localeCompare(right.title);
      if (sort === "location")
        return nameOfLocation(left.locationId).localeCompare(nameOfLocation(right.locationId));
      return left.startAt.localeCompare(right.startAt);
    })
    .slice();

  const rows = ordered.slice(0, records);

  function applyPreset(next: Preset): void {
    setPreset(next);
    onDateRange(rangeForPreset(next, today));
  }

  function exportCsv(): void {
    const header = [
      "Class",
      "Location",
      "Trainers",
      "Date",
      "Time",
      "Registrations",
      "Capacity",
      "Status",
    ];
    const lines = [
      header.map(csvCell).join(","),
      // The export is the whole filtered, sorted set, not the page the table happens to show.
      ...ordered.map((row) =>
        [
          row.title,
          nameOfLocation(row.locationId),
          row.instructorIds.join(" "),
          localParts(row.startAt, timezone).date,
          `${timeOf(row.startAt, timezone)} - ${timeOf(row.endAt, timezone)}`,
          String(row.booked),
          row.capacity === null ? "Set capacity" : String(row.capacity),
          row.status,
        ]
          .map(csvCell)
          .join(","),
      ),
    ];
    // jsdom and older browsers may not expose the object URL API; the button then stays inert.
    if (typeof URL.createObjectURL !== "function") return;
    // The BOM keeps accented names readable when the file is opened in Excel.
    const url = URL.createObjectURL(
      new Blob([`\ufeff${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "classes.csv";
    anchor.click();
    if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  }

  return (
    <div className="cs-list">
      <div className="cs-form-row">
        <label className="cs-field">
          <span>Date range</span>
          <select value={preset} onChange={(event) => applyPreset(event.target.value as Preset)}>
            {presets.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="cs-field">
          <span>From</span>
          <input
            type="date"
            value={dateRange?.from ?? ""}
            onChange={(event) => {
              setPreset("custom");
              onDateRange({ from: event.target.value, to: dateRange?.to ?? event.target.value });
            }}
          />
        </label>
        <label className="cs-field">
          <span>To</span>
          <input
            type="date"
            value={dateRange?.to ?? ""}
            onChange={(event) => {
              setPreset("custom");
              onDateRange({ from: dateRange?.from ?? event.target.value, to: event.target.value });
            }}
          />
        </label>
        <button type="button" className="cs-button" onClick={() => applyPreset("today")}>
          Today&apos;s classes/services
        </button>
      </div>
      <div className="cs-form-row">
        <label className="cs-field">
          <span>Location</span>
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">All</option>
            {locations.map((location) => (
              <option key={location.locationId} value={location.locationId}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label className="cs-field">
          <span>Class</span>
          <select value={programId} onChange={(event) => setProgramId(event.target.value)}>
            <option value="">All</option>
            {programs.map((program) => (
              <option key={program.programId} value={program.programId}>
                {program.name}
              </option>
            ))}
          </select>
        </label>
        <label className="cs-field">
          <span>Trainers</span>
          <select value={trainer} onChange={(event) => setTrainer(event.target.value)}>
            <option value="">All</option>
            {trainers.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <label className="cs-field">
          <span>Sort by</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            {sortOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="cs-field">
          <span>Records</span>
          <select value={records} onChange={(event) => setRecords(Number(event.target.value))}>
            {recordOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="cs-field">
          <span>Search</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button type="button" className="cs-button" onClick={exportCsv}>
          Excel
        </button>
      </div>
      <table className="cs-table">
        <thead>
          <tr>
            <th scope="col">Edit</th>
            <th scope="col">Class</th>
            <th scope="col">Location</th>
            <th scope="col">Trainers</th>
            <th scope="col">Date</th>
            <th scope="col">Time</th>
            <th scope="col">Registrations</th>
            <th scope="col">Attendance</th>
            <th scope="col">Results</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const program = programOf(row.programId);
            return (
              <tr key={row.sessionId}>
                <td data-label="Edit">
                  <button
                    type="button"
                    className="cs-button"
                    aria-label={`Edit ${row.title}`}
                    onClick={() => onOpen(row.sessionId)}
                  >
                    Edit
                  </button>
                </td>
                <td data-label="Class">
                  <span className="cs-abbr">{program?.abbreviation ?? "—"}</span> {row.title} Class
                </td>
                <td data-label="Location">{nameOfLocation(row.locationId)}</td>
                <td data-label="Trainers">{row.instructorIds.join(", ")}</td>
                <td data-label="Date">{localParts(row.startAt, timezone).date}</td>
                <td data-label="Time">
                  {timeOf(row.startAt, timezone)} - {timeOf(row.endAt, timezone)}
                </td>
                <td data-label="Registrations">
                  {row.capacity === null ? "Set capacity" : `${row.booked} / ${row.capacity}`}
                </td>
                <td data-label="Attendance">
                  <Link href={`/admin/attendance?session=${row.sessionId}`}>Attendance</Link>
                </td>
                <td data-label="Results">
                  <Link href={`/admin/classes-services/classes?session=${row.sessionId}`}>
                    Results
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="cs-placeholder">No classes in this range.</p> : null}
    </div>
  );
}
