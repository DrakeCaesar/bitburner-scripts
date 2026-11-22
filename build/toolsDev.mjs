/**
 * One command for every HTML tool: starts the IPvGO backend and the Vite server, and stops both
 * when you press ctrl-c.
 *
 *   pnpm run tools            ->  http://localhost:5173/   (dev: reloads on edit)
 *   pnpm run tools:preview    ->  the built site in dist/tools, same backend
 *   HTML_TOOLS_PORT=9000 pnpm run tools
 *   IPVGO_PORT=3011 pnpm run tools    (moves the backend and the proxy with it)
 *
 * The backend is `ipvgo-engine/scripts/dev-server.mjs`, the same supervisor `pnpm run server:dev`
 * uses: it restarts server.js when the server, lib/ or scripts/ change and revives it if it
 * crashes. The bench *page* is not watched there (IPVGO_WATCH_WEB=0) because Vite owns it here,
 * so editing bench.html reloads the tab instead of restarting the server.
 */
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer, preview } from "vite"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..")
const BACKEND_PORT = Number(process.env.IPVGO_PORT ?? 3010)
const TOOLS_PORT = Number(process.env.HTML_TOOLS_PORT ?? 5173)
// --preview serves the built site (pnpm run tools:build) instead of the sources, and still
// supervises the backend so /api works there too.
const PREVIEW = process.argv.includes("--preview")

let backend = null
let stopping = false

function startBackend() {
  backend = spawn(process.execPath, [join(ROOT, "ipvgo-engine", "scripts", "dev-server.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, IPVGO_PORT: String(BACKEND_PORT), IPVGO_WATCH_WEB: "0" },
  })
  backend.on("exit", (code, signal) => {
    backend = null
    if (stopping) return
    console.error(`[tools] IPvGO backend exited (${signal ?? code}); tools still work, /api will not`)
  })
}

function stopBackend() {
  if (!backend) return
  const child = backend
  backend = null
  child.kill()
}

async function main() {
  startBackend()

  const configFile = join(HERE, "..", "vite.tools.config.mts")
  const server = PREVIEW ? await preview({ configFile }) : await createServer({ configFile })
  if (!PREVIEW) await server.listen()
  server.printUrls()
  console.log(`[tools] IPvGO backend on http://localhost:${BACKEND_PORT} (proxied as /api, /health)`)
  console.log(
    PREVIEW
      ? "[tools] serving dist/tools; ctrl-c stops both"
      : "[tools] editing a page or a model source reloads it; ctrl-c stops both"
  )

  const shutdown = async () => {
    if (stopping) return
    stopping = true
    stopBackend()
    await server.close().catch(() => {})
    await new Promise((resolve) => server.httpServer?.close(resolve) ?? resolve())
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((error) => {
  console.error(`[tools] ${error.message}`)
  stopBackend()
  process.exit(1)
})
