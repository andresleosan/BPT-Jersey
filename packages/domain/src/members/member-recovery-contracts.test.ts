import { expect, it } from "vitest";
import { beginMemberRecoveryInputSchema } from "./member-recovery-contracts";

it("accepts a name alone and normalizes an omitted or blank previous email", () => {
  for (const input of [{ fullName: "Alex Member" }, { fullName: "Alex Member", email: "  " }]) {
    expect(beginMemberRecoveryInputSchema.parse(input)).toEqual({ fullName: "Alex Member" });
  }
});
it("still rejects an invalid supplied email and an empty name", () => {
  expect(
    beginMemberRecoveryInputSchema.safeParse({ fullName: "Alex Member", email: "invalid" }).success,
  ).toBe(false);
  expect(beginMemberRecoveryInputSchema.safeParse({ fullName: "  " }).success).toBe(false);
});
