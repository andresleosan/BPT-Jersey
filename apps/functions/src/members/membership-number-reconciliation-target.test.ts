import { describe, expect, it } from "vitest";

import {
  assertMembershipNumberReconciliationTarget,
  productionMembershipNumberApplyConfirmation,
} from "../../scripts/membership-number-reconciliation-target.mjs";

const production = {
  target: "production",
  projectId: "bptjersey-f5a25",
  apply: true,
  productionConfirmation: productionMembershipNumberApplyConfirmation,
  environment: {
    gcloudProjectId: "bptjersey-f5a25",
    googleCloudProjectId: undefined,
    firebaseConfig: undefined,
    firestoreEmulatorHost: undefined,
  },
} as const;

describe("membership number reconciliation target", () => {
  it("allows the exact emulator binding without a production confirmation", () => {
    expect(
      assertMembershipNumberReconciliationTarget({
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

  it("allows production apply only with the allowlisted project and separate confirmation", () => {
    expect(assertMembershipNumberReconciliationTarget(production)).toEqual({
      target: "production",
      projectId: "bptjersey-f5a25",
    });
    for (const unsafe of [
      { ...production, productionConfirmation: undefined },
      { ...production, productionConfirmation: "wrong" },
      { ...production, projectId: "another-project" },
      {
        ...production,
        environment: { ...production.environment, firestoreEmulatorHost: "127.0.0.1:8080" },
      },
      {
        ...production,
        environment: { ...production.environment, gcloudProjectId: "another-project" },
      },
    ]) {
      expect(() => assertMembershipNumberReconciliationTarget(unsafe)).toThrow(/not safe/u);
    }
  });

  it("keeps production dry runs available without authorising apply", () => {
    expect(
      assertMembershipNumberReconciliationTarget({
        ...production,
        apply: false,
        productionConfirmation: undefined,
      }),
    ).toEqual({ target: "production", projectId: "bptjersey-f5a25" });
  });
});
