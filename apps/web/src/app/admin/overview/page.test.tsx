import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OverviewPage } from "./page";

describe("admin overview", () => {
  it("renders operational dashboard metrics and today's class queue", () => {
    render(<OverviewPage />);

    expect(screen.getByRole("heading", { name: "Today's academy view" })).toBeVisible();
    expect(screen.getByRole("article", { name: "8 Classes today" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Today's classes" })).toBeVisible();
  });
});
