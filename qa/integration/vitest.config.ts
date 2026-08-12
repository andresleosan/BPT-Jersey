import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "firestore-integration",
    environment: "node",
    fileParallelism: false,
    include: ["qa/integration/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
