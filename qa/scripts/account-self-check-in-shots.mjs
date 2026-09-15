// Eight genuine-workbench states. Run from qa/: ACCOUNT_BASE_URL=https://optimyze-vps-de-prod.tail29c816.ts.net:9471 node scripts/account-self-check-in-shots.mjs
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.env.ACCOUNT_BASE_URL ?? "https://optimyze-vps-de-prod.tail29c816.ts.net:9471";
const password = "Passw0rd!";
const town = { latitude: 49.183954, longitude: -2.107142, accuracy: 12 };
const far = { latitude: 49.185034, longitude: -2.107142, accuracy: 12 };
const viewports = [
  ["phone", { width: 390, height: 844 }],
  ["desktop", { width: 1280, height: 800 }],
];
const states = [
  ["idle", town],
  ["locating", town],
  ["done", town],
  ["refused", far],
];
const selectedViewports = process.env.ACCOUNT_SCREENSHOT_VIEWPORT
  ? viewports.filter(([name]) => name === process.env.ACCOUNT_SCREENSHOT_VIEWPORT)
  : viewports;
const selectedStates = process.env.ACCOUNT_SCREENSHOT_STATE
  ? states.filter(([name]) => name === process.env.ACCOUNT_SCREENSHOT_STATE)
  : states;

if (selectedViewports.length === 0 || selectedStates.length === 0) {
  throw new Error(
    "ACCOUNT_SCREENSHOT_VIEWPORT must be phone or desktop; ACCOUNT_SCREENSHOT_STATE must be idle, locating, done, or refused.",
  );
}

function redact(message) {
  return String(message)
    .replace(/(authorization|x-firebase-appcheck):\s*[^\s]+/giu, "$1: [redacted]")
    .replace(/bearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gu, "[redacted JWT]");
}

async function login(page) {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill("teen@bpt.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/account(?:[?#]|$)/u);
  await page.waitForSelector(".ready-card", { timeout: 20_000 });
}

async function commitWithEnd(page) {
  await page.getByRole("slider", { name: /Slide to clock in/u }).focus();
  await page.keyboard.press("End");
}

async function delayActualGeolocation(context) {
  await context.addInitScript(() => {
    const geolocation = navigator.geolocation;
    const nativeGetCurrentPosition = geolocation.getCurrentPosition.bind(geolocation);
    Object.defineProperty(geolocation, "getCurrentPosition", {
      configurable: true,
      value(onSuccess, onError, options) {
        nativeGetCurrentPosition(
          (position) => window.setTimeout(() => onSuccess(position), 2_000),
          onError,
          options,
        );
      },
    });
  });
}

async function capture(browser, state, name, viewport, geolocation) {
  const context = await browser.newContext({
    geolocation,
    ignoreHTTPSErrors: true,
    permissions: ["geolocation"],
    viewport,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(redact(error.message)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(redact(message.text()));
  });
  try {
    if (state === "locating") await delayActualGeolocation(context);
    await login(page);
    if (state === "locating") {
      await commitWithEnd(page);
      await page.waitForFunction(
        () =>
          document.querySelector('[role="status"]')?.textContent === "Checking you're at the gym…",
      );
    } else if (state === "done") {
      await commitWithEnd(page);
      await page.waitForSelector(".ready-card--done");
    } else if (state === "refused") {
      await commitWithEnd(page);
      await page.waitForSelector(".ready-status--refused");
    }
    if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    if (dimensions.scrollWidth > dimensions.clientWidth)
      throw new Error(`Horizontal overflow: ${dimensions.scrollWidth} > ${dimensions.clientWidth}`);
    const path = `screenshots/ready-${state}-${name}.png`;
    await page.screenshot({ path, fullPage: true });
    console.log(path);
  } finally {
    await context.close();
  }
}

await mkdir("screenshots", { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, viewport] of selectedViewports) {
    for (const [state, geolocation] of selectedStates) {
      await capture(browser, state, name, viewport, geolocation);
    }
  }
} finally {
  await browser.close();
}
