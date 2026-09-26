"use client";

import { useEffect, useRef, useState } from "react";

import {
  issueNextAdminWaitlistOffer,
  listAdminWaitlistGroups,
  type AdminWaitlistGroup,
  type AdminWaitlistItem,
} from "../../../lib/admin-waitlist-client";
import { locationLabel } from "../../../lib/location-label";
import { useWaitlistIssuePermission } from "../admin-gate";
import { AdminSectionHeader, AdminStatusBadge } from "../admin-ui";

import "../admin.css";
import "./waitlists.css";

type LoadState = "loading" | "ready" | "error";

const allGroups = "all";

const statusLabels: Readonly<Record<AdminWaitlistItem["status"], string>> = {
  waiting: "Waiting",
  offered: "Offered",
  accepted: "Accepted",
  expired: "Expired",
  cancelled: "Cancelled",
};

const jerseyDateTime = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Jersey",
});

function formatDateTime(value: string): string {
  return jerseyDateTime.format(new Date(value));
}

function writeGroupToUrl(groupId: string): void {
  const url = new URL(window.location.href);
  if (groupId === allGroups) url.searchParams.delete("group");
  else url.searchParams.set("group", groupId);
  window.history.replaceState(null, "", url);
}

export function AdminWaitlistsPage({ canIssue = true }: { canIssue?: boolean }) {
  const [groups, setGroups] = useState<readonly AdminWaitlistGroup[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedGroupId, setSelectedGroupId] = useState(allGroups);
  const [busySessionId, setBusySessionId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  // The `?group=` value is read once, on the first load; later reloads keep the live selection.
  const requestedGroupRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    if (requestedGroupRef.current === undefined) {
      requestedGroupRef.current = new URLSearchParams(window.location.search).get("group");
    }
    void listAdminWaitlistGroups()
      .then((result) => {
        if (!active) return;
        setGroups(result);
        setLoadState("ready");
        const requested = requestedGroupRef.current;
        requestedGroupRef.current = null;
        if (requested && result.some((group) => group.groupId === requested)) {
          setSelectedGroupId(requested);
        }
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const visibleGroups =
    selectedGroupId === allGroups
      ? groups
      : groups.filter((group) => group.groupId === selectedGroupId);

  function selectGroup(groupId: string): void {
    setSelectedGroupId(groupId);
    writeGroupToUrl(groupId);
  }

  async function handleIssueNextOffer(sessionId: string): Promise<void> {
    if (!canIssue || busySessionId) return;
    setBusySessionId(sessionId);
    setError("");
    setNotice("");
    try {
      await issueNextAdminWaitlistOffer(sessionId);
      setNotice("Offer sent to the next eligible participant.");
      setReloadToken((token) => token + 1);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to offer the next place. Please try again.",
      );
    } finally {
      setBusySessionId("");
    }
  }

  return (
    <section aria-label="Class waitlists" className="admin-module-page admin-waitlist-page">
      <AdminSectionHeader
        description={
          canIssue
            ? "Queues are grouped by class. Offer the next available place on a given date. Eligibility and FIFO order are enforced by the academy."
            : "Queues are grouped by class. Offer issuance is restricted to owners and administrators."
        }
        eyebrow="Bookings / Mat queue"
        title="Class waitlists"
      />

      <section
        aria-labelledby="waitlist-group-title"
        className="admin-panel-card waitlists-control"
      >
        <div>
          <p className="admin-eyebrow">Class control</p>
          <h3 id="waitlist-group-title">Choose a group</h3>
          <p>
            {canIssue
              ? "The next participant is chosen automatically. Staff cannot reorder or select the queue."
              : "Read-only staff access."}
          </p>
        </div>
        {loadState === "ready" && groups.length > 0 ? (
          <div className="admin-filter-control waitlists-field">
            <label htmlFor="admin-waitlist-group">Group</label>
            <select
              id="admin-waitlist-group"
              onChange={(event) => selectGroup(event.target.value)}
              value={selectedGroupId}
            >
              <option value={allGroups}>All groups</option>
              {groups.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.title} / {locationLabel(group.location)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </section>

      {error ? (
        <p aria-live="assertive" className="admin-preview-notice waitlists-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p aria-live="polite" className="admin-preview-notice" role="status">
          {notice}
        </p>
      ) : null}

      {loadState === "loading" ? (
        <p className="admin-empty-state" role="status">
          Loading class waitlists...
        </p>
      ) : loadState === "error" ? (
        <p className="admin-empty-state" role="alert">
          Class waitlists could not be loaded. Please try again later.
        </p>
      ) : groups.length === 0 ? (
        <p className="admin-empty-state">Nobody is waiting for a future class.</p>
      ) : (
        <div className="waitlists-groups">
          {visibleGroups.map((group, groupIndex) => (
            <article
              aria-labelledby={"waitlist-group-" + groupIndex}
              className="admin-panel-card waitlists-group"
              key={group.groupId}
            >
              <header className="waitlists-group-heading">
                <div>
                  <p className="admin-eyebrow">{locationLabel(group.location)}</p>
                  <h3 id={"waitlist-group-" + groupIndex}>{group.title}</h3>
                </div>
                <p className="waitlists-count">{group.count} waiting</p>
              </header>
              {group.sessions.map((session, sessionIndex) => {
                const dateLabel = formatDateTime(session.startAt);
                const waitingCount = session.entries.filter(
                  (entry) => entry.status === "waiting",
                ).length;
                const hasActiveOffer = session.entries.some((entry) => entry.status === "offered");
                const noteId = "waitlist-active-" + groupIndex + "-" + sessionIndex;
                return (
                  <section
                    aria-busy={busySessionId === session.sessionId}
                    aria-label={group.title + ", " + dateLabel}
                    className="waitlists-session"
                    key={session.sessionId}
                  >
                    <div className="waitlists-session-heading">
                      <h4>{dateLabel}</h4>
                      {canIssue ? (
                        <button
                          aria-describedby={hasActiveOffer ? noteId : undefined}
                          className="admin-auth-button waitlists-offer-button"
                          disabled={busySessionId !== "" || waitingCount === 0 || hasActiveOffer}
                          onClick={() => void handleIssueNextOffer(session.sessionId)}
                          type="button"
                        >
                          {busySessionId === session.sessionId
                            ? "Offering next place..."
                            : "Offer next place"}
                        </button>
                      ) : null}
                    </div>
                    {hasActiveOffer ? (
                      <p className="admin-waitlist-active-note" id={noteId}>
                        An offer is already active for this date.
                      </p>
                    ) : null}
                    <ol className="admin-waitlist-list" aria-label="Class waitlist positions">
                      {session.entries.map((entry) => (
                        <li key={entry.studentReference + ":" + entry.requestedAt}>
                          <span
                            aria-label={`Queue position ${entry.position}`}
                            className="admin-waitlist-position"
                          >
                            {String(entry.position).padStart(2, "0")}
                          </span>
                          <div>
                            <strong>Queue place</strong>
                            <span>Requested {formatDateTime(entry.requestedAt)}</span>
                          </div>
                          <AdminStatusBadge status={statusLabels[entry.status]} />
                        </li>
                      ))}
                    </ol>
                  </section>
                );
              })}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AdminWaitlistsRoute() {
  const canIssue = useWaitlistIssuePermission();
  return <AdminWaitlistsPage canIssue={canIssue} />;
}
