import { expect, test, type Page } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
  "base64",
);
const applicant = {
  fullName: "Synthetic applicant",
  dateOfBirth: "1994-04-02",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  phoneNumber: "07700900123",
  email: "applicant@example.test",
  postalAddress: { line: "1 Synthetic Street", postCode: "JE2 3AB" },
};
const row = {
  enrolmentRequestId: "enrolment-synthetic",
  applicantName: applicant.fullName,
  applicantIsStudent: true,
  minorCount: 0,
  trainingCenter: "Town",
  status: "submitted",
  submittedAt: "2026-09-19T12:00:00.000Z",
};
const detail = {
  ...row,
  applicant,
  minors: [],
  submittedBy: "synthetic-applicant",
  planSelections: { applicant: "town-adult", minors: [] },
  payment: {
    proofId: "a".repeat(64),
    amountMinor: 8500,
    paidOn: "2026-09-19",
    reference: "SYNTHETIC",
  },
  paymentProofUrl: "https://evidence.example.test/transfer.png",
  waiverAcceptance: {
    version: "1",
    acceptedAt: "2026-09-19T12:00:00.000Z",
    acceptedBy: "synthetic-applicant",
    contentHash: "a".repeat(64),
  },
};

async function harness(
  page: Page,
  options: {
    failUpload?: boolean;
    failDetail?: boolean;
    delayUpload?: boolean;
    noStaffEmail?: boolean;
    failRole?: boolean;
  } = {},
) {
  const calls: { name: string; data: Record<string, unknown> }[] = [];
  let roleFailures = options.failRole ? 1 : 0;
  let uploadFailures = options.failUpload ? 1 : 0;
  let detailFailures = options.failDetail ? 1 : 0;
  const now = Math.floor(Date.now() / 1000);
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const sessionValue = [
    encoded({ alg: "none" }),
    encoded({
      sub: "synthetic-applicant",
      user_id: "synthetic-applicant",
      email: "applicant@example.test",
      name: applicant.fullName,
      role: "shopper",
      academyId: "bpt-jersey",
      iat: now,
      exp: now + 3600,
      auth_time: now,
      firebase: { sign_in_provider: "password" },
    }),
    "synthetic",
  ].join(".");
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === new URL(process.env.BASE_URL ?? "http://127.0.0.1:3100").origin) {
      if (
        process.env.ADMIN_FIXTURE_STATIC_EXPORT !== "false" &&
        req.isNavigationRequest() &&
        !url.pathname.includes(".")
      ) {
        url.pathname = `${url.pathname.replace(/\/$/, "")}.html`;
        return route.continue({ url: url.toString() });
      }
      return route.continue();
    }
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (url.hostname === "evidence.example.test")
      return route.fulfill({ contentType: "image/png", body: png });
    if (url.pathname.includes("accounts:signInWithPassword"))
      return route.fulfill({
        headers,
        contentType: "application/json",
        body: JSON.stringify({
          idToken: sessionValue,
          refreshToken: "synthetic",
          expiresIn: "3600",
          localId: "synthetic-applicant",
          email: "applicant@example.test",
          displayName: applicant.fullName,
          registered: true,
        }),
      });
    if (url.pathname.includes("accounts:lookup"))
      return route.fulfill({
        headers,
        contentType: "application/json",
        body: JSON.stringify({
          users: [
            {
              localId: "synthetic-applicant",
              email: "applicant@example.test",
              displayName: applicant.fullName,
              emailVerified: true,
              providerUserInfo: [{ providerId: "password", email: "applicant@example.test" }],
            },
          ],
        }),
      });
    if (req.method() !== "POST") return route.abort();
    const name = url.pathname.split("/").at(-1)!;
    const data = req.postDataJSON()?.data ?? {};
    calls.push({ name, data });
    const failure = () =>
      route.fulfill({
        status: 503,
        headers,
        contentType: "application/json",
        body: JSON.stringify({
          error: { status: "UNAVAILABLE", message: "Synthetic unavailable" },
        }),
      });
    let result: unknown;
    if (name === "listMyEnrolmentRequests") result = [];
    else if (name === "getEnrolmentPaymentInstructions") result = { instructions: null };
    else if (name === "uploadEnrolmentPaymentProof") {
      if (options.delayUpload) await new Promise((resolve) => setTimeout(resolve, 700));
      if (uploadFailures-- > 0) return failure();
      result = { proofId: "a".repeat(64) };
    } else if (name === "submitEnrolmentRequest")
      result = {
        enrolmentRequestId: "enrolment-synthetic",
        status: "submitted",
        submittedAt: "2026-09-20T12:00:00.000Z",
      };
    else if (name === "listAdminNotifications")
      result = { notifications: [], nextCursor: null, unreadCount: 0 };
    else if (name === "listEnrolmentRequests") result = { requests: [row], truncated: false };
    else if (name === "getEnrolmentRequestDetail") {
      if (detailFailures-- > 0) return failure();
      result = detail;
    } else if (name === "approveEnrolmentRequest")
      result = {
        enrolmentRequestId: row.enrolmentRequestId,
        role: "adultStudent",
        studentIds: ["synthetic-student"],
        alreadyApproved: false,
      };
    else if (name === "listTeamDirectory")
      result = {
        people: [
          {
            userId: "synthetic-coach",
            name: "Synthetic coach",
            email: options.noStaffEmail ? null : "coach@example.test",
            role: "coach",
          },
        ],
        nextPageToken: null,
      };
    else if (["listStaffInvitations", "listStaffProfiles"].includes(name)) result = [];
    else if (name === "listStaffPermissionGrants") result = { grants: [] };
    else if (name === "changeTeamRole") {
      if (options.failRole) await new Promise((resolve) => setTimeout(resolve, 700));
      if (roleFailures-- > 0) return failure();
      result = { changed: true };
    } else if (name === "createStaffInvitation")
      result = {
        id: "a".repeat(64),
        version: "synthetic-version",
        academyId: "bpt-jersey",
        email: data.email,
        role: data.role,
        invitedBy: "synthetic-owner",
        createdAt: "2026-09-20T12:00:00.000Z",
        expiresAt: "2026-09-27T12:00:00.000Z",
        status: "pending",
        claimedBy: null,
      };
    else return route.abort();
    return route.fulfill({
      headers,
      contentType: "application/json",
      body: JSON.stringify({ result }),
    });
  });
  return calls;
}
async function signIn(page: Page) {
  await page.goto("/login?returnTo=%2Fenrol");
  await page.getByLabel("Email address").fill("applicant@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic-only-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/enrol/u);
  await page.getByLabel("Full name", { exact: true }).fill(applicant.fullName);
  await page.getByLabel("Date of birth", { exact: true }).fill(applicant.dateOfBirth);
  await page.getByLabel("Phone (required)").fill(applicant.phoneNumber);
  await page.getByLabel("Evening", { exact: true }).check();
  await page.getByRole("checkbox", { name: /read and understand this waiver/i }).check();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

test("registration requires evidence and retains details on upload failure", async ({
  page,
}, info) => {
  if (info.project.name.includes("mobile")) await page.setViewportSize({ width: 320, height: 740 });
  const calls = await harness(page, { failUpload: true, delayUpload: true });
  await signIn(page);
  await page.getByRole("button", { name: "Continue to plans" }).click();
  await expect(page.getByText(/Suggested for your age group/)).toBeVisible();
  await page.getByRole("radio", { name: /Town Adult/ }).check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: "Send request to the academy" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Add the transfer date" })).toBeVisible();
  expect(calls.some((call) => call.name === "submitEnrolmentRequest")).toBe(false);
  await page.getByLabel("Transfer date").fill("2026-09-19");
  await page.getByLabel("Transfer reference").fill("SYNTHETIC");
  await page
    .getByLabel(/Payment screenshot/)
    .setInputFiles({ name: "transfer.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Send request to the academy" }).click();
  await expect(page.getByRole("button", { name: /Sending/ })).toBeDisabled();
  await page.screenshot({
    path: `../.tmp/enrolment-loading-${info.project.name}.png`,
    fullPage: true,
  });
  await expect(page.getByRole("alert").filter({ hasText: "Unable to upload" })).toBeVisible();
  await expect(page.getByLabel("Transfer reference")).toHaveValue("SYNTHETIC");
  await noOverflow(page);
  await page.screenshot({
    path: `../.tmp/enrolment-payment-error-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Send request to the academy" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Waiting for the academy" })).toBeVisible();
  expect(calls.filter((call) => call.name === "submitEnrolmentRequest")).toHaveLength(1);
});

test("West PAYG submits without a screenshot", async ({ page }, info) => {
  const calls = await harness(page);
  await signIn(page);
  await page.getByRole("combobox", { name: "Training centre", exact: true }).selectOption("West");
  await page.getByRole("button", { name: "Continue to plans" }).click();
  await page.getByRole("radio", { name: /West Pay as you go/ }).check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByText(/No payment screenshot is needed/)).toBeVisible();
  await expect(page.getByLabel(/Payment screenshot/)).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({
    path: `../.tmp/enrolment-payg-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Send request to the academy" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for the academy" })).toBeVisible();
  expect(calls.some((call) => call.name === "uploadEnrolmentPaymentProof")).toBe(false);
  expect(calls.find((call) => call.name === "submitEnrolmentRequest")?.data).not.toHaveProperty(
    "payment",
  );
});

test("administrator retries full review and approves a chosen striped belt", async ({
  page,
}, info) => {
  const calls = await harness(page, { failDetail: true });
  await page.goto("/admin/members/requests?adminTestRole=administrator");
  const approve = page.getByRole("button", { name: "Approve and enrol" });
  await expect(approve).toBeDisabled();
  await page.getByRole("button", { name: "Read the full request" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Unable to open" })).toBeVisible();
  await page.getByRole("button", { name: "Read the full request" }).click();
  await expect(page.getByText(/1 Synthetic Street/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open payment screenshot" })).toHaveAttribute(
    "href",
    detail.paymentProofUrl,
  );
  const options = await page
    .getByRole("combobox", { name: "Initial level", exact: true })
    .locator("option")
    .allTextContents();
  const yellow = options.find((name) => /yellow.*2.*stripe/i.test(name));
  expect(yellow).toBeTruthy();
  await page
    .getByRole("combobox", { name: "Initial level", exact: true })
    .selectOption({ label: yellow! });
  await page.getByLabel(/I have verified/).check();
  await page.getByLabel(/I have checked/).check();
  await noOverflow(page);
  await page.screenshot({
    path: `../.tmp/enrolment-review-${info.project.name}.png`,
    fullPage: true,
  });
  await approve.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "is enrolled" })).toBeVisible();
  expect(calls.find((call) => call.name === "approveEnrolmentRequest")?.data.setup).toMatchObject({
    detailsVerified: true,
    paymentVerified: true,
    students: [
      expect.objectContaining({ planId: "town-adult", definitionKey: expect.any(String) }),
    ],
  });
});

test("owner promotes a coach and creates administrative access in one staff form", async ({
  page,
}, info) => {
  const calls = await harness(page);
  await page.goto("/admin/staff?adminTestRole=owner");
  await page.getByRole("button", { name: "Change role for Synthetic coach" }).click();
  await page.getByLabel("New role").selectOption("administrator");
  await page.getByRole("button", { name: "Review role change" }).click();
  await page.getByRole("button", { name: "Confirm access" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Role changed" })).toBeVisible();
  expect(calls.find((call) => call.name === "changeTeamRole")?.data).toEqual({
    userId: "synthetic-coach",
    email: "coach@example.test",
    role: "administrator",
  });
  await page.getByLabel("Staff email").fill("new-owner@example.test");
  await page.getByLabel("Staff role").selectOption("owner");
  await page.getByRole("button", { name: "Review staff access" }).click();
  await page.getByRole("button", { name: "Confirm access" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Access authorised" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create staff profile" })).toHaveCount(1);
  await expect(page.getByLabel("User ID", { exact: true })).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({
    path: `../.tmp/enrolment-staff-${info.project.name}.png`,
    fullPage: true,
  });
});

for (const role of ["administrator", "owner"] as const) {
  test(`owner changes an email-less coach to ${role} with keyboard and save retry`, async ({
    page,
  }, info) => {
    if (info.project.name.includes("mobile"))
      await page.setViewportSize({ width: 320, height: 740 });
    const calls = await harness(page, { noStaffEmail: true, failRole: true });
    await page.goto("/admin/staff?adminTestRole=owner");
    const change = page.getByRole("button", { name: "Change role for Synthetic coach" });
    await expect(change).toBeEnabled();
    await change.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("New role")).toBeFocused();
    await page.getByLabel("New role").selectOption(role);
    await page.getByRole("button", { name: "Review role change" }).click();
    const confirm = page.getByRole("button", { name: "Confirm access" });
    await expect(confirm).toBeFocused();
    await expect(page.getByText(/will receive/)).toContainText("Synthetic coach");
    await expect(page.getByText(/Their existing staff account/)).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: `../.tmp/staff-no-email-${role}-${info.project.name}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Saving access…" })).toBeDisabled();
    await expect(
      page.getByRole("alert").filter({ hasText: "Unable to change this role" }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Team directory" }).getByText("Coach", { exact: true }),
    ).toBeVisible();
    await confirm.click();
    await expect(page.getByRole("status").filter({ hasText: "Role changed" })).toBeVisible();
    expect(calls.filter((call) => call.name === "changeTeamRole").map((call) => call.data)).toEqual(
      [
        { userId: "synthetic-coach", email: null, role },
        { userId: "synthetic-coach", email: null, role },
      ],
    );
    await expect(
      page
        .getByRole("table", { name: "Team directory" })
        .getByText(role === "owner" ? "Owner" : "Administrator", { exact: true }),
    ).toBeVisible();
    await noOverflow(page);
  });
}
