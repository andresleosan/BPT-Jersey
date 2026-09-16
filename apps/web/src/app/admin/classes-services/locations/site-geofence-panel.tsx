"use client";

import { useState, type FormEvent } from "react";
import {
  checkInProximityRadiusMeters,
  parseSaveLocationGeofenceInput,
  type LocationRecord,
} from "@bpt-jersey/domain/schedule";

import { saveLocationGeofence } from "../../../../lib/schedule-client";

type Props = Readonly<{
  location: LocationRecord;
  onSaved: (location: LocationRecord) => void;
}>;

type Draft = Readonly<{ latitude: string; longitude: string }>;

/** Decimal degrees typed by a person: an optional sign, digits, an optional fraction. Never "". */
const decimalDegreesPattern = /^-?\d{1,3}(?:\.\d{1,6})?$/u;

function coordinate(value: string): number | undefined {
  const trimmed = value.trim();
  return decimalDegreesPattern.test(trimmed) ? Number(trimmed) : undefined;
}

function draftFor(location: LocationRecord): Draft {
  return {
    latitude: location.geofence?.latitude.toString() ?? "",
    longitude: location.geofence?.longitude.toString() ?? "",
  };
}

/**
 * Administration records the coordinates of each academy site. That is the only geographic data the
 * platform holds: it lets a coach's device reduce its own position to a distance for the 50 m
 * check-in eligibility signal, and no member coordinate is ever stored (T109, BRIEF decision 5).
 */
export function SiteGeofencePanel({ location, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftFor(location));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Readonly<{ kind: "success" | "error"; text: string }>>();

  function updateDraft(patch: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function submit(clear: boolean): Promise<void> {
    const latitude = coordinate(draft.latitude);
    const longitude = coordinate(draft.longitude);
    const parsed =
      clear || (latitude !== undefined && longitude !== undefined)
        ? parseSaveLocationGeofenceInput({
            locationId: location.locationId,
            geofence: clear ? null : { latitude, longitude },
          })
        : undefined;
    if (parsed === undefined || !parsed.ok) {
      setMessage({
        kind: "error",
        text: "Enter the site latitude and longitude as decimal degrees with at most six decimals.",
      });
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const saved = await saveLocationGeofence(parsed.value);
      onSaved(saved);
      setDraft(draftFor(saved));
      setMessage({
        kind: "success",
        text: clear
          ? `${location.name}: coordinates cleared. Check-ins there no longer carry a location signal.`
          : `${location.name}: coordinates saved. The ${checkInProximityRadiusMeters} m check-in signal is active there.`,
      });
    } catch {
      setMessage({ kind: "error", text: "Unable to save the site coordinates. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit(false);
  };

  return (
    <div className="schedule-admin-block" data-testid="site-geofence-panel">
      <p className="admin-eyebrow">Check-in location signal</p>
      <p className="schedule-admin-form-note">
        Record the site&apos;s coordinates so a coach&apos;s device can tell whether a check-in was
        measured within {checkInProximityRadiusMeters} m of the mat. The radius is a signal, never
        proof: staff can still check a student in from outside it with a recorded reason. Member
        positions are never stored.
      </p>
      {message ? (
        <p
          className={`schedule-admin-notice schedule-admin-notice-${message.kind}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
      <form
        aria-label={`${location.name} coordinates`}
        className="schedule-admin-booking-form"
        onSubmit={handleSubmit}
      >
        <label className="schedule-admin-field" htmlFor="geofence-lat">
          Latitude
          <input
            disabled={busy}
            id="geofence-lat"
            inputMode="decimal"
            onChange={(event) => updateDraft({ latitude: event.target.value })}
            placeholder="49.186000"
            required
            value={draft.latitude}
          />
        </label>
        <label className="schedule-admin-field" htmlFor="geofence-lng">
          Longitude
          <input
            disabled={busy}
            id="geofence-lng"
            inputMode="decimal"
            onChange={(event) => updateDraft({ longitude: event.target.value })}
            placeholder="-2.106000"
            required
            value={draft.longitude}
          />
        </label>
        <div className="schedule-admin-row-actions">
          <button className="schedule-admin-button" disabled={busy} type="submit">
            {busy ? "Saving..." : "Save coordinates"}
          </button>
          <button
            className="schedule-admin-button schedule-admin-button-secondary"
            disabled={busy || !location.geofence}
            onClick={() => void submit(true)}
            type="button"
          >
            Clear coordinates
          </button>
        </div>
        <small>
          {location.geofence
            ? `Recorded: ${location.geofence.latitude}, ${location.geofence.longitude}`
            : "No coordinates recorded: check-ins here carry no location signal."}
        </small>
      </form>
    </div>
  );
}
