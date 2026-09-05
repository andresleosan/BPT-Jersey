import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Generates the synthetic secrets the Functions Emulator needs for the authenticated callable E2E
// suites and writes them to `.firebase-functions/.secret.local`, never to stdout. Values live only
// for the life of the process that consumes them: nothing here is a production secret and nothing
// here may ever be reused outside a demo project.
//
//   node qa/scripts/generate-synthetic-emulator-secrets.mjs \
//     --confirmation=SYNTHETIC-EMULATOR-SECRETS [--env-file=<path>]
//
// `--env-file` receives the three `KEY=value` lines the shell must also export (the canonical
// directory initializer binds the empty baseline to them and the callables verify that binding).
const repositoryRoot = resolve(import.meta.dirname, "../..");
const artifactDirectory = resolve(repositoryRoot, ".firebase-functions");
const secretFile = resolve(artifactDirectory, ".secret.local");

const flags = new Map(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf("=");
    return separator === -1
      ? [argument, ""]
      : [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);

if (flags.get("--confirmation") !== "SYNTHETIC-EMULATOR-SECRETS") {
  throw new Error("Refusing to run without --confirmation=SYNTHETIC-EMULATOR-SECRETS.");
}
const projectId = process.env.GCLOUD_PROJECT?.trim() ?? "";
if (!projectId.startsWith("demo-")) {
  throw new Error("Refusing to run outside a demo project: set GCLOUD_PROJECT=demo-<id>.");
}
if (!existsSync(artifactDirectory)) {
  throw new Error("Build the deploy artifact first: .firebase-functions/ does not exist.");
}

// The same shape the runtime enforces: base64url without padding, 32-64 bytes, not a single
// repeated byte and no placeholder wording once decoded.
const forbidden = /change.?me|placeholder|example|dummy|password|test/u;

function syntheticSecret(seen) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const bytes = randomBytes(48);
    const material = bytes.toString("base64url");
    if (
      material.includes("=") ||
      Buffer.from(material, "base64url").toString("base64url") !== material ||
      bytes.every((byte) => byte === bytes[0]) ||
      forbidden.test(bytes.toString("utf8").toLowerCase()) ||
      seen.has(material)
    ) {
      continue;
    }
    seen.add(material);
    return material;
  }
  throw new Error("Unable to generate a distinct synthetic secret.");
}

const seen = new Set();
const secrets = Object.freeze({
  MEMBER_DIRECTORY_IDENTITY_KEY_SECRET: syntheticSecret(seen),
  MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET: syntheticSecret(seen),
  MEMBER_DIRECTORY_CURSOR_SECRET: syntheticSecret(seen),
  MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET: syntheticSecret(seen),
  MEMBER_PAGE_TOKEN_SECRET: syntheticSecret(seen),
  R2_ACCESS_KEY_ID: syntheticSecret(seen),
  R2_SECRET_ACCESS_KEY: syntheticSecret(seen),
});

// The emulator reads every declared secret from this file; the baseline encryption secret is a
// shell-only value, so it is deliberately not part of it.
const emulatorSecrets = [
  "MEMBER_DIRECTORY_IDENTITY_KEY_SECRET",
  "MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET",
  "MEMBER_DIRECTORY_CURSOR_SECRET",
  "MEMBER_PAGE_TOKEN_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];
writeFileSync(
  secretFile,
  `${emulatorSecrets.map((name) => `${name}=${secrets[name]}`).join("\n")}\n`,
  { encoding: "utf8", mode: 0o600 },
);

const shellSecrets = [
  "MEMBER_DIRECTORY_IDENTITY_KEY_SECRET",
  "MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET",
  "MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET",
];
const environmentFile = flags.get("--env-file");
if (environmentFile !== undefined && environmentFile !== "") {
  appendFileSync(
    resolve(environmentFile),
    `${shellSecrets.map((name) => `${name}=${secrets[name]}`).join("\n")}\n`,
    { encoding: "utf8" },
  );
}

console.log(
  JSON.stringify({
    secretFile: ".firebase-functions/.secret.local",
    emulatorSecrets: emulatorSecrets.length,
    shellSecrets: environmentFile ? shellSecrets.length : 0,
  }),
);
