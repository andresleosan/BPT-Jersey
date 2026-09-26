import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminShell } from "./admin-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/coach/access" }));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
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
  it("hides and shows the desktop sidebar from the logo and remembers the choice", () => {
    const { unmount } = render(
      <AdminShell session={coach}>
        <p>Content</p>
      </AdminShell>,
    );
    expect(screen.queryByRole("link", { name: "BPT Jersey home" })).not.toBeInTheDocument();
    const logo = screen.getByRole("button", { name: "Hide coach navigation" });
    expect(logo).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(logo.getAttribute("aria-controls")!)!;
    expect(panel).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("admin-shell")).toHaveAttribute("data-sidebar", "open");

    fireEvent.click(logo);
    expect(logo).toHaveAttribute("aria-expanded", "false");
    expect(logo).toHaveAccessibleName("Show coach navigation");
    expect(panel).toHaveAttribute("hidden");
    expect(screen.getByTestId("admin-shell")).toHaveAttribute("data-sidebar", "collapsed");
    expect(window.localStorage.getItem("bpt-admin-sidebar")).toBe("collapsed");

    unmount();
    render(
      <AdminShell session={coach}>
        <p>Content</p>
      </AdminShell>,
    );
    const restored = screen.getByRole("button", { name: "Show coach navigation" });
    expect(screen.getByTestId("admin-shell")).toHaveAttribute("data-sidebar", "collapsed");
    fireEvent.click(restored);
    expect(restored).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem("bpt-admin-sidebar")).toBe("open");
  });
  it("keeps the sidebar open when storage is blocked", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      render(
        <AdminShell session={coach}>
          <p>Content</p>
        </AdminShell>,
      );
      const logo = screen.getByRole("button", { name: "Hide coach navigation" });
      fireEvent.click(logo);
      expect(logo).toHaveAttribute("aria-expanded", "false");
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
  it("uses the header logo as the mobile drawer toggle", () => {
    render(
      <AdminShell session={coach}>
        <p>Content</p>
      </AdminShell>,
    );
    const trigger = screen.getByRole("button", { name: "Open coach navigation" });
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveAttribute("aria-controls", "admin-mobile-navigation");
    expect(trigger.querySelector("img")).toHaveAttribute("alt", "");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAccessibleName("Close coach navigation");
    expect(document.getElementById("admin-mobile-navigation")).toHaveAttribute("role", "dialog");
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it("sends the syllabus to /admin/levels and keeps office modules out of the coach menu (T13)", () => {
    for (const role of ["coach", "headCoach"] as const) {
      render(
        <AdminShell session={{ ...coach, role }}>
          <p>Content</p>
        </AdminShell>,
      );
      const navigation = screen.getByRole("navigation", { name: "Coach navigation" });
      expect(screen.getByRole("link", { name: "Progression syllabus" })).toHaveAttribute(
        "href",
        "/admin/levels",
      );
      const hrefs = Array.from(navigation.querySelectorAll("a")).map((link) =>
        link.getAttribute("href"),
      );
      expect(hrefs.filter((href) => href === "/admin/levels")).toHaveLength(1);
      expect(hrefs).not.toContain("/coach/levels");
      for (const name of [
        "Waitlists",
        "Billing",
        "Financial dashboard",
        "Shop",
        "Staff",
        "Memberships",
      ]) {
        expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
      }
      cleanup();
    }
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
