/**
 * Local JSON API for the native IPvGO engine.
 * Run manually from a terminal (e.g. VS Code): pnpm run server
 * Bitburner ipvgo.js POSTs board state here and receives a move.
 */

import { execFile } from "child_process"
import fs from "fs"
import http from "http"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.IPVGO_PORT ?? 3010)
const maxBodyBytes = 4 * 1024 * 1024

function nativeExecutablePath() {
  const isWindows = process.platform === "win32"
  return isWindows
    ? path.join(__dirname, "build", "Release", "ipvgo_engine.exe")
    : path.join(__dirname, "build", "ipvgo_engine")
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  })
  res.end(payload)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on("data", (chunk) => {
      size += chunk.length
      if (size > maxBodyBytes) {
        reject(new Error("Request body too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8")
        resolve(text ? JSON.parse(text) : {})
      } catch (err) {
        reject(new Error(`Invalid JSON: ${err.message}`))
      }
    })
    req.on("error", reject)
  })
}

function handleHealth(_req, res) {
  const exe = nativeExecutablePath()
  sendJson(res, 200, {
    status: "ok",
    engine: fs.existsSync(exe) ? "native" : "missing",
    path: exe,
    timestamp: new Date().toISOString(),
  })
}

async function handleMove(req, res) {
  const exe = nativeExecutablePath()
  if (!fs.existsSync(exe)) {
    return sendJson(res, 503, {
      error: "Native engine not built. Run: cd ipvgo-engine && pnpm run build:native",
    })
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: err.message })
  }

  const tempDir = path.join(__dirname, "temp")
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  const inputPath = path.join(tempDir, `input-${Date.now()}.json`)
  const outputPath = path.join(tempDir, `output-${Date.now()}.json`)

  try {
    fs.writeFileSync(inputPath, JSON.stringify(body))
  } catch (err) {
    return sendJson(res, 400, { error: `Failed to write input: ${err.message}` })
  }

  execFile(exe, [inputPath, outputPath], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
    try {
      if (error) {
        console.error("ipvgo_engine error:", error.message, stderr)
        return sendJson(res, 500, { error: error.message, stderr: stderr?.toString() })
      }

      if (!fs.existsSync(outputPath)) {
        return sendJson(res, 500, { error: "Engine produced no output file" })
      }

      const result = JSON.parse(fs.readFileSync(outputPath, "utf8"))
      sendJson(res, 200, result)
    } catch (parseError) {
      sendJson(res, 500, { error: `Invalid engine output: ${parseError.message}` })
    } finally {
      for (const file of [inputPath, outputPath]) {
        try {
          if (fs.existsSync(file)) fs.unlinkSync(file)
        } catch {
          /* ignore */
        }
      }
    }
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    })
    res.end()
    return
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

  if (req.method === "GET" && url.pathname === "/health") {
    handleHealth(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/ipvgo/move") {
    await handleMove(req, res)
    return
  }

  sendJson(res, 404, { error: "Not found" })
})

server.listen(port, () => {
  console.log(`IPvGO engine server http://localhost:${port}`)
  console.log(`Health: http://localhost:${port}/health`)
  console.log(`Move API: POST http://localhost:${port}/api/ipvgo/move`)
})
