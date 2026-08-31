"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionRecord } from "@bpt-jersey/domain/schedule";

import {
  issueNextAdminWaitlistOffer,
  listAdminSessionWaitlist,
  type AdminWaitlistItem,
} from "../../../lib/admin-waitlist-client";
import { listSessions } from "../../../lib/schedule-client";
import { useWaitlistIssuePermission } from "../admin-gate";
import { AdminSectionHeader, AdminStatusBadge } from "../admin-ui";

import "../admin.css";

type LoadState = "loading" | "ready" | "error";

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

function locationLabel(locationId: SessionRecord["locationId"]): string {
  return locationId === "town" ? "Town" : "West";
}

export function AdminWaitlistsPage({ canIssue = true }: { canIssue?: boolean }) {
  const [sessions, setSessions] = useState<readonly SessionRecord[]>([]);
  const [entries, setEntries] = useState<readonly AdminWaitlistItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [queueState, setQueueState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectionGenerationRef = useRef(0);

  useEffect(() => {
    let active = true;
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
    void listSessions({ from: now.toISOString(), to: rangeEnd.toISOString() })
      .then((result) => {
        if (!active) return;
        const futureSessions = Object.freeze(
          [...result]
            .filter(
              (session) =>
                session.status === "scheduled" && Date.parse(session.startAt) > now.getTime(),
            )
            .sort((left, right) => left.startAt.localeCompare(right.startAt)),
        );
        setSessions(futureSessions);
        setSelectedSessionId(futureSessions[0]?.sessionId ?? "");
        setQueueState(futureSessions.length === 0 ? "ready" : "loading");
        setLoadState("ready");
      })
      .catch(() => {
        if (!active) return;
        setLoadState("error");
        setQueueState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return;
    let active = true;
    const generation = selectionGenerationRef.current;
    void listAdminSessionWaitlist(selectedSessionId)
      .then((result) => {
        if (!active || generation !== selectionGenerationRef.current) return;
        setEntries(result);
        setQueueState("ready");
      })
      .catch(() => {
        if (active && generation === selectionGenerationRef.current) setQueueState("error");
      });
    return () => {
      active = false;
    };
  }, [selectedSessionId]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.sessionId === selectedSessionId),
    [selectedSessionId, sessions],
  );
  const waitingCount = entries.reduce(
    (count, entry) => count + (entry.status === "waiting" ? 1 : 0),
    0,
  );
  const hasActiveOffer = entries.some((entry) => entry.status === "offered");

  async function refreshQueue(sessionId: string, generation: number): Promise<void> {
    try {
      const refreshed = await listAdminSessionWaitlist(sessionId);
      if (generation !== selectionGenerationRef.current) return;
      setEntries(refreshed);
      setQueueState("ready");
    } catch {
      if (generation !== selectionGenerationRef.current) return;
      setQueueState("error");
    }
  }

  async function handleIssueNextOffer(): Promise<void> {
    if (!canIssue || !selectedSessionId || waitingCount === 0 || hasActiveOffer || busy) return;
    const generation = selectionGenerationRef.current;
    const sessionId = selectedSessionId;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await issueNextAdminWaitlistOffer(sessionId);
      if (generation !== selectionGenerationRef.current) return;
      setNotice("Offer sent to the next eligible participant.");
      await refreshQueue(sessionId, generation);
    } catch (nextError) {
      if (generation !== selectionGenerationRef.current) return;
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to offer the next place. Please try again.",
      );
    } finally {
      if (generation === selectionGenerationRef.current) setBusy(false);
    }
  }

  return (
    <section aria-label="Class waitlists" className="admin-module-page admin-waitlist-page">
      <AdminSectionHeader
        description={
          canIssue
            ? "Choose a future class and offer its next available place. Eligibility and FIFO order are enforced by the academy."
            : "Choose a future class to inspect its queue. Offer issuance is restricted to owners and administrators."
        }
        eyebrow="Bookings / Mat queue"
        title="Class waitlists"
      />

      <div className="admin-waitlist-layout">
        <section
          aria-labelledby="waitlist-class-title"
          className="admin-panel-card admin-waitlist-control"
        >
          <div>
            <p className="admin-eyebrow">Class control</p>
            <h3 id="waitlist-class-title">Select a future class</h3>
            <p>
              {canIssue
                ? "The next participant is chosen automatically. Staff cannot reorder or select the queue."
                : "This is a read-only queue. You cannot reorder, select, or offer a place."}
            </p>
          </div>
          {loadState === "loading" ? (
            <p className="admin-empty-state" role="status">
              Loading future classes...
            </p>
          ) : loadState === "error" ? (
            <p className="admin-empty-state" role="alert">
              Future classes could not be loaded. Please try again later.
            </p>
          ) : sessions.length === 0 ? (
            <p className="admin-empty-state">No future scheduled classes are available.</p>
          ) : (
            <div className="admin-filter-control admin-waitlist-field">
              <label htmlFor="admin-waitlist-session">Class</label>
              <select
                id="admin-waitlist-session"
                onChange={(event) => {
                  if (event.target.value === selectedSessionId) return;
                  selectionGenerationRef.current += 1;
                  setBusy(false);
                  setSelectedSessionId(event.target.value);
                  setEntries([]);
                  setQueueState("loading");
                  setError("");
                  setNotice("");
                }}
                value={selectedSessionId}
              >
                {sessions.map((session) => (
                  <option key={session.sessionId} value={session.sessionId}>
                    {session.title} / {formatDateTime(session.startAt)} /{" "}
                    {locationLabel(session.locationId)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {canIssue ? (
            <button
              aria-describedby={hasActiveOffer ? "admin-waitlist-active-offer" : undefined}
              className="admin-auth-button admin-waitlist-offer-button"
              disabled={busy || !selectedSessionId || waitingCount === 0 || hasActiveOffer}
              onClick={() => void handleIssueNextOffer()}
              type="button"
            >
              {busy ? "Offering next place..." : "Offer next place"}
            </button>
          ) : (
            <p className="admin-waitlist-active-note">Read-only staff access.</p>
          )}
          {hasActiveOffer ? (
            <p className="admin-waitlist-active-note" id="admin-waitlist-active-offer">
              An offer is already active for this class.
            </p>
          ) : null}
        </section>

        <section
          aria-busy={busy || queueState === "loading"}
          aria-labelledby="waitlist-queue-title"
          className="admin-panel-card admin-waitlist-queue"
        >
          <div className="admin-panel-card-heading">
            <div>
              <p className="admin-eyebrow">FIFO queue</p>
              <h3 id="waitlist-queue-title">{selectedSession?.title ?? "Selected class"}</h3>
            </div>
            <span className="admin-status-badge admin-status-active">{waitingCount} waiting</span>
          </div>

          {error ? (
            <p
              aria-live="assertive"
              className="admin-preview-notice admin-waitlist-error"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p aria-live="polite" className="admin-preview-notice" role="status">
              {notice}
            </p>
          ) : null}

          {queueState === "loading" ? (
            <p className="admin-empty-state" role="status">
              Loading the class queue...
            </p>
          ) : queueState === "error" ? (
            <p className="admin-empty-state" role="alert">
              This class waitlist could not be loaded. Please try again later.
            </p>
          ) : entries.length === 0 ? (
            <p className="admin-empty-state">Nobody is waiting for this class.</p>
          ) : (
            <ol className="admin-waitlist-list" aria-label="Class waitlist positions">
              {entries.map((entry) => (
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
          )}
        </section>
      </div>
    </section>
  );
}

export default function AdminWaitlistsRoute() {
  const canIssue = useWaitlistIssuePermission();
  return <AdminWaitlistsPage canIssue={canIssue} />;
}
