import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  assertMemberDirectoryOperationEnvironment,
  assertMemberDirectoryRestoreAdminApps,
  assertMemberDirectoryRestoreEnvironment,
  type MemberDirectoryAdminAppBinding,
  type MemberDirectoryEmulatorSecretBinding,
  type MemberDirectoryRestoreEnvironmentInput,
} from "./member-directory-environment";

const sourceProjectId = "demo-bpt-jersey";
const targetProjectId = "demo-bpt-jersey-restore";
const sourceAppName = "member-directory-restore-source";
const targetAppName = "member-directory-restore-target";

function syntheticTestMaterial(byte: number): string {
  return Buffer.from(Array.from({ length: 32 }, (_, index) => byte + index)).toString("base64url");
}

function emulatorTestSecrets(): readonly MemberDirectoryEmulatorSecretBinding[] {
  return [
    {
      kind: "emulator-test",
      role: "source",
      projectId: sourceProjectId,
      purpose: "identity-key",
      version: "identity-v1",
      material: syntheticTestMaterial(1),
    },
    {
      kind: "emulator-test",
      role: "source",
      projectId: sourceProjectId,
      purpose: "migration-integrity",
      version: "integrity-v1",
      material: syntheticTestMaterial(2),
    },
    {
      kind: "emulator-test",
      role: "source",
      projectId: sourceProjectId,
      purpose: "directory-cursor",
      version: "cursor-v1",
      material: syntheticTestMaterial(3),
    },
    {
      kind: "emulator-test",
      role: "target",
      projectId: targetProjectId,
      purpose: "identity-key",
      version: "identity-v1",
      material: syntheticTestMaterial(4),
    },
    {
      kind: "emulator-test",
      role: "target",
      projectId: targetProjectId,
      purpose: "migration-integrity",
      version: "integrity-v1",
      material: syntheticTestMaterial(5),
    },
    {
      kind: "emulator-test",
      role: "target",
      projectId: targetProjectId,
      purpose: "directory-cursor",
      version: "cursor-v1",
      material: syntheticTestMaterial(6),
    },
  ];
}

function safeEnvironment(): MemberDirectoryRestoreEnvironmentInput {
  return {
    target: "emulator",
    sourceProjectId,
    targetProjectId,
    environment: {
      GCLOUD_PROJECT: sourceProjectId,
      GOOGLE_CLOUD_PROJECT: sourceProjectId,
      FIREBASE_CONFIG: JSON.stringify({ projectId: sourceProjectId }),
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    },
    testSecrets: emulatorTestSecrets(),
  };
}

function safeAdminApps(): readonly MemberDirectoryAdminAppBinding[] {
  return [
    { name: sourceAppName, projectId: sourceProjectId },
    { name: targetAppName, projectId: targetProjectId },
  ];
}

describe("member directory single-project operation guard", () => {
  const safeOperation = () => ({
    target: "emulator",
    explicitProjectId: sourceProjectId,
    environment: {
      GCLOUD_PROJECT: sourceProjectId,
      GOOGLE_CLOUD_PROJECT: sourceProjectId,
      FIREBASE_CONFIG: JSON.stringify({ projectId: sourceProjectId }),
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    },
    app: { name: "[DEFAULT]", projectId: sourceProjectId },
  });

  it("accepts only the exact local Emulator project and returns a metadata-only binding", () => {
    const result = assertMemberDirectoryOperationEnvironment(safeOperation());

    expect(result).toEqual({
      target: "emulator",
      projectId: sourceProjectId,
      targetProjectClassification: "emulator",
      firestoreEmulatorHost: "127.0.0.1:8080",
      authEmulatorHost: "127.0.0.1:9099",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("allows optional ambient project variables to be absent when the explicit and Admin bindings agree", () => {
    const input = safeOperation();
    expect(() =>
      assertMemberDirectoryOperationEnvironment({
        ...input,
        environment: {
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
          FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        },
      }),
    ).not.toThrow();
  });

  it.each([
    ["staging while its allowlist is empty", { target: "staging" }],
    ["production", { target: "production", explicitProjectId: "bptjersey-f5a25" }],
    ["a production project disguised as Emulator", { explicitProjectId: "bptjersey-f5a25" }],
    ["a missing explicit project", { explicitProjectId: "" }],
    ["a different Admin project", { app: { name: "[DEFAULT]", projectId: "third-project" } }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      assertMemberDirectoryOperationEnvironment({ ...safeOperation(), ...override }),
    ).toThrow("Member directory operation environment is not safe.");
  });

  it.each([
    ["GCLOUD_PROJECT", { GCLOUD_PROJECT: "third-project" }],
    ["GOOGLE_CLOUD_PROJECT", { GOOGLE_CLOUD_PROJECT: "third-project" }],
    ["FIREBASE_CONFIG", { FIREBASE_CONFIG: JSON.stringify({ projectId: "third-project" }) }],
    ["Firestore host", { FIRESTORE_EMULATOR_HOST: "localhost:8080" }],
    ["Auth host", { FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099" }],
  ])("rejects a conflicting %s before operation I/O", (_label, override) => {
    const input = safeOperation();
    expect(() =>
      assertMemberDirectoryOperationEnvironment({
        ...input,
        environment: { ...input.environment, ...override },
      }),
    ).toThrow("Member directory operation environment is not safe.");
  });
});

it("separates the empty pre-initialization app check from the exact post-initialization set", () => {
  const adminApps = safeAdminApps();

  expect(() => assertMemberDirectoryRestoreAdminApps("before-initialization", [])).not.toThrow();
  expect(() =>
    assertMemberDirectoryRestoreAdminApps("after-initialization", adminApps),
  ).not.toThrow();
  expect(() => assertMemberDirectoryRestoreAdminApps("before-initialization", adminApps)).toThrow(
    "Member directory restore environment is not safe.",
  );
  expect(() =>
    assertMemberDirectoryRestoreAdminApps("unexpected-stage" as "before-initialization", adminApps),
  ).toThrow("Member directory restore environment is not safe.");
});

describe("member directory restore environment guard", () => {
  it("accepts only the exact isolated Emulator binding and returns no secret material", () => {
    const result = assertMemberDirectoryRestoreEnvironment(safeEnvironment());

    expect(result).toEqual({
      target: "emulator",
      sourceProjectId,
      targetProjectId,
      sourceAppName,
      targetAppName,
      firestoreEmulatorHost: "127.0.0.1:8080",
      authEmulatorHost: "127.0.0.1:9099",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty("testSecrets");
  });

  it("allows every ambient project variable to be absent because they are source context only", () => {
    const input = safeEnvironment();

    expect(() =>
      assertMemberDirectoryRestoreEnvironment({
        ...input,
        environment: {
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
          FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        },
      }),
    ).not.toThrow();
  });

  it.each([
    ["non-emulator target", { target: "staging" }],
    ["wrong source", { sourceProjectId: "bptjersey-f5a25" }],
    ["wrong target", { targetProjectId: "bptjersey-f5a25" }],
    ["same project", { targetProjectId: sourceProjectId }],
    ["swapped projects", { sourceProjectId: targetProjectId, targetProjectId: sourceProjectId }],
  ])("rejects %s", (_name, replacement) => {
    expect(() =>
      assertMemberDirectoryRestoreEnvironment({ ...safeEnvironment(), ...replacement }),
    ).toThrow("Member directory restore environment is not safe.");
  });

  it.each([
    ["GCLOUD_PROJECT", { GCLOUD_PROJECT: targetProjectId }],
    ["GOOGLE_CLOUD_PROJECT", { GOOGLE_CLOUD_PROJECT: "third-demo-project" }],
    ["FIREBASE_CONFIG target", { FIREBASE_CONFIG: JSON.stringify({ projectId: targetProjectId }) }],
    ["FIREBASE_CONFIG missing ID", { FIREBASE_CONFIG: JSON.stringify({ databaseURL: "unused" }) }],
    ["FIREBASE_CONFIG malformed", { FIREBASE_CONFIG: "{" }],
    ["Firestore host", { FIRESTORE_EMULATOR_HOST: "localhost:8080" }],
    ["Auth host", { FIREBASE_AUTH_EMULATOR_HOST: "192.0.2.10:9099" }],
  ])("rejects an unsafe or ambiguous %s binding", (_name, environmentOverride) => {
    const input = safeEnvironment();
    expect(() =>
      assertMemberDirectoryRestoreEnvironment({
        ...input,
        environment: { ...input.environment, ...environmentOverride },
      }),
    ).toThrow("Member directory restore environment is not safe.");
  });

  it.each([
    ["missing apps", []],
    [
      "default app",
      [
        { name: "[DEFAULT]", projectId: sourceProjectId },
        { name: targetAppName, projectId: targetProjectId },
      ],
    ],
    [
      "third app",
      [
        { name: sourceAppName, projectId: sourceProjectId },
        { name: targetAppName, projectId: targetProjectId },
        { name: "unexpected-app", projectId: "third-demo-project" },
      ],
    ],
    [
      "swapped app projects",
      [
        { name: sourceAppName, projectId: targetProjectId },
        { name: targetAppName, projectId: sourceProjectId },
      ],
    ],
    [
      "duplicate app name",
      [
        { name: sourceAppName, projectId: sourceProjectId },
        { name: sourceAppName, projectId: sourceProjectId },
      ],
    ],
    [
      "missing app project",
      [{ name: sourceAppName }, { name: targetAppName, projectId: targetProjectId }],
    ],
  ])("rejects the %s Admin app set", (_name, adminApps) => {
    expect(() => assertMemberDirectoryRestoreAdminApps("after-initialization", adminApps)).toThrow(
      "Member directory restore environment is not safe.",
    );
  });

  it.each([
    [
      "missing tuple",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => secrets.slice(1),
    ],
    [
      "duplicate tuple",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => [
        secrets[0],
        ...secrets.slice(0, 5),
      ],
    ],
    [
      "wrong project",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => [
        { ...secrets[0], projectId: targetProjectId },
        ...secrets.slice(1),
      ],
    ],
    [
      "non-test kind",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => [
        { ...secrets[0], kind: "remote-secret" },
        ...secrets.slice(1),
      ],
    ],
    [
      "unknown purpose",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => [
        { ...secrets[0], purpose: "unknown-purpose" },
        ...secrets.slice(1),
      ],
    ],
    [
      "empty version",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => [
        { ...secrets[0], version: "" },
        ...secrets.slice(1),
      ],
    ],
    [
      "malformed material",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => [
        { ...secrets[0], material: "not+padded=" },
        ...secrets.slice(1),
      ],
    ],
    [
      "short material",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => [
        { ...secrets[0], material: Buffer.alloc(31, 9).toString("base64url") },
        ...secrets.slice(1),
      ],
    ],
    [
      "long material",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => [
        {
          ...secrets[0],
          material: Buffer.from(Array.from({ length: 65 }, (_, index) => index)).toString(
            "base64url",
          ),
        },
        ...secrets.slice(1),
      ],
    ],
    [
      "placeholder material",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => [
        { ...secrets[0], material: Buffer.alloc(32, 7).toString("base64url") },
        ...secrets.slice(1),
      ],
    ],
    [
      "cross-purpose material reuse",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => [
        secrets[0],
        { ...secrets[1], material: secrets[0]?.material },
        ...secrets.slice(2),
      ],
    ],
    [
      "cross-project material reuse",
      (secrets: readonly MemberDirectoryEmulatorSecretBinding[]) => [
        ...secrets.slice(0, 3),
        { ...secrets[3], material: secrets[0]?.material },
        ...secrets.slice(4),
      ],
    ],
  ])("rejects %s in Emulator secret bindings", (_name, mutate) => {
    const testSecrets = mutate(
      emulatorTestSecrets(),
    ) as readonly MemberDirectoryEmulatorSecretBinding[];

    expect(() =>
      assertMemberDirectoryRestoreEnvironment({ ...safeEnvironment(), testSecrets }),
    ).toThrow("Member directory restore environment is not safe.");
  });
});
