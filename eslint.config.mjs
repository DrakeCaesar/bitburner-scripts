import js from "@eslint/js"
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: ["build/**", "dist/**", "ideas/**", "node_modules/**", "out/**", "tests/**", "NetscriptDefinitions.d.ts"],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "no-constant-condition": "off",
    },
  },
  // Bitburner scripts run in the game's runtime, which is browser-like.
  {
    files: ["src/**/*.{js,ts}"],
    languageOptions: { globals: globals.browser },
  },
  // Bench tools and the shared web UI helpers run in a browser page.
  {
    files: ["bench/**/*.{js,mjs,ts}", "webui/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  // Node-side tooling: the engine, the bench CLIs and build scripts.
  {
    files: ["bench/**/*.{js,mjs}", "docs/**/*.{js,mjs}", "ipvgo-engine/**/*.{js,mjs,cjs}", "*.{js,mjs,cjs}"],
    languageOptions: { globals: globals.node },
  },
  // Type-aware linting for everything the TS project covers. kingOfTheHillBench.ts is only
  // ever run through esbuild, so it stays out of tsconfig and needs a default project.
  {
    files: ["src/**/*.{js,ts}", "bench/**/*.ts", "*.mts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: { allowDefaultProject: ["bench/koth/kingOfTheHillBench.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  // Last: turns off the rules that would fight with prettier.
  eslintPluginPrettierRecommended
)
