import { describe, expect, it, vi } from "vitest";
import type { MemberRecord } from "@bpt-jersey/domain/members";
import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import {
  CanonicalMemberDirectoryError,
  legacyMigrationErrorMessages,
} from "./canonical-member-directory-service.js";
import {
  createMemberMigrationService,
  MemberMigrationInputError,
} from "./member-migration-service.js";

const actor = {
  actorId: "owner-1",
  academyId: "academy-1",
  role: "owner" as const,
  active: true,
  appCheckVerified: true,
};
const adult = {
  memberId: "m1",
  fullName: "Ana Silva",
  birthDate: "1990-05-01",
  membershipNumber: "42",
  mobileNumber: "07700 900000",
  gender: "female",
} as unknown as MemberRecord;
const archive = {
  recordId: "10",
  fullName: "Ana Silva",
  birthDate: "1990-05-01",
  memberNumber: "42",
  gender: "female",
  mobile: "07700 900000",
} as unknown as RegyfitMemberRecord;
const training = { trainingCenter: "Town", trainingTimePreferences: ["evening"] };
// Source document update times (`seconds:nanoseconds`), as the Firestore store reads them.
const memberVersion = "1:0";
const recordVersion = "2:0";
// Since f33b54e a link or create-unlinked carries the reviewed source versions and evidence.
const linkReview = {
  legacyVersion: memberVersion,
  recordVersion,
  identityEvidence: "Synthetic passport seen",
  choices: [],
};
const unlinkedReview = {
  legacyVersion: memberVersion,
  identityEvidence: "Synthetic passport seen",
  choices: [],
};
const choice = (field: string, source: "legacy" | "regyfit") => ({
  field,
  source,
  evidence: "Synthetic passport seen",
  reason: "Checked by the office",
});

function harness(
  overrides: Partial<{
    members: MemberRecord[];
    records: RegyfitMemberRecord[];
    decided: string[];
  }> = {},
) {
  const writer = {
    registerLegacyMember: vi.fn(async () => ({ memberId: "s1", studentId: "s1" })),
    skipLegacyMember: vi.fn(async () => undefined),
  };
  const members = overrides.members ?? [adult];
  const records = overrides.records ?? [archive];
  const service = createMemberMigrationService({
    store: {
      load: async () => ({
        versions: {
          members: Object.fromEntries(members.map((member) => [member.memberId, memberVersion])),
          records: Object.fromEntries(records.map((record) => [record.recordId, recordVersion])),
        },
        members,
        records,
        decidedMemberIds: new Set(overrides.decided ?? []),
        linkedRecordIds: new Set(),
      }),
    },
    writer,
    now: () => "2026-09-19T10:00:00.000Z",
  });
  return { service, writer };
}

describe("member migration service", () => {
  it("lists a strong row with masked identifiers", async () => {
    const queue = await harness().service.listQueue(actor);
    expect(queue.rows[0]).toMatchObject({
      legacyMemberId: "m1",
      category: "strong",
      member: { memberNumberMasked: "•••42" },
    });
  });

  it("links with the archive identity, the member ID card and the chosen training", async () => {
    const { service, writer } = harness();
    const result = await service.decide(actor, {
      decisions: [
        {
          kind: "link",
          legacyMemberId: "m1",
          recordId: "10",
          requestId: crypto.randomUUID(),
          review: linkReview,
          ...training,
        },
      ],
    });
    expect(result.results).toEqual([{ legacyMemberId: "m1", status: "applied", studentId: "s1" }]);
    expect(writer.registerLegacyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyMemberId: "m1",
        recordId: "10",
        value: expect.objectContaining({
          fullName: "Ana Silva",
          dateOfBirth: "1990-05-01",
          membershipNumber: "42",
          trainingCenter: "Town",
        }),
      }),
    );
  });

  it("rejects a link to a record that is not a candidate", async () => {
    const other = {
      ...archive,
      recordId: "11",
      memberNumber: "99",
      fullName: "Zed",
    } as unknown as RegyfitMemberRecord;
    const { service, writer } = harness({ records: [archive, other] });
    const result = await service.decide(actor, {
      decisions: [
        {
          kind: "link",
          legacyMemberId: "m1",
          recordId: "11",
          requestId: crypto.randomUUID(),
          // Every difference resolved, so the only fault left is the record itself.
          review: {
            ...linkReview,
            choices: [choice("fullName", "legacy"), choice("membershipNumber", "legacy")],
          },
          ...training,
        },
      ],
    });
    expect(result.results[0]).toEqual({
      legacyMemberId: "m1",
      status: "rejected",
      code: "not-a-candidate",
    });
    expect(writer.registerLegacyMember).not.toHaveBeenCalled();
  });

  it("registers minors and members without a date of birth", async () => {
    const minor = {
      ...adult,
      memberId: "m2",
      birthDate: "2012-01-01",
      membershipNumber: undefined,
    } as unknown as MemberRecord;
    const undated = {
      ...adult,
      memberId: "m3",
      birthDate: undefined,
      membershipNumber: undefined,
    } as unknown as MemberRecord;
    const { service } = harness({ members: [minor, undated], records: [] });
    // One call each: since f33b54e only strong, conflict-free links may share a batch.
    const register = (legacyMemberId: string) =>
      service.decide(actor, {
        decisions: [
          {
            kind: "create-unlinked",
            legacyMemberId,
            requestId: crypto.randomUUID(),
            review: unlinkedReview,
            ...training,
          },
        ],
      });
    const results = [...(await register("m2")).results, ...(await register("m3")).results];
    expect(results.map((entry) => entry.status)).toEqual(["applied", "applied"]);
  });

  it("keeps going after a rejected decision and maps writer errors to safe codes", async () => {
    const second = {
      ...adult,
      memberId: "m2",
      fullName: "Bea",
      membershipNumber: undefined,
    } as unknown as MemberRecord;
    const { service, writer } = harness({ members: [adult, second] });
    writer.registerLegacyMember.mockRejectedValueOnce(
      new CanonicalMemberDirectoryError("conflict", legacyMigrationErrorMessages.recordLinked),
    );
    const result = await service.decide(actor, {
      decisions: [
        {
          kind: "link",
          legacyMemberId: "m1",
          recordId: "10",
          requestId: crypto.randomUUID(),
          review: linkReview,
          ...training,
        },
        { kind: "skip", legacyMemberId: "m2", reason: "Duplicate row" },
      ],
    });
    expect(result.results).toEqual([
      { legacyMemberId: "m1", status: "rejected", code: "record-already-linked" },
      { legacyMemberId: "m2", status: "applied" },
    ]);
  });

  it("rejects an unknown or already decided member without writing", async () => {
    const { service, writer } = harness({ decided: ["m1"] });
    const result = await service.decide(actor, {
      decisions: [
        { kind: "skip", legacyMemberId: "m1", reason: "Duplicate row" },
        { kind: "skip", legacyMemberId: "ghost", reason: "Duplicate row" },
      ],
    });
    expect(result.results.map((entry) => entry.status === "rejected" && entry.code)).toEqual([
      "already-decided",
      "unknown-member",
    ]);
    expect(writer.skipLegacyMember).not.toHaveBeenCalled();
  });

  it("maps a divergent receipt replay to write-failed", async () => {
    const { service, writer } = harness();
    writer.registerLegacyMember.mockRejectedValueOnce(
      new CanonicalMemberDirectoryError("replay", "Divergent member write replay"),
    );
    const result = await service.decide(actor, {
      decisions: [
        {
          kind: "create-unlinked",
          legacyMemberId: "m1",
          requestId: crypto.randomUUID(),
          review: unlinkedReview,
          ...training,
        },
      ],
    });
    expect(result.results).toEqual([
      { legacyMemberId: "m1", status: "rejected", code: "write-failed" },
    ]);
    expect(writer.registerLegacyMember).toHaveBeenCalledOnce();
  });

  it("creates an unlinked adult with the legacy identity and chosen training", async () => {
    const member = { ...adult, idCardNumber: "ID-42", vatNumber: "VAT-42" } as MemberRecord;
    const { service, writer } = harness({ members: [member], records: [] });
    const requestId = crypto.randomUUID();
    const result = await service.decide(actor, {
      decisions: [
        {
          kind: "create-unlinked",
          legacyMemberId: "m1",
          requestId,
          review: unlinkedReview,
          ...training,
        },
      ],
    });
    expect(result.results).toEqual([{ legacyMemberId: "m1", status: "applied", studentId: "s1" }]);
    expect(writer.registerLegacyMember).toHaveBeenCalledExactlyOnceWith({
      actor,
      now: "2026-09-19T10:00:00.000Z",
      legacyMemberId: "m1",
      // The writer re-derives the value from this review inside its transaction (f33b54e).
      review: unlinkedReview,
      ...training,
      value: {
        requestId,
        fullName: "Ana Silva",
        dateOfBirth: "1990-05-01",
        membershipNumber: "42",
        idCardNumber: "ID-42",
        vatNumber: "VAT-42",
        phoneNumber: "07700 900000",
        gender: "female",
        ...training,
      },
    });
  });

  it.each([
    [
      new CanonicalMemberDirectoryError("invalid", "Invalid admin student input"),
      "invalid-member-data",
    ],
    [new CanonicalMemberDirectoryError("conflict", "Invalid admin student input"), "write-failed"],
    [new CanonicalMemberDirectoryError("invalid", "Other validation error"), "write-failed"],
    [new Error("Invalid admin student input"), "write-failed"],
  ])(
    "maps only the canonical invalid member input error to a correctable rejection (%s)",
    async (error, code) => {
      const { service, writer } = harness({
        members: [{ ...adult, idCardNumber: "ID_42" }],
        records: [],
      });
      writer.registerLegacyMember.mockRejectedValueOnce(error);
      const result = await service.decide(actor, {
        decisions: [
          {
            kind: "create-unlinked",
            legacyMemberId: "m1",
            requestId: crypto.randomUUID(),
            review: unlinkedReview,
            ...training,
          },
        ],
      });
      expect(writer.registerLegacyMember).toHaveBeenCalledWith(
        expect.objectContaining({ value: expect.objectContaining({ idCardNumber: "ID_42" }) }),
      );
      expect(result.results).toEqual([{ legacyMemberId: "m1", status: "rejected", code }]);
    },
  );

  it("rejects a skip without a reason before writing", async () => {
    const { service, writer } = harness();
    await expect(
      service.decide(actor, {
        decisions: [{ kind: "skip", legacyMemberId: "m1" }],
      }),
    ).rejects.toBeInstanceOf(MemberMigrationInputError);
    expect(writer.registerLegacyMember).not.toHaveBeenCalled();
    expect(writer.skipLegacyMember).not.toHaveBeenCalled();
  });
});

describe("member migration once legacy reads are eliminated (2026-10-20 capacity prep, part 2)", () => {
  const closedError = new CanonicalMemberDirectoryError(
    "unavailable",
    "Closed for good",
    "legacy_reads_eliminated",
  );

  it("keeps what was decided when the queue closes partway, and attempts nothing after", async () => {
    const second = { ...adult, memberId: "m2", fullName: "Bea Costa" } as unknown as MemberRecord;
    const third = { ...adult, memberId: "m3", fullName: "Cai Duarte" } as unknown as MemberRecord;
    const { service, writer } = harness({ members: [adult, second, third] });
    writer.skipLegacyMember.mockResolvedValueOnce(undefined).mockRejectedValueOnce(closedError);

    const result = await service.decide(actor, {
      decisions: [
        { kind: "skip", legacyMemberId: "m1", reason: "Duplicate row" },
        { kind: "skip", legacyMemberId: "m2", reason: "Duplicate row" },
        { kind: "skip", legacyMemberId: "m3", reason: "Duplicate row" },
      ],
    });

    expect(result).toEqual({
      results: [{ legacyMemberId: "m1", status: "applied" }],
      closed: true,
    });
    expect(writer.skipLegacyMember).toHaveBeenCalledTimes(2);
  });

  it("passes a closed store on before building a queue or writing anything", async () => {
    const writer = { registerLegacyMember: vi.fn(), skipLegacyMember: vi.fn() };
    const service = createMemberMigrationService({
      store: {
        load: async () => {
          throw closedError;
        },
      },
      writer,
      now: () => "2026-10-20T22:00:00.000Z",
    });

    await expect(service.listQueue(actor)).rejects.toBe(closedError);
    await expect(
      service.decide(actor, {
        decisions: [{ kind: "skip", legacyMemberId: "m1", reason: "Duplicate row" }],
      }),
    ).rejects.toBe(closedError);
    expect(writer.skipLegacyMember).not.toHaveBeenCalled();
  });
});

it.each(["link", "create-unlinked"] as const)(
  "recovers a missing birth date from a strong match only through a reviewed link (%s)",
  async (kind) => {
    const missing = { ...adult };
    delete missing.birthDate;
    const { service, writer } = harness({
      members: [missing],
      records: [{ ...archive, birthDate: "2015-01-01" }],
    });
    await service.decide(actor, {
      decisions: [
        {
          kind,
          legacyMemberId: "m1",
          // No source wins by default: the office takes the archive's date explicitly.
          ...(kind === "link"
            ? {
                recordId: "10",
                review: { ...linkReview, choices: [choice("birthDate", "regyfit")] },
              }
            : { review: unlinkedReview }),
          requestId: crypto.randomUUID(),
          ...training,
        },
      ],
    });
    // Since f33b54e an unlinked create takes nothing from the archive: the decision binds no record
    // version and no source wins by default, so the writer flags the date as missing for review.
    expect(writer.registerLegacyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        value:
          kind === "link"
            ? expect.objectContaining({ dateOfBirth: "2015-01-01" })
            : expect.not.objectContaining({ dateOfBirth: expect.anything() }),
      }),
    );
  },
);
it("keeps the member's own date when a linked strong record disagrees", async () => {
  const { service, writer } = harness({ records: [{ ...archive, birthDate: "2015-01-01" }] });
  await service.decide(actor, {
    decisions: [
      {
        kind: "link",
        legacyMemberId: "m1",
        recordId: "10",
        requestId: crypto.randomUUID(),
        // No source wins by default: the office keeps the member's own date explicitly.
        review: { ...linkReview, choices: [choice("birthDate", "legacy")] },
        ...training,
      },
    ],
  });
  expect(writer.registerLegacyMember).toHaveBeenCalledWith(
    expect.objectContaining({ value: expect.objectContaining({ dateOfBirth: adult.birthDate }) }),
  );
});
