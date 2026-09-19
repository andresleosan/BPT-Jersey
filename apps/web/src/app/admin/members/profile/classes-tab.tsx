"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  MemberClassCursor,
  MemberClassPage,
  MemberClassQuery,
} from "@bpt-jersey/domain/schedule/member-class-records";
import {
  getMemberClassRecords,
  MemberClassLoadError,
} from "../../../../lib/member-class-records-client";
type Row = MemberClassPage["rows"][number];
type State = {
  rows: Row[];
  nextCursor: MemberClassCursor | null;
  pending: boolean;
  loaded: boolean;
  error: string | null;
};
const initial: State = { rows: [], nextCursor: null, pending: true, loaded: false, error: null };
const dateTime = (at: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Jersey",
  }).format(new Date(at));
const methods = {
  qr: "QR",
  pin: "PIN",
  nameSearch: "Name search",
  manual: "Manual",
  self: "Self check-in",
};
const label = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
function ClassSection({ studentId, kind }: { studentId: string; kind: MemberClassQuery["kind"] }) {
  const title = kind === "bookings" ? "Booking activity" : "Attendance";
  const [state, setState] = useState<State>(initial);
  const [request, setRequest] = useState<{ cursor?: MemberClassCursor; attempt: number }>({
    attempt: 0,
  });
  useEffect(() => {
    let active = true;
    setState((previous) =>
      request.cursor ? { ...previous, pending: true, error: null } : initial,
    );
    getMemberClassRecords({
      studentId,
      kind,
      ...(request.cursor ? { cursor: request.cursor } : {}),
    }).then(
      (page) => {
        if (!active) return;
        setState((previous) => ({
          rows: [
            ...new Map(
              [...(request.cursor ? previous.rows : []), ...page.rows].map((row) => [
                row.recordId,
                row,
              ]),
            ).values(),
          ],
          nextCursor: page.nextCursor,
          pending: false,
          loaded: true,
          error: null,
        }));
      },
      (error: unknown) => {
        if (active)
          setState((previous) => ({
            ...previous,
            pending: false,
            error:
              error instanceof MemberClassLoadError
                ? error.message
                : "Unable to load class history. Refresh to try again.",
          }));
      },
    );
    return () => {
      active = false;
    };
  }, [studentId, kind, request]);
  return (
    <section aria-label={title}>
      <div className="member-subscription-actions">
        <h3>{title}</h3>
        <button
          type="button"
          className="member-record-button"
          onClick={() => setRequest((value) => ({ attempt: value.attempt + 1 }))}
        >
          Refresh
        </button>
      </div>
      {state.pending ? (
        <div
          role="status"
          aria-label={`Loading ${title.toLowerCase()}`}
          aria-busy="true"
          className="member-record-skeleton"
        >
          <span />
          <span />
        </div>
      ) : null}
      {state.error ? (
        <p role="alert" className="member-record-notice">
          {state.error}
        </p>
      ) : null}
      {state.loaded && !state.pending && !state.error ? (
        <p role="status" className={state.rows.length > 0 ? "visually-hidden" : undefined}>
          {state.rows.length === 0 && !state.nextCursor
            ? kind === "bookings"
              ? "No bookings recorded"
              : "No attendance recorded"
            : state.rows.length === 0
              ? "No live records on this page. More history is available."
              : "Recorded activity loaded."}
        </p>
      ) : null}
      {state.rows.length > 0 ? (
        <ul className="member-live-records">
          {state.rows.map((row) => (
            <li key={row.recordId}>
              <h4>{row.session?.title ?? "Class details unavailable"}</h4>
              {row.session ? (
                <p>
                  {dateTime(row.session.startAt)} – {dateTime(row.session.endAt)} ·{" "}
                  {row.session.locationId === "town"
                    ? "Town (St Helier)"
                    : row.session.locationId === "west"
                      ? "West (St Peter)"
                      : row.session.locationId}
                </p>
              ) : null}
              {"requestedAt" in row ? (
                <>
                  <p>{label(row.status)}</p>
                  <p>Requested {dateTime(row.requestedAt)}</p>
                </>
              ) : (
                <>
                  <p>
                    {label(row.state)} · {methods[row.method]}
                  </p>
                  <p>Recorded {dateTime(row.occurredAt)}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {state.nextCursor ? (
        <button
          className="member-record-button"
          type="button"
          disabled={state.pending}
          onClick={() =>
            setRequest((value) => ({ attempt: value.attempt + 1, cursor: state.nextCursor! }))
          }
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
export function ClassesTab({ studentId }: { studentId: string }) {
  return (
    <div>
      <p>
        Booking requests and recorded attendance, newest activity first. Session dates are shown
        separately.
      </p>
      <Link className="member-record-link" href="/admin/attendance">
        Open Attendance
      </Link>
      <ClassSection key={`${studentId}-bookings`} studentId={studentId} kind="bookings" />
      <ClassSection key={`${studentId}-attendance`} studentId={studentId} kind="attendance" />
      <p>Earlier class history may still be in the imported archive.</p>
    </div>
  );
}
