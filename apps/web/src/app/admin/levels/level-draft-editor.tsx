"use client";

import { useMemo, useState } from "react";
import type {
  LevelCatalogVersionContent,
  LevelDraftLevel,
  LevelDraftRequirement,
  LevelDraftSkill,
} from "@bpt-jersey/domain/levels/editor";

import { saveLevelCatalogDraft } from "../../../lib/level-editor-client";
import { BeltBar } from "../../levels/levels-browser";
import "./levels-editor.css";

const hexPattern = /^#[0-9a-fA-F]{6}$/u;
const hexHint = "Enter a colour like #1A2B3C";
const maxColours = 3;
const maxStripes = 11;

export type LevelDraftEditorProps = Readonly<{
  draft: LevelCatalogVersionContent;
  onSaved: (content: LevelCatalogVersionContent) => void;
  onClose: () => void;
}>;

type Notice = Readonly<{ kind: "success" | "error"; message: string }>;

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minimumDays(level: LevelDraftLevel): number | null {
  const time = level.criteria.minimumTime;
  return time === null ? null : time.years * 365 + time.months * 30 + time.days;
}

function slug(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 100) || "technique";
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`;
  return key;
}

/**
 * One colour of a belt: a native colour picker and the hex field it mirrors. The hex is only
 * applied once it is a full `#RRGGBB`; until then the field says so and the preview keeps the last
 * valid colour, because a partial value must never reach CSS.
 */
function ColourField({
  id,
  label,
  value,
  raw,
  onRaw,
  onColour,
}: {
  id: string;
  label: string;
  value: string;
  raw: string | undefined;
  onRaw: (id: string, raw: string | undefined) => void;
  onColour: (colour: string) => void;
}) {
  const text = raw ?? value;
  const invalid = raw !== undefined;
  return (
    <div className="levels-editor-colour">
      <input
        aria-label={`${label} picker`}
        className="levels-editor-picker"
        onChange={(event) => {
          onRaw(id, undefined);
          onColour(event.target.value.toUpperCase());
        }}
        type="color"
        value={value.toLowerCase()}
      />
      <label className="levels-editor-field">
        <span>{label} hex</span>
        <input
          aria-describedby={invalid ? `${id}-hint` : undefined}
          aria-invalid={invalid}
          maxLength={7}
          onChange={(event) => {
            const next = event.target.value.trim();
            if (hexPattern.test(next)) {
              onRaw(id, undefined);
              onColour(next.toUpperCase());
            } else {
              onRaw(id, next);
            }
          }}
          spellCheck={false}
          value={text}
        />
      </label>
      {invalid ? (
        <p className="levels-editor-hint" id={`${id}-hint`} role="alert">
          {hexHint}
        </p>
      ) : null}
    </div>
  );
}

export function LevelDraftEditor({ draft, onSaved, onClose }: LevelDraftEditorProps) {
  const [displayName, setDisplayName] = useState(draft.displayName);
  const [levels, setLevels] = useState<LevelDraftLevel[]>(() => [...draft.levels]);
  const [skills, setSkills] = useState<LevelDraftSkill[]>(() => [...draft.skills]);
  const [requirements, setRequirements] = useState<LevelDraftRequirement[]>(() => [
    ...draft.requirements,
  ]);
  const [rawHex, setRawHex] = useState<Record<string, string>>({});
  const [newTechnique, setNewTechnique] = useState("");
  const [pendingSkill, setPendingSkill] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const belts = useMemo(
    () => levels.filter((level) => level.kind === "belt").sort((a, b) => a.sequence - b.sequence),
    [levels],
  );
  const skillLabels = useMemo(
    () => new Map(skills.map((skill) => [skill.key, skill.displayLabel])),
    [skills],
  );
  const hasInvalidHex = Object.keys(rawHex).length > 0;

  function setRaw(id: string, raw: string | undefined): void {
    setRawHex((current) => {
      const next = { ...current };
      if (raw === undefined) delete next[id];
      else next[id] = raw;
      return next;
    });
  }

  function updateBelt(key: string, change: (level: LevelDraftLevel) => LevelDraftLevel): void {
    setNotice(null);
    setLevels((current) =>
      current.map((level) => (level.definitionKey === key ? change(level) : level)),
    );
  }

  function updateCriteria(key: string, patch: Partial<LevelDraftLevel["criteria"]>): void {
    updateBelt(key, (level) => ({ ...level, criteria: { ...level.criteria, ...patch } }));
  }

  function addTechnique(): void {
    const label = newTechnique.trim();
    if (label.length === 0) return;
    const key = slug(label, new Set(skills.map((skill) => skill.key)));
    setSkills((current) => [
      ...current,
      { key, displayLabel: label.slice(0, 80), minimumRating: 3, sequence: current.length + 1 },
    ]);
    setNewTechnique("");
  }

  async function save(): Promise<void> {
    setSaving(true);
    setNotice(null);
    try {
      const saved = await saveLevelCatalogDraft({
        systemId: draft.systemId,
        displayName,
        levels,
        skills,
        requirements,
      });
      setLevels([...saved.levels]);
      setSkills([...saved.skills]);
      setRequirements([...saved.requirements]);
      setNotice({ kind: "success", message: "Draft saved." });
      onSaved(saved);
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save the draft.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="levels-draft-title" className="levels-editor">
      <header className="levels-editor-header">
        <p className="levels-editor-eyebrow">Draft</p>
        <h2 id="levels-draft-title">Draft {draft.systemId}</h2>
        <label className="levels-editor-field levels-editor-name">
          <span>Catalogue name</span>
          <input
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
            value={displayName}
          />
        </label>
      </header>

      <section aria-label="Techniques" className="levels-editor-techniques">
        <h3>Techniques</h3>
        <p className="levels-editor-muted">
          {skills.length} techniques in this catalogue. Add one here, then require it on a belt.
        </p>
        <div className="levels-editor-row">
          <label className="levels-editor-field">
            <span>New technique</span>
            <input
              maxLength={80}
              onChange={(event) => setNewTechnique(event.target.value)}
              value={newTechnique}
            />
          </label>
          <button className="levels-editor-button" onClick={addTechnique} type="button">
            Add technique
          </button>
        </div>
      </section>

      <div className="levels-editor-belts">
        {belts.map((belt) => {
          const key = belt.definitionKey;
          const beltRequirements = requirements.filter(
            (requirement) => requirement.definitionKey === key,
          );
          const available = skills.filter(
            (skill) => !beltRequirements.some((requirement) => requirement.skillKey === skill.key),
          );
          return (
            <article aria-labelledby={`belt-${key}`} className="levels-editor-belt" key={key}>
              <h3 id={`belt-${key}`}>{belt.name}</h3>
              <BeltBar
                name={belt.name}
                stripeCount={belt.visual.stripeCount}
                visual={{
                  colorMode: 1,
                  colors: belt.visual.colors,
                  stripeColor: belt.visual.stripeColor,
                  stripeCenter: null,
                  stripeWidth: null,
                  stripePosition: null,
                }}
              />
              <label className="levels-editor-field">
                <span>Name</span>
                <input
                  maxLength={80}
                  onChange={(event) =>
                    updateBelt(key, (level) => ({ ...level, name: event.target.value }))
                  }
                  value={belt.name}
                />
              </label>

              <fieldset className="levels-editor-group">
                <legend>Colours</legend>
                {belt.visual.colors.map((colour, index) => (
                  <ColourField
                    id={`${key}-colour-${index}`}
                    key={index}
                    label={`Belt colour ${index + 1}`}
                    onColour={(next) =>
                      updateBelt(key, (level) => ({
                        ...level,
                        visual: {
                          ...level.visual,
                          colors: level.visual.colors.map((value, at) =>
                            at === index ? next : value,
                          ),
                        },
                      }))
                    }
                    onRaw={setRaw}
                    raw={rawHex[`${key}-colour-${index}`]}
                    value={colour}
                  />
                ))}
                <div className="levels-editor-row">
                  {belt.visual.colors.length < maxColours ? (
                    <button
                      className="levels-editor-button"
                      onClick={() =>
                        updateBelt(key, (level) => ({
                          ...level,
                          visual: {
                            ...level.visual,
                            colors: [...level.visual.colors, level.visual.colors.at(-1)!],
                          },
                        }))
                      }
                      type="button"
                    >
                      Add colour
                    </button>
                  ) : null}
                  {belt.visual.colors.length > 1 ? (
                    <button
                      className="levels-editor-button"
                      onClick={() => {
                        setRaw(`${key}-colour-${belt.visual.colors.length - 1}`, undefined);
                        updateBelt(key, (level) => ({
                          ...level,
                          visual: { ...level.visual, colors: level.visual.colors.slice(0, -1) },
                        }));
                      }}
                      type="button"
                    >
                      Remove last colour
                    </button>
                  ) : null}
                </div>
                <ColourField
                  id={`${key}-stripe`}
                  label="Stripe colour"
                  onColour={(next) =>
                    updateBelt(key, (level) => ({
                      ...level,
                      visual: { ...level.visual, stripeColor: next },
                    }))
                  }
                  onRaw={setRaw}
                  raw={rawHex[`${key}-stripe`]}
                  value={belt.visual.stripeColor ?? "#FFFFFF"}
                />
              </fieldset>

              <fieldset className="levels-editor-group levels-editor-grid">
                <legend>Requirements</legend>
                <label className="levels-editor-field">
                  <span>Stripes</span>
                  <input
                    max={maxStripes}
                    min={0}
                    onChange={(event) =>
                      updateBelt(key, (level) => ({
                        ...level,
                        visual: {
                          ...level.visual,
                          stripeCount: Math.min(
                            maxStripes,
                            Math.max(0, Math.trunc(numberOrNull(event.target.value) ?? 0)),
                          ),
                        },
                      }))
                    }
                    type="number"
                    value={belt.visual.stripeCount}
                  />
                </label>
                <label className="levels-editor-field">
                  <span>Minimum classes</span>
                  <input
                    min={0}
                    onChange={(event) =>
                      updateCriteria(key, { minClasses: numberOrNull(event.target.value) })
                    }
                    type="number"
                    value={belt.criteria.minClasses ?? ""}
                  />
                </label>
                <label className="levels-editor-field">
                  <span>Minimum days</span>
                  <input
                    min={0}
                    onChange={(event) => {
                      const days = numberOrNull(event.target.value);
                      updateCriteria(key, {
                        minimumTime: days === null ? null : { years: 0, months: 0, days },
                      });
                    }}
                    type="number"
                    value={minimumDays(belt) ?? ""}
                  />
                </label>
                <label className="levels-editor-field">
                  <span>Minimum age</span>
                  <input
                    max={99}
                    min={3}
                    onChange={(event) =>
                      updateCriteria(key, { minAge: numberOrNull(event.target.value) })
                    }
                    type="number"
                    value={belt.criteria.minAge ?? ""}
                  />
                </label>
                <label className="levels-editor-field">
                  <span>Maximum age</span>
                  <input
                    max={99}
                    min={3}
                    onChange={(event) =>
                      updateCriteria(key, { maxAge: numberOrNull(event.target.value) })
                    }
                    type="number"
                    value={belt.criteria.maxAge ?? ""}
                  />
                </label>
              </fieldset>

              <fieldset className="levels-editor-group">
                <legend>Techniques for this belt</legend>
                {beltRequirements.length === 0 ? (
                  <p className="levels-editor-muted">No techniques required.</p>
                ) : (
                  <ul className="levels-editor-list">
                    {beltRequirements.map((requirement) => (
                      <li key={requirement.skillKey}>
                        <span>{skillLabels.get(requirement.skillKey) ?? requirement.skillKey}</span>
                        <label className="levels-editor-field levels-editor-inline">
                          <span>Minimum rating</span>
                          <select
                            onChange={(event) =>
                              setRequirements((current) =>
                                current.map((item) =>
                                  item === requirement
                                    ? { ...item, minimumRating: Number(event.target.value) }
                                    : item,
                                ),
                              )
                            }
                            value={requirement.minimumRating}
                          >
                            {[1, 2, 3, 4, 5].map((rating) => (
                              <option key={rating} value={rating}>
                                {rating}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="levels-editor-button"
                          onClick={() =>
                            setRequirements((current) =>
                              current.filter((item) => item !== requirement),
                            )
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {available.length > 0 ? (
                  <div className="levels-editor-row">
                    <label className="levels-editor-field">
                      <span>Technique</span>
                      <select
                        onChange={(event) =>
                          setPendingSkill((current) => ({ ...current, [key]: event.target.value }))
                        }
                        value={pendingSkill[key] ?? available[0]!.key}
                      >
                        {available.map((skill) => (
                          <option key={skill.key} value={skill.key}>
                            {skill.displayLabel}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="levels-editor-button"
                      onClick={() => {
                        const skillKey = pendingSkill[key] ?? available[0]!.key;
                        const skill = skills.find((item) => item.key === skillKey);
                        if (skill === undefined) return;
                        setRequirements((current) => [
                          ...current,
                          { definitionKey: key, skillKey, minimumRating: skill.minimumRating },
                        ]);
                        setPendingSkill((current) => {
                          const next = { ...current };
                          delete next[key];
                          return next;
                        });
                      }}
                      type="button"
                    >
                      Require technique
                    </button>
                  </div>
                ) : null}
              </fieldset>
            </article>
          );
        })}
      </div>

      {notice ? (
        <p
          className="levels-editor-notice"
          data-kind={notice.kind}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}
      <div className="levels-editor-actions">
        <button
          className="levels-editor-button"
          data-variant="primary"
          disabled={saving || hasInvalidHex}
          onClick={() => void save()}
          type="button"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button className="levels-editor-button" onClick={onClose} type="button">
          Close
        </button>
      </div>
    </section>
  );
}
