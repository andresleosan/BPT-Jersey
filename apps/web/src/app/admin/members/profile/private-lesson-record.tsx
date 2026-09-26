"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  PRIVATE_LESSON_OPTIONS,
  privateLessonOptionIds,
  type PrivateLessonOptionId,
} from "@bpt-jersey/domain/private-lessons";

import { privateLessonPriceLabel } from "../../../../lib/plan-copy";
import { recordPrivateLessonPurchase } from "../../../../lib/private-lesson-client";

import "./private-lesson-record.css";

type Method = "bank_transfer" | "cash" | "other";

/** Office only: a purchase paid at the desk or by transfer is recorded already approved. */
export function PrivateLessonRecord({ studentId }: Readonly<{ studentId: string }>) {
  const [open, setOpen] = useState(false);
  const [optionId, setOptionId] = useState<PrivateLessonOptionId>("single");
  const [method, setMethod] = useState<Method>("bank_transfer");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Readonly<{ kind: "success" | "error"; text: string }>>();
  // Kept across retries of the same purchase; cleared once it is saved.
  const requestId = useRef<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(undefined);
    requestId.current ??= crypto.randomUUID();
    try {
      await recordPrivateLessonPurchase({
        studentId,
        requestId: requestId.current,
        optionId,
        method,
        reference: reference.trim().length >= 2 ? reference.trim() : null,
      });
      requestId.current = null;
      setOpen(false);
      setReference("");
      setNotice({
        kind: "success",
        text: `Recorded ${PRIVATE_LESSON_OPTIONS[optionId].displayName}. The credits are ready to book.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "We could not update the private lesson. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="member-private-lessons">
      {open ? (
        <form className="member-private-lessons-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="private-lesson-option">Lessons</label>
          <select
            id="private-lesson-option"
            onChange={(event) => setOptionId(event.target.value as PrivateLessonOptionId)}
            value={optionId}
          >
            {privateLessonOptionIds.map((id) => (
              <option key={id} value={id}>
                {PRIVATE_LESSON_OPTIONS[id].displayName}
              </option>
            ))}
          </select>
          <p>{privateLessonPriceLabel(optionId)}</p>
          <label htmlFor="private-lesson-method">Paid by</label>
          <select
            id="private-lesson-method"
            onChange={(event) => setMethod(event.target.value as Method)}
            value={method}
          >
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
          <label htmlFor="private-lesson-reference">Reference (optional)</label>
          <input
            id="private-lesson-reference"
            maxLength={80}
            onChange={(event) => setReference(event.target.value)}
            value={reference}
          />
          <div className="member-subscription-actions">
            <button className="member-record-button" disabled={busy} type="submit">
              {busy ? "Saving..." : "Save purchase"}
            </button>
            <button
              className="member-record-button"
              disabled={busy}
              onClick={() => setOpen(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          className="member-record-button"
          onClick={() => {
            setOpen(true);
            setNotice(undefined);
          }}
          type="button"
        >
          Record private lesson purchase
        </button>
      )}
      {notice ? (
        <p className="member-record-notice" role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
