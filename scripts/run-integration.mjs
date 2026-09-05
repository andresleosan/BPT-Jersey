import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import { withEmulatorJavaEnv } from "./emulator-java-env.mjs";

// Periodic gate for qa/integration: the Firestore/Auth emulator battery that
// verify:mvp does not run. Suites that need an unavailable capability skip
// themselves with a reason instead of failing.
const require = createRequire(import.meta.url);
const firebaseCli = require.resolve("firebase-tools/lib/bin/firebase.js");
const env = { ...withEmulatorJavaEnv(), BPT_TEST_INTEGRATION: "true" };

console.log(
  "test:integration: local emulator battery against demo-bpt-jersey; no deploy, no real project.",
);

// The CLI binary is spawned directly, without a shell, so the quoting of the
// inner command survives on Windows as well as on POSIX shells.
const result = spawnSync(
  process.execPath,
  [
    firebaseCli,
    "emulators:exec",
    "--project",
    "demo-bpt-jersey",
    "--only",
    "auth,firestore,database",
    "vitest run --project firestore-integration",
  ],
  { env, stdio: "inherit" },
);

if (result.error) {
  console.error("test:integration could not start: " + result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
