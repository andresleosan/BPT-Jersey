"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LocationRecord } from "@bpt-jersey/domain/schedule";
import { locationKinds, type LocationKind } from "@bpt-jersey/domain/schedule/classes-services";

import {
  getScheduleCatalog,
  listSessions,
  saveLocation,
  updateLocation,
} from "../../../../lib/schedule-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import { SiteGeofencePanel } from "./site-geofence-panel";

import "./locations.css";

const kindLabels: Record<LocationKind, string> = {
  presential: "Presential",
  zoom: "Zoom platform",
  jitsi: "Jitsi Meet platform",
};

type Notice = Readonly<{ kind: "success" | "error"; message: string }>;
type LoadStatus = "loading" | "ready" | "error";

export function LocationsPage() {
  const session = useAdminOrStaffSession();
  const canEdit = session.role !== "coach";
  const [locations, setLocations] = useState<readonly LocationRecord[]>([]);
  const [inUse, setInUse] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    abbreviation: "",
    kind: "presential" as LocationKind,
  });
  const [editing, setEditing] = useState<LocationRecord | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", abbreviation: "" });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const catalog = await getScheduleCatalog();
        const from = new Date().toISOString();
        const to = new Date(Date.now() + 90 * 86_400_000).toISOString();
        const sessions = await listSessions({ from, to });
        if (!alive) return;
        setLocations(catalog.locations);
        setInUse(
          new Set(sessions.filter((s) => s.status !== "cancelled").map((s) => s.locationId)),
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

  useEffect(() => {
    if (editing) {
      setEditDraft({ name: editing.name, abbreviation: editing.abbreviation ?? "" });
      dialogRef.current?.showModal();
    }
  }, [editing]);

  const replace = (record: LocationRecord) =>
    setLocations((current) =>
      current.some((l) => l.locationId === record.locationId)
        ? current.map((l) => (l.locationId === record.locationId ? record : l))
        : [...current, record],
    );

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      replace(await saveLocation(draft));
      setDraft({ name: "", abbreviation: "", kind: "presential" });
      setNotice({ kind: "success", message: "Site saved." });
    } catch (error) {
      setNotice({ kind: "error", message: (error as Error).message });
    }
  }

  async function patch(
    locationId: string,
    change: { active?: boolean; kind?: LocationKind; name?: string; abbreviation?: string },
  ): Promise<void> {
    try {
      replace(await updateLocation({ locationId, ...change }));
      setNotice({ kind: "success", message: "Site updated." });
    } catch (error) {
      setNotice({ kind: "error", message: (error as Error).message });
    }
  }

  function closeDialog(): void {
    dialogRef.current?.close();
  }

  function onDialogClose(): void {
    const locationId = editing?.locationId;
    setEditing(null);
    if (locationId) editButtonRefs.current[locationId]?.focus();
  }

  async function onSaveEdit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!editing) return;
    await patch(editing.locationId, editDraft);
    closeDialog();
  }

  if (status === "loading") {
    return (
      <p className="admin-report-state" role="status">
        Loading sites...
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="cs-notice" data-kind="error" role="alert">
        Unable to load sites. Refresh and try again.
      </p>
    );
  }

  return (
    <>
      {canEdit ? (
        <section className="cs-card">
          <h2>Create / manage rooms or fields</h2>
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
            <label>
              Kind
              <select
                onChange={(event) =>
                  setDraft((current) => ({ ...current, kind: event.target.value as LocationKind }))
                }
                value={draft.kind}
              >
                {locationKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kindLabels[kind]}
                  </option>
                ))}
              </select>
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
        <table className="cs-table">
          <thead>
            <tr>
              <th>Room / field</th>
              <th>Abbreviation</th>
              <th>Status</th>
              <th>Type</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => (
              <tr key={location.locationId}>
                <td data-label="Room / field">{location.name}</td>
                <td data-label="Abbreviation">
                  <span className="cs-abbr">{location.abbreviation ?? location.locationId}</span>
                </td>
                <td data-label="Status">
                  <select
                    aria-label={`Status of ${location.name}`}
                    disabled={!canEdit}
                    onChange={(event) =>
                      void patch(location.locationId, { active: event.target.value === "active" })
                    }
                    value={location.active ? "active" : "inactive"}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </td>
                <td data-label="Type">
                  <select
                    aria-label={`Type of ${location.name}`}
                    disabled={!canEdit}
                    onChange={(event) =>
                      void patch(location.locationId, { kind: event.target.value as LocationKind })
                    }
                    value={location.kind ?? "presential"}
                  >
                    {locationKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabels[kind]}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Actions">
                  {canEdit ? (
                    <button
                      className="button button-secondary"
                      onClick={() => setEditing(location)}
                      ref={(node) => {
                        editButtonRefs.current[location.locationId] = node;
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                  ) : null}
                  {inUse.has(location.locationId) ? <span className="cs-inuse">In use</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <dialog className="cs-edit-dialog" onClose={onDialogClose} ref={dialogRef}>
        {editing ? (
          <form onSubmit={(event) => void onSaveEdit(event)}>
            <h2>Edit site</h2>
            <label>
              Name
              <input
                onChange={(event) =>
                  setEditDraft((current) => ({ ...current, name: event.target.value }))
                }
                required
                value={editDraft.name}
              />
            </label>
            <label>
              Abbreviation
              <input
                onChange={(event) =>
                  setEditDraft((current) => ({ ...current, abbreviation: event.target.value }))
                }
                required
                value={editDraft.abbreviation}
              />
            </label>
            <button className="button" type="submit">
              Save
            </button>
            <SiteGeofencePanel location={editing} onSaved={replace} />
          </form>
        ) : null}
      </dialog>
    </>
  );
}

export default LocationsPage;
