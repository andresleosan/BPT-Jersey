"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  LevelCatalogProjection,
  LevelDefinitionRecord,
  StudentProgressSummary,
} from "@bpt-jersey/domain/levels";

import { loadAccountPeople } from "../../../lib/account-people";
import { getLevelCatalog, getStudentProgressSummary } from "../../../lib/levels-client";
import { BeltBar } from "../../levels/levels-browser";
import { beltPosition, groupBelts } from "../../levels/levels-grouping";
import "../../levels/levels.css";
import "./progress.css";

type Person = Readonly<{ studentId: string | undefined; firstName: string }>;

type Loaded =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{
      status: "ready";
      progress: StudentProgressSummary;
      catalog: LevelCatalogProjection;
    }>;

/** One bar towards a rank: classes counted at the current level against what the catalogue asks. */
export type RankStep = Readonly<{
  name: string;
  done: number;
  required: number;
  toGo: number;
}>;

/**
 * The next stripe (the rank straight after the current one) and the next belt. Classes count from
 * the current level, like the summary does, so every step after the first still needs its own full
 * count: the belt bar adds them up. `null` means the catalogue asks for no classes or has no rank.
 */
export function rankSteps(
  summary: Extract<StudentProgressSummary, { state: "initialized" }>,
  catalog: LevelCatalogProjection,
): Readonly<{ stripe: RankStep | null; belt: RankStep | null }> {
  const current = summary.currentDefinition;
  const target = summary.targetDefinition;
  if (!target || summary.criteria.classes.required === null) return { stripe: null, belt: null };
  const completed = summary.criteria.classes.completed;
  const firstRequired = summary.criteria.classes.required;
  const ahead = catalog.definitions
    .filter((d) => d.systemId === current.systemId && d.sequence > current.sequence)
    .sort((a, b) => a.sequence - b.sequence);
  const beltIndex = ahead.findIndex((d) => d.kind === "belt");
  const firstStep: RankStep = {
    name: target.name,
    done: Math.min(completed, firstRequired),
    required: firstRequired,
    toGo: Math.max(0, firstRequired - completed),
  };
  if (beltIndex < 0) return { stripe: target.kind === "stripe" ? firstStep : null, belt: null };
  const nextBelt = ahead[beltIndex]!;
  const later = ahead
    .slice(1, beltIndex + 1)
    .reduce((sum, d) => sum + (d.criteria.minClasses ?? 0), 0);
  const belt: RankStep = {
    name: nextBelt.name,
    done: firstStep.done,
    required: firstRequired + later,
    toGo: firstStep.toGo + later,
  };
  return { stripe: target.kind === "stripe" ? firstStep : null, belt };
}

function Bar({ label, step }: Readonly<{ label: string; step: RankStep }>) {
  const lastOne = step.toGo === 1;
  return (
    <div className={`rank-bar${lastOne ? " is-almost" : ""}`}>
      <div className="rank-bar-head">
        <span>
          {label}: <strong>{step.name}</strong>
        </span>
        <span className="rank-bar-count">
          {step.done}/{step.required}
        </span>
      </div>
      <progress
        max={Math.max(step.required, 1)}
        value={step.done}
        aria-label={`${label} ${step.name}: ${step.done} of ${step.required} classes`}
      />
      <p className="rank-bar-hint">
        {step.toGo === 0
          ? "Classes complete."
          : step.toGo === 1
            ? "1 class to go."
            : `${step.toGo} classes to go.`}
      </p>
    </div>
  );
}

/** The last class before a rank: a stripe being tied onto the belt, and who decides. */
function GraduationNotice({
  step,
  visual,
  stripeCount,
}: Readonly<{ step: RankStep; visual: LevelDefinitionRecord["visual"]; stripeCount: number }>) {
  const [first = "#ffffff"] = visual.colors;
  return (
    <section className="graduation" aria-labelledby="graduation-title">
      <div className="graduation-belt" aria-hidden="true" style={{ background: first }}>
        <span className="graduation-tip">
          {Array.from({ length: Math.min(stripeCount, 3) }, (_, i) => (
            <i className="graduation-held" key={i} />
          ))}
          <i className="graduation-new" />
        </span>
      </div>
      <div className="graduation-copy">
        <p className="graduation-eyebrow">Graduation</p>
        <h2 id="graduation-title">{step.toGo === 1 ? "One class to go" : "Classes complete"}</h2>
        <p>
          {step.toGo === 1
            ? `Finish your next session. After it, your coach decides whether you are ready for ${step.name}.`
            : `Your coach decides after your next session whether you are ready for ${step.name}.`}
        </p>
      </div>
    </section>
  );
}

function PersonProgress({ person }: Readonly<{ person: Person }>) {
  const [state, setState] = useState<Loaded>({ status: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    Promise.all([getStudentProgressSummary(person.studentId), getLevelCatalog()]).then(
      ([progress, catalog]) => active && setState({ status: "ready", progress, catalog }),
      () => active && setState({ status: "error" }),
    );
    return () => {
      active = false;
    };
  }, [person.studentId, reload]);

  if (state.status === "loading") {
    return (
      <div className="rank-page" aria-busy="true">
        <div className="rank-skeleton rank-skeleton--hero" />
        <div className="rank-skeleton" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="rank-card rank-card--error" role="alert">
        <p>We couldn&apos;t load this progress. Please try again.</p>
        <button className="rank-button" onClick={() => setReload((n) => n + 1)} type="button">
          Try again
        </button>
      </div>
    );
  }
  return (
    <RankView catalog={state.catalog} firstName={person.firstName} progress={state.progress} />
  );
}

/** Everything the page shows for one person, from their summary and the level catalogue. */
export function RankView({
  progress: summary,
  catalog,
  firstName,
}: Readonly<{
  progress: StudentProgressSummary;
  catalog: LevelCatalogProjection;
  firstName: string;
}>) {
  const view = useMemo(() => {
    if (summary.state !== "initialized") return null;
    const progress = summary;
    const position = beltPosition(groupBelts(catalog), progress.currentDefinition.definitionKey);
    const belt = position?.belt ?? progress.currentDefinition;
    return {
      progress,
      belt,
      stripeCount: position?.stripeCount ?? 0,
      steps: rankSteps(progress, catalog),
    };
  }, [summary, catalog]);

  if (!view) {
    return (
      <div className="rank-card" role="status">
        <h2>No belt recorded yet</h2>
        <p className="rank-muted">
          Your coach sets the starting belt after the first classes. Attendance is already being
          recorded.
        </p>
      </div>
    );
  }

  const { progress, belt, stripeCount, steps } = view;
  const nearest = steps.stripe ?? steps.belt;
  return (
    <div className="rank-page">
      <section className="rank-hero" aria-labelledby="rank-title">
        <p className="rank-eyebrow">{firstName === "You" ? "Your belt" : `${firstName}'s belt`}</p>
        <h2 id="rank-title" className="rank-title">
          {belt.name}
          <span>
            {stripeCount === 0
              ? "No stripes yet"
              : `${stripeCount} ${stripeCount === 1 ? "stripe" : "stripes"}`}
          </span>
        </h2>
        <div className="rank-belt">
          <BeltBar name={belt.name} stripeCount={stripeCount} visual={belt.visual} />
        </div>
      </section>

      {nearest && nearest.toGo <= 1 ? (
        <GraduationNotice
          step={nearest}
          stripeCount={steps.stripe ? stripeCount : 0}
          visual={belt.visual}
        />
      ) : null}

      <section className="rank-card" aria-labelledby="rank-next-title">
        <h2 id="rank-next-title">Classes to your next rank</h2>
        {steps.stripe || steps.belt ? (
          <div className="rank-bars">
            {steps.stripe ? <Bar label="Next stripe" step={steps.stripe} /> : null}
            {steps.belt ? <Bar label="Next belt" step={steps.belt} /> : null}
          </div>
        ) : (
          <p className="rank-muted">
            {progress.targetDefinition
              ? "Your next rank has no class count. Your coach decides when you are ready."
              : "You hold the top rank of this ladder."}
          </p>
        )}
        <p className="rank-muted">
          Classes count from your last promotion. Time at the level also matters: the owner makes
          every graduation decision.
        </p>
      </section>
    </div>
  );
}

/**
 * /account/progress: only the people who train on this account — "You" when the holder trains, then
 * each child — each read through the same authorised summary.
 */
export function MemberProgress({ children }: Readonly<{ children?: React.ReactNode }>) {
  const [people, setPeople] = useState<readonly Person[] | null>(null);
  const [selected, setSelected] = useState(0);

  // Everyone who trains on the account, whatever the role says (spec 2026-09-30 D14).
  useEffect(() => {
    let active = true;
    loadAccountPeople().then(
      (list) =>
        active &&
        setPeople(
          list.map((person) => ({
            studentId: person.studentId,
            firstName:
              person.via === "self" ? "You" : (person.fullName.split(/\s+/u)[0] ?? person.fullName),
          })),
        ),
      () => active && setPeople([]),
    );
    return () => {
      active = false;
    };
  }, []);

  const person = people?.[selected];
  return (
    <main className="rank-shell" aria-labelledby="progress-title">
      <header className="rank-header">
        <Link className="rank-back" href="/account">
          ← Back to account
        </Link>
        <h1 id="progress-title">Progress</h1>
        {people && people.length > 1 ? (
          <ul aria-label="Choose member" className="rank-chips" role="group">
            {people.map((p, index) => (
              <li key={p.studentId}>
                <button
                  aria-pressed={index === selected}
                  className="rank-chip"
                  onClick={() => setSelected(index)}
                  type="button"
                >
                  {p.firstName}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      <div className="rank-body">
        {people === null ? (
          <div className="rank-page" aria-busy="true">
            <div className="rank-skeleton rank-skeleton--hero" />
          </div>
        ) : person ? (
          <PersonProgress key={person.studentId ?? "self"} person={person} />
        ) : (
          <div className="rank-card" role="status">
            <h2>No children linked yet</h2>
            <p className="rank-muted">
              The academy links each child to your account when they enrol.
            </p>
          </div>
        )}
        {children}
      </div>
    </main>
  );
}
