import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const shopApi = vi.hoisted(() => ({
  listManagedShopProducts: vi.fn(),
  listShopOrders: vi.fn(),
  saveShopProduct: vi.fn(),
  setShopProductActive: vi.fn(),
  updateShopOrder: vi.fn(),
}));

vi.mock("../../../lib/shop-client", () => shopApi);

import { ShopAdminPage } from "./page";

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
const order = {
  orderId: "order-1",
  customerUserId: "client-1",
  productId: "bpt-gi-blue",
  productName: "BPT competition gi",
  category: "gi" as const,
  size: "A2",
  quantity: 1,
  unitPriceMinor: 9500,
  totalMinor: 9500,
  currency: "GBP" as const,
  contactName: "Sam Client",
  contactPhone: "07700 900000",
  note: "Collect Tuesday",
  status: "requested" as const,
  paymentStatus: "unpaid" as const,
  staffNote: null,
  createdAt: "2026-09-04T10:00:00.000Z",
  updatedAt: "2026-09-04T10:00:00.000Z",
};

describe("club shop admin page", () => {
  afterEach(() => {
    cleanup();
    Object.values(shopApi).forEach((mock) => mock.mockReset());
  });

  it("creates products, toggles visibility and moves orders forward", async () => {
    shopApi.listManagedShopProducts.mockResolvedValue([gi]);
    shopApi.listShopOrders.mockResolvedValue([order]);
    shopApi.saveShopProduct.mockImplementation(async (draft) => ({ ...draft, active: true }));
    shopApi.setShopProductActive.mockResolvedValue({ ...gi, active: false });
    shopApi.updateShopOrder.mockResolvedValue({ ...order, status: "confirmed" });
    const user = userEvent.setup();

    render(<ShopAdminPage />);

    expect(await screen.findByRole("heading", { name: "Club shop", level: 2 })).toBeVisible();
    const products = await screen.findByRole("table", { name: "Club shop products" });
    expect(within(products).getByText("BPT competition gi")).toBeVisible();
    expect(within(products).getByText("£95.00")).toBeVisible();
    expect(within(products).getByText("Published")).toBeVisible();
    expect(
      within(products).getByRole("img", { name: "BPT competition gi product image" }),
    ).toHaveAttribute("src", "/shop/gis.jpg");

    await user.click(screen.getByRole("button", { name: "Edit BPT competition gi" }));
    const editor = screen.getByRole("form", { name: "BPT competition gi" });
    expect(
      within(editor).getByRole("img", { name: "BPT competition gi product image" }),
    ).toHaveAttribute("src", "/shop/gis.jpg");
    await user.click(screen.getByRole("button", { name: "Discard and start new" }));
    expect(screen.getByLabelText("New product: no image")).toBeVisible();

    await user.type(screen.getByLabelText("Name"), "BPT rashguard");
    await user.type(screen.getByLabelText("Price in pounds"), "45");
    await user.selectOptions(screen.getByLabelText("Category"), "rashguard");
    await user.type(screen.getByLabelText("Sizes (comma separated)"), "S, M, L");
    await user.click(screen.getByRole("button", { name: "Create product" }));

    await waitFor(() =>
      expect(shopApi.saveShopProduct).toHaveBeenCalledWith({
        productId: "bpt-rashguard",
        name: "BPT rashguard",
        category: "rashguard",
        description: null,
        priceMinor: 4500,
        currency: "GBP",
        sizes: ["S", "M", "L"],
        imageUrl: null,
        stockStatus: "in-stock",
        sortOrder: 100,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent('Product "BPT rashguard" saved.');
    expect(within(products).getByText("BPT rashguard")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Hide BPT competition gi" }));
    await waitFor(() =>
      expect(shopApi.setShopProductActive).toHaveBeenCalledWith("bpt-gi-blue", false),
    );
    expect(await screen.findByText("Hidden")).toBeVisible();

    const orders = screen.getByRole("table", { name: "Club shop orders" });
    expect(within(orders).getByText("Sam Client")).toBeVisible();
    expect(within(orders).getByText("Requested")).toBeVisible();
    expect(
      within(orders).queryByRole("button", { name: "Mark collected" }),
    ).not.toBeInTheDocument();
    await user.click(within(orders).getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(shopApi.updateShopOrder).toHaveBeenCalledWith({
        orderId: "order-1",
        status: "confirmed",
      }),
    );
    expect(await within(orders).findByText("Confirmed")).toBeVisible();
    expect(within(orders).getByRole("button", { name: "Mark ready" })).toBeVisible();
  });

  it("rejects invalid editor input before calling the backend", async () => {
    shopApi.listManagedShopProducts.mockResolvedValue([]);
    shopApi.listShopOrders.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<ShopAdminPage />);

    expect(await screen.findByText("No products yet.")).toBeVisible();
    await user.type(screen.getByLabelText("Name"), "Gi");
    await user.type(screen.getByLabelText("Price in pounds"), "95");
    await user.type(screen.getByLabelText("Sizes (comma separated)"), "A1, A1");
    await user.click(screen.getByRole("button", { name: "Create product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sizes must not repeat.");
    expect(shopApi.saveShopProduct).not.toHaveBeenCalled();
  });

  it("shows an explicit error when the connected source fails", async () => {
    shopApi.listManagedShopProducts.mockRejectedValue(new Error("offline"));
    shopApi.listShopOrders.mockResolvedValue([]);

    render(<ShopAdminPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load products and orders.",
    );
  });
});
