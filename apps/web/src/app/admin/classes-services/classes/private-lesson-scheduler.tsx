"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";

import {
  PRIVATE_LESSON_MINUTES,
  PRIVATE_LESSON_OPTIONS,
  privateLessonStarts,
  type PrivateLessonPurchaseRow,
} from "@bpt-jersey/domain/private-lessons";
import type { SessionRecord } from "@bpt-jersey/domain/schedule";

import {
  listPrivateLessonPurchases,
  schedulePrivateLessons,
} from "../../../../lib/private-lesson-client";
import type { ScheduleCatalogResponse } from "../../../../lib/schedule-client";

export type PrivateLessonSchedulerState = Readonly<{ busy: boolean; done: boolean }>;

type Props = Readonly<{
  formId: string;
  catalog: ScheduleCatalogResponse;
  trainers: readonly Readonly<{ key: string; name: string }>[];
  timezone: string;
  defaults?: Readonly<{ date: string; startTime: string }> | undefined;
  onStateChange: (state: PrivateLessonSchedulerState) => void;
  onSaved: (session: SessionRecord | undefined) => void;
}>;

const optionShort = { single: "Single lesson", monthly: "Monthly", "pack-10": "Pack of 10" };

function usable(row: PrivateLessonPurchaseRow, nowMs: number): boolean {
  return row.creditsRemaining > 0 && row.expiresAt !== null && Date.parse(row.expiresAt) > nowMs;
}

function endOf(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const total = (hours ?? 0) * 60 + (minutes ?? 0) + PRIVATE_LESSON_MINUTES;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The office's private lesson step in Create session: the member who paid comes first, then only
 * the choices their purchase allows. Every lesson is 45 minutes, for that member alone.
 */
export function PrivateLessonScheduler({
  formId,
  catalog,
  trainers,
  timezone,
  defaults,
  onStateChange,
  onSaved,
}: Props): ReactElement {
  const [rows, setRows] = useState<PrivateLessonPurchaseRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [purchaseId, setPurchaseId] = useState("");
  const [date, setDate] = useState(defaults?.date ?? "");
  const [startTime, setStartTime] = useState(defaults?.startTime ?? "17:00");
  const [locationId, setLocationId] = useState(catalog.locations[0]?.locationId ?? "");
  const [trainer, setTrainer] = useState(trainers.length === 1 ? (trainers[0]?.key ?? "") : "");
  const [repeatWeekly, setRepeatWeekly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<SessionRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  // ponytail: "now" as the dialog opened; the server re-checks the real time on save.
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    // ponytail: the newest 200 approved purchases; a usable one is at most 3 months old.
    listPrivateLessonPurchases("approved")
      .then((list) => {
        if (!live) return;
        setRows(
          list
            .filter((row) => usable(row, openedAt))
            .sort((a, b) => (a.studentName ?? "").localeCompare(b.studentName ?? "")),
        );
      })
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, [openedAt]);

  useEffect(() => onStateChange({ busy, done: created !== null }), [busy, created, onStateChange]);

  const purchase = rows?.find((row) => row.purchaseId === purchaseId);
  const repeats = purchase !== undefined && purchase.optionId !== "single" && repeatWeekly;
  const starts = useMemo(
    () =>
      purchase && date && startTime
        ? privateLessonStarts(purchase, { date, startTime, repeatWeekly: repeats }, timezone)
        : [],
    [purchase, date, startTime, repeats, timezone],
  );
  const inPast = starts[0] !== undefined && Date.parse(starts[0]) <= openedAt;
  const whenFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const dayFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  function choose(id: string): void {
    setPurchaseId(id);
    setError(null);
    // The monthly plan is one lesson a week by default; a pack or single lesson starts as one date.
    setRepeatWeekly(rows?.find((row) => row.purchaseId === id)?.optionId === "monthly");
  }

  async function submit(): Promise<void> {
    if (created) {
      onSaved(created[0]);
      return;
    }
    if (!purchase || busy || starts.length === 0 || inPast || !trainer || !locationId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await schedulePrivateLessons({
        purchaseId: purchase.purchaseId,
        locationId,
        instructorId: trainer,
        date,
        startTime,
        repeatWeekly: repeats,
      });
      if (result.sessions.length === result.requested) onSaved(result.sessions[0]);
      else setCreated(result.sessions);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to create the lessons.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <p className="cs-notice" data-kind="error" role="alert">
        Private lesson purchases are unavailable. Close and try again.
      </p>
    );
  }
  if (rows === null) {
    return <div className="cs-private-skeleton" aria-busy="true" aria-label="Loading members" />;
  }
  if (rows.length === 0) {
    return (
      <div className="cs-private-empty">
        <h3>No private lessons to arrange</h3>
        <p className="cs-session-help">
          Only members with an approved private lesson payment and lessons left appear here. Approve
          the payment in the Financial dashboard first.
        </p>
        <a className="cs-button" href="/admin/finance?tab=settings">
          Go to the Financial dashboard
        </a>
      </div>
    );
  }
  if (created) {
    return (
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="cs-notice" data-kind="error" role="alert">
          {`Booked ${created.length} of ${starts.length} lessons. The rest were refused (the monthly plan allows one a week, or the credit ran out). Create them one by one.`}
        </p>
      </form>
    );
  }

  const left = purchase ? purchase.creditsRemaining - starts.length : 0;
  return (
    <form
      id={formId}
      className="cs-private"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error === null ? null : (
        <p className="cs-notice" data-kind="error" role="alert">
          {error}
        </p>
      )}
      <h3>Member</h3>
      <label className="cs-field">
        <span>Who paid for private lessons</span>
        <select
          required
          value={purchaseId}
          disabled={busy}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="" disabled>
            Choose a member
          </option>
          {rows.map((row) => (
            <option key={row.purchaseId} value={row.purchaseId}>
              {`${row.studentName ?? "Member"}, ${optionShort[row.optionId]}, ${row.creditsRemaining} left`}
            </option>
          ))}
        </select>
      </label>
      {purchase ? null : (
        <p className="cs-session-help">
          Members with an approved payment and lessons left. The next choices follow what they
          bought.
        </p>
      )}
      {purchase ? (
        <>
          <dl className="cs-private-summary">
            <div>
              <dt>Service</dt>
              <dd>{PRIVATE_LESSON_OPTIONS[purchase.optionId].displayName}</dd>
            </div>
            <div>
              <dt>Lessons left</dt>
              <dd>{`${purchase.creditsRemaining} of ${purchase.creditsGranted}`}</dd>
            </div>
            <div>
              <dt>Use by</dt>
              <dd>{dayFormat.format(new Date(purchase.expiresAt!))}</dd>
            </div>
          </dl>

          <h3>When</h3>
          <div className="cs-form-row cs-session-when">
            <label className="cs-field">
              <span>Date</span>
              <input
                type="date"
                required
                value={date}
                disabled={busy}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="cs-field">
              <span>Start time</span>
              <input
                type="time"
                required
                value={startTime}
                disabled={busy}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
            <div className="cs-field">
              <span>Ends</span>
              <output className="cs-private-end">
                {startTime
                  ? `${endOf(startTime)} (${PRIVATE_LESSON_MINUTES} min)`
                  : "Set a start time"}
              </output>
            </div>
          </div>

          {purchase.optionId === "single" ? null : (
            <fieldset className="cs-private-repeat" disabled={busy}>
              <legend>Repeat</legend>
              <label className="cs-check">
                <input
                  type="radio"
                  name="private-repeat"
                  checked={repeatWeekly}
                  onChange={() => setRepeatWeekly(true)}
                />
                Every week at this time
              </label>
              <label className="cs-check">
                <input
                  type="radio"
                  name="private-repeat"
                  checked={!repeatWeekly}
                  onChange={() => setRepeatWeekly(false)}
                />
                Only this lesson
              </label>
            </fieldset>
          )}

          <h3>Where and with whom</h3>
          <div className="cs-form-row">
            <label className="cs-field">
              <span>Location</span>
              <select
                required
                value={locationId}
                disabled={busy}
                onChange={(event) => setLocationId(event.target.value)}
              >
                {catalog.locations.map((location) => (
                  <option key={location.locationId} value={location.locationId}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="cs-field">
              <span>Trainer</span>
              <select
                required
                value={trainer}
                disabled={busy}
                onChange={(event) => setTrainer(event.target.value)}
              >
                <option value="" disabled>
                  Choose a trainer
                </option>
                {trainers.map((row) => (
                  <option key={row.key} value={row.key}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h3>{starts.length === 1 ? "1 lesson" : `${starts.length} lessons`}</h3>
          {inPast ? (
            <p className="cs-notice" data-kind="error" role="alert">
              Choose a date and time that has not passed.
            </p>
          ) : starts.length === 0 ? (
            <p className="cs-notice" data-kind="error" role="alert">
              {`That date is after the lessons expire on ${dayFormat.format(new Date(purchase.expiresAt!))}.`}
            </p>
          ) : (
            <>
              <ol className="cs-private-dates">
                {starts.map((start) => (
                  <li key={start}>
                    <time dateTime={start}>{whenFormat.format(new Date(start))}</time>
                  </li>
                ))}
              </ol>
              <p className="cs-session-help">
                {`Each lesson is booked for ${purchase.studentName ?? "the member"} and uses one of their lessons.${
                  left > 0 ? ` ${left} left to arrange later.` : ""
                }`}
              </p>
            </>
          )}
        </>
      ) : null}
    </form>
  );
}
