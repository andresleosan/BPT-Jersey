// Local full stack for the access-recovery and enrolment browser E2E (plan 2026-09-23).
//
//   node qa/scripts/run-recovery-stack.mjs build   (re)build the Functions artifact (slow)
//   node qa/scripts/run-recovery-stack.mjs start   build if missing, start Auth/Firestore/Functions
//                                                  Emulators + Next dev on 127.0.0.1:3100, seed
//   node qa/scripts/run-recovery-stack.mjs reset   wipe Emulator data and seed again
//   node qa/scripts/run-recovery-stack.mjs test <playwright args>
//   node qa/scripts/run-recovery-stack.mjs stop
//
// Demo project only (`demo-bpt-jersey` can never reach real Firebase). Secrets are synthetic and
// kept under the ignored .tmp/recovery-stack/. Processes run detached; their logs live there too.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const state = resolve(root, ".tmp/recovery-stack");
const projectId = "demo-bpt-jersey";
const academyId = "demo-academy";
const javaHome = process.env.RECOVERY_STACK_JAVA_HOME ?? "/tmp/bpt-recovery-jdk21";
// Own ports: 8080 is held by another process on this host. Keep in sync with recovery-fixture.ts.
const ports = { auth: 9109, firestore: 8180, functions: 5011, hub: 4410, logging: 4510 };
const configFile = "firebase.recovery-stack.json";
mkdirSync(state, { recursive: true });

function secrets() {
  const file = resolve(state, "secrets.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const value = () => randomBytes(32).toString("base64url");
  const generated = {
    MEMBER_DIRECTORY_IDENTITY_KEY_SECRET: value(),
    MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET: value(),
    MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET: value(),
    MEMBER_DIRECTORY_CURSOR_SECRET: value(),
    MEMBER_PAGE_TOKEN_SECRET: value(),
    // Empty on purpose: an unconfigured R2 makes the Functions Emulator use its in-memory store
    // (storage/r2-client.ts) instead of calling Cloudflare.
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    R2_ACCOUNT_ID: "",
    R2_BUCKET_NAME: "",
    R2_JURISDICTION: "",
  };
  writeFileSync(file, JSON.stringify(generated, null, 2), { mode: 0o600 });
  return generated;
}

const env = {
  ...process.env,
  ...secrets(),
  GCLOUD_PROJECT: projectId,
  JAVA_HOME: javaHome,
  PATH: `${javaHome}/bin:${process.env.PATH}`,
  FUNCTIONS_DISCOVERY_TIMEOUT: "300000",
  FIRESTORE_EMULATOR_HOST: `127.0.0.1:${ports.firestore}`,
  FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${ports.auth}`,
  RECOVERY_E2E_ACADEMY_ID: academyId,
  // No Application Default Credentials: the stack must never hold a path to a real project.
  CLOUDSDK_CONFIG: resolve(state, "gcloud-empty"),
};
delete env.GOOGLE_APPLICATION_CREDENTIALS;
mkdirSync(env.CLOUDSDK_CONFIG, { recursive: true });

function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd: root, env: { ...env, ...extra }, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function detached(name, command, args, extra = {}) {
  const log = openSync(resolve(state, `${name}.log`), "w");
  const child = spawn(command, args, {
    cwd: root,
    env: { ...env, ...extra },
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  writeFileSync(resolve(state, `${name}.pid`), String(child.pid));
}

async function waitFor(label, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch((error) => {
      if (String(error?.message).includes("failed to start")) throw error;
      return false;
    })) return;
    await new Promise((done) => setTimeout(done, 2_000));
  }
  throw new Error(`${label} did not become ready; see .tmp/recovery-stack/*.log`);
}

const httpOk = (url) => fetch(url).then((response) => response.status < 500);

function stop() {
  for (const name of ["next", "emulators"]) {
    const file = resolve(state, `${name}.pid`);
    if (!existsSync(file)) continue;
    try {
      process.kill(-Number(readFileSync(file, "utf8")), "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

async function wipe() {
  await fetch(
    `http://127.0.0.1:${ports.firestore}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  await fetch(`http://127.0.0.1:${ports.auth}/emulator/v1/projects/${projectId}/accounts`, {
    method: "DELETE",
  });
}

function seed() {
  run(process.execPath, ["qa/scripts/seed-recovery-emulator.mjs"]);
}

function build() {
  run(process.execPath, ["apps/functions/scripts/build-deploy-artifact.mjs"]);
  writeSecretFile();
}

function writeSecretFile() {
  const s = secrets();
  writeFileSync(
    resolve(root, ".firebase-functions/.secret.local"),
    Object.entries(s)
      .filter(([key]) => key !== "MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET")
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
}

async function start() {
  // The artifact build installs ~1100 packages; run `build` first when sources changed.
  if (!existsSync(resolve(root, ".firebase-functions/lib/src/index.js"))) build();
  writeSecretFile();
  const config = JSON.parse(readFileSync(resolve(root, "firebase.json"), "utf8"));
  config.emulators = {
    auth: { host: "127.0.0.1", port: ports.auth },
    firestore: { host: "127.0.0.1", port: ports.firestore },
    functions: { host: "127.0.0.1", port: ports.functions },
    hub: { host: "127.0.0.1", port: ports.hub },
    logging: { host: "127.0.0.1", port: ports.logging },
    ui: { enabled: false },
    singleProjectMode: false,
  };
  // Beside firebase.json so relative paths resolve the same; excluded locally via .git/info/exclude.
  writeFileSync(resolve(root, configFile), JSON.stringify(config, null, 2));
  detached("emulators", "corepack", [
    "pnpm", "exec", "firebase", "emulators:start", "--config", configFile,
    "--project", projectId, "--only", "auth,firestore,functions",
  ]);
  await waitFor(
    "Emulators",
    async () => {
      const log = readFileSync(resolve(state, "emulators.log"), "utf8");
      if (/\bError:/u.test(log)) throw new Error("Emulators failed to start; see emulators.log");
      return log.includes("All emulators ready");
    },
    600_000,
  );
  seed();
  detached("next", "corepack", [
    "pnpm", "--filter", "@bpt-jersey/web", "exec", "next", "dev", "-p", "3100", "-H", "127.0.0.1",
  ], {
    NEXT_PUBLIC_USE_FIREBASE_EMULATORS: "true",
    NEXT_PUBLIC_FIREBASE_ENV: "local",
    // Without it /account renders the in-memory calendar fixtures instead of the Emulators.
    NEXT_PUBLIC_CALENDAR_SOURCE: "firebase",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
    NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: "127.0.0.1",
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT: String(ports.auth),
    NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT: String(ports.firestore),
    NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT: String(ports.functions),
  });
  await waitFor("Next dev", () => httpOk("http://127.0.0.1:3100/login"), 300_000);
  console.log("Recovery stack ready: http://127.0.0.1:3100");
}

const [command, ...rest] = process.argv.slice(2);
if (command === "build") build();
else if (command === "start") await start();
else if (command === "stop") stop();
else if (command === "reset") {
  await wipe();
  seed();
} else if (command === "test") {
  run("corepack", ["pnpm", "--dir", "qa", "exec", "playwright", "test", ...rest], {
    BASE_URL: "http://127.0.0.1:3100",
  });
} else {
  console.error("usage: run-recovery-stack.mjs build|start|reset|test|stop");
  process.exitCode = 2;
}
