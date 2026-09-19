"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { searchMemberNames } from "../../../lib/member-profile-client";
import { recordHref } from "./profile/member-record";

/**
 * Name search into the canonical member record. The office uses it on Members, the mat on Member
 * search (operator 2026-09-19: one search per role, not two on the office's screens).
 */
type NameSearchState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "too-short" }>
  | Readonly<{ status: "searching" }>
  | Readonly<{ status: "done"; members: readonly { studentId: string; fullName: string }[] }>
  | Readonly<{ status: "error" }>;

export function MemberNameSearch() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<NameSearchState>({ status: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 2) {
      setSearch({ status: "too-short" });
      return;
    }
    setSearch({ status: "searching" });
    try {
      setSearch({ status: "done", members: await searchMemberNames(value) });
    } catch {
      setSearch({ status: "error" });
    }
  }

  return (
    <section aria-labelledby="member-name-search-title" className="admin-panel-card member-search">
      <p className="admin-eyebrow">Members / Search</p>
      <h2 id="member-name-search-title">Find a member</h2>
      <form
        aria-label="Search members by name"
        className="member-search-form"
        onSubmit={(event) => void submit(event)}
        role="search"
      >
        <div className="login-field">
          <label htmlFor="member-name-query">Member name</label>
          <input
            autoComplete="off"
            id="member-name-query"
            maxLength={80}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            value={query}
          />
        </div>
        <button
          className="member-record-button"
          disabled={search.status === "searching"}
          type="submit"
        >
          Search
        </button>
      </form>
      <div aria-label="Member search results" aria-live="polite" role="region">
        {search.status === "idle" ? (
          <p className="member-record-hint">Type at least two letters of a name.</p>
        ) : null}
        {search.status === "too-short" ? (
          <p role="alert">Type at least two letters of a name.</p>
        ) : null}
        {search.status === "searching" ? (
          <div
            aria-label="Searching members"
            className="member-record-skeleton member-search-skeleton"
            role="status"
          >
            <span />
          </div>
        ) : null}
        {search.status === "error" ? (
          <p role="alert">Unable to search members. Please try again.</p>
        ) : null}
        {search.status === "done" && search.members.length === 0 ? (
          <div className="member-record-empty">
            <p className="admin-eyebrow">Search</p>
            <h3>No member found</h3>
            <p>Check the spelling or search for part of the name.</p>
            <button
              className="member-record-button"
              onClick={() => {
                setQuery("");
                setSearch({ status: "idle" });
              }}
              type="button"
            >
              Clear search
            </button>
          </div>
        ) : null}
        {search.status === "done" && search.members.length > 0 ? (
          <ul className="member-search-results">
            {search.members.map((member) => (
              <li key={member.studentId}>
                <span>{member.fullName}</span>
                <Link
                  aria-label={`Open record for ${member.fullName}`}
                  className="member-record-link"
                  href={recordHref(member.studentId)}
                >
                  Open record
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
