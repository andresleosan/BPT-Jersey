"use client";

import { useEffect, useRef, useState } from "react";
import { skillCategory, type SkillDefinition } from "@bpt-jersey/domain/levels";

import { levelsSafeErrors, recordSkillRatings } from "../../../../lib/levels-client";
import { safeMessage } from "./safe-message";

const scoreValues = [1, 2, 3, 4, 5] as const;
type Score = (typeof scoreValues)[number];
type Ratings = Record<string, Score>;

/** What a save really sent, handed back so the parent can move its own copy of the ratings. */
export type SkillRating = Readonly<{ skillKey: string; score: number }>;

function isScore(value: number): value is Score {
  return (scoreValues as readonly number[]).includes(value);
}

/**
 * `scoreSchema` already refuses anything but 1..5 on the way in from `listStudentEvaluations`, so
 * this is the type boundary, not a second opinion on the server: the props are plain numbers and a
 * cast would let a 0 or a 7 reach the radios, where it renders as nothing checked and is counted
 * as "not rated" — a false statement about a skill the server holds a rating for.
 *
 * A refused value is dropped, never clamped: clamping would put a number on the screen that nobody
 * recorded.
 * // ponytail: dropped silently, with no per-skill explanation on screen. Through the shipped
 * // client this state is unreachable, so that copy would be dead the day it was written.
 */
function acceptedScores(source: Readonly<Record<string, number>>): Ratings {
  const accepted: Ratings = {};
  for (const [skillKey, score] of Object.entries(source)) {
    if (isScore(score)) accepted[skillKey] = score;
  }
  return accepted;
}

export function SkillsAssessment({
  studentId,
  definitionKey,
  definitionName,
  skills,
  hasTarget,
  minimums,
  initialScores,
  onDirtyChange,
  onSaved,
}: Readonly<{
  studentId: string;
  definitionKey: string;
  definitionName: string | null;
  /** The whole catalogue; only the skills the TARGET level requires are rated (DECISION 9). */
  skills: readonly SkillDefinition[];
  /** Whether a next level is recorded at all, which is why an empty `minimums` map is empty. */
  hasTarget: boolean;
  minimums: Readonly<Record<string, number>>;
  initialScores: Readonly<Record<string, number>>;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (saved: readonly SkillRating[]) => void;
}>) {
  /**
   * Two maps, not one: `baseline` is what the store holds, `scores` is what the operator sees.
   * A single map compared against the `initialScores` PROP could never stop being dirty after a
   * save — the prop does not move — and the panel only appeared to settle because the parent
   * remounts it on reload. The baseline is the one that moves, and only by what was really sent.
   */
  const [baseline, setBaseline] = useState<Ratings>(() => acceptedScores(initialScores));
  const [scores, setScores] = useState<Ratings>(() => baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  /**
   * OPERATOR DECISION 9 (2026-09-18): the operator rates the requirement set of the level being
   * moved INTO, never the whole catalogue. A skill the target does not require counts towards
   * nothing the promotion decision reads, and listing it made the per-category counters disagree
   * with that decision. The minimums map IS the target's requirement set, so it is the filter.
   * // ponytail: no `useMemo` around this or `groups` - eleven skills, and `minimums` is a fresh
   * // object on every parent render, so a memo keyed on it would recompute anyway.
   */
  const required = skills.filter((skill) => minimums[skill.key] !== undefined);

  const changed = required.flatMap((skill) => {
    const score = scores[skill.key];
    return score === undefined || score === baseline[skill.key]
      ? []
      : [{ skillKey: skill.key, score }];
  });
  const dirty = changed.length > 0;

  /**
   * The dirty report is fired on the VALUE changing, never on the callback's identity. Keyed on
   * the callback as well, a parent passing an inline arrow would be re-rendered by its own
   * handler, hand down a new arrow, and the effect would run again — an update loop that only a
   * memoised parent callback would hide.
   */
  const report = useRef(onDirtyChange);
  useEffect(() => {
    report.current = onDirtyChange;
  });
  useEffect(() => {
    report.current(dirty);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const byCategory = new Map<string, SkillDefinition[]>();
  for (const skill of [...required].sort((left, right) => left.sequence - right.sequence)) {
    const category = skillCategory(skill.displayLabel);
    byCategory.set(category, [...(byCategory.get(category) ?? []), skill]);
  }
  const groups = [...byCategory.entries()];

  /**
   * A rating on record for a skill the target does not require is neither sent (`changed` is built
   * from `required`) nor overwritten by this panel - but it is no longer on screen, and "not
   * shown" must never read as "lost". Counted from the BASELINE, which is what the store holds.
   */
  const listed = new Set(required.map((skill) => skill.key));
  const otherRated = Object.keys(baseline).filter((key) => !listed.has(key)).length;
  const otherRatings =
    otherRated === 0 ? null : (
      <p className="ibjjf-muted">
        {otherRated === 1
          ? "A rating for 1 other skill is on record. Nothing here changes it."
          : `Ratings for ${otherRated} other skills are on record. Nothing here changes them.`}
      </p>
    );

  async function save(): Promise<void> {
    // One request in flight, held in a ref like the other three writes in this view: `disabled`
    // and `busy` are both a render behind a second click in the same batch, and a second batch is
    // a second audited evaluation per skill.
    if (inFlight.current || changed.length === 0) return;
    inFlight.current = true;
    const sent = changed;
    setBusy(true);
    setError(null);
    try {
      await recordSkillRatings({ studentId, definitionKey, ratings: sent });
      // Only what was SENT joins the baseline. A rating the operator changed while the write was
      // in flight was not saved by it and must stay unsaved.
      setBaseline((current) => ({
        ...current,
        ...Object.fromEntries(sent.map((rating) => [rating.skillKey, rating.score])),
      }));
      // What was SENT, not what is on screen: the parent moves its own copy of the ratings by
      // exactly this, and a rating made while the write was in flight stays unsaved in both.
      onSaved(sent);
    } catch (failure) {
      setError(safeMessage(failure, levelsSafeErrors.ratings));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /**
   * Nothing to rate. The two causes are different and the panel says which: a next level that
   * carries no requirement at all (156 of the 171 levels on record today), or no next level, which
   * is the top of what BPT tracks — DECISION 7's vocabulary, and what the card on the same screen
   * already says about this member. A plain sentence, not DESIGN.md's empty-state block: that
   * block ends in a primary button and there is no action to offer here.
   */
  if (groups.length === 0) {
    return (
      <section aria-labelledby="ibjjf-skills-title" className="ibjjf-skills">
        <h3 id="ibjjf-skills-title">Skills assessment</h3>
        <p className="ibjjf-muted">
          {hasTarget
            ? "This level requires no rated skills."
            : "This is the highest level BPT tracks, so there are no skills to rate."}
        </p>
        {otherRatings}
      </section>
    );
  }

  return (
    <section aria-labelledby="ibjjf-skills-title" className="ibjjf-skills">
      <h3 id="ibjjf-skills-title">Skills assessment</h3>
      <p className="ibjjf-muted">Rate each skill from 1 to 5. Minimums apply to the next level.</p>
      {/*
       * Minimum-1 of the Task 17 review: every "Minimum n" above comes from the TARGET level while
       * the rating itself is filed against the level HELD (plan decision 5). Only one of those two
       * was named on screen, so the screen never said what was being recorded.
       */}
      {definitionName === null ? null : (
        <p className="ibjjf-muted">{`Ratings are recorded against ${definitionName}, the level currently held.`}</p>
      )}
      {otherRatings}
      {groups.map(([category, groupSkills]) => {
        const rated = groupSkills.filter((skill) => scores[skill.key] !== undefined).length;
        /*
         * Counted from the BASELINE, never from `scores`. The promotion dialog's
         * "Skills n/m at minimum" is computed from what the store holds, so a counter here that
         * moved on an unsaved click made two numbers about the same member disagree on the same
         * screen. Both now count the saved ratings, and the label says so.
         */
        const met = groupSkills.filter(
          (skill) => (baseline[skill.key] ?? 0) >= minimums[skill.key]!,
        ).length;
        return (
          <details className="ibjjf-skill-group" key={category}>
            <summary>
              <span>{category}</span>
              <span className="ibjjf-number">
                {`${rated}/${groupSkills.length} rated · ${met}/${groupSkills.length} saved at minimum`}
              </span>
            </summary>
            {groupSkills.map((skill) => {
              // Every listed skill is one the target requires, so it has a minimum by construction.
              const minimum = minimums[skill.key]!;
              return (
                <fieldset className="ibjjf-skill" key={skill.key}>
                  <legend>
                    {skill.displayLabel}
                    <span className="ibjjf-minimum-text">{` Minimum ${minimum}`}</span>
                  </legend>
                  <div className="ibjjf-scores">
                    {scoreValues.map((score) => (
                      <label
                        className={
                          score === minimum ? "ibjjf-score ibjjf-score-minimum" : "ibjjf-score"
                        }
                        key={score}
                      >
                        <input
                          checked={scores[skill.key] === score}
                          name={`skill-${skill.key}`}
                          onChange={() =>
                            setScores((current) => ({ ...current, [skill.key]: score }))
                          }
                          type="radio"
                          value={score}
                        />
                        <span>{score}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </details>
        );
      })}
      {dirty ? (
        <p className="ibjjf-notice ibjjf-unmet" role="status">
          You have unsaved ratings.
        </p>
      ) : null}
      {error === null ? null : (
        <p className="ibjjf-error" role="alert">
          {error}
        </p>
      )}
      <button
        aria-busy={busy}
        className="admin-auth-button"
        disabled={!dirty || busy}
        onClick={() => void save()}
        type="button"
      >
        {busy ? "Saving ratings" : "Save ratings"}
      </button>
    </section>
  );
}
