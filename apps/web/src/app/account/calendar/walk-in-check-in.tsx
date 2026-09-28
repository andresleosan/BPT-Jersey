"use client";

import { useState } from "react";

import type { AttendanceRecord } from "@bpt-jersey/domain/schedule";
import { formatSessionTimeRange, sessionSite } from "@bpt-jersey/domain/schedule/member-calendar";

import type { WalkInCheckInInput } from "../../../lib/calendar/calendar-repository";
import {
  positionFailureMessage,
  selfCheckInFailureMessage,
} from "../../../lib/calendar/self-check-in-messages";
import { readDevicePosition } from "../../../lib/self-check-in-position";
import type { CalendarEntry } from "./session-card";

type Props = Readonly<{
  entries: readonly CalendarEntry[];
  studentId: string;
  membershipId?: string;
  walkIn?: (input: WalkInCheckInInput) => Promise<AttendanceRecord>;
  onCheckedIn: () => void;
}>;

/**
 * Opened from the door (NFC tag / QR code → /checkin) by a member with no booking for a class that
 * is open for check-in now: they pick the class, the server books it on site and checks them in.
 */
export function WalkInCheckIn({ entries, studentId, membershipId, walkIn, onCheckedIn }: Props) {
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  async function pick(entry: CalendarEntry) {
    if (!walkIn || busy) return;
    setBusy(entry.session.sessionId);
    setStatus("Checking you're at the gym…");
    try {
      const reading = await readDevicePosition();
      if (reading.status !== "ok") {
        setStatus(positionFailureMessage(reading.status));
        return;
      }
      setStatus("Checking you in…");
      await walkIn({
        sessionId: entry.session.sessionId,
        studentId,
        ...(membershipId ? { membershipId } : {}),
        position: reading.position,
      });
      setStatus("You're checked in.");
      onCheckedIn();
    } catch (error) {
      setStatus(selfCheckInFailureMessage(error));
    } finally {
      setBusy("");
    }
  }

  const canBook = Boolean(walkIn);
  return (
    <section className="ready-card" aria-labelledby="walk-in-title">
      <p className="member-eyebrow ready-eyebrow">Check in</p>
      <h2 className="ready-title" id="walk-in-title">
        Which class are you here for?
      </h2>
      {entries.length === 0 ? (
        <p className="ready-meta">
          No class is open for check-in right now. Check-in opens 1 hour before class.
        </p>
      ) : !canBook ? (
        <p className="ready-meta">Ask a coach to check you in for today&apos;s class.</p>
      ) : (
        <div className="walk-in-list">
          {entries.map((entry) => (
            <button
              className="session-action"
              disabled={busy !== ""}
              key={entry.session.sessionId}
              onClick={() => void pick(entry)}
              type="button"
            >
              {`${entry.session.title} · ${formatSessionTimeRange(entry.session)} · ${sessionSite(entry.session)}`}
            </button>
          ))}
        </div>
      )}
      <p aria-live="polite" className="ready-status" role="status">
        {status}
      </p>
    </section>
  );
}
