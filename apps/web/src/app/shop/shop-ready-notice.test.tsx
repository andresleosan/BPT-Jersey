import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShopOrderProjection } from "@bpt-jersey/domain/shop";

const shopApi = vi.hoisted(() => ({ listMyShopOrders: vi.fn() }));
vi.mock("../../lib/shop-client", () => shopApi);
import { MyShopReadyNotice } from "./shop-ready-notice";

const order: ShopOrderProjection = {
  orderId: "order-6f1c2a7e-1111",
  customerUserId: "client-1",
  lines: [
    {
      productId: "bpt-gi-blue",
      productName: "BPT competition gi",
      category: "gi",
      size: "A2",
      quantity: 1,
      unitPriceMinor: 9500,
      lineTotalMinor: 9500,
    },
  ],
  totalMinor: 9500,
  currency: "GBP",
  pickupLocationId: "town",
  paymentMethod: "at_collection",
  proofId: null,
  contactName: "Sam Client",
  contactPhone: null,
  contactEmail: null,
  note: null,
  status: "ready",
  paymentStatus: "unpaid",
  staffNote: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

describe("MyShopReadyNotice", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("names each ready order and its centre once, in a status region", async () => {
    shopApi.listMyShopOrders.mockResolvedValue([
      order,
      { ...order, orderId: "order-b", status: "confirmed" },
    ]);
    render(<MyShopReadyNotice />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your order SHOP-6F1C2A7E is ready to collect at Town.",
    );
    expect(screen.getAllByText(/is ready to collect/)).toHaveLength(1);
    expect(shopApi.listMyShopOrders).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when no order is ready or the read fails", async () => {
    shopApi.listMyShopOrders.mockRejectedValue(new Error("internal stack"));
    const { container } = render(<MyShopReadyNotice />);
    await waitFor(() => expect(shopApi.listMyShopOrders).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
