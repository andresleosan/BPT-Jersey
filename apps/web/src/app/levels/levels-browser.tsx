"use client";

import { useEffect, useMemo, useState } from "react";
import type { LevelCatalogProjection, LevelDefinitionRecord } from "@bpt-jersey/domain/levels";

import { getLevelCatalog } from "../../lib/levels-client";
import {
  beltTipColors,
  distinctBeltColors,
  formatAgeRange,
  formatMinimumTime,
  groupBelts,
  ordinal,
  stripeOrdinal,
} from "./levels-grouping";
import "./levels.css";

export type LevelsBrowserProps = Readonly<{
  roleContext?: "admin" | "coach" | "client";
  /** Changing it reloads the catalogue (after an edit is saved). */
  version?: number;
  /** Editors only: rendered at the bottom of each belt card. */
  renderBeltEditor?: (beltKey: string) => React.ReactNode;
}>;

// A physical belt tip holds four stripes; kids' belts go up to eleven, so the rest is a count.
const tipMarks = 4;

export function BeltBar({
  name,
  stripeCount,
  visual,
}: {
  name: string;
  stripeCount: number;
  visual: LevelDefinitionRecord["visual"];
}) {
  const [first = "#ffffff", second, third] = visual.colors;
  const background = third
    ? `linear-gradient(to right, ${first} 33%, ${second} 33% 66%, ${third} 66%)`
    : second
      ? `linear-gradient(to right, ${first} 50%, ${second} 50%)`
      : first;
  const { tip, stripe } = beltTipColors(visual);
  return (
    <div
      aria-label={`${name} belt`}
      className="belt-bar"
      role="img"
      style={{ background, backgroundColor: first }}
    >
      <span
        className="belt-tip"
        style={{ "--tip": tip, "--stripe": stripe } as React.CSSProperties}
      >
        {Array.from({ length: Math.min(stripeCount, tipMarks) }, (_, i) => (
          <i key={i} />
        ))}
        {stripeCount > tipMarks ? <b>+{stripeCount - tipMarks}</b> : null}
      </span>
    </div>
  );
}

function BeltCardSkeleton() {
  return <div aria-busy="true" aria-hidden="true" className="belt-card belt-card-skeleton" />;
}

export function LevelsBrowser({
  roleContext = "admin",
  version = 0,
  renderBeltEditor,
}: LevelsBrowserProps) {
  const [catalog, setCatalog] = useState<LevelCatalogProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [ageFilter, setAgeFilter] = useState<"all" | "kids" | "adults">("all");
  const [colorFilter, setColorFilter] = useState<string | null>(null);

  function triggerLoad(): void {
    setLoading(true);
    setError(null);
    void getLevelCatalog()
      .then((data) => {
        setCatalog(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to load level catalog.");
        setLoading(false);
      });
  }

  useEffect(() => {
    let mounted = true;
    void getLevelCatalog()
      .then((data) => {
        if (!mounted) return;
        setCatalog(data);
        setLoading(false);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Unable to load level catalog.");
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [version]);

  // A belt's techniques are the requirements on the belt itself; its stripes carry the same list.
  const techniquesByBelt = useMemo(() => {
    const map = new Map<string, { key: string; label: string; rating: number }[]>();
    if (!catalog) return map;
    const labels = new Map(catalog.skills.map((skill) => [skill.key, skill.displayLabel]));
    for (const requirement of catalog.requirements) {
      const list = map.get(requirement.definitionKey) ?? [];
      list.push({
        key: requirement.skillKey,
        label: labels.get(requirement.skillKey) ?? requirement.skillKey,
        rating: requirement.minimumRating,
      });
      map.set(requirement.definitionKey, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.label.localeCompare(b.label));
    return map;
  }, [catalog]);

  const groups = useMemo(() => (catalog ? groupBelts(catalog) : []), [catalog]);
  const colours = useMemo(() => distinctBeltColors(groups), [groups]);
  const visible = useMemo(
    () =>
      groups.filter((g) => {
        if (ageFilter !== "all" && g.ageGroup !== ageFilter) return false;
        if (colorFilter && g.primaryColor !== colorFilter) return false;
        const q = searchQuery.trim().toLowerCase();
        return (
          !q ||
          g.belt.name.toLowerCase().includes(q) ||
          g.stripes.some((s) => s.name.toLowerCase().includes(q))
        );
      }),
    [groups, ageFilter, colorFilter, searchQuery],
  );

  if (loading) {
    return (
      <div aria-label="Loading belts" aria-live="polite" className="levels-container" role="status">
        <div className="levels-grid">
          <BeltCardSkeleton />
          <BeltCardSkeleton />
          <BeltCardSkeleton />
        </div>
      </div>
    );
  }

  if (error || !catalog) {
    return (
      <div className="levels-container" role="alert">
        <div className="levels-error">
          <p>{error ?? "Unable to load level catalog."}</p>
          <button className="button button-secondary" onClick={() => triggerLoad()} type="button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="levels-heading"
      className="levels-container"
      data-role-context={roleContext}
    >
      <header className="levels-header">
        <p className="admin-eyebrow">Mat / Levels</p>
        <h1 className="levels-title" id="levels-heading">
          {catalog.system.displayName}
        </h1>
        <p className="levels-subtitle">
          {catalog.system.counts.belts} belts · {catalog.system.counts.stripes} stripes ·{" "}
          {catalog.skills.length} evaluated techniques
        </p>
      </header>

      <div aria-label="Search and filter belts" className="levels-controls" role="search">
        <label className="levels-search">
          <span>Search belts</span>
          <input
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="White, Grey, Blue…"
            type="search"
            value={searchQuery}
          />
        </label>
        <div aria-label="Age group" className="levels-choice-row" role="radiogroup">
          {(["all", "kids", "adults"] as const).map((value) => (
            <button
              aria-checked={ageFilter === value}
              className="levels-choice"
              key={value}
              onClick={() => setAgeFilter(value)}
              role="radio"
              type="button"
            >
              {value === "all" ? "All" : value === "kids" ? "Kids" : "Adults"}
            </button>
          ))}
        </div>
        <div aria-label="Belt colour" className="levels-colours" role="group">
          {colours.map(({ color, name }) => (
            <button
              aria-label={`Filter by ${name} colour`}
              aria-pressed={colorFilter === color}
              className="levels-colour"
              key={color}
              onClick={() => setColorFilter(colorFilter === color ? null : color)}
              style={{ "--belt": color } as React.CSSProperties}
              type="button"
            />
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="levels-empty" role="status">
          No belts match this filter.
        </p>
      ) : (
        <div aria-label="Belts" className="levels-grid" role="region">
          {visible.map((group) => {
            const { belt, stripes, ageGroup } = group;
            return (
              <article
                aria-labelledby={`belt-${belt.definitionKey}`}
                className="belt-card"
                key={belt.definitionKey}
              >
                <BeltBar name={belt.name} stripeCount={stripes.length} visual={belt.visual} />
                <p className="belt-eyebrow">
                  {ageGroup === "kids" ? "Kids" : "Adults"} · #{belt.sequence}
                </p>
                <h2 className="belt-name" id={`belt-${belt.definitionKey}`}>
                  {belt.name}
                </h2>
                <dl className="belt-criteria">
                  <div>
                    <dt>Age</dt>
                    <dd>{formatAgeRange(belt.criteria.minAge, belt.criteria.maxAge)}</dd>
                  </div>
                  <div>
                    <dt>Min classes</dt>
                    <dd>{belt.criteria.minClasses ?? "None"}</dd>
                  </div>
                  <div>
                    <dt>Min time</dt>
                    <dd>{formatMinimumTime(belt.criteria.minimumTime)}</dd>
                  </div>
                </dl>
                {stripes.length > 0 ? (
                  <ol aria-label={`${belt.name} stripes`} className="belt-stripes">
                    {stripes.map((s, position) => (
                      <li key={s.definitionKey}>
                        <strong>{ordinal(stripeOrdinal(s, position))} stripe</strong>
                        <span>
                          {s.criteria.minClasses ? `${s.criteria.minClasses} classes` : "—"} ·{" "}
                          {formatMinimumTime(s.criteria.minimumTime)}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {(() => {
                  const techniques = techniquesByBelt.get(belt.definitionKey) ?? [];
                  return techniques.length > 0 ? (
                    <details className="belt-techniques">
                      <summary>
                        {techniques.length} {techniques.length === 1 ? "technique" : "techniques"}
                      </summary>
                      <ul>
                        {techniques.map((technique) => (
                          <li key={technique.key}>
                            <span>{technique.label}</span>
                            <span>Min {technique.rating}/5</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null;
                })()}
                {renderBeltEditor?.(belt.definitionKey)}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
