import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    expect(screen.getByText("Shell content")).toBeVisible();
  });

  it("supports keyboard focus through the skip link and admin navigation", async () => {
    const user = userEvent.setup();
    renderAuthenticatedPreview();

    const skipLink = screen.getByRole("link", { name: "Skip to main content" });
    const overviewLink = within(
      screen.getByRole("navigation", { name: "Admin navigation" }),
    ).getByRole("link", { name: "Overview" });

    await user.tab();
    expect(skipLink).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "BPT Jersey home" })).toHaveFocus();
    await user.tab();
    expect(overviewLink).toHaveFocus();
    expect(overviewLink).toHaveAttribute("href", "#overview");
  });

  it("exposes the English module labels and marks Overview as active", () => {
    renderAuthenticatedPreview();

    const navigation = screen.getByRole("navigation", { name: "Admin navigation" });
    const labels = [
      "Overview",
      "Members",
      "Attendance",
      "Reports",
      "CRM",
      "Finance",
      "Regyfit Access Records",
    ];

    labels.forEach((label) => {
      expect(within(navigation).getByRole("link", { name: label })).toBeVisible();
    });
    expect(within(navigation).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps uncaptured modules data-free with explicit import states", () => {
    renderAuthenticatedPreview();

    const emptyStates = screen.getAllByTestId("admin-empty-state");
    const expectedModules = [
      "Members",
      "Attendance",
      "Reports",
      "CRM",
      "Finance",
      "Regyfit Access Records",
    ];

    expect(screen.getAllByRole("article")).toHaveLength(expectedModules.length);
    expect(emptyStates).toHaveLength(expectedModules.length);
    expectedModules.forEach((label) => {
      expect(screen.getByRole("heading", { level: 3, name: label })).toBeVisible();
    });
    emptyStates.forEach((emptyState) => {
      expect(emptyState).toHaveTextContent("Not yet imported");
    });

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
    expect(navigationLinks).toHaveLength(7);
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
