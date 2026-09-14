import { describe, expect, it } from "vitest";

import { positionFailureMessage, selfCheckInFailureMessage } from "./self-check-in-messages";

const refusal = (reason: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error("x"), { code: "functions/failed-precondition", details: { reason, ...extra } });

describe("self check-in messages", () => {
  it("turns each refusal into one plain sentence", () => {
    expect(selfCheckInFailureMessage(refusal("outside", { distanceMeters: 120 }))).toBe(
      "You're 120 m away. Get to the gym and try again.",
    );
    expect(selfCheckInFailureMessage(refusal("imprecise"))).toBe(
      "Your location isn't precise enough yet. Turn on Precise Location, step near the entrance and try again.",
    );
    expect(selfCheckInFailureMessage(refusal("site_not_ready"))).toBe(
      "This gym can't take self check-ins yet. Ask a coach to check you in.",
    );
    expect(selfCheckInFailureMessage(refusal("window_closed"))).toBe("Check-in for this class has closed.");
    expect(selfCheckInFailureMessage(refusal("not_booked"))).toBe(
      "You need a confirmed booking for this class.",
    );
    expect(selfCheckInFailureMessage(refusal("already_checked_in"))).toBe("You're already checked in.");
    expect(selfCheckInFailureMessage(new Error("boom"))).toBe(
      "Couldn't check you in. Try again or ask a coach.",
    );
    expect(
      selfCheckInFailureMessage(Object.assign(new Error("x"), { code: "functions/permission-denied" })),
    ).toBe("Couldn't check you in. Try again or ask a coach.");
  });

  it("uses the generic outside message unless distance is a finite nonnegative integer", () => {
    for (const distanceMeters of [undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(selfCheckInFailureMessage(refusal("outside", { distanceMeters }))).toBe(
        "You're too far from the gym. Get to the gym and try again.",
      );
    }
  });

  it("explains a missing position", () => {
    expect(positionFailureMessage("denied")).toBe(
      "Location is off. Allow it for this site, or ask a coach to check you in.",
    );
    expect(positionFailureMessage("unavailable")).toBe(
      "Couldn't read your location. Try again outside, or ask a coach to check you in.",
    );
  });
});
