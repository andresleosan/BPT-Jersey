"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

import type { WeekPreview } from "@bpt-jersey/domain/schedule/classes-services";

import { copyWeek, deleteWeek, previewWeek } from "../../../../lib/schedule-client";

export type WeekActionsProps = Readonly<{
  weekStart: string;
  onChanged: () => void;
}>;

type Kind = "copy" | "delete";

const monthAbbreviations = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Calendar arithmetic only: the week start is a plain date, never an instant. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function longDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${monthAbbreviations[month! - 1]} ${year}`;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

export function WeekActions({ weekStart, onChanged }: WeekActionsProps): ReactElement {
  const [kind, setKind] = useState<Kind | null>(null);
  const [preview, setPreview] = useState<WeekPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyBookings, setCopyBookings] = useState(false);
  const [reason, setReason] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (kind === null) return undefined;
    const opener = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [kind]);

  async function open(next: Kind): Promise<void> {
    setKind(next);
    setPreview(null);
    setError(null);
    setCopyBookings(false);
    setReason("");
    try {
      setPreview(await previewWeek(weekStart));
    } catch (failure) {
      setError(messageOf(failure, "Unable to preview the week"));
    }
  }

  function close(): void {
    setKind(null);
    setPreview(null);
    setError(null);
  }

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (kind === "copy") {
        await copyWeek({
          fromWeekStart: weekStart,
          toWeekStart: addDays(weekStart, 7),
          copyBookings,
        });
      } else {
        await deleteWeek({ weekStart, reason: reason.trim() });
      }
      onChanged();
      close();
    } catch (failure) {
      setError(messageOf(failure, "Unable to change the week"));
    } finally {
      setBusy(false);
    }
  }

  const titleId = "cs-week-action-title";
  const confirmDisabled =
    busy || preview === null || (kind === "delete" && reason.trim().length < 2);

  return (
    <div className="cs-week-actions">
      <button type="button" className="cs-button" onClick={() => void open("copy")}>
        Copy week
      </button>
      <button type="button" className="cs-button" onClick={() => void open("delete")}>
        Delete week
      </button>
      {kind === null ? null : (
        <dialog
          open
          ref={dialogRef}
          className="cs-dialog"
          aria-labelledby={titleId}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <h2 id={titleId}>{kind === "copy" ? "Copy week" : "Delete week"}</h2>
          {error === null ? null : (
            <p className="cs-notice" data-kind="error" role="alert">
              {error}
            </p>
          )}
          {preview === null ? (
            <p className="cs-placeholder" role="status">
              Reading the week…
            </p>
          ) : (
            <p>
              {kind === "copy"
                ? `${preview.count} classes will be copied to the week of ${longDate(addDays(weekStart, 7))}.`
                : `${preview.count} classes will be cancelled.`}
            </p>
          )}
          {kind === "copy" ? (
            <label className="cs-check">
              <input
                type="checkbox"
                checked={copyBookings}
                onChange={(event) => setCopyBookings(event.target.checked)}
              />
              Copy bookings as well
            </label>
          ) : (
            <label className="cs-field">
              <span>Reason</span>
              <input
                type="text"
                value={reason}
                maxLength={200}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          )}
          <div className="cs-dialog-actions">
            <button type="button" className="cs-button" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="cs-button cs-button-primary"
              disabled={confirmDisabled}
              onClick={() => void run()}
            >
              {kind === "copy" ? "Copy" : "Delete"}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
