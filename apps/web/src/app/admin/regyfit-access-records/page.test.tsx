import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import type { RegyfitAccessRecord, UtcDateTime } from "@bpt-jersey/domain";

const clientMocks = vi.hoisted(() => ({ loadRegyfitAccessRecords: vi.fn() }));

vi.mock("../../../lib/regyfit-access-client", () => clientMocks);

import RegyfitAccessRecordsRoute, {
  AdminAccessRecordsContent,
  RegyfitAccessRecordsPage,
  type RegyfitAccessRecordsPageProps,
} from "./page";
import { AdminGateSessionProvider } from "../admin-gate";

const fixedDate = "2026-08-08T12:00:00.000Z" as UtcDateTime;

function syntheticRecord(loginCount: number): RegyfitAccessRecord {
  return {
    academyId: "source-demo-1",
    sourceSystem: "regyfit",
    sourceId: "source-demo-1",
    memberDisplayName: "Synthetic Member",
    memberNumber: "42",
    loginCount,
    lastLoginAt: fixedDate,
    ip: "203.0.113.10",
    importRunId: "source-demo-1",
    capturedAt: fixedDate,
    schemaVersion: "1",
  };
}

const activeRecord = syntheticRecord(42);
const inactiveRecord = syntheticRecord(0);
const administratorRecord = { ...activeRecord } as Omit<RegyfitAccessRecord, "ip">;

const ownerProps = {
  records: [activeRecord],
  role: "owner",
} satisfies RegyfitAccessRecordsPageProps;
const administratorProps = {
  records: [administratorRecord],
  role: "administrator",
} satisfies RegyfitAccessRecordsPageProps;
const invalidAdministratorProps = {
  records: [
    {
      ...administratorRecord,
      // @ts-expect-error Administrator projections must not contain a restricted IP.
      ip: activeRecord.ip,
    },
  ],
  role: "administrator",
} satisfies RegyfitAccessRecordsPageProps;

void ownerProps;
void administratorProps;
void invalidAdministratorProps;

describe("Regyfit access records panel", () => {
  afterEach(() => {
    cleanup();
    clientMocks.loadRegyfitAccessRecords.mockReset();
  });

  it("loads the authorized projection through the real callable boundary", async () => {
    clientMocks.loadRegyfitAccessRecords.mockResolvedValue([activeRecord]);

    render(
      <AdminGateSessionProvider
        session={{
          uid: "synthetic-admin-owner",
          email: "owner@example.test",
          displayName: "Synthetic owner",
          academyId: "synthetic-academy",
          role: "owner",
        }}
      >
        <AdminAccessRecordsContent />
      </AdminGateSessionProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading Regyfit access records");
    await waitFor(() => expect(screen.getByTestId("regyfit-access-records-panel")).toBeVisible());
    expect(clientMocks.loadRegyfitAccessRecords).toHaveBeenCalledOnce();
  });

  it("shows a safe error when the real callable fails", async () => {
    clientMocks.loadRegyfitAccessRecords.mockRejectedValue(new Error("private backend detail"));

    render(
      <AdminGateSessionProvider
        session={{
          uid: "synthetic-admin-administrator",
          email: "administrator@example.test",
          displayName: "Synthetic administrator",
          academyId: "synthetic-academy",
          role: "administrator",
        }}
      >
        <AdminAccessRecordsContent />
      </AdminGateSessionProvider>,
    );

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to load"));
    expect(screen.queryByText("private backend detail")).not.toBeInTheDocument();
  });

  it("renders a semantic table with responsive record rows and observed login counts", () => {
    render(<RegyfitAccessRecordsPage records={[activeRecord, inactiveRecord]} role="owner" />);

    expect(screen.getByRole("table", { name: "Regyfit access records" })).toBeVisible();
    const rows = screen.getAllByTestId("regyfit-access-record-row");
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      expect(row).toHaveAttribute("data-responsive-card", "true");
    });
    rows.forEach((row, index) => {
      expect(row.querySelector('[data-label="Observed login count"]')).toHaveTextContent(
        index === 0 ? "42" : "0",
      );
    });
  });

  it("searches case-insensitively across member name, member number and source ID", async () => {
    const user = userEvent.setup();
    render(<RegyfitAccessRecordsPage records={[activeRecord]} role="owner" />);
    const search = screen.getByRole("searchbox", { name: "Search access records" });

    await user.type(search, "SYNTHETIC MEMBER");
    expect(screen.getAllByTestId("regyfit-access-record-row")).toHaveLength(1);

    await user.clear(search);
    await user.type(search, "42");
    expect(screen.getAllByTestId("regyfit-access-record-row")).toHaveLength(1);

    await user.clear(search);
    await user.type(search, "SOURCE-DEMO-1");
    expect(screen.getAllByTestId("regyfit-access-record-row")).toHaveLength(1);
  });

  it("renders a missing member number as not observed", () => {
    const record = { ...activeRecord, memberNumber: null } as unknown as RegyfitAccessRecord;

    render(<RegyfitAccessRecordsPage records={[record]} role="owner" />);

    expect(screen.getAllByText("Not observed")).toHaveLength(1);
  });

  it("filters only by observed login count", async () => {
    const user = userEvent.setup();
    render(<RegyfitAccessRecordsPage records={[activeRecord, inactiveRecord]} role="owner" />);

    await user.click(screen.getByRole("button", { name: "Active" }));
    const activeRows = screen.getAllByTestId("regyfit-access-record-row");
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]?.querySelector('[data-label="Observed login count"]')).toHaveTextContent(
      "42",
    );

    await user.click(screen.getByRole("button", { name: "Inactive" }));
    const inactiveRows = screen.getAllByTestId("regyfit-access-record-row");
    expect(inactiveRows).toHaveLength(1);
    expect(inactiveRows[0]?.querySelector('[data-label="Observed login count"]')).toHaveTextContent(
      "0",
    );

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getAllByTestId("regyfit-access-record-row")).toHaveLength(2);
  });

  it("announces when search and filters produce no results", async () => {
    const user = userEvent.setup();
    render(<RegyfitAccessRecordsPage records={[activeRecord]} role="owner" />);

    await user.type(screen.getByRole("searchbox", { name: "Search access records" }), "no-match");

    expect(screen.getByRole("status")).toHaveTextContent("No access records match your search.");
  });

  it("announces a filter-specific empty state and distinguishes combined filters", async () => {
    const user = userEvent.setup();
    render(<RegyfitAccessRecordsPage records={[activeRecord]} role="owner" />);

    await user.click(screen.getByRole("button", { name: "Inactive" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "No access records match the selected filter.",
    );

    await user.type(screen.getByRole("searchbox", { name: "Search access records" }), "no-match");
    expect(screen.getByRole("status")).toHaveTextContent(
      "No access records match your search and the selected filter.",
    );
  });

  it("shows the complete selected owner projection and marks the IP as restricted", async () => {
    const user = userEvent.setup();
    render(<RegyfitAccessRecordsPage records={[activeRecord]} role="owner" />);

    const selectButton = screen.getByRole("button", { name: "View details for Synthetic Member" });
    expect(selectButton).toHaveAttribute("aria-controls", "regyfit-record-details");
    expect(selectButton).toHaveAttribute("aria-expanded", "false");

    await user.click(selectButton);

    const details = screen.getByRole("region", { name: "Record details" });
    expect(selectButton).toHaveAttribute("aria-expanded", "true");
    expect(details).toHaveAttribute("id", "regyfit-record-details");
    expect(details).toHaveFocus();
    expect(within(details).getByText("Synthetic Member")).toBeVisible();
    expect(within(details).getByText("Academy ID")).toBeVisible();
    expect(within(details).getByText("Source system")).toBeVisible();
    expect(within(details).getByText("Import run ID")).toBeVisible();
    expect(within(details).getByText("Captured at")).toBeVisible();
    expect(within(details).getByText("Schema version")).toBeVisible();
    expect(within(details).getAllByText("source-demo-1")).toHaveLength(3);
    expect(within(details).getAllByText(fixedDate)).toHaveLength(2);
    expect(within(details).getByText("1")).toBeVisible();
    expect(within(details).getByText("203.0.113.10")).toBeVisible();
    expect(within(details).getByText("Restricted IP")).toBeVisible();
  });

  it("never renders IP for an administrator, including when the input is malformed", async () => {
    const user = userEvent.setup();
    const malformedAdministratorRecord = { ...activeRecord, ip: "203.0.113.10" } as unknown as Omit<
      RegyfitAccessRecord,
      "ip"
    >;
    render(
      <RegyfitAccessRecordsPage records={[malformedAdministratorRecord]} role="administrator" />,
    );

    await user.click(screen.getByRole("button", { name: "View details for Synthetic Member" }));

    const details = screen.getByRole("region", { name: "Record details" });
    expect(within(details).queryByText("203.0.113.10")).not.toBeInTheDocument();
    expect(within(details).queryByText("IP")).not.toBeInTheDocument();
    expect(within(details).getByText("Observed login count")).toBeVisible();
  });

  it("keeps the direct data-free route on the administrator preview role", () => {
    render(<RegyfitAccessRecordsRoute />);

    expect(screen.getByTestId("regyfit-access-records-panel")).toHaveAttribute(
      "data-role",
      "administrator",
    );
    expect(screen.getByRole("status")).toHaveTextContent("No access records are available.");
  });
});
