import { describe, expect, it } from "vitest";

import {
  hasStoredPassword,
  productionConfirmation,
  resolvePurgeTarget,
} from "../scripts/purge-regyfit-record-passwords.mjs";

describe("Regyfit password purge guards", () => {
  it("detects only a present appAccess.password key", () => {
    expect(hasStoredPassword({ appAccess: { login: "a1", password: "104569" } })).toBe(true);
    expect(hasStoredPassword({ appAccess: { login: "a1", password: "" } })).toBe(true);
    expect(hasStoredPassword({ appAccess: { login: "a1" } })).toBe(false);
    expect(hasStoredPassword({ password: "104569" })).toBe(false);
    expect(hasStoredPassword(undefined)).toBe(false);
  });

  it("dry-runs by default and only on a loopback emulator", () => {
    expect(
      resolvePurgeTarget({
        REGYFIT_PURGE_TARGET: "emulator",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toEqual({ target: "emulator", projectId: "demo-bpt-jersey", apply: false });
    expect(() =>
      resolvePurgeTarget({
        REGYFIT_PURGE_TARGET: "emulator",
        FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080",
      }),
    ).toThrow(/loopback/);
    expect(() => resolvePurgeTarget({})).toThrow(/REGYFIT_PURGE_TARGET/);
  });

  it("requires the production project for a production dry run and the confirmation to apply", () => {
    expect(() =>
      resolvePurgeTarget({ REGYFIT_PURGE_TARGET: "production", GCLOUD_PROJECT: "other" }),
    ).toThrow(/bptjersey-f5a25/);
    expect(() =>
      resolvePurgeTarget({
        REGYFIT_PURGE_TARGET: "production",
        GCLOUD_PROJECT: "bptjersey-f5a25",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toThrow(/FIRESTORE_EMULATOR_HOST/);
    expect(
      resolvePurgeTarget({ REGYFIT_PURGE_TARGET: "production", GCLOUD_PROJECT: "bptjersey-f5a25" }),
    ).toEqual({ target: "production", projectId: "bptjersey-f5a25", apply: false });
    expect(() =>
      resolvePurgeTarget({
        REGYFIT_PURGE_TARGET: "production",
        GCLOUD_PROJECT: "bptjersey-f5a25",
        REGYFIT_PURGE_APPLY: "yes",
      }),
    ).toThrow(/confirmation/);
    expect(
      resolvePurgeTarget({
        REGYFIT_PURGE_TARGET: "production",
        GCLOUD_PROJECT: "bptjersey-f5a25",
        REGYFIT_PURGE_APPLY: "yes",
        REGYFIT_OPERATOR_CONFIRMATION: productionConfirmation,
      }),
    ).toEqual({ target: "production", projectId: "bptjersey-f5a25", apply: true });
  });
});
