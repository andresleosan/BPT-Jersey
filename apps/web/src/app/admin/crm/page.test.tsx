import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CrmPage } from "./page";

describe("CRM page", () => {
  it("renders lead stages, ownership, and filters", () => {
    render(<CrmPage />);
    expect(screen.getByRole("heading", { name: "CRM" })).toBeVisible();
    expect(screen.getByLabelText("CRM stage")).toBeVisible();
    expect(screen.getByText("Morgan family")).toBeVisible();
  });
});
