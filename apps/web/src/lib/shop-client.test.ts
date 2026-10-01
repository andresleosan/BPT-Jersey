import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ httpsCallable: vi.fn(), invoke: vi.fn() }));

vi.mock("./callable", () => ({ httpsCallable: api.httpsCallable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import { uploadShopOrderProof } from "./shop-client";

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
});
