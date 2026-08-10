import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const functionsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(functionsDirectory, "../../..");
const nodeExecutable = process.execPath;
const tscExecutable = path.join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
const corepackExecutable = process.platform === "win32" ? "corepack.cmd" : "corepack";

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
run(nodeExecutable, [
  tscExecutable,
  "-p",
  "apps/functions/tsconfig.json",
  "--module",
  "ESNext",
  "--moduleResolution",
  "Bundler",
  "--rootDir",
  ".",
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
