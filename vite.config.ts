/* eslint-env node */
import { defineConfig } from "viteburner"
import { resolve } from "path"

/** Game scripts pushed from src/ — do not download back into data/. */
function isGameScriptFile(file: string): boolean {
  const lower = file.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase()
  return lower.endsWith(".js") || lower.endsWith(".script")
}

/** Map home files to data/; skip .js/.script only. */
function homeDownloadLocation(file: string, _server: string): string | null {
  const normalized = file.replace(/\\/g, "/").replace(/^\/+/, "")
  if (isGameScriptFile(normalized)) {
    return null
  }
  return `data/${normalized}`
}

/** Rewrite /src/foo/*.ts paths to /foo/*.js for Bitburner home (strips vite cache-bust ?t= too). */
function rewriteGameImportPaths(code: string): string {
  let next = code.replace(/\/src\//g, "/")
  next = next.replace(/(\/[^'"]+?)\.ts(\?[^'"]*)?(?=['"])/g, "$1.js")
  return next
}

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

      const next = rewriteGameImportPaths(code)
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
    download: {
      server: "home",
      location: homeDownloadLocation,
    },
  },
})
