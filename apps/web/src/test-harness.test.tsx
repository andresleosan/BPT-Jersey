import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./app/page";

describe("web test harness", () => {
  it("renders English content through React Testing Library", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Built for the mat");
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  });
});
