// Release delta for T058/T099: what the Functions code exports, what the web invokes, and what
// production actually has. Read-only by construction: the only remote call it can make is
// `firebase functions:list`, which reads metadata and never deploys, deletes or writes.
//
// The 2026-09-07 ledger counted "37 llamadas distintas, 30 sin desplegar" from a regex over
// `httpsCallable(` and was wrong by a factor of three, because most web clients pass
// `getFirebaseFunctions()` as the first argument or name the callable on its own line. This script
// intersects string literals with the export list instead, so the count does not depend on how a
// client happens to be formatted.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".next", "out"]);
const FUNCTIONS_SOURCE = "apps/functions/src";
const INDEX_SOURCE = `${FUNCTIONS_SOURCE}/index.ts`;

/**
 * Entries of every `export { a, b as c } from "./x.js"` statement in index.ts: the public name, the
 * local name inside the module and the module path relative to apps/functions/src (as a .ts file).
 * Type exports are dropped.
 */
export function parseIndexExports(indexSource) {
  const entries = [];
  const statement = /export\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g;
  let match;
  while ((match = statement.exec(indexSource)) !== null) {
    const modulePath = match[2].replace(/^\.\//u, "").replace(/\.js$/u, ".ts");
    for (const part of match[1].split(",")) {
      const entry = part.trim();
      if (entry === "" || entry.startsWith("type ")) continue;
      const [local, alias] = entry.split(/\s+as\s+/);
      entries.push({ name: (alias ?? local).trim(), local: local.trim(), module: modulePath });
    }
  }
  return entries;
}

/**
 * A Cloud Function is declared as `export const name = onCall(...)`, `onSchedule(...)` or another
 * firebase-functions trigger factory. Anything else index.ts re-exports (auth helpers, provisioning
 * functions used by scripts) is not deployable and must not count as missing from production.
 */
export function isCloudFunctionDeclaration(moduleSource, localName) {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^\\s*export const ${escaped}\\s*=\\s*on[A-Z][A-Za-z]*\\(`, "mu").test(
    moduleSource,
  );
}

/** Public names of the deployable exports, plus the names that were skipped and why. */
export function listCloudFunctionExports(indexSource, readModuleSource) {
  const names = new Set();
  const skipped = [];
  for (const entry of parseIndexExports(indexSource)) {
    if (isCloudFunctionDeclaration(readModuleSource(entry.module), entry.local)) {
      names.add(entry.name);
    } else {
      skipped.push(entry.name);
    }
  }
  return { names: [...names].sort(), skipped: [...new Set(skipped)].sort() };
}

function walkSourceFiles(directory, visit) {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) walkSourceFiles(full, visit);
      continue;
    }
    if (!/\.tsx?$/u.test(entry) || /\.test\.tsx?$/u.test(entry)) continue;
    visit(full, readFileSync(full, "utf8"));
  }
}

/**
 * Callable names the web invokes: string literals that match an export name, taken only from files
 * that use `httpsCallable`, so a route label or a status string never counts as an invocation.
 * Returns a Map of name -> sorted list of relative files.
 */
export function collectWebCallableNames(webSourceDirectory, exportNames) {
  const candidates = new Set(exportNames);
  const invoked = new Map();
  const literal = /["'`]([A-Za-z][A-Za-z0-9_]+)["'`]/g;
  walkSourceFiles(webSourceDirectory, (file, source) => {
    if (!source.includes("httpsCallable")) return;
    const relative = path.relative(webSourceDirectory, file).split(path.sep).join("/");
    let match;
    while ((match = literal.exec(source)) !== null) {
      const name = match[1];
      if (!candidates.has(name)) continue;
      if (!invoked.has(name)) invoked.set(name, new Set());
      invoked.get(name).add(relative);
    }
  });
  return new Map(
    [...invoked.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, files]) => [name, [...files].sort()]),
  );
}

function triggerOf(entry) {
  if (entry.callableTrigger !== undefined) return "callable";
  if (entry.scheduleTrigger !== undefined) return "scheduled";
  if (entry.httpsTrigger !== undefined) return "https";
  const key = Object.keys(entry).find((name) => name.endsWith("Trigger"));
  return key === undefined ? "unknown" : key.replace(/Trigger$/u, "");
}

/** Deployed functions from `firebase functions:list --json`: id, trigger, last deploy time, secrets. */
export function parseDeployedFunctions(jsonText) {
  const parsed = JSON.parse(jsonText);
  const entries = Array.isArray(parsed) ? parsed : (parsed.result ?? []);
  return entries
    .map((entry) => {
      const generation = entry.source?.storageSource?.generation;
      return {
        id: entry.id,
        region: entry.region ?? "",
        trigger: triggerOf(entry),
        // The source generation is microseconds since the epoch and marks the upload that produced
        // the current revision, which is the closest thing the CLI exposes to "deployed at".
        deployedAt:
          generation === undefined ? "" : new Date(Number(generation) / 1000).toISOString(),
        secrets: (entry.secretEnvironmentVariables ?? []).map((secret) => secret.key).sort(),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function computeReleaseDelta({ exportNames, webCallables, deployed, skippedExports = [] }) {
  const deployedIds = new Set(deployed.map((entry) => entry.id));
  const exportSet = new Set(exportNames);
  const webNames = [...webCallables.keys()];
  return {
    exportedCount: exportNames.length,
    deployedCount: deployed.length,
    webInvokedCount: webNames.length,
    webMissing: webNames
      .filter((name) => !deployedIds.has(name))
      .map((name) => ({ name, files: webCallables.get(name) })),
    codeMissing: exportNames.filter((name) => !deployedIds.has(name)),
    orphaned: deployed.filter((entry) => !exportSet.has(entry.id)),
    skippedExports: [...skippedExports],
  };
}

export function renderReleaseDelta(delta, deployed) {
  const lines = [
    "# Release delta",
    "",
    `- Cloud Functions exported by ${INDEX_SOURCE}: ${delta.exportedCount}`,
    `- Deployed in the target project: ${delta.deployedCount}`,
    `- Invoked by apps/web/src: ${delta.webInvokedCount}`,
  ];
  if (delta.skippedExports.length > 0) {
    lines.push(
      `- Re-exported by index.ts but not Cloud Functions, ignored: ${delta.skippedExports.join(", ")}`,
    );
  }
  lines.push("", `## Invoked by the web but not deployed (${delta.webMissing.length})`, "");
  for (const { name, files } of delta.webMissing) lines.push(`- ${name} (${files.join(", ")})`);
  lines.push("", `## Exported but not deployed (${delta.codeMissing.length})`, "");
  lines.push(delta.codeMissing.length === 0 ? "- none" : `- ${delta.codeMissing.join(", ")}`);
  lines.push(
    "",
    `## Deployed but no longer exported: a full \`--only functions\` deploy would delete these (${delta.orphaned.length})`,
    "",
  );
  for (const entry of delta.orphaned) {
    lines.push(`- ${entry.id} (${entry.trigger}, deployed ${entry.deployedAt || "unknown"})`);
  }
  if (delta.orphaned.length === 0) lines.push("- none");
  lines.push(
    "",
    "## Deployed inventory",
    "",
    "| Function | Trigger | Deployed at | Secrets |",
    "| --- | --- | --- | --- |",
  );
  for (const entry of deployed) {
    lines.push(
      `| ${entry.id} | ${entry.trigger} | ${entry.deployedAt || "unknown"} | ${entry.secrets.join(", ") || "-"} |`,
    );
  }
  return lines.join("\n") + "\n";
}

export const GOOGLE_CLOUD_PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
// What `git show <ref>:<path>` accepts here: a branch, tag or abbreviated hash, never an option.
const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/u;

function parseArguments(argv) {
  const options = { deployed: undefined, project: undefined, ref: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    // Split on the first "=" only: a Windows path or a query string may carry more of them.
    const separator = argument.indexOf("=");
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
    const value = inlineValue ?? argv[index + 1];
    if (flag === "--deployed" || flag === "--project" || flag === "--ref") {
      if (value === undefined || value === "" || value.startsWith("--")) {
        throw new Error(`${flag} needs a value.`);
      }
      options[flag.slice(2)] = value;
      if (inlineValue === undefined) index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${argument}.`);
  }
  if ((options.deployed === undefined) === (options.project === undefined)) {
    throw new Error("Pass exactly one of --deployed <functions-list.json> or --project <id>.");
  }
  // On Windows the firebase CLI is spawned through the shell, which concatenates arguments
  // instead of escaping them, so the project id must be a Google Cloud project id and nothing else
  // before it reaches the command line.
  if (options.project !== undefined && !GOOGLE_CLOUD_PROJECT_ID.test(options.project)) {
    throw new Error(
      "--project must be a Google Cloud project id (lowercase letters, digits, hyphens).",
    );
  }
  if (options.ref !== undefined && !GIT_REF.test(options.ref)) {
    throw new Error("--ref must be a git branch, tag or commit hash.");
  }
  return options;
}

function readDeployedJson(options, repositoryRoot) {
  if (options.deployed !== undefined) return readFileSync(options.deployed, "utf8");
  // `functions:list` only reads metadata. No other firebase command is reachable from here.
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["firebase", "functions:list", "--project", options.project, "--json"],
    { cwd: repositoryRoot, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`firebase functions:list exited with ${result.status}: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Reads a repository file from the working tree, or from `--ref` through `git show`. Only the
 * Functions side (index.ts and its modules) honours --ref; the web scan always reads the working
 * tree, so a mixed baseline must be read as such.
 */
function sourceReader(options, repositoryRoot) {
  return (relativePath) => {
    if (options.ref === undefined) {
      return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    }
    const result = spawnSync("git", ["show", `${options.ref}:${relativePath}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(`git show ${options.ref}:${relativePath} failed.`);
    return result.stdout;
  };
}

export function main(argv, { repositoryRoot, stdout }) {
  const options = parseArguments(argv);
  const read = sourceReader(options, repositoryRoot);
  const { names: exportNames, skipped } = listCloudFunctionExports(read(INDEX_SOURCE), (module) =>
    read(`${FUNCTIONS_SOURCE}/${module}`),
  );
  const webCallables = collectWebCallableNames(
    path.join(repositoryRoot, "apps/web/src"),
    exportNames,
  );
  const deployed = parseDeployedFunctions(readDeployedJson(options, repositoryRoot));
  const delta = computeReleaseDelta({
    exportNames,
    webCallables,
    deployed,
    skippedExports: skipped,
  });
  stdout.write(renderReleaseDelta(delta, deployed));
  return delta;
}

const invokedScript =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedScript) {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  try {
    main(process.argv.slice(2), { repositoryRoot, stdout: process.stdout });
  } catch (error) {
    console.error(`release-delta: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
