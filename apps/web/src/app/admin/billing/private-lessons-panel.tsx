"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PRIVATE_LESSON_OPTIONS,
  type PrivateLessonPurchaseRow,
} from "@bpt-jersey/domain/private-lessons";

import {
  listPrivateLessonPurchases,
  reviewPrivateLessonPurchase,
} from "../../../lib/private-lesson-client";
import { formatDate, formatMoney } from "./billing-format";

/** Office review of private lesson transfers: approving records the payment and adds credits. */
export function PrivateLessonsPanel() {
  const [items, setItems] = useState<readonly PrivateLessonPurchaseRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reasons, setReasons] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState<string>();
  const [failure, setFailure] = useState<string>();

  const load = useCallback(async () => {
    setState("loading");
    try {
      setItems(await listPrivateLessonPurchases("pending"));
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(item: PrivateLessonPurchaseRow, decision: "approve" | "reject") {
    const name = item.studentName ?? "this member";
    const option = PRIVATE_LESSON_OPTIONS[item.optionId];
    const reason = reasons[item.purchaseId]?.trim() ?? "";
    setFailure(undefined);
    if (decision === "reject" && reason.length === 0) {
      setFailure("Add a reason before rejecting.");
      return;
    }
    if (
      decision === "approve" &&
      !window.confirm(
        `Approve ${option.displayName} for ${name} and record ${formatMoney(item.priceMinor)} paid?`,
      )
    ) {
      return;
    }
    setBusy(item.purchaseId);
    try {
      await reviewPrivateLessonPurchase({
        purchaseId: item.purchaseId,
        decision,
        reason: decision === "reject" ? reason : null,
      });
      setItems((current) => current.filter((row) => row.purchaseId !== item.purchaseId));
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "We could not update the private lesson. Try again.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section aria-labelledby="private-lessons-title" className="billing-private-lessons">
      <h2 id="private-lessons-title">Pending private lessons</h2>
      {state === "loading" ? <div aria-busy="true" className="billing-skeleton" /> : null}
      {state === "error" ? (
        <p role="status">
          Private lessons are unavailable.{" "}
          <button className="button button-secondary" onClick={() => void load()} type="button">
            Try again
          </button>
        </p>
      ) : null}
      {failure ? <p role="alert">{failure}</p> : null}
      {state === "ready" && items.length === 0 ? (
        <p>No private lesson purchases are waiting.</p>
      ) : null}
      {state === "ready" && items.length > 0 ? (
        <ul aria-label="Pending private lessons" className="billing-private-lesson-list">
          {items.map((item) => {
            const name = item.studentName ?? "Unnamed member";
            return (
              <li key={item.purchaseId}>
                <div>
                  <strong>{name}</strong>
                  <span>
                    {PRIVATE_LESSON_OPTIONS[item.optionId].displayName} ·{" "}
                    {formatMoney(item.priceMinor)} · {item.bankReference ?? "No reference"}
                  </span>
                  <span>Sent {formatDate(item.submittedAt)}</span>
                </div>
                <div className="billing-private-lesson-actions">
                  <input
                    aria-label={`Reason for ${name}`}
                    maxLength={300}
                    onChange={(event) =>
                      setReasons((current) => ({
                        ...current,
                        [item.purchaseId]: event.target.value,
                      }))
                    }
                    placeholder="Reason (needed to reject)"
                    value={reasons[item.purchaseId] ?? ""}
                  />
                  <button
                    aria-label={`Approve ${name}`}
                    className="button button-primary"
                    disabled={busy === item.purchaseId}
                    onClick={() => void decide(item, "approve")}
                    type="button"
                  >
                    Approve
                  </button>
                  <button
                    aria-label={`Reject ${name}`}
                    className="button button-secondary"
                    disabled={busy === item.purchaseId}
                    onClick={() => void decide(item, "reject")}
                    type="button"
                  >
                    Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
