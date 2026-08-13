import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AdminIconButton } from "./admin-ui";
import { AdminDataTable } from "./admin-data-table";
import { previewData } from "./preview-data";

describe("admin operational UI primitives", () => {
  it("renders icon actions with accessible labels and tooltips", () => {
    render(<AdminIconButton label="Add new member" icon="member-add" onClick={() => undefined} />);

    expect(screen.getByRole("button", { name: "Add new member" })).toHaveAttribute(
      "title",
      "Add new member",
    );
  });

  it("marks preview data as synthetic and contains no production identifiers", () => {
    expect(previewData.environment).toBe("synthetic-preview");
    expect(JSON.stringify(previewData)).not.toMatch(
      /real member|production|serviceAccount|bearer/i,
    );
  });

  it("sorts every column by clicking its header and exposes the direction", async () => {
    const user = userEvent.setup();
    const columns = [
      { key: "name", label: "Name", render: (row: { name: string }) => row.name },
      { key: "count", label: "Count", render: (row: { count: number }) => row.count },
    ] as const;
    const rows = [
      { name: "Beta", count: 10 },
      { name: "Alpha", count: 2 },
      { name: "", count: 30 },
    ];

    render(
      <AdminDataTable
        caption="Sortable test table"
        columns={columns}
        rowKey={(row) => row.name || "empty"}
        rows={rows}
      />,
    );

    const table = screen.getByRole("table", { name: "Sortable test table" });
    const nameHeader = within(table).getByRole("button", { name: "Sort by Name ascending" });
    await user.click(nameHeader);
    expect(nameHeader).toHaveAccessibleName("Sort by Name descending");
    expect(nameHeader.closest("th")).toHaveAttribute("aria-sort", "ascending");
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(["Alpha2", "Beta10", "30"]);

    await user.click(nameHeader);
    expect(nameHeader).toHaveAccessibleName("Sort by Name ascending");
    expect(nameHeader.closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(["30", "Beta10", "Alpha2"]);
  });

  it("sorts numbers and keeps rendered empty placeholders at the end", async () => {
    const user = userEvent.setup();
    const columns = [
      { key: "date", label: "Date", render: (row: { date: string }) => row.date },
      { key: "amount", label: "Amount", render: (row: { amount: string }) => row.amount },
    ] as const;
    const rows = [
      { date: "2026-08-12", amount: "£10" },
      { date: "2025-01-02", amount: "—" },
      { date: "2026-01-03", amount: "£2" },
    ];

    render(
      <AdminDataTable
        caption="Typed sortable table"
        columns={columns}
        rowKey={(row) => row.date}
        rows={rows}
      />,
    );

    const table = screen.getByRole("table", { name: "Typed sortable table" });
    await user.click(within(table).getByRole("button", { name: "Sort by Amount ascending" }));
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(["2026-01-03£2", "2026-08-12£10", "2025-01-02—"]);
    expect(within(table).getByRole("button", { name: "Sort by Date ascending" })).toBeVisible();
  });
});
