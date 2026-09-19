import { describe, expect, it } from "vitest";
import {
  buildMemberMigrationQueue,
  decideMemberMigrationInputSchema,
  maskIdentifier,
  type ArchiveRecordInput,
  type LegacyMemberInput,
} from "./member-migration-contracts";

const today = "2026-09-19";
const member = (over: Partial<LegacyMemberInput> & { memberId: string }): LegacyMemberInput => ({
  fullName: "Ana Silva",
  birthDate: "1990-05-01",
  ...over,
});
const record = (over: Partial<ArchiveRecordInput> & { recordId: string }): ArchiveRecordInput => ({
  fullName: "Ana Silva",
  birthDate: "1990-05-01",
  ...over,
});
const build = (
  members: LegacyMemberInput[],
  records: ArchiveRecordInput[],
  decided: string[] = [],
  linked: string[] = [],
) =>
  buildMemberMigrationQueue({
    members,
    records,
    decidedMemberIds: new Set(decided),
    linkedRecordIds: new Set(linked),
    today,
  });

describe("buildMemberMigrationQueue", () => {
  it("is strong on an identical member number after normalisation", () => {
    const queue = build(
      [member({ memberId: "m1", membershipNumber: " 0042 " })],
      [record({ recordId: "10", memberNumber: "0042", fullName: "Other Name" })],
    );
    expect(queue.rows[0]).toMatchObject({
      legacyMemberId: "m1",
      category: "strong",
      candidates: [{ recordId: "10", reason: "member-number" }],
      isMinor: false,
    });
  });

  it("is strong on an identical ID card", () => {
    const queue = build(
      [member({ memberId: "m1", idCardNumber: "a123" })],
      [record({ recordId: "10", idCardNumber: "A123" })],
    );
    expect(queue.rows[0]?.category).toBe("strong");
    expect(queue.rows[0]?.candidates[0]?.reason).toBe("id-card");
  });

  it("is ambiguous when two members share the matching number", () => {
    const queue = build(
      [
        member({ memberId: "m1", membershipNumber: "7" }),
        member({ memberId: "m2", membershipNumber: "7", fullName: "Bea" }),
      ],
      [record({ recordId: "10", memberNumber: "7" })],
    );
    expect(queue.rows.map((row) => row.category)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("is ambiguous when number and ID card point at different records", () => {
    const queue = build(
      [member({ memberId: "m1", membershipNumber: "7", idCardNumber: "X1" })],
      [
        record({ recordId: "10", memberNumber: "7" }),
        record({ recordId: "11", idCardNumber: "X1", fullName: "Other" }),
      ],
    );
    expect(queue.rows[0]?.category).toBe("ambiguous");
    expect(queue.rows[0]?.candidates.map((candidate) => candidate.recordId)).toEqual(["10", "11"]);
  });

  it("only suggests on the same name and date of birth", () => {
    const queue = build(
      [member({ memberId: "m1", fullName: "  ÁNA   silva " })],
      [record({ recordId: "10" })],
    );
    expect(queue.rows[0]).toMatchObject({
      category: "suggested",
      candidates: [{ recordId: "10", reason: "name-and-birth-date" }],
    });
  });

  it("is none without candidates and lists the unmatched record as archive-only", () => {
    const queue = build(
      [member({ memberId: "m1", fullName: "Nobody" })],
      [record({ recordId: "10" })],
    );
    expect(queue.rows[0]?.category).toBe("none");
    expect(queue.archiveOnly).toEqual(["10"]);
  });

  it("skips decided members and never offers an already linked record", () => {
    const queue = build(
      [
        member({ memberId: "m1", membershipNumber: "7" }),
        member({ memberId: "m2", fullName: "Z" }),
      ],
      [record({ recordId: "10", memberNumber: "7" })],
      ["m2"],
      ["10"],
    );
    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0]?.category).toBe("none");
    expect(queue.archiveOnly).toEqual([]);
  });

  it("marks minors on the day before the 18th birthday and adults on the day", () => {
    const [minor, adult] = build(
      [
        member({ memberId: "m1", birthDate: "2008-09-20" }),
        member({ memberId: "m2", birthDate: "2008-09-19", fullName: "B" }),
      ],
      [],
    ).rows;
    expect(minor?.isMinor).toBe(true);
    expect(adult?.isMinor).toBe(false);
  });

  it("marks a member with no date of birth as unknown", () => {
    const queue = build([{ memberId: "m1", fullName: "Ana Silva" }], []);
    expect(queue.rows[0]?.isMinor).toBe("unknown");
  });
});

describe("maskIdentifier", () => {
  it("keeps only the last three characters", () => {
    expect(maskIdentifier("AB12345")).toBe("•••345");
    expect(maskIdentifier("12")).toBe("•••12");
    expect(maskIdentifier(undefined)).toBeUndefined();
  });
});

describe("decideMemberMigrationInputSchema", () => {
  const training = { trainingCenter: "Town", trainingTimePreferences: ["evening"] };
  it("accepts link, create-unlinked and skip", () => {
    const parsed = decideMemberMigrationInputSchema.safeParse({
      decisions: [
        {
          kind: "link",
          legacyMemberId: "m1",
          recordId: "10",
          requestId: crypto.randomUUID(),
          ...training,
        },
        {
          kind: "create-unlinked",
          legacyMemberId: "m2",
          requestId: crypto.randomUUID(),
          ...training,
        },
        { kind: "skip", legacyMemberId: "m3", reason: "Duplicate row" },
      ],
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects a skip without a reason, a link without a record, and 51 decisions", () => {
    expect(
      decideMemberMigrationInputSchema.safeParse({
        decisions: [{ kind: "skip", legacyMemberId: "m" }],
      }).success,
    ).toBe(false);
    expect(
      decideMemberMigrationInputSchema.safeParse({
        decisions: [
          { kind: "link", legacyMemberId: "m", requestId: crypto.randomUUID(), ...training },
        ],
      }).success,
    ).toBe(false);
    const many = Array.from({ length: 51 }, (_, index) => ({
      kind: "skip",
      legacyMemberId: `m${index}`,
      reason: "Duplicate row",
    }));
    expect(decideMemberMigrationInputSchema.safeParse({ decisions: many }).success).toBe(false);
  });
});
