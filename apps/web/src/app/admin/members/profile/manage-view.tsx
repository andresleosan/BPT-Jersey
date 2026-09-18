"use client";

// Plain anchor back to the record, not next/link: MemberRecord reads ?id/&view on mount and on
// popstate only, so a full navigation is what switches between the record and this view.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  daysAtLevel,
  jerseyDateOf,
  listPromotionGaps,
  type LevelCatalogProjection,
  type LevelDefinitionRecord,
  type LevelHistoryEntry,
} from "@bpt-jersey/domain/levels";

import {
  assignLevel,
  getLevelCatalog,
  getStudentLevelCard,
  getStudentLevelHistory,
  getStudentSkillScores,
  levelsSafeErrors,
  openStudentLevel,
  voidPromotion,
  type StudentLevelCard,
  type StudentLevelHistory,
} from "../../../../lib/levels-client";
import { BeltBar } from "../../../levels/levels-browser";
import { beltPosition, groupBelts } from "../../../levels/levels-grouping";
import { formatCriterion } from "./ibjjf-card";

type Scores = Awaited<ReturnType<typeof getStudentSkillScores>>;
type Loaded = Readonly<{
  catalog: LevelCatalogProjection;
  card: StudentLevelCard;
  history: StudentLevelHistory;
  scores: Scores;
}>;
type ViewState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; data: Loaded }>;

const openLevelError = "Unable to open the level. Please try again.";
const notRecorded = "not recorded";

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * History days are calendar dates, not instants, so they are formatted in UTC. A stored day that
 * cannot be parsed returns `null` rather than reaching `Intl.DateTimeFormat.format`, which THROWS
 * on an invalid date and would take the whole record down over one bad row.
 */
function formatDay(day: string | null): string | null {
  if (day === null) return null;
  const at = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? null : dayLabel.format(at);
}

const roleLabel = (role: "headCoach" | "owner" | null): string | null =>
  role === "headCoach" ? "Head coach" : role === "owner" ? "Owner" : null;

const noteIsValid = (value: string) => value.trim().length >= 10 && value.trim().length <= 500;

/**
 * The clients promise that every rejection carries one of their own fixed strings. This checks it
 * instead of trusting it: a rejection raised anywhere else (a TypeError in this component, a
 * network layer, a future client that forgets) must not reach the operator with its own words in
 * it. Nothing outside `levelsSafeErrors` is ever rendered.
 */
const safeErrors: readonly string[] = Object.values(levelsSafeErrors);
function safeMessage(failure: unknown, fallback: string): string {
  return failure instanceof Error && safeErrors.includes(failure.message)
    ? failure.message
    : fallback;
}

/**
 * The void record degrades one sub-field at a time (Task 10, DECISION 5): a void that exists
 * always cancels its promotion, even when nobody, no date and no reason were stored with it. Every
 * segment says "not recorded" rather than being dropped, so the row never reads as if the missing
 * part were the whole story, and nothing is ever fabricated.
 */
function voidedStatus(voided: NonNullable<LevelHistoryEntry["voided"]>): string {
  const author = roleLabel(voided.voidedByRole) ?? `author ${notRecorded}`;
  const day = formatDay(voided.voidedOn) ?? `date ${notRecorded}`;
  const reason =
    voided.reason === null || voided.reason.trim() === "" ? `reason ${notRecorded}` : voided.reason;
  return `Voided — ${author} — ${day} — ${reason}`;
}

function ConfirmDialog({
  title,
  confirmLabel,
  confirmDisabled,
  busy,
  onCancel,
  onConfirm,
  children,
}: Readonly<{
  title: string;
  confirmLabel: string;
  confirmDisabled: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.querySelector<HTMLElement>("textarea, button")?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  return (
    <dialog
      aria-labelledby="ibjjf-dialog-title"
      className="ibjjf-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      open
      ref={ref}
    >
      <h3 id="ibjjf-dialog-title">{title}</h3>
      {children}
      <div className="ibjjf-dialog-actions">
        <button className="ibjjf-button" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="admin-auth-button"
          disabled={confirmDisabled || busy}
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

function OpenLevelForm({
  studentId,
  catalog,
  today,
  onDone,
}: Readonly<{
  studentId: string;
  catalog: LevelCatalogProjection;
  today: string;
  onDone: (notice: string) => void;
}>) {
  const [definitionKey, setDefinitionKey] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const levels = [...catalog.definitions].sort((left, right) => left.sequence - right.sequence);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // One request in flight. The `disabled` attribute below is not enough on its own: two clicks
    // dispatched before React re-renders both read the same stale `busy`, so the flag is a ref,
    // which is written before the await. The callable does not deduplicate (Task 12, carried), so
    // a second submit would open a second audited record on a real member.
    if (inFlight.current) return;
    if (definitionKey === "" || startedOn === "" || notes.trim().length < 3) {
      setError("Choose a level, a start date and write a short note.");
      return;
    }
    // Set only once the submit is going through, so a refused form can be corrected and sent.
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await openStudentLevel({ studentId, definitionKey, startedOn, decisionNotes: notes.trim() });
      onDone("Level opened.");
    } catch {
      setError(openLevelError);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      aria-labelledby="ibjjf-open-title"
      className="ibjjf-form"
      onSubmit={(event) => void submit(event)}
    >
      <h3 id="ibjjf-open-title">Open level</h3>
      <label htmlFor="ibjjf-open-level">
        Level
        <select
          id="ibjjf-open-level"
          onChange={(event) => setDefinitionKey(event.target.value)}
          value={definitionKey}
        >
          <option value="">Select a level</option>
          {levels.map((level) => (
            <option key={level.definitionKey} value={level.definitionKey}>
              {level.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="ibjjf-open-date">
        Start date
        <input
          id="ibjjf-open-date"
          max={today}
          onChange={(event) => setStartedOn(event.target.value)}
          type="date"
          value={startedOn}
        />
      </label>
      <label htmlFor="ibjjf-open-notes">
        Notes
        <textarea
          id="ibjjf-open-notes"
          maxLength={1000}
          onChange={(event) => setNotes(event.target.value)}
          value={notes}
        />
      </label>
      {error === null ? null : (
        <p className="ibjjf-error" role="alert">
          {error}
        </p>
      )}
      <button className="admin-auth-button" disabled={busy} type="submit">
        Open level
      </button>
    </form>
  );
}

function AssignLevelForm({
  studentId,
  fullName,
  age,
  data,
  current,
  today,
  onDone,
}: Readonly<{
  studentId: string;
  fullName: string;
  age: number | null;
  data: Loaded;
  current: LevelDefinitionRecord;
  today: string;
  onDone: (notice: string) => void;
}>) {
  const { catalog, card, scores } = data;
  const [toKey, setToKey] = useState("");
  const [promotedOn, setPromotedOn] = useState("");
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const later = [...catalog.definitions]
    .filter((definition) => definition.sequence > current.sequence)
    .sort((left, right) => left.sequence - right.sequence);
  const target = later.find((definition) => definition.definitionKey === toKey);
  const startedOn =
    card.state === "initialized" ? card.currentLevelStartedAt?.slice(0, 10) : undefined;
  const classesDone = card.state === "initialized" ? card.criteria.classes.completed : 0;
  const startedAt = card.state === "initialized" ? card.currentLevelStartedAt : null;

  // Both keys are read out of the catalogue above, so `listPromotionGaps` cannot throw here.
  // Classes are the count as of TODAY; the server recounts them up to the promotion date and has
  // the last word, which is why a backdated promotion says so in the dialog. Scores are the LATEST
  // rating for each skill, never the best ever given (operator DECISION 6).
  const gaps =
    target === undefined || promotedOn === ""
      ? []
      : listPromotionGaps({
          definitions: catalog.definitions,
          requirements: catalog.requirements,
          fromDefinitionKey: current.definitionKey,
          toDefinitionKey: target.definitionKey,
          classesDone,
          daysDone: daysAtLevel(startedAt, `${promotedOn}T00:00:00.000Z`),
          skillScores: scores.latest,
          ageYears: age,
        });
  const noteRequired = gaps.length > 0;
  const confirmDisabled = noteRequired
    ? !noteIsValid(note)
    : note.trim() !== "" && !noteIsValid(note);

  function review(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (target === undefined || promotedOn === "") {
      setError("Choose a level and a promotion date.");
      return;
    }
    setError(null);
    setDialogError(null);
    setReviewing(true);
  }

  async function confirm(): Promise<void> {
    // One request in flight, held in a ref for the reason spelled out in `OpenLevelForm`: a
    // second promotion would be a second audited record on a real member, and the callable does
    // not deduplicate (Task 12, carried).
    if (target === undefined || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setDialogError(null);
    try {
      await assignLevel({
        studentId,
        fromDefinitionKey: current.definitionKey,
        toDefinitionKey: target.definitionKey,
        promotedOn,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      });
      setReviewing(false);
      onDone("Level assigned.");
    } catch (failure) {
      // The dialog stays open: the note is the one thing the operator can still change, and a
      // refusal on an assignment sent without one is the case where that matters most.
      setDialogError(safeMessage(failure, levelsSafeErrors.assign));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form aria-labelledby="ibjjf-assign-title" className="ibjjf-form" onSubmit={review}>
      <h3 id="ibjjf-assign-title">Assign next level</h3>
      <label htmlFor="ibjjf-assign-level">
        Next level
        <select
          id="ibjjf-assign-level"
          onChange={(event) => setToKey(event.target.value)}
          value={toKey}
        >
          <option value="">Select a level</option>
          {later.map((level) => (
            <option key={level.definitionKey} value={level.definitionKey}>
              {level.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="ibjjf-assign-date">
        Promotion date
        <input
          id="ibjjf-assign-date"
          max={today}
          min={startedOn}
          onChange={(event) => setPromotedOn(event.target.value)}
          type="date"
          value={promotedOn}
        />
      </label>
      {error === null ? null : (
        <p className="ibjjf-error" role="alert">
          {error}
        </p>
      )}
      <button className="admin-auth-button" type="submit">
        Review promotion
      </button>
      {reviewing && target !== undefined ? (
        <ConfirmDialog
          busy={busy}
          confirmDisabled={confirmDisabled}
          confirmLabel="Confirm promotion"
          onCancel={() => setReviewing(false)}
          onConfirm={() => void confirm()}
          title={`Promote ${fullName} from ${current.name} to ${target.name} on ${formatDay(promotedOn) ?? promotedOn}?`}
        >
          {gaps.length === 0 ? (
            <p>All criteria for this level are met.</p>
          ) : (
            <>
              <p>
                Not every criterion BPT records for this level is met. A note is required and is
                kept with the promotion.
              </p>
              <ul aria-label="Criteria not met">
                {gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </>
          )}
          {promotedOn === today ? null : (
            <p className="ibjjf-muted">
              {`Classes are counted as of today, not as of ${formatDay(promotedOn) ?? promotedOn}. The final check runs when the promotion is recorded.`}
            </p>
          )}
          <label htmlFor="ibjjf-assign-note">
            {noteRequired
              ? "Note (required, 10 to 500 characters)"
              : "Note (optional, 10 to 500 characters)"}
            <textarea
              id="ibjjf-assign-note"
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              value={note}
            />
          </label>
          {dialogError === null ? null : (
            <p className="ibjjf-error" role="alert">
              {dialogError}
            </p>
          )}
        </ConfirmDialog>
      ) : null}
    </form>
  );
}

function HistoryTable({
  history,
  catalog,
  canDecide,
  onVoid,
}: Readonly<{
  history: StudentLevelHistory;
  catalog: LevelCatalogProjection;
  canDecide: boolean;
  onVoid: (entry: LevelHistoryEntry) => void;
}>) {
  const groups = groupBelts(catalog);
  const names = new Map(
    catalog.definitions.map((definition) => [definition.definitionKey, definition.name]),
  );
  const current = history.entries.find(
    (entry) => entry.voided === null && entry.definitionKey === history.currentDefinitionKey,
  );
  // Only the latest standing promotion can be voided, and the history says which one that is. The
  // refusal string deliberately covers four causes, so the one an operator can act on is offered
  // here, from the data, rather than guessed at from an error (Task 10, carried).
  const voidable = history.entries.find(
    (entry) => entry.kind === "promotion" && entry.voided === null,
  );

  return (
    <section aria-labelledby="ibjjf-history-title" className="ibjjf-history-section">
      <h3 id="ibjjf-history-title">Level history</h3>
      {history.entries.length === 0 ? (
        <p className="ibjjf-muted">No level history yet.</p>
      ) : (
        <div className="admin-data-table-wrap">
          <table aria-labelledby="ibjjf-history-title" className="admin-data-table ibjjf-history">
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Assigned on</th>
                <th scope="col">Classes</th>
                <th scope="col">Days</th>
                <th scope="col">Promoted by</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.entries.map((entry) => {
                const position = beltPosition(groups, entry.definitionKey);
                const isVoidable = canDecide && entry.kind === "promotion" && entry.voided === null;
                return (
                  <tr
                    className={entry.voided === null ? undefined : "ibjjf-voided"}
                    key={entry.entryId}
                  >
                    <td>
                      {position === null ? null : (
                        <span aria-hidden="true" className="ibjjf-belt-mini">
                          <BeltBar
                            name={position.belt.name}
                            stripeCount={position.stripeCount}
                            visual={position.belt.visual}
                          />
                        </span>
                      )}
                      {names.get(entry.definitionKey) ?? entry.definitionKey}
                      {entry.gaps.length === 0 ? null : (
                        <span className="ibjjf-muted">{` Below criteria: ${entry.gaps.join(", ")}`}</span>
                      )}
                      {entry.note === null ? null : (
                        <span className="ibjjf-muted">{` ${entry.note}`}</span>
                      )}
                    </td>
                    <td className="ibjjf-number">
                      {formatDay(entry.assignedOn) ?? `Date ${notRecorded}`}
                    </td>
                    <td className="ibjjf-number">
                      {entry.classes === null
                        ? "—"
                        : formatCriterion(entry.classes.done, entry.classes.min)}
                    </td>
                    <td className="ibjjf-number">
                      {entry.days === null ? "—" : formatCriterion(entry.days.done, entry.days.min)}
                    </td>
                    <td>
                      {entry.source === "regyfit-import"
                        ? "Regyfit import"
                        : (roleLabel(entry.decidedByRole) ?? "—")}
                    </td>
                    <td>
                      {entry.voided !== null
                        ? voidedStatus(entry.voided)
                        : entry.entryId === current?.entryId
                          ? "Current"
                          : "Previous"}
                    </td>
                    <td>
                      {!isVoidable ? null : voidable?.entryId === entry.entryId ? (
                        <button
                          className="ibjjf-button"
                          onClick={() => onVoid(entry)}
                          type="button"
                        >
                          Void
                        </button>
                      ) : (
                        <span className="ibjjf-muted">Void the latest promotion first</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ManageView({
  studentId,
  fullName,
  age,
  role,
  recordHref,
}: Readonly<{
  studentId: string;
  fullName: string;
  age: number | null;
  role: string;
  recordHref: string;
}>) {
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<LevelHistoryEntry | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const inFlight = useRef(false);
  // G12: an administrator sees this record and its history, and reaches no decision at all.
  const canDecide = role === "owner" || role === "headCoach";
  const today = jerseyDateOf(new Date().toISOString());

  /**
   * Three restricted reads per open — the card, the history and the skill ratings — against the
   * budget of 20 per five minutes shared by five methods. None is spare: the card carries the
   * classes and the level start, the history is the table and the one honest source of which
   * promotion may be voided, and the ratings decide the `Skills n/m at minimum` gap that would
   * otherwise let the dialog claim every criterion is met for a child whose minimums are not.
   */
  useEffect(() => {
    let active = true;
    Promise.all([
      getLevelCatalog(),
      getStudentLevelCard(studentId),
      getStudentLevelHistory(studentId),
      getStudentSkillScores(studentId),
    ])
      .then(([catalog, card, history, scores]) => {
        if (active) setState({ status: "ready", data: { catalog, card, history, scores } });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [studentId, attempt]);

  const reload = useCallback((message: string) => {
    setNotice(message);
    setAttempt((value) => value + 1);
  }, []);

  async function confirmVoid(): Promise<void> {
    // One request in flight, held in a ref (see `OpenLevelForm`): the callable does not
    // deduplicate (Task 12, carried), and a second void is a second audited record.
    if (voiding === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setVoidError(null);
    try {
      await voidPromotion({ studentId, promotionId: voiding.entryId, reason: reason.trim() });
      setVoiding(null);
      setReason("");
      reload("Promotion voided.");
    } catch (failure) {
      // One string for four causes, by design. Nothing here tries to work out which one fired.
      setVoidError(safeMessage(failure, levelsSafeErrors.void));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const data = state.status === "ready" ? state.data : null;
  const card = data?.card ?? null;
  const currentKey =
    card !== null && card.state === "initialized" ? card.currentDefinition.definitionKey : null;
  const currentDefinition =
    data === null || currentKey === null
      ? null
      : (data.catalog.definitions.find((definition) => definition.definitionKey === currentKey) ??
        null);
  const hasLaterLevel =
    data !== null &&
    currentDefinition !== null &&
    data.catalog.definitions.some((definition) => definition.sequence > currentDefinition.sequence);

  function decisions(loaded: Loaded): ReactNode {
    if (!canDecide) {
      return (
        <p className="ibjjf-muted">
          {loaded.card.state === "uninitialized"
            ? "No level yet. A head coach or the owner opens it."
            : "Only a head coach or the owner can open, assign or void a level."}
        </p>
      );
    }
    if (loaded.card.state === "uninitialized") {
      return (
        <OpenLevelForm
          catalog={loaded.catalog}
          onDone={reload}
          studentId={studentId}
          today={today}
        />
      );
    }
    if (currentDefinition === null) {
      return (
        <p className="ibjjf-muted">
          The level on record is not in the current catalogue, so no assignment can be checked here.
        </p>
      );
    }
    if (!hasLaterLevel) {
      return (
        <p className="ibjjf-muted">
          This is the highest level BPT tracks, so there is no next level to assign.
        </p>
      );
    }
    return (
      <AssignLevelForm
        age={age}
        current={currentDefinition}
        data={loaded}
        fullName={fullName}
        onDone={reload}
        studentId={studentId}
        today={today}
      />
    );
  }

  return (
    <section aria-labelledby="ibjjf-manage-title" className="ibjjf-manage">
      <div>
        <a className="member-record-link" href={recordHref}>
          Back to record
        </a>
      </div>
      <p className="admin-eyebrow">JIU-JITSU IBJJF / Manage</p>
      <h2 id="ibjjf-manage-title">{fullName}</h2>
      <p className="ibjjf-muted">
        {`${age === null ? "Age unknown" : `${age} years old`} · ${data?.catalog.system.displayName ?? "JIU-JITSU - IBJJF"}`}
      </p>
      {notice === null ? null : (
        <p className="ibjjf-notice" role="status">
          {notice}
        </p>
      )}
      {state.status === "loading" ? (
        <div aria-busy="true" className="ibjjf-card ibjjf-skeleton" />
      ) : null}
      {state.status === "error" ? (
        <>
          <p className="ibjjf-error" role="alert">
            {levelsSafeErrors.card}
          </p>
          <button
            className="admin-auth-button"
            onClick={() => setAttempt((value) => value + 1)}
            type="button"
          >
            Try again
          </button>
        </>
      ) : null}
      {data === null ? null : (
        <>
          {decisions(data)}
          <HistoryTable
            canDecide={canDecide}
            catalog={data.catalog}
            history={data.history}
            onVoid={(entry) => {
              setReason("");
              setVoidError(null);
              setVoiding(entry);
            }}
          />
        </>
      )}
      {voiding === null || data === null ? null : (
        <ConfirmDialog
          busy={busy}
          confirmDisabled={!noteIsValid(reason)}
          confirmLabel="Void promotion"
          onCancel={() => setVoiding(null)}
          onConfirm={() => void confirmVoid()}
          title={`Void the promotion of ${fullName} to ${data.catalog.definitions.find((definition) => definition.definitionKey === voiding.definitionKey)?.name ?? voiding.definitionKey}?`}
        >
          <p>
            The previous level is restored. The promotion stays in the history, marked as voided.
          </p>
          <label htmlFor="ibjjf-void-reason">
            Reason (required, 10 to 500 characters)
            <textarea
              id="ibjjf-void-reason"
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </label>
          {voidError === null ? null : (
            <p className="ibjjf-error" role="alert">
              {voidError}
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
