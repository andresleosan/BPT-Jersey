import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { createInMemoryLevelStore, type LevelCatalogStore } from "./level-service";
import {
  assertLevelSeedTargetEnvironment,
  rollbackLevelCatalog,
  seedLevelCatalog,
  type LevelSeedTargetEnvironment,
} from "./level-seed";

const emulatorEnvironment = (): LevelSeedTargetEnvironment => ({
  gcloudProjectId: "demo-bpt-jersey",
  firebaseConfig: JSON.stringify({ projectId: "demo-bpt-jersey" }),
  firestoreEmulatorHost: "127.0.0.1:8080",
});

describe("Level Seed Guard and Execution", () => {
  it("refuses production target", async () => {
    const store = createInMemoryLevelStore();

    await expect(
      seedLevelCatalog({
        target: "production" as unknown as "emulator",
        academyId: "demo-academy",
        environment: emulatorEnvironment(),
        store,
      }),
    ).rejects.toThrow(/Production seed is strictly prohibited/);
  });

  it("keeps staging closed while no exact project is allowlisted", async () => {
    const store = createInMemoryLevelStore();

    await expect(
      seedLevelCatalog({
        target: "staging",
        academyId: "demo-academy",
        confirmation: "T083-LEVELS-SEED",
        environment: {
          gcloudProjectId: "bpt-jersey-staging",
          firebaseConfig: JSON.stringify({ projectId: "bpt-jersey-staging" }),
        },
        store,
      }),
    ).rejects.toThrow(/Level seed target is not safe/);
  });

  it("binds emulator to the demo project and exact Firestore host", () => {
    expect(assertLevelSeedTargetEnvironment("emulator", emulatorEnvironment())).toEqual({
      projectId: "demo-bpt-jersey",
      target: "emulator",
    });

    expect(() =>
      assertLevelSeedTargetEnvironment("emulator", {
        ...emulatorEnvironment(),
        firestoreEmulatorHost: "firestore.example.test:443",
      }),
    ).toThrow(/Level seed target is not safe/);
    expect(() =>
      assertLevelSeedTargetEnvironment("emulator", {
        ...emulatorEnvironment(),
        gcloudProjectId: "bpt-jersey-staging",
      }),
    ).toThrow(/Level seed target is not safe/);
  });

  it("rejects production and inconsistent project identities from every source", () => {
    const unsafeEnvironments: readonly LevelSeedTargetEnvironment[] = [
      { ...emulatorEnvironment(), gcloudProjectId: "bptjersey-f5a25" },
      {
        ...emulatorEnvironment(),
        firebaseConfig: JSON.stringify({ projectId: "bptjersey-f5a25" }),
      },
      { ...emulatorEnvironment(), existingAppProjectId: "bptjersey-f5a25" },
      {
        ...emulatorEnvironment(),
        firebaseConfig: JSON.stringify({ projectId: "another-project" }),
      },
      {
        ...emulatorEnvironment(),
        existingAppPresent: true,
      },
    ];

    for (const environment of unsafeEnvironments) {
      expect(() => assertLevelSeedTargetEnvironment("emulator", environment)).toThrow(
        /Level seed target is not safe/,
      );
    }
  });

  it("rejects an unsafe destination before seed or rollback touches the store", async () => {
    const seed = vi.fn();
    const rollback = vi.fn();
    const store = { seed, rollback } as unknown as LevelCatalogStore;
    const environment: LevelSeedTargetEnvironment = {
      ...emulatorEnvironment(),
      gcloudProjectId: "bptjersey-f5a25",
    };

    await expect(
      seedLevelCatalog({
        target: "emulator",
        academyId: "demo-academy",
        environment,
        store,
        customObserved: observedJson,
        customBusiness: businessCriteriaJson,
      }),
    ).rejects.toThrow(/Level seed target is not safe/);
    await expect(
      rollbackLevelCatalog({
        target: "emulator",
        academyId: "demo-academy",
        systemId: "ibjjf-v1",
        environment,
        store,
      }),
    ).rejects.toThrow(/Level seed target is not safe/);
    expect(seed).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("guards the CLI destination before Admin SDK initialization", () => {
    const runner = readFileSync(new URL("../../scripts/seed-levels.mjs", import.meta.url), "utf8");
    const guardPosition = runner.indexOf("const targetBinding = assertLevelSeedTargetEnvironment");
    const confirmationPosition = runner.indexOf("assertLevelSeedConfirmation(");
    const appModulePosition = runner.indexOf(
      'const firebaseApp = await import("firebase-admin/app")',
    );
    const verifiedBindingPosition = runner.indexOf(
      "const verifiedBinding = assertLevelSeedTargetEnvironment",
    );
    const operationalRuntimePosition = runner.indexOf("const [firebaseFirestore");
    const initializePosition = runner.indexOf("const app =");

    expect(guardPosition).toBeGreaterThan(-1);
    expect(confirmationPosition).toBeGreaterThan(guardPosition);
    expect(appModulePosition).toBeGreaterThan(confirmationPosition);
    expect(appModulePosition).toBeGreaterThan(guardPosition);
    expect(verifiedBindingPosition).toBeGreaterThan(appModulePosition);
    expect(operationalRuntimePosition).toBeGreaterThan(verifiedBindingPosition);
    expect(initializePosition).toBeGreaterThan(verifiedBindingPosition);
    expect(runner).not.toContain('process.env.GCLOUD_PROJECT ?? "demo-bpt-jersey"');
  });

  it("executes the production preflight before loading the operational runtime", () => {
    const safeEnvironment = { ...process.env };
    delete safeEnvironment.DEBUG;
    delete safeEnvironment.GOOGLE_APPLICATION_CREDENTIALS;
    delete safeEnvironment.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../../scripts/seed-levels.mjs", import.meta.url)),
        "--target=staging",
        "--academy-id=demo-academy",
        "--confirmation=T083-LEVELS-SEED",
      ],
      {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
        encoding: "utf8",
        env: {
          ...safeEnvironment,
          FIREBASE_CONFIG: JSON.stringify({ projectId: "bptjersey-f5a25" }),
          GCLOUD_PROJECT: "bptjersey-f5a25",
          NODE_ENV: "test",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Level seed target is not safe.");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("keeps the standalone CLI preflight aligned with the service guard", async () => {
    // The standalone preflight must be plain ESM so Node can run it before loading Firebase.
    // @ts-expect-error The operational script intentionally has no generated declaration.
    const cliGuard = (await import("../../scripts/level-seed-target.mjs"))
      .assertLevelSeedTargetEnvironment as (
      target: string,
      environment: LevelSeedTargetEnvironment,
    ) => Readonly<{ target: string; projectId: string }>;
    expect(cliGuard("emulator", emulatorEnvironment())).toEqual(
      assertLevelSeedTargetEnvironment("emulator", emulatorEnvironment()),
    );

    const unsafeEnvironments: readonly LevelSeedTargetEnvironment[] = [
      { ...emulatorEnvironment(), gcloudProjectId: "bptjersey-f5a25" },
      { ...emulatorEnvironment(), firestoreEmulatorHost: "localhost:8080" },
      { ...emulatorEnvironment(), nodeEnvironment: "production" },
      {
        ...emulatorEnvironment(),
        firebaseConfig: JSON.stringify({ projectId: "another-project" }),
      },
    ];
    for (const environment of unsafeEnvironments) {
      expect(() => cliGuard("emulator", environment)).toThrow(/Level seed target is not safe/);
      expect(() => assertLevelSeedTargetEnvironment("emulator", environment)).toThrow(
        /Level seed target is not safe/,
      );
    }
  });

  it("rejects ambiguous, unsupported, or misleading CLI options", async () => {
    // @ts-expect-error The operational script intentionally has no generated declaration.
    const parseArguments = (await import("../../scripts/level-seed-target.mjs"))
      .parseLevelSeedArguments as (arguments_: readonly string[]) => Record<string, string | true>;

    expect(() => parseArguments(["--target=emulator", "--rollback=false"])).toThrow(
      /Invalid level seed arguments/,
    );
    expect(() => parseArguments(["--target=emulator", "--target=staging"])).toThrow(
      /Invalid level seed arguments/,
    );
    expect(() => parseArguments(["--target=emulator", "--project-id=demo-bpt-jersey"])).toThrow(
      /Invalid level seed arguments/,
    );
    expect(() => parseArguments(["--academy-id=demo-academy"])).toThrow(
      /Invalid level seed arguments/,
    );
    expect(() => parseArguments(["--target=emulator"])).toThrow(/Invalid level seed arguments/);
    expect(() =>
      parseArguments(["--target=emulator", "--academy-id=demo-academy", "--system-id=ibjjf-v1"]),
    ).toThrow(/Invalid level seed arguments/);
    expect(() =>
      parseArguments(["--target=emulator", "--academy-id=demo-academy", "--rollback"]),
    ).toThrow(/Invalid level seed arguments/);
    expect(() =>
      parseArguments([
        "--target=emulator",
        "--academy-id=demo-academy",
        "--system-id=another-system",
        "--rollback",
      ]),
    ).toThrow(/Invalid level seed arguments/);
    expect(parseArguments(["--target=emulator", "--academy-id=demo-academy"])).toEqual({
      "academy-id": "demo-academy",
      target: "emulator",
    });
    expect(() => parseArguments([])).toThrow(/Invalid level seed arguments/);
    expect(
      parseArguments([
        "--target=emulator",
        "--academy-id=demo-academy",
        "--system-id=ibjjf-v1",
        "--rollback",
      ]),
    ).toEqual({
      "academy-id": "demo-academy",
      rollback: true,
      "system-id": "ibjjf-v1",
      target: "emulator",
    });
  });

  it("checks the operation-specific staging confirmation in the standalone preflight", async () => {
    // @ts-expect-error The operational script intentionally has no generated declaration.
    const confirmationGuard = (await import("../../scripts/level-seed-target.mjs"))
      .assertLevelSeedConfirmation as (
      target: string,
      isRollback: boolean,
      confirmation?: string,
    ) => void;

    expect(() => confirmationGuard("staging", false)).toThrow(/T083-LEVELS-SEED/);
    expect(() => confirmationGuard("staging", true, "T083-LEVELS-SEED")).toThrow(
      /T083-LEVELS-ROLLBACK/,
    );
    expect(() => confirmationGuard("staging", false, "T083-LEVELS-SEED")).not.toThrow();
    expect(() => confirmationGuard("staging", true, "T083-LEVELS-ROLLBACK")).not.toThrow();
    expect(() => confirmationGuard("emulator", false)).not.toThrow();
  });

  it("requires separate staging confirmations for seed and rollback", async () => {
    const store = createInMemoryLevelStore();
    const stagingEnvironment: LevelSeedTargetEnvironment = {
      gcloudProjectId: "bpt-jersey-staging",
      firebaseConfig: JSON.stringify({ projectId: "bpt-jersey-staging" }),
    };

    await expect(
      seedLevelCatalog({
        target: "staging",
        academyId: "demo-academy",
        environment: stagingEnvironment,
        store,
      }),
    ).rejects.toThrow(/T083-LEVELS-SEED/);
    await expect(
      rollbackLevelCatalog({
        target: "staging",
        academyId: "demo-academy",
        systemId: "ibjjf-v1",
        confirmation: "T083-LEVELS-SEED",
        environment: stagingEnvironment,
        store,
      }),
    ).rejects.toThrow(/T083-LEVELS-ROLLBACK/);
  });

  it("rejects an unsupported rollback system before touching the store", async () => {
    const seed = vi.fn();
    const rollback = vi.fn();
    const store = { seed, rollback } as unknown as LevelCatalogStore;

    await expect(
      rollbackLevelCatalog({
        target: "emulator",
        academyId: "demo-academy",
        systemId: "another-system",
        environment: emulatorEnvironment(),
        store,
      }),
    ).rejects.toThrow(/Unsupported level system rollback target/);
    expect(seed).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("seeds successfully to emulator target with valid sources", async () => {
    const store = createInMemoryLevelStore();

    const result = await seedLevelCatalog({
      target: "emulator",
      academyId: "demo-academy",
      environment: emulatorEnvironment(),
      store,
      customObserved: observedJson,
      customBusiness: businessCriteriaJson,
    });

    expect(result.systemId).toBe("ibjjf-v1");
    expect(result.definitionCount).toBe(171);
    expect(result.beltCount).toBe(27);
    expect(result.stripeCount).toBe(144);
    expect(result.skillCount).toBe(11);
    expect(result.requirementCount).toBe(165);
  });

  it("rolls back successfully in emulator target", async () => {
    const store = createInMemoryLevelStore();

    await seedLevelCatalog({
      target: "emulator",
      academyId: "demo-academy",
      environment: emulatorEnvironment(),
      store,
      customObserved: observedJson,
      customBusiness: businessCriteriaJson,
    });

    const rollbackResult = await rollbackLevelCatalog({
      target: "emulator",
      academyId: "demo-academy",
      systemId: "ibjjf-v1",
      environment: emulatorEnvironment(),
      store,
    });

    expect(rollbackResult.deletedDefinitions).toBe(171);
    expect(rollbackResult.deletedRequirements).toBe(165);
    expect(rollbackResult.deletedSystems).toBe(1);
  });
});
