import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const functionsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(functionsDirectory, "../../..");
const nodeExecutable = process.execPath;
const tscExecutable = path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
const corepackExecutable = process.platform === "win32" ? "corepack.cmd" : "corepack";
const functionsBuildDirectory = path.resolve(repositoryRoot, "apps/functions/lib");
const expectedFunctionsRoot = path.resolve(repositoryRoot, "apps/functions") + path.sep;

if (!functionsBuildDirectory.startsWith(expectedFunctionsRoot)) {
  throw new Error("Functions build directory escaped the module root.");
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: process.env,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(nodeExecutable, [tscExecutable, "-p", "packages/domain/tsconfig.runtime.json"]);
run(nodeExecutable, ["packages/domain/scripts/prepare-runtime.mjs"]);
rmSync(functionsBuildDirectory, { recursive: true, force: true });
run(nodeExecutable, [
  tscExecutable,
  "-p",
  "apps/functions/tsconfig.json",
  "--module",
  "ESNext",
  "--moduleResolution",
  "Bundler",
  "--rootDir",
  "apps/functions",
]);
run(nodeExecutable, ["apps/functions/scripts/clean-deploy-target.mjs"]);
run(
  corepackExecutable,
  [
    "pnpm",
    "--filter",
    "@bpt-jersey/functions",
    "deploy",
    "--prod",
    "--legacy",
    "--config.confirmModulesPurge=false",
    ".firebase-functions",
  ],
  {
    env: { ...process.env, CI: "true", npm_config_confirmModulesPurge: "false" },
    shell: process.platform === "win32",
  },
);
run(nodeExecutable, ["apps/functions/scripts/prepare-deploy-runtime.mjs"]);
