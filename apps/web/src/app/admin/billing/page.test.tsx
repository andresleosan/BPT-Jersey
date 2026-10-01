import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

import BillingRoute from "./page";

describe("billing route", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("forwards old links to the financial dashboard, keeping the query", () => {
    window.history.replaceState(null, "", "/admin/billing?familyId=f1");
    render(<BillingRoute />);
    expect(navigation.replace).toHaveBeenCalledWith("/admin/finance?familyId=f1");
    expect(screen.getByRole("link", { name: "Go to the Financial dashboard" })).toHaveAttribute(
      "href",
      "/admin/finance",
    );
  });
});
