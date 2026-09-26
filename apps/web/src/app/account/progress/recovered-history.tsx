"use client";

import { useEffect, useRef, useState } from "react";
import type { MemberRecoveryHistory } from "@bpt-jersey/domain/members/recovery";

export function RecoveredMemberHistory({ studentId }: { studentId?: string }) {
  const [history, setHistory] = useState<MemberRecoveryHistory>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setHistory(undefined); setBusy(false); setError(false);
    return () => { generation.current += 1; };
  }, [studentId]);
  async function load(cursor?: string) {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setError(false);
    try {
      const { getMemberRecoveryHistory } = await import("../../../lib/member-recovery-client");
      const page = await getMemberRecoveryHistory(studentId ?? history?.studentId, cursor);
      if (current !== generation.current) return;
      setHistory((previous) => ({ ...page, entries: cursor && previous ?
        [...new Map([...previous.entries, ...page.entries].map((entry) => [entry.entryId, entry])).values()] : page.entries }));
    } catch { if (current === generation.current) setError(true); }
    finally { if (current === generation.current) setBusy(false); }
  }
  return (
    <section aria-labelledby="recovered-history-title">
      <h2 id="recovered-history-title">Confirmed previous history</h2>
      <p>The office checked these records against the previous system. Anything missing or uncertain is reviewed separately.</p>
      {!history && <button className="button button-secondary" disabled={busy} onClick={() => void load()}>
        {busy ? "Loading history…" : "View previous history"}
      </button>}
      {error && <p role="alert">Unable to load this history. Please try again.</p>}
      {history?.entries.length === 0 && <p>No confirmed entries on this page.</p>}
      {history && <ul>{history.entries.map((entry) => <li key={entry.entryId}>
        <strong>{({ payment: "Payment", attendance: "Attendance", level: "Progress review", adjustment: "Historical adjustment" })[entry.kind]}</strong>
        {" · "}{entry.occurredAt ? new Date(entry.occurredAt).toLocaleDateString("en-GB") : "Date not confirmed"}
        {entry.kind === "payment" && <> · {entry.amountMinor === null ? "Amount not confirmed" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(entry.amountMinor / 100)}</>}
      </li>)}</ul>}
      {history?.nextCursor && <button className="button button-secondary" disabled={busy} onClick={() => void load(history.nextCursor!)}>
        {busy ? "Loading history…" : "Load more history"}
      </button>}
    </section>
  );
}
