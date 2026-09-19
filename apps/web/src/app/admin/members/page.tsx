"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";

import type { AdminDirectoryRow } from "@bpt-jersey/domain/members/directory";

import {
  initializeMemberDirectory,
  listMembers,
  MemberDirectoryNotProvisionedError,
  MemberDirectoryUninitializedError,
  type MemberDirectoryPage,
} from "../../../lib/members-client";
import { AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { AdminDataTable } from "../admin-data-table";

import { MemberSubscriptionEditor } from "./member-subscription-editor";

import "../admin.css";

type MembersState =
  | { status: "loading" }
  | { status: "ready"; result: MemberDirectoryPage }
  | { status: "error"; message: string; uninitialized: boolean };

const memberPageSize = 50;

function memberValue(value: string | undefined): string {
  return value ?? "—";
}

const memberColumns = [
  {
    key: "membershipReference",
    label: "Membership reference",
    render: (member: AdminDirectoryRow) => (
      <strong>{memberValue(member.membershipReference)}</strong>
    ),
  },
  {
    key: "fullName",
    label: "Name",
    render: (member: AdminDirectoryRow) => member.fullName,
  },
  {
    key: "trainingCenter",
    label: "Training center",
    render: (member: AdminDirectoryRow) => member.trainingCenter,
  },
  {
    key: "participantType",
    label: "Participant type",
    render: (member: AdminDirectoryRow) => member.participantType,
  },
  {
    key: "active",
    label: "Active",
    render: (member: AdminDirectoryRow) => (member.active ? "Yes" : "No"),
  },
  {
    key: "status",
    label: "Status",
    render: (member: AdminDirectoryRow) => <AdminStatusBadge status={member.status} />,
  },
] as const;

function MembersDirectory({
  result,
  onNextPage,
}: {
  result: MemberDirectoryPage;
  onNextPage: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const columns = [
    ...memberColumns,
    {
      key: "subscription",
      label: "Subscription",
      render: (member: AdminDirectoryRow) => (
        <button
          type="button"
          className="admin-auth-button"
          aria-expanded={selected === member.studentId}
          onClick={() =>
            setSelected((current) => (current === member.studentId ? null : member.studentId))
          }
        >
          Edit subscription
        </button>
      ),
    },
  ];
  return (
    <>
      {selected ? <MemberSubscriptionEditor key={selected} studentId={selected} /> : null}
      {result.rows.length === 0 ? (
        <p aria-live="polite" className="admin-no-results" role="status">
          No members available.
        </p>
      ) : (
        <AdminDataTable
          caption="Member directory"
          columns={columns}
          rowKey={(member) => member.studentId}
          rows={result.rows}
        />
      )}
      {result.nextCursor ? (
        <div className="admin-filter-bar">
          <button className="admin-auth-button" onClick={onNextPage} type="button">
            Next page
          </button>
        </div>
      ) : null}
    </>
  );
}

/**
 * Only messages this page recognises reach the screen.
 *
 * The client already sanitizes, but the page does not take that on trust: rendering whatever string
 * an error happens to carry is how a Firebase stack detail ends up in front of a reviewer. So the
 * two diagnosable causes are named types, and everything else keeps the safe sentence.
 */
function failureState(error: unknown): MembersState {
  const diagnosable =
    error instanceof MemberDirectoryUninitializedError ||
    error instanceof MemberDirectoryNotProvisionedError;
  return {
    status: "error",
    message: diagnosable ? (error as Error).message : "Unable to load members. Please try again.",
    uninitialized: error instanceof MemberDirectoryUninitializedError,
  };
}

export function MembersPage() {
  const [state, setState] = useState<MembersState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [initializing, setInitializing] = useState(false);
  const [initializeError, setInitializeError] = useState<string>();

  useEffect(() => {
    let active = true;

    void listMembers(memberPageSize)
      .then((result) => {
        if (active) startTransition(() => setState({ status: "ready", result }));
      })
      .catch((error: unknown) => {
        if (active) startTransition(() => setState(failureState(error)));
      });

    return () => {
      active = false;
    };
  }, [reloadToken]);

  async function handleInitialize(): Promise<void> {
    setInitializing(true);
    setInitializeError(undefined);
    try {
      await initializeMemberDirectory();
      setReloadToken((current) => current + 1);
      startTransition(() => setState({ status: "loading" }));
    } catch (error) {
      setInitializeError(
        error instanceof Error
          ? error.message
          : "Unable to initialize the member directory. Please try again.",
      );
    } finally {
      setInitializing(false);
    }
  }

  function handleNextPage(): void {
    if (state.status !== "ready" || !state.result.nextCursor) return;

    const cursor = state.result.nextCursor;
    startTransition(() => setState({ status: "loading" }));
    void listMembers(memberPageSize, cursor)
      .then((result) => startTransition(() => setState({ status: "ready", result })))
      .catch((error: unknown) => startTransition(() => setState(failureState(error))));
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
            <Link className="admin-home-link" href="/admin/members/recovery">
              Recover member access
            </Link>
            <Link className="admin-home-link" href="/admin/families">
              Families and minors
            </Link>
          </>
        }
        description="The member directory shows only the minimum operational fields for each student."
        eyebrow="Members / Canonical directory"
        title="Members"
      />
      <section className="admin-panel-card" aria-labelledby="member-directory-title">
        <div className="admin-panel-card-heading">
          <div>
            <p className="admin-eyebrow">Directory</p>
            <h3 id="member-directory-title">Member directory</h3>
          </div>
          <Link className="admin-text-link" href="/admin/members/medical">
            Medical conditions
          </Link>
        </div>
        {state.status === "loading" ? (
          <p aria-live="polite" className="admin-no-results" role="status">
            Loading members...
          </p>
        ) : state.status === "error" ? (
          <div className="admin-no-results">
            <p aria-live="assertive" role="alert">
              {state.message}
            </p>
            {/*
              Only shown for the one failure that has a remedy here. The callable is owner-only, so
              an administrator who presses it is told so instead of being left guessing - which is
              the whole reason this page stopped hiding the cause behind "please try again".
            */}
            {state.uninitialized ? (
              <>
                <button
                  className="button"
                  disabled={initializing}
                  onClick={() => void handleInitialize()}
                  type="button"
                >
                  {initializing ? "Initializing..." : "Initialize the member directory"}
                </button>
                {initializeError === undefined ? null : (
                  <p aria-live="assertive" role="alert">
                    {initializeError}
                  </p>
                )}
              </>
            ) : null}
          </div>
        ) : (
          <MembersDirectory result={state.result} onNextPage={handleNextPage} />
        )}
      </section>
    </section>
  );
}

export default function MembersRoute() {
  return <MembersPage />;
}
