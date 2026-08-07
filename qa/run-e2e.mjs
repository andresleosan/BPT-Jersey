import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const host = "127.0.0.1";
const port = 3100;
const localBaseUrl = `http://${host}:${port}`;
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const extraArguments = process.argv.slice(2);
const projectBrowserCache = resolve(import.meta.dirname, "..", ".playwright-browsers");

const testEnvironment = { ...process.env };
if (!testEnvironment.PLAYWRIGHT_BROWSERS_PATH && existsSync(projectBrowserCache)) {
  testEnvironment.PLAYWRIGHT_BROWSERS_PATH = projectBrowserCache;
}

function waitForProcess(childProcess) {
  return new Promise((resolvePromise, rejectPromise) => {
    childProcess.once("error", rejectPromise);
    childProcess.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) {
        return;
      }
    } catch {
      // The server can refuse connections briefly while its socket is opening.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  throw new Error(`Static test server did not become ready at ${url}`);
}

async function stopProcess(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }

  childProcess.kill("SIGTERM");
  await Promise.race([
    waitForProcess(childProcess),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ]);

  if (childProcess.exitCode === null && childProcess.signalCode === null) {
    childProcess.kill("SIGKILL");
  }
}

let serverProcess;
let testProcess;

function stopChildren() {
  testProcess?.kill("SIGTERM");
  serverProcess?.kill("SIGTERM");
}

process.once("SIGINT", stopChildren);
process.once("SIGTERM", stopChildren);

try {
  const baseURL = process.env.BASE_URL ?? localBaseUrl;

  if (!process.env.BASE_URL) {
    serverProcess = spawn(process.execPath, ["serve-static.mjs"], {
      cwd: import.meta.dirname,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });
    await waitForServer(baseURL);
  }

  testProcess = spawn(
    process.execPath,
    [playwrightCli, "test", "--config", "playwright.config.ts", ...extraArguments],
    {
      cwd: import.meta.dirname,
      env: { ...testEnvironment, BASE_URL: baseURL },
      stdio: "inherit",
      windowsHide: true,
    },
  );

  const result = await waitForProcess(testProcess);
  if (result.signal) {
    throw new Error(`Playwright exited after receiving ${result.signal}`);
  }
  process.exitCode = result.code ?? 1;
} finally {
  if (serverProcess) {
    await stopProcess(serverProcess);
  }
}
