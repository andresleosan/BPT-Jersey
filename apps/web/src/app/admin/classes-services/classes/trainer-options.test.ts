import { describe, expect, it } from "vitest";

import { academyContent } from "../../../../content/academy";
import { trainerName } from "./trainer-options";

const coach = {
  staffKey: "member-coach-uid",
  role: "coach",
  active: true,
  status: "active",
  self: false,
};

describe("trainerName", () => {
  it("shows a coach given access from a member account by the account's name, not the raw key", () => {
    expect(trainerName("member-coach-uid", [{ ...coach, name: "Ana Coach" }])).toBe("Ana Coach");
  });

  it("keeps the website roster's public name for roster trainers", () => {
    const roster = academyContent.instructors[0]!;
    expect(trainerName(roster.id, [{ ...coach, staffKey: roster.id, name: "Account name" }])).toBe(
      roster.name,
    );
  });

  it("falls back to the key only when no name exists anywhere", () => {
    expect(trainerName("member-coach-uid", [{ ...coach, name: null }])).toBe("member-coach-uid");
    expect(trainerName("member-coach-uid")).toBe("member-coach-uid");
  });
});
