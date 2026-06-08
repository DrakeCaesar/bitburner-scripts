import { NS } from "@ns"

// --- config ---

export const DARKNET_CRAWL_SCRIPT = "darknetCrawl.js"
export const MAX_PROBE_DEPTH = 10
export const CRAWL_REPORT_PORT = 45107
const WORKER_MODE_ARG = "worker"
const DARKWEB = "darkweb"

// --- types ---

type DarknetPasswordFormat = "numeric" | "alphabetic" | "alphanumeric" | "ASCII" | "unicode"

interface DarknetAuthSolverInput {
  modelId: string
  passwordFormat: DarknetPasswordFormat
  passwordHint: string
  passwordLength: number
  data: string
  scrapedLogs: string[]
}

interface CrawlHostReport {
  type?: "host"
  hostname: string
  authenticated: boolean | null
  password: string | null
}

export type CrawlStatusPhase = "auth" | "heartbleed" | "probe" | "spawn" | "wait"

export interface CrawlStatusReport {
  type: "status"
  workerHost: string
  targetHost: string
  phase: CrawlStatusPhase
  etaMs: number
  detail: string | null
}

export type CrawlPortMessage = CrawlHostReport | CrawlStatusReport

export interface CrawlProgressState {
  reports: ReadonlyMap<string, CrawlHostReport>
  activeOps: readonly CrawlStatusReport[]
  workerRunning: boolean
}

export type CrawlProgressHandler = (state: CrawlProgressState) => void | Promise<void>

export interface DarknetCrawlApi {
  probe(): string[]
  authenticate(host: string, password: string, additionalMsec?: number): Promise<{ success: boolean }>
  heartbleed(host: string, options?: { peek?: boolean }): Promise<{ success: boolean; logs: string[] }>
  connectToSession?(host: string, password: string): { success: boolean }
  getServerDetails(host?: string): DarknetServerDetailsForFormulas
}

export type DarknetServerDetailsForFormulas = {
  hasSession: boolean
  isOnline: boolean
  isConnectedToCurrentServer: boolean
  isStationary: boolean
  blockedRam: number
  modelId: string
  passwordFormat: DarknetPasswordFormat
  passwordHint: string
  passwordLength: number
  data: string
  depth: number
  difficulty: number
  requiredCharismaSkill: number
  logTrafficInterval: number
}

// --- auth-solver ---

function solveFreshInstall(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "FreshInstall_1.0") {
    return null
  }

  if (
    input.passwordHint !== "It's still the default" &&
    input.passwordHint !== "It's still the factory settings" &&
    input.passwordHint !== "I never changed the password" &&
    input.passwordHint !== "The password is the default password" &&
    input.passwordHint !== "The default password is set"
  ) {
    return null
  }

  if (input.passwordFormat === "numeric") {
    return "0".repeat(input.passwordLength)
  }

  if (input.passwordFormat === "alphabetic") {
    if (input.passwordLength !== 8) {
      return null
    }

    return "password"
  }

  return null
}

function solveZeroLogon(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "ZeroLogon") {
    return null
  }
  if (input.passwordLength !== 0) {
    return null
  }

  return ""
}

function solveCloudBlare(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "CloudBlare(tm)") {
    return null
  }
  if (input.passwordFormat !== "numeric") {
    return null
  }
  if (input.passwordHint !== "Type the numbers to prove you are human") {
    return null
  }

  const digits = input.data.replace(/\D/g, "")
  if (digits.length !== input.passwordLength) {
    return null
  }

  return digits
}

function solveDeskMemo(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "DeskMemo_3.1") {
    return null
  }
  if (input.passwordFormat !== "numeric") {
    return null
  }

  let value: string | null = null
  if (input.passwordHint.startsWith("The PIN is ")) {
    value = input.passwordHint.slice("The PIN is ".length)
  } else if (input.passwordHint.startsWith("The secret is ")) {
    value = input.passwordHint.slice("The secret is ".length)
  } else if (input.passwordHint.startsWith("The key is ")) {
    value = input.passwordHint.slice("The key is ".length)
  }

  if (value === null || value.length !== input.passwordLength) {
    return null
  }

  return value
}

function romanToDecimal(roman: string): number | null {
  const values: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  }

  const upper = roman.trim().toUpperCase()
  if (!upper || !/^[IVXLCDM]+$/.test(upper)) {
    return null
  }

  let total = 0
  for (let i = 0; i < upper.length; i++) {
    const current = values[upper[i]!]
    const next = values[upper[i + 1]!]
    if (current === undefined) {
      return null
    }
    if (next !== undefined && current < next) {
      total -= current
    } else {
      total += current
    }
  }

  return total
}

function solveBellaCuore(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "BellaCuore") {
    return null
  }
  if (input.passwordFormat !== "numeric") {
    return null
  }

  const numeral = input.data.trim()
  if (input.passwordHint !== `The password is the value of the number '${numeral}'`) {
    return null
  }

  const decimal = romanToDecimal(numeral)
  if (decimal === null) {
    return null
  }

  const password = String(decimal)
  if (password.length !== input.passwordLength) {
    return null
  }

  return password
}

function isNilModel(details: ReturnType<DarknetCrawlApi["getServerDetails"]>): boolean {
  return (
    details.modelId === "NIL" &&
    details.passwordFormat === "numeric" &&
    details.passwordHint === "you are one who's'nt authorized"
  )
}

interface AuthLogEntry {
  passwordAttempted: string
  data?: string
}

function parseAuthLogLine(logLine: string): AuthLogEntry | null {
  try {
    const parsed: unknown = JSON.parse(logLine)
    if (typeof parsed !== "object" || parsed === null) {
      return null
    }
    const row = parsed as Record<string, unknown>
    if (typeof row.passwordAttempted !== "string") {
      return null
    }
    return {
      passwordAttempted: row.passwordAttempted,
      data: typeof row.data === "string" ? row.data : undefined,
    }
  } catch {
    const attemptMatch = logLine.match(/passwordAttempted:\s*(\S+)/)
    const dataMatch = logLine.match(/data:\s*([^\n]+)/)
    if (!attemptMatch) {
      return null
    }
    return {
      passwordAttempted: attemptMatch[1]!,
      data: dataMatch?.[1]?.trim(),
    }
  }
}

function parseNilFeedback(data: string, length: number): boolean[] | null {
  const parts = data.split(",")
  if (parts.length !== length) {
    return null
  }
  const feedback: boolean[] = []
  for (const part of parts) {
    if (part === "yes") {
      feedback.push(true)
    } else if (part === "yesn't") {
      feedback.push(false)
    } else {
      return null
    }
  }
  return feedback
}

async function readNilFeedback(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  guess: string
): Promise<boolean[] | null> {
  writeCrawlStatus(ns, port, {
    workerHost: ns.getHostname(),
    targetHost: host,
    phase: "heartbleed",
    etaMs: getHeartbleedEtaMs(ns, dnet, host),
    detail: "reading auth log",
  })

  const result = await dnet.heartbleed(host, { peek: true })
  if (!result.success) {
    return null
  }

  for (const logLine of result.logs) {
    const entry = parseAuthLogLine(logLine)
    if (entry?.passwordAttempted !== guess || !entry.data) {
      continue
    }
    const feedback = parseNilFeedback(entry.data, guess.length)
    if (feedback) {
      return feedback
    }
  }

  return null
}

async function authenticateNil(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  length: number
): Promise<{ password: string | null; authenticated: boolean }> {
  const digits: (string | null)[] = Array.from({ length }, () => null)

  for (let digit = 0; digit <= 9; digit++) {
    const guess = String(digit).repeat(length)
    const detail = `NIL digit ${digit}/9`
    const result = await authenticateWithStatus(ns, port, dnet, host, guess, detail)
    if (result.success) {
      return { password: guess, authenticated: true }
    }

    const feedback = await readNilFeedback(ns, port, dnet, host, guess)
    if (feedback) {
      for (let i = 0; i < length; i++) {
        if (feedback[i]) {
          digits[i] = String(digit)
        }
      }
    }

    if (digits.every((d) => d !== null)) {
      break
    }
  }

  if (!digits.every((d) => d !== null)) {
    return { password: null, authenticated: false }
  }

  const password = digits.join("")
  const result = await authenticateWithStatus(ns, port, dnet, host, password, "NIL final")
  return { password, authenticated: result.success }
}

function solveDarknetPassword(input: DarknetAuthSolverInput): { password: string | null } {
  const zeroLogon = solveZeroLogon(input)
  if (zeroLogon !== null) {
    return { password: zeroLogon }
  }

  const freshInstall = solveFreshInstall(input)
  if (freshInstall !== null) {
    return { password: freshInstall }
  }

  const cloudBlare = solveCloudBlare(input)
  if (cloudBlare !== null) {
    return { password: cloudBlare }
  }

  const deskMemo = solveDeskMemo(input)
  if (deskMemo !== null) {
    return { password: deskMemo }
  }

  const bellaCuore = solveBellaCuore(input)
  if (bellaCuore !== null) {
    return { password: bellaCuore }
  }

  void input.scrapedLogs
  return { password: null }
}

function solverInputFromDetails(
  details: ReturnType<DarknetCrawlApi["getServerDetails"]>
): DarknetAuthSolverInput {
  return {
    modelId: details.modelId,
    passwordFormat: details.passwordFormat,
    passwordHint: details.passwordHint,
    passwordLength: details.passwordLength,
    data: details.data,
    scrapedLogs: [],
  }
}

// --- crawl-worker ---

interface DarknetFormulasApi {
  dnet?: {
    getAuthenticateTime(data: DarknetServerDetailsForFormulas, threads?: number): number
    getHeartbleedTime(data: DarknetServerDetailsForFormulas, threads?: number): number
  }
}

function getScriptThreads(ns: NS): number {
  const running = ns.getRunningScript(ns.getScriptName(), ns.getHostname())
  return running && running.threads > 0 ? running.threads : 1
}

function getFormulasApi(ns: NS): DarknetFormulasApi | null {
  return (ns as NS & { formulas?: DarknetFormulasApi }).formulas ?? null
}

function getAuthEtaMs(ns: NS, dnet: DarknetCrawlApi, host: string): number {
  const details = dnet.getServerDetails(host)
  if (!details.isOnline) {
    return 0
  }
  const formulas = getFormulasApi(ns)?.dnet
  if (!formulas) {
    return 0
  }
  return formulas.getAuthenticateTime(details, getScriptThreads(ns))
}

function getHeartbleedEtaMs(ns: NS, dnet: DarknetCrawlApi, host: string): number {
  const details = dnet.getServerDetails(host)
  if (!details.isOnline) {
    return 0
  }
  const formulas = getFormulasApi(ns)?.dnet
  if (!formulas) {
    return 0
  }
  return formulas.getHeartbleedTime(details, getScriptThreads(ns))
}

function writeCrawlReport(ns: NS, port: number, report: CrawlHostReport): void {
  ns.writePort(port, JSON.stringify({ type: "host", ...report }))
}

function writeCrawlStatus(ns: NS, port: number, status: Omit<CrawlStatusReport, "type">): void {
  ns.writePort(port, JSON.stringify({ type: "status", ...status }))
}

async function authenticateWithStatus(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  password: string,
  detail: string | null = null
): Promise<{ success: boolean }> {
  writeCrawlStatus(ns, port, {
    workerHost: ns.getHostname(),
    targetHost: host,
    phase: "auth",
    etaMs: getAuthEtaMs(ns, dnet, host),
    detail,
  })
  return dnet.authenticate(host, password)
}

async function tryAuthNeighbor(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  neighbor: string
): Promise<{ password: string | null; authenticated: boolean | null }> {
  const details = dnet.getServerDetails(neighbor)

  if (details.hasSession) {
    return { password: null, authenticated: true }
  }

  if (isNilModel(details)) {
    const nil = await authenticateNil(ns, port, dnet, neighbor, details.passwordLength)
    return {
      password: nil.password,
      authenticated: nil.authenticated ? true : nil.password !== null ? false : null,
    }
  }

  const { password } = solveDarknetPassword(solverInputFromDetails(details))

  if (password !== null) {
    const result = await authenticateWithStatus(ns, port, dnet, neighbor, password)
    return { password, authenticated: result.success }
  }

  return { password: null, authenticated: null }
}

async function waitForChildPids(ns: NS, pids: number[]): Promise<void> {
  for (const pid of pids) {
    if (pid <= 0) continue
    while (ns.isRunning(pid)) {
      await ns.sleep(50)
    }
  }
}

async function copyCrawlScript(ns: NS, target: string, source: string): Promise<void> {
  if (!ns.fileExists(DARKNET_CRAWL_SCRIPT, source)) {
    throw new Error(`${DARKNET_CRAWL_SCRIPT} not found on ${source}`)
  }
  await ns.scp(DARKNET_CRAWL_SCRIPT, target, source)
}

async function runCrawlWorker(ns: NS): Promise<void> {
  const reportPort = Number(ns.args[1])
  const remainingDepth = Number(ns.args[2])
  if (!Number.isInteger(reportPort) || reportPort <= 0 || !Number.isInteger(remainingDepth)) {
    return
  }

  const dnet = (ns as NS & { dnet?: DarknetCrawlApi }).dnet
  if (!dnet) {
    return
  }

  const hostname = ns.getHostname()

  writeCrawlReport(ns, reportPort, {
    hostname,
    authenticated: dnet.getServerDetails(hostname).hasSession ? true : null,
    password: null,
  })

  if (remainingDepth <= 0) {
    return
  }

  const childPids: number[] = []

  writeCrawlStatus(ns, reportPort, {
    workerHost: hostname,
    targetHost: hostname,
    phase: "probe",
    etaMs: 0,
    detail: null,
  })

  for (const neighbor of dnet.probe()) {
    const auth = await tryAuthNeighbor(ns, reportPort, dnet, neighbor)
    writeCrawlReport(ns, reportPort, {
      hostname: neighbor,
      authenticated: auth.authenticated,
      password: auth.password,
    })

    if (!dnet.getServerDetails(neighbor).hasSession || remainingDepth <= 1) {
      continue
    }

    writeCrawlStatus(ns, reportPort, {
      workerHost: hostname,
      targetHost: neighbor,
      phase: "spawn",
      etaMs: 0,
      detail: `depth ${remainingDepth - 1}`,
    })

    await copyCrawlScript(ns, neighbor, hostname)
    const pid = ns.exec(DARKNET_CRAWL_SCRIPT, neighbor, 1, WORKER_MODE_ARG, reportPort, remainingDepth - 1)
    if (pid > 0) {
      childPids.push(pid)
    }
  }

  if (childPids.length > 0) {
    writeCrawlStatus(ns, reportPort, {
      workerHost: hostname,
      targetHost: hostname,
      phase: "wait",
      etaMs: 0,
      detail: `${childPids.length} child worker(s)`,
    })
  }

  await waitForChildPids(ns, childPids)
}

// --- crawl-master ---

function parseCrawlStatus(raw: Record<string, unknown>): CrawlStatusReport | null {
  if (raw.type !== "status") {
    return null
  }
  if (typeof raw.workerHost !== "string" || typeof raw.targetHost !== "string") {
    return null
  }
  if (
    raw.phase !== "auth" &&
    raw.phase !== "heartbleed" &&
    raw.phase !== "probe" &&
    raw.phase !== "spawn" &&
    raw.phase !== "wait"
  ) {
    return null
  }
  if (typeof raw.etaMs !== "number" || !Number.isFinite(raw.etaMs)) {
    return null
  }
  return {
    type: "status",
    workerHost: raw.workerHost,
    targetHost: raw.targetHost,
    phase: raw.phase,
    etaMs: raw.etaMs,
    detail: typeof raw.detail === "string" ? raw.detail : null,
  }
}

function parseCrawlReport(raw: unknown): CrawlHostReport | null {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) return null
    const row = parsed as Record<string, unknown>
    if (row.type === "status") {
      return null
    }
    if (typeof row.hostname !== "string") return null
    if (row.authenticated !== true && row.authenticated !== false && row.authenticated !== null) {
      return null
    }
    return {
      type: "host",
      hostname: row.hostname,
      authenticated: row.authenticated,
      password: typeof row.password === "string" || row.password === null ? row.password : null,
    }
  } catch {
    return null
  }
}

function applyCrawlPortMessage(
  raw: unknown,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>
): void {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) {
      return
    }
    const row = parsed as Record<string, unknown>
    const status = parseCrawlStatus(row)
    if (status) {
      activeOps.set(status.workerHost, status)
      return
    }
    const report = parseCrawlReport(parsed)
    if (!report) {
      return
    }
    reports.set(report.hostname, report)
    for (const [workerHost, op] of activeOps) {
      if (op.targetHost === report.hostname && (op.phase === "auth" || op.phase === "heartbleed")) {
        activeOps.delete(workerHost)
      }
    }
  } catch {
    // ignore malformed port data
  }
}

function drainCrawlPort(
  ns: NS,
  port: number,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>
): void {
  while (true) {
    const raw = ns.readPort(port)
    if (raw === "NULL PORT DATA") break
    applyCrawlPortMessage(raw, reports, activeOps)
  }
}

function pollCrawlPort(
  ns: NS,
  port: number,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>
): void {
  while (true) {
    const raw = ns.peek(port)
    if (raw === "NULL PORT DATA") break
    ns.readPort(port)
    applyCrawlPortMessage(raw, reports, activeOps)
  }
}

function formatEtaMs(etaMs: number): string {
  if (etaMs <= 0) {
    return "-"
  }
  if (etaMs < 1000) {
    return `${Math.round(etaMs)}ms`
  }
  return `${(etaMs / 1000).toFixed(1)}s`
}

export function formatCrawlStatusLine(status: CrawlStatusReport): string {
  const eta = formatEtaMs(status.etaMs)
  const detail = status.detail ? ` | ${status.detail}` : ""
  return `${status.workerHost} -> ${status.targetHost}: ${status.phase} (est ${eta})${detail}`
}

export async function runDarknetCrawl(
  ns: NS,
  dnet: DarknetCrawlApi,
  maxDepth = MAX_PROBE_DEPTH,
  onProgress?: CrawlProgressHandler
): Promise<Map<string, CrawlHostReport>> {
  const source = ns.getHostname()

  const details = dnet.getServerDetails(DARKWEB)
  const { password } = solveDarknetPassword(solverInputFromDetails(details))

  if (password !== null) {
    await dnet.authenticate(DARKWEB, password)
  } else if (dnet.connectToSession) {
    dnet.connectToSession(DARKWEB, "")
  }

  await copyCrawlScript(ns, DARKWEB, source)
  ns.clearPort(CRAWL_REPORT_PORT)
  ns.scriptKill(DARKNET_CRAWL_SCRIPT, DARKWEB)

  const workerRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, DARKWEB)
  const freeRam = ns.getServerMaxRam(DARKWEB) - ns.getServerUsedRam(DARKWEB)
  if (workerRam > freeRam) {
    throw new Error(
      `Not enough RAM on ${DARKWEB} for ${DARKNET_CRAWL_SCRIPT} (need ${ns.format.ram(workerRam)}, free ${ns.format.ram(freeRam)})`
    )
  }

  const pid = ns.exec(DARKNET_CRAWL_SCRIPT, DARKWEB, 1, WORKER_MODE_ARG, CRAWL_REPORT_PORT, maxDepth)
  if (pid === 0) {
    throw new Error(`Could not exec ${DARKNET_CRAWL_SCRIPT} on ${DARKWEB}`)
  }

  const reports = new Map<string, CrawlHostReport>()
  const activeOps = new Map<string, CrawlStatusReport>()

  const emitProgress = async (workerRunning: boolean): Promise<void> => {
    if (!onProgress) {
      return
    }
    await onProgress({
      reports,
      activeOps: [...activeOps.values()],
      workerRunning,
    })
  }

  await emitProgress(true)

  while (ns.isRunning(pid)) {
    pollCrawlPort(ns, CRAWL_REPORT_PORT, reports, activeOps)
    await emitProgress(true)
    await ns.sleep(100)
  }

  drainCrawlPort(ns, CRAWL_REPORT_PORT, reports, activeOps)
  await emitProgress(false)

  return reports
}

// --- entry ---

export async function main(ns: NS): Promise<void> {
  if (ns.args[0] === WORKER_MODE_ARG) {
    await runCrawlWorker(ns)
  }
}
