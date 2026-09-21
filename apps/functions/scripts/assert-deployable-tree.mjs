#!/usr/bin/env node
// Firebase predeploy guard. A deploy compiles whatever is on disk, so unfinished work from anyone
// sharing this checkout would ship with it (it happened on 2026-09-21). Deploy only what is
// committed and already on origin/main.
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

try {
  git("fetch", "--quiet", "origin", "main");
} catch {
  console.warn(
    "Deploy guard: could not fetch origin; comparing against the last known origin/main.",
  );
}
const problems = [];
const tracked = git("status", "--porcelain", "--untracked-files=no");
if (tracked) problems.push(`Uncommitted changes:\n${tracked}`);
const untrackedSource = git("status", "--porcelain", "--", "apps/functions", "packages/domain")
  .split("\n")
  .filter((line) => line.startsWith("??"));
if (untrackedSource.length > 0)
  problems.push(`Untracked source files:\n${untrackedSource.join("\n")}`);
const head = git("rev-parse", "HEAD");
if (head !== git("rev-parse", "origin/main")) {
  problems.push(`HEAD ${head.slice(0, 7)} is not origin/main. Push (or pull) first.`);
}
if (problems.length > 0) {
  console.error(`Deploy refused.\n\n${problems.join("\n\n")}`);
  process.exit(1);
}
console.log(`Deploy guard: clean tree at ${head.slice(0, 7)}, equal to origin/main.`);
