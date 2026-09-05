import { describe, expect, it } from "vitest";

import { measureCheckInProximity, type GeolocationLike } from "./check-in-proximity";

const site = { latitude: 49.186, longitude: -2.106 };
const now = () => new Date("2026-09-05T18:00:00.000Z");

function geolocation(
  coords: Readonly<{ latitude: number; longitude: number; accuracy: number }> | "error",
): GeolocationLike {
  return {
    getCurrentPosition: (onSuccess, onError) => {
      if (coords === "error") {
        onError(new Error("denied"));
        return;
      }
      onSuccess({ coords: { ...coords } });
    },
  };
}

describe("measureCheckInProximity", () => {
  it("reduces the device position to a distance and never returns coordinates", async () => {
    const reading = await measureCheckInProximity({
      site,
      geolocation: geolocation({ ...site, accuracy: 8 }),
      now,
    });

    expect(reading).toEqual({
      status: "measured",
      signal: "within",
      measurement: {
        distanceMeters: 0,
        accuracyMeters: 8,
        measuredAt: "2026-09-05T18:00:00.000Z",
      },
    });
    expect(JSON.stringify(reading)).not.toContain("latitude");
    expect(JSON.stringify(reading)).not.toContain("49.186");
  });

  it("reports outside the radius for a position beyond 50 m", async () => {
    const reading = await measureCheckInProximity({
      // Roughly 0.005 degrees of latitude is about 550 m.
      site,
      geolocation: geolocation({ latitude: site.latitude + 0.005, longitude: site.longitude, accuracy: 10 }),
      now,
    });

    expect(reading.status).toBe("measured");
    if (reading.status === "measured") {
      expect(reading.signal).toBe("outside");
      expect(reading.measurement.distanceMeters).toBeGreaterThan(50);
    }
  });

  it("is unavailable, with a plain reason, whenever nothing can be judged", async () => {
    const cases = [
      {
        input: { site: null, geolocation: geolocation({ ...site, accuracy: 8 }), now },
        reason: /No coordinates are recorded/u,
      },
      {
        input: { site, geolocation: geolocation("error"), now },
        reason: /did not share a position/u,
      },
      {
        input: { site, geolocation: geolocation({ ...site, accuracy: 400 }), now },
        reason: /accurate to 400 m/u,
      },
      {
        input: {
          site,
          geolocation: geolocation({ latitude: Number.NaN, longitude: 0, accuracy: 5 }),
          now,
        },
        reason: /could not be read/u,
      },
    ];

    for (const { input, reason } of cases) {
      const reading = await measureCheckInProximity(input);
      expect(reading.status).toBe("unavailable");
      if (reading.status === "unavailable") {
        expect(reading.reason).toMatch(reason);
      }
    }
  });

  it("does not throw when the browser API itself throws", async () => {
    const reading = await measureCheckInProximity({
      site,
      geolocation: {
        getCurrentPosition: () => {
          throw new Error("blocked by policy");
        },
      },
      now,
    });

    expect(reading.status).toBe("unavailable");
  });
});
