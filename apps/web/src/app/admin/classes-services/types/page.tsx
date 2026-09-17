"use client";

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import type { ProgramRecord } from "@bpt-jersey/domain/schedule";
import {
  dropInPolicies,
  programDefaultsV2,
  programKinds,
  programMessageMaxLength,
  type DropInPolicy,
  type ProgramKind,
} from "@bpt-jersey/domain/schedule/classes-services";

import {
  getScheduleCatalog,
  listSessions,
  saveProgramV2,
  updateProgram,
} from "../../../../lib/schedule-client";
import { useAdminOrStaffSession } from "../../admin-gate";

import "./types.css";

const kindLabels: Record<ProgramKind, string> = {
  "class-frequency": "Class: Registrations = weekly/monthly frequency",
  "class-unlimited": "Class: Unlimited registrations",
  "room-frequency": "EXERCISE ROOM - Registrations = weekly/monthly frequency",
  "room-unlimited": "EXERCISE ROOM - Unlimited registrations",
  service: "SERVICE",
};

const dropInLabels: Record<DropInPolicy, string> = {
  no: "No",
  unlimited: "Unlimited",
  automatic: "Automatic",
  "1": "1 drop-in/trial",
  "2": "2 drop-ins/trials",
  "3": "3 drop-ins/trials",
  "4": "4 drop-ins/trials",
  "5": "5 drop-ins/trials",
};

// Lucide paths inlined: the web app ships no icon dependency.
const iconPaths = {
  video: (
    <>
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </>
  ),
  pencil: (
    <>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  trash: (
    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" />
  ),
  lock: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  save: (
    <>
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7" />
    </>
  ),
  sort: <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />,
} satisfies Record<string, ReactNode>;

function Icon({ name, size = 14 }: { name: keyof typeof iconPaths; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={`types-icon types-icon-${name}`}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width={size}
    >
      {iconPaths[name]}
    </svg>
  );
}

// ponytail: native `title` tooltip on the "?" marks; a real popover when copy outgrows one line.
function Help({ hint }: { hint: string }) {
  return (
    <span className="types-help" title={hint}>
      <Icon name="help" size={12} />
    </span>
  );
}

const columns = [
  ["Colour", "Colour used for this type in the timetable"],
  ["Status", "Inactive types cannot be scheduled"],
  ["Type", "How registrations for this type are counted"],
  ["Drop-ins/trials", "Drop-ins or trials a non-member may book"],
  ["E-mail", "E-mail members when they book this type"],
  ["List", "Show this type in the public class list"],
  ["Message to be displayed", "Shown to members when they book"],
] as const;

type Notice = Readonly<{ kind: "success" | "error"; message: string }>;
type LoadStatus = "loading" | "ready" | "error";
type Edit = Readonly<{ programId: string; name: string; abbreviation: string }>;

export function TypesPage() {
  const session = useAdminOrStaffSession();
  const canEdit = session.role !== "coach";
  const [programs, setPrograms] = useState<readonly ProgramRecord[]>([]);
  const [inUse, setInUse] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(false);
  const [draft, setDraft] = useState({ name: "", abbreviation: "" });
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [colours, setColours] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Edit | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const catalog = await getScheduleCatalog();
        const from = new Date().toISOString();
        const to = new Date(Date.now() + 90 * 86_400_000).toISOString();
        const sessions = await listSessions({ from, to });
        if (!alive) return;
        setPrograms(catalog.programs);
        setInUse(new Set(sessions.filter((s) => s.status !== "cancelled").map((s) => s.programId)));
        setStatus("ready");
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const replace = (record: ProgramRecord) =>
    setPrograms((current) =>
      current.some((p) => p.programId === record.programId)
        ? current.map((p) => (p.programId === record.programId ? record : p))
        : [...current, record],
    );

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    // A notice belongs to the action that raised it: the next one starts from a clean slate.
    setNotice(null);
    try {
      replace(await saveProgramV2(draft));
      setDraft({ name: "", abbreviation: "" });
      setNotice({ kind: "success", message: "Type saved." });
    } catch (error) {
      setNotice({ kind: "error", message: (error as Error).message });
    }
  }

  async function patch(
    programId: string,
    change: {
      name?: string;
      abbreviation?: string;
      active?: boolean;
      colour?: string;
      kind?: ProgramKind;
      dropInPolicy?: DropInPolicy;
      notifyByEmail?: boolean;
      showInList?: boolean;
      message?: string;
    },
  ): Promise<boolean> {
    setNotice(null);
    try {
      replace(await updateProgram({ programId, ...change }));
      setNotice({ kind: "success", message: "Type updated." });
      return true;
    } catch (error) {
      setNotice({ kind: "error", message: (error as Error).message });
      return false;
    }
  }

  async function saveMessage(program: ProgramRecord): Promise<void> {
    await patch(program.programId, {
      message: messages[program.programId] ?? program.message ?? programDefaultsV2.message,
    });
    setMessages((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== program.programId)),
    );
  }

  async function saveColour(program: ProgramRecord): Promise<void> {
    // The colour input hands back `#rrggbb`; the domain stores `#RRGGBB`. Compare in one case or
    // reopening the picker and closing it unchanged saves the same colour again.
    const draftColour = colours[program.programId]?.toUpperCase();
    const savedColour = (program.colour ?? programDefaultsV2.colour).toUpperCase();
    if (draftColour === undefined || draftColour === savedColour) return;
    await patch(program.programId, { colour: draftColour });
    setColours((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== program.programId)),
    );
  }

  async function onEdit(program: ProgramRecord): Promise<void> {
    if (editing?.programId !== program.programId) {
      setEditing({
        programId: program.programId,
        name: program.name,
        abbreviation: program.abbreviation ?? "",
      });
      return;
    }
    const { name, abbreviation } = editing;
    // Keep the row open on failure so the typed values are not lost.
    if (await patch(program.programId, { name, abbreviation })) setEditing(null);
  }

  if (status === "loading") {
    return (
      <p className="admin-report-state" role="status">
        Loading types...
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="cs-notice" data-kind="error" role="alert">
        Unable to load types. Refresh and try again.
      </p>
    );
  }

  const query = search.trim().toLowerCase();
  const visible = programs
    .filter((program) => {
      if (!query) return true;
      return (
        program.name.toLowerCase().includes(query) ||
        (program.abbreviation ?? "").toLowerCase().includes(query)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name) * (sortDesc ? -1 : 1));

  return (
    <div className="types-page">
      {canEdit ? (
        <section className="types-card">
          <h2 className="types-card-title">
            <Icon name="video" size={18} />
            Create a new class/service type/exercise room
          </h2>
          <form className="types-create" onSubmit={(event) => void onCreate(event)}>
            <label className="types-field">
              <span className="types-label">
                <Help hint="Full name members see when booking" />
                Name
              </span>
              <input
                className="types-input"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                required
                value={draft.name}
              />
            </label>
            <label className="types-field">
              <span className="types-label">
                <Help hint="Short code shown on the timetable" />
                Abbreviation
              </span>
              <input
                className="types-input"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, abbreviation: event.target.value }))
                }
                required
                value={draft.abbreviation}
              />
            </label>
            {draft.abbreviation || draft.name ? (
              <span aria-hidden="true" className="types-avatar types-avatar-preview">
                {initials(draft.abbreviation || draft.name)}
              </span>
            ) : null}
            <button className="types-primary" type="submit">
              Create
            </button>
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

      <section className="types-card">
        <label className="types-search">
          <span aria-hidden="true">Search:</span>
          <input
            aria-label="Search types"
            onChange={(event) => setSearch(event.target.value)}
            type="search"
            value={search}
          />
        </label>
        {visible.length === 0 ? (
          <p className="types-empty">No types match.</p>
        ) : (
          <div className="types-scroll">
            <table className="types-table">
              <thead>
                <tr>
                  <th aria-sort={sortDesc ? "descending" : "ascending"}>
                    <button
                      className="types-sort"
                      onClick={() => setSortDesc((current) => !current)}
                      type="button"
                    >
                      Name
                      <Icon name="sort" size={12} />
                    </button>
                  </th>
                  {columns.map(([label, hint]) => (
                    <th key={label}>
                      <Help hint={hint} />
                      {label}
                    </th>
                  ))}
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((program) => {
                  const colour =
                    colours[program.programId] ?? program.colour ?? programDefaultsV2.colour;
                  const edit = editing?.programId === program.programId ? editing : null;
                  const locked = inUse.has(program.programId);
                  return (
                    <tr
                      key={program.programId}
                      style={
                        { "--type-colour": colour, "--type-ink": inkOn(colour) } as CSSProperties
                      }
                    >
                      <td>
                        <div className="types-name">
                          <span aria-hidden="true" className="types-avatar">
                            {initials(program.abbreviation || program.name)}
                          </span>
                          {edit ? (
                            <span className="types-name-edit">
                              <input
                                aria-label={`New name of ${program.name}`}
                                className="types-inline"
                                onChange={(event) =>
                                  setEditing({ ...edit, name: event.target.value })
                                }
                                value={edit.name}
                              />
                              <input
                                aria-label={`New abbreviation of ${program.name}`}
                                className="types-inline"
                                onChange={(event) =>
                                  setEditing({ ...edit, abbreviation: event.target.value })
                                }
                                value={edit.abbreviation}
                              />
                            </span>
                          ) : (
                            <span className="types-name-text">
                              <span className="types-name-title">{program.name}</span>
                              <span className="types-name-abbr">{program.abbreviation || "—"}</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <label className="types-colour">
                          <input
                            aria-label={`Colour of ${program.name}`}
                            disabled={!canEdit}
                            onBlur={() => void saveColour(program)}
                            onChange={(event) =>
                              setColours((current) => ({
                                ...current,
                                [program.programId]: event.target.value,
                              }))
                            }
                            type="color"
                            value={colour}
                          />
                          {colour.toLowerCase()}
                        </label>
                      </td>
                      <td>
                        <input
                          aria-label={`Status of ${program.name}`}
                          checked={program.active}
                          className="types-switch"
                          disabled={!canEdit}
                          onChange={(event) =>
                            void patch(program.programId, { active: event.target.checked })
                          }
                          role="switch"
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`Kind of ${program.name}`}
                          className="types-select types-select-kind"
                          disabled={!canEdit}
                          onChange={(event) =>
                            void patch(program.programId, {
                              kind: event.target.value as ProgramKind,
                            })
                          }
                          value={program.kind ?? programDefaultsV2.kind}
                        >
                          {programKinds.map((kind) => (
                            <option key={kind} value={kind}>
                              {kindLabels[kind]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={`Drop-ins of ${program.name}`}
                          className="types-select types-select-dropins"
                          disabled={!canEdit}
                          onChange={(event) =>
                            void patch(program.programId, {
                              dropInPolicy: event.target.value as DropInPolicy,
                            })
                          }
                          value={program.dropInPolicy ?? programDefaultsV2.dropInPolicy}
                        >
                          {dropInPolicies.map((policy) => (
                            <option key={policy} value={policy}>
                              {dropInLabels[policy]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`E-mail for ${program.name}`}
                          checked={program.notifyByEmail ?? programDefaultsV2.notifyByEmail}
                          className="types-switch"
                          disabled={!canEdit}
                          onChange={(event) =>
                            void patch(program.programId, { notifyByEmail: event.target.checked })
                          }
                          role="switch"
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`List ${program.name}`}
                          checked={program.showInList ?? programDefaultsV2.showInList}
                          className="types-switch"
                          disabled={!canEdit}
                          onChange={(event) =>
                            void patch(program.programId, { showInList: event.target.checked })
                          }
                          role="switch"
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <div className="types-message">
                          <input
                            aria-label={`Message of ${program.name}`}
                            disabled={!canEdit}
                            maxLength={programMessageMaxLength}
                            onChange={(event) =>
                              setMessages((current) => ({
                                ...current,
                                [program.programId]: event.target.value,
                              }))
                            }
                            value={
                              messages[program.programId] ??
                              program.message ??
                              programDefaultsV2.message
                            }
                          />
                          <button
                            data-dirty={program.programId in messages}
                            disabled={!canEdit}
                            onClick={() => void saveMessage(program)}
                            title="Save message"
                            type="button"
                          >
                            <Icon name="save" />
                            <span className="visually-hidden">{`Save message of ${program.name}`}</span>
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="types-actions">
                          <button
                            className="types-action types-action-edit"
                            disabled={!canEdit}
                            onClick={() => void onEdit(program)}
                            title={edit ? "Save changes" : "Edit name and abbreviation"}
                            type="button"
                          >
                            <Icon name={edit ? "check" : "pencil"} />
                            <span className="visually-hidden">
                              {`${edit ? "Save" : "Edit"} ${program.name}`}
                            </span>
                          </button>
                          {locked ? (
                            <button
                              className="types-action types-action-locked"
                              disabled
                              title="In use by upcoming sessions"
                              type="button"
                            >
                              <Icon name="lock" />
                              <span className="visually-hidden">{`In use: ${program.name}`}</span>
                            </button>
                          ) : (
                            // ponytail: no deleteProgram callable yet; enable once the backend has one.
                            <button
                              className="types-action types-action-delete"
                              disabled
                              title="Deleting types is not available yet"
                              type="button"
                            >
                              <Icon name="trash" />
                              <span className="visually-hidden">{`Delete ${program.name}`}</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// Dark ink on light swatches, white on dark ones (WCAG relative luminance, 0.179 crossover).
export function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.179 ? "#1e293b" : "#ffffff";
}

function initials(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 2)
    .toUpperCase();
}

export default TypesPage;
