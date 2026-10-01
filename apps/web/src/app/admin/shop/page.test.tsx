import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shopOrderReference } from "@bpt-jersey/domain/shop";

const shopApi = vi.hoisted(() => ({
  listManagedShopProducts: vi.fn(),
  listShopOrders: vi.fn(),
  saveShopProduct: vi.fn(),
  setShopProductActive: vi.fn(),
  updateShopOrder: vi.fn(),
  getShopOrderProofUrl: vi.fn(),
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
const hiddenProduct = {
  ...gi,
  productId: "bpt-hidden",
  name: "BPT hidden",
  sortOrder: 20,
  active: false,
};
const order = {
  orderId: "order-1",
  customerUserId: "client-1",
  lines: [
    {
      productId: "bpt-gi-blue",
      productName: "BPT competition gi",
      category: "gi" as const,
      size: "A2",
      quantity: 1,
      unitPriceMinor: 9500,
      lineTotalMinor: 9500,
    },
  ],
  totalMinor: 9500,
  currency: "GBP" as const,
  pickupLocationId: "town" as const,
  paymentMethod: "at_collection" as const,
  proofId: null,
  contactName: "Sam Client",
  contactPhone: "07700 900000",
  note: "Collect Tuesday",
  status: "requested" as const,
  paymentStatus: "unpaid" as const,
  staffNote: null,
  createdAt: "2026-09-04T10:00:00.000Z",
  updatedAt: "2026-09-04T10:00:00.000Z",
};
const transferOrder = {
  ...order,
  orderId: "order-7a2b9c3d-2222",
  customerUserId: "client-2",
  lines: [
    {
      productId: "bpt-gi",
      productName: "BPT gi",
      category: "gi" as const,
      size: "A2",
      quantity: 1,
      unitPriceMinor: 9500,
      lineTotalMinor: 9500,
    },
  ],
  pickupLocationId: "west" as const,
  paymentMethod: "bank_transfer" as const,
  proofId: "proof-1",
  contactName: "Tia Transfer",
  note: null,
};

describe("club shop admin page", () => {
  beforeEach(() => {
    shopApi.listManagedShopProducts.mockResolvedValue([gi, hiddenProduct]);
    shopApi.listShopOrders.mockResolvedValue([transferOrder]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
    expect(within(products).getByText("Visible")).toBeVisible();
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

    await user.click(screen.getByRole("button", { name: "Hide BPT competition gi from shop" }));
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

  it("puts orders first and shows centre, payment method and lines", async () => {
    render(<ShopAdminPage />);
    const orders = await screen.findByRole("region", { name: "Orders" });
    const products = screen.getByRole("region", { name: "Products" });
    expect(
      orders.compareDocumentPosition(products) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The centre filter in the same region also offers "West", so read the cell from the table.
    const table = within(orders).getByRole("table", { name: "Club shop orders" });
    expect(within(table).getByText("West")).toBeVisible();
    expect(within(table).getByText("Bank transfer")).toBeVisible();
    expect(within(table).getByText(/1 × BPT gi \(A2\)/)).toBeVisible();
  });

  it("says how many products are hidden and uses shop wording", async () => {
    render(<ShopAdminPage />);
    expect(await screen.findByText("1 product is hidden. Clients cannot see it.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show BPT hidden in shop" })).toBeEnabled();
    expect(screen.getByRole("columnheader", { name: "Visible in shop" })).toBeVisible();
  });

  it("shows the transfer screenshot in a dialog through a short-lived link", async () => {
    shopApi.getShopOrderProofUrl.mockResolvedValue("https://signed.test/proof");
    const user = userEvent.setup();
    render(<ShopAdminPage />);
    await user.click(await screen.findByRole("button", { name: /View transfer screenshot/ }));
    expect(shopApi.getShopOrderProofUrl).toHaveBeenCalledWith(transferOrder.orderId);
    const reference = shopOrderReference(transferOrder.orderId);
    const dialog = await screen.findByRole("dialog", { name: reference });
    expect(
      within(dialog).getByRole("img", { name: `Transfer screenshot for ${reference}` }),
    ).toHaveAttribute("src", "https://signed.test/proof");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Transfer screenshot/ })).not.toBeInTheDocument();
  });

  it("offers no screenshot for orders paid on collection", async () => {
    shopApi.listShopOrders.mockResolvedValue([order]);
    render(<ShopAdminPage />);
    expect(await screen.findByText("Pay on collection")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /View transfer screenshot/ }),
    ).not.toBeInTheDocument();
  });

  it("says so when the transfer screenshot cannot be opened", async () => {
    shopApi.getShopOrderProofUrl.mockRejectedValue(new Error("gone"));
    render(<ShopAdminPage />);
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /View transfer screenshot/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The transfer screenshot is unavailable.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears an earlier notice when the screenshot is opened again", async () => {
    shopApi.getShopOrderProofUrl
      .mockRejectedValueOnce(new Error("gone"))
      .mockResolvedValueOnce("https://signed.test/proof");
    const user = userEvent.setup();
    render(<ShopAdminPage />);
    const button = await screen.findByRole("button", { name: /View transfer screenshot/ });
    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The transfer screenshot is unavailable.",
    );
    await user.click(button);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("filters orders by centre", async () => {
    render(<ShopAdminPage />);
    await userEvent.setup().selectOptions(await screen.findByLabelText("Centre"), "town");
    expect(screen.queryByText(shopOrderReference(transferOrder.orderId))).not.toBeInTheDocument();
  });

  it("keeps a paid order when the refund warning is dismissed", async () => {
    shopApi.listShopOrders.mockResolvedValue([{ ...transferOrder, paymentStatus: "paid" }]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ShopAdminPage />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Cancel" }));
    expect(confirm).toHaveBeenCalledWith(
      "This order is marked paid. Refund the customer outside the platform before cancelling.",
    );
    expect(shopApi.updateShopOrder).not.toHaveBeenCalled();
  });

  it("cancels a paid order once the refund warning is accepted", async () => {
    const paid = { ...transferOrder, paymentStatus: "paid" as const };
    shopApi.listShopOrders.mockResolvedValue([paid]);
    shopApi.updateShopOrder.mockResolvedValue({ ...paid, status: "cancelled" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ShopAdminPage />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Cancel" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(shopApi.updateShopOrder).toHaveBeenCalledWith({
        orderId: transferOrder.orderId,
        status: "cancelled",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      `Order ${shopOrderReference(transferOrder.orderId)} updated.`,
    );
  });

  it("cancels an unpaid order without the refund warning", async () => {
    shopApi.updateShopOrder.mockResolvedValue({ ...transferOrder, status: "cancelled" });
    const confirm = vi.spyOn(window, "confirm");
    render(<ShopAdminPage />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(shopApi.updateShopOrder).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
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
