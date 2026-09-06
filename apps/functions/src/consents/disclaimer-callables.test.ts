import { describe, expect, it, vi } from "vitest";

import {
  createAcceptDisclaimerHandler,
  createGetOutstandingDisclaimersHandler,
  createListDisclaimersHandler,
  createPublishDisclaimerHandler,
  createWithdrawDisclaimerAcceptanceHandler,
  createWithdrawDisclaimerHandler,
  disclaimerClientCallableOptions,
} from "./disclaimer-callables";
import { DisclaimerError, type DisclaimerService } from "./disclaimer-service";

function fakeRequest(data: unknown, role = "owner", uid = "office-1") {
  return { auth: { uid, token: { academyId: "academy-1", role } }, data } as never;
}

function service(overrides: Partial<DisclaimerService> = {}): DisclaimerService {
  return {
    publishDisclaimer: vi.fn().mockResolvedValue({ disclaimerId: "photo-consent__v1" }),
    withdrawDisclaimer: vi.fn().mockResolvedValue({ disclaimerId: "photo-consent__v1" }),
    listDisclaimers: vi.fn().mockResolvedValue([]),
    getOutstandingDisclaimers: vi.fn().mockResolvedValue([]),
    acceptDisclaimer: vi.fn().mockResolvedValue({ acceptanceId: "a-1" }),
    withdrawAcceptance: vi.fn().mockResolvedValue({ acceptanceId: "a-1" }),
    ...overrides,
  } as unknown as DisclaimerService;
}

const publication = {
  key: "photo-consent",
  versionLabel: "v1",
  title: "Photography at open mat",
  body: "Synthetic placeholder body for the pilot.",
  audience: "all",
  required: true,
  effectiveAt: "2026-09-01T00:00:00.000Z",
};

const acceptance = {
  disclaimerId: "photo-consent__v1",
  studentId: "student-1",
  contentHash: "a".repeat(64),
};

describe("disclaimer callables (T117)", () => {
  it("requires App Check on the client callables", () => {
    expect(disclaimerClientCallableOptions).toEqual({ enforceAppCheck: true });
  });

  describe("publishDisclaimer", () => {
    it("passes office's parsed publication through with the actor attached", async () => {
      const disclaimers = service();
      await createPublishDisclaimerHandler({ service: disclaimers })(fakeRequest(publication));
      expect(disclaimers.publishDisclaimer).toHaveBeenCalledWith({
        academyId: "academy-1",
        actorId: "office-1",
        input: publication,
      });
    });

    it("refuses every role but office, coaches included", async () => {
      const handler = createPublishDisclaimerHandler({ service: service() });
      for (const role of ["headCoach", "coach", "guardian", "adultStudent"]) {
        await expect(handler(fakeRequest(publication, role, "other-1"))).rejects.toMatchObject({
          code: "permission-denied",
        });
      }
      await expect(
        handler(fakeRequest(publication, "administrator", "admin-1")),
      ).resolves.toBeDefined();
    });

    it("refuses a payload that carries a derived field or a bad audience", async () => {
      const handler = createPublishDisclaimerHandler({ service: service() });
      for (const payload of [
        { ...publication, contentHash: "a".repeat(64) },
        { ...publication, status: "published" },
        { ...publication, audience: "coaches" },
        { ...publication, key: "Photo Consent" },
        null,
        {},
      ]) {
        await expect(handler(fakeRequest(payload))).rejects.toMatchObject({
          code: "invalid-argument",
        });
      }
    });
  });

  describe("withdrawDisclaimer and listDisclaimers", () => {
    it("take exactly what they need and stay office-only", async () => {
      const disclaimers = service();
      await createWithdrawDisclaimerHandler({ service: disclaimers })(
        fakeRequest({ disclaimerId: "photo-consent__v1" }),
      );
      expect(disclaimers.withdrawDisclaimer).toHaveBeenCalledWith(
        expect.objectContaining({ disclaimerId: "photo-consent__v1", actorId: "office-1" }),
      );

      await createListDisclaimersHandler({ service: disclaimers })(fakeRequest(null));
      expect(disclaimers.listDisclaimers).toHaveBeenCalledWith({ academyId: "academy-1" });

      const withdraw = createWithdrawDisclaimerHandler({ service: service() });
      await expect(
        withdraw(fakeRequest({ disclaimerId: "x" }, "guardian", "g-1")),
      ).rejects.toMatchObject({ code: "permission-denied" });
      for (const payload of [null, {}, { disclaimerId: "x", extra: 1 }]) {
        await expect(withdraw(fakeRequest(payload))).rejects.toMatchObject({
          code: "invalid-argument",
        });
      }
      await expect(
        createListDisclaimersHandler({ service: service() })(fakeRequest({ any: 1 })),
      ).rejects.toMatchObject({ code: "invalid-argument" });
    });
  });

  describe("the participant's side", () => {
    it("reads the outstanding list for one participant only", async () => {
      const disclaimers = service();
      await createGetOutstandingDisclaimersHandler({ service: disclaimers })(
        fakeRequest({ studentId: "student-1" }, "adultStudent", "adult-1"),
      );
      expect(disclaimers.getOutstandingDisclaimers).toHaveBeenCalledWith({
        academyId: "academy-1",
        actorId: "adult-1",
        role: "adultStudent",
        studentId: "student-1",
      });
    });

    it("is closed to staff, who have their own list with counts instead", async () => {
      const handler = createGetOutstandingDisclaimersHandler({ service: service() });
      for (const role of ["owner", "administrator", "headCoach", "coach"]) {
        await expect(
          handler(fakeRequest({ studentId: "student-1" }, role, "staff-1")),
        ).rejects.toMatchObject({ code: "permission-denied" });
      }
    });

    it("accepts with the hash the participant was shown", async () => {
      const disclaimers = service();
      await createAcceptDisclaimerHandler({ service: disclaimers })(
        fakeRequest(acceptance, "guardian", "guardian-1"),
      );
      expect(disclaimers.acceptDisclaimer).toHaveBeenCalledWith({
        academyId: "academy-1",
        actorId: "guardian-1",
        role: "guardian",
        input: acceptance,
      });
    });

    it("refuses an acceptance without a hash or with an extra field", async () => {
      const handler = createAcceptDisclaimerHandler({ service: service() });
      for (const payload of [
        { disclaimerId: "photo-consent__v1", studentId: "student-1" },
        { ...acceptance, acceptedBy: "someone-else" },
        { ...acceptance, contentHash: "short" },
        null,
      ]) {
        await expect(
          handler(fakeRequest(payload, "adultStudent", "adult-1")),
        ).rejects.toMatchObject({ code: "invalid-argument" });
      }
    });

    it("withdraws an acceptance by id and nothing else", async () => {
      const disclaimers = service();
      await createWithdrawDisclaimerAcceptanceHandler({ service: disclaimers })(
        fakeRequest({ acceptanceId: "a-1" }, "adultStudent", "adult-1"),
      );
      expect(disclaimers.withdrawAcceptance).toHaveBeenCalledWith(
        expect.objectContaining({ acceptanceId: "a-1", actorId: "adult-1" }),
      );
      await expect(
        createWithdrawDisclaimerAcceptanceHandler({ service: service() })(
          fakeRequest({ acceptanceId: "a-1", reason: "no" }, "adultStudent", "adult-1"),
        ),
      ).rejects.toMatchObject({ code: "invalid-argument" });
    });
  });

  it("maps a stale hash to its own code, not to a generic failure", async () => {
    const handler = createAcceptDisclaimerHandler({
      service: service({
        acceptDisclaimer: vi
          .fn()
          .mockRejectedValue(new DisclaimerError("stale", "internal disclaimer detail")),
      }),
    });
    const rejection = (await handler(fakeRequest(acceptance, "adultStudent", "adult-1")).catch(
      (error: unknown) => error,
    )) as { code: string; message: string };
    expect(rejection.code).toBe("aborted");
    expect(rejection.message).toContain("must be read again");
    expect(rejection.message).not.toContain("internal disclaimer detail");
  });

  it("maps every other store failure to a safe code without leaking its detail", async () => {
    const cases = [
      { code: "denied" as const, expected: "permission-denied" },
      { code: "tenant" as const, expected: "permission-denied" },
      { code: "conflict" as const, expected: "failed-precondition" },
      { code: "not-found" as const, expected: "not-found" },
      { code: "invalid" as const, expected: "invalid-argument" },
    ];
    for (const { code, expected } of cases) {
      const handler = createPublishDisclaimerHandler({
        service: service({
          publishDisclaimer: vi
            .fn()
            .mockRejectedValue(new DisclaimerError(code, "internal disclaimer detail")),
        }),
      });
      const rejection = (await handler(fakeRequest(publication)).catch(
        (error: unknown) => error,
      )) as { code: string; message: string };
      expect(rejection.code, code).toBe(expected);
      expect(rejection.message).not.toContain("internal disclaimer detail");
    }
  });
});
