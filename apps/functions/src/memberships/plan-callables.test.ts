import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import { PLAN_CATALOG, type PlanRecord } from "@bpt-jersey/domain/memberships";

import {
  activatePlanHandler,
  deactivatePlanHandler,
  getPlanHandler,
  listPlansHandler,
  savePlanHandler,
  type PlanCallableServices,
} from "./plan-callables.js";

const now = "2026-08-19T10:00:00.000Z";

function record(plan = PLAN_CATALOG[0]!, overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    ...plan,
    academyId: "academy-1",
    active: true,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "creator-1",
    updatedAt: now,
    updatedBy: "creator-1",
    ...overrides,
  };
}

function request(
  data: unknown,
  role: string | undefined = undefined,
  uid = "actor-1",
  academyId = "academy-1",
): CallableRequest<unknown> {
  return {
    data,
    auth: role === undefined ? undefined : { uid, token: { academyId, role } },
  } as unknown as CallableRequest<unknown>;
}

function services(): PlanCallableServices & {
  store: NonNullable<PlanCallableServices["store"]>;
} {
  return {
    store: {
      listPlans: vi.fn(async () => [record()]),
      getPlan: vi.fn(async () => record()),
      savePlan: vi.fn(async () => record()),
      deactivatePlan: vi.fn(async () => record(undefined, { active: false })),
      activatePlan: vi.fn(async () => record()),
      seedPlanCatalog: vi.fn(async () => []),
    },
    now: () => now,
  };
}

const editablePlan = { ...PLAN_CATALOG[0]! };
const publicPlan = { ...editablePlan };

describe("membership plan callables", () => {
  it("allows every authenticated role to list active public plans", async () => {
    for (const role of [
      "owner",
      "administrator",
      "guardian",
      "adultStudent",
      "headCoach",
      "coach",
    ]) {
      const current = services();
      await expect(listPlansHandler(request(null, role), current)).resolves.toEqual([publicPlan]);
      expect(current.store.listPlans).toHaveBeenCalledWith("academy-1");
    }
  });

  it("rejects anonymous and unsupported roles before reading the store", async () => {
    const current = services();
    await expect(listPlansHandler(request(null), current)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(listPlansHandler(request(null, "reception"), current)).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(current.store.listPlans).not.toHaveBeenCalled();
  });

  it("accepts no client fields for list and rejects authority payloads", async () => {
    const current = services();
    await expect(listPlansHandler(request(undefined, "owner"), current)).resolves.toEqual([
      publicPlan,
    ]);
    await expect(
      listPlansHandler(request({ academyId: "academy-2" }, "owner"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(current.store.listPlans).toHaveBeenCalledTimes(1);
  });

  it("returns only active public plans and maps missing plans to a safe result", async () => {
    const current = services();
    vi.mocked(current.store.listPlans).mockResolvedValueOnce([
      record(PLAN_CATALOG[1]!, { active: false }),
      record(PLAN_CATALOG[0]!),
    ]);
    await expect(listPlansHandler(request(null, "owner"), current)).resolves.toEqual([publicPlan]);

    vi.mocked(current.store.getPlan).mockResolvedValueOnce(undefined);
    await expect(
      getPlanHandler(request({ planId: "payg" }, "guardian"), current),
    ).rejects.toMatchObject({ code: "failed-precondition", message: "Plan is not available" });
    vi.mocked(current.store.getPlan).mockResolvedValueOnce(record(undefined, { active: false }));
    await expect(
      getPlanHandler(request({ planId: "payg" }, "guardian"), current),
    ).rejects.toMatchObject({ code: "failed-precondition", message: "Plan is not available" });
  });

  it("allows every authenticated role to get an active public plan with an exact ID payload", async () => {
    for (const role of [
      "owner",
      "administrator",
      "guardian",
      "adultStudent",
      "headCoach",
      "coach",
    ]) {
      const current = services();
      await expect(getPlanHandler(request({ planId: "payg" }, role), current)).resolves.toEqual(
        publicPlan,
      );
      expect(current.store.getPlan).toHaveBeenCalledWith("academy-1", "payg");
    }
  });

  it("rejects unknown IDs and extra fields before get access", async () => {
    const current = services();
    for (const data of [
      { planId: "unknown" },
      { planId: "payg", academyId: "academy-2" },
      { planId: "../payg" },
      { planId: "payg", [Symbol("extra")]: true },
    ]) {
      await expect(getPlanHandler(request(data, "owner"), current)).rejects.toMatchObject({
        code: "invalid-argument",
      });
    }
    const getterPayload = {};
    Object.defineProperty(getterPayload, "planId", {
      enumerable: true,
      get: () => {
        throw new Error("hostile plan ID getter");
      },
    });
    await expect(getPlanHandler(request(getterPayload, "owner"), current)).rejects.toMatchObject({
      code: "invalid-argument",
    });
    expect(current.store.getPlan).not.toHaveBeenCalled();
  });

  it("allows only owner and administrator to save their derived tenant plan", async () => {
    for (const role of ["owner", "administrator"]) {
      const current = services();
      await expect(savePlanHandler(request(editablePlan, role), current)).resolves.toEqual({
        ...publicPlan,
        active: true,
      });
      expect(current.store.savePlan).toHaveBeenCalledWith({
        academyId: "academy-1",
        actorId: "actor-1",
        now,
        draft: editablePlan,
      });
    }
  });

  it("denies mutation to all non-administrative roles", async () => {
    for (const role of ["guardian", "adultStudent", "headCoach", "coach", "reception"]) {
      const current = services();
      await expect(savePlanHandler(request(editablePlan, role), current)).rejects.toMatchObject({
        code: "permission-denied",
      });
      await expect(
        deactivatePlanHandler(request({ planId: "payg" }, role), current),
      ).rejects.toMatchObject({ code: "permission-denied" });
      await expect(
        activatePlanHandler(request({ planId: "payg" }, role), current),
      ).rejects.toMatchObject({ code: "permission-denied" });
      expect(current.store.savePlan).not.toHaveBeenCalled();
      expect(current.store.deactivatePlan).not.toHaveBeenCalled();
      expect(current.store.activatePlan).not.toHaveBeenCalled();
    }
  });

  it("rejects every authority field, hostile shape, invalid money, and invalid array", async () => {
    const current = services();
    const authorityFields = [
      "academyId",
      "actorId",
      "createdAt",
      "createdBy",
      "updatedAt",
      "updatedBy",
      "schemaVersion",
      "active",
    ];
    for (const field of authorityFields) {
      await expect(
        savePlanHandler(request({ ...editablePlan, [field]: "hostile" }, "owner"), current),
      ).rejects.toMatchObject({ code: "invalid-argument" });
    }
    for (const payload of [
      { ...editablePlan, planId: "unknown" },
      { ...editablePlan, priceMinor: 10.5 },
      { ...editablePlan, eligibleParticipantTypes: ["adult", "adult"] },
      { ...editablePlan, [Symbol("extra")]: true },
      Object.assign(Object.create({ inherited: true }), editablePlan),
    ]) {
      await expect(savePlanHandler(request(payload, "owner"), current)).rejects.toMatchObject({
        code: "invalid-argument",
      });
    }
    const getterPayload = { ...editablePlan };
    Object.defineProperty(getterPayload, "displayName", {
      enumerable: true,
      get: () => {
        throw new Error("hostile getter");
      },
    });
    await expect(savePlanHandler(request(getterPayload, "owner"), current)).rejects.toMatchObject({
      code: "invalid-argument",
    });
    expect(current.store.savePlan).not.toHaveBeenCalled();
  });

  it("deactivates with an exact plan ID, derives actor and tenant, and remains safe when repeated", async () => {
    const current = services();
    await expect(
      deactivatePlanHandler(request({ planId: "payg" }, "owner"), current),
    ).resolves.toEqual({ ...publicPlan, active: false });
    expect(current.store.deactivatePlan).toHaveBeenCalledWith({
      academyId: "academy-1",
      actorId: "actor-1",
      planId: "payg",
      now,
    });
    vi.mocked(current.store.deactivatePlan).mockResolvedValueOnce(
      record(undefined, { active: false }),
    );
    await expect(
      deactivatePlanHandler(request({ planId: "payg" }, "administrator"), current),
    ).resolves.toEqual({ ...publicPlan, active: false });
  });

  it("activates only its own tenant, preserves a redacted response, and is repeat-safe", async () => {
    for (const role of ["owner", "administrator"]) {
      const current = services();
      await expect(
        activatePlanHandler(request({ planId: "payg" }, role), current),
      ).resolves.toEqual({ ...publicPlan, active: true });
      expect(current.store.activatePlan).toHaveBeenCalledWith({
        academyId: "academy-1",
        actorId: "actor-1",
        planId: "payg",
        now,
      });
      const result = await activatePlanHandler(request({ planId: "payg" }, role), current);
      expect(result).toEqual({ ...publicPlan, active: true });
      expect(result).not.toHaveProperty("academyId");
      expect(result).not.toHaveProperty("createdAt");
      expect(result).not.toHaveProperty("createdBy");
      expect(result).not.toHaveProperty("updatedAt");
      expect(result).not.toHaveProperty("updatedBy");
      expect(result).not.toHaveProperty("schemaVersion");
    }
  });

  it("rejects anonymous, cross-tenant, and hostile activation requests safely", async () => {
    const current = services();
    await expect(activatePlanHandler(request({ planId: "payg" }), current)).rejects.toMatchObject({
      code: "unauthenticated",
    });

    const { PlanStoreError } = await import("./plan-service.js");
    vi.mocked(current.store.activatePlan).mockRejectedValueOnce(
      new PlanStoreError("tenant", "Firestore path academies/other/plans/payg"),
    );
    await expect(
      activatePlanHandler(request({ planId: "payg" }, "owner"), current),
    ).rejects.toMatchObject({ code: "permission-denied", message: "Plan access is not permitted" });

    const hostilePayloads = [
      { planId: "payg", academyId: "academy-2" },
      { planId: "payg", actorId: "actor-2" },
      { planId: "unknown" },
      { planId: "payg", [Symbol("extra")]: true },
    ];
    for (const payload of hostilePayloads) {
      await expect(activatePlanHandler(request(payload, "owner"), current)).rejects.toMatchObject({
        code: "invalid-argument",
      });
    }
    const getterPayload = {};
    Object.defineProperty(getterPayload, "planId", {
      enumerable: true,
      get: () => {
        throw new Error("hostile activation getter");
      },
    });
    await expect(
      activatePlanHandler(request(getterPayload, "administrator"), current),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(current.store.activatePlan).toHaveBeenCalledTimes(1);
  });

  it("maps tenant, invalid, missing, and internal store errors to safe public errors", async () => {
    const current = services();
    const { PlanStoreError } = await import("./plan-service.js");
    vi.mocked(current.store.getPlan).mockRejectedValueOnce(
      new PlanStoreError("tenant", "Firestore path academies/other/plans/payg"),
    );
    await expect(
      getPlanHandler(request({ planId: "payg" }, "owner"), current),
    ).rejects.toMatchObject({ code: "permission-denied", message: "Plan access is not permitted" });

    vi.mocked(current.store.savePlan).mockRejectedValueOnce(
      new PlanStoreError("invalid", "private stored path"),
    );
    await expect(savePlanHandler(request(editablePlan, "owner"), current)).rejects.toMatchObject({
      code: "invalid-argument",
      message: "Plan payload is invalid",
    });

    vi.mocked(current.store.deactivatePlan).mockRejectedValueOnce(
      new Error("raw Firestore credentials and path"),
    );
    await expect(
      deactivatePlanHandler(request({ planId: "payg" }, "owner"), current),
    ).rejects.toMatchObject({ code: "internal", message: "Unable to deactivate plan" });
  });
});
