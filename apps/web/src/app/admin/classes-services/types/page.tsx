"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { ProgramRecord } from "@bpt-jersey/domain/schedule";
import {
  dropInPolicies,
  parseCreateProgramInputV2,
  parseUpdateProgramInput,
  programDefaultsV2,
  programKinds,
  programMessageMaxLength,
  type DropInPolicy,
  type ProgramAgeRange,
  type ProgramKind,
  type ProgramSite,
  type ProgramV2Fields,
} from "@bpt-jersey/domain/schedule/classes-services";
import {
  deleteProgram,
  getScheduleCatalog,
  saveProgramV2,
  updateProgram,
} from "../../../../lib/schedule-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import { AudienceFields, audienceSummary } from "./audience-fields";
import "./types.css";

const kindLabels: Record<ProgramKind, string> = {
  "class-frequency": "Class: weekly/monthly allowance",
  "class-unlimited": "Class: unlimited registrations",
  "room-frequency": "Exercise room: weekly/monthly allowance",
  "room-unlimited": "Exercise room: unlimited registrations",
  service: "Service",
};
const dropInLabels: Record<DropInPolicy, string> = {
  no: "Not allowed",
  unlimited: "Unlimited",
  automatic: "Automatic",
  "1": "1 drop-in/trial",
  "2": "2 drop-ins/trials",
  "3": "3 drop-ins/trials",
  "4": "4 drop-ins/trials",
  "5": "5 drop-ins/trials",
};
type Notice = Readonly<{ kind: "success" | "error"; message: string }>;
type Edit = ProgramV2Fields & { programId: string; name: string; active: boolean };

export function TypesPage() {
  const session = useAdminOrStaffSession();
  const canEdit = ["owner", "administrator", "headCoach"].includes(session.role);
  const canDelete = session.role === "owner" || session.role === "administrator";
  const [programs, setPrograms] = useState<readonly ProgramRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(false);
  const emptyDraft = {
    name: "",
    abbreviation: "",
    ageRange: null as ProgramAgeRange | null,
    sites: [] as readonly ProgramSite[],
  };
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState<Edit | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);
  const createName = useRef<HTMLInputElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let alive = true;
    getScheduleCatalog()
      .then((catalog) => {
        if (!alive) return;
        setPrograms(catalog.programs);
        setStatus("ready");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [reload]);

  const replace = (record: ProgramRecord) =>
    setPrograms((current) =>
      current.some((p) => p.programId === record.programId)
        ? current.map((p) => (p.programId === record.programId ? record : p))
        : [...current, record],
    );

  async function mutate(key: string, action: () => Promise<void>): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(key);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save changes. Try again.",
      });
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canEdit) return;
    const parsed = parseCreateProgramInputV2(draft);
    if (!parsed.ok) {
      setNotice({ kind: "error", message: parsed.error });
      return;
    }
    await mutate("create", async () => {
      replace(await saveProgramV2(parsed.value));
      setDraft(emptyDraft);
      setNotice({ kind: "success", message: "Class type created." });
    });
  }

  async function onSave(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!editing || !canEdit) return;
    const { abbreviation, ...fields } = editing;
    // Legacy catalogue entries have no abbreviation. Do not submit an invalid empty value.
    const parsed = parseUpdateProgramInput({
      ...fields,
      ...(abbreviation.trim() ? { abbreviation } : {}),
    });
    if (!parsed.ok) {
      setNotice({ kind: "error", message: parsed.error });
      return;
    }
    await mutate(editing.programId, async () => {
      replace(await updateProgram(parsed.value));
      setEditing(null);
      listHeading.current?.focus();
      setNotice({ kind: "success", message: "Class type updated." });
    });
  }

  async function onDelete(program: ProgramRecord): Promise<void> {
    if (!canDelete || busy.current) return;
    if (
      !window.confirm(
        `Delete “${program.name}” from the type catalogue? New bookings for this type will stop. Existing sessions, bookings and attendance will be kept. Manage or cancel existing sessions in the calendar.`,
      )
    )
      return;
    await mutate(program.programId, async () => {
      replace(await deleteProgram({ programId: program.programId }));
      if (editing?.programId === program.programId) setEditing(null);
      setNotice({
        kind: "success",
        message: `“${program.name}” deleted from the catalogue. Existing sessions and history have been kept.`,
      });
      listHeading.current?.focus();
    });
  }

  function startEdit(program: ProgramRecord) {
    if (editing && !window.confirm("Discard the open editor and edit this type?")) return;
    setNotice(null);
    setEditing({
      programId: program.programId,
      name: program.name,
      active: program.active,
      abbreviation: program.abbreviation ?? programDefaultsV2.abbreviation,
      colour: program.colour ?? programDefaultsV2.colour,
      kind: program.kind ?? programDefaultsV2.kind,
      dropInPolicy: program.dropInPolicy ?? programDefaultsV2.dropInPolicy,
      notifyByEmail: program.notifyByEmail ?? programDefaultsV2.notifyByEmail,
      showInList: program.showInList ?? programDefaultsV2.showInList,
      message: program.message ?? programDefaultsV2.message,
      ageRange: program.ageRange ?? programDefaultsV2.ageRange,
      sites: program.sites ?? programDefaultsV2.sites,
    });
  }

  const available = programs.filter((program) => !program.deletedAt);
  const query = search.trim().toLocaleLowerCase();
  const visible = available
    .filter((program) =>
      `${program.name} ${program.abbreviation ?? ""}`.toLocaleLowerCase().includes(query),
    )
    .sort((a, b) => a.name.localeCompare(b.name) * (sortDesc ? -1 : 1));

  return (
    <div className="types-page">
      <header className="types-heading">
        <h2>Class / service types</h2>
        <p>Manage the names, booking options and messages used across your timetable.</p>
      </header>
      {canEdit ? (
        <section className="types-create-section" aria-labelledby="types-create-title">
          <h3 id="types-create-title">Create a class type</h3>
          <form onSubmit={(event) => void onCreate(event)}>
            <fieldset className="types-create" disabled={pending !== null}>
              <legend className="visually-hidden">New class type</legend>
              <label className="types-field">
                Name
                <input
                  ref={createName}
                  value={draft.name}
                  required
                  minLength={2}
                  maxLength={100}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label className="types-field">
                Abbreviation
                <input
                  value={draft.abbreviation}
                  required
                  minLength={2}
                  maxLength={12}
                  pattern="[A-Za-z0-9_\-]{2,12}"
                  aria-describedby="types-abbreviation-hint"
                  onChange={(event) => setDraft({ ...draft, abbreviation: event.target.value })}
                />
              </label>
              <AudienceFields
                id="types-create-audience"
                value={draft}
                onChange={(audience) => setDraft({ ...draft, ...audience })}
              />
              <button className="types-primary" type="submit">
                {pending === "create" ? "Creating…" : "Create type"}
              </button>
            </fieldset>
            <p className="types-hint" id="types-abbreviation-hint">
              Abbreviation: 2-12 letters, numbers, hyphens or underscores.
            </p>
          </form>
        </section>
      ) : null}
      {notice ? (
        <p
          className="cs-notice"
          data-kind={notice.kind}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}
      <section
        className="types-catalogue"
        aria-labelledby="types-catalogue-title"
        aria-busy={status === "loading"}
      >
        <div className="types-toolbar">
          <div>
            <h3 id="types-catalogue-title" ref={listHeading} tabIndex={-1}>
              Type catalogue
            </h3>
            {status === "ready" ? (
              <p className="types-hint" role="status">
                {visible.length} of {available.length} types
              </p>
            ) : null}
          </div>
          <label className="types-field types-search">
            Search types
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button
            className="types-secondary types-sort"
            type="button"
            onClick={() => setSortDesc(!sortDesc)}
            aria-label={`Sort names ${sortDesc ? "A to Z" : "Z to A"}`}
          >
            Name: {sortDesc ? "Z to A" : "A to Z"}
          </button>
        </div>
        {status === "loading" ? (
          <div className="types-loading" role="status">
            <span className="visually-hidden">Loading types…</span>
            <div />
            <div />
            <div />
          </div>
        ) : status === "error" ? (
          <div className="types-empty" role="alert">
            <p>Unable to load class types.</p>
            <button
              className="types-secondary"
              onClick={() => {
                setStatus("loading");
                setReload((value) => value + 1);
              }}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="types-empty">
            <h4>{query ? "No matching types" : "No class types yet"}</h4>
            <p>
              {query
                ? "Try another name or abbreviation."
                : "Create a type to organise your timetable."}
            </p>
            {query ? (
              <button className="types-secondary" type="button" onClick={() => setSearch("")}>
                Clear search
              </button>
            ) : canEdit ? (
              <button
                className="types-secondary"
                type="button"
                onClick={() => createName.current?.focus()}
              >
                Create type
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="types-list">
            {visible.map((program) => {
              const edit = editing?.programId === program.programId ? editing : null;
              const colour = edit?.colour ?? program.colour ?? programDefaultsV2.colour;
              return (
                <li className="types-item" key={program.programId}>
                  <div className="types-row">
                    <div className="types-identity">
                      <span
                        className="types-swatch"
                        aria-hidden="true"
                        style={
                          { "--type-colour": colour, "--type-ink": inkOn(colour) } as CSSProperties
                        }
                      >
                        {(program.abbreviation || program.name).slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <h4>{program.name}</h4>
                        <p>{program.abbreviation || "No abbreviation"}</p>
                      </div>
                    </div>
                    <div className="types-summary">
                      <span>{kindLabels[program.kind ?? programDefaultsV2.kind]}</span>
                      <span>{audienceSummary(program)}</span>
                      <span className="types-state" data-active={program.active}>
                        {program.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div className="types-actions">
                      {canEdit ? (
                        <button
                          className="types-secondary"
                          type="button"
                          disabled={pending !== null}
                          aria-label={`${edit ? "Close editor for" : "Edit"} ${program.name}`}
                          aria-expanded={Boolean(edit)}
                          aria-controls={`type-editor-${program.programId}`}
                          onClick={() => (edit ? setEditing(null) : startEdit(program))}
                        >
                          {edit ? "Close editor" : "Edit type"}
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          className="types-delete"
                          type="button"
                          disabled={pending !== null}
                          aria-label={`Delete ${program.name}`}
                          onClick={() => void onDelete(program)}
                        >
                          Delete type
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {edit ? (
                    <form
                      id={`type-editor-${program.programId}`}
                      className="types-editor"
                      onSubmit={(event) => void onSave(event)}
                    >
                      <fieldset disabled={pending !== null}>
                        <legend>Edit {program.name}</legend>
                        <div className="types-fields">
                          <label className="types-field">
                            Name
                            <input
                              autoFocus
                              required
                              minLength={2}
                              maxLength={100}
                              value={edit.name}
                              onChange={(event) =>
                                setEditing({ ...edit, name: event.target.value })
                              }
                            />
                          </label>
                          <label className="types-field">
                            Abbreviation
                            <input
                              required={Boolean(program.abbreviation)}
                              minLength={2}
                              maxLength={12}
                              pattern="[A-Za-z0-9_\-]{2,12}"
                              value={edit.abbreviation}
                              aria-describedby={`abbr-hint-${program.programId}`}
                              onChange={(event) =>
                                setEditing({ ...edit, abbreviation: event.target.value })
                              }
                            />
                            <span className="types-hint" id={`abbr-hint-${program.programId}`}>
                              2-12 letters, numbers, hyphens or underscores.
                            </span>
                          </label>
                          <label className="types-field">
                            Registration type
                            <select
                              value={edit.kind}
                              onChange={(event) =>
                                setEditing({ ...edit, kind: event.target.value as ProgramKind })
                              }
                            >
                              {programKinds.map((kind) => (
                                <option key={kind} value={kind}>
                                  {kindLabels[kind]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="types-field">
                            Drop-ins / trials
                            <select
                              value={edit.dropInPolicy}
                              onChange={(event) =>
                                setEditing({
                                  ...edit,
                                  dropInPolicy: event.target.value as DropInPolicy,
                                })
                              }
                            >
                              {dropInPolicies.map((policy) => (
                                <option key={policy} value={policy}>
                                  {dropInLabels[policy]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="types-field">
                            Timetable colour
                            <span className="types-colour">
                              <input
                                type="color"
                                value={edit.colour}
                                onChange={(event) =>
                                  setEditing({ ...edit, colour: event.target.value })
                                }
                              />
                              <span>{edit.colour.toUpperCase()}</span>
                            </span>
                          </label>
                          <div className="types-checks">
                            <label>
                              <input
                                type="checkbox"
                                checked={edit.active}
                                onChange={(event) =>
                                  setEditing({ ...edit, active: event.target.checked })
                                }
                              />
                              Active type
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={edit.notifyByEmail}
                                onChange={(event) =>
                                  setEditing({ ...edit, notifyByEmail: event.target.checked })
                                }
                              />
                              E-mail members when booking
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={edit.showInList}
                                onChange={(event) =>
                                  setEditing({ ...edit, showInList: event.target.checked })
                                }
                              />
                              Show in the public class list
                            </label>
                          </div>
                          <AudienceFields
                            id={`type-audience-${program.programId}`}
                            value={edit}
                            onChange={(audience) => setEditing({ ...edit, ...audience })}
                          />
                          <label className="types-field types-message">
                            Message shown when booking
                            <textarea
                              rows={3}
                              maxLength={programMessageMaxLength}
                              value={edit.message}
                              onChange={(event) =>
                                setEditing({ ...edit, message: event.target.value })
                              }
                            />
                            <span className="types-hint">
                              {edit.message.length}/{programMessageMaxLength} characters
                            </span>
                          </label>
                        </div>
                        <div className="types-editor-actions">
                          <button className="types-primary" type="submit">
                            {pending === program.programId ? "Saving…" : "Save changes"}
                          </button>
                          <button
                            className="types-secondary"
                            type="button"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </fieldset>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.179 ? "#1A1A18" : "#ffffff";
}

export default TypesPage;
