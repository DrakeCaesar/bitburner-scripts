/* eslint-env node */
import { defineConfig } from "viteburner"
import { resolve } from "path"

/**
 * Vite resolves imports to /src/.../*.ts. viteburner fixImport only rewrites
 * top-level `import` declarations — not `export from` or dynamic `import()`.
 * Bitburner RAM calc then looks for /src/.../*.ts on home and fails.
 */
function bitburnerImportPaths() {
  return {
    name: "bitburner-import-paths",
    enforce: "post",
    apply: "serve",
    transform(code: string, id: string) {
      if (!/\.[jt]sx?$/.test(id)) return
      if (!id.replace(/\\/g, "/").includes("/src/")) return

      let next = code.replace(/\/src\/libraries\//g, "/libraries/")
      next = next.replace(/(\/libraries\/[^'"]+)\.ts(?=['"])/g, "$1.js")

      if (next !== code) {
        return { code: next, map: null }
      }
    },
  }
}

export default defineConfig({
  plugins: [bitburnerImportPaths()],
  server: {
    watch: {
      ignored: ["**/ipvgo-engine/**"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "/src": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
  },
  viteburner: {
    watch: [
      { pattern: "src/**/*.{js,ts,jsx,tsx}", transform: true },
      { pattern: "src/**/*.{script,txt}" },
    ],
    sourcemap: false,
  },
})
