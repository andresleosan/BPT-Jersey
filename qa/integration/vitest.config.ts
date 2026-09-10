import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "firestore-integration",
    environment: "node",
    fileParallelism: false,
    // Relative to this config file, so the project resolves the same way when
    // it is listed from the root config and when it is run on its own.
    include: ["**/*.test.ts"],
    testTimeout: 30_000,
  },
});
