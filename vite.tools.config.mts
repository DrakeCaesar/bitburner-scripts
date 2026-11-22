/**
 * Vite config for the repo's HTML tools (the pages linked from index.html).
 *
 *   pnpm run tools        ->  http://localhost:5173/  (dev server + IPvGO backend)
 *   pnpm run tools:build  ->  dist/tools/ (static site, same pages)
 *
 * Deliberately separate from vite.config.mts, which is the viteburner dev server that syncs src/
 * into the game: viewing a tool should not require the game to be running.
 *
 * How a tool updates while you edit it:
 *
 *   - every page is served through Vite, so the injected client reloads the tab when the HTML
 *     changes, and when a module it imports changes (a .ts model, a worker, the shared UI kit);
 *   - pages import their model sources directly (bench/stock/stockBenchCore.ts,
 *     bench/koth/kingOfTheHillCore.ts) instead of a pre-bundled copy, so there is one copy of
 *     each model on disk and no rebuild step in the way;
 *   - /api and /health are proxied to ipvgo-engine/server.js, so the IPvGO bench page runs from
 *     this origin against its own backend, unmodified.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin } from "vite"

const repoRoot = dirname(fileURLToPath(import.meta.url))
const BACKEND_PORT = Number(process.env.IPVGO_PORT ?? 3010)
const PORT = Number(process.env.HTML_TOOLS_PORT ?? 5173)

/** The IPvGO bench talks to its own server; these paths are proxied so the page needs no change. */
const BACKEND_PROXY = {
  "/api": { target: `http://localhost:${BACKEND_PORT}`, changeOrigin: true },
  "/health": { target: `http://localhost:${BACKEND_PORT}`, changeOrigin: true },
}

/**
 * The IPvGO bench page is also served at /bench, the address it has on its own server. In dev the
 * request is rewritten to the real file, so Vite keeps it in the module graph and an edit reloads
 * the tab; in a build the same page is emitted under bench/ so the static output answers it too.
 */
function benchAlias(): Plugin {
  const rewrite = (req: { url?: string }) => {
    if (req.url === "/bench" || req.url?.startsWith("/bench?")) {
      req.url = "/bench/index.html"
    }
  }
  return {
    name: "tools-bench-alias",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/bench" || req.url?.startsWith("/bench?")) {
          req.url = "/ipvgo-engine/web/bench.html"
        }
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req)
        next()
      })
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "bench/index.html",
        source: readFileSync(resolve(repoRoot, "ipvgo-engine", "web", "bench.html")),
      })
    },
  }
}

export default defineConfig({
  root: repoRoot,
  plugins: [benchAlias()],
  resolve: {
    // The model sources import "@/libraries/..." like the game scripts do.
    alias: { "@": resolve(repoRoot, "src") },
  },
  server: {
    port: PORT,
    strictPort: true,
    proxy: BACKEND_PROXY,
    watch: {
      // The native engine and its build tree are not page inputs.
      ignored: ["**/out/**", "**/ipvgo-engine/third_party/**", "**/ipvgo-engine/temp/**"],
    },
  },
  preview: {
    port: PORT,
    strictPort: true,
    proxy: BACKEND_PROXY,
  },
  build: {
    outDir: resolve(repoRoot, "dist", "tools"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(repoRoot, "index.html"),
        stock: resolve(repoRoot, "bench/stock/stockTraderViz.html"),
        koth: resolve(repoRoot, "bench/koth/kingOfTheHillViz.html"),
        // The IPvGO bench page is emitted by benchAlias() under bench/, not as a rollup input:
        // it is a self-contained page whose script the server owns.
      },
    },
  },
})
