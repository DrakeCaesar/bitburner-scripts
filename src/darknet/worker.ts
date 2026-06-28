import { NS } from "@ns"
import {
  DARKNET_CRAWL_SCRIPT,
  DARKWEB_ARCHIVE_DIR,
  CONTROL_PORT,
  TASK_PORT,
  WORKER_MODE_ARG,
  isLoreFile,
  isPasswordFile,
  flatFileName,
  tryConnectToSession,
  type ControlMessage,
  type DarknetCrawlApi,
  type DarknetServerDetailsForFormulas,
  type CrawlHostReport,
  type CrawlStatusReport,
  type CrawlCacheOpen,
  type TaskMessage,
  DARKNET_WORKER_FILES,
} from "./config"
import {
  writeCrawlReport,
  writeCrawlStatus,
} from "./auth"

// ---- file type helpers ----

export function isCacheFile(fileName: string): boolean {
  return flatFileName(fileName).endsWith(".cache")
}

// ---- text-file json merge (replaces per-file archiving) ----

export function loadDarknetTextSet(ns: NS, file: string): Set<string> {
  if (!ns.fileExists(file, "home")) return new Set()
  try {
    const parsed: unknown = JSON.parse(ns.read(file))
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === "string"))
  } catch {
    return new Set()
  }
}

export function syncDarknetTextFile(ns: NS, file: string, textSet: Set<string>): void {
  const sorted = [...textSet].sort()
  ns.write(file, JSON.stringify(sorted, null, 2), "w")
}

// ---- per-file archive (non-journaling .txt / .lit files) ----

function archiveDestPath(fileName: string, suffix: number | null): string {
  const base = flatFileName(fileName)
  if (suffix === null) {
    return `${DARKWEB_ARCHIVE_DIR}/${base}`
  }
  const dot = base.lastIndexOf(".")
  if (dot <= 0) {
    return `${DARKWEB_ARCHIVE_DIR}/${base}.${suffix}`
  }
  const stem = base.slice(0, dot)
  const ext = base.slice(dot)
  return `${DARKWEB_ARCHIVE_DIR}/${stem}.${suffix}${ext}`
}

function listArchivePaths(ns: NS, fileName: string): string[] {
  const paths: string[] = []
  const basePath = archiveDestPath(fileName, null)
  if (ns.fileExists(basePath, "home")) {
    paths.push(basePath)
  }
  let suffix = 1
  while (true) {
    const path = archiveDestPath(fileName, suffix)
    if (!ns.fileExists(path, "home")) {
      break
    }
    paths.push(path)
    suffix++
  }
  return paths
}

function resolveArchiveWritePath(ns: NS, fileName: string, content: string): string | null {
  for (const path of listArchivePaths(ns, fileName)) {
    if (ns.read(path) === content) {
      return null
    }
  }
  let suffix: number | null = null
  while (true) {
    const path = archiveDestPath(fileName, suffix)
    if (!ns.fileExists(path, "home")) {
      return path
    }
    suffix = suffix === null ? 1 : suffix + 1
  }
}

export function finalizeArchiveContent(ns: NS, fileName: string, content: string): void {
  const destPath = resolveArchiveWritePath(ns, fileName, content)
  if (destPath === null) {
    return
  }
  ns.write(destPath, content, "w")
}

// ---- password file content parsing ----

const COMMON_PASSWORDS_PREFIX_NOSPACE = "Some common passwords include"
const REMEMBER_PASSWORD_RE = /^Remember this password:\s*(\S+)/im
const EXPLICIT_PASSWORD_RE = /^Server:\s+(.+?)\s+Password:\s*"(\S+?)"/gm
const HOST_HINT_RE = /^The password for (.+?) contains (\d+)\s+and\s+(\d+)/gm

interface PasswordFileIntel {
  kind: "explicit" | "remember" | "hint"
  /** Target hostname (null for "remember" — we don't know which neighbor yet). */
  host: string | null
  password: string | null
  /** Sorted unique hint digits/letters. */
  chars: string | null
}

function parsePasswordFileContent(
  content: string,
  sourceHost: string,
  neighbors: string[],
  timestamp: number
): { cleanContent: string; intel: PasswordFileIntel[]; intelJson: string } {
  const intel: PasswordFileIntel[] = []
  const lines = content.split("\n")
  const cleanLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Type 1 — discard common password lists
    if (trimmed.startsWith(COMMON_PASSWORDS_PREFIX_NOSPACE)) {
      continue
    }

    // Type 2 — "Remember this password: XXXX"
    const rememberMatch = REMEMBER_PASSWORD_RE.exec(trimmed)
    if (rememberMatch) {
      const pw = rememberMatch[1]!
      intel.push({ kind: "remember", host: null, password: pw, chars: null })
      cleanLines.push(line)
      continue
    }

    // Type 3 — "Server: HOST Password: \"PW\""
    EXPLICIT_PASSWORD_RE.lastIndex = 0
    const explicitMatch = EXPLICIT_PASSWORD_RE.exec(trimmed)
    if (explicitMatch) {
      intel.push({ kind: "explicit", host: explicitMatch[1]!.trim(), password: explicitMatch[2]!, chars: null })
      cleanLines.push(line)
      continue
    }

    // Type 4 — "The password for HOST contains X and Y"
    HOST_HINT_RE.lastIndex = 0
    const hintMatch = HOST_HINT_RE.exec(trimmed)
    if (hintMatch) {
      const chars = [...new Set([hintMatch[2]!, hintMatch[3]!])].sort().join("")
      intel.push({ kind: "hint", host: hintMatch[1]!.trim(), password: null, chars })
      cleanLines.push(line)
      continue
    }

    cleanLines.push(line)
  }

  const cleanContent = cleanLines.join("\n")
  const intelJson = JSON.stringify({
    type: "passwordIntel",
    sourceHost,
    neighbors,
    timestamp,
    entries: intel,
  })

  return { cleanContent, intel, intelJson }
}

export function queueArchiveContent(
  ns: NS,
  fileName: string,
  content: string,
  reportPort: number | undefined,
  lorePort: number | undefined,
  neighbors: string[] | undefined
): void {
  if (isLoreFile(flatFileName(fileName))) {
    // journaling files go to lore port → darknet-lore.json
    if (lorePort != null && lorePort > 0) {
      ns.writePort(lorePort, content)
    }
    return
  }

  // password files: extract intel for registry, do NOT archive to disk
  if (isPasswordFile(flatFileName(fileName))) {
    const hostname = ns.getHostname()
    const { intelJson } = parsePasswordFileContent(content, hostname, neighbors ?? [], Date.now())
    if (reportPort != null && reportPort > 0) {
      ns.writePort(reportPort, intelJson)
    }
    return
  }

  // other files: store as-is, no parsing
  const base = flatFileName(fileName)
  const hostname = ns.getHostname()

  if (hostname === "home") {
    finalizeArchiveContent(ns, base, content)
    return
  }

  if (reportPort != null && reportPort > 0) {
    ns.writePort(reportPort, JSON.stringify({ type: "archive", file: base, content }))
  }
}

export function reportCacheOpen(
  ns: NS,
  host: string,
  fileName: string,
  result: { message: string; karmaLoss: number },
  reportPort: number | undefined,
  lorePort: number | undefined,
  cacheOpens?: CrawlCacheOpen[]
): void {
  const entry: CrawlCacheOpen = {
    host,
    file: flatFileName(fileName),
    message: result.message,
    karmaLoss: result.karmaLoss,
    openedAt: Date.now(),
  }

  cacheOpens?.push(entry)

  if (reportPort != null && reportPort > 0) {
    ns.writePort(reportPort, JSON.stringify({ type: "cacheOpen", ...entry }))
  }
  // cache messages are lore snippets, not password data
  if (lorePort != null && lorePort > 0) {
    ns.writePort(lorePort, result.message)
  }
}

async function openCacheFilesOnCurrentHost(
  ns: NS,
  dnet: DarknetCrawlApi,
  reportPort: number | undefined,
  lorePort: number | undefined,
  neighbors: string[] | undefined,
  cacheOpens?: CrawlCacheOpen[]
): Promise<void> {
  const hostname = ns.getHostname()
  let files: string[]
  try {
    files = ns.ls(hostname)
  } catch {
    return
  }

  for (const file of files) {
    if (!isCacheFile(file)) {
      continue
    }
    const result = dnet.openCache(file, true)
    if (!result.success) {
      continue
    }
    reportCacheOpen(ns, hostname, file, result, reportPort, lorePort, cacheOpens)
  }
}

async function archiveLocalServerFiles(
  ns: NS,
  dnet: DarknetCrawlApi,
  reportPort?: number,
  lorePort?: number,
  neighbors?: string[],
  cacheOpens?: CrawlCacheOpen[]
): Promise<void> {
  const hostname = ns.getHostname()
  let files: string[]
  try {
    files = ns.ls(hostname)
  } catch {
    return
  }

  for (const file of files) {
    const ext = flatFileName(file).split(".").pop()
    switch (ext) {
      case "lit":
      case "txt":
        if (!ns.fileExists(file)) break
        queueArchiveContent(ns, flatFileName(file), ns.read(file), reportPort, lorePort, neighbors)
        break
    }
  }

  await openCacheFilesOnCurrentHost(ns, dnet, reportPort, lorePort, neighbors, cacheOpens)
}

// ---- worker spawn helpers ----

export async function copyCrawlScript(ns: NS, target: string, source: string): Promise<void> {
  for (const file of DARKNET_WORKER_FILES) {
    if (!ns.fileExists(file, source)) {
      throw new Error(`${file} not found on ${source}`)
    }
    if (!ns.scp(file, target, source)) {
      throw new Error(`Failed to scp ${file} to ${target} from ${source}`)
    }
  }
}

export function crawlWorkerArgs(sessionId: number, selfPassword?: string): (string | number)[] {
  const args: (string | number)[] = [WORKER_MODE_ARG, sessionId]
  if (selfPassword !== undefined) {
    args.push(selfPassword)
  }
  return args
}

export async function ensureFreeRam(ns: NS, dnet: DarknetCrawlApi, host: string): Promise<void> {
  const details = dnet.getServerDetails(host)
  if (details.blockedRam <= 0) {
    return
  }

  while (true) {
    try {
      const result = await ns.dnet.memoryReallocation(host)
      if (!result.success) {
        break
      }
    } catch {
      return
    }
    const updated = dnet.getServerDetails(host)
    if (updated.blockedRam <= 0) {
      return
    }
  }
}

async function spawnCrawlWorkerOnHost(
  ns: NS,
  host: string,
  sessionId: number,
  assetSource: string,
  selfPassword?: string
): Promise<number> {
  // Prevent duplicate workers — isRunning is the last line of defense
  if (ns.isRunning(DARKNET_CRAWL_SCRIPT, host)) {
    return 0
  }
  await copyCrawlScript(ns, host, assetSource)
  const workerRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, host)
  const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
  if (workerRam > freeRam) {
    return 0
  }
  return ns.exec(
    DARKNET_CRAWL_SCRIPT,
    host,
    1,
    ...crawlWorkerArgs(sessionId, selfPassword)
  )
}

// ---- session helpers ----

export async function ensureSessionOnSelf(
  ns: NS,
  dnet: DarknetCrawlApi,
  passwordCache: Map<string, string>
): Promise<void> {
  const hostname = ns.getHostname()
  if (dnet.getServerDetails(hostname).hasSession) {
    return
  }
  const password = passwordCache.get(hostname)
  if (password == null) {
    return
  }
  if (tryConnectToSession(dnet, hostname, password)) {
    return
  }
  await dnet.authenticate(hostname, password)
}

function safeGetSessionDetails(
  dnet: DarknetCrawlApi,
  host: string
): DarknetServerDetailsForFormulas | null {
  try {
    return dnet.getServerDetails(host)
  } catch {
    return null
  }
}

// ---- crawl pass ----

/** Execute a single task and report the result back to the master. */
async function executeTask(
  ns: NS,
  dnet: DarknetCrawlApi,
  task: TaskMessage,
  reportPort: number,
): Promise<void> {
  const hostname = ns.getHostname()

  if (task.type === "guess") {
    try {
      const result = await dnet.authenticate(task.target, task.guess)
      if (result.success) {
        ns.writePort(reportPort, JSON.stringify({
          type: "guessResult",
          target: task.target,
          solverId: task.solverId,
          success: true,
          feedback: typeof result.data === "string" ? result.data : undefined,
        }))
        return
      }
      // Scrape heartbleed for feedback (most interactive solvers need this)
      let feedback: string | undefined
      let message: string | undefined
      try {
        const hb = await dnet.heartbleed(task.target, { peek: true })
        if (hb.success && hb.logs.length > 0) {
          // Find the log entry for this specific guess attempt
          for (const log of hb.logs) {
            try {
              const entry: unknown = JSON.parse(log)
              if (typeof entry === "object" && entry !== null) {
                const e = entry as Record<string, unknown>
                if (e.passwordAttempted === task.guess) {
                  feedback = typeof e.data === "string" ? e.data : undefined
                  message = typeof e.message === "string" ? e.message : undefined
                  break
                }
              }
            } catch { /* ignore unparseable */ }
          }
          // Fallback: use the last log entry's data if specific match not found
          if (feedback === undefined && message === undefined) {
            try {
              const lastEntry: unknown = JSON.parse(hb.logs[hb.logs.length - 1]!)
              if (typeof lastEntry === "object" && lastEntry !== null) {
                const e = lastEntry as Record<string, unknown>
                feedback = typeof e.data === "string" ? e.data : undefined
                message = typeof e.message === "string" ? e.message : undefined
              }
            } catch { /* ignore */ }
          }
        }
      } catch { /* heartbleed may fail */ }
      ns.writePort(reportPort, JSON.stringify({
        type: "guessResult",
        target: task.target,
        solverId: task.solverId,
        success: false,
        feedback,
        message,
      }))
    } catch {
      ns.writePort(reportPort, JSON.stringify({
        type: "guessResult",
        target: task.target,
        solverId: task.solverId,
        success: false,
      }))
    }
  } else if (task.type === "heartbleed") {
    try {
      const result = await dnet.heartbleed(task.target)
      ns.writePort(reportPort, JSON.stringify({
        type: "heartbleedResult",
        target: task.target,
        solverId: task.solverId,
        logEntries: result.success ? result.logs : [],
      }))
    } catch {
      ns.writePort(reportPort, JSON.stringify({
        type: "heartbleedResult",
        target: task.target,
        solverId: task.solverId,
        logEntries: [],
      }))
    }
  } else if (task.type === "labreport") {
    try {
      if (dnet.labreport) {
        const result = await dnet.labreport()
        ns.writePort(reportPort, JSON.stringify({
          type: "labreportResult",
          target: task.target,
          solverId: task.solverId,
          coords: result.coords,
          north: result.north, east: result.east,
          south: result.south, west: result.west,
        }))
      }
    } catch {
      // labreport might fail — master handles timeout
    }
  }
}

/** Poll TASK_PORT for up to maxTasks and execute them. */
async function pollAndExecuteTasks(
  ns: NS,
  dnet: DarknetCrawlApi,
  reportPort: number,
  maxTasks: number,
): Promise<void> {
  for (let i = 0; i < maxTasks; i++) {
    const raw = ns.peek(TASK_PORT)
    if (raw === "NULL PORT DATA") break
    ns.readPort(TASK_PORT)
    try {
      const task: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
      if (typeof task !== "object" || task === null) continue
      const t = task as Record<string, unknown>
      if (t.type !== "guess" && t.type !== "heartbleed" && t.type !== "labreport") continue
      if (typeof t.target !== "string" || typeof t.solverId !== "string") continue
      await executeTask(ns, dnet, t as TaskMessage, reportPort)
    } catch {
      // malformed task, skip
    }
  }
}

async function runOneCrawlPass(
  ns: NS,
  reportPort: number,
  lorePort: number,
  dnet: DarknetCrawlApi,
  passwordCache: Map<string, string>,
  sessionId: number,
): Promise<void> {
  const hostname = ns.getHostname()

  try {
    await ensureSessionOnSelf(ns, dnet, passwordCache)
  } catch {
    return
  }

  const selfDetails = safeGetSessionDetails(dnet, hostname)
  if (!selfDetails) return

  writeCrawlReport(ns, reportPort, {
    hostname,
    authenticated: selfDetails.hasSession ? true : null,
    password: null,
  })

  // Report worker idle — master needs to know we're available for tasks
  if (selfDetails.hasSession) {
    ns.writePort(reportPort, JSON.stringify({
      type: "workerIdle",
      workerHost: hostname,
    }))
  }

  // Poll TASK_PORT for tasks (guess/heartbleed/labreport)
  await pollAndExecuteTasks(ns, dnet, reportPort, 3)

  // Probe neighbors
  writeCrawlStatus(ns, reportPort, {
    workerHost: hostname,
    targetHost: hostname,
    phase: "probe",
    etaMs: 0,
    detail: null,
  })

  let neighbors: string[]
  try {
    neighbors = dnet.probe()
  } catch {
    return
  }

  // Report neighbors to master for task routing
  if (selfDetails.hasSession) {
    const workerRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, hostname)
    const freeRam = ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname)
    ns.writePort(reportPort, JSON.stringify({
      type: "neighbors",
      workerHost: hostname,
      targets: neighbors,
      freeRam: freeRam - workerRam, // remaining after our own instance
    }))
  }

  // Archive files after probe
  if (selfDetails.hasSession) {
    await archiveLocalServerFiles(ns, dnet, reportPort, lorePort, neighbors)
  }

  // Spawn children on authenticated neighbors (unchanged)
  for (const neighbor of neighbors) {
    const neighborDetails = safeGetSessionDetails(dnet, neighbor)
    if (!neighborDetails?.hasSession) continue

    // Report neighbor status to master
    writeCrawlReport(ns, reportPort, {
      hostname: neighbor,
      authenticated: true,
      password: null,
    })

    if (neighborDetails.blockedRam > 0) {
      await ensureFreeRam(ns, dnet, neighbor)
    }

    if (ns.isRunning(DARKNET_CRAWL_SCRIPT, neighbor)) continue

    writeCrawlStatus(ns, reportPort, {
      workerHost: hostname,
      targetHost: neighbor,
      phase: "spawn",
      etaMs: 0,
      detail: "recurse",
    })

    const workerRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, neighbor)
    const freeRam = ns.getServerMaxRam(neighbor) - ns.getServerUsedRam(neighbor)
    if (workerRam > freeRam) continue

    await spawnCrawlWorkerOnHost(
      ns, neighbor, sessionId, hostname,
      passwordCache.get(neighbor) ?? undefined,
    )
  }
}

// ---- worker entry ----

export async function runCrawlWorker(ns: NS): Promise<void> {
  const dnet = (ns as NS & { dnet?: DarknetCrawlApi }).dnet
  if (!dnet) {
    return
  }

  const mySessionId = Number(ns.args[1])
  if (!Number.isFinite(mySessionId) || mySessionId <= 0) {
    return
  }

  // Wait for master to write config to the control port
  while (true) {
    const raw = ns.peek(CONTROL_PORT)
    if (raw === "NULL PORT DATA") {
      await ns.sleep(2000)
      continue
    }

    let msg: ControlMessage
    try {
      msg = JSON.parse(raw as string) as ControlMessage
    } catch {
      await ns.sleep(2000)
      continue
    }

    if (typeof msg.sessionId !== "number" || msg.sessionId !== mySessionId) {
      // Different session — master restarted, terminate
      ns.exit()
    }

    if (typeof msg.reportPort === "number" && typeof msg.lorePort === "number") {
      const passwordCache = new Map<string, string>()
      const workerHost = ns.getHostname()
      // If parent passed a password via args, cache it so we can auth ourselves
      if (typeof ns.args[2] === "string" && ns.args[2].length > 0) {
        passwordCache.set(workerHost, ns.args[2])
      }
      while (true) {
        // Re-check control port each loop for session changes
        const checkRaw = ns.peek(CONTROL_PORT)
        if (checkRaw !== "NULL PORT DATA") {
          try {
            const checkMsg = JSON.parse(checkRaw as string) as ControlMessage
            if (typeof checkMsg.sessionId !== "number" || checkMsg.sessionId !== mySessionId) {
              ns.exit()
            }
          } catch {
            // malformed, ignore
          }
        }

        try {
          await runOneCrawlPass(ns, msg.reportPort, msg.lorePort, dnet, passwordCache, mySessionId)
        } catch {
          // probe/auth might fail if host changes — keep looping
        }
        await ns.sleep(500)
      }
    }

    await ns.sleep(200)
  }
}

// ---- entry ----

export async function main(ns: NS): Promise<void> {
  await runCrawlWorker(ns)
}
