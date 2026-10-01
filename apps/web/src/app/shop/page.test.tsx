import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  status: "signed-out" as "signed-in" | "signed-out" | "loading",
  session: undefined as
    | {
        uid: string;
        email: string;
        displayName: string;
        role?: "guardian" | "adultStudent" | "shopper";
      }
    | undefined,
  signOut: vi.fn(),
}));

const shopApi = vi.hoisted(() => ({
  listPublicShopCatalog: vi.fn(),
  listShopCatalog: vi.fn(),
  listMyShopOrders: vi.fn(),
  placeShopOrder: vi.fn(),
  uploadShopOrderProof: vi.fn(),
}));

vi.mock("../../lib/client-auth", () => ({
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => authState,
}));
vi.mock("../../lib/shop-client", () => shopApi);
vi.mock("../enrol/payment-instructions", () => ({
  useEnrolmentBankDetails: () => ({
    details: {
      accountName: "BPT Jersey",
      sortCode: "123456",
      accountNumber: "12345678",
      bankName: null,
      referenceHint: "Your name",
      acceptsCash: true,
    },
    error: false,
    onRetry: vi.fn(),
  }),
  EnrolmentBankDetails: () => (
    <dl>
      <dt>Account name</dt>
      <dd>BPT Jersey</dd>
    </dl>
  ),
}));

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
const rashguard = {
  ...gi,
  productId: "bpt-rashguard",
  name: "BPT rashguard",
  category: "rashguard" as const,
  description: null,
  priceMinor: 4000,
  sizes: [],
  imageUrl: null,
  stockStatus: "made-to-order" as const,
  sortOrder: 30,
};
const placedOrder = {
  orderId: "order-abc12345",
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
  pickupLocationId: "west" as const,
  paymentMethod: "bank_transfer" as const,
  proofId: "a".repeat(64),
  contactName: "Sam Client",
  contactPhone: null,
  note: null,
  status: "requested" as const,
  paymentStatus: "unpaid" as const,
  staffNote: null,
  createdAt: "2026-09-04T10:00:00.000Z",
  updatedAt: "2026-09-04T10:00:00.000Z",
};

function signIn(role: "guardian" | "adultStudent" | "shopper" = "adultStudent"): void {
  authState.status = "signed-in";
  authState.session = {
    uid: "client-1",
    email: "sam@example.test",
    displayName: "Sam Client",
    role,
  };
}

describe("client shop", () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    cleanup();
    authState.status = "signed-out";
    authState.session = undefined;
    Object.values(shopApi).forEach((mock) => mock.mockReset());
  });

  /**
   * T120: the catalogue is public information. A visitor reads it without an account; signing in
   * is asked for only at checkout.
   */
  it("shows the published catalog to a visitor with no account", async () => {
    shopApi.listPublicShopCatalog.mockResolvedValue([gi, backpack]);

    render(<ShopPage />);

    expect(await screen.findByRole("heading", { name: "Club shop", level: 1 })).toBeVisible();
    const products = screen.getByRole("list", { name: "Products" });
    expect(within(products).getByRole("heading", { name: "BPT competition gi" })).toBeVisible();
    expect(within(products).getByText("£95.00")).toBeVisible();

    expect(shopApi.listPublicShopCatalog).toHaveBeenCalledWith("demo-academy");
    expect(shopApi.listShopCatalog).not.toHaveBeenCalled();
    expect(shopApi.listMyShopOrders).not.toHaveBeenCalled();

    // Nothing that belongs to an account is rendered for a visitor.
    expect(screen.queryByLabelText("Name for the order")).not.toBeInTheDocument();
    expect(screen.queryByText("Order history")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to home/ })).toHaveAttribute("href", "/");
  });

  it("filters the catalog by category", async () => {
    signIn();
    shopApi.listShopCatalog.mockResolvedValue([gi, backpack]);
    shopApi.listMyShopOrders.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<ShopPage />);

    const products = await screen.findByRole("list", { name: "Products" });
    expect(shopApi.listPublicShopCatalog).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Backpacks" }));
    expect(
      within(products).queryByRole("heading", { name: "BPT competition gi" }),
    ).not.toBeInTheDocument();
    expect(within(products).getByRole("heading", { name: "BPT backpack" })).toBeVisible();
  });

  it("lets a visitor fill the basket and asks them to sign in to check out", async () => {
    authState.status = "signed-out";
    shopApi.listPublicShopCatalog.mockResolvedValue([gi, backpack]);
    render(<ShopPage />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Add BPT competition gi to basket" }),
    );
    expect(screen.getByRole("region", { name: "Your basket" })).toHaveTextContent("£95.00");
    expect(screen.getByRole("link", { name: /^Basket · 1 item ·/ })).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in or create a buyer account" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fshop",
    );
    expect(JSON.parse(localStorage.getItem("bpt-shop-basket")!)).toEqual([
      { productId: "bpt-gi-blue", size: "A1", quantity: 1 },
    ]);
  });

  it("changes a basket quantity and removes a line", async () => {
    shopApi.listPublicShopCatalog.mockResolvedValue([gi, backpack]);
    render(<ShopPage />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Add BPT competition gi to basket" }),
    );
    const basket = screen.getByRole("region", { name: "Your basket" });
    await user.selectOptions(
      within(basket).getByLabelText("Quantity of BPT competition gi A1"),
      "3",
    );
    expect(basket).toHaveTextContent("£285.00");
    expect(JSON.parse(localStorage.getItem("bpt-shop-basket")!)).toEqual([
      { productId: "bpt-gi-blue", size: "A1", quantity: 3 },
    ]);
    await user.click(within(basket).getByRole("button", { name: "Remove BPT competition gi A1" }));
    expect(basket).toHaveTextContent("Your basket is empty");
    expect(localStorage.getItem("bpt-shop-basket")).toBeNull();
  });

  it("keeps a sold-out product visible but not addable", async () => {
    authState.status = "signed-out";
    shopApi.listPublicShopCatalog.mockResolvedValue([gi, backpack]);
    render(<ShopPage />);
    expect(await screen.findByRole("button", { name: "BPT backpack is sold out" })).toBeDisabled();
  });

  it("removes a basket item that is no longer available and says so", async () => {
    localStorage.setItem(
      "bpt-shop-basket",
      JSON.stringify([{ productId: "bpt-backpack", size: null, quantity: 1 }]),
    );
    authState.status = "signed-out";
    shopApi.listPublicShopCatalog.mockResolvedValue([gi, backpack]);
    render(<ShopPage />);
    const notice = await screen.findByText(/BPT backpack was removed from your basket/);
    expect(notice).toBeVisible();
    expect(notice).toHaveClass("shop-message-warning");
    expect(localStorage.getItem("bpt-shop-basket")).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Add BPT competition gi to basket" }));
    expect(screen.queryByText(/BPT backpack was removed/)).not.toBeInTheDocument();
  });

  it("explains made-to-order items on the card and at checkout", async () => {
    signIn();
    shopApi.listShopCatalog.mockResolvedValue([gi, rashguard]);
    shopApi.listMyShopOrders.mockResolvedValue([]);
    render(<ShopPage />);
    const user = userEvent.setup();
    const products = await screen.findByRole("list", { name: "Products" });
    const card = within(products)
      .getByRole("heading", { name: "BPT rashguard" })
      .closest("li") as HTMLElement;
    const giCard = within(products)
      .getByRole("heading", { name: "BPT competition gi" })
      .closest("li") as HTMLElement;
    const lead = "Made for you after you order. The academy confirms when it will be ready.";
    expect(within(card).getByText(lead)).toBeVisible();
    expect(within(giCard).queryByText(lead)).not.toBeInTheDocument();

    const hint =
      "Some items are made to order and take longer. You can still pay now or when you collect.";
    await user.click(screen.getByRole("button", { name: "Add BPT competition gi to basket" }));
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add BPT rashguard to basket" }));
    expect(screen.getByText(hint)).toBeVisible();
  });

  it("checks out with a bank transfer, centre and screenshot", async () => {
    signIn();
    shopApi.listShopCatalog.mockResolvedValue([gi, backpack]);
    shopApi.listMyShopOrders.mockResolvedValue([]);
    shopApi.uploadShopOrderProof.mockResolvedValue("a".repeat(64));
    shopApi.placeShopOrder.mockResolvedValue(placedOrder);
    render(<ShopPage />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Size for BPT competition gi"), "A2");
    await user.click(screen.getByRole("button", { name: "Add BPT competition gi to basket" }));
    const name = screen.getByLabelText("Name for the order");
    expect(name).toHaveValue("Sam Client");
    await user.clear(name);
    expect(name).toHaveValue("");
    await user.type(name, "Sam Client");
    await user.click(screen.getByRole("radio", { name: /West/ }));
    await user.click(screen.getByRole("radio", { name: "Bank transfer now" }));
    const place = screen.getByRole("button", { name: /Place order/ });
    expect(place).toBeDisabled();
    await user.upload(
      screen.getByLabelText("Transfer screenshot"),
      new File([new Uint8Array([137, 80, 78, 71])], "proof.png", { type: "image/png" }),
    );
    await user.click(place);
    expect(shopApi.placeShopOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [{ productId: "bpt-gi-blue", size: "A2", quantity: 1 }],
        pickupLocationId: "west",
        paymentMethod: "bank_transfer",
        proofId: "a".repeat(64),
        contactName: "Sam Client",
      }),
    );
    const confirmation = await screen.findByRole("status", { name: "Order placed" });
    expect(confirmation).toHaveFocus();
    expect(confirmation).toHaveTextContent("West");
    expect(confirmation).toHaveTextContent(
      "We will check your transfer. Check this page for its status; the academy may also contact you.",
    );
    expect(localStorage.getItem("bpt-shop-basket")).toBeNull();
  });

  it("pays on collection without a screenshot and blocks a double submit", async () => {
    signIn("guardian");
    shopApi.listShopCatalog.mockResolvedValue([gi]);
    shopApi.listMyShopOrders.mockResolvedValue([]);
    let resolve!: (value: unknown) => void;
    shopApi.placeShopOrder.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<ShopPage />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Add BPT competition gi to basket" }),
    );
    await user.click(screen.getByRole("radio", { name: /Town/ }));
    await user.click(screen.getByRole("radio", { name: "Pay when you collect" }));
    const place = screen.getByRole("button", { name: /Place order/ });
    await user.click(place);
    expect(place).toBeDisabled();
    await user.click(place);
    expect(shopApi.placeShopOrder).toHaveBeenCalledTimes(1);
    expect(shopApi.uploadShopOrderProof).not.toHaveBeenCalled();
    resolve({
      ...placedOrder,
      paymentMethod: "at_collection",
      proofId: null,
      pickupLocationId: "town",
    });
    const confirmation = await screen.findByRole("status", { name: "Order placed" });
    expect(confirmation).toHaveTextContent("Town");
    expect(confirmation).toHaveTextContent(
      "Pay when you collect. Check this page for its status; the academy may also contact you.",
    );
  });

  it("keeps one requestId per order across a retry and starts a new one after success", async () => {
    signIn();
    let next = 0;
    const uuid = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockImplementation(() => `00000000-0000-4000-8000-00000000000${++next}` as const);
    shopApi.listShopCatalog.mockResolvedValue([gi]);
    shopApi.listMyShopOrders.mockResolvedValue([]);
    shopApi.uploadShopOrderProof.mockResolvedValue("a".repeat(64));
    shopApi.placeShopOrder
      .mockRejectedValueOnce(new Error("Network trouble. Try again."))
      .mockResolvedValueOnce(placedOrder)
      .mockResolvedValueOnce({ ...placedOrder, orderId: "order-second01" });
    render(<ShopPage />);
    const user = userEvent.setup();
    const add = await screen.findByRole("button", { name: "Add BPT competition gi to basket" });
    await user.click(add);
    await user.click(screen.getByRole("radio", { name: /West/ }));
    await user.click(screen.getByRole("radio", { name: "Bank transfer now" }));
    await user.upload(
      screen.getByLabelText("Transfer screenshot"),
      new File([new Uint8Array([137, 80, 78, 71])], "proof.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network trouble");
    const first = shopApi.placeShopOrder.mock.calls[0]![0].requestId as string;
    expect(shopApi.uploadShopOrderProof.mock.calls[0]![0]).toBe(first);

    await user.click(screen.getByRole("button", { name: /Place order/ }));
    await screen.findByRole("status", { name: "Order placed" });
    expect(shopApi.placeShopOrder.mock.calls[1]![0].requestId).toBe(first);
    expect(shopApi.uploadShopOrderProof.mock.calls[1]![0]).toBe(first);

    await user.click(add);
    await user.click(screen.getByRole("radio", { name: "Pay when you collect" }));
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    await screen.findByRole("status", { name: "Order placed" });
    expect(shopApi.placeShopOrder.mock.calls[2]![0].requestId).not.toBe(first);
    uuid.mockRestore();
  });

  it("shows the server's reason when an item became unavailable", async () => {
    signIn("shopper");
    shopApi.listShopCatalog.mockResolvedValue([gi]);
    shopApi.listMyShopOrders.mockResolvedValue([]);
    shopApi.placeShopOrder.mockRejectedValue(
      new Error("BPT competition gi is no longer available"),
    );
    render(<ShopPage />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Add BPT competition gi to basket" }),
    );
    await user.click(screen.getByRole("radio", { name: /Town/ }));
    await user.click(screen.getByRole("radio", { name: "Pay when you collect" }));
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "BPT competition gi is no longer available",
    );
  });

  it("tells the customer the academy handles the refund of a cancelled paid order", async () => {
    signIn();
    shopApi.listShopCatalog.mockResolvedValue([gi]);
    shopApi.listMyShopOrders.mockResolvedValue([
      { ...placedOrder, status: "cancelled", paymentStatus: "paid" },
    ]);
    render(<ShopPage />);
    const history = (await screen.findByRole("heading", { name: "Order history" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(history).getByText("SHOP-ABC12345")).toBeVisible();
    expect(within(history).getByText("Cancelled · refund handled by the academy")).toBeVisible();
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

  it("explains an empty catalog to a visitor without offering an account surface", async () => {
    shopApi.listPublicShopCatalog.mockResolvedValue([]);

    render(<ShopPage />);

    expect(await screen.findByText("No products are published yet.")).toBeVisible();
    expect(screen.queryByText("No orders yet.")).not.toBeInTheDocument();
  });
});
