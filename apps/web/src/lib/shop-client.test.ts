import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ httpsCallable: vi.fn(), invoke: vi.fn() }));

vi.mock("./callable", () => ({ httpsCallable: api.httpsCallable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import { getShopOrderProofUrl, placeShopOrder, uploadShopOrderProof } from "./shop-client";

describe("shop client proof upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.httpsCallable.mockReturnValue(api.invoke);
  });

  it("gives the safe message when the screenshot cannot be read", async () => {
    const file = new File(["png"], "proof.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: () => Promise.reject(new Error("NotReadableError: raw browser detail")),
    });
    await expect(uploadShopOrderProof("req-1", file)).rejects.toThrow(
      "The payment screenshot could not be uploaded.",
    );
    expect(api.invoke).not.toHaveBeenCalled();
  });

  it("shows the server's reason when it rejects the screenshot", async () => {
    api.invoke.mockRejectedValue(
      Object.assign(new Error("The payment screenshot is not a valid PNG or JPEG."), {
        code: "functions/invalid-argument",
      }),
    );
    const file = new File([new Uint8Array([137, 80, 78, 71])], "proof.png", { type: "image/png" });
    await expect(uploadShopOrderProof("req-1", file)).rejects.toThrow(
      "The payment screenshot is not a valid PNG or JPEG.",
    );
  });

  it("keeps the generic message for any other upload failure", async () => {
    api.invoke.mockRejectedValue(
      Object.assign(new Error("raw storage detail"), { code: "functions/internal" }),
    );
    const file = new File([new Uint8Array([137, 80, 78, 71])], "proof.png", { type: "image/png" });
    await expect(uploadShopOrderProof("req-1", file)).rejects.toThrow(
      "The payment screenshot could not be uploaded.",
    );
  });
});

const checkout = {
  requestId: "req-1",
  lines: [{ productId: "bpt-gi-blue", size: "A2", quantity: 1 }],
  pickupLocationId: "town" as const,
  paymentMethod: "at_collection" as const,
  proofId: null,
  contactName: "Sam Client",
  contactPhone: null,
  note: null,
};

describe("shop client place order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.httpsCallable.mockReturnValue(api.invoke);
  });

  it("passes the server's message through when the order id was already used", async () => {
    const message = "This order was already placed. Refresh the page to start a new one.";
    api.invoke.mockRejectedValue(Object.assign(new Error(message), { code: "functions/already-exists" }));
    await expect(placeShopOrder(checkout)).rejects.toThrow(message);
  });

  it("hides any other server message behind the generic one", async () => {
    api.invoke.mockRejectedValue(
      Object.assign(new Error("raw internal detail"), { code: "functions/internal" }),
    );
    await expect(placeShopOrder(checkout)).rejects.toThrow("Unable to place the order.");
  });
});

describe("shop client transfer screenshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.httpsCallable.mockReturnValue(api.invoke);
  });

  it("says the screenshot was deleted when the server reports it missing", async () => {
    const message = "Screenshot no longer kept (deleted after 90 days).";
    api.invoke.mockRejectedValue(Object.assign(new Error(message), { code: "functions/not-found" }));
    await expect(getShopOrderProofUrl("order-1")).rejects.toThrow(message);
  });

  it("keeps the generic message for any other failure", async () => {
    api.invoke.mockRejectedValue(
      Object.assign(new Error("raw detail"), { code: "functions/failed-precondition" }),
    );
    await expect(getShopOrderProofUrl("order-1")).rejects.toThrow(
      "The transfer screenshot is unavailable.",
    );
  });
});
