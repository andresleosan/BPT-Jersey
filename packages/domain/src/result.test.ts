import { describe, expect, expectTypeOf, it } from "vitest";

import { err, ok } from "./result";
import type { Result } from "./result";

describe("Result", () => {
  it("creates frozen success and failure envelopes", () => {
    const success = ok({ count: 2 });
    const failure = err({ code: "CONFLICT" as const });

    expect(success).toEqual({ ok: true, value: { count: 2 } });
    expect(failure).toEqual({ ok: false, error: { code: "CONFLICT" } });
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(true);
  });

  it("narrows the discriminated union", () => {
    inspectResult(ok(3));
  });
});

function inspectResult(result: Result<number, { code: "FAILED" }>): void {
  if (result.ok) {
    expectTypeOf(result.value).toEqualTypeOf<number>();
  } else {
    expectTypeOf(result.error).toEqualTypeOf<{ code: "FAILED" }>();
  }
}
