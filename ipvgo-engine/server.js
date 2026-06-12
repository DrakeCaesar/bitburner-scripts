/**
 * Local JSON API for IPvGO move search.
 * Prefers KataGo (GPU) when installed; falls back to native C++ MCTS.
 */

import { execFile } from "child_process"
import fs from "fs"
import http from "http"
import path from "path"
import { fileURLToPath } from "url"
import { isKatagoInstalled, requestKatagoMove, shutdownKatago, warmupKatago } from "./katagoBridge.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.IPVGO_PORT ?? 3010)
const maxBodyBytes = 4 * 1024 * 1024
const forceNative = process.env.IPVGO_FORCE_NATIVE === "1"

function nativeExecutablePath() {
  const isWindows = process.platform === "win32"
  return isWindows
    ? path.join(__dirname, "build", "Release", "ipvgo_engine.exe")
    : path.join(__dirname, "build", "ipvgo_engine")
}

function activeEngine() {
  if (!forceNative && isKatagoInstalled()) return "katago"
  const exe = nativeExecutablePath()
  if (fs.existsSync(exe)) return "native"
  return "missing"
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
  const engine = activeEngine()
  sendJson(res, 200, {
    status: "ok",
    engine,
    katago: isKatagoInstalled(),
    nativePath: nativeExecutablePath(),
    nativeBuilt: fs.existsSync(nativeExecutablePath()),
    timestamp: new Date().toISOString(),
  })
}

async function requestNativeMove(body) {
  const exe = nativeExecutablePath()
  if (!fs.existsSync(exe)) {
    throw new Error("Native engine not built. Run: pnpm run ipvgo:build")
  }

  const tempDir = path.join(__dirname, "temp")
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  const inputPath = path.join(tempDir, `input-${Date.now()}.json`)
  const outputPath = path.join(tempDir, `output-${Date.now()}.json`)

  fs.writeFileSync(inputPath, JSON.stringify(body))

  return new Promise((resolve, reject) => {
    execFile(exe, [inputPath, outputPath], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
      try {
        if (error) {
          reject(new Error(`${error.message}${stderr ? `: ${stderr}` : ""}`))
          return
        }
        if (!fs.existsSync(outputPath)) {
          reject(new Error("Engine produced no output file"))
          return
        }
        const result = JSON.parse(fs.readFileSync(outputPath, "utf8"))
        resolve({ ...result, engine: "native" })
      } catch (err) {
        reject(err)
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
  })
}

async function handleMove(req, res) {
  const engine = activeEngine()
  if (engine === "missing") {
    return sendJson(res, 503, {
      error: "No engine available. Run: pnpm run ipvgo:setup && pnpm run ipvgo:build",
    })
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: err.message })
  }

  try {
    const result = engine === "katago" ? await requestKatagoMove(body) : await requestNativeMove(body)
    sendJson(res, 200, result)
  } catch (err) {
    console.error(`${engine} move error:`, err.message)
    if (engine === "katago") {
      try {
        const fallback = await requestNativeMove(body)
        return sendJson(res, 200, { ...fallback, engine: "native", katagoError: err.message })
      } catch (nativeErr) {
        return sendJson(res, 500, { error: err.message, fallbackError: nativeErr.message })
      }
    }
    return sendJson(res, 500, { error: err.message })
  }
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
  const engine = activeEngine()
  console.log(`IPvGO engine server http://localhost:${port}`)
  console.log(`Active engine: ${engine}`)
  console.log(`Health: http://localhost:${port}/health`)
  console.log(`Move API: POST http://localhost:${port}/api/ipvgo/move`)

  if (engine === "katago") {
    warmupKatago().catch((err) => {
      console.error("[katago] warmup failed:", err.message)
    })
  }
})

process.on("SIGINT", () => {
  shutdownKatago()
  process.exit(0)
})

process.on("SIGTERM", () => {
  shutdownKatago()
  process.exit(0)
})
