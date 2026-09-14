"use client";

import { useId, useState } from "react";
import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";

import "./billing.css";

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function filterMembers(
  members: readonly MemberNameRow[],
  query: string,
  limit = 8,
): readonly MemberNameRow[] {
  const needle = fold(query.trim());
  if (needle.length < 2) return Object.freeze([]);
  return Object.freeze(
    members.filter((member) => fold(member.fullName).includes(needle)).slice(0, limit),
  );
}

export type MemberPickerProps = Readonly<{
  members: readonly MemberNameRow[] | null;
  error?: string | undefined;
  selected: MemberNameRow | null;
  onSelect: (member: MemberNameRow | null) => void;
  label?: string;
  autoFocus?: boolean;
}>;

export function MemberPicker({
  members,
  error,
  selected,
  onSelect,
  label = "Find a member",
  autoFocus = false,
}: MemberPickerProps) {
  const [query, setQuery] = useState("");
  const listId = useId();
  if (selected) {
    return (
      <div className="member-picker member-picker-selected">
        <div>
          <p className="admin-eyebrow">Member</p>
          <strong>{selected.fullName}</strong>
          {selected.familyId ? null : <small>No billing family on record</small>}
        </div>
        <button className="button button-secondary" onClick={() => onSelect(null)} type="button">
          Change member
        </button>
      </div>
    );
  }
  const matches = members ? filterMembers(members, query) : [];
  return (
    <div className="member-picker">
      <label className="family-field">
        {label}
        <input
          aria-controls={matches.length > 0 ? listId : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={members === null && !error}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            members === null && !error ? "Loading members…" : "Type at least two letters"
          }
          type="search"
          value={query}
        />
      </label>
      {error ? (
        <p className="family-error" role="alert">
          {error}
        </p>
      ) : null}
      {query.trim().length >= 2 && members && matches.length === 0 ? (
        <p className="member-picker-empty" role="status">
          No member matches “{query.trim()}”.
        </p>
      ) : null}
      {matches.length > 0 ? (
        <ul
          className="member-picker-options"
          id={listId}
          role="listbox"
          aria-label={`${label} results`}
        >
          {matches.map((member) => {
            const choose = () => {
              onSelect(member);
              setQuery("");
            };
            return (
              <li
                key={member.studentId}
                role="option"
                aria-selected={false}
                className="member-picker-option"
                tabIndex={0}
                onClick={choose}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose();
                  }
                }}
              >
                {member.fullName}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
