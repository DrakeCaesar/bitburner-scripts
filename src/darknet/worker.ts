import { NS } from "@ns"
import {
  DARKNET_CRAWL_SCRIPT,
  DARKNET_STASIS_SCRIPT,
  DARKWEB_ARCHIVE_DIR,
  CONTROL_PORT,
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
  type WorkerCommand,
  DARKNET_WORKER_FILES,
  DNET_DEBUG_RAW_API_CONSOLE,
  HEARTBLEED_AUTH_LOG_MAX_RETRIES,
  writeCrawlReport,
  writeCrawlStatus,
} from "./config"

function debugRawDnetApi(
  api: "authenticate" | "heartbleed",
  meta: Record<string, unknown>,
  raw: unknown,
): void {
  if (!DNET_DEBUG_RAW_API_CONSOLE) return
  console.log(`[dnet.${api}]`, { ...meta, raw })
}

interface AuthAttemptLog {
  data: string
  message: string
}

/** True when a heartbleed line is JSON auth feedback for this guess (not ambient server noise). */
function parseAuthAttemptLog(log: string, guess: string): AuthAttemptLog | null {
  try {
    const entry: unknown = JSON.parse(log)
    if (typeof entry !== "object" || entry === null) return null
    const rec = entry as Record<string, unknown>
    if (rec["passwordAttempted"] !== guess) return null
    if (rec["code"] !== 401) return null
    if (typeof rec["message"] !== "string") return null
    if (!("data" in rec) || typeof rec["data"] !== "string") return null
    return { data: rec["data"], message: rec["message"] }
  } catch {
    return null
  }
}

/**
 * After 401 auth, peek heartbleed logs until we find feedback for this guess.
 * Unrelated lines are consumed (peek: false) and skipped, up to HEARTBLEED_AUTH_LOG_MAX_RETRIES.
 */
async function scrapeAuthFeedbackAfter401(
  dnet: DarknetCrawlApi,
  target: string,
  guess: string,
  worker: string,
  solverId: string,
): Promise<AuthAttemptLog | null> {
  for (let retryIdx = 0; retryIdx < HEARTBLEED_AUTH_LOG_MAX_RETRIES; retryIdx++) {
    const hb = await dnet.heartbleed(target, { peek: true })
    debugRawDnetApi("heartbleed", {
      worker,
      target,
      peek: true,
      guess,
      solverId,
      retryIdx,
    }, hb)

    if (!hb.success || hb.logs.length === 0) return null

    const matched = parseAuthAttemptLog(hb.logs[0]!, guess)
    if (matched) return matched

    // Ambient or stale log — consume it and try again.
    const consumed = await dnet.heartbleed(target)
    debugRawDnetApi("heartbleed", {
      worker,
      target,
      peek: false,
      guess,
      solverId,
      retryIdx,
      consumedUnmatched: hb.logs[0],
    }, consumed)
  }
  return null
}

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
  replyPort: number | undefined,
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
    if (replyPort != null && replyPort > 0) {
      ns.writePort(replyPort, intelJson)
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

  if (replyPort != null && replyPort > 0) {
    ns.writePort(replyPort, JSON.stringify({ type: "archive", file: base, content }))
  }
}

export function reportCacheOpen(
  ns: NS,
  host: string,
  fileName: string,
  result: { message: string; karmaLoss: number },
  replyPort: number | undefined,
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

  if (replyPort != null && replyPort > 0) {
    ns.writePort(replyPort, JSON.stringify({ type: "cacheOpen", ...entry }))
  }
  // cache messages are lore snippets, not password data
  if (lorePort != null && lorePort > 0) {
    ns.writePort(lorePort, result.message)
  }
}

async function openCacheFilesOnCurrentHost(
  ns: NS,
  dnet: DarknetCrawlApi,
  replyPort: number | undefined,
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
    reportCacheOpen(ns, hostname, file, result, replyPort, lorePort, cacheOpens)
  }
}

async function archiveLocalServerFiles(
  ns: NS,
  dnet: DarknetCrawlApi,
  replyPort?: number,
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
        queueArchiveContent(ns, flatFileName(file), ns.read(file), replyPort, lorePort, neighbors)
        break
    }
  }

  await openCacheFilesOnCurrentHost(ns, dnet, replyPort, lorePort, neighbors, cacheOpens)
}

// ---- worker spawn helpers ----

export async function copyCrawlScript(ns: NS, target: string, source: string): Promise<void> {
  for (const file of DARKNET_WORKER_FILES) {
    for (let retryIdx = 0; retryIdx < 3; retryIdx++) {
      if (ns.fileExists(file, source)) {
        if (ns.scp(file, target, source)) break
      }
      await ns.sleep(1000)
    }
    if (!ns.fileExists(file, target)) {
      throw new Error(`Failed to scp ${file} to ${target} from ${source} after retries`)
    }
  }
}

/** Copy stasis helper script onto host (from home). */
export async function ensureStasisScript(ns: NS, host: string): Promise<boolean> {
  if (ns.fileExists(DARKNET_STASIS_SCRIPT, host)) return true
  for (let retryIdx = 0; retryIdx < 3; retryIdx++) {
    if (ns.fileExists(DARKNET_STASIS_SCRIPT, "home")) {
      if (ns.scp(DARKNET_STASIS_SCRIPT, host, "home")) break
    }
    await ns.sleep(1000)
  }
  return ns.fileExists(DARKNET_STASIS_SCRIPT, host)
}

export function crawlWorkerArgs(sessionId: number, commandPort: number, selfPassword?: string): (string | number)[] {
  const args: (string | number)[] = [WORKER_MODE_ARG, sessionId, commandPort]
  if (selfPassword !== undefined) {
    args.push(selfPassword)
  }
  return args
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

/** Execute a single auth/heartbleed/labreport command and report the result. */
async function executeTask(
  ns: NS,
  dnet: DarknetCrawlApi,
  cmd: WorkerCommand & { type: "guess" | "heartbleed" | "labreport" },
  replyPort: number,
): Promise<void> {
  const hostname = ns.getHostname()

  if (cmd.type === "guess") {
    // Verify target is still a neighbor before attempting (probe data can be stale)
    const targetDetails = safeGetSessionDetails(dnet, cmd.target)
    if (!targetDetails?.isConnectedToCurrentServer) {
      ns.writePort(replyPort, JSON.stringify({
        type: "guessResult",
        target: cmd.target,
        solverId: cmd.solverId,
        success: false,
        message: "notNeighbor",
      }))
      return
    }

    try {
      const result = await dnet.authenticate(cmd.target, cmd.guess)
      debugRawDnetApi("authenticate", {
        worker: hostname,
        target: cmd.target,
        guess: cmd.guess,
        solverId: cmd.solverId,
      }, result)
      if (result.success || result.code === 200) {
        ns.writePort(replyPort, JSON.stringify({
          type: "guessResult",
          target: cmd.target,
          solverId: cmd.solverId,
          success: true,
          feedback: typeof result.data === "string" ? result.data : undefined,
        }))
        return
      }

      let feedback: string | undefined
      let message: string | undefined
      if (result.code === 401) {
        try {
          const authLog = await scrapeAuthFeedbackAfter401(
            dnet, cmd.target, cmd.guess, hostname, cmd.solverId,
          )
          if (authLog) {
            feedback = authLog.data
            message = authLog.message
          }
        } catch { /* heartbleed may fail */ }
      }

      ns.writePort(replyPort, JSON.stringify({
        type: "guessResult",
        target: cmd.target,
        solverId: cmd.solverId,
        success: false,
        feedback,
        message,
      }))
    } catch (err) {
      debugRawDnetApi("authenticate", {
        worker: hostname,
        target: cmd.target,
        guess: cmd.guess,
        solverId: cmd.solverId,
        error: String(err),
      }, null)
      ns.writePort(replyPort, JSON.stringify({
        type: "guessResult",
        target: cmd.target,
        solverId: cmd.solverId,
        success: false,
      }))
    }
  } else if (cmd.type === "heartbleed") {
    // Verify target is still a neighbor
    const targetDetails = safeGetSessionDetails(dnet, cmd.target)
    if (!targetDetails?.isConnectedToCurrentServer) {
      ns.writePort(replyPort, JSON.stringify({
        type: "heartbleedResult",
        target: cmd.target,
        solverId: cmd.solverId,
        logEntries: [],
      }))
      return
    }

    try {
      const result = await dnet.heartbleed(cmd.target)
      debugRawDnetApi("heartbleed", {
        worker: hostname,
        target: cmd.target,
        peek: false,
        solverId: cmd.solverId,
      }, result)
      ns.writePort(replyPort, JSON.stringify({
        type: "heartbleedResult",
        target: cmd.target,
        solverId: cmd.solverId,
        logEntries: result.success ? result.logs : [],
      }))
    } catch (err) {
      debugRawDnetApi("heartbleed", {
        worker: hostname,
        target: cmd.target,
        peek: false,
        solverId: cmd.solverId,
        error: String(err),
      }, null)
      ns.writePort(replyPort, JSON.stringify({
        type: "heartbleedResult",
        target: cmd.target,
        solverId: cmd.solverId,
        logEntries: [],
      }))
    }
  } else if (cmd.type === "labreport") {
    try {
      if (dnet.labreport) {
        const result = await dnet.labreport()
        ns.writePort(replyPort, JSON.stringify({
          type: "labreportResult",
          target: cmd.target,
          solverId: cmd.solverId,
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

// ---- worker entry ----

function formatCommandBrief(cmd: WorkerCommand): string {
  switch (cmd.type) {
    case "probe": return "probe"
    case "guess": return `guess:${cmd.target}="${cmd.guess}"`
    case "heartbleed": return `heartbleed:${cmd.target}`
    case "labreport": return `labreport:${cmd.target}`
      case "spawn": return `spawn:${cmd.target}`
    case "realloc": return "realloc"
    case "stasis": return "stasis"
    case "exit": return "exit"
  }
}

export async function runCrawlWorker(ns: NS): Promise<void> {
  const dnet = (ns as NS & { dnet?: DarknetCrawlApi }).dnet
  if (!dnet) return

  const mySessionId = Number(ns.args[1])
  if (!Number.isFinite(mySessionId) || mySessionId <= 0) return
  const commandPort = Number(ns.args[2])
  if (!Number.isFinite(commandPort) || commandPort <= 0) return

  const hostname = ns.getHostname()
  const passwordCache = new Map<string, string>()
  // If parent passed a password via args, cache it so we can auth ourselves
  if (typeof ns.args[3] === "string" && ns.args[3].length > 0) {
    passwordCache.set(hostname, ns.args[3])
  }

  // Reply port is always commandPort + 1 (adjacent pair)
  const replyPort = commandPort + 1

  // Wait for master to write lorePort config to CONTROL_PORT
  let lorePort = 0
  while (true) {
    const raw = ns.peek(CONTROL_PORT)
    if (raw === "NULL PORT DATA") {
      await ns.sleep(2000)
      continue
    }
    let msg: ControlMessage
    try { msg = JSON.parse(raw as string) as ControlMessage } catch {
      await ns.sleep(2000)
      continue
    }
    if (typeof msg.sessionId !== "number" || msg.sessionId !== mySessionId) {
      ns.exit()
    }
    if (typeof msg.lorePort === "number") {
      lorePort = msg.lorePort
      break
    }
    await ns.sleep(200)
  }

  // Ensure session on ourselves
  try { await ensureSessionOnSelf(ns, dnet, passwordCache) } catch {
    ns.tprintf("ERROR: %s failed to authenticate self", hostname)
    return
  }

  ns.printf("%s worker initialized on port %d", hostname, commandPort)

  // Report PID to master so it can check liveness with ns.isRunning(pid)
  ns.writePort(replyPort, JSON.stringify({
    type: "ready",
    workerHost: hostname,
    pid: ns.pid,
  }))

  // Main command loop — uses ns.peek/ns.readPort for command polling
  while (true) {
    // Check CONTROL_PORT for session change (master restart)
    const checkRaw = ns.peek(CONTROL_PORT)
    if (checkRaw !== "NULL PORT DATA") {
      try {
        const checkMsg = JSON.parse(checkRaw as string) as ControlMessage
        if (typeof checkMsg.sessionId !== "number" || checkMsg.sessionId !== mySessionId) {
          ns.exit()
        }
      } catch { /* malformed, ignore */ }
    }

    // Poll for commands using ns.peek — same API the master uses to write (ns.writePort)
    let raw = ns.peek(commandPort)
    if (raw === "NULL PORT DATA") {
      ns.print("awaiting command...")
      let waitMs = 100
      while (true) {
        await ns.sleep(waitMs)
        raw = ns.peek(commandPort)
        if (raw !== "NULL PORT DATA") break
        waitMs = Math.min(waitMs * 2, 2000)
      }
    }
    ns.readPort(commandPort) // consume the message we peeked

    let command: WorkerCommand
    try { command = JSON.parse(raw as string) as WorkerCommand } catch { continue }

    ns.printf("%s executing: %s", hostname, formatCommandBrief(command))

    // Acknowledge receipt before execution
    ns.writePort(replyPort, JSON.stringify({
      type: "executing",
      workerHost: hostname,
      commandType: command.type,
      deadlineAt: command.deadlineAt ?? 0,
    }))

    switch (command.type) {
      case "probe": {
        writeCrawlStatus(ns, replyPort, {
          workerHost: hostname,
          targetHost: hostname,
          phase: "probe",
          etaMs: 0,
          detail: null,
        })
        let targets: string[]
        try { targets = dnet.probe() } catch { targets = [] }

        // Report self + all neighbors (authenticated and unauthenticated)
        const selfDetails = safeGetSessionDetails(dnet, hostname)
        writeCrawlReport(ns, replyPort, {
          hostname,
          authenticated: selfDetails?.hasSession ? true : null,
          password: null,
        })
        for (const neighbor of targets) {
          const details = safeGetSessionDetails(dnet, neighbor)
          if (details === null) {
            ns.writePort(replyPort, JSON.stringify({ type: "hostGone", hostname: neighbor }))
            continue
          }
          if (details.hasSession) {
            writeCrawlReport(ns, replyPort, { hostname: neighbor, authenticated: true, password: null })
          } else {
            writeCrawlReport(ns, replyPort, { hostname: neighbor, authenticated: false, password: null })
          }
        }

        // Archive local files
        if (selfDetails?.hasSession) {
          await archiveLocalServerFiles(ns, dnet, replyPort, lorePort, targets)
        }

        // Report probe result to master
        const workerRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, hostname)
        const freeRam = ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname)
        const blockedRam = dnet.getBlockedRam?.(hostname) ?? 0
        ns.writePort(replyPort, JSON.stringify({
          type: "probeResult",
          workerHost: hostname,
          targets,
          freeRam: freeRam - workerRam,
          blockedRam,
        }))
        ns.print(`done: probe => ${targets.length} neighbors`)
        break
      }
      case "guess":
      case "heartbleed":
      case "labreport": {
        await executeTask(ns, dnet, command, replyPort)
        ns.printf("done: %s", command.type)
        break
      }
      case "spawn": {
        // Master tells us to spawn a worker on target with assigned port.
        // First, free blocked RAM on the target so the worker can actually run.
        let success = false
        let childPid = 0
        try {
          if (dnet.memoryReallocation && dnet.getBlockedRam) {
            let blocked = dnet.getBlockedRam(command.target)
            const childRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, command.target)
            let free = ns.getServerMaxRam(command.target) - ns.getServerUsedRam(command.target)
            for (let reallocAttempts = 0; reallocAttempts < 10 && blocked > 0 && free < childRam; reallocAttempts++) {
              ns.printf("reallocating %s (blocked %s, free %s, need %s)",
                command.target, ns.format.ram(blocked), ns.format.ram(free), ns.format.ram(childRam))
              try { await dnet.memoryReallocation(command.target) } catch { break }
              blocked = dnet.getBlockedRam(command.target)
              free = ns.getServerMaxRam(command.target) - ns.getServerUsedRam(command.target)
            }
          }
          await copyCrawlScript(ns, command.target, hostname)
          const childRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, command.target)
          const free = ns.getServerMaxRam(command.target) - ns.getServerUsedRam(command.target)
          if (childRam <= free) {
            const args: (string | number)[] = [WORKER_MODE_ARG, command.sessionId, command.port]
            if (command.password) args.push(command.password)
            childPid = ns.exec(DARKNET_CRAWL_SCRIPT, command.target, 1, ...args)
            success = childPid !== 0
          }
        } catch (err) {
          ns.printf("spawn %s failed: %s", command.target, String(err))
        }
        ns.writePort(replyPort, JSON.stringify({
          type: "spawnResult",
          workerHost: hostname,
          target: command.target,
          success,
          childPid,
        }))
        ns.printf("done: spawn:%s => %s", command.target, success ? "ok" : "fail")
        break
      }
      case "realloc": {
        if (!dnet.memoryReallocation) break
        try {
          await dnet.memoryReallocation(hostname)
        } catch { /* realloc may fail */ }
        const freeRam = ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname) - ns.getScriptRam(DARKNET_CRAWL_SCRIPT, hostname)
        const blockedRam = dnet.getBlockedRam?.(hostname) ?? 0
        ns.writePort(replyPort, JSON.stringify({
          type: "reallocResult",
          workerHost: hostname,
          freeRam,
          blockedRam,
        }))
        ns.printf("done: realloc => free %s blocked %s", ns.format.ram(freeRam), ns.format.ram(blockedRam))
        break
      }
      case "stasis": {
        let childPid = 0
        try {
          const self = safeGetSessionDetails(dnet, hostname)
          if (!self?.hasSession) {
            ns.writePort(replyPort, JSON.stringify({
              type: "stasisResult",
              workerHost: hostname,
              success: false,
            }))
            break
          }

          if (dnet.memoryReallocation && dnet.getBlockedRam) {
            let blocked = dnet.getBlockedRam(hostname)
            const childRam = ns.getScriptRam(DARKNET_STASIS_SCRIPT, hostname)
            let free = ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname)
            for (let retryIdx = 0; retryIdx < 10 && blocked > 0 && free < childRam; retryIdx++) {
              ns.printf("reallocating %s for stasis (blocked %s, free %s, need %s)",
                hostname, ns.format.ram(blocked), ns.format.ram(free), ns.format.ram(childRam))
              try { await dnet.memoryReallocation(hostname) } catch { break }
              blocked = dnet.getBlockedRam(hostname)
              free = ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname)
            }
          }

          if (!(await ensureStasisScript(ns, hostname))) {
            ns.printf("stasis: %s missing on %s", DARKNET_STASIS_SCRIPT, hostname)
            ns.writePort(replyPort, JSON.stringify({
              type: "stasisResult",
              workerHost: hostname,
              success: false,
            }))
            break
          }

          const childRam = ns.getScriptRam(DARKNET_STASIS_SCRIPT, hostname)
          const free = ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname)
          if (childRam > free) {
            ns.printf("stasis: not enough RAM on %s (need %s, free %s)",
              hostname, ns.format.ram(childRam), ns.format.ram(free))
            ns.writePort(replyPort, JSON.stringify({
              type: "stasisResult",
              workerHost: hostname,
              success: false,
            }))
            break
          }

          childPid = ns.exec(DARKNET_STASIS_SCRIPT, hostname, 1, replyPort)
          if (childPid > 0) {
            while (ns.isRunning(childPid)) {
              await ns.sleep(200)
            }
          } else {
            ns.writePort(replyPort, JSON.stringify({
              type: "stasisResult",
              workerHost: hostname,
              success: false,
            }))
          }
        } catch (err) {
          ns.printf("stasis failed: %s", String(err))
          if (childPid === 0) {
            ns.writePort(replyPort, JSON.stringify({
              type: "stasisResult",
              workerHost: hostname,
              success: false,
            }))
          }
        }
        ns.printf("done: stasis")
        break
      }
      case "exit": {
        ns.exit()
      }
    }
    ns.print("idle")
  }
}

// ---- entry ----

export async function main(ns: NS): Promise<void> {
  await runCrawlWorker(ns)
}
