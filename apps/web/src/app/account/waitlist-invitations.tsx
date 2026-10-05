"use client";

import { ageWaitlistEnabled } from "../../lib/age-waitlist-feature";
import { useEffect, useRef, useState } from "react";
import type { WaitlistInvitationView } from "@bpt-jersey/domain/schedule/waitlist-invitations";
import { listWaitlistClassInvitations, respondWaitlistClassInvitation } from "../../lib/waitlist-invitations-client";
import { locationLabel } from "../../lib/location-label";
import "./waitlist-invitations.css";

const dateTime = (value: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Jersey" }).format(new Date(value));

export function WaitlistInvitations(props: { studentId: string; onBooked?: () => void }) {
  return ageWaitlistEnabled ? <ActiveWaitlistInvitations key={props.studentId} {...props} /> : null;
}

function ActiveWaitlistInvitations({ studentId, onBooked }: { studentId: string; onBooked?: () => void }) {
  const [rows, setRows] = useState<readonly WaitlistInvitationView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const inFlight = useRef(false);
  const generation = useRef(0);

  async function load(next?: string) {
    const version = generation.current;
    try {
      const page = await listWaitlistClassInvitations(studentId, next);
      if (version !== generation.current) return;
      setRows((current) => next ? [...current, ...page.invitations] : page.invitations);
      setCursor(page.cursor); setLoaded(true);
    } catch { if (version === generation.current) { setLoaded(true); setError("Class invitations could not be loaded. Try again."); } }
  }

  useEffect(() => {
    generation.current++; setRows([]); setLoaded(false); setError(""); setNotice("");
    void load();
    return () => { generation.current++; };
  }, [studentId]);

  async function respond(row: WaitlistInvitationView, response: "accept" | "decline") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(row.invitationId); setError(""); setNotice("");
    const version = generation.current;
    try {
      await respondWaitlistClassInvitation({ invitationId: row.invitationId, studentId, response, sessionRevision: row.session.updatedAt });
      if (version !== generation.current) return;
      if (response === "accept") onBooked?.();
      setNotice(response === "accept" ? "Your place is booked." : "Invitation declined. You remain on the original waitlist.");
      await load();
    } catch (error) {
      if (version === generation.current) { setError(error instanceof Error ? error.message : "Unable to respond. Try again."); await load(); }
    } finally { inFlight.current = false; if (version === generation.current) setBusy(""); }
  }

  const pending = rows.filter((row) => row.status === "pending");
  if (loaded && !pending.length && !cursor && !error && !notice) return null;
  return <section className="member-waitlist-invitations" aria-label="New classes for your waitlist" aria-busy={!loaded}>
    <h2>New classes for you</h2>
    {!loaded && <div className="member-invitations-loading" role="status">Loading invitations...</div>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {pending.map((row) => <article key={row.invitationId}>
      <h3>{row.session.title}</h3>
      <p>{dateTime(row.session.startAt)}. {locationLabel(row.session.locationId)}.</p>
      <p>You were waiting for {row.sourceTitle}. Places are available to eligible members until the class or your age group is full.</p>
      <div className="member-invitation-actions">
        <button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => void respond(row, "accept")}>{busy === row.invitationId ? "Updating..." : "Confirm booking"}</button>
        <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => void respond(row, "decline")}>Decline invitation</button>
      </div>
    </article>)}
    {cursor && <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => void load(cursor)}>Load more invitations</button>}
    {error && <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => { setError(""); void load(); }}>Refresh invitations</button>}
  </section>;
}
