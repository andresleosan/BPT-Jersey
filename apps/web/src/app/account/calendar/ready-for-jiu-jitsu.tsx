"use client";

import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import type { AttendanceRecord, ProgramRecord } from "@bpt-jersey/domain/schedule";
import { formatSessionTimeRange, sessionSite } from "@bpt-jersey/domain/schedule/member-calendar";
import {
  isOpenMatProgram,
  selfCheckInWindowLabels,
  type SelfCheckInCandidate,
  type SelfCheckInInput,
} from "@bpt-jersey/domain/schedule/self-check-in";

import {
  selfCheckInFailureMessage,
  positionFailureMessage,
} from "../../../lib/calendar/self-check-in-messages";
import { readDevicePosition } from "../../../lib/self-check-in-position";

type Props = Readonly<{
  candidate: SelfCheckInCandidate;
  program?: ProgramRecord;
  studentId: string;
  clockIn: (input: SelfCheckInInput) => Promise<AttendanceRecord>;
  onCheckedIn: (record: AttendanceRecord) => void;
  siblingHint?: string;
}>;

type Phase =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "locating" }>
  | Readonly<{ kind: "sending" }>
  | Readonly<{ kind: "refused"; message: string }>
  | Readonly<{ kind: "success"; record: AttendanceRecord }>;

const commitAt = 95;
const jerseyClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function punctualityLabel(record: AttendanceRecord): string {
  const time = jerseyClock.format(new Date(record.occurredAt));
  const state =
    record.state === "attended" ? "On time" : record.state === "late" ? "Late" : record.state;
  return `${time} · ${state}`;
}

function ConfirmationCard({
  record,
  session,
}: Readonly<{ record: AttendanceRecord; session: Props["candidate"]["session"] }>) {
  const meta = `${session.title} · ${formatSessionTimeRange(session)} · ${sessionSite(session)}`;

  return (
    <section className="ready-card ready-card--done" aria-labelledby="ready-title">
      <p className="member-eyebrow ready-eyebrow">Checked in</p>
      <h2 className="ready-title" id="ready-title">
        You&apos;re in
      </h2>
      <p className="ready-meta">{meta}</p>
      <p className="ready-result">{punctualityLabel(record)}</p>
      <p aria-live="polite" className="ready-status" role="status">
        You&apos;re checked in.
      </p>
    </section>
  );
}

export function ReadyForJiuJitsu({
  candidate,
  program,
  studentId,
  clockIn,
  onCheckedIn,
  siblingHint,
}: Props) {
  const [value, setValue] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const commitStarted = useRef(false);
  const { session } = candidate;
  const meta = `${session.title} · ${formatSessionTimeRange(session)} · ${sessionSite(session)}`;
  const window = selfCheckInWindowLabels(session, isOpenMatProgram(program));
  const busy = phase.kind === "locating" || phase.kind === "sending";

  const refuse = useCallback((message: string) => {
    commitStarted.current = false;
    setValue(0);
    setPhase({ kind: "refused", message });
  }, []);

  const commit = useCallback(async () => {
    if (commitStarted.current) return;
    commitStarted.current = true;
    setPhase({ kind: "locating" });

    try {
      const reading = await readDevicePosition();
      if (reading.status !== "ok") {
        refuse(positionFailureMessage(reading.status));
        return;
      }

      setPhase({ kind: "sending" });
      try {
        const record = await clockIn({
          sessionId: session.sessionId,
          studentId,
          position: reading.position,
        });
        setPhase({ kind: "success", record });
        onCheckedIn(record);
      } catch (error) {
        refuse(selfCheckInFailureMessage(error));
      }
    } catch {
      refuse(positionFailureMessage("unavailable"));
    }
  }, [clockIn, onCheckedIn, refuse, session.sessionId, studentId]);

  const settle = useCallback(() => {
    if (busy || commitStarted.current) return;
    if (value >= commitAt) {
      setValue(100);
      void commit();
      return;
    }
    setValue(0);
  }, [busy, commit, value]);

  const onKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    const isThresholdArrow =
      (event.key === "ArrowRight" || event.key === "ArrowUp") && value >= commitAt;
    if ((event.key !== "End" && !isThresholdArrow) || busy || commitStarted.current) return;
    setValue(100);
    void commit();
  };

  if (candidate.kind === "checkedIn")
    return <ConfirmationCard record={candidate.attendance} session={session} />;
  if (phase.kind === "success") return <ConfirmationCard record={phase.record} session={session} />;

  const status =
    phase.kind === "locating"
      ? "Checking you're at the gym…"
      : phase.kind === "sending"
        ? "Clocking you in…"
        : phase.kind === "refused"
          ? phase.message
          : "";

  return (
    <section className="ready-card" aria-labelledby="ready-title">
      <h2 className="ready-title" id="ready-title" aria-label="Ready for Jiu Jitsu">
        <span>Ready</span>
        <span>for Jiu Jitsu</span>
      </h2>
      <div className="ready-slider-focus">
        <div className="ready-slider" style={{ "--ready-progress": `${value}%` } as CSSProperties}>
          <span className="ready-fill" aria-hidden="true" />
          <span className="ready-label" aria-hidden="true">
            {busy ? "" : "Slide to clock in"}
          </span>
          <input
            aria-label={`Slide to clock in for ${session.title}, ${formatSessionTimeRange(session)}, ${sessionSite(session)}`}
            aria-valuetext={`${value}% — release at the end to clock in`}
            className="ready-range"
            disabled={busy}
            max={100}
            min={0}
            onChange={(event) => {
              if (!busy && !commitStarted.current) setValue(Number(event.target.value));
            }}
            onKeyUp={onKeyUp}
            onPointerUp={settle}
            onTouchEnd={settle}
            type="range"
            value={value}
          />
        </div>
      </div>
      <p className="ready-meta">{meta}</p>
      <p className="ready-window">{`Opens ${window.opens} · closes ${window.closes}`}</p>
      <p
        aria-live="polite"
        className={phase.kind === "refused" ? "ready-status ready-status--refused" : "ready-status"}
        role="status"
      >
        {status}
      </p>
      {siblingHint ? <p className="ready-hint">{siblingHint}</p> : null}
    </section>
  );
}
