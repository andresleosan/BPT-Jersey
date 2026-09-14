import { describe, expect, it } from "vitest";

import { readDevicePosition } from "./self-check-in-position";

type Success = (position: {
  coords: { latitude: number; longitude: number; accuracy: number };
}) => void;
type Failure = (error: { code: number }) => void;

describe("readDevicePosition", () => {
  it("returns a rounded position when the device answers", async () => {
    const geolocation = {
      getCurrentPosition: (ok: Success) =>
        ok({ coords: { latitude: 49.18395412345, longitude: -2.1071421, accuracy: 11.6 } }),
    };

    await expect(readDevicePosition(geolocation)).resolves.toEqual({
      status: "ok",
      position: { latitude: 49.183954, longitude: -2.107142, accuracyMeters: 12 },
    });
  });

  it("rounds accuracy up so a 100.4 m reading cannot become 100 m", async () => {
    const geolocation = {
      getCurrentPosition: (ok: Success) => ok({ coords: { latitude: 49, longitude: -2, accuracy: 100.4 } }),
    };

    await expect(readDevicePosition(geolocation)).resolves.toEqual({
      status: "ok",
      position: { latitude: 49, longitude: -2, accuracyMeters: 101 },
    });
  });

  it("passes the high-accuracy, fresh browser request options", async () => {
    let options: unknown;
    let complete: Success | undefined;
    const geolocation = {
      getCurrentPosition: (ok: Success, _fail: Failure, receivedOptions: unknown) => {
        options = receivedOptions;
        complete = ok;
      },
    };

    const reading = readDevicePosition(geolocation);
    expect(options).toEqual({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
    complete?.({ coords: { latitude: 49, longitude: -2, accuracy: 5 } });
    await expect(reading).resolves.toMatchObject({ status: "ok" });
  });

  it("is denied on permission error code 1 and unavailable otherwise", async () => {
    await expect(
      readDevicePosition({ getCurrentPosition: (_ok: Success, fail: Failure) => fail({ code: 1 }) }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      readDevicePosition({ getCurrentPosition: (_ok: Success, fail: Failure) => fail({ code: 2 }) }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(readDevicePosition(undefined)).resolves.toEqual({ status: "unavailable" });
  });

  it("treats non-finite, out-of-range, or negative-accuracy readings as unavailable", async () => {
    for (const coords of [
      { latitude: Number.NaN, longitude: 0, accuracy: 5 },
      { latitude: 90.000001, longitude: 0, accuracy: 5 },
      { latitude: 0, longitude: -180.000001, accuracy: 5 },
      { latitude: 0, longitude: 0, accuracy: -1 },
    ]) {
      await expect(readDevicePosition({ getCurrentPosition: (ok: Success) => ok({ coords }) })).resolves.toEqual({
        status: "unavailable",
      });
    }
  });

  it("treats a synchronous browser exception as unavailable", async () => {
    await expect(
      readDevicePosition({
        getCurrentPosition: () => {
          throw new Error("browser unavailable");
        },
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
