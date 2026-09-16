import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usePathname: vi.fn(), useAdminOrStaffSession: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: mocks.usePathname }));
vi.mock("../admin-gate", () => ({ useAdminOrStaffSession: mocks.useAdminOrStaffSession }));

import ClassesServicesLayout from "./layout";

describe("Classes / Services layout", () => {
  afterEach(() => cleanup());

  it("shows the nine tabs to an administrator and marks the current one", () => {
    mocks.usePathname.mockReturnValue("/admin/classes-services/types");
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "administrator" });
    render(
      <ClassesServicesLayout>
        <p>content</p>
      </ClassesServicesLayout>,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Locations",
      "Class / Service Types",
      "Classes & Services 2.0",
      "Memberships and Vouchers",
      "Bulk Operations",
      "Listings & Reports",
      "Drop-ins",
      "Options",
      "History",
    ]);
    expect(screen.getByRole("tab", { name: "Class / Service Types" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Class / Service Types" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("tab", { name: "Locations" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("navigation", { name: "Classes / Services sections" })).toBeVisible();
    // The admin shell header already carries the page h1, so the section title sits below it.
    expect(screen.getByRole("heading", { name: "Classes / Services", level: 2 })).toBeVisible();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("content");
  });

  it("shows only the three mat tabs to a coach", () => {
    mocks.usePathname.mockReturnValue("/admin/classes-services/classes");
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "coach" });
    render(
      <ClassesServicesLayout>
        <p>content</p>
      </ClassesServicesLayout>,
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Locations",
      "Class / Service Types",
      "Classes & Services 2.0",
    ]);
  });

  it("shows only the three mat tabs to a head coach", () => {
    mocks.usePathname.mockReturnValue("/admin/classes-services/locations");
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "headCoach" });
    render(
      <ClassesServicesLayout>
        <p>content</p>
      </ClassesServicesLayout>,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});
