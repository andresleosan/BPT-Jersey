import {
  checkInProximityRadiusMeters,
  distanceInMetres,
  maxCheckInProximityMeters,
  type CheckInProximityMeasurement,
  type CheckInProximitySignal,
  type LocationGeofence,
} from "@bpt-jersey/domain/schedule";

/**
 * Turns the device position into the single distance the backend accepts for the 50 m check-in
 * eligibility signal (T109, BRIEF decision 5).
 *
 * The member's coordinates never leave this function: they are reduced to a distance from the site
 * and discarded. A device that refuses, fails or answers too coarsely produces an honest
 * `unavailable` state rather than an error, because the radius is a signal and not a gate.
 */
export type ProximityReading =
  | Readonly<{
      status: "measured";
      signal: Exclude<CheckInProximitySignal, "unavailable">;
      measurement: CheckInProximityMeasurement;
    }>
  | Readonly<{ status: "unavailable"; reason: string }>;

export type GeolocationLike = Readonly<{
  getCurrentPosition: (
    onSuccess: (position: {
      coords: { latitude: number; longitude: number; accuracy: number };
    }) => void,
    onError: (error: unknown) => void,
    options?: Readonly<{ enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }>,
  ) => void;
}>;

const positionTimeoutMs = 10_000;

function unavailable(reason: string): ProximityReading {
  return Object.freeze({ status: "unavailable" as const, reason });
}

export async function measureCheckInProximity(
  input: Readonly<{
    site: LocationGeofence | null | undefined;
    geolocation?: GeolocationLike;
    now?: () => Date;
  }>,
): Promise<ProximityReading> {
  const site = input.site;
  if (site === null || site === undefined) {
    return unavailable("No coordinates are recorded for this site.");
  }

  const geolocation =
    input.geolocation ??
    (typeof navigator === "undefined" ? undefined : (navigator.geolocation as GeolocationLike));
  if (geolocation === undefined) {
    return unavailable("This device cannot report its position.");
  }

  const position = await new Promise<
    { coords: { latitude: number; longitude: number; accuracy: number } } | undefined
  >((resolve) => {
    try {
      geolocation.getCurrentPosition(
        (value) => resolve(value),
        () => resolve(undefined),
        { enableHighAccuracy: true, timeout: positionTimeoutMs, maximumAge: 0 },
      );
    } catch {
      resolve(undefined);
    }
  });

  if (position === undefined) {
    return unavailable("The device did not share a position.");
  }

  const { latitude, longitude, accuracy } = position.coords;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(accuracy) ||
    accuracy < 0
  ) {
    return unavailable("The device position could not be read.");
  }
  if (accuracy > checkInProximityRadiusMeters) {
    return unavailable(
      `The position is only accurate to ${Math.round(accuracy)} m, which cannot decide a ` +
        `${checkInProximityRadiusMeters} m radius.`,
    );
  }

  // Far is far: beyond the server's sanity bound the exact figure adds nothing, and sending it
  // would make the check-in fail on size instead of asking staff for a reason.
  const distanceMeters = Math.min(
    maxCheckInProximityMeters,
    Math.round(distanceInMetres({ latitude, longitude }, site)),
  );
  return Object.freeze({
    status: "measured" as const,
    signal: distanceMeters <= checkInProximityRadiusMeters ? ("within" as const) : ("outside" as const),
    measurement: Object.freeze({
      distanceMeters,
      accuracyMeters: Math.round(accuracy),
      measuredAt: (input.now?.() ?? new Date()).toISOString(),
    }),
  });
}
