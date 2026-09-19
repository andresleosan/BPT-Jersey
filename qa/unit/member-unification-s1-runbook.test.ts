import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runbookPath = "docs/operations/member-unification-s1-runbook.md";
const readRunbook = () => readFileSync(runbookPath, "utf8");
const commands = () =>
  [...readRunbook().matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]!);

describe("S1 operator runbook safety contract", () => {
  it("provides syntactically valid Bash without executing any operation", () => {
    const blocks = commands();
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const result = spawnSync("bash", ["--noprofile", "--norc", "-n"], {
        input: block,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
    }
  });

  it("scopes production explicitly and uses the scripts' environment contract", () => {
    const shell = commands().join("\n");
    expect(shell).toContain('GOOGLE_APPLICATION_CREDENTIALS="$(ls /root/secrets/*adminsdk*.json)"');
    expect(shell).toContain("GCLOUD_PROJECT=bptjersey-f5a25");
    expect(shell).toContain("S1_TARGET=production");
    expect(shell).toContain("S1_ACADEMY_ID=demo-academy");
    expect(shell).toContain("unset FIRESTORE_EMULATOR_HOST");
    const reversals = commands().filter((block) =>
      block.includes("qa/scripts/member-unification-s1-revert.mjs"),
    );
    expect(reversals.length).toBeGreaterThanOrEqual(2);
    for (const block of reversals) {
      if (block.includes("S1_REVERT_APPLY=yes")) {
        expect(block).toContain("MEMBER_UNIFICATION_CONFIRMATION=member-unification-s1-revert-v1");
      } else {
        expect(block).toContain("S1_REVERT_APPLY=no");
      }
      expect(block).not.toContain("--apply");
    }
  });

  it("deploys exactly the four callables before publishing main, without force", () => {
    const shell = commands()
      .join("\n")
      .replace(/[ \t]*\\\n\s*/g, " ");
    const deploys = shell.split("\n").filter((line) => line.includes("firebase deploy"));
    expect(deploys).toEqual([
      "corepack pnpm exec firebase deploy --project bptjersey-f5a25 --only functions:listMemberMigrationQueue,functions:decideMemberMigration,functions:assignMemberGuardian,functions:setMemberDateOfBirth",
    ]);
    expect(shell).toContain("git merge-base --is-ancestor origin/main HEAD");
    expect(shell).toContain("push origin HEAD:main");
    expect(shell.indexOf("firebase deploy")).toBeLessThan(shell.indexOf("push origin HEAD:main"));
    expect(shell).not.toMatch(/(?:^|\s)(?:--force(?:-with-lease)?|reset --hard|ln -s)(?:\s|$)/m);
    expect(shell).toContain("test ! -L apps/functions/.env");
  });

  it("states the stop conditions and irreversible capacity limit", () => {
    const runbook = readRunbook();
    for (const condition of [
      "invalidLegacyIds: 0",
      "unparsableMembers: 0",
      "unparsableRecords: 0",
      "invalidIdentifiers",
      "invalid-member-data",
      "queue unavailable",
      "legacyIdCaseCollisions: 0",
      "readerVersion: canonical-v1",
      "rollbackEligibleStudentCount + strong + suggested + none",
      "rollbackCapacityLimit",
      "400",
      "no baja",
      "Guardian required",
      "Check age",
      "pendingGuardian",
      "pendingDateOfBirth",
      "selfCheckIn",
    ]) {
      expect(runbook).toContain(condition);
    }
    expect(runbook).toContain("⚠️");
    expect(runbook).toContain("📍 Terminal del VPS · root · `/root/BPT-Jersey`");
  });
});
