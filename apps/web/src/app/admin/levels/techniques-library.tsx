"use client";

import { useMemo, useRef, useState } from "react";
import { techniqueKey, type EditableLevelCatalog } from "@bpt-jersey/domain/levels/editor";

import type { CatalogContent } from "./belt-editor";

const duplicate = "That technique already exists.";

export function TechniquesLibrary({
  catalog,
  busy,
  onSave,
}: {
  catalog: EditableLevelCatalog;
  busy: boolean;
  onSave: (next: CatalogContent) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{
    key: string;
    label: string;
    error: string | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const usedIn = useMemo(() => {
    const counts = new Map<string, number>();
    for (const technique of catalog.beltTechniques) {
      counts.set(technique.skillKey, (counts.get(technique.skillKey) ?? 0) + 1);
    }
    return counts;
  }, [catalog.beltTechniques]);
  const visible = catalog.skills.filter((skill) =>
    skill.displayLabel.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const base = {
    displayName: catalog.displayName,
    levels: catalog.levels,
    skills: catalog.skills,
    beltTechniques: catalog.beltTechniques,
  };

  function taken(label: string, exceptKey?: string): boolean {
    const wanted = label.trim().toLowerCase();
    return catalog.skills.some(
      (skill) => skill.key !== exceptKey && skill.displayLabel.toLowerCase() === wanted,
    );
  }

  async function add(): Promise<void> {
    const label = newLabel.trim();
    if (label === "") return setAddError("Enter a technique name.");
    if (taken(label)) return setAddError(duplicate);
    const key = techniqueKey(label, new Set(catalog.skills.map((skill) => skill.key)));
    const saved = await onSave({
      ...base,
      skills: [
        ...catalog.skills,
        { key, displayLabel: label, minimumRating: 1, sequence: catalog.skills.length + 1 },
      ],
    });
    if (saved) setNewLabel("");
  }

  async function rename(): Promise<void> {
    if (renaming === null) return;
    const label = renaming.label.trim();
    if (label === "") return setRenaming({ ...renaming, error: "Enter a technique name." });
    if (taken(label, renaming.key)) return setRenaming({ ...renaming, error: duplicate });
    const saved = await onSave({
      ...base,
      skills: catalog.skills.map((skill) =>
        skill.key === renaming.key ? { ...skill, displayLabel: label } : skill,
      ),
    });
    if (saved) setRenaming(null);
  }

  async function remove(): Promise<void> {
    if (deleting === null) return;
    await onSave({
      ...base,
      skills: catalog.skills.filter((skill) => skill.key !== deleting),
      beltTechniques: catalog.beltTechniques.filter((t) => t.skillKey !== deleting),
    });
    dialog.current?.close();
  }

  const deletingLabel = catalog.skills.find((skill) => skill.key === deleting)?.displayLabel;
  const deletingUses = deleting === null ? 0 : (usedIn.get(deleting) ?? 0);

  return (
    <section aria-labelledby="levels-techniques-title" className="levels-techniques">
      <h2 id="levels-techniques-title">Techniques</h2>
      <p className="levels-editor-muted">
        {catalog.skills.length} techniques. A belt requires them from its card on the Belts tab.
      </p>
      <div className="levels-editor-row">
        <label className="levels-editor-field">
          <span>New technique</span>
          <input
            aria-describedby={addError ? "levels-techniques-add-error" : undefined}
            aria-invalid={addError !== null}
            maxLength={80}
            onChange={(event) => {
              setNewLabel(event.target.value);
              setAddError(null);
            }}
            value={newLabel}
          />
        </label>
        <button
          className="levels-editor-button"
          data-variant="primary"
          disabled={busy}
          onClick={() => void add()}
          type="button"
        >
          Add technique
        </button>
      </div>
      {addError ? (
        <p className="levels-editor-hint" id="levels-techniques-add-error" role="alert">
          {addError}
        </p>
      ) : null}
      <label className="levels-editor-field">
        <span>Search techniques</span>
        <input onChange={(event) => setQuery(event.target.value)} type="search" value={query} />
      </label>

      <div className="levels-techniques-table-wrap">
        <table className="levels-techniques-table">
          <thead>
            <tr>
              <th scope="col">Technique</th>
              <th scope="col">Used in</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((skill) => {
              const uses = usedIn.get(skill.key) ?? 0;
              const editing = renaming?.key === skill.key;
              return (
                <tr key={skill.key}>
                  <td>
                    {editing ? (
                      <label className="levels-editor-field">
                        <span>New name for {skill.displayLabel}</span>
                        <input
                          aria-invalid={renaming.error !== null}
                          autoFocus
                          maxLength={80}
                          onChange={(event) =>
                            setRenaming({ ...renaming, label: event.target.value, error: null })
                          }
                          value={renaming.label}
                        />
                        {renaming.error ? (
                          <span className="levels-editor-hint" role="alert">
                            {renaming.error}
                          </span>
                        ) : null}
                      </label>
                    ) : (
                      skill.displayLabel
                    )}
                  </td>
                  <td>
                    {uses} {uses === 1 ? "belt" : "belts"}
                  </td>
                  <td>
                    <div className="levels-editor-row">
                      {editing ? (
                        <>
                          <button
                            className="levels-editor-button"
                            data-variant="primary"
                            disabled={busy}
                            onClick={() => void rename()}
                            type="button"
                          >
                            Save
                          </button>
                          <button
                            className="levels-editor-button"
                            onClick={() => setRenaming(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            aria-label={`Rename ${skill.displayLabel}`}
                            className="levels-editor-button"
                            disabled={busy}
                            onClick={() =>
                              setRenaming({
                                key: skill.key,
                                label: skill.displayLabel,
                                error: null,
                              })
                            }
                            type="button"
                          >
                            Rename
                          </button>
                          <button
                            aria-label={`Delete ${skill.displayLabel}`}
                            className="levels-editor-button"
                            disabled={busy}
                            onClick={() => {
                              setDeleting(skill.key);
                              dialog.current?.showModal();
                            }}
                            type="button"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 ? (
        <p className="levels-editor-muted" role="status">
          No techniques match this search.
        </p>
      ) : null}

      <dialog
        aria-labelledby="levels-techniques-delete"
        className="levels-editor-dialog"
        onClose={() => setDeleting(null)}
        ref={dialog}
      >
        <p id="levels-techniques-delete">
          Delete {deletingLabel}? Used by {deletingUses} {deletingUses === 1 ? "belt" : "belts"}.
          Students&apos; past ratings stay in their history.
        </p>
        <div className="levels-editor-row">
          <button
            className="levels-editor-button"
            data-variant="primary"
            disabled={busy}
            onClick={() => void remove()}
            type="button"
          >
            Delete technique
          </button>
          <button
            className="levels-editor-button"
            onClick={() => dialog.current?.close()}
            type="button"
          >
            Keep it
          </button>
        </div>
      </dialog>
    </section>
  );
}
