import { expect, test, type Page, type Route } from "@playwright/test";
import { randomBytes } from "node:crypto";

import { installAdminFixture } from "./admin-fixture";

/**
 * 25 September batch, phone width (375×667).
 *
 * - Office calendar, groups and member payments run against the NEXT_PUBLIC_ADMIN_E2E static build:
 *   every callable is answered here with synthetic data (the server rules are unit-tested in
 *   apps/functions).
 * - Account settings run against the emulator-wired static build and a real Auth Emulator: the
 *   member signs in and re-authenticates for real, while the account callables are answered here.
 *   Run inside `firebase emulators:exec --project demo-bpt-jersey --only auth` with
 *   AUTH_EMULATOR_E2E=true.
 */
test.use({ viewport: { width: 375, height: 667 } });

const adminBuild = process.env.NEXT_PUBLIC_ADMIN_E2E === "true";
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const authEmulatorRun = process.env.AUTH_EMULATOR_E2E === "true" && Boolean(authEmulatorHost);

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

async function refuseWith(route: Route, status: string, message: string): Promise<void> {
  await route.fulfill({
    status: 400,
    contentType: "application/json",
    body: JSON.stringify({ error: { status, message } }),
  });
}

/* ---------------------------------- Office calendar toolbar ---------------------------------- */

const calendarLocation = {
  locationId: "town",
  academyId: "synthetic-academy",
  name: "BPT Town",
  address: "Synthetic address",
  timezone: "Europe/Jersey",
  active: true,
  schemaVersion: "1",
};
const calendarProgram = {
  programId: "gi",
  academyId: "synthetic-academy",
  name: "Synthetic Gi",
  ageBand: "adult",
  discipline: "bjj",
  level: "all-levels",
  active: true,
  schemaVersion: "1",
  colour: "#F0EFFF",
};

test.describe("office calendar toolbar on a phone", () => {
  test.skip(!adminBuild, "needs the NEXT_PUBLIC_ADMIN_E2E static build");

  for (const width of [375, 320]) {
    test(`course link and toolbar buttons keep their size at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 667 });
      await page.clock.setFixedTime(new Date("2026-09-14T10:00:00.000Z"));
      await installAdminFixture(page, {
        role: "owner",
        callables: {
          listScheduleCatalog: { locations: [calendarLocation], programs: [calendarProgram] },
          listSessions: { sessions: [] },
          listSessionBookedCounts: { counts: {} },
          listStaffProfiles: [],
        },
      });
      await page.goto("/admin/classes-services/classes?adminTestRole=owner");

      const toolbar = page.locator(".cs-toolbar");
      const course = toolbar.getByRole("link", { name: "Create course / seminar" });
      await expect(course).toBeVisible();

      const toolbarBox = await toolbar.boundingBox();
      const courseBox = await course.boundingBox();
      expect(toolbarBox).not.toBeNull();
      expect(courseBox).not.toBeNull();
      expect(courseBox!.width).toBeGreaterThanOrEqual(0.9 * toolbarBox!.width);
      expect(courseBox!.height).toBeGreaterThanOrEqual(44);

      const buttons = toolbar.getByRole("button");
      expect(await buttons.count()).toBeGreaterThanOrEqual(6);
      for (const box of await buttons.evaluateAll((elements) =>
        elements.map((element) => ({
          label: element.getAttribute("aria-label") ?? element.textContent ?? "",
          height: element.getBoundingClientRect().height,
          right: element.getBoundingClientRect().right,
        })),
      )) {
        expect(box.height, `${box.label} height`).toBeGreaterThanOrEqual(44);
        expect(box.right, `${box.label} stays on screen`).toBeLessThanOrEqual(width);
      }

      await expectNoHorizontalScroll(page);
      await toolbar.screenshot({ path: `screenshots/lote-2026-09-25-calendar-${width}.png` });
    });
  }
});

/* ------------------------------------ Guardians and groups ------------------------------------ */

function overviewRow(
  studentId: string,
  fullName: string,
  extra: Partial<{ rowKind: "member" | "guardian"; active: boolean }> = {},
) {
  return {
    studentId,
    rowKind: extra.rowKind ?? "member",
    fullName,
    trainingCenter: "Town",
    centreConfirmed: true,
    active: extra.active ?? true,
    recordActive: extra.active ?? true,
    source: "bpt",
    planState: extra.rowKind === "guardian" ? "none" : "current",
    ownAccount: true,
    flags: [],
  };
}

const memberOverview = {
  rows: [
    overviewRow("lote-member", "Lote Member"),
    overviewRow("lote-guardian", "Lote Guardian", { rowKind: "guardian" }),
    overviewRow("lote-inactive", "Lote Inactive", { active: false }),
  ],
  counters: { total: 2, active: 1, expiring: 0, review: 0, inactive: 1, guardians: 1 },
  generatedAt: "2026-09-25T09:00:00.000Z",
};

// An older group that still lists a guardian: the office must remove them before it saves.
const legacyGroup = {
  groupId: "lote-group",
  name: "Lote Monday squad",
  site: "Town",
  studentIds: ["lote-member", "lote-guardian"],
  revision: 3,
  active: true,
  updatedAt: "2026-09-20T09:00:00.000Z",
  members: [
    { studentId: "lote-member", fullName: "Lote Member", missingPayment: false },
    { studentId: "lote-guardian", fullName: "Lote Guardian", missingPayment: false },
  ],
};

test.describe("a guardian cannot join a group", () => {
  test.skip(!adminBuild, "needs the NEXT_PUBLIC_ADMIN_E2E static build");

  test("the picker never offers a guardian and a save that keeps one is refused", async ({
    page,
  }) => {
    const saves: unknown[] = [];
    await installAdminFixture(page, {
      role: "owner",
      callables: {
        listMemberGroups: { groups: [legacyGroup] },
        getMemberOverview: memberOverview,
      },
    });
    // Registered after the fixture so it answers first: the server's refusal for a guardian.
    await page.route("**/saveMemberGroup", async (route) => {
      saves.push(route.request().postDataJSON());
      await refuseWith(
        route,
        "FAILED_PRECONDITION",
        "Guardians can't be added to a group: Lote Guardian",
      );
    });
    await page.goto("/admin/classes-services/groups?adminTestRole=owner");

    // A new group: only the active member can be added.
    await page.getByRole("button", { name: "Create group" }).click();
    await page.getByLabel("Search members").fill("Lote");
    await expect(page.getByRole("button", { name: "Add Lote Member to group" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Lote Guardian to group" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add Lote Inactive to group" })).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();

    // The legacy group flags the guardian, and saving it as it is gets the server's sentence.
    await page.getByRole("button", { name: "Edit Lote Monday squad" }).click();
    await expect(page.getByText("Guardian. Remove before saving.")).toBeVisible();
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.locator(".groups-notice[role=alert]")).toHaveText(
      "Guardians can't be added to a group: Lote Guardian",
    );
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ data: { studentIds: ["lote-member", "lote-guardian"] } });
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "screenshots/lote-2026-09-25-groups-guardian.png" });
  });
});

/* ------------------------------------- Editing a payment ------------------------------------- */

const memberProfile = {
  view: "full",
  header: {
    studentId: "lote-payer",
    fullName: "Lote Payer",
    age: 30,
    participantType: "adult",
    status: "active",
    maskedMemberReference: "****0025",
    birthdayBadge: null,
  },
  cards: {
    memberSince: "2026-01-15",
    monthsAsMember: 8,
    profession: "Tester",
    accountManagers: [],
    currentMembership: {
      membershipId: "lote-membership",
      planName: "Synthetic Monthly",
      status: "active",
      validUntil: "2026-12-31",
    },
  },
  details: {
    studentId: "lote-payer",
    fullName: "Lote Payer",
    dateOfBirth: "1996-03-10",
    phoneNumber: "+44 7700900025",
    email: "lote-payer@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    gender: "unknown",
    membershipNumber: "25",
    details: {},
  },
};

const memberBilling = [
  {
    membershipId: "lote-membership",
    complimentary: false,
    currentInvoiceId: "lote-invoice",
    reason: null,
    invoices: [
      {
        invoiceId: "lote-invoice",
        status: "paid",
        totalMinor: 6000,
        paidAt: "2026-09-02T10:00:00.000Z",
        dueAt: "2026-09-01T23:00:00.000Z",
        description: "September",
        payments: [
          {
            paymentId: "lote-payment",
            invoiceId: "lote-invoice",
            amountMinor: 6000,
            method: "cash",
            reference: "CASH-LOTE",
            occurredAt: "2026-09-02T10:00:00.000Z",
            lastEdit: null,
            auditHistory: [],
          },
        ],
      },
    ],
  },
];

test.describe("editing a member's payment", () => {
  test.skip(!adminBuild, "needs the NEXT_PUBLIC_ADMIN_E2E static build");

  test("Save changes stays disabled until the reason has 10 characters", async ({ page }) => {
    const calls: { name: string; body: unknown }[] = [];
    await installAdminFixture(page, {
      role: "owner",
      calls,
      callables: {
        getMemberProfile: memberProfile,
        listMemberSubscriptionBilling: memberBilling,
        editManualPayment: {
          paymentId: "lote-payment",
          invoiceId: "lote-invoice",
          invoiceStatus: "paid",
        },
      },
    });
    await page.goto("/admin/members/profile?id=lote-payer&tab=payments&adminTestRole=owner");
    await page.getByRole("button", { name: "Edit payment CASH-LOTE" }).click();

    const dialog = page.getByRole("dialog", { name: "Edit payment" });
    const save = dialog.getByRole("button", { name: "Save changes" });
    await dialog.getByLabel("Amount (GBP)").fill("55.00");
    await expect(save).toBeDisabled();

    const reason = dialog.getByLabel("Reason for the change");
    await reason.fill("Too short");
    await expect(save).toBeDisabled();
    // Spaces do not count towards the minimum.
    await reason.fill("   Too short   ");
    await expect(save).toBeDisabled();
    await expect(dialog.getByText(/At least 10 characters/u)).toBeVisible();

    await reason.fill("Typo at desk");
    await expect(save).toBeEnabled();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "screenshots/lote-2026-09-25-edit-payment.png" });

    await save.click();
    await expect(dialog).toHaveCount(0);
    const edit = calls.find((call) => call.name === "editManualPayment");
    expect(edit?.body).toMatchObject({
      data: { paymentId: "lote-payment", amountMinor: 5500, reason: "Typo at desk" },
    });
  });
});

/* -------------------------------------- Account settings -------------------------------------- */

const projectId = "demo-bpt-jersey";

async function emulatorRequest(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`http://${authEmulatorHost}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer owner", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Auth Emulator ${path} failed: ${JSON.stringify(json)}`);
  return json;
}

/** A synthetic adult member created in the Auth Emulator for this test only. */
async function createAdultMember() {
  const suffix = randomBytes(6).toString("hex");
  const email = `lote-settings-${suffix}@example.test`;
  const password = `Lote-${randomBytes(12).toString("hex")}`;
  const created = await emulatorRequest(
    `/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`,
    { email, password, emailVerified: true },
  );
  const uid = String(created.localId);
  await emulatorRequest(
    `/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`,
    {
      localId: uid,
      customAttributes: JSON.stringify({ academyId: "synthetic-academy", role: "adultStudent" }),
    },
  );
  return { uid, email, password };
}

function clientProjection(uid: string, email: string, phoneNumber: string) {
  const stamp = "2026-09-01T09:00:00.000Z";
  return {
    user: {
      userId: uid,
      academyId: "synthetic-academy",
      accountType: "client",
      displayName: "Lote Settings Member",
      email,
      phoneNumber,
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: stamp,
      createdBy: uid,
      updatedAt: stamp,
      updatedBy: uid,
    },
    student: {
      studentId: "lote-settings-student",
      academyId: "synthetic-academy",
      userId: uid,
      fullName: "Lote Settings Member",
      dateOfBirth: "1990-08-19",
      phoneNumber,
      email,
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: stamp,
      createdBy: uid,
      updatedAt: stamp,
      updatedBy: uid,
    },
  };
}

test.describe("account settings with the Auth Emulator", () => {
  test.skip(!authEmulatorRun, "needs AUTH_EMULATOR_E2E=true inside emulators:exec --only auth");

  test("phone and emergency contact save; a wrong password leaves the email alone", async ({
    page,
  }) => {
    expect(process.env.NEXT_PUBLIC_ADMIN_E2E).not.toBe("true");
    const member = await createAdultMember();
    const calls: { name: string; data: Record<string, unknown> }[] = [];
    let phone = "+44 7700 900111";

    // The account callables (Functions Emulator port) are answered here; Auth stays real.
    await page.route(/^http:\/\/127\.0\.0\.1:5001\//u, async (route) => {
      const request = route.request();
      const name = new URL(request.url()).pathname.split("/").at(-1) ?? "";
      const data = ((request.postDataJSON() as { data?: unknown } | null)?.data ?? {}) as Record<
        string,
        unknown
      >;
      calls.push({ name, data });
      const answers: Record<string, () => unknown> = {
        syncOwnAccountEmail: () => ({}),
        listMyMemberProfiles: () => ({
          profiles: [
            {
              studentId: "lote-settings-student",
              fullName: "Lote Settings Member",
              via: "self",
              trainingDetailsRequired: false,
            },
          ],
        }),
        getMySettings: () => ({
          photoUrl: null,
          pendingPhotoUrl: null,
          showToMembers: true,
          canManage: true,
          teenAccess: null,
        }),
        getClientProfile: () => clientProjection(member.uid, member.email, phone),
        saveClientProfile: () => {
          phone = String(data.phoneNumber);
          return clientProjection(member.uid, member.email, phone);
        },
        getOwnEmergencyContact: () => ({ contact: null }),
        saveOwnEmergencyContact: () => ({ saved: true }),
      };
      const answer = answers[name];
      if (!answer) return refuseWith(route, "NOT_FOUND", "Not part of this test.");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: answer() }),
      });
    });

    await page.goto("/login");
    await page.getByLabel("Email address").fill(member.email);
    await page.getByLabel("Password").fill(member.password);
    await page.locator("#login-form").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/account(?:[/?#]|$)/u);
    await page.goto("/account/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Account settings" })).toBeVisible();

    // Phone.
    const phoneSection = page.getByRole("region", { name: "Phone", exact: true });
    const phoneInput = phoneSection.getByLabel("Phone number");
    await expect(phoneInput).toHaveValue("+44 7700 900111");
    await phoneInput.fill("+44 7700 900222");
    await phoneSection.getByRole("button", { name: "Save phone" }).click();
    await expect(phoneSection.getByRole("status")).toHaveText("Phone number saved.");
    expect(calls.find((call) => call.name === "saveClientProfile")?.data).toMatchObject({
      phoneNumber: "+44 7700 900222",
      fullName: "Lote Settings Member",
      trainingCenter: "Town",
    });

    // Emergency contact.
    const contact = page.getByRole("region", { name: "Emergency contact" });
    await contact.getByLabel("Name").fill("Lote Contact");
    await contact.getByLabel("Relationship").fill("Sister");
    await contact.getByLabel("Phone number", { exact: true }).fill("+44 7700 900333");
    await contact.getByRole("button", { name: "Save emergency contact" }).click();
    await expect(contact.getByRole("status")).toHaveText("Emergency contact saved.");
    expect(calls.find((call) => call.name === "saveOwnEmergencyContact")?.data).toMatchObject({
      studentId: "lote-settings-student",
      contact: { fullName: "Lote Contact", relationship: "Sister", phoneNumber: "+44 7700 900333" },
    });

    // Email with a wrong current password: the Auth Emulator refuses the re-authentication.
    const emailSection = page.getByRole("region", { name: "Email", exact: true });
    await emailSection
      .getByLabel("New email")
      .fill(`lote-new-${randomBytes(4).toString("hex")}@example.test`);
    await emailSection.getByLabel("Current password").fill("not-the-right-password");
    await emailSection.getByRole("button", { name: "Change email" }).click();
    await expect(emailSection.getByRole("alert")).toHaveText("That password is not right.");

    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: "screenshots/lote-2026-09-25-settings.png", fullPage: true });

    const lookup = await emulatorRequest(
      `/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
      { localId: [member.uid] },
    );
    const users = lookup.users as { email?: string }[];
    expect(users[0]?.email).toBe(member.email);
    const oob = await emulatorRequest(`/emulator/v1/projects/${projectId}/oobCodes`);
    expect(
      ((oob.oobCodes ?? []) as { email?: string; requestType?: string }[]).filter(
        (code) => code.email === member.email && code.requestType === "VERIFY_AND_CHANGE_EMAIL",
      ),
    ).toEqual([]);
  });
});
