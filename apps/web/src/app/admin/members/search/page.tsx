"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  AdminDirectoryRow,
  PublicAdminIdentifierLookupKind,
} from "@bpt-jersey/domain/members/directory";
import type {
  RegyfitMemberDirectoryPage,
  RegyfitMemberDirectoryRow,
  RegyfitMemberRecord,
} from "@bpt-jersey/domain/members/regyfit-records";

import { searchMemberNames } from "../../../../lib/member-profile-client";
import {
  getRegyfitMemberRecord,
  listRegyfitMemberRecords,
  lookupMemberIdentity,
} from "../../../../lib/members-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import { recordHref } from "../profile/member-record";
import { MemberProfilePanel } from "./member-profile-panel";

import "../../admin.css";

type LookupState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "no-match" }>
  | Readonly<{ status: "match"; row: AdminDirectoryRow }>
  | Readonly<{ status: "error" }>;

type DirectoryState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "loaded"; page: RegyfitMemberDirectoryPage }>
  | Readonly<{ status: "error" }>;

type RecordState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading"; recordId: string }>
  | Readonly<{ status: "loaded"; record: RegyfitMemberRecord }>
  | Readonly<{ status: "error"; recordId: string }>;

type NameSearchState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "too-short" }>
  | Readonly<{ status: "searching" }>
  | Readonly<{ status: "done"; members: readonly { studentId: string; fullName: string }[] }>
  | Readonly<{ status: "error" }>;

function NameSearchSection() {
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
          <div aria-label="Searching members" className="member-record-skeleton" role="status">
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
              className="member-record-link"
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

function matchesQuery(row: RegyfitMemberDirectoryRow, query: string): boolean {
  const haystacks = [row.fullName, row.memberNumber, row.email, row.mobile, row.birthDate];
  return haystacks.some((value) => value !== undefined && value.toLowerCase().includes(query));
}

function AcademyMemberDirectorySection({
  directory,
  onRetry,
  onSelectRecord,
  selectedRecordId,
}: {
  directory: DirectoryState;
  onRetry: () => void;
  onSelectRecord: (row: RegyfitMemberDirectoryRow) => void;
  selectedRecordId: string | undefined;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const rows = useMemo(
    () => (directory.status === "loaded" ? directory.page.rows : []),
    [directory],
  );
  const paymentModes = useMemo(
    () =>
      [...new Set(rows.map((row) => row.paymentMode).filter((mode) => mode !== undefined))].sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return rows.filter(
      (row) =>
        (query.length === 0 || matchesQuery(row, query)) &&
        (stateFilter === "all" || row.membershipState === stateFilter) &&
        (paymentFilter === "all" || row.paymentMode === paymentFilter),
    );
  }, [rows, searchQuery, stateFilter, paymentFilter]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
  const safePage = Math.min(page, totalPages - 1);
  const currentRows = filteredRows.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const activeCount = rows.filter((row) => row.membershipState === "active").length;
  const inactiveCount = rows.length - activeCount;
  const numberedCount = rows.filter((row) => row.memberNumber !== undefined).length;

  return (
    <section
      aria-labelledby="directory-search-heading"
      className="admin-panel-card member-search-archive"
    >
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Members / Regyfit archive</p>
          <h3 id="directory-search-heading">Regyfit archive (read only)</h3>
        </div>
      </div>

      {directory.status === "loaded" ? (
        <ul className="member-search-counts">
          <li>Total: {rows.length}</li>
          <li>Active: {activeCount}</li>
          <li>Inactive: {inactiveCount}</li>
          <li>With member Nº: {numberedCount}</li>
          <li>No number: {rows.length - numberedCount}</li>
        </ul>
      ) : null}

      <p className="member-record-hint">
        Records captured from Regyfit
        {directory.status === "loaded" && directory.page.capturedAt !== undefined
          ? ` on ${directory.page.capturedAt.slice(0, 10)}`
          : ""}
        . They are not linked to the canonical record and cannot be edited here.
      </p>

      {directory.status === "loading" ? <p role="status">Loading academy directory...</p> : null}
      {directory.status === "error" ? (
        <div>
          <p aria-live="assertive" role="alert">
            Unable to load the academy directory. Please try again.
          </p>
          <button className="member-record-button" onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : null}

      {directory.status === "loaded" ? (
        <>
          <div className="member-search-filters">
            <div className="login-field">
              <label htmlFor="member-search-input">Search members</label>
              <input
                id="member-search-input"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(0);
                }}
                placeholder="Name, member Nº, email, mobile or birthdate"
                type="text"
                value={searchQuery}
              />
            </div>
            <div className="login-field">
              <label htmlFor="member-status-filter">Status filter</label>
              <select
                id="member-status-filter"
                onChange={(event) => {
                  setStateFilter(event.target.value);
                  setPage(0);
                }}
                value={stateFilter}
              >
                <option value="all">All statuses</option>
                <option value="active">Active ({activeCount})</option>
                <option value="inactive">Inactive ({inactiveCount})</option>
              </select>
            </div>
            <div className="login-field">
              <label htmlFor="member-payment-filter">Payment</label>
              <select
                id="member-payment-filter"
                onChange={(event) => {
                  setPaymentFilter(event.target.value);
                  setPage(0);
                }}
                value={paymentFilter}
              >
                <option value="all">All payment modes</option>
                {paymentModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="member-record-hint">
            Showing {filteredRows.length === 0 ? 0 : safePage * pageSize + 1} -{" "}
            {Math.min((safePage + 1) * pageSize, filteredRows.length)} of {filteredRows.length}{" "}
            members
          </p>

          <div className="admin-data-table-wrap">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Member Nº</th>
                  <th>Name</th>
                  <th>Birthdate</th>
                  <th>E-mail</th>
                  <th>Mobile Nº</th>
                  <th>Payment</th>
                  <th>Belt</th>
                  <th>Membership</th>
                </tr>
              </thead>
              <tbody>
                {currentRows.length === 0 ? (
                  <tr>
                    <td className="member-search-empty-cell" colSpan={8}>
                      No members match your search criteria.
                    </td>
                  </tr>
                ) : (
                  currentRows.map((row) => (
                    <tr
                      key={row.recordId}
                      {...(row.recordId === selectedRecordId
                        ? { "aria-current": "true" as const }
                        : {})}
                    >
                      <td>
                        <button
                          aria-label={`Open full record for ${row.fullName}`}
                          className="member-search-number"
                          onClick={() => onSelectRecord(row)}
                          type="button"
                        >
                          {row.memberNumber ?? `#${row.recordId}`}
                        </button>
                      </td>
                      <td>
                        <strong>{row.fullName}</strong>
                      </td>
                      <td>{row.birthDate ?? "—"}</td>
                      <td>{row.email ?? "—"}</td>
                      <td>{row.mobile ?? "—"}</td>
                      <td>{row.paymentMode ?? "—"}</td>
                      <td>{row.belt ?? "—"}</td>
                      <td>{row.membershipState === "active" ? "Active" : "Inactive"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="member-search-pagination">
              <span>
                Page {safePage + 1} of {totalPages}
              </span>
              <div>
                <button
                  className="member-record-link"
                  disabled={safePage === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  type="button"
                >
                  Previous
                </button>
                <button
                  className="member-record-link"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ExactLookupSection({
  lookupKind,
  identifier,
  lookup,
  onKindChange,
  onIdentifierChange,
  onSubmit,
}: {
  lookupKind: PublicAdminIdentifierLookupKind;
  identifier: string;
  lookup: LookupState;
  onKindChange: (kind: PublicAdminIdentifierLookupKind) => void;
  onIdentifierChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section aria-labelledby="member-search-title" className="admin-panel-card member-search">
      <p className="admin-eyebrow">Members / Exact lookup</p>
      <h3 id="member-search-title">Find by identifier</h3>
      <p className="member-record-hint">
        Search by one exact approved identifier. Every lookup is audited.
      </p>
      <form className="member-search-form" onSubmit={onSubmit}>
        <div className="login-field">
          <label htmlFor="member-lookup-kind">Identifier type</label>
          <select
            id="member-lookup-kind"
            onChange={(event) =>
              onKindChange(event.target.value as PublicAdminIdentifierLookupKind)
            }
            value={lookupKind}
          >
            <option value="membership-number">Membership number</option>
            <option value="id-card-number">ID card number</option>
            <option value="vat-number">VAT number</option>
          </select>
        </div>
        <div className="login-field">
          <label htmlFor="member-exact-identifier">Exact identifier</label>
          <input
            autoComplete="off"
            id="member-exact-identifier"
            onChange={(event) => onIdentifierChange(event.target.value)}
            required
            type="text"
            value={identifier}
          />
        </div>
        <button
          className="member-record-button"
          disabled={lookup.status === "loading"}
          type="submit"
        >
          {lookup.status === "loading" ? "Searching..." : "Search exact identifier"}
        </button>
      </form>

      <section aria-busy={lookup.status === "loading"} aria-label="Member lookup result">
        {lookup.status === "idle" ? (
          <p className="member-record-hint">Search to see a member.</p>
        ) : null}
        {lookup.status === "loading" ? <p role="status">Searching...</p> : null}
        {lookup.status === "no-match" ? (
          <p aria-live="polite" role="status">
            No matching student was found.
          </p>
        ) : null}
        {lookup.status === "error" ? (
          <p aria-live="assertive" role="alert">
            Unable to find member. Please try again.
          </p>
        ) : null}
        {lookup.status === "match" ? (
          <ul className="member-search-results">
            <li>
              <span>
                <strong>{lookup.row.fullName}</strong>{" "}
                <span>{lookup.row.membershipReference ?? "No reference"}</span>
              </span>
              <Link
                aria-label={`Open record for ${lookup.row.fullName}`}
                className="member-record-link"
                href={recordHref(lookup.row.studentId)}
              >
                Open record
              </Link>
            </li>
          </ul>
        ) : null}
      </section>
    </section>
  );
}

function SearchMembersContent() {
  const session = useAdminOrStaffSession();
  const office = session.role === "owner" || session.role === "administrator";
  const [lookupKind, setLookupKind] =
    useState<PublicAdminIdentifierLookupKind>("membership-number");
  const [identifier, setIdentifier] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const [directory, setDirectory] = useState<DirectoryState>({ status: "loading" });
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const [selected, setSelected] = useState<RecordState>({ status: "idle" });

  useEffect(() => {
    if (!office) return undefined;
    let cancelled = false;
    setDirectory({ status: "loading" });
    async function loadDirectory(): Promise<void> {
      try {
        const page = await listRegyfitMemberRecords();
        if (!Array.isArray(page?.rows)) throw new Error("directory unavailable");
        if (!cancelled) setDirectory({ status: "loaded", page });
      } catch {
        if (!cancelled) setDirectory({ status: "error" });
      }
    }
    void loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [directoryAttempt, office]);

  async function runLookup(
    kind: PublicAdminIdentifierLookupKind,
    rawIdentifier: string,
  ): Promise<void> {
    const value = rawIdentifier.trim();
    if (value.length === 0) {
      setLookup({ status: "error" });
      return;
    }
    setLookup({ status: "loading" });
    try {
      const result = await lookupMemberIdentity(kind, value);
      setLookup(result.matched ? { status: "match", row: result.row } : { status: "no-match" });
    } catch {
      setLookup({ status: "error" });
    }
  }

  function handleCanonicalLookup(membershipNumber: string): void {
    setLookupKind("membership-number");
    setIdentifier(membershipNumber);
    void runLookup("membership-number", membershipNumber);
  }

  async function openRecord(row: RegyfitMemberDirectoryRow): Promise<void> {
    setSelected({ status: "loading", recordId: row.recordId });
    if (row.memberNumber !== undefined) {
      setLookupKind("membership-number");
      setIdentifier(row.memberNumber);
    }
    try {
      const record = await getRegyfitMemberRecord(row.recordId);
      setSelected((current) =>
        current.status === "loading" && current.recordId === row.recordId
          ? { status: "loaded", record }
          : current,
      );
    } catch {
      setSelected((current) =>
        current.status === "loading" && current.recordId === row.recordId
          ? { status: "error", recordId: row.recordId }
          : current,
      );
    }
  }

  let selectedRecordId: string | undefined;
  if (selected.status === "loaded") selectedRecordId = selected.record.recordId;
  else if (selected.status !== "idle") selectedRecordId = selected.recordId;

  return (
    <>
      <NameSearchSection />
      {office ? (
        <ExactLookupSection
          identifier={identifier}
          lookup={lookup}
          lookupKind={lookupKind}
          onIdentifierChange={setIdentifier}
          onKindChange={setLookupKind}
          onSubmit={(event) => {
            event.preventDefault();
            void runLookup(lookupKind, identifier);
          }}
        />
      ) : null}
      {office && selected.status === "loading" ? (
        <p className="admin-panel-card" role="status">
          Loading member record...
        </p>
      ) : null}
      {office && selected.status === "error" ? (
        <p aria-live="assertive" className="admin-panel-card" role="alert">
          Unable to load the member record. Please try again.
        </p>
      ) : null}
      {office && selected.status === "loaded" ? (
        <MemberProfilePanel
          onCanonicalLookup={handleCanonicalLookup}
          onClose={() => setSelected({ status: "idle" })}
          record={selected.record}
        />
      ) : null}
      {office ? (
        <AcademyMemberDirectorySection
          directory={directory}
          onRetry={() => setDirectoryAttempt((attempt) => attempt + 1)}
          onSelectRecord={(row) => void openRecord(row)}
          selectedRecordId={selectedRecordId}
        />
      ) : null}
    </>
  );
}

export function SearchMembersPage() {
  return <SearchMembersContent />;
}

export default function SearchMembersRoute() {
  return <SearchMembersPage />;
}
