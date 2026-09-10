import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("firebase/functions", () => ({ httpsCallable: api.httpsCallable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import { birthdayWhenLabel, listUpcomingBirthdays } from "./birthdays-client";

const birthday = {
  studentId: "student-1",
  displayName: "Ana Coelho",
  daysAway: 2,
  turningAge: 30,
  participantType: "adult",
  trainingCenter: "Town",
};

describe("birthdays client (T112)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.httpsCallable.mockReturnValue(api.invoke);
    api.invoke.mockResolvedValue({ data: { birthdays: [birthday] } });
  });

  it("calls the exact contract with the site and window the panel asked for", async () => {
    await expect(
      listUpcomingBirthdays({ trainingCenter: "West", windowDays: 7 }),
    ).resolves.toEqual([birthday]);
    // El tercer argumento no es decorativo: el callable se despliega con
    // consumeAppCheckToken, asi que sin token de un solo uso el servidor responde 401 y la
    // pantalla del coach se queda vacia sin decir por que. Visto en produccion el 2026-09-08.
    expect(api.httpsCallable).toHaveBeenCalledWith({}, "listUpcomingBirthdays", {
      limitedUseAppCheckTokens: true,
    });
    expect(api.invoke).toHaveBeenCalledWith({ trainingCenter: "West", windowDays: 7 });
  });

  it("rejects an incoherent or failed response with one safe error", async () => {
    for (const response of [
      undefined,
      null,
      [{ ...birthday, participantType: "child" }],
      [{ ...birthday, trainingCenter: "North" }],
      [{ ...birthday, daysAway: -1 }],
      [{ ...birthday, daysAway: 1.5 }],
      [{ studentId: "student-1" }],
    ]) {
      api.invoke.mockResolvedValueOnce({ data: { birthdays: response } });
      await expect(listUpcomingBirthdays({ windowDays: 7 })).rejects.toThrow(
        "Unable to load upcoming birthdays. Please try again.",
      );
    }
    api.invoke.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(listUpcomingBirthdays({ windowDays: 7 })).rejects.toThrow(
      "Unable to load upcoming birthdays. Please try again.",
    );
  });

  it("never invents a calendar date for the panel", () => {
    expect(birthdayWhenLabel(0)).toBe("Today");
    expect(birthdayWhenLabel(1)).toBe("Tomorrow");
    expect(birthdayWhenLabel(6)).toBe("In 6 days");
  });
});
