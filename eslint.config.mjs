import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
    settings: {
      next: {
        rootDir: "apps/web/",
      },
      react: {
        version: "19.2",
      },
    },
  },
  prettier,
  globalIgnores([
    ".agents/**",
    ".claude/**",
    ".cronos/**",
    "**/.next/**",
    "**/build/**",
    "**/coverage/**",
    "**/dist/**",
    "**/lib/**",
    "**/node_modules/**",
    "**/out/**",
    "apps/web/next-env.d.ts",
  ]),
]);
