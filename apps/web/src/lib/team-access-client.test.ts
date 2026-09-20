import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("firebase/functions", () => ({ httpsCallable: () => invoke }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));
import { listTeamDirectory, changeTeamRole, acceptStaffInvitation } from "./team-access-client";
beforeEach(() => vi.resetAllMocks());
describe("team access client", () => {
  it("validates the projection and refuses additional account data", async () => {
    invoke.mockResolvedValue({ data: { people: [{ userId: "coach", name: "Coach", email: "coach@example.test", role: "coach", privateField: "unexpected" }], nextPageToken: null } });
    await expect(listTeamDirectory()).rejects.toThrow("Unable to load the team directory");
  });
  it("sends the chosen target and requires confirmation from the server", async () => {
    invoke.mockResolvedValue({ data: { changed: true } });
    await expect(changeTeamRole({ userId: "coach", email: "coach@example.test", role: "administrator" })).resolves.toEqual({ changed: true });
    expect(invoke).toHaveBeenCalledWith({ userId: "coach", email: "coach@example.test", role: "administrator" });
  });
  it("lets the server identify an invitation from the signed-in account", async () => {
    invoke.mockResolvedValue({ data: { activated: false } });
    await expect(acceptStaffInvitation()).resolves.toEqual({ activated: false }); expect(invoke).toHaveBeenCalledWith({});
  });
});
