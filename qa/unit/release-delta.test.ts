import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectWebCallableNames,
  computeReleaseDelta,
  GOOGLE_CLOUD_PROJECT_ID,
  isCloudFunctionDeclaration,
  listCloudFunctionExports,
  main,
  parseDeployedFunctions,
  parseIndexExports,
  renderReleaseDelta,
} from "../../scripts/release-delta.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const functionsSource = path.join(repositoryRoot, "apps/functions/src");

const scratchDirectories: string[] = [];

function scratchDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "release-delta-"));
  scratchDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("parseIndexExports", () => {
  it("resolves aliases, spans lines, drops type exports and maps the module to its .ts file", () => {
    const source = `
      export { a, b as c } from "./x.js";
      export type { Thing } from "./x.js";
      export {
        d,
        e as f,
      } from "./dir/y.js";
    `;

    expect(parseIndexExports(source)).toEqual([
      { name: "a", local: "a", module: "x.ts" },
      { name: "c", local: "b", module: "x.ts" },
      { name: "d", local: "d", module: "dir/y.ts" },
      { name: "f", local: "e", module: "dir/y.ts" },
    ]);
  });
});

describe("listCloudFunctionExports", () => {
  it("keeps only exports declared with a firebase-functions trigger factory", () => {
    const index = `export { listMembers, requireAdminActor, cleanupSchedule as cleanup } from "./m.js";`;
    const moduleSource = `
      export function requireAdminActor() {}
      export const listMembers = onCall(options, handler);
      export const cleanupSchedule = onSchedule(
        { schedule: "every 60 minutes" },
        handler,
      );
    `;

    expect(listCloudFunctionExports(index, () => moduleSource)).toEqual({
      names: ["cleanup", "listMembers"],
      skipped: ["requireAdminActor"],
    });
    expect(isCloudFunctionDeclaration(moduleSource, "listMembers")).toBe(true);
    expect(isCloudFunctionDeclaration(moduleSource, "requireAdminActor")).toBe(false);
  });

  it("reads the real index.ts and skips the helpers it re-exports", () => {
    // Guards the parser against a refactor of index.ts or of the declaration style: if either
    // changes, the release delta would silently report every deployed function as orphaned.
    const { names, skipped } = listCloudFunctionExports(
      readFileSync(path.join(functionsSource, "index.ts"), "utf8"),
      (module) => readFileSync(path.join(functionsSource, module), "utf8"),
    );

    expect(names.length).toBeGreaterThan(100);
    expect(names).toContain("listMembers");
    expect(names).toContain("createMember");
    expect(names).toContain("cleanupExpiredMemberImportSessionsSchedule");
    expect(names).not.toContain("createCanonicalMember");
    expect(skipped).toEqual([
      "assertAcademyScope",
      "bootstrapEmulatorOwner",
      "getRegyfitProjectionScope",
      "provisionAdminRole",
      "requireAdminActor",
    ]);
  });
});

describe("collectWebCallableNames", () => {
  it("counts a name only from files that use httpsCallable", () => {
    const root = scratchDirectory();
    mkdirSync(path.join(root, "lib"));
    mkdirSync(path.join(root, "app"));
    writeFileSync(
      path.join(root, "lib", "members-client.ts"),
      `import { httpsCallable } from "firebase/functions";
       const list = httpsCallable<null, unknown>(getFirebaseFunctions(), "listMembers");
       const detail = call<{ id: string }, unknown>(
         "getMemberDetail",
       );`,
    );
    // A route label that happens to equal a callable name must not count as an invocation.
    writeFileSync(
      path.join(root, "app", "page.tsx"),
      `const tab = "checkIn"; const x = "listMembers";`,
    );
    writeFileSync(
      path.join(root, "lib", "members-client.test.ts"),
      `import { httpsCallable } from "firebase/functions"; const y = "withdrawEnrolmentRequest";`,
    );

    const invoked = collectWebCallableNames(root, [
      "listMembers",
      "getMemberDetail",
      "checkIn",
      "withdrawEnrolmentRequest",
    ]);

    expect([...invoked.entries()]).toEqual([
      ["getMemberDetail", ["lib/members-client.ts"]],
      ["listMembers", ["lib/members-client.ts"]],
    ]);
  });
});

describe("main", () => {
  const silent = { write: () => true };

  it("refuses a --project value that is not a Google Cloud project id before spawning anything", () => {
    // The Windows spawn goes through the shell, so a project id is the only thing allowed there.
    expect(() =>
      main(["--project", "bptjersey-f5a25 & calc"], { repositoryRoot, stdout: silent }),
    ).toThrow(/Google Cloud project id/u);
    expect(GOOGLE_CLOUD_PROJECT_ID.test("bptjersey-f5a25")).toBe(true);
    expect(GOOGLE_CLOUD_PROJECT_ID.test("demo-bpt-jersey")).toBe(true);
  });

  it("requires exactly one source of the deployed list and rejects unknown flags", () => {
    expect(() => main([], { repositoryRoot, stdout: silent })).toThrow(/exactly one/u);
    expect(() =>
      main(["--deployed", "x.json", "--project", "demo-bpt-jersey"], {
        repositoryRoot,
        stdout: silent,
      }),
    ).toThrow(/exactly one/u);
    expect(() => main(["--verbose"], { repositoryRoot, stdout: silent })).toThrow(
      /Unknown argument/u,
    );
    expect(() =>
      main(["--deployed", "x.json", "--ref", "--upload-pack=evil"], {
        repositoryRoot,
        stdout: silent,
      }),
    ).toThrow(/needs a value|git branch/u);
  });

  it("keeps everything after the first '=' as the flag value", () => {
    const root = scratchDirectory();
    const listing = path.join(root, "a=b", "list.json");
    mkdirSync(path.dirname(listing));
    writeFileSync(listing, JSON.stringify([{ id: "listMembers", callableTrigger: {} }]));
    let output = "";

    const delta = main([`--deployed=${listing}`], {
      repositoryRoot,
      stdout: { write: (chunk: string) => (output += chunk) },
    });

    expect(delta.deployedCount).toBe(1);
    expect(output).toContain("| listMembers | callable | unknown | - |");
  });
});

describe("parseDeployedFunctions", () => {
  const listing = JSON.stringify({
    status: "success",
    result: [
      {
        id: "listMembers",
        region: "us-central1",
        callableTrigger: {},
        source: { storageSource: { generation: "1788768520072558" } },
        secretEnvironmentVariables: [
          { key: "MEMBER_DIRECTORY_CURSOR_SECRET" },
          { key: "MEMBER_DIRECTORY_IDENTITY_KEY_SECRET" },
        ],
      },
      {
        id: "cleanupExpiredMemberImportSessionsSchedule",
        region: "us-central1",
        scheduleTrigger: { schedule: "every 60 minutes" },
      },
    ],
  });

  it("reads id, trigger, deploy time and bound secrets", () => {
    expect(parseDeployedFunctions(listing)).toEqual([
      {
        id: "cleanupExpiredMemberImportSessionsSchedule",
        region: "us-central1",
        trigger: "scheduled",
        deployedAt: "",
        secrets: [],
      },
      {
        id: "listMembers",
        region: "us-central1",
        trigger: "callable",
        deployedAt: "2026-09-07T08:08:40.072Z",
        secrets: ["MEMBER_DIRECTORY_CURSOR_SECRET", "MEMBER_DIRECTORY_IDENTITY_KEY_SECRET"],
      },
    ]);
  });
});

describe("computeReleaseDelta", () => {
  const deployed = parseDeployedFunctions(
    JSON.stringify([
      { id: "listMembers", callableTrigger: {} },
      { id: "searchMembers", callableTrigger: {} },
    ]),
  );
  const webCallables = new Map([
    ["listMembers", ["lib/members-client.ts"]],
    ["submitEnrolmentRequest", ["lib/enrolment-client.ts"]],
  ]);
  const exportNames = ["listMembers", "submitEnrolmentRequest", "createTenantBackup"];

  it("separates the three gaps", () => {
    const delta = computeReleaseDelta({
      exportNames,
      webCallables,
      deployed,
      skippedExports: ["requireAdminActor"],
    });

    expect(delta).toEqual({
      exportedCount: 3,
      deployedCount: 2,
      webInvokedCount: 2,
      webMissing: [{ name: "submitEnrolmentRequest", files: ["lib/enrolment-client.ts"] }],
      codeMissing: ["submitEnrolmentRequest", "createTenantBackup"],
      orphaned: [
        { id: "searchMembers", region: "", trigger: "callable", deployedAt: "", secrets: [] },
      ],
      skippedExports: ["requireAdminActor"],
    });
  });

  it("renders every section, including the deletion warning for orphans", () => {
    const report = renderReleaseDelta(
      computeReleaseDelta({ exportNames, webCallables, deployed, skippedExports: ["helper"] }),
      deployed,
    );

    expect(report).toContain("not Cloud Functions, ignored: helper");
    expect(report).toContain("Invoked by the web but not deployed (1)");
    expect(report).toContain("- submitEnrolmentRequest (lib/enrolment-client.ts)");
    expect(report).toContain("would delete these (1)");
    expect(report).toContain("- searchMembers (callable, deployed unknown)");
    expect(report).toContain("| listMembers | callable | unknown | - |");
  });
});
