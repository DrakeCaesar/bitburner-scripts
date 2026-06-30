import { NS } from "@ns"

/** Model id for timing-attack servers (auth time scales with matching prefix length). */
const TIMING_ATTACK_MODEL = "2G_cellular"

const FALLBACK_AUTH_MS = 5_000
const FALLBACK_HEARTBLEED_MS = 7_500

/** Fields required by ns.formulas.dnet.getAuthenticateTime / getHeartbleedTime. */
export interface FormulasServerDetails {
  modelId: string
  passwordHint: string
  data: string
  logTrafficInterval: number
  passwordLength: number
  passwordFormat: "numeric" | "alphabetic" | "alphanumeric" | "ASCII" | "unicode"
  blockedRam: number
  difficulty: number
  depth: number
  requiredCharismaSkill: number
  isStationary: boolean
  isConnectedToCurrentServer: boolean
  hasSession: boolean
}

interface FormulasDnet {
  getAuthenticateTime(
    serverDetails: FormulasServerDetails,
    threads?: number,
    player?: unknown,
    correctCharactersInPassword?: number,
  ): number
  getHeartbleedTime(
    serverDetails: FormulasServerDetails,
    threads?: number,
    player?: unknown,
  ): number
}

function formulasDnet(ns: NS): FormulasDnet | null {
  const api = (ns as NS & { formulas?: { dnet?: FormulasDnet } }).formulas?.dnet
  return api ?? null
}

function timingAttackCorrectChars(details: FormulasServerDetails, guess: string): number {
  if (details.modelId !== TIMING_ATTACK_MODEL) return 0
  return Math.min(guess.length, details.passwordLength)
}

/** Wall-clock ms for dnet.authenticate (excludes coordinator grace). */
export function estimateAuthMs(ns: NS, details: FormulasServerDetails, guess: string): number {
  const formulas = formulasDnet(ns)
  if (!formulas) return FALLBACK_AUTH_MS
  try {
    return formulas.getAuthenticateTime(details, 1, undefined, timingAttackCorrectChars(details, guess))
  } catch {
    return FALLBACK_AUTH_MS
  }
}

/** Wall-clock ms for one dnet.heartbleed call (excludes coordinator grace). */
export function estimateHeartbleedMs(ns: NS, details: FormulasServerDetails): number {
  const formulas = formulasDnet(ns)
  if (!formulas) return FALLBACK_HEARTBLEED_MS
  try {
    return formulas.getHeartbleedTime(details, 1)
  } catch {
    return FALLBACK_HEARTBLEED_MS
  }
}
