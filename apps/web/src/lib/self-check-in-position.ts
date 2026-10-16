import type { SelfCheckInPosition } from "@bpt-jersey/domain/schedule/self-check-in";

/**
 * Decision 11: this is called only from the committed slide gesture. Coordinates live only in the
 * returned value and its request body; this helper neither stores nor logs them.
 */
export type PositionReading =
  | Readonly<{ status: "ok"; position: SelfCheckInPosition }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "unavailable" }>;

export type GeolocationLike = Readonly<{
  getCurrentPosition: (
    onSuccess: (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void,
    onError: (error: { code: number }) => void,
    options?: Readonly<{ enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }>,
  ) => void;
}>;

const permissionDenied = 1; // GeolocationPositionError.PERMISSION_DENIED
const round6 = (value: number): number => Number(value.toFixed(6));

function validCoordinates(latitude: number, longitude: number, accuracy: number): boolean {
  return (
    [latitude, longitude, accuracy].every(Number.isFinite) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    accuracy >= 0
  );
}

// Precise GPS first; indoors it can time out, so a network (wifi) fix is asked for next. The server
// only judges the distance (≤ 300 m), never the accuracy, so the rough fix is enough.
const preciseRead = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 } as const;
const roughRead = { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 } as const;

export async function readDevicePosition(
  geolocation: GeolocationLike | undefined =
    typeof navigator === "undefined" ? undefined : (navigator.geolocation as GeolocationLike | undefined),
): Promise<PositionReading> {
  const first = await readOnce(geolocation, preciseRead);
  return first.status === "unavailable" ? readOnce(geolocation, roughRead) : first;
}

function readOnce(
  geolocation: GeolocationLike | undefined,
  options: Readonly<{ enableHighAccuracy: boolean; timeout: number; maximumAge: number }>,
): Promise<PositionReading> {
  if (geolocation === undefined) return Promise.resolve({ status: "unavailable" });

  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        ({ coords }) => {
          const { latitude, longitude, accuracy } = coords;
          if (!validCoordinates(latitude, longitude, accuracy)) {
            resolve({ status: "unavailable" });
            return;
          }
          resolve({
            status: "ok",
            position: {
              latitude: round6(latitude),
              longitude: round6(longitude),
              accuracyMeters: Math.ceil(accuracy),
            },
          });
        },
        (error) => resolve({ status: error?.code === permissionDenied ? "denied" : "unavailable" }),
        options,
      );
    } catch {
      resolve({ status: "unavailable" });
    }
  });
}
