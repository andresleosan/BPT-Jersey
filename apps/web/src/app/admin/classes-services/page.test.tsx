import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

import ClassesServicesIndexPage from "./page";

describe("Classes / Services index", () => {
  afterEach(() => cleanup());

  it("replaces itself with the Classes & Services 2.0 tab", () => {
    render(<ClassesServicesIndexPage />);
    expect(mocks.replace).toHaveBeenCalledWith("/admin/classes-services/classes");
    expect(screen.getByText("Opening Classes & Services…")).toBeVisible();
  });
});
