import { describe, expect, it, vi } from "vitest";

import type { AuthorizedLevelActor } from "../levels/level-authorization.js";
import {
  decideGraduationHandler,
  graduationBoardAccess,
  listGraduationBoardHandler,
} from "./graduation-callables.js";

describe("graduation board access (spec D7, amended by the operator 2026-10-21)", () => {
  it.each([
    ["owner", true],
    ["administrator", true],
    ["headCoach", false],
    ["coach", false],
  ])("lets %s read the board, deciding only for the office", (role, canDecide) => {
    expect(graduationBoardAccess(role)).toEqual({ canDecide });
  });

  it.each(["guardian", "adultStudent", "teenStudent", "shopper", ""])("refuses %s", (role) => {
    expect(graduationBoardAccess(role)).toBeNull();
  });
});

describe("graduation callables, with the actor and the board injected", () => {
  const request = (data: unknown = {}) => ({ data }) as never;
  const actorAs = (role: string) => async () =>
    ({ role, academyId: "academy-1", userId: `${role}-1` }) as unknown as AuthorizedLevelActor;
  const board = vi.fn(async (_academyId: string, canDecide: boolean) => ({
    rows: [],
    canDecide,
    generatedAt: "2026-10-21T08:00:00.000Z",
  }));

  it.each([
    ["coach", false],
    ["headCoach", false],
    ["owner", true],
    ["administrator", true],
  ])("gives %s the board with canDecide %s", async (role, canDecide) => {
    board.mockClear();
    await expect(
      listGraduationBoardHandler(request(), actorAs(role), board),
    ).resolves.toMatchObject({ canDecide });
    expect(board).toHaveBeenCalledWith("academy-1", canDecide);
  });

  it("refuses a member before building any board", async () => {
    board.mockClear();
    await expect(
      listGraduationBoardHandler(request(), actorAs("guardian"), board),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(board).not.toHaveBeenCalled();
  });

  it.each(["coach", "headCoach"])("refuses a %s who tries to decide", async (role) => {
    await expect(
      decideGraduationHandler(request({ studentId: "s1", decision: "promote" }), actorAs(role)),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("lets the office past the gate to the decision's own checks", async () => {
    await expect(
      decideGraduationHandler(request({ bad: true }), actorAs("owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
