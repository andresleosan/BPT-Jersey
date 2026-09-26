import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import { requireActiveOfficeActor } from "../auth/office-actor";
import { requireMemberAccountActor } from "../members/member-access-callables";
import { createPrivateLessonHandlers } from "./private-lesson-callables";

function request(role: string, data: unknown): CallableRequest<unknown> {
  return {
    auth: { uid: `${role}-uid`, token: { academyId: "academy-1", role } },
    app: { appId: "app" },
    data,
  } as unknown as CallableRequest<unknown>;
}

describe("private lesson callables", () => {
  it("refuses a coach on every private lesson callable before touching data", async () => {
    const store = vi.fn();
    const handlers = createPrivateLessonHandlers({
      store,
      requireMember: requireMemberAccountActor,
      requireOffice: requireActiveOfficeActor,
    });
    const calls = [
      handlers.list(request("coach", { status: "pending" })),
      handlers.review(request("coach", { purchaseId: "p1", decision: "approve", reason: null })),
      handlers.record(
        request("coach", { studentId: "s1", optionId: "single", method: "cash", reference: null }),
      ),
      handlers.submit(request("coach", {})),
      handlers.listMine(request("coach", { studentId: "s1" })),
      handlers.proofUrl(request("coach", { purchaseId: "p1" })),
      handlers.proofUrl(request("adultStudent", { purchaseId: "p1" })),
    ];
    for (const call of calls) {
      await expect(call).rejects.toMatchObject({ code: "permission-denied" });
    }
    expect(store).not.toHaveBeenCalled();
  });

  it("hides unexpected failures behind a safe message", async () => {
    const handlers = createPrivateLessonHandlers({
      store: () => {
        throw new Error("Firestore exploded with internal detail");
      },
      requireMember: async () => ({ academyId: "academy-1", userId: "u1", role: "adultStudent" }),
      requireOffice: async () => ({ academyId: "academy-1", userId: "o1", role: "owner" }),
    });
    await expect(handlers.list(request("owner", { status: "pending" }))).rejects.toMatchObject({
      code: "internal",
      message: "The private lesson request could not be completed.",
    });
  });
});
