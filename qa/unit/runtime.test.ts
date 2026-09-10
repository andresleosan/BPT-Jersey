import { describe, expect, it } from "vitest";

describe("supported development runtime", () => {
  it("runs on an approved Node.js major version", () => {
    const majorVersion = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

    expect(majorVersion).toBeGreaterThanOrEqual(22);
    expect(majorVersion).toBeLessThan(25);
  });
});
