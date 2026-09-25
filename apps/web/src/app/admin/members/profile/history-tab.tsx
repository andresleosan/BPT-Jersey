"use client";

import { startTransition, useEffect, useState } from "react";
import { getMemberHistory, type MemberHistoryEntry, type MemberHistoryPage } from "../../../../lib/member-history-client";

type HistoryState =
  | { status: "loading" }
  | { status: "ready"; pages: readonly MemberHistoryPage[] }
  | { status: "error"; message: string };

const kindLabels = { payment: "Payments", attendance: "Attendance", level: "Level", adjustment: "Adjustments" } as const;
const kindOrder = ["payment", "attendance", "level", "adjustment"] as const;

function when(entry: MemberHistoryEntry): string {
  const at = entry.occurredAt ?? entry.capturedAt;
  return at ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Date unknown";
}

function amount(entry: MemberHistoryEntry): string | null {
  return entry.amountMinor === null ? null : `£${(entry.amountMinor / 100).toFixed(2)}`;
}

/**
 * Read-only history of the linked archive: every captured line with its source and whether the
 * office has confirmed it. Confirming or disputing a line stays in the reconciliation workflow.
 * ponytail: read-only v1; deciding a line inline needs a new review callable (the unused one was removed).
 */
export function HistoryTab({ studentId, onUnavailable }: { studentId: string; onUnavailable?: () => void }) {
  const [state, setState] = useState<HistoryState>({ status: "loading" });

  useEffect(() => {
    let live = true;
    void getMemberHistory(studentId)
      .then((page) => live && startTransition(() => setState({ status: "ready", pages: [page] })))
      .catch((error: unknown) => {
        if (!live) return;
        onUnavailable?.();
        startTransition(() => setState({ status: "error", message: error instanceof Error ? error.message : "Unable to load this member's history." }));
      });
    return () => {
      live = false;
    };
  }, [studentId, onUnavailable]);

  async function loadMore(cursor: string) {
    if (state.status !== "ready") return;
    const pages = state.pages;
    try {
      const page = await getMemberHistory(studentId, cursor);
      startTransition(() => setState({ status: "ready", pages: [...pages, page] }));
    } catch (error) {
      startTransition(() => setState({ status: "error", message: error instanceof Error ? error.message : "Unable to load more history." }));
    }
  }

  if (state.status === "loading") {
    return (
      <p aria-live="polite" className="admin-no-results" role="status">
        Loading history...
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p aria-live="assertive" className="admin-no-results" role="alert">
        {state.message}
      </p>
    );
  }
  const entries = state.pages.flatMap((page) => page.entries);
  const last = state.pages[state.pages.length - 1];
  const baseline = state.pages[0]?.baseline ?? null;
  if (entries.length === 0) {
    return (
      <p aria-live="polite" className="admin-no-results" role="status">
        No archive history is linked to this member. Members registered directly in BPT have none; a legacy member gets it once their archive record is linked.
      </p>
    );
  }
  return (
    <section aria-label="Member history" className="member-history">
      <p className="members-count" role="status">
        {entries.length} captured lines from the imported archive. Evidence only: a line becomes part of the member's coverage or progress when the office confirms it.
        {baseline ? ` Attendance baseline: ${baseline.confirmedCount} classes confirmed through ${baseline.throughDate}.` : ""}
      </p>
      {kindOrder.map((kind) => {
        const group = entries.filter((entry) => entry.kind === kind);
        if (group.length === 0) return null;
        return (
          <section key={kind} aria-labelledby={`member-history-${kind}`} className="member-history-group">
            <h4 id={`member-history-${kind}`}>{kindLabels[kind]}</h4>
            <ul className="members-review-list">
              {group.map((entry) => (
                <li key={entry.entryId} className="members-cell">
                  <span>
                    {when(entry)}
                    {amount(entry) ? ` · ${amount(entry)}` : ""}
                    {entry.originalText ? ` · ${entry.originalText}` : ""}
                  </span>
                  <span className="members-cell-detail">
                    {entry.confirmation === "confirmed" ? "Confirmed by the office" : entry.confirmation === "disputed" ? "Disputed" : "Not yet confirmed"}
                    {entry.equivalentToEntryId ? " · duplicate of another line" : ""} · archive record {entry.sourceRecordId}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {last?.nextCursor ? (
        <button className="admin-auth-button" onClick={() => void loadMore(last.nextCursor as string)} type="button">
          Load more
        </button>
      ) : null}
    </section>
  );
}
