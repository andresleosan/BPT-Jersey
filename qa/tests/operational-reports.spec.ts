import { expect, test, type Page } from "@playwright/test";

const reportResponse = (query: Readonly<{ from: string; to: string }>) => ({
  query,
  students: {
    totalStudents: 4,
    activeStudents: 3,
    inactiveStudents: 1,
    suspendedStudents: 0,
    activeAdults: 2,
    activeMinors: 1,
    activeTown: 2,
    activeWest: 1,
  },
  attendance: {
    totalRecords: 5,
    checkedIn: 3,
    attended: 2,
    late: 1,
    absent: 1,
    noShow: 1,
    excused: 0,
    attendanceRatePercentage: 60,
  },
  memberships: {
    currentMemberships: 4,
    trial: 1,
    active: 2,
    paused: 0,
    overdue: 1,
    cancelled: 0,
  },
  revenue: {
    currency: "GBP",
    issuedMinor: 10_000,
    receivedMinor: 5_000,
    outstandingMinor: 5_000,
    invoiceCount: 2,
    openInvoiceCount: 1,
    partiallyPaidInvoiceCount: 1,
    paidInvoiceCount: 0,
    voidedInvoiceCount: 0,
    paymentCount: 2,
    paymentsByMethod: { cash: 1, bankTransfer: 1, other: 0 },
  },
  calculatedAt: "2026-08-24T20:00:00.000Z",
});

async function installOperationalReportFixture(
  page: Page,
  requests: Array<Readonly<{ from: string; to: string }>>,
  exportRequests: Array<Readonly<{ from: string; to: string; purpose: string }>>,
): Promise<void> {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.endsWith("/getProgressReport")) {
      await route.fulfill({
        body: JSON.stringify({
          data: {
            report: {
              activeStudentCount: 0,
              assessedStudentCount: 0,
              unassessedStudentCount: 0,
              totalEvaluationCount: 0,
              assessmentCoveragePercentage: 0,
              recognitionCandidateCount: 0,
              eligibleForPromotionCount: 0,
              levelBreakdown: [],
              skillCoverage: [],
              calculatedAt: "2026-08-24T20:00:00.000Z",
            },
          },
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    if (requestUrl.pathname.endsWith("/getOperationalReport")) {
      const body = route.request().postDataJSON() as {
        data: Readonly<{ from: string; to: string }>;
      };
      requests.push(body.data);
      await route.fulfill({
        body: JSON.stringify({ data: { report: reportResponse(body.data) } }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    if (requestUrl.pathname.endsWith("/prepareAggregateReportExport")) {
      const body = route.request().postDataJSON() as {
        data: Readonly<{ from: string; to: string; purpose: string }>;
      };
      exportRequests.push(body.data);
      const content =
        "section,metric,segment,value,unit\r\n" +
        "students,activeStudents,all,3,count\r\n" +
        "progress,assessmentCoveragePercentage,current,0,percentage\r\n";
      await route.fulfill({
        body: JSON.stringify({
          data: {
            export: {
              exportId: "report-export-e2e",
              fileName:
                "bpt-aggregate-report-" +
                body.data.from.slice(0, 10) +
                "-to-" +
                body.data.to.slice(0, 10) +
                ".csv",
              contentType: "text/csv;charset=utf-8",
              content,
              byteLength: Buffer.byteLength(content, "utf8"),
              contentSha256: "a".repeat(64),
              expiresAt: "2026-08-24T20:10:00.000Z",
              purpose: body.data.purpose,
              scope: "operational_and_progress_aggregates",
              classification: "Confidential",
              query: { from: body.data.from, to: body.data.to },
            },
          },
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    await route.continue();
  });
}

test.describe("operational reports", () => {
  test("loads and filters aggregate-only pilot reports without horizontal overflow", async ({
    page,
  }) => {
    const browserErrors: string[] = [];
    const requests: Array<Readonly<{ from: string; to: string }>> = [];
    const exportRequests: Array<Readonly<{ from: string; to: string; purpose: string }>> = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await installOperationalReportFixture(page, requests, exportRequests);

    await page.goto("/admin/reports?adminTestRole=owner");

    await expect(page.getByRole("heading", { name: "Reports", level: 2 })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Students, attendance and finance" }),
    ).toBeVisible();
    await expect(page.getByText("Manual revenue").locator("..")).toContainText("£50.00");
    await expect(page.getByRole("heading", { name: "Attendance period" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Membership status" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("private-student-id");

    const operationalCard = page.getByRole("article", { name: "Operational reports" });
    await operationalCard.getByLabel("From").fill("2026-08-10");
    await operationalCard.getByLabel("To").fill("2026-08-20");
    await operationalCard.getByRole("button", { name: "Refresh operational report" }).click();

    await expect
      .poll(() => requests.at(-1))
      .toEqual({
        from: "2026-08-10T00:00:00.000Z",
        to: "2026-08-20T23:59:59.999Z",
      });
    const exportCard = page.getByRole("article", { name: "Authorized aggregate export" });
    await exportCard.getByLabel("Purpose").selectOption("pilot_progress_review");
    await exportCard.getByLabel("From").fill("2026-08-10");
    await exportCard.getByLabel("To").fill("2026-08-20");
    const downloadPromise = page.waitForEvent("download");
    await exportCard.getByRole("button", { name: "Prepare and download CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("bpt-aggregate-report-2026-08-10-to-2026-08-20.csv");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const downloadedCsv = Buffer.concat(chunks).toString("utf8");
    expect(downloadedCsv).toContain("students,activeStudents,all,3,count");
    expect(downloadedCsv).not.toMatch(/private-|studentId|email/iu);
    await expect
      .poll(() => exportRequests.at(-1))
      .toEqual({
        from: "2026-08-10T00:00:00.000Z",
        to: "2026-08-20T23:59:59.999Z",
        purpose: "pilot_progress_review",
      });
    await expect(exportCard.getByText(/CSV downloaded/iu)).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
    expect(browserErrors).toEqual([]);
  });
});
