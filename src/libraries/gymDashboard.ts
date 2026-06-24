import { NS, GymType } from "@ns"
import {
  col,
  createTailLog,
  type ReactTableConfig,
  W,
} from "./scriptLogUiLayout.js"
import {
  COMBAT_GYM_SKILLS,
  type CombatGymSkill,
  GYM_NAME,
  estimateCombatGymMsToNextLevel,
  combatGymExpPerSecond,
  getCombatSkillLevelMult,
} from "./gymWorkout.js"

const SKILL_LABELS: Record<CombatGymSkill, string> = {
  str: "Strength",
  def: "Defense",
  dex: "Dexterity",
  agi: "Agility",
}

export interface GymDashboardData {
  /** Each skill's current level. */
  levels: Record<CombatGymSkill, number>
  /** Each skill's current exp toward next level. */
  exp: Record<CombatGymSkill, number>
  /** Estimated ms to next level for each skill. */
  estimatesMs: Record<CombatGymSkill, number | null>
  /** Exp gain per second for each skill. */
  expPerSecond: Record<CombatGymSkill, number | null>
  /** Total exp required for a full 0%→100% level on each skill. */
  totalLevelExp: Record<CombatGymSkill, number>
  /** Effective level multiplier (player.mults * bitnode mults) for each skill. */
  levelMults: Record<CombatGymSkill, number>
  /** The skill currently being trained. */
  training: CombatGymSkill
  /** How training was selected: "soonest" = estimateCombatGymMsToNextLevel, "lowest" = fallback. */
  selectionMethod: "soonest" | "lowest"
  /** Per-skill estimates that were tied (for debugging). */
  tiedSkills: CombatGymSkill[]
  /** Player's city. */
  city: string
  /** Whether player is focused. */
  focused: boolean
  /** Current skill gap (max - min level). */
  skillGap: number
  /** Travel state. */
  traveling: boolean
}

function formatMs(ms: number | null): string {
  if (ms == null) return "???  "
  if (ms <= 0) return "0ms "
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s  `
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m${String(secs).padStart(2, "0")}`
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 10) return n.toFixed(0)
  if (n > 0 && n < 10) return n.toFixed(1)
  return "0"
}

/** Matches the game's own calculateSkillProgress from skill.ts. */
function estimateProgress(currentExp: number, skill: CombatGymSkill, ns: NS): number {
  const mult = getCombatSkillLevelMult(ns, skill)
  const calcLevel = ns.formulas.skills.calculateSkill(currentExp, mult)
  const baseExperience = ns.formulas.skills.calculateExp(calcLevel, mult)
  const nextExperience = ns.formulas.skills.calculateExp(calcLevel + 1, mult)
  const range = nextExperience - baseExperience
  if (range <= 0) return 99.99
  const rawProgress = ((currentExp - baseExperience) * 100) / range
  return clampNumber(rawProgress, 0, 100)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function buildProgressBar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width)
  return "[" + "\u2588".repeat(filled) + "-".repeat(Math.max(0, width - filled)) + "]"
}

function selectionReason(d: GymDashboardData): string {
  if (d.selectionMethod === "lowest") {
    return `Lowest level (${SKILL_LABELS[d.training]})`
  }
  const est = d.estimatesMs[d.training]
  if (d.tiedSkills.length > 1) {
    const tiedLabels = d.tiedSkills
      .slice()
      .sort((a, b) => COMBAT_GYM_SKILLS.indexOf(a) - COMBAT_GYM_SKILLS.indexOf(b))
      .map((s) => SKILL_LABELS[s])
    return `Soonest (${formatMs(est)}) - tied: ${tiedLabels.join(", ")}`
  }
  return `Soonest (${formatMs(est)})`
}

export function buildGymDashboard(ns: NS, d: GymDashboardData): ReactTableConfig {
  const rows: string[][] = []

  for (const skill of COMBAT_GYM_SKILLS) {
    const level = d.levels[skill]
    const progress = estimateProgress(d.exp[skill], skill, ns)
    const estStr = formatMs(d.estimatesMs[skill])
    const expStr = formatNumber(d.expPerSecond[skill] ?? 0)
    const totalExpStr = formatNumber(d.totalLevelExp[skill])
    const multStr = d.levelMults[skill].toFixed(2)
    const progressBar = buildProgressBar(progress)

    const row: string[] = [
      SKILL_LABELS[skill],
      String(level),
      `${progressBar} ${progress.toFixed(0)}%`,
      multStr,
      totalExpStr,
      `${expStr}/s`,
      estStr,
    ]
    rows.push(row)
  }

  const trainedIdx = COMBAT_GYM_SKILLS.indexOf(d.training)

  return {
    columns: [
      col("Skill", "left", W.stat + 2),
      col("Lvl", "right", 4),
      col("Progress", "left", 16),
      col("Mult", "right", 6),
      col("XP/lvl", "right", 8),
      col("Gain", "right", 8),
      col("ETA", "right", 7),
    ],
    rows,
    selectedRowIndex: trainedIdx >= 0 ? trainedIdx : undefined,
  }
}

export function buildGymStatusRow(d: GymDashboardData, ns: NS): string[] {
  const lines: string[] = []

  const reason = selectionReason(d)
  const focusText = d.focused ? "focused" : "unfocused"
  lines.push(`Training: ${SKILL_LABELS[d.training]} (${reason}) [${focusText}]`)
  lines.push(`City: ${d.city} | Skill gap: ${d.skillGap} | Traveling: ${d.traveling ? "yes" : "no"}`)
  lines.push(`Gym: ${GYM_NAME}`)

  return lines
}

export async function renderGymDashboard(ns: NS, d: GymDashboardData): Promise<void> {
  const statusLines = buildGymStatusRow(d, ns)
  const log = createTailLog()

  for (const line of statusLines) {
    log.text(line)
  }

  log.table(buildGymDashboard(ns, d))
  await log.render(ns)
}
