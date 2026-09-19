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
  const service = createMemberMigrationService({
    store: {
      load: async () => ({
        members: overrides.members ?? [adult],
        records: overrides.records ?? [archive],
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

  it("defers minors and members without a date of birth", async () => {
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
    const result = await service.decide(actor, {
      decisions: [
        {
          kind: "create-unlinked",
          legacyMemberId: "m2",
          requestId: crypto.randomUUID(),
          ...training,
        },
        {
          kind: "create-unlinked",
          legacyMemberId: "m3",
          requestId: crypto.randomUUID(),
          ...training,
        },
      ],
    });
    expect(result.results.map((entry) => entry.status === "rejected" && entry.code)).toEqual([
      "minor-deferred",
      "minor-deferred",
    ]);
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
      decisions: [{ kind: "create-unlinked", legacyMemberId: "m1", requestId, ...training }],
    });
    expect(result.results).toEqual([{ legacyMemberId: "m1", status: "applied", studentId: "s1" }]);
    expect(writer.registerLegacyMember).toHaveBeenCalledExactlyOnceWith({
      actor,
      now: "2026-09-19T10:00:00.000Z",
      legacyMemberId: "m1",
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
