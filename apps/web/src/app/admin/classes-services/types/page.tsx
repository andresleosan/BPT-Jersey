"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { ProgramRecord } from "@bpt-jersey/domain/schedule";
import {
  dropInPolicies,
  programDefaultsV2,
  programKinds,
  type DropInPolicy,
  type ProgramKind,
} from "@bpt-jersey/domain/schedule/classes-services";

import { getScheduleCatalog, listSessions, saveProgramV2, updateProgram } from "../../../../lib/schedule-client";
import { useAdminOrStaffSession } from "../../admin-gate";

import "./types.css";

const kindLabels: Record<ProgramKind, string> = {
  "class-frequency": "Class: registrations = weekly/monthly frequency",
  "class-unlimited": "Class: unlimited registrations",
  "room-frequency": "Exercise room: registrations = weekly/monthly frequency",
  "room-unlimited": "Exercise room: unlimited registrations",
  service: "Service",
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

type Notice = Readonly<{ kind: "success" | "error"; message: string }>;
type LoadStatus = "loading" | "ready" | "error";

export function TypesPage() {
  const session = useAdminOrStaffSession();
  const canEdit = session.role !== "coach";
  const [programs, setPrograms] = useState<readonly ProgramRecord[]>([]);
  const [inUse, setInUse] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState({ name: "", abbreviation: "" });
  const [messages, setMessages] = useState<Record<string, string>>({});

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
        setInUse(
          new Set(sessions.filter((s) => s.status !== "cancelled").map((s) => s.programId)),
        );
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
      active?: boolean;
      colour?: string;
      kind?: ProgramKind;
      dropInPolicy?: DropInPolicy;
      notifyByEmail?: boolean;
      showInList?: boolean;
      message?: string;
    },
  ): Promise<void> {
    try {
      replace(await updateProgram({ programId, ...change }));
      setNotice({ kind: "success", message: "Type updated." });
    } catch (error) {
      setNotice({ kind: "error", message: (error as Error).message });
    }
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
  const visible = programs.filter((program) => {
    if (!query) return true;
    return (
      program.name.toLowerCase().includes(query) ||
      (program.abbreviation ?? "").toLowerCase().includes(query)
    );
  });

  return (
    <>
      {canEdit ? (
        <section className="cs-card">
          <h2>Create a new class / service type</h2>
          <form className="cs-form-row" onSubmit={(event) => void onCreate(event)}>
            <label>
              Name
              <input
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                required
                value={draft.name}
              />
            </label>
            <label>
              Abbreviation
              <input
                onChange={(event) =>
                  setDraft((current) => ({ ...current, abbreviation: event.target.value }))
                }
                required
                value={draft.abbreviation}
              />
            </label>
            <button className="button" type="submit">
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

      <section className="cs-card">
        <input
          aria-label="Search types"
          onChange={(event) => setSearch(event.target.value)}
          type="search"
          value={search}
        />
        <table className="cs-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Colour</th>
              <th>Status</th>
              <th>Type</th>
              <th>Drop-ins / trials</th>
              <th>E-mail</th>
              <th>List</th>
              <th>Message</th>
              <th>In use</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((program) => (
              <tr
                key={program.programId}
                style={{ "--type-colour": program.colour ?? programDefaultsV2.colour } as CSSProperties}
              >
                <td data-label="Name">
                  <span className="cs-abbr">{program.abbreviation ?? "—"}</span>
                  {program.name}
                </td>
                <td data-label="Colour">
                  <span aria-hidden="true" className="cs-swatch" style={{ background: "var(--type-colour)" }} />
                  <input
                    aria-label={`Colour of ${program.name}`}
                    disabled={!canEdit}
                    onChange={(event) => void patch(program.programId, { colour: event.target.value })}
                    type="color"
                    value={program.colour ?? programDefaultsV2.colour}
                  />
                </td>
                <td data-label="Status">
                  <label>
                    <input
                      checked={program.active}
                      disabled={!canEdit}
                      onChange={(event) => void patch(program.programId, { active: event.target.checked })}
                      type="checkbox"
                    />{" "}
                    Active
                  </label>
                </td>
                <td data-label="Type">
                  <select
                    aria-label={`Kind of ${program.name}`}
                    disabled={!canEdit}
                    onChange={(event) => void patch(program.programId, { kind: event.target.value as ProgramKind })}
                    value={program.kind ?? programDefaultsV2.kind}
                  >
                    {programKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabels[kind]}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Drop-ins / trials">
                  <select
                    aria-label={`Drop-ins of ${program.name}`}
                    disabled={!canEdit}
                    onChange={(event) =>
                      void patch(program.programId, { dropInPolicy: event.target.value as DropInPolicy })
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
                <td data-label="E-mail">
                  <input
                    aria-label={`E-mail for ${program.name}`}
                    checked={program.notifyByEmail ?? programDefaultsV2.notifyByEmail}
                    disabled={!canEdit}
                    onChange={(event) => void patch(program.programId, { notifyByEmail: event.target.checked })}
                    type="checkbox"
                  />
                </td>
                <td data-label="List">
                  <input
                    aria-label={`List ${program.name}`}
                    checked={program.showInList ?? programDefaultsV2.showInList}
                    disabled={!canEdit}
                    onChange={(event) => void patch(program.programId, { showInList: event.target.checked })}
                    type="checkbox"
                  />
                </td>
                <td data-label="Message">
                  <input
                    aria-label={`Message of ${program.name}`}
                    disabled={!canEdit}
                    onChange={(event) =>
                      setMessages((current) => ({ ...current, [program.programId]: event.target.value }))
                    }
                    value={messages[program.programId] ?? program.message ?? programDefaultsV2.message}
                  />
                  <button
                    className="button button-secondary"
                    disabled={!canEdit}
                    onClick={() =>
                      void patch(program.programId, { message: messages[program.programId] ?? "" })
                    }
                    type="button"
                  >
                    Save <span className="sr-only">{`message of ${program.name}`}</span>
                  </button>
                </td>
                <td data-label="In use">{inUse.has(program.programId) ? "In use" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export default TypesPage;
