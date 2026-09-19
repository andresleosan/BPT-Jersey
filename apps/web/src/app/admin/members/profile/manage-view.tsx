"use client";

// Plain anchor back to the record, not next/link: MemberRecord reads ?id/&view on mount and on
// popstate only, so a full navigation is what switches between the record and this view.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  daysAtLevel,
  jerseyDateOf,
  listPromotionGaps,
  promotionNoteSchema,
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
import { AdminDataTableWrap } from "../../admin-data-table";
import { formatCriterion } from "./ibjjf-card";
import { safeMessage } from "./safe-message";
import { SkillsAssessment, type SkillRating } from "./skills-assessment";

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

const notRecorded = "not recorded";

/**
 * One question for every exit that would throw unsaved ratings away. `MemberRecord` asks it too:
 * the tab strip, the browser's own Back and the member-search link all unmount this view, and
 * none of them can see a flag that lives only in here.
 */
export const unsavedRatingsQuestion = "Discard unsaved ratings?";

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

/**
 * T051V2 review of Task 16 (Major-1): the dialog used to measure the trimmed length itself, which
 * is NOT the contract. `promotionNoteSchema` normalises `\r\n?` to `\n` BEFORE measuring and
 * refuses every C0 control character and DEL, so a 12-character note carrying an invisible BEL or
 * NUL passed here and was refused by the server with a generic string, on the one screen where the
 * note is mandatory. The contract is now the only judge.
 */
const noteIsValid = (value: string) => promotionNoteSchema.safeParse(value).success;

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
  /**
   * T051V2 review of Task 16 (Major-4): this dialog decides something irreversible and audited
   * about a named person, so it is a REAL modal. `showModal()` is what gives it the focus trap,
   * the inert background, the backdrop and native Escape; `<dialog open>` set none of those while
   * looking exactly like it did, and one Shift+Tab reached the background and killed the
   * hand-rolled Escape with it.
   *
   * jsdom implements neither `showModal` nor `close` (probed on jsdom 30), so the unit suite runs
   * the fallback below and the `onKeyDown` handler is what closes it THERE. A browser always has
   * `showModal`, so the trap and the native Escape are what run in front of an operator — and
   * neither an axe pass nor a jsdom test can prove that, so it is owed a manual check.
   */
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    const opener = document.activeElement;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLElement>("textarea, button")?.focus();
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  return (
    <dialog
      aria-labelledby="ibjjf-dialog-title"
      aria-modal="true"
      className="ibjjf-dialog"
      onCancel={(event) => {
        // Native Escape. Prevented so the platform does not close the element behind React's
        // back: the state change below is what unmounts it.
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && typeof ref.current?.showModal !== "function") {
          onCancel();
        }
      }}
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
      // The flag is NOT cleared here (Critical-3): `onDone` puts the view back into `loading` and
      // this form unmounts with the reload, so nothing is left clickable over the stale data.
      onDone("Level opened.");
    } catch (failure) {
      setError(safeMessage(failure, levelsSafeErrors.open));
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
  mayDiscardRatings,
  onDone,
}: Readonly<{
  studentId: string;
  fullName: string;
  age: number | null;
  data: Loaded;
  current: LevelDefinitionRecord;
  today: string;
  mayDiscardRatings: () => boolean;
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
  //
  // T051V2 review of Task 16 (Major-5): `age` is the age TODAY, taken from the record header,
  // which carries no date of birth — so the age at a backdated `promotedOn` cannot be derived
  // here without a further read and a contract change. DECISION: the caveat in the dialog names
  // the age band alongside the classes rather than compute it from a date this view does not
  // have. The server has the last word on the age band exactly as it does on the classes.
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
  // A note that was typed but the contract will not take. `levelsSafeErrors.assignInput` is the
  // one string in the allowlist whose advice is both true and actionable BEFORE any call, and it
  // is what points at an invisible control character the length alone cannot explain.
  const noteRefused = note !== "" && !noteIsValid(note);

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
    // `onDone` reloads, which unmounts the assessment panel with whatever it still holds.
    if (!mayDiscardRatings()) return;
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
      // Critical-3: the flag is NOT cleared on success. `onDone` puts the view back into
      // `loading`, which unmounts this form and its dialog, so the operator cannot send the same
      // promotion twice into the window between the write resolving and the reload landing.
      onDone("Level assigned.");
    } catch (failure) {
      // The dialog stays open: the note is the one thing the operator can still change, and a
      // refusal on an assignment sent without one is the case where that matters most.
      setDialogError(safeMessage(failure, levelsSafeErrors.assign));
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
            <p>All criteria BPT records for this level are met as of today.</p>
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
              {`Classes and the age band are counted as of today, not as of ${formatDay(promotedOn) ?? promotedOn}. The final check runs when the promotion is recorded.`}
            </p>
          )}
          <label htmlFor="ibjjf-assign-note">
            {noteRequired
              ? "Note (required, 10 to 500 characters)"
              : "Note (optional, 10 to 500 characters)"}
            <textarea
              aria-describedby={noteRefused ? "ibjjf-assign-note-problem" : undefined}
              id="ibjjf-assign-note"
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              value={note}
            />
          </label>
          {noteRefused ? (
            <p className="ibjjf-error" id="ibjjf-assign-note-problem">
              {levelsSafeErrors.assignInput}
            </p>
          ) : null}
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
  const current =
    history.currentDefinitionKey === null
      ? undefined
      : history.entries.find(
          (entry) => entry.voided === null && entry.definitionKey === history.currentDefinitionKey,
        );
  /**
   * T051V2 review of Task 16 (Critical-1). Only ONE promotion can be voided, and it is the one the
   * progress head recorded last — NOT the newest row by `assignedOn`. The two are a different
   * thing in two reachable shapes: TWO PROMOTIONS ON THE SAME DAY, where the history's sort
   * comparator is inconsistent for a tie and the row it puts first is arbitrary; and PLAN D's
   * REGYFIT IMPORT, which writes promotions straight into the collection with whatever dates the
   * source carries. (Through `assignLevel` alone they cannot diverge by more than a tie:
   * `assertPromotionNotBeforeLevelStart` refuses a date before the current level start and the
   * promotion then starts the new level on its own day, so `assignedOn` never decreases along the
   * standing chain.) When they did diverge, the row labelled "Current" was told to void something
   * else first while the Void button sat on a row the server refuses. The head's own id now
   * travels with the history, so this names exactly what `voidPromotion` accepts. The refusal
   * itself stays opaque: nothing here tries to say which of its four causes fired.
   */
  const voidable =
    history.lastApprovedPromotionId === null
      ? undefined
      : history.entries.find(
          (entry) =>
            entry.entryId === history.lastApprovedPromotionId &&
            entry.kind === "promotion" &&
            entry.voided === null,
        );

  return (
    <section aria-labelledby="ibjjf-history-title" className="ibjjf-history-section">
      <h3 id="ibjjf-history-title">Level history</h3>
      {history.entries.length === 0 ? (
        <p className="ibjjf-muted">No level history yet.</p>
      ) : (
        <AdminDataTableWrap label="Level history">
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
                    <td data-label="Level">
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
                        <span className="ibjjf-entry-aside">{`Below criteria: ${entry.gaps.join(", ")}`}</span>
                      )}
                      {entry.note === null ? null : (
                        <span className="ibjjf-entry-aside">{entry.note}</span>
                      )}
                    </td>
                    <td className="ibjjf-number" data-label="Assigned on">
                      {formatDay(entry.assignedOn) ?? `Date ${notRecorded}`}
                    </td>
                    <td className="ibjjf-number" data-label="Classes">
                      {entry.classes === null
                        ? "—"
                        : formatCriterion(entry.classes.done, entry.classes.min)}
                    </td>
                    <td className="ibjjf-number" data-label="Days">
                      {entry.days === null ? "—" : formatCriterion(entry.days.done, entry.days.min)}
                    </td>
                    <td data-label="Promoted by">
                      {entry.source === "regyfit-import"
                        ? "Imported"
                        : (roleLabel(entry.decidedByRole) ?? "—")}
                    </td>
                    <td data-label="Status">
                      {entry.voided !== null ? (
                        <span className="ibjjf-status-voided">{voidedStatus(entry.voided)}</span>
                      ) : current !== undefined ? (
                        entry.entryId === current.entryId ? (
                          "Current"
                        ) : (
                          "Previous"
                        )
                      ) : (
                        // Critical-2: `currentDefinitionKey` is nullable. With no level on record
                        // there is no "Previous" to claim either — calling a standing promotion a
                        // former one is a false statement about a real member's belt, so this
                        // asserts nothing.
                        "—"
                      )}
                    </td>
                    <td data-label="Actions">
                      {!isVoidable || voidable === undefined ? null : voidable.entryId ===
                        entry.entryId ? (
                        <button
                          className="ibjjf-button"
                          onClick={() => onVoid(entry)}
                          type="button"
                        >
                          Void
                        </button>
                      ) : (
                        <span className="ibjjf-muted">
                          Void the most recently recorded promotion first
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminDataTableWrap>
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
  onRatingsDirtyChange,
}: Readonly<{
  studentId: string;
  fullName: string;
  age: number | null;
  role: string;
  recordHref: string;
  onRatingsDirtyChange: (dirty: boolean) => void;
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
  /**
   * Rating is a wider door than deciding: `ratingRoles` on `recordEvaluation` accepts a coach as
   * well, who may never open, assign or void. The two must not be collapsed into one flag.
   */
  const canRate = canDecide || role === "coach";
  /**
   * Task 17 review, Major-2: this panel does not own its own lifetime. Four of the five ways out
   * of it are owned by `MemberRecord` (tab click, arrow key, browser Back/Forward, the member
   * search link), so the flag is reported UPWARDS as well as kept here for the two exits this
   * view does own (the record anchor and an operator-initiated reload).
   */
  const [dirtyRatings, setDirtyRatings] = useState(false);
  const reportRatingsDirty = useRef(onRatingsDirtyChange);
  useEffect(() => {
    reportRatingsDirty.current = onRatingsDirtyChange;
  });
  const setRatingsDirty = useCallback((dirty: boolean) => {
    setDirtyRatings(dirty);
    reportRatingsDirty.current(dirty);
  }, []);
  // Unmounting is not saving: whatever took this view off the screen, the record must stop
  // guarding ratings that no longer exist.
  useEffect(() => () => reportRatingsDirty.current(false), []);
  const today = jerseyDateOf(new Date().toISOString());

  /**
   * THREE network reads per open, plus one local catalogue resolve: under the shipped default
   * (`NEXT_PUBLIC_LEVELS_BACKEND=false`) `getLevelCatalog` returns `getBundledLevelCatalog()` and
   * makes no network call at all. It is a fourth network read only when the connected levels
   * backend is enabled, which is when it calls `listLevelCatalog`. None of the four is spare: the
   * card carries the classes and the
   * level start, the history is the table and the one honest source of which promotion may be
   * voided, and the ratings decide the `Skills n/m at minimum` gap that would otherwise let the
   * dialog claim every criterion is met for a child whose minimums are not.
   *
   * T051V2 review of Task 16 (Major-3): an earlier note here counted three reads and charged them
   * to a "20 restricted reads / 5 minutes" budget. Both were wrong. The only such limiter in the
   * codebase is `restrictedAttemptLimit` in `canonical-member-directory-read-service.ts`, whose
   * action union contains NO levels callable, so no levels read is governed by it. Nothing in the
   * levels stack may cite that budget.
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

  /**
   * T051V2 review of Task 16 (Critical-3): this used to bump `attempt` and nothing else, so `data`
   * kept the PRE-WRITE snapshot for the whole refetch. "Level assigned." was announced beside a
   * history table that did not contain the promotion, and the assign form stayed mounted with the
   * same values — which, with the in-flight flag cleared as soon as the write resolved, sent a
   * SECOND identical `assignLevel` from a second operator click. Going back to `loading` unmounts
   * the forms and the table until the new data lands, so there is nothing stale to act on.
   */
  const reload = useCallback(
    (message: string) => {
      setNotice(message);
      setState({ status: "loading" });
      // The assessment panel is unmounted by the line above and remounted on the fresh data, so any
      // rating it still held is gone. Leaving the flag set would make "Back to record" ask to
      // discard edits that no longer exist.
      setRatingsDirty(false);
      setAttempt((value) => value + 1);
    },
    [setRatingsDirty],
  );

  /**
   * Task 17 review, Major-1: a ratings save used to call `reload`, which unmounted the panel and
   * remounted it on a refetch that could not contain a rating made while the write was in flight.
   * The operator read "Ratings saved." and their last click was gone.
   *
   * Nothing else on this screen moves when a rating is saved: the card's criteria used here are
   * the CLASS count, and the history is untouched. The one thing that does move is
   * `scores.latest`, which the server now holds at exactly what was sent (latest-wins, operator
   * DECISION 6). So the save moves that map in place and leaves the panel mounted, which is also
   * three network reads fewer per save.
   * // ponytail: `scores.best` is left alone. No consumer in this view reads it; the next real
   * // reload refetches both.
   */
  const applySavedRatings = useCallback((saved: readonly SkillRating[]) => {
    setNotice("Ratings saved.");
    setState((current) =>
      current.status !== "ready"
        ? current
        : {
            status: "ready",
            data: {
              ...current.data,
              scores: {
                ...current.data.scores,
                latest: {
                  ...current.data.scores.latest,
                  ...Object.fromEntries(saved.map((rating) => [rating.skillKey, rating.score])),
                },
              },
            },
          },
    );
  }, []);

  /**
   * Asked immediately before a write whose `reload` will unmount the assessment panel, never on
   * merely opening a dialog: a question that costs the operator nothing to answer wrongly is not
   * a guard. `OpenLevelForm` needs no such call — it only renders while the card is
   * `uninitialized`, which is exactly when the panel is not on screen at all.
   */
  const mayDiscardRatings = useCallback(
    () => !dirtyRatings || window.confirm(unsavedRatingsQuestion),
    [dirtyRatings],
  );

  async function confirmVoid(): Promise<void> {
    // One request in flight, held in a ref (see `OpenLevelForm`): the callable does not
    // deduplicate (Task 12, carried), and a second void is a second audited record.
    if (voiding === null || inFlight.current) return;
    if (!mayDiscardRatings()) return;
    inFlight.current = true;
    setBusy(true);
    setVoidError(null);
    try {
      await voidPromotion({ studentId, promotionId: voiding.entryId, reason: reason.trim() });
      setVoiding(null);
      setReason("");
      // Critical-3: `reload` goes back to `loading` in the SAME React batch as `setVoiding(null)`,
      // so the dialog, the Void buttons and the stale table are all gone before the flag below is
      // cleared. There is no render in which a second void could be started over pre-write data.
      // Unlike the forms, this component is not unmounted by the reload, so the flag and `busy`
      // must be cleared or no later void could ever be started.
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
  /**
   * Skill minimums belong to the level a member is moving INTO (plan decision 5), so they are the
   * TARGET definition's requirements, never the current one's. With no target recorded, no minimum
   * is claimed for any skill rather than the current level's being shown as if it were the gate.
   */
  const targetKey =
    card !== null && card.state === "initialized"
      ? (card.targetDefinition?.definitionKey ?? null)
      : null;
  const minimums = Object.fromEntries(
    (data?.catalog.requirements ?? [])
      .filter((requirement) => requirement.definitionKey === targetKey)
      .map((requirement) => [requirement.skillKey, requirement.minimumRating]),
  );
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
        mayDiscardRatings={mayDiscardRatings}
        onDone={reload}
        studentId={studentId}
        today={today}
      />
    );
  }

  return (
    <section aria-labelledby="ibjjf-manage-title" className="ibjjf-manage">
      <div>
        <a
          className="member-record-link"
          href={recordHref}
          onClick={(event) => {
            // A full navigation, so React state does not survive it: unsaved ratings are lost
            // silently unless the operator is asked first.
            if (!mayDiscardRatings()) event.preventDefault();
          }}
        >
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
          {data.card.state === "initialized" && canRate ? (
            <SkillsAssessment
              definitionKey={data.card.currentDefinition.definitionKey}
              definitionName={currentDefinition?.name ?? null}
              hasTarget={targetKey !== null}
              initialScores={data.scores.latest}
              /*
               * A new panel per SERVER reload — an open, an assignment or a void, each of which
               * really does replace the ratings on record. Saving ratings is no longer such a
               * reload (Major-1), so `attempt` does not move and the panel is never thrown away
               * under an operator who is still typing into it.
               */
              key={`skills-${attempt}`}
              minimums={minimums}
              onDirtyChange={setRatingsDirty}
              onSaved={applySavedRatings}
              skills={data.catalog.skills}
              studentId={studentId}
            />
          ) : null}
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
