import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GroupsPage } from "./page";

describe("groups page", () => {
  it("renders groups with program, coach, capacity, and filters", () => {
    render(<GroupsPage />);
    expect(screen.getByRole("heading", { name: "Groups / Teams" })).toBeVisible();
    expect(screen.getByLabelText("Program")).toBeVisible();
    expect(screen.getByLabelText("Coach")).toBeVisible();
    expect(screen.getByRole("table", { name: "Groups and teams" })).toBeVisible();
  });
});
