const OUTCOME_KEY = "__bitburnerInfiltrationRunOutcome"
const DEFAULT_OUTCOME_MAX_AGE_MS = 10000

type InfiltrationRunOutcome = "victory" | "cancelled"

interface StoredInfiltrationRunOutcome {
  outcome: InfiltrationRunOutcome
  at: number
}

type WindowWithInfiltrationOutcome = Window & {
  [OUTCOME_KEY]?: StoredInfiltrationRunOutcome
}

function getOutcomeWindow(): WindowWithInfiltrationOutcome {
  return eval("window") as WindowWithInfiltrationOutcome
}

export function setInfiltrationRunOutcome(outcome: InfiltrationRunOutcome): void {
  getOutcomeWindow()[OUTCOME_KEY] = { outcome, at: Date.now() }
}

export function peekInfiltrationRunOutcome(
  maxAgeMs = DEFAULT_OUTCOME_MAX_AGE_MS
): InfiltrationRunOutcome | null {
  const stored = getOutcomeWindow()[OUTCOME_KEY]
  if (!stored) return null
  if (Date.now() - stored.at > maxAgeMs) return null
  return stored.outcome
}

export function clearInfiltrationRunOutcome(): void {
  delete getOutcomeWindow()[OUTCOME_KEY]
}
