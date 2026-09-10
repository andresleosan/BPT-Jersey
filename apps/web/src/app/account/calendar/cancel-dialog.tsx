"use client";

import { useEffect, useRef } from "react";

import {
  cancelDeadlineLabel,
  formatDayHeading,
  type CalendarDay,
} from "@bpt-jersey/domain/schedule/member-calendar";

import type { CalendarEntry } from "./session-card";

type CancelDialogProps = Readonly<{
  entry: CalendarEntry | undefined;
  day: CalendarDay | undefined;
  busy: boolean;
  onKeep: () => void;
  onConfirm: (entry: CalendarEntry) => void;
}>;

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function CancelDialog({ entry, day, busy, onKeep, onConfirm }: CancelDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (entry && !dialog.open) dialog.showModal();
    if (!entry && dialog.open) dialog.close();
  }, [entry]);

  return (
    <dialog
      aria-labelledby="cancel-dialog-title"
      className="cancel-dialog"
      onClose={onKeep}
      ref={ref}
    >
      {entry ? (
        <>
          <h2 id="cancel-dialog-title">
            Cancel {day ? formatDayHeading(day) : ""}{" "}
            {timeFormatter.format(new Date(entry.session.startAt))} · {entry.session.title}?
          </h2>
          <p>Cancellations close at {cancelDeadlineLabel(entry.session)}.</p>
          <div className="cancel-dialog-actions">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={onKeep}
              type="button"
            >
              Keep booking
            </button>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => onConfirm(entry)}
              type="button"
            >
              Cancel booking
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
