import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ httpsCallable: vi.fn(), invoke: vi.fn() }));

vi.mock("firebase/functions", () => ({ httpsCallable: api.httpsCallable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({ region: "europe-west9" }) }));

import { listMemberGroups, saveMemberGroup } from "./groups-client";

const group = {
  groupId: "g1",
  name: "Competition team",
  site: "West",
  studentIds: ["s1"],
  revision: 2,
  active: true,
  updatedAt: "2026-09-25T09:00:00.000Z",
  members: [{ studentId: "s1", fullName: "Ana Coelho", missingPayment: false }],
};
const input = { groupId: "g1", name: "Competition team", site: "Town" as const, studentIds: [], revision: 0 };

describe("groups client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.httpsCallable.mockReturnValue(api.invoke);
  });

  it("returns each group's site and leaves older groups without one", async () => {
    const older: Record<string, unknown> = { ...group };
    delete older.site;
    api.invoke.mockResolvedValue({ data: { groups: [group, { ...older, groupId: "g0" }] } });
    const groups = await listMemberGroups();
    expect(groups.map((row) => row.site)).toEqual(["West", undefined]);
  });

  it("refuses a malformed group list", async () => {
    api.invoke.mockResolvedValue({ data: { groups: [{ ...group, site: "North" }] } });
    await expect(listMemberGroups()).rejects.toThrow("Unable to load groups. Try again.");
  });

  it("sends the site with the group", async () => {
    api.invoke.mockResolvedValue({ data: { saved: true } });
    await saveMemberGroup(input);
    expect(api.invoke).toHaveBeenCalledWith(input);
  });

  it("shows the office's own refusal, such as a guardian in the group", async () => {
    api.invoke.mockRejectedValue(
      Object.assign(new Error("Guardians can't be added to a group: Pat Parent"), { code: "functions/failed-precondition" }),
    );
    await expect(saveMemberGroup(input)).rejects.toThrow("Guardians can't be added to a group: Pat Parent");
  });

  it("replaces an unknown invalid-argument message with a fixed sentence", async () => {
    api.invoke.mockRejectedValue(
      Object.assign(new Error("studentIds.3: Invalid string"), { code: "functions/invalid-argument" }),
    );
    await expect(saveMemberGroup(input)).rejects.toThrow("Check the group details and try again.");
  });

  it.each([
    "Only active members can be added: Idle Member",
    "Guardians can't be added to a group: Pat Parent",
    "Choose a group from this class's site.",
  ])("keeps the server's own sentence %s", async (message) => {
    api.invoke.mockRejectedValue(Object.assign(new Error(message), { code: "functions/invalid-argument" }));
    await expect(saveMemberGroup(input)).rejects.toThrow(message);
  });

  it("never shows a raw Firebase error", async () => {
    api.invoke.mockRejectedValue(Object.assign(new Error("internal"), { code: "functions/internal" }));
    await expect(saveMemberGroup(input)).rejects.toThrow("Unable to save changes. Try again.");
  });
});
