import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "node",
    environment: "node",
    include: [
      "apps/functions/src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "qa/unit/**/*.test.ts",
    ],
  },
});
