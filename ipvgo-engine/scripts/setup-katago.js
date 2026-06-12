/**
 * Download KataGo binary + neural nets for IPvGO.
 * Run from repo root: pnpm run ipvgo:setup
 */

import { createWriteStream } from "fs"
import fs from "fs"
import { execSync } from "child_process"
import http from "http"
import https from "https"
import path from "path"
import { fileURLToPath } from "url"
import { pipeline } from "stream/promises"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENGINE_DIR = path.join(__dirname, "..")
const KATAGO_DIR = path.join(ENGINE_DIR, "katago")
const MODELS_DIR = path.join(KATAGO_DIR, "models")

const DOWNLOADS = {
  windows: {
    katagoZip:
      "https://github.com/lightvector/KataGo/releases/download/v1.16.5/katago-v1.16.5-cuda12.5-cudnn8.9.7-windows-x64.zip",
    katagoZipFallback:
      "https://github.com/lightvector/KataGo/releases/download/v1.16.5/katago-v1.16.5-opencl-windows-x64.zip",
  },
  linux: {
    katagoZip:
      "https://github.com/lightvector/KataGo/releases/download/v1.16.5/katago-v1.16.5-cuda12.5-cudnn8.9.7-linux-x64.zip",
    katagoZipFallback:
      "https://github.com/lightvector/KataGo/releases/download/v1.16.5/katago-v1.16.5-opencl-linux-x64.zip",
  },
}

const MODEL_URLS = {
  main: "https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9937771520-d4300882049.bin.gz",
  nine: "https://media.katagotraining.org/uploaded/networks/models_extra/kata9x9-b18c384nbt-20231025.bin.gz",
}

function log(msg) {
  console.log(`[ipvgo:setup] ${msg}`)
}

async function download(url, dest) {
  if (fs.existsSync(dest)) {
    log(`skip (exists): ${path.basename(dest)}`)
    return
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true })
  log(`download: ${url}`)
  log(`       -> ${dest}`)

  await new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const client = url.startsWith("https") ? https : http

    const request = client.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        download(response.headers.location, dest).then(resolve).catch(reject)
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} for ${url}`))
        return
      }

      const total = Number(response.headers["content-length"] ?? 0)
      let received = 0
      response.on("data", (chunk) => {
        received += chunk.length
        if (total > 0 && received % (5 * 1024 * 1024) < chunk.length) {
          const pct = ((received / total) * 100).toFixed(0)
          process.stdout.write(`\r[ipvgo:setup] ${path.basename(dest)}: ${pct}%`)
        }
      })

      pipeline(response, file)
        .then(() => {
          process.stdout.write("\n")
          resolve()
        })
        .catch(reject)
    })

    request.on("error", reject)
  })
}

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  if (process.platform === "win32") {
    const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
    execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: "inherit" })
    return
  }
  execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "inherit" })
}

function copyKatagoBundle(sourceDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    fs.copyFileSync(path.join(sourceDir, entry.name), path.join(destDir, entry.name))
  }
}

function katagoRuns(exePath, cwd) {
  try {
    const out = execSync(`"${exePath}" version`, { cwd, encoding: "utf8", timeout: 15000 })
    return out.includes("KataGo")
  } catch {
    return false
  }
}

function findKatagoBundleDir(root) {
  const names = process.platform === "win32" ? ["katago.exe"] : ["katago"]
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (names.includes(entry.name)) return dir
    }
  }
  return null
}

async function installKatagoFromZip(url, label) {
  const zipDest = path.join(KATAGO_DIR, "katago-download.zip")
  const extractDir = path.join(KATAGO_DIR, "_extract")

  if (fs.existsSync(zipDest)) fs.unlinkSync(zipDest)
  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })

  await download(url, zipDest)
  extractZip(zipDest, extractDir)

  const bundleDir = findKatagoBundleDir(extractDir)
  if (!bundleDir) throw new Error(`katago binary not found in ${label} zip`)

  copyKatagoBundle(bundleDir, KATAGO_DIR)

  const exe = path.join(KATAGO_DIR, process.platform === "win32" ? "katago.exe" : "katago")
  if (!katagoRuns(exe, KATAGO_DIR)) {
    throw new Error(`${label} KataGo build does not run (missing GPU drivers or DLLs)`)
  }

  log(`installed ${label} build -> ${KATAGO_DIR}`)
  fs.unlinkSync(zipDest)
  fs.rmSync(extractDir, { recursive: true, force: true })
}

async function setupKatagoBinary() {
  const exe = path.join(KATAGO_DIR, process.platform === "win32" ? "katago.exe" : "katago")
  if (fs.existsSync(exe) && katagoRuns(exe, KATAGO_DIR)) {
    log(`skip binary (exists and runs): ${exe}`)
    return
  }

  const platform = process.platform === "win32" ? "windows" : "linux"
  if (platform !== "windows" && platform !== "linux") {
    throw new Error(`Unsupported platform: ${process.platform}`)
  }

  const candidates = [
    { label: "CUDA", url: DOWNLOADS[platform].katagoZip },
    { label: "OpenCL", url: DOWNLOADS[platform].katagoZipFallback },
  ]

  let lastError = null
  for (const candidate of candidates) {
    try {
      await installKatagoFromZip(candidate.url, candidate.label)
      return
    } catch (err) {
      lastError = err
      log(`${candidate.label} install failed: ${err.message}`)
    }
  }

  throw lastError ?? new Error("Failed to install KataGo")
}

async function setupModels() {
  await download(MODEL_URLS.main, path.join(MODELS_DIR, "main.bin.gz"))
  await download(MODEL_URLS.nine, path.join(MODELS_DIR, "nine.bin.gz"))
}

function installAnalysisConfig() {
  const source = path.join(ENGINE_DIR, "katago-analysis.cfg")
  const dest = path.join(KATAGO_DIR, "analysis.cfg")
  if (!fs.existsSync(source)) {
    throw new Error(`Missing KataGo analysis config: ${source}`)
  }
  fs.copyFileSync(source, dest)
  log(`installed analysis.cfg -> ${dest}`)
}

async function main() {
  fs.mkdirSync(KATAGO_DIR, { recursive: true })
  fs.mkdirSync(MODELS_DIR, { recursive: true })

  await setupKatagoBinary()
  await setupModels()
  installAnalysisConfig()

  log("done")
  log(`KataGo: ${path.join(KATAGO_DIR, process.platform === "win32" ? "katago.exe" : "katago")}`)
  log(`Models: ${MODELS_DIR}`)
  log("Start server: pnpm run server")
}

main().catch((err) => {
  console.error("[ipvgo:setup] failed:", err.message)
  process.exit(1)
})
