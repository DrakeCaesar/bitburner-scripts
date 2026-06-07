export const SLASH_TASK_TITLE = "Slash the sentinel"

export type SlashPhase = "guarding" | "distracted" | "alerted"

export function isSlashTaskTitle(taskTitle: string): boolean {
  return taskTitle.trim() === SLASH_TASK_TITLE
}

/** True when task root contains the slash minigame instructions. */
export function isSlashTaskRoot(taskRoot: Element): boolean {
  for (const paragraph of Array.from(taskRoot.querySelectorAll("p"))) {
    const text = paragraph.textContent?.replace(/\s+/g, " ").trim().toLowerCase() ?? ""
    if (text.includes("sentinel") && text.includes("distracted")) {
      return true
    }
  }
  return false
}

function parseSlashStatusText(text: string): SlashPhase | null {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase()
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
