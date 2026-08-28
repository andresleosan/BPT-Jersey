import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const runner = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "corepack";
const steps = [
  { name: "format:check", args: ["pnpm", "format:check"] },
  { name: "lint", args: ["pnpm", "lint"] },
  { name: "typecheck", args: ["pnpm", "typecheck"] },
  { name: "build", args: ["pnpm", "build"] },
  { name: "test:unit", args: ["pnpm", "test:unit"] },
  { name: "test:rules", args: ["pnpm", "test:rules"] },
  {
    name: "build:e2e-synthetic",
    args: ["pnpm", "--filter", "@bpt-jersey/web", "build"],
    env: { NEXT_PUBLIC_ADMIN_E2E: "true" },
  },
  {
    name: "test:load:synthetic",
    args: ["pnpm", "test:load:synthetic"],
    env: { NEXT_PUBLIC_ADMIN_E2E: "true" },
  },
  {
    name: "test:e2e:smoke",
    args: ["pnpm", "test:e2e:smoke"],
    env: { NEXT_PUBLIC_ADMIN_E2E: "true" },
  },
];
const env = { ...process.env, BPT_VERIFY_MVP: "true" };
// Firebase CLI can log the complete child environment when DEBUG is inherited.
delete env.DEBUG;

console.log(
  "verify:mvp: local synthetic-pilot gate; no deploy, migration, live load, or external payment.",
);
for (const step of steps) {
  console.log("");
  console.log("[verify:mvp] " + step.name);
  const stepEnv = { ...env, ...(step.env ?? {}) };
  const args = isWindows ? ["/d", "/s", "/c", "corepack " + step.args.join(" ")] : step.args;
  const result = spawnSync(runner, args, { env: stepEnv, stdio: "inherit" });
  if (result.error) {
    console.error("[verify:mvp] " + step.name + " could not start: " + result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      "[verify:mvp] " + step.name + " failed with exit code " + (result.status ?? "unknown") + ".",
    );
    process.exit(result.status ?? 1);
  }
}
console.log("");
console.log("verify:mvp: all local gates passed.");
