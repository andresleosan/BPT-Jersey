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
  // `saveLocationGeofence` stays with the office, so a head coach must not be offered a panel
  // whose Save can only come back refused.
  const canEditGeofence = session.role === "owner" || session.role === "administrator";
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
    // A notice belongs to the action that raised it: the next one starts from a clean slate.
    setNotice(null);
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
  ): Promise<boolean> {
    setNotice(null);
    try {
      const updated = await updateLocation({ locationId, ...change });
      replace(updated);
      setEditing((current) => (current?.locationId === locationId ? updated : current));
      setNotice({ kind: "success", message: "Site updated." });
      return true;
    } catch (error) {
      setNotice({ kind: "error", message: (error as Error).message });
      return false;
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
    if (await patch(editing.locationId, editDraft)) closeDialog();
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
            <label htmlFor="location-create-abbreviation">
              Abbreviation
              <input
                aria-describedby="location-create-abbreviation-hint"
                id="location-create-abbreviation"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, abbreviation: event.target.value }))
                }
                pattern="[A-Za-z0-9_-]{2,12}"
                required
                value={draft.abbreviation}
              />
            </label>
            <small id="location-create-abbreviation-hint">
              2 to 12 letters, digits, &quot;_&quot; or &quot;-&quot;.
            </small>
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
                <span className="visually-hidden">Actions</span>
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
          <>
            <form onSubmit={(event) => void onSaveEdit(event)}>
              <h2>Edit {editing.name}</h2>
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
              <label htmlFor="location-edit-abbreviation">
                Abbreviation
                <input
                  aria-describedby="location-edit-abbreviation-hint"
                  id="location-edit-abbreviation"
                  onChange={(event) =>
                    setEditDraft((current) => ({ ...current, abbreviation: event.target.value }))
                  }
                  pattern="[A-Za-z0-9_-]{2,12}"
                  required
                  value={editDraft.abbreviation}
                />
              </label>
              <small id="location-edit-abbreviation-hint">
                2 to 12 letters, digits, &quot;_&quot; or &quot;-&quot;.
              </small>
              <button className="button" type="submit">
                Save
              </button>
            </form>
            {canEditGeofence ? (
              <SiteGeofencePanel
                location={editing}
                onSaved={(record) => {
                  replace(record);
                  setEditing(record);
                }}
              />
            ) : null}
          </>
        ) : null}
      </dialog>
    </>
  );
}

export default LocationsPage;
