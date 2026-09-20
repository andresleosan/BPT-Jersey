"use client";

import { useState } from "react";
import type { MemberRecoveryHistory } from "@bpt-jersey/domain/members/recovery";

export function RecoveredMemberHistory() {
  const [history, setHistory] = useState<MemberRecoveryHistory>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function load() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const { getMemberRecoveryHistory } = await import("../../../lib/member-recovery-client");
      setHistory(await getMemberRecoveryHistory());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="recovered-history-title">
      <h2 id="recovered-history-title">Your previous membership history</h2>
      <p>
        View the original progress, attendance and payments linked to your recovered membership.
      </p>
      {!history && (
        <button className="button button-secondary" disabled={busy} onClick={() => void load()}>
          {busy ? "Loading your history..." : "View previous history"}
        </button>
      )}
      {error && <p role="alert">Unable to load your history. Please try again.</p>}
      {history?.records.length === 0 && (
        <p>
          No archived history is linked to this account. Your current academy records remain
          available above. Contact the office if you expect an older record.
        </p>
      )}
      {history?.records.map((record) => (
        <article key={record.recordId} className="client-identity">
          <h3>{record.fullName}</h3>
          <p>
            Original records captured on {new Date(record.capturedAt).toLocaleDateString("en-GB")}.
          </p>
          <h4>Progress</h4>
          <dl>
            <dt>Belt</dt>
            <dd>{record.graduation.belt ?? "Not recorded"}</dd>
            <dt>Progress</dt>
            <dd>
              {record.graduation.progressPercent === undefined
                ? "Not recorded"
                : `${record.graduation.progressPercent}%`}
            </dd>
            <dt>Classes</dt>
            <dd>{record.graduation.classesProgress ?? "Not recorded"}</dd>
            <dt>Time progress</dt>
            <dd>{record.graduation.daysProgress ?? "Not recorded"}</dd>
            <dt>Membership plan</dt>
            <dd>{record.plan.membershipPlan ?? "Not recorded"}</dd>
            <dt>Original membership period</dt>
            <dd>
              {record.plan.validFrom ?? "Not recorded"} – {record.plan.validUntil ?? "Not recorded"}
            </dd>
            <dt>Classes attended</dt>
            <dd>{record.attendance.attended ?? "Not recorded"}</dd>
            <dt>Absences</dt>
            <dd>{record.attendance.absences ?? "Not recorded"}</dd>
          </dl>
          <details>
            <summary>Attendance records ({record.attendance.records.length})</summary>
            <ul>
              {record.attendance.records.map((entry, index) => (
                <li key={index}>
                  {entry.date} {entry.time} · {entry.className ?? "Class"} · {entry.status}
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>Payment records ({record.payments.length})</summary>
            <ul>
              {record.payments.map((entry, index) => (
                <li key={index}>
                  {entry.date ?? "Date not recorded"} · {entry.description ?? "Payment"} ·{" "}
                  {entry.amount ?? "Amount not recorded"}
                </li>
              ))}
            </ul>
          </details>
        </article>
      ))}
    </section>
  );
}
