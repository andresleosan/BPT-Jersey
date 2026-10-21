import { describe, expect, it } from "vitest";

import {
  assertLegacyReadEliminationTarget,
  parseLegacyReadEliminationArguments,
  productionLegacyReadEliminationApplyConfirmation,
} from "../../scripts/legacy-read-elimination-target.mjs";

const production = {
  target: "production",
  projectId: "bptjersey-f5a25",
  apply: true,
  productionConfirmation: productionLegacyReadEliminationApplyConfirmation,
  environment: {
    gcloudProjectId: "bptjersey-f5a25",
    googleCloudProjectId: undefined,
    firebaseConfig: undefined,
    firestoreEmulatorHost: undefined,
  },
} as const;

describe("T097 legacy-read elimination target", () => {
  it("names its own production constant", () => {
    expect(productionLegacyReadEliminationApplyConfirmation).toBe(
      "T097-GLOBAL-LEGACY-ELIMINATE-PRODUCTION-APPLY",
    );
  });

  it("allows the exact emulator binding without a production confirmation", () => {
    expect(
      assertLegacyReadEliminationTarget({
        target: "emulator",
        projectId: "demo-bpt-jersey",
        apply: true,
        productionConfirmation: undefined,
        environment: {
          gcloudProjectId: undefined,
          googleCloudProjectId: undefined,
          firebaseConfig: undefined,
          firestoreEmulatorHost: "127.0.0.1:8080",
        },
      }),
    ).toEqual({ target: "emulator", projectId: "demo-bpt-jersey" });
  });

  it("allows production apply only with the allowlisted project and its own confirmation", () => {
    expect(assertLegacyReadEliminationTarget(production)).toEqual({
      target: "production",
      projectId: "bptjersey-f5a25",
    });
    expect(
      assertLegacyReadEliminationTarget({
        ...production,
        apply: false,
        productionConfirmation: undefined,
      }),
    ).toEqual({ target: "production", projectId: "bptjersey-f5a25" });
    for (const unsafe of [
      { ...production, productionConfirmation: undefined },
      { ...production, productionConfirmation: "T091-MEMBER-NUMBERS-PRODUCTION-APPLY" },
      { ...production, projectId: "another-project" },
      { ...production, target: "staging" },
      {
        ...production,
        environment: { ...production.environment, firestoreEmulatorHost: "127.0.0.1:8080" },
      },
      {
        ...production,
        environment: { ...production.environment, gcloudProjectId: "another-project" },
      },
      {
        ...production,
        environment: {
          ...production.environment,
          firebaseConfig: JSON.stringify({ projectId: "another-project" }),
        },
      },
    ]) {
      expect(() => assertLegacyReadEliminationTarget(unsafe)).toThrow(/not safe/u);
    }
  });

  it("parses strict flags and refuses unknown, duplicate or empty ones", () => {
    expect(
      parseLegacyReadEliminationArguments([
        "--project=bptjersey-f5a25",
        "--target",
        "production",
        "--academy-id=bpt-jersey",
        "--apply",
        "--confirmation",
        "ELIMINATE LEGACY MEMBER READS bpt-jersey r794 e794 0123456789abcdef",
        "--actor-id=operator-1",
        "--production-confirmation=T097-GLOBAL-LEGACY-ELIMINATE-PRODUCTION-APPLY",
      ]),
    ).toEqual({
      project: "bptjersey-f5a25",
      target: "production",
      "academy-id": "bpt-jersey",
      apply: true,
      confirmation: "ELIMINATE LEGACY MEMBER READS bpt-jersey r794 e794 0123456789abcdef",
      "actor-id": "operator-1",
      "production-confirmation": "T097-GLOBAL-LEGACY-ELIMINATE-PRODUCTION-APPLY",
    });
    for (const [values, message] of [
      [["--operation-id=x"], /Unknown --operation-id/u],
      [["--apply", "--apply"], /Duplicate --apply/u],
      [["--project=a", "--project=b"], /Duplicate --project/u],
      [["--project="], /Missing value for --project/u],
      [["--project"], /Missing value for --project/u],
      [["positional"], /Unexpected positional/u],
    ] as const) {
      expect(() => parseLegacyReadEliminationArguments([...values])).toThrow(message);
    }
  });
});
