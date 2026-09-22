"use client";

import Link from "next/link";
import { useState } from "react";
import type { MemberOverviewRow } from "@bpt-jersey/domain/members/overview";
import { confirmMemberTrainingCenter } from "../../../lib/member-migration-client";
import { MemberReviewActions } from "./member-review";
import { flagLabels } from "./member-overview-labels";
import { recordHref } from "./profile/member-record";

/** One row per pending detail; the office resolves it in place and the list shrinks. */
export function DataReview({ rows, onSaved }: { rows: readonly MemberOverviewRow[]; onSaved: () => void }) {
  if (rows.length === 0) {
    return (
      <p aria-live="polite" className="admin-no-results" role="status">
        Nothing to review. Every member has a centre, a date of birth, a guardian where needed and a plan.
      </p>
    );
  }
  return (
    <section className="admin-panel-card" aria-label="Data review">
      <p className="members-count" role="status">
        {rows.length} members with details to review. Each correction keeps its source and reason.
      </p>
      <ul className="members-review-list">
        {rows.map((row) => (
          <li key={row.studentId} className="members-review-item">
            <div className="members-cell">
              <Link className="member-record-link" href={recordHref(row.studentId)}>
                {row.fullName}
              </Link>
              <span className="members-cell-detail">
                {row.age === undefined ? "Age unknown" : `${row.age} years`} · {row.centreConfirmed ? row.trainingCenter : "centre to be confirmed"} ·{" "}
                {row.flags.map((flag) => flagLabels[flag]).join(" · ")}
              </span>
            </div>
            <div className="members-review-actions">
              {row.flags.includes("centre-unconfirmed") ? <CentreConfirm studentId={row.studentId} onSaved={onSaved} /> : null}
              {row.flags.includes("date-of-birth-missing") || row.flags.includes("guardian-required") ? (
                <MemberReviewActions
                  studentId={row.studentId}
                  {...(row.flags.includes("guardian-required") ? { guardianStatus: "pending" as const } : {})}
                  {...(row.flags.includes("date-of-birth-missing") ? { reviewReason: "date-of-birth-missing" as const } : {})}
                  onSaved={onSaved}
                />
              ) : null}
              {row.flags.includes("plan-to-confirm") ? (
                <Link className="member-record-button" href={recordHref(row.studentId, "plan")}>
                  Review plan
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CentreConfirm({ studentId, onSaved }: { studentId: string; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [requestId] = useState(() => crypto.randomUUID()); // one receipt per row: a retry replays, never double-writes
  async function confirm(trainingCenter: "Town" | "West") {
    setBusy(true);
    setError(undefined);
    try {
      await confirmMemberTrainingCenter({ studentId, requestId, trainingCenter });
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not confirm the training centre.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="members-centre-confirm">
      <span className="admin-card-label">Centre</span>
      <button className="member-record-button" disabled={busy} onClick={() => void confirm("Town")} type="button">
        Town
      </button>
      <button className="member-record-button" disabled={busy} onClick={() => void confirm("West")} type="button">
        West
      </button>
      {error ? (
        <span aria-live="assertive" className="members-cell-detail" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
