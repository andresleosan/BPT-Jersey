import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { ListClassHistoryInput } from "@bpt-jersey/domain/audit/class-history";

import {
  readClassHistory,
  type ClassHistoryQuery,
  type ClassHistoryStore,
  type ClassHistoryStoredEvent,
} from "../../apps/functions/src/audit/class-history-service";

import { installAdminFixture, type CallableCall } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * 2026-10-20 capacity preparation, part 1. An imported history row names a legacy member; its name
 * now comes from the canonical student that member was explicitly linked to, and a row whose person
 * no longer resolves reads "Former member", never the copy stored with it. Each listing here is
 * computed by the real readClassHistory over a synthetic store whose directory answer is what the
 * Firestore adapter (unit-tested) gives for one migration decision: no Firebase, loopback only.
 */
const sessionStartAt = "2026-09-16T17:30:00.000Z";

function imported(
  id: string,
  memberId: string | null,
  studentName: string,
): ClassHistoryStoredEvent {
  return {
    id,
    occurredAt: "2026-09-15T09:00:00.000Z",
    action: "booking.created",
    actorId: "regyfit-import",
    actorRole: "regyfit",
    actorGroup: "member",
    actorName: null,
    actorIp: null,
    source: "regyfit",
    class: {
      studentId: null,
      memberId,
      studentName,
      sessionId: null,
      sessionStartAt,
      programId: null,
      locationId: null,
    },
  };
}

const events = [
  // Linked by its migration decision; the stored copy is misspelt and must not win.
  imported("event-linked", "member-7", "Olivia Lewes"),
  // Linked, but the person no longer resolves (erased, or no decision): "Former member".
  imported("event-erased", "member-gone", "Harry Snapshot"),
  // Never matched to the directory: the captured Regyfit name is all there is.
  imported("event-unmatched", null, "Captured Person"),
];

function syntheticStore(queries: ClassHistoryQuery[]): ClassHistoryStore {
  return {
    queryEvents: async (query) => {
      queries.push(query);
      return events;
    },
    readStudents: async () => new Map(),
    readSessions: async () => new Map(),
    readStaffNames: async () => new Map(),
    readMemberNames: async () => new Map(),
    readDirectoryMemberNames: async () => new Map([["member-7", "Olivia Lewis"]]),
  };
}

// A placeholder download: this spec checks the export request, not the PDF's words. Those are
// checked against the real generator in apps/functions/src/audit/class-history-pdf.test.ts.
const minimalPdf = "%PDF-1.4\n%%EOF\n";

async function openHistory(page: Page) {
  const calls: CallableCall[] = [];
  const queries: ClassHistoryQuery[] = [];
  const store = syntheticStore(queries);
  const callables = { listClassHistory: null, exportClassHistoryPdf: null };
  await installAdminFixture(page, { calls, callables });
  await page.route("**/listClassHistory", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { data: ListClassHistoryInput };
    calls.push({ name: "listClassHistory", body });
    const listing = await readClassHistory(store, body.data, {
      uid: "synthetic-admin-owner",
      academyId: body.data.academyId,
      role: "owner",
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: listing }),
    });
  });
  await page.route("**/exportClassHistoryPdf", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    calls.push({ name: "exportClassHistoryPdf", body: route.request().postDataJSON() });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          pdfBase64: Buffer.from(minimalPdf).toString("base64"),
          fileName: "class-history-2026-10-20.pdf",
        },
      }),
    });
  });
  const blocked = await blockExternalRequests(page, Object.keys(callables));
  await page.goto("/admin/classes-services/history?adminTestRole=owner", { timeout: 120_000 });
  await expect(page.getByRole("button", { name: "LIST" })).toBeVisible({ timeout: 60_000 });
  return { calls, queries, blocked };
}

async function evidence(page: Page, testInfo: TestInfo, name: string, blocked: string[]) {
  await page.screenshot({
    path: testInfo.outputPath(`${name}-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await testInfo.attach(`${name}-blocked-requests`, {
    body: JSON.stringify(blocked, null, 2),
    contentType: "application/json",
  });
}

test.describe("Class history names after the member directory change (2026-10-20 part 1)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  test.setTimeout(180_000);

  test("names linked rows canonically, never shows a stored copy, and exports with the same filters", async ({
    page,
  }, testInfo) => {
    const h = await openHistory(page);

    await page.getByLabel("Since", { exact: true }).fill("2026-09-01");
    await page.getByRole("button", { name: "LIST" }).click();
    await expect(page.getByText("RECORDS (3)")).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText("Olivia Lewis booked the class of 16 Sep 2026 at 18:30"),
    ).toBeVisible();
    await expect(
      page.getByText("Former member booked the class of 16 Sep 2026 at 18:30"),
    ).toBeVisible();
    await expect(
      page.getByText("Captured Person booked the class of 16 Sep 2026 at 18:30"),
    ).toBeVisible();
    for (const stored of ["Olivia Lewes", "Harry Snapshot"]) {
      await expect(page.getByText(stored)).toHaveCount(0);
    }
    // The real service read the filters the screen sent.
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]).toMatchObject({ actorId: null, cursor: null, limit: 100 });
    await evidence(page, testInfo, "class-history-names", h.blocked);

    // The export asks for exactly the listing's filters. Its download here is the placeholder above;
    // the names a real PDF prints are asserted in class-history-pdf.test.ts.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF" }).click();
    expect((await download).suggestedFilename()).toBe("class-history-2026-10-20.pdf");
    const bodies = h.calls.map((call) => (call.body as { data: unknown }).data);
    const names = h.calls.map((call) => call.name);
    expect(names).toEqual(["listClassHistory", "exportClassHistoryPdf"]);
    expect(bodies[1]).toEqual(bodies[0]);
    await expect(page.getByText("The PDF could not be prepared. Please try again.")).toHaveCount(0);
    await evidence(page, testInfo, "class-history-pdf", h.blocked);
  });
});
