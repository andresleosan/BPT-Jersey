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
    // T08: phone, tablet and iOS Safari coverage. Only the responsive spec runs here, so the
    // rest of the suite (and CI, which installs Chromium alone) is unchanged.
    {
      name: "mobile-webkit",
      testMatch: /t08-responsive\.spec\.ts/,
      use: { ...devices["iPhone 15"] },
    },
    {
      name: "tablet-webkit",
      testMatch: /t08-responsive\.spec\.ts/,
      use: { ...devices["iPad Pro 11"] },
    },
    {
      name: "tablet-webkit-landscape",
      testMatch: /t08-responsive\.spec\.ts/,
      use: { ...devices["iPad Pro 11 landscape"] },
    },
    {
      name: "tablet-chromium",
      testMatch: /t08-responsive\.spec\.ts/,
      use: { ...devices["Galaxy Tab S4"] },
    },
    {
      name: "desktop-webkit",
      testMatch: /t08-responsive\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
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
  ],
});
