// P-02: the artifact ships a package-lock.json pinned to pnpm-lock.yaml, so Cloud Build's `npm ci`
// installs the audited dependency tree (same versions, same sha512) instead of resolving new
// versions on every deploy. pnpm installs the exact locked tree (frozen lockfile, the optional
// binaries of every platform, no scripts) into the artifact, npm writes its lockfile from that tree
// offline, and every entry must match that tree and pnpm-lock.yaml or the build fails.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const windows = process.platform === "win32";

function run(executable, args, cwd, env = process.env) {
  const result = spawnSync(executable, args, { cwd, env, stdio: "inherit", shell: windows });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Deploy lockfile: ${executable} ${args.join(" ")} exited with ${result.status}.`,
    );
  }
}

/** `name@version` -> sha512, from the `packages:` section of a pnpm v9 lockfile. */
export function lockedIntegrities(pnpmLock) {
  const start = pnpmLock.indexOf("\npackages:\n");
  const end = pnpmLock.indexOf("\nsnapshots:\n", start);
  if (start < 0 || end < 0)
    throw new Error("Deploy lockfile: pnpm-lock.yaml has no packages section.");
  const integrities = new Map();
  for (const [, key, integrity] of pnpmLock
    .slice(start, end)
    .matchAll(/^ {2}'?(.+?)'?:\n {4}resolution: \{integrity: (sha512-[^}]+)\}/gm)) {
    integrities.set(key, integrity);
  }
  return integrities;
}

/**
 * Points every npm lock entry at the registry tarball that pnpm-lock.yaml pins, or throws. Each
 * entry must also be exactly what pnpm installed at that location, so a version npm re-resolved
 * (from its cache, for instance) cannot pass just because another importer locks it.
 */
export function pinLockToPnpm(lock, integrities, installedVersion) {
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (location === "") continue;
    // `name` is only present for aliases (`string-width-cjs` installs string-width).
    const name = entry.name ?? location.slice(location.lastIndexOf("node_modules/") + 13);
    const key = `${name}@${entry.version}`;
    if (!entry.link && installedVersion(location) !== entry.version) {
      throw new Error(
        `Deploy lockfile: npm locked ${key} at ${location}, not what pnpm installed.`,
      );
    }
    const integrity = integrities.get(key);
    if (entry.link || integrity === undefined) {
      throw new Error(`Deploy lockfile: ${location} (${key}) is not in pnpm-lock.yaml.`);
    }
    if (entry.integrity !== undefined && entry.integrity !== integrity) {
      throw new Error(`Deploy lockfile: ${key} has a different sha512 than pnpm-lock.yaml.`);
    }
    entry.resolved = `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${entry.version}.tgz`;
    entry.integrity = integrity;
  }
  return lock;
}

/**
 * Deletes every installed package the lock does not list. The hoisted install ignores --filter and
 * also brings the other importers' packages (next, react...); without them the local tree used by
 * discovery, the emulator and the operator CLIs is the one Cloud Build installs.
 */
export function pruneToLock(deployRoot, packages) {
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (entry === ".bin") continue;
      const target = path.join(directory, entry);
      if (entry.startsWith("@")) {
        visit(target);
        if (readdirSync(target).length === 0) rmSync(target, { recursive: true });
        continue;
      }
      const location = path.relative(deployRoot, target).split(path.sep).join("/");
      if (!(location in packages)) rmSync(target, { recursive: true, force: true });
      else if (existsSync(path.join(target, "node_modules")))
        visit(path.join(target, "node_modules"));
    }
  };
  visit(path.join(deployRoot, "node_modules"));
}

export function writeDeployLockfile({ repositoryRoot, deployRoot }) {
  // Inside the artifact, so the rename below never crosses filesystems; removed before upload.
  const work = path.join(deployRoot, ".locked-dependencies");
  rmSync(work, { recursive: true, force: true });
  try {
    for (const file of [
      "package.json",
      "pnpm-workspace.yaml",
      "pnpm-lock.yaml",
      "apps/functions/package.json",
      "packages/domain/package.json",
    ]) {
      mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
      cpSync(path.join(repositoryRoot, file), path.join(work, file));
    }
    // --force also installs other platforms' optional binaries, so npm finds the whole tree on disk.
    run(
      windows ? "corepack.cmd" : "corepack",
      [
        "pnpm",
        "install",
        "--frozen-lockfile",
        "--force",
        "--prod",
        "--ignore-scripts",
        "--config.node-linker=hoisted",
        "--filter",
        "@bpt-jersey/functions...",
      ],
      work,
      { ...process.env, CI: "true" },
    );
    const modules = path.join(deployRoot, "node_modules");
    rmSync(modules, { recursive: true, force: true });
    renameSync(path.join(work, "node_modules"), modules);
    // lib/domain replaces the workspace link; the rest is pnpm bookkeeping.
    for (const entry of [
      "@bpt-jersey",
      ".pnpm",
      ".modules.yaml",
      ".pnpm-workspace-state-v1.json",
    ]) {
      rmSync(path.join(modules, entry), { recursive: true, force: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  // ponytail: pnpm overrides are not translated to npm `overrides`. None moves a functions dependency
  // out of its declared range today (the lockfile is identical without them). If one ever does, npm
  // re-resolves that dependency and the installed-version check fails; then add the npm form of
  // that override to the artifact package.json.
  run(
    windows ? "npm.cmd" : "npm",
    ["install", "--package-lock-only", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
    deployRoot,
  );
  const installedVersion = (location) => {
    try {
      return JSON.parse(readFileSync(path.join(deployRoot, location, "package.json"), "utf8"))
        .version;
    } catch {
      return undefined;
    }
  };
  const lockPath = path.join(deployRoot, "package-lock.json");
  const lock = pinLockToPnpm(
    JSON.parse(readFileSync(lockPath, "utf8")),
    lockedIntegrities(readFileSync(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8")),
    installedVersion,
  );
  pruneToLock(deployRoot, lock.packages);
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  // Same policy as allowBuilds in pnpm-workspace.yaml: no dependency install script runs in Cloud Build.
  writeFileSync(path.join(deployRoot, ".npmrc"), "ignore-scripts=true\n");
  console.log(
    `Deploy lockfile: ${Object.keys(lock.packages).length - 1} packages pinned to pnpm-lock.yaml.`,
  );
}

const invokedScript =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedScript) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  writeDeployLockfile({
    repositoryRoot,
    deployRoot: path.join(repositoryRoot, ".firebase-functions"),
  });
}
