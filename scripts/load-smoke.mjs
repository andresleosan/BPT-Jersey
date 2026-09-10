import { spawn } from "node:child_process";

const host = "127.0.0.1";
const port = 3100;
const baseUrl = "http://" + host + ":" + port;
const routes = ["/", "/admin", "/admin/members", "/account"];
const totalRequests = 240;
const concurrency = 24;
const requestTimeoutMs = 5000;

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { method: "HEAD" });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Static load server did not become ready.");
}

async function requestRoute(path) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(baseUrl + path, {
      headers: { "x-bpt-synthetic-load": "true" },
      signal: controller.signal,
    });
    await response.arrayBuffer();
    return { path, status: response.status, durationMs: performance.now() - startedAt };
  } catch (error) {
    return {
      path,
      status: 0,
      durationMs: performance.now() - startedAt,
      error: error instanceof Error ? error.name : "unknown",
    };
  } finally {
    clearTimeout(timeout);
  }
}

const server = spawn(process.execPath, ["qa/serve-static.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, BPT_SYNTHETIC_LOAD: "true" },
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
});

try {
  await waitForServer();
  const results = [];
  let nextRequest = 0;

  async function worker() {
    while (true) {
      const requestIndex = nextRequest++;
      if (requestIndex >= totalRequests) return;
      results.push(await requestRoute(routes[requestIndex % routes.length]));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const failures = results.filter((result) => result.status !== 200);
  const durations = results.map((result) => result.durationMs);
  const summary = {
    totalRequests: results.length,
    concurrency,
    routes,
    failures: failures.length,
    p50Ms: Math.round(percentile(durations, 0.5)),
    p95Ms: Math.round(percentile(durations, 0.95)),
    p99Ms: Math.round(percentile(durations, 0.99)),
    maxMs: Math.round(Math.max(...durations)),
  };
  console.log("[load:synthetic] " + JSON.stringify(summary));
  if (failures.length > 0) {
    console.error("[load:synthetic] failed routes: " + JSON.stringify(failures.slice(0, 5)));
    process.exitCode = 1;
  } else if (summary.p95Ms > 1000) {
    console.error("[load:synthetic] p95 exceeded the local 1000ms guardrail.");
    process.exitCode = 1;
  }
} finally {
  server.kill();
}
