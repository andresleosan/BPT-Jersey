import { expect, it, vi } from "vitest";
const callable = vi.hoisted(() => vi.fn());
vi.mock("firebase/functions", () => ({ httpsCallable: () => callable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));
import { getMemberSubscriptions } from "./subscription-admin-client";
it("rejects a valid response for the wrong student", async () => {
  callable.mockResolvedValue({
    data: { studentId: "sibling", fullName: "Fixture", eligiblePlanIds: [], memberships: [] },
  });
  await expect(getMemberSubscriptions("student-1")).rejects.toThrow(
    "Unable to load membership history. Please try again.",
  );
});
