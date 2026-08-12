import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MembersPage } from "./page";

describe("members landing page", () => {
  it("shows member rows with the replicated fields and direct actions", () => {
    render(<MembersPage />);

    expect(screen.getByRole("heading", { name: "Members" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Member directory" })).toBeVisible();
    expect(screen.getByText("Membership number")).toBeVisible();
    expect(screen.getByText("Jordan Blake")).toBeVisible();
    expect(screen.getByRole("link", { name: "Add new member" })).toHaveAttribute(
      "href",
      "/admin/members/add",
    );
    expect(screen.getByRole("link", { name: "Search members" })).toHaveAttribute(
      "href",
      "/admin/members/search",
    );
  });
});
