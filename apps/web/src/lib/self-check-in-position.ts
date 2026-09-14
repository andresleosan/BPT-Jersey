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

export function readDevicePosition(
  geolocation: GeolocationLike | undefined =
    typeof navigator === "undefined" ? undefined : (navigator.geolocation as GeolocationLike | undefined),
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
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
    } catch {
      resolve({ status: "unavailable" });
    }
  });
}
