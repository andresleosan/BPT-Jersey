import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

// Each export keeps the options it was declared with, so the test reads them back per callable.
vi.mock("firebase-functions/v2/https", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase-functions/v2/https")>()),
  onCall: (options: unknown) => ({ options }),
}));

import { browserOrigins } from "../auth/callable-options.js";
import { scheduleCallableOptions, scheduleReadCallableOptions } from "./schedule-callable-options";
import * as callables from "./schedule-callables";

const reads = [
  "listScheduleCatalog",
  "listClasses",
  "listSessions",
  "getDailyOperationsDashboard",
  "listSessionBookedCounts",
  "listSessionBookings",
  "listStudentBookings",
  "listSessionAttendance",
  "listStudentAttendance",
  "listAttendanceHistory",
  "listSessionCheckouts",
  "getStudentCheckout",
  "getSessionOperationalView",
] as const;

const writes = ["cancelBooking", "copyWeek", "saveSession", "updateSession", "checkIn"] as const;

function optionsOf(name: string): unknown {
  return (Reflect.get(callables, name) as { options: unknown }).options;
}

describe("schedule callable options", () => {
  it("requires App Check on reads without consuming the token", () => {
    expect(scheduleReadCallableOptions).toEqual({
      cors: browserOrigins,
      invoker: "public",
      enforceAppCheck: true,
    });
    expect(scheduleReadCallableOptions).not.toHaveProperty("consumeAppCheckToken");
    expect(Object.isFrozen(scheduleReadCallableOptions)).toBe(true);
  });

  it("keeps consuming the token on writes", () => {
    expect(scheduleCallableOptions).toMatchObject({
      enforceAppCheck: true,
      consumeAppCheckToken: true,
    });
  });

  it.each(reads)("declares %s with the read options", (name) => {
    expect(optionsOf(name)).toBe(scheduleReadCallableOptions);
  });

  it.each(writes)("declares %s with the consuming options", (name) => {
    expect(optionsOf(name)).toBe(scheduleCallableOptions);
  });

  it("keeps the operator's deploy wrapper in step with the read callables", () => {
    const script = readFileSync(
      new URL("../../scripts/deploy-schedule-read-functions.sh", import.meta.url),
      "utf8",
    );
    const listed = /readonly functions=\(([^)]*)\)/u.exec(script)![1]!.trim().split(/\s+/u);
    expect([...listed].sort()).toEqual([...reads].sort());
  });
});
