import { describe, expect, it } from "vitest";

import { clientIpFromRequest } from "./client-ip.js";

describe("clientIpFromRequest", () => {
  it("takes the first entry of X-Forwarded-For", () => {
    expect(
      clientIpFromRequest({
        rawRequest: {
          headers: { "x-forwarded-for": "82.112.144.10, 35.191.8.2" },
          ip: "35.191.8.2",
        },
      }),
    ).toBe("82.112.144.10");
  });

  it("falls back to the socket address when there is no header", () => {
    expect(clientIpFromRequest({ rawRequest: { headers: {}, ip: "82.112.144.10" } })).toBe(
      "82.112.144.10",
    );
  });

  it("returns null rather than rubbish", () => {
    expect(
      clientIpFromRequest({ rawRequest: { headers: { "x-forwarded-for": "<script>" } } }),
    ).toBe(null);
    expect(clientIpFromRequest({})).toBe(null);
  });
});
