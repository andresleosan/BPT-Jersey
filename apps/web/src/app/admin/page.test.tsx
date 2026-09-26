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

const pilotNavigation = [
  "Overview",
  "Attendance",
  "Members",
  "Member search",
  "Member migration",
  "Memberships",
  "Enrolment requests",
  "Medical conditions",
  "Classes / Services",
  "Levels",
  "Billing",
  "Shop",
  "Staff",
  "Reports",
] as const;

const offNavigationRoutes = [
  "/admin/waitlists",
  "/admin/crm",
  "/admin/retention",
  "/admin/finance",
  "/admin/families",
  "/admin/activities",
  "/admin/groups",
  "/admin/regyfit-access-records",
] as const;

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
    expect(screen.getByRole("complementary", { name: "Admin navigation" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Admin navigation" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("id", "admin-main-content");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
    // The sidebar logo hides and shows the sidebar; the header's Home link leaves the workspace.
    const logo = screen.getByRole("button", { name: "Hide admin navigation" });
    expect(logo.querySelector("img")?.getAttribute("src")).toContain("bpt-jersey-logo.png");
    expect(screen.queryByRole("link", { name: "BPT Jersey home" })).not.toBeInTheDocument();
    expect(screen.getByText("BPT", { exact: true })).toBeVisible();
    expect(screen.getByText("Jersey", { exact: true })).toBeVisible();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Attendance" })).toHaveAttribute(
      "href",
      "/admin/attendance",
    );
    expect(screen.getByText("Shell content")).toBeVisible();
  });

  it("names who is signed in, with the role and the email, in the header", () => {
    renderAuthenticatedPreview();

    // The role also appears in the sidebar footer, so the question is scoped to the identity block.
    const header = within(screen.getByTestId("admin-identity"));
    expect(header.getByText("Synthetic Administrator")).toBeVisible();
    expect(header.getByText("Owner access - admin@example.test")).toBeVisible();
  });

  it("falls back to the email when the account has no display name", () => {
    // Not hypothetical: production has a password-provider administrative account with no
    // `displayName`, and `admin-auth` hands it over as an empty string.
    render(
      <AdminGateSessionProvider session={{ ...syntheticSession, displayName: "" }}>
        <AdminShell session={{ ...syntheticSession, displayName: "" }}>
          <p>Shell content</p>
        </AdminShell>
      </AdminGateSessionProvider>,
    );

    const header = within(screen.getByTestId("admin-identity"));
    expect(header.getByText("admin@example.test")).toBeVisible();
    // The email takes the name line, so it is not repeated underneath next to the role.
    expect(header.getByText("Owner access")).toBeVisible();
    expect(header.queryByText("Owner access - admin@example.test")).not.toBeInTheDocument();
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
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
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
    const navigation = screen.getByRole("navigation", { name: "Admin navigation" });
    const attendanceLink = within(navigation).getByRole("link", { name: "Attendance" });

    await user.tab();
    expect(skipLink).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Hide admin navigation" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveFocus();
    await user.tab();
    expect(attendanceLink).toHaveFocus();
    expect(attendanceLink).toHaveAttribute("href", "/admin/attendance");
    expect(within(navigation).getByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/admin/members",
    );
  });

  it("lists only the pilot modules, grouped by job, and marks the current route as active", () => {
    renderAuthenticatedPreview();

    const navigation = screen.getByRole("navigation", { name: "Admin navigation" });
    pilotNavigation.forEach((label) => {
      expect(within(navigation).getByRole("link", { name: label })).toBeVisible();
    });
    expect(within(navigation).queryAllByRole("link")).toHaveLength(pilotNavigation.length);
    expect(within(navigation).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/admin",
    );
    ["Today", "People", "Mat", "Money", "Setup"].forEach((group) => {
      expect(within(navigation).getByRole("list", { name: group })).toBeVisible();
    });
  });

  it("keeps post-pilot and retired routes out of the navigation", () => {
    renderAuthenticatedPreview();

    const navigation = screen.getByRole("navigation", { name: "Admin navigation" });
    offNavigationRoutes.forEach((href) => {
      expect(navigation.querySelector(`a[href="${href}"]`)).toBeNull();
    });
    expect(
      within(navigation).queryByRole("link", { name: /waitlist|crm|retention|lesson/i }),
    ).toBeNull();
  });

  it("shows a coach the seven mat modules plus a way back to the coach portal", () => {
    const coachSession = {
      ...syntheticSession,
      role: "coach" as const,
      uid: "synthetic-coach",
    };

    render(
      <AdminShell session={coachSession}>
        <p>Coach content</p>
      </AdminShell>,
    );

    const navigation = screen.getByRole("navigation", { name: "Coach navigation" });
    expect(
      within(navigation)
        .queryAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "->Dashboard",
      "->Progression syllabus",
      "->My sign-in",
      "->Overview",
      "->Attendance",
      "->Member search",
      "->Enrolment requests",
      "->Medical conditions",
      "->Classes / Services",
      "->Levels",
    ]);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/coach");
    expect(screen.getByText("Coach operational access")).toBeVisible();
  });

  it("head coach sees the same seven modules as coach", () => {
    const headCoachSession = {
      ...syntheticSession,
      role: "headCoach" as const,
      uid: "synthetic-head-coach",
    };

    render(
      <AdminShell session={headCoachSession}>
        <p>Head coach content</p>
      </AdminShell>,
    );

    const navigation = screen.getByRole("navigation", { name: "Coach navigation" });
    expect(
      within(navigation)
        .queryAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "->Dashboard",
      "->Progression syllabus",
      "->My sign-in",
      "->Overview",
      "->Attendance",
      "->Member search",
      "->Enrolment requests",
      "->Medical conditions",
      "->Classes / Services",
      "->Levels",
    ]);
  });

  it("lists memberships but not waivers, whose route still exists", () => {
    render(
      <AdminShell session={syntheticSession}>
        <p>Content</p>
      </AdminShell>,
    );
    const navigation = screen.getByRole("navigation", { name: "Admin navigation" });
    expect(within(navigation).getByRole("link", { name: "Memberships" })).toHaveAttribute(
      "href",
      "/admin/memberships",
    );
    expect(within(navigation).queryByRole("link", { name: "Waivers" })).toBeNull();
    expect(within(navigation).getByRole("link", { name: "Medical conditions" })).toHaveAttribute(
      "href",
      "/admin/members/medical",
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
      /203\.0\.113\.10|synthetic member|source-demo-\d|memberNumber|\bIP\b|password|secret|api[_ -]?key|bearer\s|synthetic preview/i,
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
    expect(navigationLinks).toHaveLength(pilotNavigation.length);
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
