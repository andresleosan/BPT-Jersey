"use client";

import { useEffect, useRef, useState } from "react";
import type { CreateSessionInput, SessionRecord } from "@bpt-jersey/domain/schedule";
import { getScheduleCatalog, type ScheduleCatalogResponse } from "../../../lib/schedule-client";
import { listStaffProfiles } from "../../../lib/staff-client";
import { createWaitlistClass, getWaitlistClassSource, listWaitlistClassHistory, type WaitlistClassHistory } from "../../../lib/waitlist-invitations-client";
import { SessionPanel, type StaffOption } from "../classes-services/classes/session-panel";
import { trainerOptions } from "../classes-services/classes/trainer-options";
import "../classes-services/classes-services.css";

const dateTime = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Jersey" }).format(new Date(value));

/** Remains accessible after the original queue has no pending members. */
export function FollowUpHistory() {
  const [history, setHistory] = useState<WaitlistClassHistory>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function load(cursor?: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const next = await listWaitlistClassHistory(undefined, cursor);
      if (alive.current) setHistory((previous) => cursor && previous ? { ...next, operations: [...previous.operations, ...next.operations] } : next);
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "Unable to load class history."); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }

  async function resume(operationId: string, sourceSessionId: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      let result = await createWaitlistClass({ operationId, sourceSessionId });
      while (!result.complete && alive.current) result = await createWaitlistClass({ operationId, sourceSessionId });
      if (alive.current) setHistory((previous) => previous ? { ...previous, operations: previous.operations.map((row) => row.operationId === operationId ? { ...row, ...result } : row) } : previous);
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "Unable to resume invitations."); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }

  return <details className="waitlist-past" onToggle={(event) => { if (event.currentTarget.open && !history) void load(); }}>
    <summary>All next classes and responses</summary>
    <p>History stays here after members leave the original waitlist.</p>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Updating class history...</p>}
    {history?.operations.length === 0 && <p>No follow-up classes created yet.</p>}
    <ul className="waitlist-follow-up-history">
      {history?.operations.map((row) => <li key={row.operationId}>
        <span>From {row.sourceTitle}{row.sourceStartAt ? ` · ${dateTime(row.sourceStartAt)}` : ""}</span>
        <strong>{row.session.title} · {dateTime(row.session.startAt)}</strong>
        <span>{row.responses.accepted} accepted, {row.responses.declined} declined, {row.responses.pending} unanswered</span>
        {!row.complete && <button type="button" className="admin-auth-button" disabled={busy} onClick={() => void resume(row.operationId, row.sourceSessionId)}>Resume invitations</button>}
      </li>)}
    </ul>
    <button type="button" className="admin-auth-button" disabled={busy} onClick={() => void load()}>Refresh responses</button>
    {history?.cursor && <button type="button" className="admin-auth-button" disabled={busy} onClick={() => void load(history.cursor!)}>Load more classes</button>}
  </details>;
}

export function FollowUpClass({ sourceSessionId, waiting }: { sourceSessionId: string; waiting: number }) {
  const [editor, setEditor] = useState<{ session: SessionRecord; catalog: ScheduleCatalogResponse; staff: readonly StaffOption[]; waiting: number }>();
  const [history, setHistory] = useState<WaitlistClassHistory>();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const operationId = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const message = (error: unknown) => error instanceof Error ? error.message : "Unable to create the next class.";

  async function open() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const [source, catalog, staff] = await Promise.all([getWaitlistClassSource(sourceSessionId), getScheduleCatalog(), listStaffProfiles()]);
      if (alive.current) { operationId.current = crypto.randomUUID(); setEditor({ ...source, catalog, staff: trainerOptions(staff) }); }
    } catch (error) { if (alive.current) setError(message(error)); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }

  async function refreshHistory(cursor?: string) {
    try {
      const next = await listWaitlistClassHistory(sourceSessionId, cursor);
      if (alive.current) setHistory((previous) => cursor && previous ? { ...next, operations: [...previous.operations, ...next.operations] } : next);
    } catch (error) { if (alive.current) setError(message(error)); }
  }

  async function complete(operation: string, input?: CreateSessionInput) {
    let result = await createWaitlistClass({ operationId: operation, sourceSessionId, ...(input ? { session: input } : {}) });
    // Each call publishes at most one bounded batch. A closed page can resume from history.
    while (!result.complete && alive.current) result = await createWaitlistClass({ operationId: operation, sourceSessionId });
    if (alive.current) {
      setNotice(result.complete ? `Class created. ${result.invited} invitations published.` : "Class created. Invitations are still being published.");
      await refreshHistory();
    }
    return result.session;
  }

  async function save(input: CreateSessionInput) {
    try { return await complete(operationId.current!, input); }
    catch (error) { void refreshHistory(); throw error; }
  }

  async function resume(operation: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await complete(operation); } catch (error) { if (alive.current) setError(message(error)); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }

  return <div className="waitlist-follow-up">
    <button type="button" className="admin-auth-button" disabled={busy || waiting === 0} onClick={() => void open()}>{busy ? "Loading class..." : "Create next class"}</button>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <details onToggle={(event) => { if (event.currentTarget.open && !history) void refreshHistory(); }}>
      <summary>Next classes and responses</summary>
      {!history ? <p>Loading class history...</p> : history.operations.length === 0 ? <p>No follow-up classes created yet.</p> : <ul className="waitlist-follow-up-history">
        {history.operations.map((row) => <li key={row.operationId}>
          <strong>{row.session.title}</strong><span>{dateTime(row.session.startAt)}</span>
          <span>{row.responses.accepted} accepted, {row.responses.declined} declined, {row.responses.pending} unanswered</span>
          {!row.complete && <button type="button" className="admin-auth-button" disabled={busy} onClick={() => void resume(row.operationId)}>Resume invitations</button>}
        </li>)}
      </ul>}
      <button type="button" className="admin-auth-button" disabled={busy} onClick={() => void refreshHistory()}>Refresh responses</button>
      {history?.cursor && <button type="button" className="admin-auth-button" disabled={busy} onClick={() => void refreshHistory(history.cursor!)}>Load more classes</button>}
    </details>
    {editor && <SessionPanel mode="create" session={editor.session} catalog={editor.catalog} staff={editor.staff} timezone="Europe/Jersey"
      canEdit canReadMemberships canManageAgeLimits followUp saveNewSession={save}
      followUpNotice={`${editor.waiting} waiting members will be invited after this class is created. Choose a later date and check the places available.`}
      onSaved={() => setEditor(undefined)} onCancelled={() => setEditor(undefined)} onClose={() => { setEditor(undefined); void refreshHistory(); }} />}
  </div>;
}
