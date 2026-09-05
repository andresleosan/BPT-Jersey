"use client";

import { useEffect, useState } from "react";
import {
  noShowPenaltyReasonMaxLength,
  noShowPenaltyReasonMinLength,
  type NoShowPenaltyRecord,
} from "@bpt-jersey/domain/penalties";

import { listNoShowPenalties, resolveNoShowPenalty } from "../../../lib/no-show-penalties-client";

type QueueState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; penalties: readonly NoShowPenaltyRecord[] }>
  | Readonly<{ status: "error" }>;

type Draft = Readonly<{ reason: string; invoiceId: string }>;

function formatMoney(amountMinor: number): string {
  return `£${(amountMinor / 100).toFixed(2)}`;
}

function formatMoment(startAt: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Jersey",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(startAt));
}

/**
 * T111: the office queue of Town no-show penalties. Every entry is a proposal of GBP 15 that office
 * either charges through the manual billing cycle, linking the invoice it issued, or waives with a
 * reason. Nothing here charges anybody by itself (BRIEF decision 2).
 */
export function NoShowPenaltyQueue() {
  const [state, setState] = useState<QueueState>({ status: "loading" });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyPenaltyId, setBusyPenaltyId] = useState<string>();
  const [message, setMessage] = useState<Readonly<{ kind: "success" | "error"; text: string }>>();

  async function load(): Promise<void> {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", penalties: await listNoShowPenalties("proposed") });
    } catch {
      setState({ status: "error" });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function draftFor(penaltyId: string): Draft {
    return drafts[penaltyId] ?? { reason: "", invoiceId: "" };
  }

  async function resolve(
    penalty: NoShowPenaltyRecord,
    decision: "charge" | "waive",
  ): Promise<void> {
    const draft = draftFor(penalty.penaltyId);
    const reason = draft.reason.trim();
    if (reason.length < noShowPenaltyReasonMinLength) {
      setMessage({
        kind: "error",
        text: `Record why you are ${decision === "charge" ? "charging" : "waiving"} this penalty (at least ${noShowPenaltyReasonMinLength} characters).`,
      });
      return;
    }
    setBusyPenaltyId(penalty.penaltyId);
    setMessage(undefined);
    try {
      const invoiceId = draft.invoiceId.trim();
      await resolveNoShowPenalty({
        penaltyId: penalty.penaltyId,
        decision,
        reason,
        ...(decision === "charge" && invoiceId.length > 0 ? { invoiceId } : {}),
      });
      setMessage({
        kind: "success",
        text:
          decision === "charge"
            ? `Penalty charged and recorded${invoiceId.length > 0 ? ` against invoice ${invoiceId}` : ""}.`
            : "Penalty waived and recorded.",
      });
      await load();
    } catch {
      setMessage({ kind: "error", text: "The penalty could not be resolved. Please try again." });
    } finally {
      setBusyPenaltyId(undefined);
    }
  }

  return (
    <section
      aria-labelledby="no-show-penalty-title"
      className="admin-panel-card"
      data-testid="no-show-penalty-queue"
    >
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Office decisions</p>
          <h3 id="no-show-penalty-title">Town no-show penalties</h3>
        </div>
        <button
          className="admin-home-link"
          disabled={state.status === "loading"}
          onClick={() => void load()}
          type="button"
        >
          Refresh queue
        </button>
      </div>
      <p className="membership-helper">
        Each entry proposes {formatMoney(1500)} for a Town no-show. Nothing is charged
        automatically: issue the invoice in Billing and link it here, or waive the penalty with a
        reason. An absence covered by an approved medical leave never reaches this queue.
      </p>

      {message ? (
        <p
          aria-live="polite"
          className={message.kind === "error" ? "family-error" : "family-success"}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}

      {state.status === "loading" ? (
        <p role="status">Loading the penalty queue…</p>
      ) : state.status === "error" ? (
        <p role="alert">Unable to load no-show penalties. Refresh and try again.</p>
      ) : state.penalties.length === 0 ? (
        <p className="admin-empty-state">No penalty is waiting for a decision.</p>
      ) : (
        state.penalties.map((penalty) => {
          const draft = draftFor(penalty.penaltyId);
          const busy = busyPenaltyId === penalty.penaltyId;
          return (
            <article
              aria-label={`Penalty for ${penalty.studentId}`}
              className="schedule-admin-booking-form"
              key={penalty.penaltyId}
            >
              <strong>{formatMoney(penalty.amountMinor)}</strong>
              <span>
                {penalty.studentId} · {formatMoment(penalty.sessionStartAt)} · {penalty.locationId}
              </span>
              <label
                className="schedule-admin-field"
                htmlFor={`penalty-reason-${penalty.penaltyId}`}
              >
                Reason
                <textarea
                  disabled={busy}
                  id={`penalty-reason-${penalty.penaltyId}`}
                  maxLength={noShowPenaltyReasonMaxLength}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [penalty.penaltyId]: { ...draft, reason: event.target.value },
                    }))
                  }
                  rows={2}
                  value={draft.reason}
                />
              </label>
              <label
                className="schedule-admin-field"
                htmlFor={`penalty-invoice-${penalty.penaltyId}`}
              >
                Invoice issued in Billing (optional)
                <input
                  disabled={busy}
                  id={`penalty-invoice-${penalty.penaltyId}`}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [penalty.penaltyId]: { ...draft, invoiceId: event.target.value },
                    }))
                  }
                  value={draft.invoiceId}
                />
              </label>
              <div className="schedule-admin-row-actions">
                <button
                  className="schedule-admin-button"
                  disabled={busy}
                  onClick={() => void resolve(penalty, "charge")}
                  type="button"
                >
                  {busy ? "Saving…" : "Charge"}
                </button>
                <button
                  className="schedule-admin-button schedule-admin-button-secondary"
                  disabled={busy}
                  onClick={() => void resolve(penalty, "waive")}
                  type="button"
                >
                  Waive
                </button>
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}
