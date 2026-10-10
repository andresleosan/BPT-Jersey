import { expect, it, vi } from "vitest";

import { onCallWithFreshAppCheck, requireFreshAppCheck } from "./app-check.js";

const request = (app?: { alreadyConsumed?: boolean }) => ({ app }) as never;

it.each([undefined, { alreadyConsumed: true }])(
  "rejects missing or replayed App Check data",
  (app) => {
    expect(() => requireFreshAppCheck(request(app))).toThrowError(
      expect.objectContaining({ code: "unauthenticated" }),
    );
  },
);

it("runs a callable once App Check reports a fresh token", async () => {
  const handler = vi.fn(() => "ok");
  const callable = onCallWithFreshAppCheck(
    { enforceAppCheck: true, consumeAppCheckToken: true },
    handler,
  );
  await expect(callable.run(request({ alreadyConsumed: false }))).resolves.toBe("ok");
  expect(handler).toHaveBeenCalledOnce();
});

it("refuses to construct a fresh-token wrapper without token consumption", () => {
  expect(() => onCallWithFreshAppCheck({ enforceAppCheck: true }, vi.fn())).toThrow(
    "Fresh App Check requires consumeAppCheckToken.",
  );
});
