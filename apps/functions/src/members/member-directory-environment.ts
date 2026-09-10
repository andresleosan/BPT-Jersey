import { Buffer } from "node:buffer";

export type MemberDirectoryRestoreRole = "source" | "target";
export type MemberDirectorySecretPurpose =
  "identity-key" | "migration-integrity" | "directory-cursor";

export type MemberDirectoryRestoreAmbientEnvironment = Readonly<{
  GCLOUD_PROJECT?: string;
  GOOGLE_CLOUD_PROJECT?: string;
  FIREBASE_CONFIG?: string;
  FIRESTORE_EMULATOR_HOST?: string;
  FIREBASE_AUTH_EMULATOR_HOST?: string;
}>;

export type MemberDirectoryAdminAppBinding = Readonly<{
  name?: string;
  projectId?: string;
}>;

export type MemberDirectoryEmulatorSecretBinding = Readonly<{
  kind?: string;
  role?: string;
  projectId?: string;
  purpose?: string;
  version?: string;
  material?: string;
}>;

export type MemberDirectoryRestoreEnvironmentInput = Readonly<{
  target: string;
  sourceProjectId: string;
  targetProjectId: string;
  environment: MemberDirectoryRestoreAmbientEnvironment;
  testSecrets: readonly MemberDirectoryEmulatorSecretBinding[];
}>;

export type MemberDirectoryRestoreEnvironmentBinding = Readonly<{
  target: "emulator";
  sourceProjectId: "demo-bpt-jersey";
  targetProjectId: "demo-bpt-jersey-restore";
  sourceAppName: "member-directory-restore-source";
  targetAppName: "member-directory-restore-target";
  firestoreEmulatorHost: "127.0.0.1:8080";
  authEmulatorHost: "127.0.0.1:9099";
}>;

export type MemberDirectoryOperationEnvironmentInput = Readonly<{
  target: string;
  explicitProjectId: string;
  environment: MemberDirectoryRestoreAmbientEnvironment;
  app: MemberDirectoryAdminAppBinding;
}>;

export type MemberDirectoryOperationEnvironmentBinding = Readonly<{
  target: "emulator";
  projectId: "demo-bpt-jersey";
  targetProjectClassification: "emulator";
  firestoreEmulatorHost: "127.0.0.1:8080";
  authEmulatorHost: "127.0.0.1:9099";
}>;

const sourceProjectId = "demo-bpt-jersey" as const;
const targetProjectId = "demo-bpt-jersey-restore" as const;
const sourceAppName = "member-directory-restore-source" as const;
const targetAppName = "member-directory-restore-target" as const;
const firestoreEmulatorHost = "127.0.0.1:8080" as const;
const authEmulatorHost = "127.0.0.1:9099" as const;
const strictBase64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const secretVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const secretPurposes: readonly MemberDirectorySecretPurpose[] = [
  "identity-key",
  "migration-integrity",
  "directory-cursor",
];

function unsafeEnvironment(): never {
  throw new Error("Member directory restore environment is not safe.");
}

function unsafeOperationEnvironment(): never {
  throw new Error("Member directory operation environment is not safe.");
}

function operationFirebaseConfigProjectId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return unsafeOperationEnvironment();
    }
    const projectId = (parsed as { projectId?: unknown }).projectId;
    if (typeof projectId !== "string" || projectId.length === 0) {
      return unsafeOperationEnvironment();
    }
    return projectId;
  } catch {
    return unsafeOperationEnvironment();
  }
}

export function assertMemberDirectoryOperationEnvironment(
  input: MemberDirectoryOperationEnvironmentInput,
): MemberDirectoryOperationEnvironmentBinding {
  if (
    input.target !== "emulator" ||
    input.explicitProjectId !== sourceProjectId ||
    input.app.projectId !== sourceProjectId ||
    input.environment.FIRESTORE_EMULATOR_HOST !== firestoreEmulatorHost ||
    input.environment.FIREBASE_AUTH_EMULATOR_HOST !== authEmulatorHost
  ) {
    unsafeOperationEnvironment();
  }

  const discoveredProjectIds = [
    input.environment.GCLOUD_PROJECT,
    input.environment.GOOGLE_CLOUD_PROJECT,
    operationFirebaseConfigProjectId(input.environment.FIREBASE_CONFIG),
  ];
  if (
    discoveredProjectIds.some(
      (projectId) => projectId !== undefined && projectId !== sourceProjectId,
    )
  ) {
    unsafeOperationEnvironment();
  }

  return Object.freeze({
    target: "emulator",
    projectId: sourceProjectId,
    targetProjectClassification: "emulator",
    firestoreEmulatorHost,
    authEmulatorHost,
  });
}

function firebaseConfigProjectId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return unsafeEnvironment();
    }
    const projectId = (parsed as { projectId?: unknown }).projectId;
    if (typeof projectId !== "string") return unsafeEnvironment();
    return projectId;
  } catch {
    return unsafeEnvironment();
  }
}

function assertProjectAndHostBinding(input: MemberDirectoryRestoreEnvironmentInput): void {
  if (
    input.target !== "emulator" ||
    input.sourceProjectId !== sourceProjectId ||
    input.targetProjectId !== targetProjectId ||
    input.environment.FIRESTORE_EMULATOR_HOST !== firestoreEmulatorHost ||
    input.environment.FIREBASE_AUTH_EMULATOR_HOST !== authEmulatorHost
  ) {
    unsafeEnvironment();
  }

  const ambientProjectIds = [
    input.environment.GCLOUD_PROJECT,
    input.environment.GOOGLE_CLOUD_PROJECT,
    firebaseConfigProjectId(input.environment.FIREBASE_CONFIG),
  ];
  if (
    ambientProjectIds.some((projectId) => projectId !== undefined && projectId !== sourceProjectId)
  ) {
    unsafeEnvironment();
  }
}

function assertAdminAppBinding(apps: readonly MemberDirectoryAdminAppBinding[]): void {
  if (apps.length !== 2) unsafeEnvironment();

  const appsByName = new Map(apps.map((app) => [app.name, app]));
  if (appsByName.size !== 2 || appsByName.has("[DEFAULT]")) unsafeEnvironment();

  if (
    appsByName.get(sourceAppName)?.projectId !== sourceProjectId ||
    appsByName.get(targetAppName)?.projectId !== targetProjectId
  ) {
    unsafeEnvironment();
  }
}

export function assertMemberDirectoryRestoreAdminApps(
  stage: "before-initialization" | "after-initialization",
  apps: readonly MemberDirectoryAdminAppBinding[],
): void {
  if (stage === "before-initialization") {
    if (apps.length !== 0) unsafeEnvironment();
    return;
  }
  if (stage !== "after-initialization") unsafeEnvironment();

  assertAdminAppBinding(apps);
}

function decodedTestSecret(material: string | undefined): Buffer {
  if (material === undefined || !strictBase64UrlPattern.test(material)) unsafeEnvironment();

  const decoded = Buffer.from(material, "base64url");
  if (
    decoded.byteLength < 32 ||
    decoded.byteLength > 64 ||
    decoded.toString("base64url") !== material
  ) {
    unsafeEnvironment();
  }
  if (decoded.every((byte) => byte === decoded[0])) unsafeEnvironment();
  return decoded;
}

function expectedSecretProject(role: string | undefined): string {
  if (role === "source") return sourceProjectId;
  if (role === "target") return targetProjectId;
  return unsafeEnvironment();
}

function assertEmulatorTestSecrets(secrets: readonly MemberDirectoryEmulatorSecretBinding[]): void {
  const expectedTupleCount = secretPurposes.length * 2;
  if (secrets.length !== expectedTupleCount) unsafeEnvironment();

  const tuples = new Set<string>();
  const materials = new Set<string>();

  for (const secret of secrets) {
    if (
      secret.kind !== "emulator-test" ||
      secret.projectId !== expectedSecretProject(secret.role) ||
      !secretPurposes.includes(secret.purpose as MemberDirectorySecretPurpose) ||
      secret.version === undefined ||
      !secretVersionPattern.test(secret.version)
    ) {
      unsafeEnvironment();
    }

    decodedTestSecret(secret.material);
    const tuple = `${secret.role}:${secret.projectId}:${secret.purpose}`;
    if (tuples.has(tuple) || materials.has(secret.material!)) unsafeEnvironment();
    tuples.add(tuple);
    materials.add(secret.material!);
  }

  for (const role of ["source", "target"] as const) {
    for (const purpose of secretPurposes) {
      const projectId = role === "source" ? sourceProjectId : targetProjectId;
      if (!tuples.has(`${role}:${projectId}:${purpose}`)) unsafeEnvironment();
    }
  }
}

export function assertMemberDirectoryRestoreEnvironment(
  input: MemberDirectoryRestoreEnvironmentInput,
): MemberDirectoryRestoreEnvironmentBinding {
  assertProjectAndHostBinding(input);
  assertEmulatorTestSecrets(input.testSecrets);

  return Object.freeze({
    target: "emulator",
    sourceProjectId,
    targetProjectId,
    sourceAppName,
    targetAppName,
    firestoreEmulatorHost,
    authEmulatorHost,
  });
}
