"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";

import {
  searchMembers,
  type MemberSearchProjection,
  type MemberSearchResult,
} from "../../../lib/members-client";
import { AdminDataTable, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";

import "../admin.css";

type MembersState =
  { status: "loading" } | { status: "ready"; result: MemberSearchResult } | { status: "error" };

function memberValue(value: string | undefined): string {
  return value ?? "—";
}

const memberColumns = [
  {
    key: "membershipNumber",
    label: "Membership number",
    render: (member: MemberSearchProjection) => (
      <strong>{memberValue(member.membershipNumber)}</strong>
    ),
  },
  { key: "fullName", label: "Name", render: (member: MemberSearchProjection) => member.fullName },
  {
    key: "email",
    label: "Email",
    render: (member: MemberSearchProjection) => memberValue(member.email),
  },
  {
    key: "idCardNumber",
    label: "ID card number",
    render: (member: MemberSearchProjection) => memberValue(member.idCardNumber),
  },
  {
    key: "vatNumber",
    label: "VAT number",
    render: (member: MemberSearchProjection) => memberValue(member.vatNumber),
  },
  {
    key: "birthDate",
    label: "Birth date",
    render: (member: MemberSearchProjection) => memberValue(member.birthDate),
  },
  {
    key: "mobileNumber",
    label: "Mobile number",
    render: (member: MemberSearchProjection) => memberValue(member.mobileNumber),
  },
  {
    key: "frequency",
    label: "Frequency",
    render: (member: MemberSearchProjection) => memberValue(member.frequency),
  },
  {
    key: "paymentStatus",
    label: "Payment / status",
    render: (member: MemberSearchProjection) => (
      <span className="admin-member-status-cell">
        <AdminStatusBadge status={member.paymentStatus} />
        <AdminStatusBadge status={member.membershipStatus} />
      </span>
    ),
  },
  { key: "gender", label: "Gender", render: (member: MemberSearchProjection) => member.gender },
  {
    key: "trainingCenter",
    label: "Training center",
    render: (member: MemberSearchProjection) => memberValue(member.trainingCenter),
  },
] as const;

function MembersDirectory({
  result,
  loading,
  onNextPage,
}: {
  result: MemberSearchResult;
  loading: boolean;
  onNextPage: () => void;
}) {
  return (
    <>
      {result.members.length === 0 ? (
        <p aria-live="polite" className="admin-no-results" role="status">
          No members available.
        </p>
      ) : (
        <AdminDataTable
          caption="Member directory"
          columns={memberColumns}
          rowKey={(member) => member.memberId}
          rows={result.members}
        />
      )}
      {result.nextPageToken ? (
        <div className="admin-filter-bar">
          <button
            className="admin-auth-button"
            disabled={loading}
            onClick={onNextPage}
            type="button"
          >
            Next page
          </button>
        </div>
      ) : null}
    </>
  );
}

export function MembersPage() {
  const [state, setState] = useState<MembersState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    void searchMembers({ orderBy: "name" })
      .then((result) => {
        if (active) startTransition(() => setState({ status: "ready", result }));
      })
      .catch(() => {
        if (active) startTransition(() => setState({ status: "error" }));
      });

    return () => {
      active = false;
    };
  }, []);

  function handleNextPage(): void {
    if (state.status !== "ready" || !state.result.nextPageToken) return;

    const pageToken = state.result.nextPageToken;
    startTransition(() => setState({ status: "loading" }));
    void searchMembers({ orderBy: "name" }, pageToken)
      .then((result) => startTransition(() => setState({ status: "ready", result })))
      .catch(() => startTransition(() => setState({ status: "error" })));
  }

  return (
    <section className="admin-module-page" aria-labelledby="members-title">
      <AdminSectionHeader
        actions={
          <>
            <Link className="admin-auth-button" href="/admin/members/add">
              Add new member
            </Link>
            <Link className="admin-home-link" href="/admin/members/search">
              Search members
            </Link>
          </>
        }
        description="The member directory shows the approved fields from the connected member source."
        eyebrow="Members / Connected directory"
        title="Members"
      />
      <section className="admin-panel-card" aria-labelledby="member-directory-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Directory</p>
            <h3 id="member-directory-title">Member directory</h3>
          </div>
          <AdminStatusBadge status="Staging import" />
        </div>
        {state.status === "loading" ? (
          <p aria-live="polite" className="admin-no-results" role="status">
            Loading members...
          </p>
        ) : state.status === "error" ? (
          <p aria-live="assertive" className="admin-no-results" role="alert">
            Unable to load members. Please try again.
          </p>
        ) : (
          <MembersDirectory result={state.result} loading={false} onNextPage={handleNextPage} />
        )}
      </section>
    </section>
  );
}

export default function MembersRoute() {
  return <MembersPage />;
}
