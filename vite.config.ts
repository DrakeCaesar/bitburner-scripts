/* eslint-env node */
import { bitburnerRelativeImports } from "./build/bitburnerRelativeImports.js"
import { defineConfig } from "viteburner"

export default defineConfig({
  plugins: [bitburnerRelativeImports(process.cwd())],
  resolve: {
    alias: {
      "@": "./src",
      "/src": "./src",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
  },
  viteburner: {
    watch: [
      { pattern: "src/**/*.{js,ts}", transform: true },
      { pattern: "src/**/*.{script,txt}" },
    ],
    sourcemap: "hidden",
  },
})
