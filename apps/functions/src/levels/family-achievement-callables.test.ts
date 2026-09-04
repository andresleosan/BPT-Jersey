import { describe, expect, it } from "vitest";

import type { FamilyAchievementSummary } from "@bpt-jersey/domain";
import { createGetFamilyAchievementSummaryHandler } from "./family-achievement-callables";
import type { FamilyAchievementStore } from "./family-achievement-service";
import type { LevelAuthorizationService } from "./level-authorization";

const summary = {
  familyId: "family-1",
  generatedAt: "2026-08-31T12:00:00.000Z",
  members: [],
  adultComparison: [],
} as FamilyAchievementSummary;

function request(
  data: unknown,
  role: string,
  academyId = "academy-1",
  uid: string | null = "staff-1",
) {
  return {
    auth: uid ? { uid, token: { academyId, role } } : undefined,
    app: { appId: "test-app" },
    data,
  } as never;
}

const authorization: LevelAuthorizationService = {
  requireActor: async (call) => {
    if (!call.auth) throw Object.assign(new Error("unauthenticated"), { code: "unauthenticated" });
    return {
      kind: "user",
      userId: call.auth.uid as never,
      academyId: call.auth.token.academyId as never,
      role: call.auth.token.role as never,
      staffId: call.auth.token.role === "headCoach" ? "staff-1" : null,
    };
  },
  resolveStudent: async () => {
    throw new Error("unused");
  },
};

describe("family achievement summary callable", () => {
  it.each(["owner", "administrator", "headCoach"])(
    "allows %s and preserves the summary",
    async (role) => {
      const store: FamilyAchievementStore = {
        getSnapshot: async (academyId, familyId) => {
          expect(academyId).toBe("academy-1");
          expect(familyId).toBe("family-1");
          return summary;
        },
        saveSnapshot: async () => {
          throw new Error("read-only callable must not write");
        },
      };

      const response = await createGetFamilyAchievementSummaryHandler({ store, authorization })(
        request({ familyId: "family-1" }, role),
      );
      expect(response).toEqual({ summary });
    },
  );

  it.each(["coach", "guardian", "adultStudent"])("denies %s", async (role) => {
    const store: FamilyAchievementStore = {
      getSnapshot: async () => summary,
      saveSnapshot: async () => {
        throw new Error("unused");
      },
    };
    await expect(
      createGetFamilyAchievementSummaryHandler({ store, authorization })(
        request({ familyId: "family-1" }, role),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects malformed payloads and unauthenticated requests", async () => {
    const store: FamilyAchievementStore = {
      getSnapshot: async () => summary,
      saveSnapshot: async () => {
        throw new Error("unused");
      },
    };
    const handler = createGetFamilyAchievementSummaryHandler({ store, authorization });

    await expect(handler(request(null, "owner"))).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(handler(request({ familyId: "family/other" }, "owner"))).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(
      handler({ auth: undefined, data: { familyId: "family-1" } } as never),
    ).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });
});
