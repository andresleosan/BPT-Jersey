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
      "react-hooks/set-state-in-effect": "off",
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
    ".tmp/**",
    ".worktrees/**",
    "**/.next/**",
    "**/build/**",
    "**/coverage/**",
    "**/dist/**",
    ".firebase-functions/**",
    // Build output only. `apps/web/src/lib` is source and must stay linted.
    "apps/functions/lib/**",
    "packages/*/lib/**",
    "**/node_modules/**",
    "**/out/**",
    "apps/web/next-env.d.ts",
    // Las dos mitades de Listav2 no son modulos: son fragmentos que `Listav2/build.mjs` concatena.
    // Leidas por separado, cada una parece declarar cosas que nadie usa -los datos definen lo que
    // consume el motor, y el motor usa lo que definen los datos-, asi que producen avisos falsos.
    // El artefacto real, `Listav2/Listav2.js`, si se lintea y pasa limpio.
    "Listav2/Listav2.data.js",
    "Listav2/Listav2.engine.js",
  ]),
]);
