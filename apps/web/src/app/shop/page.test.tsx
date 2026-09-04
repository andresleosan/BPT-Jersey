import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  status: "signed-out" as "signed-in" | "signed-out",
  session: undefined as
    | { uid: string; email: string; displayName: string; role?: "guardian" | "adultStudent" }
    | undefined,
  signOut: vi.fn(),
}));

const shopApi = vi.hoisted(() => ({
  listShopCatalog: vi.fn(),
  listMyShopOrders: vi.fn(),
  placeShopOrder: vi.fn(),
}));

vi.mock("../../lib/client-auth", async () => {
  const { requireClientSession } =
    await vi.importActual<typeof import("../../lib/login-flow")>("../../lib/login-flow");

  return {
    ClientAuthGate: ({
      children,
      returnPath,
    }: {
      children: React.ReactNode;
      returnPath: "/shop";
    }) =>
      authState.status === "signed-in" ? (
        children
      ) : (
        <a href={requireClientSession(returnPath).loginPath}>Sign in</a>
      ),
    ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
    useClientSession: () => authState,
  };
});
vi.mock("../../lib/shop-client", () => shopApi);

import ShopPage from "./page";

const gi = {
  productId: "bpt-gi-blue",
  name: "BPT competition gi",
  category: "gi" as const,
  description: "Blue ripstop gi.",
  priceMinor: 9500,
  currency: "GBP" as const,
  sizes: ["A1", "A2"],
  imageUrl: "/shop/gis.jpg",
  stockStatus: "in-stock" as const,
  sortOrder: 10,
  active: true,
};
const backpack = {
  ...gi,
  productId: "bpt-backpack",
  name: "BPT backpack",
  category: "backpack" as const,
  priceMinor: 4500,
  sizes: [],
  imageUrl: null,
  stockStatus: "sold-out" as const,
  sortOrder: 20,
};
const placedOrder = {
  orderId: "order-1",
  customerUserId: "client-1",
  productId: "bpt-gi-blue",
  productName: "BPT competition gi",
  category: "gi" as const,
  size: "A2",
  quantity: 2,
  unitPriceMinor: 9500,
  totalMinor: 19000,
  currency: "GBP" as const,
  contactName: "Sam Client",
  contactPhone: null,
  note: null,
  status: "requested" as const,
  paymentStatus: "unpaid" as const,
  staffNote: null,
  createdAt: "2026-09-04T10:00:00.000Z",
  updatedAt: "2026-09-04T10:00:00.000Z",
};

describe("client shop", () => {
  afterEach(() => {
    cleanup();
    authState.status = "signed-out";
    authState.session = undefined;
    Object.values(shopApi).forEach((mock) => mock.mockReset());
  });

  it("requires a client session without exposing commerce data", () => {
    render(<ShopPage />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?role=client&returnTo=%2Fshop",
    );
    expect(screen.queryByText(/product|cart|order|payment/i)).not.toBeInTheDocument();
    expect(shopApi.listShopCatalog).not.toHaveBeenCalled();
  });

  it("shows the published catalog and places a collection order for a signed-in client", async () => {
    authState.status = "signed-in";
    authState.session = {
      uid: "client-1",
      email: "sam@example.com",
      displayName: "Sam Client",
      role: "adultStudent",
    };
    shopApi.listShopCatalog.mockResolvedValue([gi, backpack]);
    shopApi.listMyShopOrders.mockResolvedValue([]);
    shopApi.placeShopOrder.mockResolvedValue(placedOrder);
    vi.stubGlobal("crypto", { randomUUID: () => "req-uuid" });
    const user = userEvent.setup();

    render(<ShopPage />);

    expect(await screen.findByRole("heading", { name: "Club shop", level: 1 })).toBeVisible();
    expect(screen.getByText(/paid at the academy on collection/i)).toBeVisible();
    const products = screen.getByRole("list", { name: "Products" });
    expect(within(products).getByRole("heading", { name: "BPT competition gi" })).toBeVisible();
    expect(within(products).getByText("£95.00")).toBeVisible();
    expect(within(products).getByRole("button", { name: "Sold out" })).toBeDisabled();
    expect(screen.getByLabelText("Name for the order")).toHaveValue("Sam Client");

    const giCard = within(products)
      .getByRole("heading", { name: "BPT competition gi" })
      .closest("li") as HTMLElement;
    await user.selectOptions(within(giCard).getByLabelText("Size"), "A2");
    const quantity = within(giCard).getByLabelText("Quantity");
    await user.clear(quantity);
    await user.type(quantity, "2");
    await user.click(screen.getByRole("button", { name: "Request BPT competition gi" }));

    await waitFor(() =>
      expect(shopApi.placeShopOrder).toHaveBeenCalledWith({
        requestId: "req-uuid",
        productId: "bpt-gi-blue",
        size: "A2",
        quantity: 2,
        contactName: "Sam Client",
        contactPhone: null,
        note: null,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/Pay £190.00 at the academy/);
    const orders = screen.getByRole("table", { name: "Your club shop orders" });
    expect(within(orders).getByText("Requested")).toBeVisible();
    expect(within(orders).getByText("Pay on collection")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Backpacks" }));
    expect(
      within(products).queryByRole("heading", { name: "BPT competition gi" }),
    ).not.toBeInTheDocument();
    expect(within(products).getByRole("heading", { name: "BPT backpack" })).toBeVisible();
    vi.unstubAllGlobals();
  });

  it("explains an empty catalog and lets the client retry after a load failure", async () => {
    authState.status = "signed-in";
    authState.session = { uid: "client-1", email: "sam@example.com", displayName: "Sam" };
    shopApi.listShopCatalog.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    shopApi.listMyShopOrders.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<ShopPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Unable to load the club shop/);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No products are published yet.")).toBeVisible();
    expect(screen.getByText("No orders yet.")).toBeVisible();
  });
});
