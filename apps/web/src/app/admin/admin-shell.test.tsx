import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminShell } from "./admin-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/coach/access" }));
afterEach(cleanup);
const coach = {
  uid: "example-coach",
  displayName: "Example Coach",
  email: "",
  academyId: "bpt-jersey",
  role: "coach" as const,
};

describe("shared staff workspace", () => {
  it("shows coach tools and permitted modules without financial navigation", () => {
    render(
      <AdminShell session={coach}>
        <p>Content</p>
      </AdminShell>,
    );
    expect(screen.getByText("Example Coach")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My sign-in" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Attendance" })).toBeInTheDocument();
    for (const name of [
      "Billing",
      "Memberships",
      "Staff",
      "Reports",
      "Members",
      "Member migration",
    ]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
  });
  it("opens the shared mobile drawer and closes it with Escape", () => {
    render(
      <AdminShell session={coach}>
        <p>Content</p>
      </AdminShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open coach navigation" }));
    expect(screen.getByRole("dialog", { name: "Coach navigation" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("preserves the owner navigation", () => {
    render(
      <AdminShell session={{ ...coach, role: "owner" }}>
        <p>Content</p>
      </AdminShell>,
    );
    expect(screen.getByRole("link", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Member migration" })).toHaveAttribute(
      "href",
      "/admin/members/migration",
    );
    expect(screen.queryByRole("link", { name: "My sign-in" })).not.toBeInTheDocument();
  });
});
