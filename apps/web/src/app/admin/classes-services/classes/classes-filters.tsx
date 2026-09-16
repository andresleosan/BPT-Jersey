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

/** `active` covers the two live states; `inactive` covers the two closed ones. */
export function statusMatches(status: SessionStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  const live = status === "scheduled" || status === "active";
  return filter === "active" ? live : !live;
}

export type ClassesFiltersProps = Readonly<{
  locations: readonly LocationRecord[];
  programs: readonly ProgramRecord[];
  staff: readonly StaffOption[];
  filters: ClassFilters;
  onChange: (filters: ClassFilters) => void;
}>;

function selection(event: { target: HTMLSelectElement }): string[] {
  return [...event.target.selectedOptions].map((option) => option.value);
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
    <div className="cs-form-row">
      <label className="cs-field">
        <span>Locations</span>
        <select
          multiple
          value={filters.locations}
          onChange={(event) => patch({ locations: selection(event) })}
        >
          {locations.map((location) => (
            <option key={location.locationId} value={location.locationId}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <label className="cs-field">
        <span>Types</span>
        <select
          multiple
          value={filters.programs}
          onChange={(event) => patch({ programs: selection(event) })}
        >
          {programs.map((program) => (
            <option key={program.programId} value={program.programId}>
              {program.name}
            </option>
          ))}
        </select>
      </label>
      <label className="cs-field">
        <span>Staff</span>
        <select
          multiple
          value={filters.staff}
          onChange={(event) => patch({ staff: selection(event) })}
        >
          {staff.map((row) => (
            <option key={row.staffKey} value={row.staffKey}>
              {row.staffKey}
            </option>
          ))}
        </select>
      </label>
      <label className="cs-check">
        <input
          type="checkbox"
          checked={filters.mine}
          onChange={(event) => patch({ mine: event.target.checked })}
        />
        Mine
      </label>
      <label className="cs-field">
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
