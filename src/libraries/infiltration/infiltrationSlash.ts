export const SLASH_TASK_TITLE = "Slash the sentinel"

export type SlashPhase = "guarding" | "distracted" | "alerted"

export function isSlashTaskTitle(taskTitle: string): boolean {
  return taskTitle.trim() === SLASH_TASK_TITLE
}

function normalizeSlashText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

/** True when task root contains the slash minigame instructions. */
export function isSlashTaskRoot(taskRoot: Element): boolean {
  if (!parseSlashStatus(taskRoot)) return false

  for (const element of Array.from(taskRoot.querySelectorAll("h5, p"))) {
    const text = normalizeSlashText(element.textContent ?? "")
    if (text.includes("sentinel")) {
      return true
    }
  }

  return false
}

/** Read slash minigame instruction text from h5 (or legacy p). */
export function readSlashInstructions(taskRoot: Element): string[] {
  for (const element of Array.from(taskRoot.querySelectorAll("h5, p"))) {
    const text = element.textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (!text) continue

    const lower = normalizeSlashText(text)
    if (lower.includes("attack after") && lower.includes("sentinel")) {
      return [text]
    }
  }

  for (const element of Array.from(taskRoot.querySelectorAll("h5, p"))) {
    const text = element.textContent?.replace(/\s+/g, " ").trim() ?? ""
    const lower = normalizeSlashText(text)
    if (text && lower.includes("sentinel") && lower.includes("distracted")) {
      return [text]
    }
  }

  return []
}

function parseSlashStatusText(text: string): SlashPhase | null {
  const normalized = normalizeSlashText(text)
  if (/^distracted!?$/.test(normalized)) return "distracted"
  if (normalized.includes("alerted")) return "alerted"
  if (normalized.includes("guarding")) return "guarding"
  return null
}

/** Read sentinel phase from status h4 (Guarding / Distracted! / Alerted!). */
export function parseSlashStatus(taskRoot: Element): SlashPhase | null {
  for (const h4 of Array.from(taskRoot.querySelectorAll("h4"))) {
    const phase = parseSlashStatusText(h4.textContent ?? "")
    if (phase) return phase
  }
  return null
}

export function formatSlashStatusLabel(phase: SlashPhase | null | undefined): string {
  switch (phase) {
    case "guarding":
      return "Guarding ..."
    case "distracted":
      return "Distracted!"
    case "alerted":
      return "Alerted!"
    default:
      return "(waiting...)"
  }
}
