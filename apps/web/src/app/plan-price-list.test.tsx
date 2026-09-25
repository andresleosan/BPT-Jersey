import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlanPriceList } from "./plan-price-list";

describe("PlanPriceList", () => {
  afterEach(cleanup);

  it("lists every live plan grouped by site with its price", () => {
    render(<PlanPriceList />);
    const town = screen.getByRole("region", { name: "BPT Town" });
    expect(within(town).getByText("Town Kids & Teens 2x")).toBeInTheDocument();
    expect(within(town).getByText("£135 per term")).toBeInTheDocument();
    expect(screen.getByText("£7.50 per class")).toBeInTheDocument();
    expect(screen.queryByText("Town Teens")).not.toBeInTheDocument();
    expect(screen.queryByText("Transit Free")).not.toBeInTheDocument();
  });

  it("shows only plans that train at the chosen site", () => {
    render(<PlanPriceList site="West" />);
    expect(screen.getByText("£65 per month")).toBeInTheDocument();
    expect(screen.getByText("£125 per month")).toBeInTheDocument();
    expect(screen.queryByText("£85 per month")).not.toBeInTheDocument();
  });
});
