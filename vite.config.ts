/* eslint-env node */
import { defineConfig } from "viteburner"

export default defineConfig({
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
