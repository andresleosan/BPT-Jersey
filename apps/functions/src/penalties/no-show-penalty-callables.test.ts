import { describe, expect, it, vi } from "vitest";

import {
  createListNoShowPenaltiesHandler,
  createProposeNoShowPenaltiesHandler,
  createResolveNoShowPenaltyHandler,
  noShowPenaltyCallableOptions,
} from "./no-show-penalty-callables";
import { NoShowPenaltyError, type NoShowPenaltyService } from "./no-show-penalty-service";
import type { PermissionGrantService } from "../staff/permission-grant-service";

/**
 * T116 wired the office queue to the delegated-permission gate. `denyAll` reproduces the behaviour
 * before that change - nobody holds a grant - so every assertion below still measures the role rule
 * on its own.
 */
function denyAll(): PermissionGrantService {
  return {
    grantPermission: vi.fn(),
    revokePermission: vi.fn(),
    listPermissionGrants: vi.fn().mockResolvedValue([]),
    evaluatePermission: vi
      .fn()
      .mockResolvedValue({ allowed: false, grantId: null, reason: "No live grant" }),
  } as unknown as PermissionGrantService;
}

function allowGrant(grantId = "grant-1"): PermissionGrantService {
  return {
    ...denyAll(),
    evaluatePermission: vi
      .fn()
      .mockResolvedValue({ allowed: true, grantId, reason: "Granted by owner-1" }),
  } as unknown as PermissionGrantService;
}

function fakeRequest(data: unknown, role = "owner", uid = "office-1") {
  return { auth: { uid, token: { academyId: "academy-1", role } }, data } as never;
}

function service(overrides: Partial<NoShowPenaltyService> = {}): NoShowPenaltyService {
  return {
    proposeNoShowPenalties: vi
      .fn()
      .mockResolvedValue({ sessionId: "session-1", proposed: [], skipped: [], alreadyProposed: 0 }),
    listNoShowPenalties: vi.fn().mockResolvedValue([]),
    resolveNoShowPenalty: vi.fn().mockResolvedValue({ penaltyId: "session-1__student-1" }),
    ...overrides,
  };
}

const reason = "Charged after office reviewed the absence.";

describe("no-show penalty callables (T111)", () => {
  it("requires and consumes App Check on every penalty callable", () => {
    expect(noShowPenaltyCallableOptions).toEqual({
      cors: ["https://bptjersey.pages.dev"],
      invoker: "public",
      enforceAppCheck: true,
      consumeAppCheckToken: true,
    });
  });

  describe("proposeNoShowPenalties", () => {
    it("lets any staff role propose for a session they operated", async () => {
      for (const role of ["owner", "administrator", "headCoach", "coach"]) {
        const penalties = service();
        await createProposeNoShowPenaltiesHandler({ service: penalties })(
          fakeRequest({ sessionId: "session-1" }, role, "staff-1"),
        );
        expect(penalties.proposeNoShowPenalties).toHaveBeenCalledWith({
          academyId: "academy-1",
          sessionId: "session-1",
          actorId: "staff-1",
        });
      }
    });

    it.each(["guardian", "adultStudent"])("refuses %s", async (role) => {
      await expect(
        createProposeNoShowPenaltiesHandler({ service: service() })(
          fakeRequest({ sessionId: "session-1" }, role, "client-1"),
        ),
      ).rejects.toMatchObject({ code: "permission-denied" });
    });

    it("refuses a malformed payload", async () => {
      const handler = createProposeNoShowPenaltiesHandler({ service: service() });
      for (const payload of [null, {}, { sessionId: "" }, { sessionId: "s", extra: 1 }]) {
        await expect(handler(fakeRequest(payload))).rejects.toMatchObject({
          code: "invalid-argument",
        });
      }
    });
  });

  describe("listNoShowPenalties", () => {
    it("is office-only and accepts an optional status filter", async () => {
      const penalties = service();
      const handler = createListNoShowPenaltiesHandler({
        service: penalties,
        permissions: denyAll(),
      });

      await handler(fakeRequest(null));
      expect(penalties.listNoShowPenalties).toHaveBeenCalledWith({ academyId: "academy-1" });

      await handler(fakeRequest({ status: "proposed" }));
      expect(penalties.listNoShowPenalties).toHaveBeenLastCalledWith({
        academyId: "academy-1",
        status: "proposed",
      });

      for (const role of ["headCoach", "coach", "guardian", "adultStudent"]) {
        await expect(handler(fakeRequest(null, role, "other-1"))).rejects.toMatchObject({
          code: "permission-denied",
        });
      }
      for (const payload of [{ status: "unknown" }, { status: "proposed", extra: 1 }]) {
        await expect(handler(fakeRequest(payload))).rejects.toMatchObject({
          code: "invalid-argument",
        });
      }
    });
  });

  describe("delegated access to the office queue (T116)", () => {
    it("lets a coach holding a live grant read and resolve, without changing their role", async () => {
      const penalties = service();
      const request = fakeRequest(null, "coach", "coach-1");
      await createListNoShowPenaltiesHandler({
        service: penalties,
        permissions: allowGrant(),
      })(request);
      expect(penalties.listNoShowPenalties).toHaveBeenCalledWith({ academyId: "academy-1" });
      // The claim the coach signed in with is untouched by the grant.
      expect((request as unknown as { auth: { token: { role: string } } }).auth.token.role).toBe(
        "coach",
      );

      await createResolveNoShowPenaltyHandler({
        service: penalties,
        permissions: allowGrant(),
      })(
        fakeRequest(
          { penaltyId: "session-1__student-1", decision: "waive", reason },
          "coach",
          "coach-1",
        ),
      );
      expect(penalties.resolveNoShowPenalty).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: "coach-1" }),
      );
    });

    it("still refuses the same coach the moment the grant is gone", async () => {
      const handler = createListNoShowPenaltiesHandler({
        service: service(),
        permissions: denyAll(),
      });
      await expect(handler(fakeRequest(null, "coach", "coach-1"))).rejects.toMatchObject({
        code: "permission-denied",
      });
    });

    it("never consults the grant store for a role that was already allowed", async () => {
      const permissions = allowGrant();
      await createListNoShowPenaltiesHandler({ service: service(), permissions })(
        fakeRequest(null, "owner", "office-1"),
      );
      // Office reaches the queue by role, so a grant-store outage can never lock office out.
      expect(permissions.evaluatePermission).not.toHaveBeenCalled();
    });

    it("does not let a grant reach a client role", async () => {
      // A guardian is not staff; a grant is only ever issued to a coach, and the store answering
      // "allowed" for one would still be a bug, so the gate is asserted end to end here.
      const handler = createListNoShowPenaltiesHandler({
        service: service(),
        permissions: denyAll(),
      });
      for (const role of ["guardian", "adultStudent"]) {
        await expect(handler(fakeRequest(null, role, "client-1"))).rejects.toMatchObject({
          code: "permission-denied",
        });
      }
    });
  });

  describe("resolveNoShowPenalty", () => {
    it("is office-only and passes the parsed resolution through", async () => {
      const penalties = service();
      const handler = createResolveNoShowPenaltyHandler({
        service: penalties,
        permissions: denyAll(),
      });

      await handler(
        fakeRequest({
          penaltyId: "session-1__student-1",
          decision: "charge",
          reason,
          invoiceId: "invoice-1",
        }),
      );
      expect(penalties.resolveNoShowPenalty).toHaveBeenCalledWith({
        academyId: "academy-1",
        actorId: "office-1",
        resolution: {
          penaltyId: "session-1__student-1",
          decision: "charge",
          reason,
          invoiceId: "invoice-1",
        },
      });

      for (const role of ["headCoach", "coach", "guardian", "adultStudent"]) {
        await expect(
          handler(
            fakeRequest(
              { penaltyId: "session-1__student-1", decision: "waive", reason },
              role,
              "x",
            ),
          ),
        ).rejects.toMatchObject({ code: "permission-denied" });
      }
    });

    it("refuses an invoice on a waiver and a reason that is too short", async () => {
      const handler = createResolveNoShowPenaltyHandler({
        service: service(),
        permissions: denyAll(),
      });
      for (const payload of [
        { penaltyId: "session-1__student-1", decision: "waive", reason, invoiceId: "invoice-1" },
        { penaltyId: "session-1__student-1", decision: "charge", reason: "no" },
        { penaltyId: "session-1__student-1", decision: "delete", reason },
      ]) {
        await expect(handler(fakeRequest(payload))).rejects.toMatchObject({
          code: "invalid-argument",
        });
      }
    });

    it("maps a store error to a safe code without leaking its detail", async () => {
      const cases = [
        { code: "conflict" as const, expected: "failed-precondition" },
        { code: "not-found" as const, expected: "not-found" },
        { code: "tenant" as const, expected: "permission-denied" },
        { code: "invalid" as const, expected: "invalid-argument" },
      ];
      for (const { code, expected } of cases) {
        const handler = createResolveNoShowPenaltyHandler({
          service: service({
            resolveNoShowPenalty: vi
              .fn()
              .mockRejectedValue(new NoShowPenaltyError(code, "internal penalty detail")),
          }),
          permissions: denyAll(),
        });
        const rejection = (await handler(
          fakeRequest({ penaltyId: "session-1__student-1", decision: "waive", reason }),
        ).then(
          () => undefined,
          (error: unknown) => error,
        )) as { code: string; message: string } | undefined;
        expect(rejection?.code, code).toBe(expected);
        expect(rejection?.message).not.toContain("internal penalty detail");
      }
    });
  });
});
