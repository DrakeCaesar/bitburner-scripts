/* eslint-env node */
import { defineConfig } from "viteburner"
import { resolve, dirname } from "path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import type { Plugin, ViteDevServer } from "vite"

const repoRoot = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const { bundleSolverWorker } = nodeRequire("./build/bundleSolverWorker.cjs") as {
  bundleSolverWorker: () => string
}

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
function bitburnerImportPaths(): Plugin {
  return {
    name: "bitburner-import-paths",
    enforce: "post" as const,
    apply: "serve" as const,
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

/** Emit import-free IIFE for browser Worker blob (like contractWorker). */
function solverWorkerBundle(): Plugin {
  let bundled = bundleSolverWorker()

  return {
    name: "solver-worker-bundle",
    enforce: "pre" as const,
    buildStart() {
      bundled = bundleSolverWorker()
    },
    configureServer(server: ViteDevServer) {
      server.watcher.on("change", (file: string) => {
        const norm = file.replace(/\\/g, "/")
        if (!norm.includes("/dnet/solvers/")) return
        if (norm.endsWith("/solverWorker.js")) return
        bundled = bundleSolverWorker()
      })
    },
    transform(code: string, id: string) {
      const norm = id.replace(/\\/g, "/")
      if (!norm.endsWith("/dnet/solvers/solverWorker.js")) return
      return { code: bundled, map: null }
    },
  }
}

export default defineConfig({
  plugins: [solverWorkerBundle(), bitburnerImportPaths()],
  server: {
    watch: {
      ignored: ["**/ipvgo-engine/**"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(repoRoot, "src"),
      "/src": resolve(repoRoot, "src"),
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
