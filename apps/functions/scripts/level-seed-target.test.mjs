import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertLevelSeedConfirmation, parseLevelSeedArguments } from "./level-seed-target.mjs";

describe("level seed v3 standalone preflight", () => {
  it("accepts only the explicit v3 system ID", () => {
    assert.deepEqual(
      parseLevelSeedArguments([
        "--target=emulator",
        "--academy-id=demo-academy",
        "--system-id=ibjjf-v3",
      ]),
      { target: "emulator", "academy-id": "demo-academy", "system-id": "ibjjf-v3" },
    );
    assert.throws(
      () =>
        parseLevelSeedArguments([
          "--target=emulator",
          "--academy-id=demo-academy",
          "--system-id=ibjjf-v30",
        ]),
      /Invalid level seed arguments/,
    );
  });

  it("keeps v2 and v3 production confirmations distinct", () => {
    assert.throws(
      () =>
        assertLevelSeedConfirmation(
          "production",
          false,
          "T051V2-LEVELS-PRODUCTION-SEED",
          "ibjjf-v3",
        ),
      /T091-LEVELS-V3-PRODUCTION-SEED/,
    );
    assert.doesNotThrow(() =>
      assertLevelSeedConfirmation(
        "production",
        false,
        "T091-LEVELS-V3-PRODUCTION-SEED",
        "ibjjf-v3",
      ),
    );
  });
});
