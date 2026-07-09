/**
 * Local JSON API for IPvGO move search.
 * Prefers KataGo (GPU) when installed; falls back to native C++ MCTS.
 */

import { execFile } from "child_process"
import fs from "fs"
import http from "http"
import path from "path"
import { fileURLToPath } from "url"
import { isKatagoInstalled, requestKatagoMove, cancelKatagoRequest, shutdownKatago, warmupKatago } from "./katagoBridge.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.IPVGO_PORT ?? 3010)
const maxBodyBytes = 4 * 1024 * 1024
const forceNative = process.env.IPVGO_FORCE_NATIVE === "1"
const forceMcgs = process.env.IPVGO_ENGINE === "mcgs"
// Trained PyTorch agent served by python/serve.py. Opt in with IPVGO_ENGINE=torch
// (or IPVGO_FORCE_TORCH=1); it then takes priority over KataGo/native.
const torchUrl = process.env.IPVGO_TORCH_URL ?? "http://127.0.0.1:3011"
const forceTorch = process.env.IPVGO_ENGINE === "torch" || process.env.IPVGO_FORCE_TORCH === "1"

/** @type {import("child_process").ChildProcess | null} */
let activeNativeChild = null

function nativeExecutablePath() {
  const isWindows = process.platform === "win32"
  return isWindows
    ? path.join(__dirname, "build", "Release", "ipvgo_engine.exe")
    : path.join(__dirname, "build", "ipvgo_engine")
}

function mcgsExecutablePath() {
  const isWindows = process.platform === "win32"
  return isWindows
    ? path.join(__dirname, "build", "Release", "ipvgo_game.exe")
    : path.join(__dirname, "build", "ipvgo_game")
}

function activeEngine() {
  if (forceMcgs) return "mcgs"
  if (forceTorch) return "torch"
  if (!forceNative && isKatagoInstalled()) return "katago"
  const exe = nativeExecutablePath()
  if (fs.existsSync(exe)) return "native"
  return "missing"
}

async function requestTorchMove(body) {
  const res = await fetch(`${torchUrl}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `torch engine HTTP ${res.status}`)
  }
  const result = await res.json()
  return { ...result, engine: "torch" }
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
    torch: forceTorch,
    torchUrl,
    nativePath: nativeExecutablePath(),
    nativeBuilt: fs.existsSync(nativeExecutablePath()),
    mcgsPath: mcgsExecutablePath(),
    mcgsBuilt: fs.existsSync(mcgsExecutablePath()),
    timestamp: new Date().toISOString(),
  })
}

async function requestMcgsMove(body) {
  const exe = mcgsExecutablePath()
  if (!fs.existsSync(exe)) {
    throw new Error("MCGS engine not built. Run: pnpm run ipvgo:build")
  }

  const tempDir = path.join(__dirname, "temp")
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  const inputPath = path.join(tempDir, `mcgs-in-${Date.now()}.json`)
  const outputPath = path.join(tempDir, `mcgs-out-${Date.now()}.json`)
  fs.writeFileSync(inputPath, JSON.stringify(body))

  return new Promise((resolve, reject) => {
    const child = execFile(
      exe,
      ["mcgsmove", inputPath, outputPath],
      { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (activeNativeChild === child) activeNativeChild = null
        try {
          if (error) {
            if (error.killed || error.signal) {
              reject(new Error("MCGS engine cancelled"))
              return
            }
            reject(new Error(`${error.message}${stderr ? `: ${stderr}` : ""}`))
            return
          }
          if (!fs.existsSync(outputPath)) {
            reject(new Error("MCGS produced no output file"))
            return
          }
          const result = JSON.parse(fs.readFileSync(outputPath, "utf8"))
          resolve({ ...result, engine: "mcgs" })
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
      }
    )
    activeNativeChild = child
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
    const child = execFile(
      exe,
      [inputPath, outputPath],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (activeNativeChild === child) activeNativeChild = null
        try {
          if (error) {
            if (error.killed || error.signal) {
              reject(new Error("Native engine cancelled"))
              return
            }
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
      }
    )
    activeNativeChild = child
  })
}

function cancelNativeMove() {
  if (activeNativeChild && !activeNativeChild.killed) {
    activeNativeChild.kill()
    activeNativeChild = null
  }
}

async function handleCancel(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: err.message })
  }

  const requestId = body?.requestId
  if (!requestId || typeof requestId !== "string") {
    return sendJson(res, 400, { error: "requestId required" })
  }

  const engine = activeEngine()
  if (engine === "katago") {
    cancelKatagoRequest(requestId)
  } else if (engine === "native" || engine === "mcgs") {
    cancelNativeMove()
  }

  sendJson(res, 200, { ok: true, requestId })
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
    const result =
      engine === "torch"
        ? await requestTorchMove(body)
        : engine === "katago"
          ? await requestKatagoMove(body)
          : engine === "mcgs"
            ? await requestMcgsMove(body)
            : await requestNativeMove(body)
    sendJson(res, 200, result)
  } catch (err) {
    console.error(`${engine} move error:`, err.message)
    if (engine === "katago" || engine === "torch") {
      try {
        const fallback = await requestNativeMove(body)
        return sendJson(res, 200, { ...fallback, engine: "native", [`${engine}Error`]: err.message })
      } catch (nativeErr) {
        return sendJson(res, 500, { error: err.message, fallbackError: nativeErr.message })
      }
    }
    return sendJson(res, 500, { error: err.message })
  }
}

/**
 * Receives parity test cases dumped from the live game (ipvgoParityDump.js) and
 * writes them to temp/parity_cases.json for the native `ipvgo_game parity` tool.
 */
async function handleParityDump(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: err.message })
  }

  const cases = Array.isArray(body) ? body : body?.cases
  if (!Array.isArray(cases)) {
    return sendJson(res, 400, { error: "Expected an array of parity cases (or { cases: [...] })" })
  }

  const tempDir = path.join(__dirname, "temp")
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
  const outPath = path.join(tempDir, "parity_cases.json")
  fs.writeFileSync(outPath, JSON.stringify(cases))
  console.log(`[parity] wrote ${cases.length} cases to ${outPath}`)
  sendJson(res, 200, { ok: true, count: cases.length, path: outPath })
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

  if (req.method === "POST" && url.pathname === "/api/ipvgo/cancel") {
    await handleCancel(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/ipvgo/move") {
    await handleMove(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/ipvgo/parity") {
    await handleParityDump(req, res)
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
