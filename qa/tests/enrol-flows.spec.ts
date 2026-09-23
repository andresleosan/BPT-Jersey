import type { Browser, Page } from "@playwright/test";
import {
  createMemberAccount,
  expect,
  ownerEmail,
  routeFunctionsThroughNode,
  shot,
  signIn,
  test,
  transferScreenshot,
  uniqueEmail,
} from "./recovery-fixture";

// Rules R1–R4 of docs/superpowers/plans/2026-09-23-simple-access-recovery.md: every /enrol button
// from account creation to a real booking in /account, with the office approval in between.
test.describe.configure({ mode: "serial" });

const today = new Date().toISOString().slice(0, 10);

async function fillApplicant(
  page: Page,
  who: "adult" | "guardian",
  details: { name: string; dob: string; centre?: "Town" | "West" },
) {
  await page.getByLabel(
    who === "adult" ? "I am joining as an adult student" : "I am a parent or guardian enrolling a child",
  ).check();
  const applicant = page.locator("fieldset.enrol-applicant");
  await applicant.getByLabel("Full name").fill(details.name);
  await applicant.getByLabel("Date of birth").fill(details.dob);
  await applicant.getByLabel("Phone (required)").fill("07700900111");
  if (who === "adult") {
    await applicant.getByLabel("Training centre").selectOption(details.centre ?? "Town");
    await applicant.getByLabel("Evening").check();
  }
}

async function addChild(page: Page, index: number, name: string, dob: string) {
  await page.getByRole("button", { name: "Add a child" }).click();
  const child = page.getByRole("group", { name: `Child ${index + 1}` });
  await child.getByLabel("Full name").fill(name);
  await child.getByLabel("Date of birth").fill(dob);
  await child.getByLabel("Afternoon").check();
}

async function acceptWaiverAndContinue(page: Page) {
  await shot(page, `${test.info().title.slice(0, 2)}-1-waiver`);
  await page.locator(".enrol-waiver-accept input[type=checkbox]").check();
  await page.getByRole("button", { name: "Continue to plans" }).click();
  await expect(page.getByRole("heading", { name: "Choose your plans" })).toBeVisible();
}

async function payByTransfer(page: Page, expectedTotal: string) {
  await expect(page.getByRole("heading", { name: "Payment and review" })).toBeVisible();
  await expect(page.getByText(`Transfer total: ${expectedTotal}`)).toBeVisible();
  await page.getByLabel("Transfer date").fill(today);
  await page.getByLabel("Transfer reference").fill("SYNTH-REF-1");
  await page.getByLabel(/Payment screenshot/u).setInputFiles(transferScreenshot);
  await shot(page, `${test.info().title.slice(0, 2)}-2-payment`);
  await page.getByRole("button", { name: "Send request to the academy" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for the academy" })).toBeVisible({
    timeout: 60_000,
  });
  await shot(page, `${test.info().title.slice(0, 2)}-3-waiting`);
}

async function ownerApproves(browser: Browser, applicantName: string) {
  const context = await browser.newContext();
  const office = await context.newPage();
  await routeFunctionsThroughNode(office);
  await signIn(office, ownerEmail, { staff: true });
  await office.waitForURL(/\/admin/u);
  await office.goto("/admin/members/requests");
  const item = office.getByRole("listitem").filter({ hasText: applicantName });
  await item.getByRole("button", { name: "Review and enrol" }).click();
  await expect(item.getByRole("heading", { name: "Review and confirm enrolment" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(item.getByText(/verify|verification/iu)).toHaveCount(0); // D8
  // Office decisions by design: a paid plan starts without a level, a term plan without an end.
  const setups = item.locator("fieldset.enrolment-student-setup");
  for (let index = 0; index < (await setups.count()); index += 1) {
    const setup = setups.nth(index);
    const level = setup.getByLabel("Initial level");
    if ((await level.inputValue()) === "") await level.selectOption({ index: 1 });
    const ends = setup.getByLabel("Paid period ends");
    if ((await ends.count()) && (await ends.inputValue()) === "") {
      const end = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
      await ends.fill(end);
    }
  }
  await shot(office, `${test.info().title.slice(0, 2)}-4-office-review`);
  await item.getByRole("button", { name: "Approve" }).click();
  await expect(item.getByText(/Approved/u).first()).toBeVisible({ timeout: 90_000 });
  await office.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
}

async function bookFirstClass(page: Page, student?: string) {
  await page.goto("/account");
  if (student) {
    const chip = page.getByRole("button", { name: student, exact: true });
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await chip.click();
  }
  const book = page.getByRole("button", { name: /^Book( free (intro|trial class))?$/u }).first();
  await expect(book).toBeVisible({ timeout: 60_000 });
  await book.click();
  await expect(page.getByRole("button", { name: /^Booked/u }).first()).toBeVisible({
    timeout: 60_000,
  });
  await shot(page, `${test.info().title.slice(0, 2)}-5-booked${student ? `-${student}` : ""}`);
}

test("R1 adult with a prepaid plan enrols, is approved and books a class", async ({
  stackPage: page,
  browser,
}) => {
  const name = `Synthetic Adult ${Date.now().toString(36)}`;
  await createMemberAccount(page, uniqueEmail("r1-adult"));
  await page.goto("/enrol");
  await fillApplicant(page, "adult", { name, dob: "1990-04-02" });
  await acceptWaiverAndContinue(page);
  await page.getByRole("radio", { name: /Town Adult/u }).check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await payByTransfer(page, "£85.00");
  await ownerApproves(browser, name);
  await bookFirstClass(page);
});

test("R2 guardian enrols two children on different plans with one transfer", async ({
  stackPage: page,
  browser,
}) => {
  const name = `Synthetic Guardian ${Date.now().toString(36)}`;
  await createMemberAccount(page, uniqueEmail("r2-guardian"));
  await page.goto("/enrol");
  await fillApplicant(page, "guardian", { name, dob: "1985-06-10" });
  const surname = name.split(" ").pop();
  // Child chips in /account show first names, so siblings get distinct ones.
  await addChild(page, 0, `Ava ${surname}`, "2017-03-01");
  await addChild(page, 1, `Leo ${surname}`, "2015-09-12");
  await acceptWaiverAndContinue(page);
  const plans = page.locator("fieldset.enrol-plan-choices");
  await plans.nth(0).getByRole("radio", { name: /Town Kids & Teens 1x/u }).check();
  await plans.nth(1).getByRole("radio", { name: /Town Kids & Teens 2x/u }).check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await payByTransfer(page, "£230.00");
  await ownerApproves(browser, name);
  await bookFirstClass(page, "Ava");
  await bookFirstClass(page, "Leo");
});

test("R3 pay-as-you-go and beginner trial send without a screenshot", async ({
  stackPage: page,
  browser,
}) => {
  const payg = `Synthetic Payg ${Date.now().toString(36)}`;
  await createMemberAccount(page, uniqueEmail("r3-payg"));
  await page.goto("/enrol");
  await fillApplicant(page, "adult", { name: payg, dob: "1992-01-20", centre: "West" });
  await acceptWaiverAndContinue(page);
  await page.getByRole("radio", { name: /West Pay as you go/u }).check();
  await page.getByRole("button", { name: "Continue to review" }).click();
  await page.getByRole("button", { name: "Send request to the academy" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for the academy" })).toBeVisible({
    timeout: 60_000,
  });
  await ownerApproves(browser, payg);

  const trialPage = await page.context().browser()!.newPage();
  await routeFunctionsThroughNode(trialPage);
  const trial = `Synthetic Trial ${Date.now().toString(36)}`;
  await createMemberAccount(trialPage, uniqueEmail("r3-trial"));
  await trialPage.goto("/enrol");
  await fillApplicant(trialPage, "adult", { name: trial, dob: "1994-07-07" });
  await acceptWaiverAndContinue(trialPage);
  await trialPage.getByRole("radio", { name: /I am a beginner/u }).check();
  await trialPage.getByRole("button", { name: "Continue to review" }).click();
  await trialPage.getByRole("button", { name: "Send request to the academy" }).click();
  await expect(trialPage.getByRole("heading", { name: "Waiting for the academy" })).toBeVisible({
    timeout: 60_000,
  });
  await ownerApproves(browser, trial);
  await bookFirstClass(trialPage);
});

test("R4 removing a child and going back leaves no ghost child or amount", async ({
  stackPage: page,
}) => {
  const name = `Synthetic Edit ${Date.now().toString(36)}`;
  await createMemberAccount(page, uniqueEmail("r4-guardian"));
  await page.goto("/enrol");
  await fillApplicant(page, "guardian", { name, dob: "1984-02-02" });
  await addChild(page, 0, `${name} Keep`, "2016-05-05");
  await addChild(page, 1, `${name} Drop`, "2014-05-05");
  await acceptWaiverAndContinue(page);
  const plans = page.locator("fieldset.enrol-plan-choices");
  await plans.nth(0).getByRole("radio", { name: /Town Kids & Teens 2x/u }).check();
  await plans.nth(1).getByRole("radio", { name: /Town Kids & Teens 1x/u }).check();
  await page.getByRole("button", { name: "Back to details" }).click();
  await page.getByRole("button", { name: "Remove child 2" }).click();
  await expect(page.getByRole("group", { name: "Child 2" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to plans" }).click();
  await expect(page.locator("fieldset.enrol-plan-choices")).toHaveCount(1);
  await expect(page.locator("fieldset.enrol-plan-choices legend")).toContainText(`${name} Keep`);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByText("Transfer total: £135.00")).toBeVisible();
  await page.getByRole("button", { name: "Back to plans" }).click();
  await plans.nth(0).getByRole("radio", { name: /Town Kids & Teens 1x/u }).check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByText("Transfer total: £95.00")).toBeVisible();
});
