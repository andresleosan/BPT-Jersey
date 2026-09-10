import { describe, expect, it } from "vitest";

import { bookingFailureMessage, cancellationFailureMessage } from "./booking-messages";

describe("booking messages", () => {
  it("maps capacity, financial, ineligible, auth and not-found", () => {
    expect(
      bookingFailureMessage({
        code: "functions/failed-precondition",
        details: { reason: "capacity" },
      }),
    ).toBe("This class is full.");
    expect(
      bookingFailureMessage({
        code: "functions/failed-precondition",
        details: { reason: "financial" },
      }),
    ).toBe("Your account can't book right now. Contact the academy.");
    expect(
      bookingFailureMessage({
        code: "functions/failed-precondition",
        details: { reason: "ineligible" },
      }),
    ).toBe("Your membership doesn't cover this class.");
    expect(bookingFailureMessage({ code: "functions/permission-denied" })).toBe(
      "You can't book for this member.",
    );
    expect(bookingFailureMessage({ code: "functions/not-found" })).toBe(
      "This class is no longer available.",
    );
    expect(bookingFailureMessage(new Error("boom"))).toBe("Couldn't book. Refresh and try again.");
  });

  it("maps cancellation failures", () => {
    expect(
      cancellationFailureMessage({
        code: "functions/failed-precondition",
        details: { reason: "ineligible" },
      }),
    ).toBe("This booking can't be cancelled online any more. Contact the academy.");
    expect(cancellationFailureMessage(new Error("boom"))).toBe(
      "Couldn't cancel. Refresh and try again.",
    );
  });
});
