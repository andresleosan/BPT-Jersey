import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({ pathname: "/admin" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMocks.pathname,
}));

import { AdminOverview } from "./page";
import { AdminGateSessionProvider } from "./admin-gate";
import { AdminShell } from "./admin-shell";

const syntheticSession = {
  uid: "synthetic-admin",
  email: "admin@example.test",
  displayName: "Synthetic Administrator",
  academyId: "synthetic-academy",
  role: "owner" as const,
};

function renderAuthenticatedPreview() {
  return render(
    <AdminGateSessionProvider session={syntheticSession}>
      <AdminShell session={syntheticSession}>
        <AdminOverview />
      </AdminShell>
    </AdminGateSessionProvider>,
  );
}

describe("administrative shell", () => {
  afterEach(() => {
    cleanup();
    navigationMocks.pathname = "/admin";
  });

  it("renders an authenticated shell with accessible landmarks and navigation", () => {
    render(
      <AdminShell session={syntheticSession}>
        <p>Shell content</p>
      </AdminShell>,
    );

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#admin-main-content",
    );
    expect(screen.getByRole("banner")).toBeVisible();
    expect(screen.getByRole("complementary", { name: "Administrative navigation" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Admin navigation" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("id", "admin-main-content");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("img", { name: "BPT Jersey logo" }).getAttribute("src")).toContain(
      "bpt-jersey-logo.png",
    );
    const brand = screen.getByRole("link", { name: "BPT Jersey home" });
    expect(within(brand).getByText("BPT", { exact: true })).toBeVisible();
    expect(within(brand).getByText("Jersey", { exact: true })).toBeVisible();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Class waitlists" })).toHaveAttribute(
      "href",
      "/admin/waitlists",
    );
    expect(screen.getByText("Shell content")).toBeVisible();
  });

  it("opens and closes the logo-led mobile navigation drawer with Escape", async () => {
    const user = userEvent.setup();
    renderAuthenticatedPreview();

    const menuButton = screen.getByRole("button", { name: "Open admin navigation" });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Admin navigation" })).not.toBeInTheDocument();

    await user.click(menuButton);

    const drawer = screen.getByRole("dialog", { name: "Admin navigation" });
    expect(drawer).toBeVisible();
    expect(screen.getByRole("img", { name: "BPT Jersey mobile logo" })).toBeVisible();
    expect(within(drawer).getByRole("button", { name: "Close admin navigation" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Admin navigation" })).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();
  });

  it("traps keyboard focus inside the mobile navigation dialog", async () => {
    const user = userEvent.setup();
    renderAuthenticatedPreview();

    await user.click(screen.getByRole("button", { name: "Open admin navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Admin navigation" });
    const closeButton = within(drawer).getByRole("button", { name: "Close admin navigation" });
    const links = within(drawer).getAllByRole("link");

    links.at(-1)?.focus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(links.at(-1)).toHaveFocus();
  });

  it("supports keyboard focus through the skip link and admin navigation", async () => {
    const user = userEvent.setup();
    renderAuthenticatedPreview();

    const skipLink = screen.getByRole("link", { name: "Skip to main content" });
    const membersLink = within(
      screen.getByRole("navigation", { name: "Admin navigation" }),
    ).getByRole("link", { name: "Members" });

    await user.tab();
    expect(skipLink).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "BPT Jersey home" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveFocus();
    await user.tab();
    expect(membersLink).toHaveFocus();
    expect(membersLink).toHaveAttribute("href", "/admin/members");
  });

  it("exposes the operational English modules and marks the current route as active", () => {
    renderAuthenticatedPreview();

    const navigation = screen.getByRole("navigation", { name: "Admin navigation" });
    const labels = [
      "Overview",
      "Members",
      "Memberships",
      "Families",
      "Waivers",
      "Classes",
      "Activities",
      "Class waitlists",
      "Attendance",
      "Reports",
      "CRM",
      "Retention",
      "Finance",
      "Billing",
      "Shop",
      "Regyfit Access Records",
      "Staff",
      "Levels",
      "Lesson plans",
    ];

    labels.forEach((label) => {
      expect(within(navigation).getByRole("link", { name: label })).toBeVisible();
    });
    expect(within(navigation).queryAllByRole("link")).toHaveLength(19);
    expect(within(navigation).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/admin",
    );
  });

  it("marks Members active without leaving legacy hash links", () => {
    navigationMocks.pathname = "/admin/members/search";
    renderAuthenticatedPreview();

    const navigation = screen.getByRole("navigation", { name: "Admin navigation" });
    expect(within(navigation).getByRole("link", { name: "Members" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(navigation).getByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/admin/members",
    );
    expect(navigation.querySelectorAll('a[href^="#"]').length).toBe(0);
  });

  it("keeps the Members route active for member subroutes", () => {
    navigationMocks.pathname = "/admin/members/search";
    renderAuthenticatedPreview();

    expect(
      within(screen.getByRole("navigation", { name: "Admin navigation" })).getByRole("link", {
        name: "Members",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("renders a connected dashboard state instead of placeholder module cards", () => {
    renderAuthenticatedPreview();

    expect(screen.getByRole("heading", { name: "Today's academy view" })).toBeVisible();
    expect(screen.getByText("Loading connected dashboard...")).toBeVisible();
    expect(screen.queryByRole("article", { name: "8 Classes today" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Today's classes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add new member" })).not.toBeInTheDocument();

    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toMatch(
      /203\.0\.113\.10|synthetic member|source-demo-\d|memberNumber|\bIP\b|password|secret|api[_ -]?key|bearer\s/i,
    );
  });

  it("declares a mobile-safe layout contract without relying on browser measurements", () => {
    renderAuthenticatedPreview();

    const main = screen.getByRole("main");
    const navigationLinks = within(
      screen.getByRole("navigation", { name: "Admin navigation" }),
    ).getAllByRole("link");

    expect(main).toHaveClass("admin-main");
    expect(main).toHaveClass("admin-main-content");
    expect(navigationLinks).toHaveLength(19);
    navigationLinks.forEach((link) => {
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href");
    });
  });

  it("offers an accessible sign-out action in the authenticated header", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockResolvedValue(undefined);

    render(
      <AdminShell session={syntheticSession} onSignOut={signOut}>
        <p>Shell content</p>
      </AdminShell>,
    );

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOut).toHaveBeenCalledOnce();
  });
});
