/**
 * Static server for the repo's HTML tools, so they share one origin and one landing page.
 *
 *   pnpm run tools        ->  http://localhost:8123/  (serves the root index.html)
 *   HTML_TOOLS_PORT=9000 pnpm run tools
 *
 * Serves the repo root, which lets the tool pages reach their sibling .mjs files.
 * The IPvGO bench is not served here: it needs ipvgo-engine/server.js for its /api routes.
 */

import { createServer } from "node:http"
import { createReadStream, existsSync, statSync } from "node:fs"
import { dirname, extname, join, normalize, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")
const PORT = Number(process.env.HTML_TOOLS_PORT ?? 8123)

/** Never publish installed or build output, even though the server is repo-rooted. */
const BLOCKED = ["node_modules", "out", "dist", "cmake-build", "ipvgo-engine/third_party", ".git"]

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers })
  res.end(body)
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "method not allowed", { "Content-Type": "text/plain; charset=utf-8" })
    return
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname
  const filePath = normalize(join(ROOT, decodeURIComponent(pathname)))
  const relative = filePath.slice(ROOT.length).replace(/^[\\/]/, "").split(sep).join("/")

  if (!filePath.startsWith(ROOT + sep) || BLOCKED.some((dir) => relative === dir || relative.startsWith(`${dir}/`))) {
    send(res, 403, "forbidden", { "Content-Type": "text/plain; charset=utf-8" })
    return
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    send(res, 404, "not found", { "Content-Type": "text/plain; charset=utf-8" })
    return
  }

  res.writeHead(200, {
    "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  })
  if (req.method === "HEAD") {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
})

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[tools] port ${PORT} is already in use - is another server running?`)
    console.error("[tools] stop it, or set HTML_TOOLS_PORT to a free port")
  } else {
    console.error(`[tools] ${err.message}`)
  }
  process.exit(1)
})

server.listen(PORT, () => {
  console.log(`HTML tools  http://localhost:${PORT}/  (index.html at the repo root)`)
  console.log(`Serving ${ROOT}  (ctrl-c to stop)`)
  if (!existsSync(join(ROOT, "index.html"))) console.log("warning: index.html is missing at the repo root")
  console.log("IPvGO bench lives on its own server: pnpm run server  ->  http://localhost:3010/bench")
})
