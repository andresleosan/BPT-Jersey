import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: isCI,
  ...(isCI ? { retries: 2, workers: 1 } : { retries: 0 }),
  reporter: isCI
    ? [["github"], ["html", { outputFolder: "reports", open: "never" }]]
    : [["list"], ["html", { outputFolder: "reports", open: "never" }]],
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    locale: "en-GB",
    timezoneId: "Europe/Jersey",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "live-auth",
      testMatch: /login-gateway-live\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        screenshot: "off",
        trace: "off",
        video: "off",
      },
    },
    {
      name: "t017-mfa-live",
      testMatch: /admin-mfa-live\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        screenshot: "off",
        trace: "off",
        video: "off",
      },
    },
  ],
});
