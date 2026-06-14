/* eslint-env node */
import { existsSync } from "fs"
import { defineConfig } from "viteburner"
import { resolve } from "path"

const repoRoot = __dirname

/** True for files managed in src/ and pushed to home (not downloaded). */
function isPushedScriptFile(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^\/+/, "")
  const lower = normalized.toLowerCase()
  if (lower.endsWith(".js") || lower.endsWith(".script")) {
    return true
  }
  if (lower.endsWith(".txt") && existsSync(resolve(repoRoot, "src", normalized))) {
    return true
  }
  return false
}

/** Map home files to data/; skip scripts that live in src/. */
function homeDownloadLocation(file: string, _server: string): string | null {
  const normalized = file.replace(/\\/g, "/").replace(/^\/+/, "")
  if (isPushedScriptFile(normalized)) {
    return null
  }
  return `data/${normalized}`
}

/** Rewrite /src/libraries/*.ts paths to /libraries/*.js for Bitburner home. */
function rewriteGameImportPaths(code: string): string {
  let next = code.replace(/\/src\/libraries\//g, "/libraries/")
  next = next.replace(/(\/libraries\/[^'"]+)\.ts(?=['"])/g, "$1.js")
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
