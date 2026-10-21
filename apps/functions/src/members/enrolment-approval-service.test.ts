import { describe, expect, it, vi } from "vitest";

import type { EnrolmentRequestRecord } from "@bpt-jersey/domain/members/enrolment-requests";
import {
  createEnrolmentApprovalService,
  EnrolmentApprovalError,
  type EnrolmentApprovalAuthUser,
  type EnrolmentApprovalDependencies,
} from "./enrolment-approval-service.js";
import {
  CanonicalMemberDirectoryError,
  type CanonicalMemberDirectoryActor,
} from "./canonical-member-directory-service.js";
import { FamilyStoreError } from "../families/family-service.js";

const setup = {
  students: [
    {
      planId: "town-adult" as const,
      definitionKey: "yellow-2",
      startsOn: "2026-09-01",
      endsOn: "2026-10-01",
    },
  ],
  detailsVerified: true as const,
  paymentVerified: true as const,
};
const now = "2026-09-06T12:00:00.000Z";
const approvalKey = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
const reviewerKey = "9e8d7c6b-5a49-4382-9176-0f1e2d3c4b5a";

const actor: CanonicalMemberDirectoryActor = Object.freeze({
  actorId: "owner-1",
  academyId: "academy-1",
  role: "owner",
  active: true,
  appCheckVerified: true,
});

const applicant = {
  fullName: "Alex Adult",
  dateOfBirth: "1994-04-02",
  phoneNumber: "07700900123",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  gender: "female",
  emergencyContact: {
    fullName: "Sam Contact",
    relationship: "Sister",
    phoneNumber: "07700900999",
  },
} as const;

const minor = {
  fullName: "Robin Minor",
  dateOfBirth: "2016-05-05",
  trainingCenter: "West",
  trainingTimePreferences: ["afternoon"],
  gender: "male",
  frequencyNote: "Twice a week",
  emergencyContact: {
    fullName: "Alex Adult",
    relationship: "Parent",
    phoneNumber: "07700900123",
  },
} as const;

function record(overrides: Partial<EnrolmentRequestRecord> = {}): EnrolmentRequestRecord {
  return {
    enrolmentRequestId: "enrolment-1",
    academyId: "academy-1",
    requestId: "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11",
    status: "approving",
    applicantIsStudent: true,
    applicant,
    minors: [],
    submittedBy: "client-1",
    submittedAt: now,
    approvalRequestId: approvalKey,
    schemaVersion: "1",
    ...overrides,
  } as EnrolmentRequestRecord;
}

type Harness = Readonly<{
  dependencies: EnrolmentApprovalDependencies;
  calls: string[];
  claims: Record<string, unknown>;
}>;

function harness(
  options: Readonly<{
    record?: EnrolmentRequestRecord;
    alreadyApproved?: boolean;
    claims?: Record<string, unknown>;
    account?: Partial<EnrolmentApprovalAuthUser>;
    /** Simulates a claim write that reports success but does not land. */
    claimSticks?: boolean;
    directoryFails?: boolean;
    directoryError?: Error;
    familyError?: Error;
    onApprovalFailed?: EnrolmentApprovalDependencies["onApprovalFailed"];
  }> = {},
): Harness {
  const calls: string[] = [];
  let claims: Record<string, unknown> = {
    ...(options.claims ?? { academyId: "academy-1", role: "shopper" }),
  };
  const claimSticks = options.claimSticks ?? true;
  const stored = options.record ?? record();

  const dependencies: EnrolmentApprovalDependencies = {
    ...(options.onApprovalFailed ? { onApprovalFailed: options.onApprovalFailed } : {}),
    registration: {
      validate: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
    },
    store: {
      getForApproval: vi.fn().mockResolvedValue(stored),
      submit: vi.fn(),
      listForAcademy: vi.fn(),
      listForSubmitter: vi.fn(),
      returnForChanges: vi.fn(),
      withdraw: vi.fn(),
      beginApproval: vi.fn(async () => {
        calls.push("beginApproval");
        return { record: stored, alreadyApproved: options.alreadyApproved ?? false };
      }),
      completeApproval: vi.fn(async () => {
        calls.push("completeApproval");
        return stored;
      }),
      failApproval: vi.fn(async ({ failureCode }) => {
        calls.push(`failApproval:${failureCode}`);
        return stored;
      }),
    } as unknown as EnrolmentApprovalDependencies["store"],
    directory: {
      createAdminAdult: vi.fn(),
      updateAdminMember: vi.fn(),
      createAdminAdultForAccount: vi.fn(async () => {
        calls.push("createAdminAdultForAccount");
        if (options.directoryError) throw options.directoryError;
        if (options.directoryFails) throw new Error("directory unavailable");
        return { memberId: "student-1", studentId: "student-1" };
      }),
    } as unknown as EnrolmentApprovalDependencies["directory"],
    guardianProfiles: {
      getGuardianProfile: vi.fn(),
      saveGuardianProfile: vi.fn(async () => {
        calls.push("saveGuardianProfile");
        return {} as never;
      }),
    } as unknown as EnrolmentApprovalDependencies["guardianProfiles"],
    families: {
      createFamily: vi.fn(async () => {
        calls.push("createFamily");
        if (options.familyError) throw options.familyError;
        return {
          family: { familyId: "family-1" },
          students: [{ studentId: "student-minor-1" }],
          relationships: [],
        } as never;
      }),
      getStaffFamily: vi.fn(),
      getStaffFamilyForActor: vi.fn(),
      getGuardianFamily: vi.fn(),
      updateFamily: vi.fn(),
    } as unknown as EnrolmentApprovalDependencies["families"],
    auth: {
      getUser: async (uid) => ({
        uid,
        disabled: false,
        emailVerified: true,
        email: "Alex@Example.com",
        displayName: "Alex Adult",
        customClaims: { ...claims },
        ...options.account,
      }),
      setCustomUserClaims: async (uid, next) => {
        calls.push(`setCustomUserClaims:${String(next.role)}`);
        if (claimSticks || next.role === "shopper") claims = { ...next };
      },
      updateUser: async (_uid, data) => {
        calls.push(`updateUser:${JSON.stringify(data)}`);
      },
    },
  };

  return {
    dependencies,
    calls,
    get claims() {
      return claims;
    },
  } as Harness;
}

function approve(dependencies: EnrolmentApprovalDependencies) {
  return createEnrolmentApprovalService(dependencies).approve({
    actor,
    enrolmentRequestId: "enrolment-1",
    requestId: reviewerKey,
    setup,
    now,
  });
}

describe("enrolment approval", () => {
  it("enrols an adult applicant against their own account and then grants the role", async () => {
    const { dependencies, calls } = harness();

    const result = await approve(dependencies);

    expect(result).toMatchObject({
      role: "adultStudent",
      studentIds: ["student-1"],
      alreadyApproved: false,
    });
    // Record first, role second. An account carrying `adultStudent` with nothing behind it is
    // worse than a record whose owner cannot sign in yet, and only one of the two is recoverable
    // by retrying.
    expect(calls).toEqual([
      "beginApproval",
      "createAdminAdultForAccount",
      "setCustomUserClaims:adultStudent",
      "completeApproval",
    ]);
  });

  it("writes the canonical record under the key the request pinned, not the reviewer's new one", async () => {
    const { dependencies } = harness();

    await approve(dependencies);

    expect(dependencies.directory.createAdminAdultForAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        value: expect.objectContaining({ requestId: approvalKey, fullName: "Alex Adult" }),
        account: {
          userId: "client-1",
          displayName: "Alex Adult",
          email: "alex@example.com",
        },
      }),
    );
  });

  it("vouches for an unverified tutor before the family writer, which refuses unverified tutors", async () => {
    const { dependencies, calls } = harness({
      record: record({ applicantIsStudent: false, minors: [minor] }),
      account: { emailVerified: false },
    });

    await approve(dependencies);

    const verified = calls.indexOf('updateUser:{"emailVerified":true}');
    expect(verified).toBeGreaterThanOrEqual(0);
    expect(verified).toBeLessThan(calls.indexOf("createFamily"));
  });

  it("builds a tutor in the only order the family writer accepts", async () => {
    const { dependencies, calls } = harness({
      record: record({ applicantIsStudent: false, minors: [minor] }),
    });

    const result = await approve(dependencies);

    expect(result).toMatchObject({ role: "guardian", studentIds: ["student-minor-1"] });
    // Client document, then the claim, then the family: `createFamily` refuses a tutor who is not
    // already a `guardian` holding a client document, so this order is forced, not preferred.
    expect(calls).toEqual([
      "beginApproval",
      "saveGuardianProfile",
      "setCustomUserClaims:guardian",
      "createFamily",
      "completeApproval",
    ]);
  });

  it("carries what the applicant answered about each minor into the family write", async () => {
    const { dependencies } = harness({
      record: record({ applicantIsStudent: false, minors: [minor] }),
    });

    await approve(dependencies);

    expect(dependencies.families.createFamily).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: approvalKey,
        tutorUserId: "client-1",
        students: [
          expect.objectContaining({
            fullName: "Robin Minor",
            gender: "male",
            frequencyNote: "Twice a week",
            emergencyContact: expect.objectContaining({ relationship: "Parent" }),
          }),
        ],
      }),
    );
  });

  it("does not write a member record for the tutor, who is not a student", async () => {
    const { dependencies } = harness({
      record: record({ applicantIsStudent: false, minors: [minor] }),
    });

    await approve(dependencies);

    expect(dependencies.directory.createAdminAdultForAccount).not.toHaveBeenCalled();
  });

  it("enrols a guardian who also trains: their own record first, then the family, as guardian", async () => {
    const { dependencies, calls } = harness({
      record: record({ applicantIsStudent: true, minors: [minor] }),
    });

    const result = await approve(dependencies);

    expect(result).toMatchObject({
      role: "guardian",
      studentIds: ["student-1", "student-minor-1"],
      alreadyApproved: false,
    });
    expect(calls).toEqual([
      "beginApproval",
      "createAdminAdultForAccount",
      "saveGuardianProfile",
      "setCustomUserClaims:guardian",
      "createFamily",
      "completeApproval",
    ]);
  });

  it("restores the previous role and parks the request when the claim does not stick", async () => {
    const { dependencies, calls, claims } = harness({ claimSticks: false });

    await expect(approve(dependencies)).rejects.toMatchObject({
      failureCode: "claim_not_persisted",
    });

    expect(calls).toContain("setCustomUserClaims:shopper");
    expect(calls).toContain("failApproval:claim_not_persisted");
    expect(calls).not.toContain("completeApproval");
    expect(claims.role).toBe("shopper");
  });

  it("does not approve or grant adult access if the subscription or level cannot be saved", async () => {
    const h = harness();
    vi.mocked(h.dependencies.registration.complete).mockRejectedValueOnce(
      new Error("Synthetic write failure"),
    );
    await expect(approve(h.dependencies)).rejects.toBeInstanceOf(EnrolmentApprovalError);
    expect(h.calls).not.toContain("completeApproval");
    expect(h.claims.role).toBe("shopper");
    expect(h.dependencies.store.failApproval).toHaveBeenCalledOnce();
  });

  it("parks the request and grants no role when the canonical write fails", async () => {
    const { dependencies, calls } = harness({ directoryFails: true });

    await expect(approve(dependencies)).rejects.toBeInstanceOf(EnrolmentApprovalError);

    expect(calls).toEqual([
      "beginApproval",
      "createAdminAdultForAccount",
      "failApproval:member_write_failed",
    ]);
  });

  it("answers a second approval with what the first one created", async () => {
    const { dependencies, calls } = harness({
      alreadyApproved: true,
      record: record({ status: "approved", approvedStudentIds: ["student-1"] }),
    });

    const result = await approve(dependencies);

    expect(result).toMatchObject({ alreadyApproved: true, studentIds: ["student-1"] });
    expect(calls).toEqual(["beginApproval"]);
  });

  it("refuses to enrol an account the academy granted a staff role", async () => {
    // Promoting one would overwrite the role the academy granted, through a door meant for the
    // public. The request is parked rather than approved.
    const { dependencies, calls } = harness({ claims: { academyId: "academy-1", role: "coach" } });

    await expect(approve(dependencies)).rejects.toMatchObject({
      failureCode: "applicant_role_not_client",
    });
    expect(calls).toContain("failApproval:applicant_role_not_client");
  });

  it("refuses an account belonging to another academy", async () => {
    const { dependencies } = harness({ claims: { academyId: "academy-2", role: "shopper" } });

    await expect(approve(dependencies)).rejects.toMatchObject({
      code: "unauthorized",
      failureCode: "applicant_other_academy",
    });
  });

  it("stops before any write when the account has no name or email to build a client record from", async () => {
    // `parseUserProfile` requires both, and a member without a client document is half-enrolled -
    // for a tutor it blocks their children entirely.
    const { dependencies, calls } = harness({ account: { displayName: "  " } });

    await expect(approve(dependencies)).rejects.toMatchObject({
      failureCode: "applicant_account_incomplete",
    });
    expect(calls).not.toContain("createAdminAdultForAccount");
  });

  it("enrols an applicant who never verified their email and marks the address verified", async () => {
    // D8 (2026-09-23): no email verification anywhere; the office approval vouches for the account.
    const { dependencies, calls } = harness({ account: { emailVerified: false } });

    const result = await approve(dependencies);

    expect(result.role).toBe("adultStudent");
    expect(calls).toContain('updateUser:{"emailVerified":true}');
  });

  it("refuses a disabled applicant account", async () => {
    const { dependencies } = harness({ account: { disabled: true } });

    await expect(approve(dependencies)).rejects.toMatchObject({
      failureCode: "applicant_account_disabled",
    });
  });

  it("refuses an actor who is not office, before touching the request", async () => {
    const { dependencies, calls } = harness();

    await expect(
      createEnrolmentApprovalService(dependencies).approve({
        actor: { ...actor, role: "coach" },
        enrolmentRequestId: "enrolment-1",
        requestId: reviewerKey,
        setup,
        now,
      }),
    ).rejects.toMatchObject({ code: "unauthorized", failureCode: "actor_not_office" });
    expect(calls).toEqual([]);
  });
});

describe("enrolment approval at the member directory bound", () => {
  const canonicalFull = () =>
    new CanonicalMemberDirectoryError(
      "unavailable",
      "Member directory rollback capacity is exhausted",
      "directory_capacity_exhausted",
    );
  const familyFull = () =>
    new FamilyStoreError(
      "precondition",
      "Member directory rollback capacity is exhausted",
      "directory_capacity_exhausted",
    );

  it("parks an adult under its own failure code and tells office how to resume", async () => {
    const h = harness({ directoryError: canonicalFull() });

    await expect(approve(h.dependencies)).rejects.toMatchObject({
      code: "precondition",
      failureCode: "directory_capacity_exhausted",
      message: expect.stringContaining("approve it again"),
    });
    expect(h.calls).toEqual([
      "beginApproval",
      "createAdminAdultForAccount",
      "failApproval:directory_capacity_exhausted",
    ]);
    expect(h.claims.role).toBe("shopper");
  });

  it("names a family refusal that comes after the guardian's own record was saved", async () => {
    const { dependencies, calls } = harness({
      record: record({ applicantIsStudent: true, minors: [minor] }),
      familyError: familyFull(),
    });

    await expect(approve(dependencies)).rejects.toMatchObject({
      code: "precondition",
      failureCode: "directory_capacity_exhausted",
    });
    // The adult record, guardian profile and claim stay under the pinned key; a retry replays them.
    expect(calls).toEqual([
      "beginApproval",
      "createAdminAdultForAccount",
      "saveGuardianProfile",
      "setCustomUserClaims:guardian",
      "createFamily",
      "failApproval:directory_capacity_exhausted",
    ]);
  });

  it.each([
    {
      flow: "adult",
      options: {
        directoryError: new CanonicalMemberDirectoryError(
          "unavailable",
          "Member directory restore guard is missing",
        ),
      },
      slug: "member_write_failed",
    },
    {
      flow: "family",
      options: {
        record: record({ applicantIsStudent: false, minors: [minor] }),
        familyError: new FamilyStoreError("precondition", "Tutor Auth identity mismatch"),
      },
      slug: "family_write_failed",
    },
  ])(
    "keeps the stage slug for another $flow refusal sharing the writer's code",
    async ({ options, slug }) => {
      const { dependencies, calls } = harness(options);

      await expect(approve(dependencies)).rejects.toMatchObject({
        code: "unavailable",
        failureCode: slug,
      });
      expect(calls).toContain(`failApproval:${slug}`);
    },
  );

  it("reports the stopped approval to operators as metadata only", async () => {
    const onApprovalFailed = vi.fn();
    const { dependencies } = harness({ directoryError: canonicalFull(), onApprovalFailed });

    await expect(approve(dependencies)).rejects.toBeInstanceOf(EnrolmentApprovalError);

    expect(onApprovalFailed).toHaveBeenCalledOnce();
    expect(onApprovalFailed).toHaveBeenCalledWith({
      academyId: "academy-1",
      enrolmentRequestId: "enrolment-1",
      stage: "member",
      failureCode: "directory_capacity_exhausted",
      cause: "CanonicalMemberDirectoryError",
      causeCode: "unavailable",
    });
    // Neither what the applicant typed nor the writer's own text reaches the log line.
    expect(JSON.stringify(onApprovalFailed.mock.calls)).not.toMatch(
      /Alex|example\.com|07700|1994-04-02|capacity is exhausted/iu,
    );
  });

  it.each([
    {
      name: "Alex Adult 07700900123",
      code: "unavailable",
      cause: "unknown",
      causeCode: "unavailable",
    },
    { name: "Error", code: "alex@example.com", cause: "Error" },
    { name: "TypeError", code: "Alex Adult 1994-04-02", cause: "TypeError" },
  ])(
    "logs only listed error names and codes ($name / $code)",
    async ({ name, code, ...expected }) => {
      const onApprovalFailed = vi.fn();
      const odd = Object.assign(new Error("Alex Adult, alex@example.com"), { code });
      odd.name = name;
      const { dependencies } = harness({ directoryError: odd, onApprovalFailed });

      await expect(approve(dependencies)).rejects.toMatchObject({
        failureCode: "member_write_failed",
      });
      expect(onApprovalFailed).toHaveBeenCalledWith({
        academyId: "academy-1",
        enrolmentRequestId: "enrolment-1",
        stage: "member",
        failureCode: "member_write_failed",
        ...expected,
      });
      expect(JSON.stringify(onApprovalFailed.mock.calls)).not.toMatch(
        /Alex|example\.com|07700|1994-04-02/iu,
      );
    },
  );

  it("resumes under the pinned key once the directory has room again", async () => {
    const h = harness();
    const write = vi.mocked(h.dependencies.directory.createAdminAdultForAccount);
    write.mockRejectedValueOnce(canonicalFull());

    await expect(approve(h.dependencies)).rejects.toMatchObject({
      failureCode: "directory_capacity_exhausted",
    });
    await expect(approve(h.dependencies)).resolves.toMatchObject({ studentIds: ["student-1"] });

    const keys = write.mock.calls.map(([{ value }]) =>
      typeof value === "object" && value !== null && "requestId" in value ? value.requestId : null,
    );
    expect(keys).toEqual([approvalKey, approvalKey]);
    expect(h.calls).toContain("completeApproval");
  });
});
