import { describe, expect, it, vi } from "vitest";

vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import { appCheckFailureMessage, isAppCheckFailure } from "./callable";

describe("isAppCheckFailure", () => {
  it("recognises the App Check errors a limited-use token request throws", () => {
    expect(
      isAppCheckFailure({
        code: "appCheck/initial-throttle",
        message: "AppCheck: 403 error. Attempts allowed again after 01d:00m:00s (appCheck/initial-throttle).",
      }),
    ).toBe(true);
    expect(isAppCheckFailure(new Error("AppCheck: throttled (appCheck/throttled)."))).toBe(true);
  });

  it("recognises the server refusing a request that went out without a token", () => {
    expect(isAppCheckFailure({ code: "functions/unauthenticated", message: "Unauthenticated" })).toBe(
      true,
    );
    expect(
      isAppCheckFailure({ code: "functions/permission-denied", message: "App Check token invalid" }),
    ).toBe(true);
    expect(
      isAppCheckFailure({ code: "functions/unauthenticated", message: "Verified App Check is required" }),
    ).toBe(true);
  });

  it("leaves every other failure alone", () => {
    expect(
      isAppCheckFailure({ code: "functions/unauthenticated", message: "Authentication is required" }),
    ).toBe(false);
    expect(isAppCheckFailure({ code: "functions/permission-denied", message: "Not allowed" })).toBe(
      false,
    );
    expect(isAppCheckFailure({ code: "functions/internal", message: "internal" })).toBe(false);
    expect(isAppCheckFailure(new Error("Unable to load the classes"))).toBe(false);
    expect(isAppCheckFailure("appCheck/throttled")).toBe(false);
    expect(isAppCheckFailure(null)).toBe(false);
  });

  it("offers a plain message that names no internals", () => {
    expect(appCheckFailureMessage).toBe("We couldn't verify this device. Try again in a moment.");
  });
});
