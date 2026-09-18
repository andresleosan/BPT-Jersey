import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  beginMemberRecoveryHandler,
  completeMemberRecoveryHandler,
  listMemberRecoveryRequestsHandler,
  getMemberRecoveryDetailHandler,
  reviewMemberRecoveryHandler,
  memberRecoveryOrigins,
  type MemberRecoveryCallableServices,
} from "./member-recovery-callables.js";
const request = (data: unknown = null, role = "owner"): CallableRequest<unknown> =>
  ({
    data,
    app: { appId: "app-1" },
    auth: { uid: "actor-1", token: { academyId: "academy-1", role } },
    rawRequest: { ip: "192.0.2.1" },
  }) as unknown as CallableRequest<unknown>;
function without(value: CallableRequest<unknown>, key: "auth" | "app"): CallableRequest<unknown> {
  const result = { ...value };
  delete result[key];
  return result;
}
function services() {
  return {
    service: {
      begin: vi
        .fn()
        .mockResolvedValue({ recoveryId: "a".repeat(64), expiresAt: "2026-09-19T10:00:00.000Z" }),
      complete: vi.fn().mockResolvedValue({ status: "pending-review" }),
      list: vi.fn().mockResolvedValue({ requests: [], truncated: false }),
      detail: vi.fn().mockResolvedValue({}),
      review: vi.fn().mockResolvedValue({
        status: "profile-required",
        profile: { phoneNumber: "+15550000001" },
      }),
    },
    isActorActive: vi.fn().mockResolvedValue(true),
  } satisfies MemberRecoveryCallableServices;
}
describe("recovery callable boundaries", () => {
  it("keeps local origins out of production", () => {
    expect(memberRecoveryOrigins(false)).toEqual([
      "https://bptjersey.com",
      "https://www.bptjersey.com",
      "https://bptjersey.pages.dev",
    ]);
    expect(memberRecoveryOrigins(true)).toContain("http://localhost:3000");
  });
  it("requires App Check before public matching", async () => {
    const s = services();
    await expect(beginMemberRecoveryHandler(without(request(), "app"), s)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(s.service.begin).not.toHaveBeenCalled();
  });
  it("allows generic public begin but requires Auth for completion", async () => {
    const s = services();
    await beginMemberRecoveryHandler(
      without(request({ fullName: "Person", email: "old@example.test" }), "auth"),
      s,
    );
    expect(s.service.begin).toHaveBeenCalledWith(
      { fullName: "Person", email: "old@example.test" },
      "192.0.2.1",
    );
    await expect(
      completeMemberRecoveryHandler(without(request(), "auth"), s),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });
  it("requires live owner/admin for every office endpoint", async () => {
    for (const handler of [
      listMemberRecoveryRequestsHandler,
      getMemberRecoveryDetailHandler,
      reviewMemberRecoveryHandler,
    ]) {
      const s = services();
      await expect(handler(request(null, "coach"), s)).rejects.toMatchObject({
        code: "permission-denied",
      });
      s.isActorActive.mockResolvedValue(false);
      await expect(handler(request(), s)).rejects.toMatchObject({ code: "permission-denied" });
    }
  });
  it("does not return completion fields from administrative review", async () => {
    expect(
      await reviewMemberRecoveryHandler(
        request({ requestId: "a".repeat(64), decision: "reject" }),
        services(),
      ),
    ).toEqual({ status: "profile-required" });
  });
  it("does not expose underlying failures or source records", async () => {
    const s = services();
    s.service.begin.mockRejectedValue(new Error("restricted old@example.test"));
    await expect(beginMemberRecoveryHandler(request(), s)).rejects.toMatchObject({
      code: "unavailable",
      message: "Recovery could not be completed. Please try again or contact the office.",
    });
  });
});
