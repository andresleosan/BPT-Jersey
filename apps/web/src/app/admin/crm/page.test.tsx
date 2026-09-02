import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/crm-client", () => ({
  listCrmLeads: vi.fn().mockResolvedValue([]),
}));
import { CrmPage } from "./page";

describe("CRM page", () => {
  it("does not render synthetic leads when the connected source is empty", async () => {
    render(<CrmPage />);
    expect(screen.getByRole("heading", { name: "CRM" })).toBeVisible();
    expect(screen.getByLabelText("CRM stage")).toBeVisible();
    expect(await screen.findByText("No leads available.")).toBeVisible();
    expect(screen.queryByText("Morgan family")).not.toBeInTheDocument();
  });
});
