import { describe, expect, it, vi } from "vitest";

import {
  createListNoShowPenaltiesHandler,
  createProposeNoShowPenaltiesHandler,
  createResolveNoShowPenaltyHandler,
  noShowPenaltyCallableOptions,
} from "./no-show-penalty-callables";
import { NoShowPenaltyError, type NoShowPenaltyService } from "./no-show-penalty-service";

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
      const handler = createListNoShowPenaltiesHandler({ service: penalties });

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

  describe("resolveNoShowPenalty", () => {
    it("is office-only and passes the parsed resolution through", async () => {
      const penalties = service();
      const handler = createResolveNoShowPenaltyHandler({ service: penalties });

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
      const handler = createResolveNoShowPenaltyHandler({ service: service() });
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
