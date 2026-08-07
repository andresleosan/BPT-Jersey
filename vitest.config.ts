import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
    },
    projects: ["apps/web/vitest.config.ts", "vitest.node.config.ts", "vitest.rules.config.ts"],
    reporters: ["default"],
  },
});
