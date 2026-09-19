import { describe, expect, it, vi } from "vitest";
import {
  reportCounters,
  reportScriptError,
  SafeScriptError,
  resolveTarget as reportTarget,
} from "../scripts/member-unification-s1-report.mjs";
import {
  resolveTarget as revertTarget,
  revertConfirmation,
  revertPlan,
  runRevert,
} from "../scripts/member-unification-s1-revert.mjs";

describe("member unification S1 scripts", () => {
  it.each([reportTarget, revertTarget])(
    "prints safe guard messages but redacts SDK errors",
    (resolve) => {
      const output = vi.spyOn(console, "error").mockImplementation(() => {});
      const exitCode = process.exitCode;
      try {
        let guard: unknown;
        try {
          resolve({});
        } catch (error) {
          guard = error;
        }
        expect(guard).toBeInstanceOf(SafeScriptError);
        reportScriptError(guard);
        expect(output).toHaveBeenLastCalledWith(
          "errors: 1 — S1_TARGET must be emulator or production",
        );
        expect(process.exitCode).toBe(1);
        output.mockClear();
        reportScriptError(new Error("SDK failed at academies/synthetic/students/private-person"));
        expect(output.mock.calls).toEqual([["errors: 1"]]);
      } finally {
        process.exitCode = exitCode;
        output.mockRestore();
      }
    },
  );

  it("enforces both scripts' target guards and literal opt-in without initializing Firebase", () => {
    for (const resolve of [reportTarget, revertTarget]) {
      expect(() => resolve({})).toThrow();
      for (const host of [
        undefined,
        "10.0.0.5:8080",
        "localhost.evil:8080",
        "127.0.0.1:8080/path",
      ]) {
        expect(() => resolve({ S1_TARGET: "emulator", FIRESTORE_EMULATOR_HOST: host })).toThrow();
      }
      for (const host of ["127.0.0.1:8080", "localhost:8080", "[::1]:8080"]) {
        expect(resolve({ S1_TARGET: "emulator", FIRESTORE_EMULATOR_HOST: host })).toMatchObject({
          projectId: "demo-bpt-jersey",
        });
      }
      for (const host of ["", "127.0.0.1:8080"]) {
        expect(() =>
          resolve({
            S1_TARGET: "production",
            GCLOUD_PROJECT: "bptjersey-f5a25",
            FIRESTORE_EMULATOR_HOST: host,
          }),
        ).toThrow();
      }
      expect(() => resolve({ S1_TARGET: "production", GCLOUD_PROJECT: "other" })).toThrow();
    }
    const base = { S1_TARGET: "production", GCLOUD_PROJECT: "bptjersey-f5a25" };
    for (const apply of [undefined, "true", "YES", "yes "]) {
      expect(revertTarget({ ...base, S1_REVERT_APPLY: apply }).apply).toBe(false);
    }
    expect(() =>
      revertTarget({
        ...base,
        S1_REVERT_APPLY: "yes",
        MEMBER_UNIFICATION_CONFIRMATION: `${revertConfirmation} `,
      }),
    ).toThrow();
    expect(
      revertTarget({
        S1_TARGET: "emulator",
        FIRESTORE_EMULATOR_HOST: "localhost:8080",
        S1_REVERT_APPLY: "yes",
      }).apply,
    ).toBe(true);
  });

  it("rejects rollback paths containing extra segments before any write", () => {
    expect(() =>
      revertPlan({
        decisions: [
          {
            id: "synthetic",
            migrationId: "member-unification-s1-2026-09",
            studentId: "s/extra/segment",
          },
        ],
        identityKeys: [],
        officeLinks: [],
      }),
    ).toThrow("Invalid rollback document segment");
  });
  it("dry-runs without writes and applies at most 400 deletes per batch, then recounts", async () => {
    const documents = new Map(
      Array.from({ length: 401 }, (_, index) => [
        `memberMigrationDecisions/skip-${index}`,
        { migrationId: "member-unification-s1-2026-09", kind: "skip" },
      ]),
    );
    const commits: number[] = [];
    const collections: string[] = [];
    const store = {
      collection: (path: string) => {
        collections.push(path);
        const name = path.split("/")[2];
        return {
          get: async () => ({
            docs: [...documents]
              .filter(([key]) => key.startsWith(`${name}/`))
              .map(([key, data]) => ({ id: key.slice(key.indexOf("/") + 1), data: () => data })),
          }),
        };
      },
      doc: (path: string) => ({ path }),
      batch: vi.fn(() => {
        const pending: string[] = [];
        return {
          delete: ({ path }: { path: string }) => {
            pending.push(path);
          },
          commit: async () => {
            commits.push(pending.length);
            for (const path of pending) documents.delete(path.split("/").slice(2).join("/"));
          },
        };
      }),
    };
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runRevert(store, "academies/synthetic", false);
      expect(store.batch).not.toHaveBeenCalled();
      expect(documents.size).toBe(401);
      expect(output.mock.calls.map(([line]) => line)).toContain("memberMigrationDecisions: 401");
      output.mockClear();
      await runRevert(store, "academies/synthetic", true);
      expect(commits).toEqual([400, 1]);
      expect(documents.size).toBe(0);
      expect(output.mock.calls.map(([line]) => line)).toContain(
        "remainingMemberMigrationDecisions: 0",
      );
      expect(output.mock.calls.every(([line]) => /^[A-Za-z]+: \d+$/.test(String(line)))).toBe(true);
      expect(new Set(collections)).toEqual(
        new Set([
          "academies/synthetic/memberMigrationDecisions",
          "academies/synthetic/studentIdentityKeys",
          "academies/synthetic/regyfitOfficeLinks",
        ]),
      );
    } finally {
      output.mockRestore();
    }
  });
  it("reports the queue and normalized identifier counters without personal data", () => {
    expect(
      reportCounters(
        {
          members: [
            {
              memberId: "a",
              fullName: "Synthetic Adult",
              membershipNumber: "1",
              birthDate: "1990-01-01",
            },
            {
              memberId: "Ａ",
              fullName: "Synthetic Adult Two",
              membershipNumber: "2",
              trainingCenter: "Town",
              birthDate: "1990-01-01",
            },
            { memberId: "bad_!", fullName: "Synthetic Child", birthDate: "2020-01-01" },
            { memberId: "suggestion", fullName: "Synthetic Suggested", birthDate: "1990-01-01" },
            {
              memberId: "ambiguous",
              fullName: "Synthetic Ambiguous",
              membershipNumber: "3",
              birthDate: "1990-01-01",
            },
            { memberId: "decided", fullName: "Synthetic Decided" },
            { memberId: "linked", fullName: "Synthetic Linked", membershipNumber: "4" },
            { memberId: "linked2", fullName: "Synthetic Linked Two", membershipNumber: "5" },
          ],
          records: [
            { recordId: "1", fullName: "Synthetic Adult", memberNumber: "1" },
            { recordId: "2", fullName: "Synthetic Adult Two", memberNumber: "2" },
            { recordId: "3", fullName: "Synthetic Suggested", birthDate: "1990-01-01" },
            { recordId: "4", fullName: "Synthetic Duplicate", memberNumber: "3" },
            { recordId: "5", fullName: "Synthetic Duplicate Two", memberNumber: "3" },
            { recordId: "6", fullName: "Synthetic Archive Only" },
            { recordId: "7", fullName: "Synthetic Linked", memberNumber: "4" },
            { recordId: "8", fullName: "Synthetic Linked Two", memberNumber: "5" },
          ],
          decidedMemberIds: new Set(["decided"]),
          linkedRecordIds: new Set(["7", "8"]),
          state: {
            readerVersion: "canonical-v1",
            rollbackEligibleStudentCount: 245,
            rollbackCapacityLimit: 400,
          },
        },
        "2026-09-19",
      ),
    ).toEqual({
      members: 8,
      archiveRecords: 8,
      decided: 1,
      strong: 2,
      suggested: 1,
      ambiguous: 1,
      none: 3,
      minorOrUndated: 3,
      archiveOnly: 1,
      invalidLegacyIds: 1,
      legacyIdCaseCollisions: 1,
      strongWithoutCentre: 1,
      readerVersion: "canonical-v1",
      rollbackEligibleStudentCount: 245,
      rollbackCapacityLimit: 400,
    });
  });
  it("plans only S1-owned paths, including skips, and preserves unrelated documents", () => {
    expect(
      revertPlan({
        decisions: [
          {
            id: "linked",
            migrationId: "member-unification-s1-2026-09",
            kind: "link",
            studentId: "s1",
          },
          { id: "skipped", migrationId: "member-unification-s1-2026-09", kind: "skip" },
          { id: "other", migrationId: "other", kind: "link", studentId: "prior" },
        ],
        identityKeys: [
          { id: "key1", ownerStudentId: "s1" },
          { id: "key2", ownerStudentId: "s1" },
          { id: "prior-key", ownerStudentId: "prior" },
        ],
        officeLinks: [
          { id: "101", studentId: "s1" },
          { id: "102", studentId: "prior" },
        ],
      }),
    ).toEqual([
      "students/s1",
      "studentAdminProfiles/s1",
      "families/office-s1",
      "studentIdentityKeys/key1",
      "studentIdentityKeys/key2",
      "regyfitOfficeLinks/101",
      "memberMigrationDecisions/linked",
      "memberMigrationDecisions/skipped",
    ]);
    expect(
      revertPlan({
        decisions: [{ id: "other", migrationId: "other", studentId: "prior" }],
        identityKeys: [{ id: "prior-key", ownerStudentId: "prior" }],
        officeLinks: [{ id: "102", studentId: "prior" }],
      }),
    ).toEqual([]);
  });
  it("only reach production with the exact project id and never with an emulator host set", () => {
    expect(() => reportTarget({ S1_TARGET: "production", GCLOUD_PROJECT: "other" })).toThrow();
    expect(() =>
      reportTarget({
        S1_TARGET: "production",
        GCLOUD_PROJECT: "bptjersey-f5a25",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toThrow();
    expect(
      reportTarget({ S1_TARGET: "production", GCLOUD_PROJECT: "bptjersey-f5a25" }),
    ).toMatchObject({ projectId: "bptjersey-f5a25" });
    expect(() =>
      reportTarget({ S1_TARGET: "emulator", FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080" }),
    ).toThrow();
  });
  it("applies a production revert only with the literal confirmation", () => {
    const base = {
      S1_TARGET: "production",
      GCLOUD_PROJECT: "bptjersey-f5a25",
      S1_REVERT_APPLY: "yes",
    };
    expect(() => revertTarget(base)).toThrow();
    expect(
      revertTarget({ ...base, MEMBER_UNIFICATION_CONFIRMATION: revertConfirmation }),
    ).toMatchObject({ apply: true });
    expect(revertConfirmation).toBe("member-unification-s1-revert-v1");
  });
});
