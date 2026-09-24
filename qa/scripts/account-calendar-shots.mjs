// Workbench check for the member calendar: logs in as each seeded member on the tailnet
// workbench, screenshots phone + desktop, and prints a structural summary + console errors.
// Run from qa/: `node scripts/account-calendar-shots.mjs`
import { chromium } from "@playwright/test";

const base = process.env.ACCOUNT_BASE_URL ?? "https://optimyze-vps-de-prod.tail29c816.ts.net:9471";
const password = "Passw0rd!";
const users = [
  ["teen", "teen@bpt.test"],
  ["tutor", "tutor@bpt.test"],
];
const viewports = [
  ["phone", { width: 390, height: 844 }],
  ["desktop", { width: 1280, height: 800 }],
];

async function login(page, email) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/account/);
  await page.waitForSelector(".session-card, .day-empty, .calendar-error", { timeout: 20000 });
}

function summarize() {
  return {
    columns: document.querySelectorAll(".day-column").length,
    statuses: [...document.querySelectorAll(".session-card")].map((c) => c.dataset.status),
    chips: document.querySelectorAll(".member-chip").length,
    scrollWidth: document.documentElement.scrollWidth,
    todayHeading: document.querySelector(".day-column--today .day-heading")?.textContent ?? null,
  };
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
let failures = 0;
for (const [who, email] of users) {
  for (const [name, viewport] of viewports) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await login(page, email);
    await page.screenshot({ path: `screenshots/account-${who}-${name}.png`, fullPage: true });
    const summary = await page.evaluate(summarize);
    const expectedColumns = name === "phone" ? 2 : 6;
    const problems = [];
    if (summary.columns !== expectedColumns)
      problems.push(`columns ${summary.columns} != ${expectedColumns}`);
    if (summary.scrollWidth > viewport.width)
      problems.push(`horizontal overflow ${summary.scrollWidth}`);
    if (who === "tutor" && summary.chips !== 2) problems.push(`chips ${summary.chips} != 2`);
    if (who === "teen" && summary.chips !== 0) problems.push(`chips ${summary.chips} != 0`);
    if (errors.length) problems.push(`console: ${errors.join(" | ")}`);
    if (problems.length) failures += 1;
    console.log(
      `${who}/${name}`,
      JSON.stringify(summary),
      problems.length ? `PROBLEMS: ${problems.join("; ")}` : "ok",
    );

    if (who === "teen" && name === "desktop") {
      // Interaction round-trip: book → note → cancel via dialog → back to Book.
      // Pin the card first: once booked, the "Book" button disappears and a bare locator would drift.
      const sessionId = await page
        .locator("li.session-card--open")
        .first()
        .getAttribute("data-session-id");
      const card = page.locator(`li[data-session-id="${sessionId}"]`);
      await card.getByRole("button", { name: "Book" }).click();
      await card.getByText("Booked.", { exact: true }).waitFor({ timeout: 5000 });
      await page.screenshot({
        path: "screenshots/account-teen-desktop-booked.png",
        fullPage: true,
      });
      await card.getByRole("button", { name: "Booked · Cancel" }).click();
      await page.getByRole("dialog").waitFor();
      await page.screenshot({ path: "screenshots/account-teen-desktop-dialog.png" });
      await page.getByRole("dialog").getByRole("button", { name: "Cancel booking" }).click();
      await card.getByRole("button", { name: "Book" }).waitFor({ timeout: 5000 });
      console.log("teen/desktop interaction", "book → cancel round-trip ok");
    }
    await page.close();
  }
}
await browser.close();
if (failures) {
  console.log(`${failures} viewport(s) with problems`);
  process.exitCode = 1;
}
