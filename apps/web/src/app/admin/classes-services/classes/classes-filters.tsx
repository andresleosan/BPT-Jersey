"use client";

import type { ReactElement } from "react";

import type { LocationRecord, ProgramRecord, SessionStatus } from "@bpt-jersey/domain/schedule";

import type { StaffOption } from "./session-panel";

export type StatusFilter = "active" | "inactive" | "all";

export type ClassFilters = Readonly<{
  locations: readonly string[];
  programs: readonly string[];
  staff: readonly string[];
  mine: boolean;
  status: StatusFilter;
}>;

export const emptyClassFilters: ClassFilters = Object.freeze({
  locations: [],
  programs: [],
  staff: [],
  mine: false,
  status: "active",
});

/**
 * As on the Regyfit timetable, `active` is every class that took place or will (past ones are
 * `completed`), and `inactive` is only what was cancelled.
 */
export function statusMatches(status: SessionStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  const cancelled = status === "cancelled";
  return filter === "active" ? !cancelled : cancelled;
}

export type ClassesFiltersProps = Readonly<{
  locations: readonly LocationRecord[];
  programs: readonly ProgramRecord[];
  staff: readonly StaffOption[];
  filters: ClassFilters;
  onChange: (filters: ClassFilters) => void;
}>;

type Option = Readonly<{ value: string; label: string }>;

/**
 * A compact multi-select: a native `<details>` summary that opens a group of checkboxes, so the
 * filter row stays one line high like the Regyfit toolbar. Nothing ticked means "all".
 */
function FilterDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly Option[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
}): ReactElement {
  // ponytail: <details> does not close on an outside click; add a listener if staff find it odd.
  return (
    <details className="cs-dropdown">
      <summary>{selected.length ? `${label} · ${selected.length}` : label}</summary>
      <fieldset className="cs-dropdown-panel">
        <legend className="visually-hidden">{label}</legend>
        {options.map((option) => (
          <label key={option.value} className="cs-check">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((value) => value !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

export function ClassesFilters({
  locations,
  programs,
  staff,
  filters,
  onChange,
}: ClassesFiltersProps): ReactElement {
  function patch(change: Partial<ClassFilters>): void {
    onChange({ ...filters, ...change });
  }

  return (
    <div className="cs-filter-row">
      <FilterDropdown
        label="Locations"
        options={locations.map((location) => ({
          value: location.locationId,
          label: location.name,
        }))}
        selected={filters.locations}
        onChange={(values) => patch({ locations: values })}
      />
      <FilterDropdown
        label="Types"
        options={programs.map((program) => ({ value: program.programId, label: program.name }))}
        selected={filters.programs}
        onChange={(values) => patch({ programs: values })}
      />
      <FilterDropdown
        label="Staff"
        options={staff.map((row) => ({ value: row.staffKey, label: row.staffKey }))}
        selected={filters.staff}
        onChange={(values) => patch({ staff: values })}
      />
      <label className="cs-check">
        <input
          type="checkbox"
          checked={filters.mine}
          onChange={(event) => patch({ mine: event.target.checked })}
        />
        Mine
      </label>
      <label className="cs-filter-status">
        <span>Status</span>
        <select
          value={filters.status}
          onChange={(event) => patch({ status: event.target.value as StatusFilter })}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </label>
    </div>
  );
}
