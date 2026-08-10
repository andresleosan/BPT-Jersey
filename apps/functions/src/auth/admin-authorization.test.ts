import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { describe, expect, it } from "vitest";

import {
  assertAcademyScope,
  getRegyfitProjectionScope,
  requireAdminActor,
} from "./admin-authorization.js";

function requestWithAuth(uid: string, token: Record<string, unknown>): CallableRequest {
  return {
    auth: { uid, token },
  } as CallableRequest;
}

describe("admin authorization boundary", () => {
  it("rejects a request without authentication", () => {
    expect(() => requireAdminActor({} as CallableRequest)).toThrowError(
      expect.objectContaining({ code: "unauthenticated" }),
    );
  });

  it("rejects missing or invalid administrative claims", () => {
    expect(() => requireAdminActor(requestWithAuth("user-1", {}))).toThrowError(
      expect.objectContaining({ code: "permission-denied" }),
    );
    expect(() =>
      requireAdminActor(requestWithAuth("user-1", { academyId: "academy-1", role: "coach" })),
    ).toThrowError(expect.objectContaining({ code: "permission-denied" }));
  });

  it("accepts representative Firebase standard and profile claims", () => {
    const actor = requireAdminActor(
      requestWithAuth("owner-1", {
        iss: "https://securetoken.google.com/demo-bpt-jersey",
        aud: "demo-bpt-jersey",
        auth_time: 1_754_633_600,
        user_id: "owner-1",
        sub: "owner-1",
        iat: 1_754_633_600,
        exp: 1_754_637_200,
        firebase: { sign_in_provider: "google.com", sign_in_second_factor: "totp" },
        uid: "owner-1",
        tenant: "tenant-synthetic",
        name: "Synthetic Owner",
        picture: "https://example.test/avatar.png",
        email: "owner@example.test",
        email_verified: true,
        phone_number: "+15555550100",
        phone_number_verified: true,
        academyId: "academy-1",
        role: "owner",
      }),
    );

    expect(actor).toEqual({ uid: "owner-1", academyId: "academy-1", role: "owner" });
  });

  it("rejects an administrative token without Firebase MFA evidence", () => {
    expect(() =>
      requireAdminActor(requestWithAuth("owner-1", { academyId: "academy-1", role: "owner" })),
    ).toThrowError(expect.objectContaining({ code: "permission-denied" }));
  });

  it("rejects an mfaEnrolled custom claim without Firebase MFA evidence", () => {
    expect(() =>
      requireAdminActor(
        requestWithAuth("owner-1", {
          academyId: "academy-1",
          role: "owner",
          mfaEnrolled: true,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "permission-denied" }));
  });

  it("rejects a non-TOTP Firebase second factor", () => {
    expect(() =>
      requireAdminActor(
        requestWithAuth("administrator-1", {
          academyId: "academy-1",
          role: "administrator",
          firebase: { sign_in_second_factor: "password" },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "permission-denied" }));
  });

  it("accepts owner and administrator tokens with Firebase TOTP evidence", () => {
    for (const [uid, role] of [
      ["owner-1", "owner"],
      ["administrator-1", "administrator"],
    ] as const) {
      expect(
        requireAdminActor(
          requestWithAuth(uid, {
            academyId: "academy-1",
            role,
            firebase: { sign_in_second_factor: "totp" },
          }),
        ),
      ).toEqual({ uid, academyId: "academy-1", role });
    }
  });

  it("rejects unknown custom claim keys", () => {
    expect(() =>
      requireAdminActor(
        requestWithAuth("owner-1", {
          iss: "https://securetoken.google.com/demo-bpt-jersey",
          aud: "demo-bpt-jersey",
          sub: "owner-1",
          academyId: "academy-1",
          role: "owner",
          tenantOverride: "academy-2",
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "permission-denied" }));
  });

  it("returns an immutable actor and enforces the academy scope", () => {
    const actor = requireAdminActor(
      requestWithAuth("owner-1", {
        academyId: "academy-1",
        role: "owner",
        firebase: { sign_in_second_factor: "totp" },
      }),
    );

    expect(actor).toEqual({ uid: "owner-1", academyId: "academy-1", role: "owner" });
    expect(Object.isFrozen(actor)).toBe(true);
    expect(() => assertAcademyScope(actor, "academy-2")).toThrowError(
      expect.objectContaining({ code: "permission-denied" }),
    );
    expect(() => assertAcademyScope(actor, "academy-1")).not.toThrow();
  });

  it("keeps owner data restricted and administrator data safe", () => {
    expect(getRegyfitProjectionScope("owner")).toBe("restricted");
    expect(getRegyfitProjectionScope("administrator")).toBe("safe");
  });

  it("uses Firebase callable errors for authorization failures", () => {
    try {
      requireAdminActor({ auth: { uid: "user-1", token: {} } } as CallableRequest);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpsError);
      return;
    }

    throw new Error("Expected authorization to fail");
  });
});
