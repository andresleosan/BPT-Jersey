import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./admin-gate", () => ({
  AdminGate: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="admin-layout-gate">{children}</div>
  ),
}));

import AdminLayout from "./layout";

describe("admin route layout", () => {
  it("keeps the administrative gate around all route content", () => {
    render(
      <AdminLayout>
        <p>Route content</p>
      </AdminLayout>,
    );

    expect(screen.getByTestId("admin-layout-gate")).toContainElement(
      screen.getByText("Route content"),
    );
  });
});
