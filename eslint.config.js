import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  // El bundle del blueprint (blueprints/) vive dentro del repo y trae su propia copia de configs.
  globalIgnores([
    "blueprints/**",
    "dist/**",
    "dist-e2e-mock/**",
    "dev-dist/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
]);
