import { describe, expect, it } from "vitest";

import { adminSessionForTestRole, isAdminE2EEnabled } from "./admin-test-bootstrap";

describe("controlled admin E2E bootstrap", () => {
  it.each(["127.0.0.1", "localhost", "::1", "[::1]"])(
    "requires a loopback hostname for %s",
    (hostname) => {
      expect(isAdminE2EEnabled(hostname, true)).toBe(true);
    },
  );

  it.each(["academy.example.test", "192.0.2.10", ""])(
    "rejects non-loopback hostname %s even when the flag is baked",
    (hostname) => {
      expect(isAdminE2EEnabled(hostname, true)).toBe(false);
    },
  );

  it("rejects a runtime flag when it was not baked into the build", () => {
    expect(isAdminE2EEnabled("127.0.0.1", false)).toBe(false);
  });

  it("builds a clearly synthetic session for the requested role", () => {
    const session = adminSessionForTestRole("administrator");

    expect(session).toEqual({
      uid: "synthetic-admin-administrator",
      email: "administrator@example.test",
      displayName: "Synthetic administrator",
      academyId: "synthetic-academy",
      role: "administrator",
    });
    expect(Object.isFrozen(session)).toBe(true);
  });
});
