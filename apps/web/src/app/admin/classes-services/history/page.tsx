"use client";

import { useMemo, useState, type FormEvent } from "react";

import {
  classHistoryRegistrationTypes,
  formatJerseyMoment,
  type ClassHistoryRegistrationType,
  type ClassHistoryRow,
} from "@bpt-jersey/domain/audit/class-history";

import {
  downloadClassHistoryPdf,
  fetchClassHistory,
  type FetchClassHistoryInput,
} from "../../../../lib/class-history-client";
import { useAdminOrStaffSession } from "../../admin-gate";

import "./history.css";

const registrationTypeLabels: Record<ClassHistoryRegistrationType, string> = {
  all: "All",
  "member-bookings": "Member bookings",
  "member-cancellations": "Member cancellations",
  "dropin-bookings": "Drop-in bookings",
  "dropin-cancellations": "Drop-in cancellations",
  "coach-bookings": "Bookings made by staff",
  "coach-cancellations": "Cancellations made by staff",
  "coach-dropin-bookings": "Drop-ins given by staff",
  "coach-dropin-cancellations": "Drop-ins cancelled by staff",
  attendance: "Attendance",
};

/** The service clamps to 100...1000, so the screen never offers a number it would silently change. */
const recordCounts = [100, 250, 500, 1000] as const;

const dash = "—";

type LoadStatus = "idle" | "loading" | "ready" | "error";

type Actor = Readonly<{ actorId: string; label: string }>;

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** The date and time boxes are read together: an empty time box means midnight. */
function sinceTimestamp(date: string, time: string): string {
  return `${date}T${time === "" ? "00:00" : time}:00Z`;
}

export function HistoryPage() {
  const session = useAdminOrStaffSession();
  const [sinceDate, setSinceDate] = useState(() => isoDateDaysAgo(30));
  const [sinceTime, setSinceTime] = useState("");
  const [actorId, setActorId] = useState("");
  const [registrationType, setRegistrationType] = useState<ClassHistoryRegistrationType>("all");
  const [limit, setLimit] = useState<number>(recordCounts[0]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [rows, setRows] = useState<readonly ClassHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Every actor the screen has already seen, so choosing one never removes them from the list.
  const [actors, setActors] = useState<readonly Actor[]>([]);

  const query = (): FetchClassHistoryInput => ({
    academyId: session.academyId,
    since: sinceTimestamp(sinceDate, sinceTime),
    actorId: actorId === "" ? null : actorId,
    registrationType,
    limit,
    cursor: null,
  });

  function rememberActors(listed: readonly ClassHistoryRow[]): void {
    setActors((current) => {
      const known = new Map(current.map((actor) => [actor.actorId, actor]));
      for (const row of listed) {
        if (!known.has(row.actorId)) {
          known.set(row.actorId, { actorId: row.actorId, label: row.actorName ?? row.actorId });
        }
      }
      return [...known.values()].sort((a, b) => a.label.localeCompare(b.label));
    });
  }

  async function onList(event: FormEvent): Promise<void> {
    event.preventDefault();
    setStatus("loading");
    setError(null);
    try {
      const listing = await fetchClassHistory(query());
      setRows(listing.rows);
      rememberActors(listing.rows);
      setStatus("ready");
    } catch (caught) {
      setRows([]);
      setError((caught as Error).message);
      setStatus("error");
    }
  }

  async function onExportPdf(): Promise<void> {
    setError(null);
    try {
      const { blob, fileName } = await downloadClassHistoryPdf(query());
      // The client hands back bytes on purpose; triggering the save belongs to the screen.
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  // A coach never reaches this tab, but the screen does not presume: with no address on any row
  // the column is dropped rather than printed as a wall of dashes.
  const showIp = useMemo(() => rows.some((row) => row.actorIp !== null), [rows]);

  return (
    <>
      <section className="cs-card">
        <h2>Class registrations log</h2>
        <form className="cs-form-row" onSubmit={(event) => void onList(event)}>
          <div className="cs-field">
            <label htmlFor="history-since-date">Since</label>
            <input
              id="history-since-date"
              onChange={(event) => setSinceDate(event.target.value)}
              required
              type="date"
              value={sinceDate}
            />
          </div>
          <div className="cs-field">
            <label htmlFor="history-since-time">Since time</label>
            <input
              id="history-since-time"
              onChange={(event) => setSinceTime(event.target.value)}
              type="time"
              value={sinceTime}
            />
          </div>
          <div className="cs-field">
            <label htmlFor="history-actor">Logged by</label>
            <select
              aria-describedby="history-actor-hint"
              id="history-actor"
              onChange={(event) => setActorId(event.target.value)}
              value={actorId}
            >
              <option value="">Anyone</option>
              {actors.map((actor) => (
                <option key={actor.actorId} value={actor.actorId}>
                  {actor.label}
                </option>
              ))}
            </select>
            <small id="history-actor-hint">People seen in the records listed so far.</small>
          </div>
          <div className="cs-field">
            <label htmlFor="history-registration-type">Registration type</label>
            <select
              id="history-registration-type"
              onChange={(event) =>
                setRegistrationType(event.target.value as ClassHistoryRegistrationType)
              }
              value={registrationType}
            >
              {classHistoryRegistrationTypes.map((type) => (
                <option key={type} value={type}>
                  {registrationTypeLabels[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="cs-field">
            <label htmlFor="history-limit">No. of records</label>
            <select
              id="history-limit"
              onChange={(event) => setLimit(Number(event.target.value))}
              value={limit}
            >
              {recordCounts.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </div>
          <button className="cs-button cs-button-primary" type="submit">
            LIST
          </button>
        </form>
      </section>

      {error !== null ? (
        <p className="cs-notice" data-kind="error" role="alert">
          {error}
        </p>
      ) : null}

      {status === "idle" ? (
        <p className="cs-placeholder">Choose the filters and press LIST to read the log.</p>
      ) : null}

      {status === "loading" || status === "ready" ? (
        <section aria-busy={status === "loading"} className="cs-card">
          <div className="cs-history-header">
            <h2 aria-live="polite">
              {status === "ready" ? `RECORDS (${rows.length})` : "RECORDS"}
            </h2>
            <button
              className="cs-button"
              disabled={status !== "ready" || rows.length === 0}
              onClick={() => void onExportPdf()}
              type="button"
            >
              PDF
            </button>
          </div>

          {status === "loading" ? (
            <div className="cs-history-skeleton">
              {Array.from({ length: 8 }, (_, index) => (
                <span className="cs-history-skeleton-row" key={index} />
              ))}
            </div>
          ) : null}

          {status === "ready" ? (
            <p className="cs-history-note">
              {rows.length === 0
                ? "The log answered with no records."
                : `The most recent ${rows.length} records written for these filters. The log does not count how many more there are.`}
            </p>
          ) : null}

          {status === "ready" && rows.length === 0 ? (
            <p className="cs-history-empty">No records for these filters.</p>
          ) : null}

          {status === "ready" && rows.length > 0 ? (
            <table className="cs-table cs-history-table">
              <caption className="visually-hidden">Class registrations log</caption>
              <thead>
                <tr>
                  <th scope="col">Date/time</th>
                  <th scope="col">User</th>
                  {showIp ? <th scope="col">IP</th> : null}
                  <th scope="col">Task</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="cs-history-when" data-label="Date/time">
                      {formatJerseyMoment(row.occurredAt) ?? row.occurredAt}
                    </td>
                    <td data-label="User">{row.actorName ?? dash}</td>
                    {showIp ? (
                      <td className="cs-history-ip" data-label="IP">
                        {row.actorIp ?? dash}
                      </td>
                    ) : null}
                    <td className="cs-history-task" data-label="Task">
                      {row.sentence}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

export default HistoryPage;
