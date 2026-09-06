import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import {
  registerShopperAccountHandler,
  type ShopperRegistrationServices,
} from "./shopper-callables.js";

const now = "2026-09-06T10:00:00.000Z";

type Claims = Record<string, unknown>;

function services(
  initial: Claims | undefined,
  overrides: Partial<{
    setCustomUserClaims: (uid: string, claims: Claims) => Promise<void>;
    readBack: Claims | undefined;
  }> = {},
): ShopperRegistrationServices & {
  claims: () => Claims | undefined;
  audits: readonly Readonly<Record<string, unknown>>[];
} {
  let stored = initial;
  let reads = 0;
  const audits: Record<string, unknown>[] = [];
  return {
    academyId: "academy-1",
    now: () => now,
    claims: () => stored,
    audits,
    auth: {
      getUser: async (uid: string) => {
        reads += 1;
        const claims =
          reads > 1 && Object.hasOwn(overrides, "readBack") ? overrides.readBack : stored;
        return { uid, ...(claims === undefined ? {} : { customClaims: claims }) };
      },
      setCustomUserClaims: async (uid: string, claims: Claims) => {
        if (overrides.setCustomUserClaims) {
          await overrides.setCustomUserClaims(uid, claims);
          return;
        }
        stored = claims;
      },
    },
    firestore: {
      collection: (path: string) => ({
        doc: (id?: string) => ({ id: id ?? `${path}-generated` }),
      }),
      runTransaction: async <T>(
        updateFunction: (transaction: {
          create: (ref: { id: string }, data: Record<string, unknown>) => unknown;
        }) => Promise<T>,
      ): Promise<T> =>
        updateFunction({
          create: (_ref, data) => audits.push(data),
        }),
    },
  };
}

function request(auth: CallableRequest["auth"], data: unknown = null): CallableRequest<unknown> {
  return { auth, data } as unknown as CallableRequest<unknown>;
}

const signedIn = { uid: "visitor-1", token: {} } as unknown as CallableRequest["auth"];

describe("registerShopperAccountHandler", () => {
  it("gives a brand new account the shopper role in the configured academy", async () => {
    const registration = services(undefined);

    const result = await registerShopperAccountHandler(request(signedIn), registration);

    expect(result).toEqual({ academyId: "academy-1", role: "shopper" });
    expect(registration.claims()).toEqual({ academyId: "academy-1", role: "shopper" });
    expect(registration.audits).toHaveLength(1);
    expect(registration.audits[0]).toMatchObject({
      action: "client.role.self_assigned",
      academyId: "academy-1",
      actorId: "visitor-1",
      targetRef: "academies/academy-1/users/visitor-1",
    });
  });

  it("never overwrites a role the academy already granted", async () => {
    for (const role of [
      "guardian",
      "adultStudent",
      "coach",
      "headCoach",
      "administrator",
      "owner",
    ]) {
      const registration = services({ academyId: "academy-1", role });

      const result = await registerShopperAccountHandler(request(signedIn), registration);

      expect(result).toEqual({ academyId: "academy-1", role });
      expect(registration.claims()).toEqual({ academyId: "academy-1", role });
      expect(registration.audits).toHaveLength(0);
    }
  });

  it("is idempotent for an account that already self-registered", async () => {
    const registration = services({ academyId: "academy-1", role: "shopper" });

    const result = await registerShopperAccountHandler(request(signedIn), registration);

    expect(result).toEqual({ academyId: "academy-1", role: "shopper" });
    expect(registration.audits).toHaveLength(0);
  });

  it("refuses an account already scoped to another academy", async () => {
    const registration = services({ academyId: "other-academy" });

    await expect(
      registerShopperAccountHandler(request(signedIn), registration),
    ).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(registration.claims()).toEqual({ academyId: "other-academy" });
  });

  it("keeps unrelated claims that carry no authority", async () => {
    const registration = services({ locale: "en-GB" });

    await registerShopperAccountHandler(request(signedIn), registration);

    expect(registration.claims()).toEqual({
      locale: "en-GB",
      academyId: "academy-1",
      role: "shopper",
    });
  });

  it("requires a signed-in caller", async () => {
    await expect(
      registerShopperAccountHandler(request(undefined), services(undefined)),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects any payload", async () => {
    const registration = services(undefined);

    await expect(
      registerShopperAccountHandler(request(signedIn, { academyId: "other" }), registration),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(registration.claims()).toBeUndefined();
  });

  it("rolls the claim back when the write does not stick", async () => {
    const restore = vi.fn();
    const registration = services(undefined, { readBack: { academyId: "academy-1" } });
    const setCustomUserClaims = registration.auth.setCustomUserClaims;
    const spied = vi.fn(async (uid: string, claims: Record<string, unknown>) => {
      if (claims.role === "shopper") {
        await setCustomUserClaims(uid, claims);
        return;
      }
      restore(claims);
    });
    const guarded = { ...registration, auth: { ...registration.auth, setCustomUserClaims: spied } };

    await expect(registerShopperAccountHandler(request(signedIn), guarded)).rejects.toMatchObject({
      code: "internal",
    });
    expect(restore).toHaveBeenCalledWith({});
    expect(registration.audits).toHaveLength(0);
  });
});
