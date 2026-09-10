import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { describe, expect, it } from "vitest";

import type { AcademyId, UserActorContext, UserId } from "@bpt-jersey/domain";
import type { AccessEvaluationInput } from "@bpt-jersey/domain/authorization/access-policy";

import { requireAuthorizedAccess, requireUserActor } from "./user-authorization.js";

function requestWithAuth(uid: string, token: Record<string, unknown>): CallableRequest {
  return { auth: { uid, token } } as CallableRequest;
}

const ownerActor: UserActorContext = Object.freeze({
  kind: "user",
  userId: "owner-1" as UserId,
  academyId: "academy-1" as AcademyId,
  role: "owner",
});
const userRoles = Object.freeze([
  "owner",
  "administrator",
  "headCoach",
  "coach",
  "guardian",
  "adultStudent",
] as const);

function accessInput(actorActive = true): AccessEvaluationInput {
  return {
    actor: ownerActor,
    requirement: {
      operation: "read",
      classification: "Internal",
      allowedRoles: ["owner"],
      scope: "academy",
      purpose: "academy operations",
    },
    resource: {
      resourceId: "resource-1",
      academyId: "academy-1" as AcademyId,
      classification: "Internal",
    },
    facts: { actorActive },
    nowMs: 200,
  };
}

describe("user authorization boundary", () => {
  it("rejects requests with a missing or blank Firebase UID", () => {
    expect(() => requireUserActor({} as CallableRequest)).toThrowError(
      expect.objectContaining({ code: "unauthenticated" }),
    );
    expect(() => requireUserActor(requestWithAuth(" ", {}))).toThrowError(
      expect.objectContaining({ code: "unauthenticated" }),
    );
  });

  it("rejects missing, malformed, and unknown role claims", () => {
    for (const token of [
      {},
      { academyId: "academy-1" },
      { academyId: " ", role: "guardian" },
      { academyId: "academy-1", role: "minor" },
    ]) {
      expect(() => requireUserActor(requestWithAuth("user-1", token))).toThrowError(
        expect.objectContaining({ code: "permission-denied" }),
      );
    }
  });

  it("returns a frozen actor for every authenticated MVP role", () => {
    for (const role of userRoles) {
      const currentActor = requireUserActor(
        requestWithAuth(`${role}-1`, { academyId: "academy-1", role }),
      );

      expect(currentActor).toEqual({
        kind: "user",
        userId: `${role}-1`,
        academyId: "academy-1",
        role,
      });
      expect(Object.isFrozen(currentActor)).toBe(true);
    }
  });

  it("ignores only representative Firebase and approved profile claims", () => {
    const currentActor = requireUserActor(
      requestWithAuth("guardian-1", {
        iss: "https://securetoken.google.com/demo-bpt-jersey",
        aud: "demo-bpt-jersey",
        auth_time: 1_754_633_600,
        user_id: "guardian-1",
        sub: "guardian-1",
        iat: 1_754_633_600,
        exp: 1_754_637_200,
        firebase: { sign_in_provider: "google.com" },
        uid: "guardian-1",
        tenant: "tenant-synthetic",
        name: "Synthetic Guardian",
        picture: "https://example.test/avatar.png",
        email: "guardian@example.test",
        email_verified: true,
        phone_number: "+15555550100",
        phone_number_verified: true,
        mfaEnrolled: false,
        locale: "en-GB",
        academyId: "academy-1",
        role: "guardian",
      }),
    );

    expect(currentActor).toEqual({
      kind: "user",
      userId: "guardian-1",
      academyId: "academy-1",
      role: "guardian",
    });
  });

  it("rejects an unknown enumerable custom claim", () => {
    expect(() =>
      requireUserActor(
        requestWithAuth("guardian-1", {
          academyId: "academy-1",
          role: "guardian",
          tenantOverride: "academy-2",
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "permission-denied" }));
  });

  it("rejects an unknown non-enumerable custom claim", () => {
    const token: Record<string, unknown> = { academyId: "academy-1", role: "guardian" };
    Object.defineProperty(token, "familyId", { value: "family-1", enumerable: false });

    expect(() => requireUserActor(requestWithAuth("guardian-1", token))).toThrowError(
      expect.objectContaining({ code: "permission-denied" }),
    );
  });

  it("rejects authority claims inherited from the token prototype", () => {
    const token = Object.create({ academyId: "academy-1", role: "guardian" }) as Record<
      string,
      unknown
    >;

    expect(() => requireUserActor(requestWithAuth("guardian-1", token))).toThrowError(
      expect.objectContaining({ code: "permission-denied" }),
    );
  });

  it("returns the immutable grant from a valid backend policy evaluation", () => {
    const grant = requireAuthorizedAccess(accessInput());

    expect(grant).toEqual({
      actor: ownerActor,
      resourceId: "resource-1",
      operation: "read",
      classification: "Internal",
      scope: "academy",
      purpose: "academy operations",
    });
    expect(Object.isFrozen(grant)).toBe(true);
  });

  it("maps every internal denial to one generic Firebase callable error", () => {
    try {
      requireAuthorizedAccess(accessInput(false));
    } catch (error) {
      expect(error).toBeInstanceOf(HttpsError);
      expect(error).toMatchObject({
        code: "permission-denied",
        message: "Access is not permitted",
      });
      expect(String(error)).not.toContain("ACTOR_INACTIVE");
      return;
    }

    throw new Error("Expected access denial");
  });
});
