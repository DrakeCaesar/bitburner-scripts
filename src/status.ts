import { BitNodeBooleanOptions, NS } from "@ns"

const BITNODE_NAMES: Record<number, string> = {
  1: "Source Genesis",
  2: "Rise of the Underworld",
  3: "Corporatocracy",
  4: "The Singularity",
  5: "Artificial Intelligence",
  6: "Bladeburners",
  7: "Blade's BitBurner",
  8: "Ghost of Sparta",
  9: "Hacknet Servers",
  10: "Sleeves",
  11: "Digital Watch",
  12: "The Dark Knight",
  13: "They're Everywhere!",
  14: "Dexterity",
  15: "Spread Incarnation",
}

const BITNODE_OPTION_LABELS: Record<string, string> = {
  restrictHomePCUpgrade: "Restrict home PC upgrades",
  disableGang: "Disable gang",
  disableCorporation: "Disable corporation",
  disableBladeburner: "Disable Bladeburner",
  disable4SData: "Disable 4S market data",
  disableHacknetServer: "Disable Hacknet servers",
  disableSleeveExpAndAugmentation: "Disable sleeve exp and augmentations",
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

function formatTimestamp(timestamp: number): string {
  if (timestamp <= 0) return "never"
  return new Date(timestamp).toLocaleString()
}

function formatSourceFiles(ownedSF: Map<number, number>): string {
  if (ownedSF.size === 0) return "none"

  return [...ownedSF.entries()]
    .sort(([a], [b]) => a - b)
    .map(([sf, lvl]) => `SF${sf}.${lvl}`)
    .join(", ")
}

function formatActiveBitNodeOptions(options: BitNodeBooleanOptions): string {
  const active = (Object.keys(BITNODE_OPTION_LABELS) as (keyof BitNodeBooleanOptions)[])
    .filter((key) => options[key] === true)
    .map((key) => BITNODE_OPTION_LABELS[key])

  return active.length > 0 ? active.join(", ") : "none (default)"
}

export async function main(ns: NS): Promise<void> {
  const resetInfo = ns.getResetInfo()
  const player = ns.getPlayer()
  const now = Date.now()

  const bitNode = resetInfo.currentNode
  const bitNodeName = BITNODE_NAMES[bitNode] ?? "Unknown"
  const homeRam = ns.getServerMaxRam("home")
  const homeCores = ns.getServer("home").cpuCores
  const jobs = Object.entries(player.jobs)

  ns.tprint("=".repeat(60))
  ns.tprint("BITBURNER STATUS")
  ns.tprint("=".repeat(60))
  ns.tprint(`BitNode: ${bitNode} — ${bitNodeName}`)
  ns.tprint(`Source files: ${formatSourceFiles(resetInfo.ownedSF)}`)
  ns.tprint(`BitNode options: ${formatActiveBitNodeOptions(resetInfo.bitNodeOptions)}`)
  ns.tprint("")
  ns.tprint(`Last BitNode reset: ${formatTimestamp(resetInfo.lastNodeReset)} (${formatDuration(now - resetInfo.lastNodeReset)} ago)`)
  ns.tprint(`Last aug install: ${formatTimestamp(resetInfo.lastAugReset)} (${formatDuration(now - resetInfo.lastAugReset)} ago)`)
  ns.tprint(`Total playtime (all BNs): ${formatDuration(player.totalPlaytime)}`)
  ns.tprint("")
  ns.tprint(`Money: $${ns.format.number(player.money)}`)
  ns.tprint(`Hacking level: ${player.skills.hacking}`)
  ns.tprint(`Location: ${player.location} (${player.city})`)
  ns.tprint(`Home RAM: ${ns.format.ram(homeRam)} (${homeCores} core${homeCores === 1 ? "" : "s"})`)
  ns.tprint(`Factions: ${player.factions.length}${player.factions.length > 0 ? ` — ${player.factions.join(", ")}` : ""}`)
  ns.tprint(`Jobs: ${jobs.length > 0 ? jobs.map(([company, title]) => `${title} @ ${company}`).join(", ") : "none"}`)
  ns.tprint(`Augmentations installed: ${resetInfo.ownedAugs.size}`)
  ns.tprint(`Karma: ${ns.format.number(player.karma)}`)
  ns.tprint("=".repeat(60))
}
