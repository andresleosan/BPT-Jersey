import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

import FinanceRoute from "./page";

describe("finance route", () => {
  afterEach(() => cleanup());

  it("forwards old links to the billing page", () => {
    render(<FinanceRoute />);
    expect(navigation.replace).toHaveBeenCalledWith("/admin/billing");
    expect(screen.getByRole("link", { name: "Go to Billing" })).toHaveAttribute(
      "href",
      "/admin/billing",
    );
  });
});
