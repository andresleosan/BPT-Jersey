import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "rules",
    environment: "node",
    fileParallelism: false,
    include: ["qa/rules/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
