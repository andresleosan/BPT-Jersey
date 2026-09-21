import { describe, expect, it } from "vitest";

import { membershipNumberPlanSchema } from "@bpt-jersey/domain/members/membership-number";

import { buildMembershipNumberReconciliationPlan } from "./membership-number-reconciliation.js";

const generatedAt = "2026-09-21T04:00:00.000Z";

function row(
  recordRef: string,
  sourceKind: "canonical" | "legacy",
  membershipNumber: string,
  ownerId = recordRef.split("/").at(-1) ?? "owner",
) {
  return {
    recordRef,
    sourceKind,
    ownerId,
    sourceVersion: `version-${ownerId}`,
    membershipNumber,
  } as const;
}

describe("membership number reconciliation planner", () => {
  it("keeps the clean canonical owner and reassigns prefixed collisions monotonically", () => {
    const plan = buildMembershipNumberReconciliationPlan({
      academyId: "academy-1",
      generatedAt,
      rows: [
        row("studentAdminProfiles/canonical", "canonical", "33"),
        row("members/legacy-a", "legacy", "#33"),
        row("members/legacy-b", "legacy", "#0033"),
      ],
    });

    expect(plan.rows).toEqual([
      expect.objectContaining({
        recordRef: "studentAdminProfiles/canonical",
        action: "already_canonical",
        proposed: "33",
      }),
      expect.objectContaining({
        recordRef: "members/legacy-a",
        action: "reassign",
        proposed: "34",
      }),
      expect.objectContaining({
        recordRef: "members/legacy-b",
        action: "reassign",
        proposed: "35",
      }),
    ]);
    expect(membershipNumberPlanSchema.parse(plan)).toEqual(plan);
  });

  it("prioritises the clean decimal format over collection provenance", () => {
    const plan = buildMembershipNumberReconciliationPlan({
      academyId: "academy-1",
      generatedAt,
      rows: [
        row("studentAdminProfiles/prefixed", "canonical", "#33", "owner-prefixed"),
        row("members/clean", "legacy", "33", "owner-clean"),
      ],
    });

    expect(plan.rows).toEqual([
      expect.objectContaining({
        recordRef: "members/clean",
        action: "already_canonical",
        proposed: "33",
      }),
      expect.objectContaining({
        recordRef: "studentAdminProfiles/prefixed",
        action: "reassign",
        proposed: "34",
      }),
    ]);
  });

  it("is independent of input order and hashes source versions", () => {
    const rows = [
      row("studentAdminProfiles/canonical", "canonical", "33"),
      row("members/legacy-a", "legacy", "#33"),
      row("members/legacy-b", "legacy", "#0033"),
    ];
    const input = { academyId: "academy-1", generatedAt, rows } as const;
    const forward = buildMembershipNumberReconciliationPlan(input);
    const reversed = buildMembershipNumberReconciliationPlan({
      ...input,
      rows: [...rows].reverse(),
    });

    expect(reversed).toEqual(forward);
    expect(reversed.contentHash).toBe(forward.contentHash);
    expect(
      buildMembershipNumberReconciliationPlan({
        ...input,
        rows: rows.map((value, index) =>
          index === 0 ? { ...value, sourceVersion: "version-changed" } : value,
        ),
      }).contentHash,
    ).not.toBe(forward.contentHash);
  });

  it("masks invalid values for manual review and never serialises the raw value", () => {
    const rawInvalidValue = "invalid-sensitive-reference";
    const plan = buildMembershipNumberReconciliationPlan({
      academyId: "academy-1",
      generatedAt,
      rows: [row("members/manual-review", "legacy", rawInvalidValue)],
    });

    expect(plan.rows).toEqual([
      expect.objectContaining({
        recordRef: "members/manual-review",
        action: "manual_review",
        currentMasked: "****",
      }),
    ]);
    expect(plan.rows[0]).not.toHaveProperty("proposed");
    expect(JSON.stringify(plan)).not.toContain(rawInvalidValue);
  });

  it("rejects duplicate source references, duplicate owners and cross-academy paths", () => {
    const base = row("members/legacy-a", "legacy", "33", "owner-a");
    const build = (rows: readonly ReturnType<typeof row>[]) =>
      buildMembershipNumberReconciliationPlan({ academyId: "academy-1", generatedAt, rows });

    expect(() => build([base, { ...base, ownerId: "owner-b" }])).toThrow(/record reference/i);
    expect(() => build([base, row("members/legacy-b", "legacy", "34", "owner-a")])).toThrow(
      /owner/i,
    );
    expect(() =>
      build([row("academies/academy-2/members/legacy-b", "legacy", "34", "owner-b")]),
    ).toThrow(/record reference/i);
  });

  it("does not reuse gaps when assigning a collision", () => {
    const plan = buildMembershipNumberReconciliationPlan({
      academyId: "academy-1",
      generatedAt,
      rows: [
        row("studentAdminProfiles/one", "canonical", "1", "owner-one"),
        row("studentAdminProfiles/hundred", "canonical", "100", "owner-hundred"),
        row("members/collision", "legacy", "#1", "owner-collision"),
      ],
    });

    expect(plan.rows.find((value) => value.recordRef === "members/collision")).toMatchObject({
      action: "reassign",
      proposed: "101",
    });
  });
});
