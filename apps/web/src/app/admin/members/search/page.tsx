"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type {
  AdminDirectoryRow,
  PublicAdminIdentifierLookupKind,
} from "@bpt-jersey/domain/members/directory";

import { lookupMemberIdentity } from "../../../../lib/members-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import { recordHref } from "../profile/member-record";
import { MemberNameSearch } from "../member-name-search";

import "../../admin.css";

type LookupState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "no-match" }>
  | Readonly<{ status: "match"; row: AdminDirectoryRow }>
  | Readonly<{ status: "error" }>;

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
  const router = useRouter();
  // The office's directory is /admin/members now; this page stays the mat's search and, with
  // `?archive`, the office's exact identifier lookup. The address is read in the effect: after a
  // link, Next writes the new address only once the page has rendered.
  useEffect(() => {
    if (office && !new URLSearchParams(window.location.search).has("archive"))
      router.replace("/admin/members");
  }, [office, router]);
  const [lookupKind, setLookupKind] =
    useState<PublicAdminIdentifierLookupKind>("membership-number");
  const [identifier, setIdentifier] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });

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

  return (
    <>
      {/* Operator 2026-09-19: the office already searches from Members, so the name search is the
          mat's way into a record only. */}
      {office ? null : <MemberNameSearch />}
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
    </>
  );
}

export function SearchMembersPage() {
  return <SearchMembersContent />;
}

export default function SearchMembersRoute() {
  return <SearchMembersPage />;
}
