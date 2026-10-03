"use client";

import { useMemo, useRef, useState } from "react";
import type {
  BeltTechnique,
  CatalogLevel,
  EditableLevelCatalog,
} from "@bpt-jersey/domain/levels/editor";

import { BeltBar } from "../../levels/levels-browser";
import { ordinal } from "../../levels/levels-grouping";

export type CatalogContent = Omit<EditableLevelCatalog, "systemId" | "updatedAt">;

const hexPattern = /^#[0-9a-fA-F]{6}$/u;
const maxColours = 3;

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function minimumDays(level: CatalogLevel): number | null {
  const time = level.criteria.minimumTime;
  return time === null ? null : time.years * 365 + time.months * 30 + time.days;
}

function withDays(level: CatalogLevel, days: number | null): CatalogLevel {
  return {
    ...level,
    criteria: {
      ...level.criteria,
      minimumTime: days === null ? null : { years: 0, months: 0, days },
    },
  };
}

/**
 * One colour: native picker plus the hex it mirrors. A hex is applied only once it is a full
 * `#RRGGBB`; until then the field says so and the preview keeps the last valid colour.
 */
function ColourField({
  id,
  label,
  value,
  onColour,
  onInvalid,
}: {
  id: string;
  label: string;
  value: string;
  onColour: (colour: string) => void;
  onInvalid: (id: string, invalid: boolean) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <div className="levels-editor-colour">
      <input
        aria-label={`${label} picker`}
        className="levels-editor-picker"
        onChange={(event) => {
          setRaw(null);
          onInvalid(id, false);
          onColour(event.target.value.toUpperCase());
        }}
        type="color"
        value={value.toLowerCase()}
      />
      <label className="levels-editor-field">
        <span>{label} hex</span>
        <input
          aria-describedby={raw === null ? undefined : `${id}-hint`}
          aria-invalid={raw !== null}
          maxLength={7}
          onChange={(event) => {
            const next = event.target.value.trim();
            if (hexPattern.test(next)) {
              setRaw(null);
              onInvalid(id, false);
              onColour(next.toUpperCase());
            } else {
              setRaw(next);
              onInvalid(id, true);
            }
          }}
          spellCheck={false}
          value={raw ?? value}
        />
      </label>
      {raw === null ? null : (
        <p className="levels-editor-hint" id={`${id}-hint`} role="alert">
          Enter a colour like #1A2B3C
        </p>
      )}
    </div>
  );
}

export function BeltEditor({
  catalog,
  beltKey,
  editing,
  locked,
  busy,
  onEdit,
  onClose,
  onSave,
}: {
  catalog: EditableLevelCatalog;
  beltKey: string;
  editing: boolean;
  locked: boolean;
  busy: boolean;
  onEdit: () => void;
  onClose: () => void;
  onSave: (next: CatalogContent) => Promise<boolean>;
}) {
  const original = useMemo(() => {
    const belt = catalog.levels.find((level) => level.definitionKey === beltKey)!;
    const stripes = catalog.levels
      .filter((level) => level.parentDefinitionKey === beltKey)
      .sort((a, b) => a.sequence - b.sequence);
    const techniques = catalog.beltTechniques.filter((t) => t.beltKey === beltKey);
    return { belt, stripes, techniques };
  }, [catalog, beltKey]);
  const [belt, setBelt] = useState(original.belt);
  const [stripes, setStripes] = useState(original.stripes);
  const [techniques, setTechniques] = useState<BeltTechnique[]>(original.techniques);
  const [invalidHex, setInvalidHex] = useState<ReadonlySet<string>>(new Set());
  const [pick, setPick] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const labels = useMemo(
    () => new Map(catalog.skills.map((skill) => [skill.key, skill.displayLabel])),
    [catalog.skills],
  );
  const available = catalog.skills.filter(
    (skill) => !techniques.some((technique) => technique.skillKey === skill.key),
  );
  const dirty = JSON.stringify({ belt, stripes, techniques }) !== JSON.stringify(original);
  const ageError =
    belt.criteria.minAge !== null &&
    belt.criteria.maxAge !== null &&
    belt.criteria.minAge > belt.criteria.maxAge
      ? "Minimum age must not be above maximum age."
      : null;
  const nameError = belt.name.trim() === "" ? "Enter a belt name." : null;
  const blocked = busy || invalidHex.size > 0 || ageError !== null || nameError !== null;

  function reset(): void {
    setBelt(original.belt);
    setStripes(original.stripes);
    setTechniques(original.techniques);
    setInvalidHex(new Set());
    setPick("");
    setPickError(null);
  }

  if (!editing) {
    return (
      <div className="belt-editor">
        <button
          className="levels-editor-button"
          disabled={locked}
          onClick={() => {
            reset();
            onEdit();
          }}
          type="button"
        >
          Edit belt
        </button>
      </div>
    );
  }

  function markHex(id: string, invalid: boolean): void {
    setInvalidHex((current) => {
      const next = new Set(current);
      if (invalid) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setColours(colors: string[]): void {
    setBelt((current) => ({ ...current, visual: { ...current.visual, colors } }));
  }

  function addPicked(): void {
    const skill = available.find(
      (item) => item.displayLabel.toLowerCase() === pick.trim().toLowerCase(),
    );
    if (skill === undefined) {
      setPickError("Pick a technique from the list. New ones are added in the Techniques tab.");
      return;
    }
    setTechniques((current) => [
      ...current,
      { beltKey, skillKey: skill.key, minimumRating: skill.minimumRating },
    ]);
    setPick("");
    setPickError(null);
  }

  async function save(): Promise<void> {
    const replaced = new Map(
      [belt, ...stripes].map((level) => [
        level.definitionKey,
        { ...level, name: level.name.trim() },
      ]),
    );
    const saved = await onSave({
      displayName: catalog.displayName,
      levels: catalog.levels.map((level) => replaced.get(level.definitionKey) ?? level),
      skills: catalog.skills,
      beltTechniques: [
        ...catalog.beltTechniques.filter((technique) => technique.beltKey !== beltKey),
        ...techniques,
      ],
    });
    if (saved) onClose();
  }

  function cancel(): void {
    if (dirty) dialog.current?.showModal();
    else onClose();
  }

  const id = `belt-editor-${beltKey}`;
  return (
    <section aria-labelledby={`${id}-title`} className="belt-editor" data-editing="">
      <h3 id={`${id}-title`}>Edit {original.belt.name}</h3>
      <BeltBar
        name={belt.name}
        stripeCount={stripes.length}
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
          aria-describedby={nameError ? `${id}-name-error` : undefined}
          aria-invalid={nameError !== null}
          maxLength={80}
          onChange={(event) => setBelt({ ...belt, name: event.target.value })}
          value={belt.name}
        />
      </label>
      {nameError ? (
        <p className="levels-editor-hint" id={`${id}-name-error`} role="alert">
          {nameError}
        </p>
      ) : null}

      <fieldset className="levels-editor-group">
        <legend>Colours</legend>
        {belt.visual.colors.map((colour, index) => (
          <ColourField
            id={`${id}-colour-${index}`}
            key={index}
            label={`Belt colour ${index + 1}`}
            onColour={(next) =>
              setColours(belt.visual.colors.map((value, at) => (at === index ? next : value)))
            }
            onInvalid={markHex}
            value={colour}
          />
        ))}
        <div className="levels-editor-row">
          {belt.visual.colors.length < maxColours ? (
            <button
              className="levels-editor-button"
              onClick={() => setColours([...belt.visual.colors, belt.visual.colors.at(-1)!])}
              type="button"
            >
              Add colour
            </button>
          ) : null}
          {belt.visual.colors.length > 1 ? (
            <button
              className="levels-editor-button"
              onClick={() => {
                markHex(`${id}-colour-${belt.visual.colors.length - 1}`, false);
                setColours(belt.visual.colors.slice(0, -1));
              }}
              type="button"
            >
              Remove last colour
            </button>
          ) : null}
        </div>
        <ColourField
          id={`${id}-stripe`}
          label="Stripe colour"
          onColour={(next) => setBelt({ ...belt, visual: { ...belt.visual, stripeColor: next } })}
          onInvalid={markHex}
          value={belt.visual.stripeColor ?? "#FFFFFF"}
        />
      </fieldset>

      <fieldset className="levels-editor-group levels-editor-grid">
        <legend>Belt criteria</legend>
        {(
          [
            ["Minimum age", "minAge", 3, 99],
            ["Maximum age", "maxAge", 3, 99],
            ["Minimum classes", "minClasses", 0, 10_000],
          ] as const
        ).map(([label, field, min, max]) => (
          <label className="levels-editor-field" key={field}>
            <span>{label}</span>
            <input
              inputMode="numeric"
              max={max}
              min={min}
              onChange={(event) =>
                setBelt({
                  ...belt,
                  criteria: { ...belt.criteria, [field]: numberOrNull(event.target.value) },
                })
              }
              type="number"
              value={belt.criteria[field] ?? ""}
            />
          </label>
        ))}
        <label className="levels-editor-field">
          <span>Minimum days</span>
          <input
            inputMode="numeric"
            min={0}
            onChange={(event) => setBelt(withDays(belt, numberOrNull(event.target.value)))}
            type="number"
            value={minimumDays(belt) ?? ""}
          />
        </label>
      </fieldset>
      {ageError ? (
        <p className="levels-editor-hint" role="alert">
          {ageError}
        </p>
      ) : null}

      {stripes.length > 0 ? (
        <div className="belt-editor-stripes">
          <table>
            <caption>Stripes</caption>
            <thead>
              <tr>
                <th scope="col">Stripe</th>
                <th scope="col">Minimum classes</th>
                <th scope="col">Minimum days</th>
              </tr>
            </thead>
            <tbody>
              {stripes.map((stripe, index) => {
                const name = `${ordinal(stripe.stripeNumber ?? index + 1)} stripe`;
                const update = (next: CatalogLevel) =>
                  setStripes(stripes.map((item, at) => (at === index ? next : item)));
                return (
                  <tr key={stripe.definitionKey}>
                    <th scope="row">{name}</th>
                    <td>
                      <input
                        aria-label={`${name} minimum classes`}
                        inputMode="numeric"
                        min={0}
                        onChange={(event) =>
                          update({
                            ...stripe,
                            criteria: {
                              ...stripe.criteria,
                              minClasses: numberOrNull(event.target.value),
                            },
                          })
                        }
                        type="number"
                        value={stripe.criteria.minClasses ?? ""}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${name} minimum days`}
                        inputMode="numeric"
                        min={0}
                        onChange={(event) =>
                          update(withDays(stripe, numberOrNull(event.target.value)))
                        }
                        type="number"
                        value={minimumDays(stripe) ?? ""}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <fieldset className="levels-editor-group">
        <legend>Techniques for this belt and its stripes</legend>
        {techniques.length === 0 ? (
          <p className="levels-editor-muted">No techniques required.</p>
        ) : (
          <ul className="levels-editor-list">
            {techniques.map((technique) => {
              const label = labels.get(technique.skillKey) ?? technique.skillKey;
              return (
                <li key={technique.skillKey}>
                  <span>{label}</span>
                  <label className="levels-editor-field levels-editor-inline">
                    <span>Minimum rating</span>
                    <select
                      onChange={(event) =>
                        setTechniques(
                          techniques.map((item) =>
                            item === technique
                              ? { ...item, minimumRating: Number(event.target.value) }
                              : item,
                          ),
                        )
                      }
                      value={technique.minimumRating}
                    >
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <option key={rating} value={rating}>
                          {rating} of 5
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    aria-label={`Remove ${label}`}
                    className="levels-editor-button"
                    onClick={() => setTechniques(techniques.filter((item) => item !== technique))}
                    type="button"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {available.length > 0 ? (
          <div className="levels-editor-row">
            <label className="levels-editor-field">
              <span>Add technique</span>
              <input
                aria-describedby={pickError ? `${id}-pick-error` : undefined}
                list={`${id}-options`}
                maxLength={80}
                onChange={(event) => {
                  setPick(event.target.value);
                  setPickError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addPicked();
                  }
                }}
                value={pick}
              />
              <datalist id={`${id}-options`}>
                {available.map((skill) => (
                  <option key={skill.key} value={skill.displayLabel} />
                ))}
              </datalist>
            </label>
            <button className="levels-editor-button" onClick={addPicked} type="button">
              Add
            </button>
          </div>
        ) : null}
        {pickError ? (
          <p className="levels-editor-hint" id={`${id}-pick-error`} role="alert">
            {pickError}
          </p>
        ) : null}
      </fieldset>

      <div className="levels-editor-actions">
        <button
          className="levels-editor-button"
          data-variant="primary"
          disabled={blocked || !dirty}
          onClick={() => void save()}
          type="button"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="levels-editor-button" disabled={busy} onClick={cancel} type="button">
          Cancel
        </button>
      </div>

      <dialog aria-labelledby={`${id}-discard`} className="levels-editor-dialog" ref={dialog}>
        <p id={`${id}-discard`}>Discard the changes to {original.belt.name}?</p>
        <div className="levels-editor-row">
          <button
            className="levels-editor-button"
            data-variant="primary"
            onClick={() => {
              dialog.current?.close();
              onClose();
            }}
            type="button"
          >
            Discard changes
          </button>
          <button
            className="levels-editor-button"
            onClick={() => dialog.current?.close()}
            type="button"
          >
            Keep editing
          </button>
        </div>
      </dialog>
    </section>
  );
}
