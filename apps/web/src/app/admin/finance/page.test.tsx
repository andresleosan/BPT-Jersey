import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FinancePage } from "./page";

describe("finance page", () => {
  it("shows finance summary and payment status filters without card data", () => {
    render(<FinancePage />);
    expect(screen.getByRole("heading", { name: "Finance" })).toBeVisible();
    expect(screen.getByLabelText("Payment status")).toBeVisible();
    expect(screen.getByText("Outstanding balance")).toBeVisible();
    expect(screen.queryByText(/card number|cvv|cvc/i)).toBeNull();
  });
});
