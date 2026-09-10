"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type {
  LevelCatalogProjection,
  LevelDefinitionRecord,
  SkillDefinition,
} from "@bpt-jersey/domain/levels";

import { getLevelCatalog } from "../../lib/levels-client";
import "./levels.css";

export type LevelsBrowserProps = Readonly<{
  roleContext?: "admin" | "coach" | "client";
}>;

function formatAgeRange(minAge: number | null, maxAge: number | null): string {
  if (minAge !== null && maxAge !== null) return `${minAge} - ${maxAge} yrs`;
  if (minAge !== null) return `${minAge}+ yrs`;
  if (maxAge !== null) return `Up to ${maxAge} yrs`;
  return "All ages";
}

function formatMinimumTime(time: { years: number; months: number; days: number } | null): string {
  if (!time) return "None";
  const parts: string[] = [];
  if (time.years > 0) parts.push(`${time.years} ${time.years === 1 ? "yr" : "yrs"}`);
  if (time.months > 0) parts.push(`${time.months} ${time.months === 1 ? "mo" : "mos"}`);
  if (time.days > 0) parts.push(`${time.days} ${time.days === 1 ? "day" : "days"}`);
  return parts.length > 0 ? parts.join(" ") : "None";
}

function renderVisualBar(visual: LevelDefinitionRecord["visual"]) {
  const { colors, stripeColor, stripePosition } = visual;

  let background = colors[0] ?? "#ffffff";
  if (colors.length === 2) {
    background = `linear-gradient(to right, ${colors[0]} 50%, ${colors[1]} 50%)`;
  } else if (colors.length === 3) {
    background = `linear-gradient(to right, ${colors[0]} 33%, ${colors[1]} 33% 66%, ${colors[2]} 66%)`;
  }

  return (
    <div
      className="belt-visual-bar"
      style={{ background }}
      aria-label={`Belt visual representation in ${colors.join(", ")}`}
      role="img"
    >
      {stripeColor && stripePosition !== null && (
        <div
          style={{
            position: "absolute",
            left: `${Math.round(stripePosition * 100)}%`,
            top: 0,
            bottom: 0,
            width: "8px",
            backgroundColor: stripeColor,
            borderLeft: "1px solid rgba(0,0,0,0.3)",
            borderRight: "1px solid rgba(0,0,0,0.3)",
          }}
        />
      )}
    </div>
  );
}

export function LevelsBrowser({ roleContext = "admin" }: LevelsBrowserProps) {
  const searchInputId = useId();
  const [catalog, setCatalog] = useState<LevelCatalogProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "belt" | "stripe">("all");

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
  }, []);

  const skillsMap = useMemo(() => {
    if (!catalog) return new Map<string, SkillDefinition>();
    return new Map(catalog.skills.map((s) => [s.key, s]));
  }, [catalog]);

  const requirementsByDefKey = useMemo(() => {
    if (!catalog) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    for (const req of catalog.requirements) {
      const skill = skillsMap.get(req.skillKey);
      const label = skill ? `${skill.displayLabel} (Min ${req.minimumRating}★)` : req.skillKey;
      const existing = map.get(req.definitionKey) ?? [];
      existing.push(label);
      map.set(req.definitionKey, existing);
    }
    return map;
  }, [catalog, skillsMap]);

  const filteredDefinitions = useMemo(() => {
    if (!catalog) return [];
    const query = searchQuery.trim().toLowerCase();

    return catalog.definitions.filter((def) => {
      if (kindFilter !== "all" && def.kind !== kindFilter) return false;
      if (!query) return true;
      return (
        def.name.toLowerCase().includes(query) || def.definitionKey.toLowerCase().includes(query)
      );
    });
  }, [catalog, searchQuery, kindFilter]);

  if (loading) {
    return (
      <div className="levels-container" role="status" aria-live="polite">
        <div className="levels-loading">
          <p>Loading IBJJF Level Catalog...</p>
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
      className="levels-container"
      data-role-context={roleContext}
      aria-labelledby="levels-heading"
    >
      <header className="levels-header">
        <h1 id="levels-heading" className="levels-title">
          {catalog.system.displayName}
        </h1>
        <p className="levels-subtitle">
          Official progression criteria, belt specifications, and skill requirement sets.
        </p>
        <div className="levels-metrics" aria-label="Catalog metrics summary">
          <span className="metric-badge">
            <strong>{catalog.system.counts.definitions}</strong> Total Levels
          </span>
          <span className="metric-badge">
            <strong>{catalog.system.counts.belts}</strong> Belts
          </span>
          <span className="metric-badge">
            <strong>{catalog.system.counts.stripes}</strong> Stripes
          </span>
          <span className="metric-badge">
            <strong>{catalog.skills.length}</strong> Evaluated Skills
          </span>
        </div>
      </header>

      <div className="levels-controls" role="search" aria-label="Search and filter levels">
        <div className="levels-search-box">
          <label htmlFor={searchInputId} className="sr-only">
            Search levels by name or key
          </label>
          <input
            id={searchInputId}
            type="search"
            className="levels-search-input"
            placeholder="Search levels (e.g. White Belt, 1st Stripe)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="levels-filter-group" role="group" aria-label="Filter by level kind">
          <button
            type="button"
            className={`filter-btn ${kindFilter === "all" ? "active" : ""}`}
            aria-pressed={kindFilter === "all"}
            onClick={() => setKindFilter("all")}
          >
            All ({catalog.definitions.length})
          </button>
          <button
            type="button"
            className={`filter-btn ${kindFilter === "belt" ? "active" : ""}`}
            aria-pressed={kindFilter === "belt"}
            onClick={() => setKindFilter("belt")}
          >
            Belts ({catalog.system.counts.belts})
          </button>
          <button
            type="button"
            className={`filter-btn ${kindFilter === "stripe" ? "active" : ""}`}
            aria-pressed={kindFilter === "stripe"}
            onClick={() => setKindFilter("stripe")}
          >
            Stripes ({catalog.system.counts.stripes})
          </button>
        </div>
      </div>

      {filteredDefinitions.length === 0 ? (
        <div className="levels-empty" role="status">
          <p>No levels found matching your criteria.</p>
        </div>
      ) : (
        <div className="levels-grid" role="region" aria-label="Levels list">
          {filteredDefinitions.map((def) => {
            const reqs = requirementsByDefKey.get(def.definitionKey) ?? [];
            return (
              <article
                key={def.definitionKey}
                className="level-card"
                aria-labelledby={`def-${def.definitionKey}`}
              >
                <div className="level-card-header">
                  <span className={`level-kind-tag ${def.kind}`}>{def.kind}</span>
                  <span className="text-xs text-gray-500 font-mono">#{def.sequence}</span>
                </div>

                {renderVisualBar(def.visual)}

                <h2 id={`def-${def.definitionKey}`} className="level-name">
                  {def.name}
                </h2>

                <dl className="level-criteria-list">
                  <div>
                    <dt>Age Range</dt>
                    <dd>{formatAgeRange(def.criteria.minAge, def.criteria.maxAge)}</dd>
                  </div>
                  <div>
                    <dt>Min Classes</dt>
                    <dd>
                      {def.criteria.minClasses ? `${def.criteria.minClasses} classes` : "None"}
                    </dd>
                  </div>
                  <div>
                    <dt>Min Time</dt>
                    <dd>{formatMinimumTime(def.criteria.minimumTime)}</dd>
                  </div>
                  <div>
                    <dt>Stripe #</dt>
                    <dd>{def.stripeNumber !== null ? `${def.stripeNumber}` : "None"}</dd>
                  </div>
                </dl>

                {reqs.length > 0 && (
                  <div className="level-skills-section">
                    <h3 className="level-skills-title">Required Techniques ({reqs.length})</h3>
                    <div className="skills-tags">
                      {reqs.map((skillText, idx) => (
                        <span key={idx} className="skill-pill">
                          {skillText}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
