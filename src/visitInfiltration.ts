import { CityName, NS } from "@ns"
import {
  clickStartInfiltration,
  isInfiltrationActive,
  isOnInfiltrationIntro,
  visitInfiltrationTargetDom,
} from "./libraries/infiltration/infiltrationNavigation.js"
import { getEasiestInfiltrationTarget, getInfiltrationApi } from "./libraries/infiltration/infiltrationTargets.js"
import {
  collectInfiltrationVictoryReward,
  isInfiltrationVictoryScreen,
} from "./libraries/infiltration/infiltrationVictory.js"

const POLL_MS = 200
const STEP_TIMEOUT_MS = 15000
const RUN_TIMEOUT_MS = 600000

function resolveTargetName(ns: NS): string | null {
  const arg = String(ns.args[0] ?? "").trim()
  if (arg) return arg

  const target = getEasiestInfiltrationTarget(ns)
  return target?.name ?? null
}

function resolveTargetCity(ns: NS, locationName: string): CityName | null {
  const infiltration = getInfiltrationApi(ns)
  if (!infiltration) return null

  try {
    return infiltration.getInfiltration(locationName).location.city as CityName
  } catch {
    return null
  }
}

async function travelToCity(ns: NS, city: CityName): Promise<boolean> {
  if (ns.getPlayer().city === city) {
    ns.print(`Already in ${city}`)
    return true
  }

  if (!ns.singularity.travelToCity(city)) {
    ns.print(`ERROR: travelToCity(${city}) failed (need Singularity API + funds?)`)
    return false
  }

  ns.print(`Traveled to ${city}`)
  await ns.sleep(500)
  return true
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")

  if (!getInfiltrationApi(ns)) {
    ns.print("ERROR: ns.infiltration API is not available")
    return
  }

  const locationName = resolveTargetName(ns)
  if (!locationName) {
    ns.print("ERROR: No available infiltration targets found")
    return
  }

  const city = resolveTargetCity(ns, locationName)
  if (!city) {
    ns.print(`ERROR: Could not resolve city for ${locationName}`)
    return
  }

  const target = getEasiestInfiltrationTarget(ns)
  if (target?.name === locationName) {
    ns.print(
      `Target: ${target.name} (${target.city}, ${target.tier}, rating ${target.rating.toFixed(0)})`
    )
  } else {
    ns.print(`Target: ${locationName} (${city})`)
  }

  if (isInfiltrationActive()) {
    ns.print("Infiltration already in progress")
    return
  }

  if (!(await travelToCity(ns, city))) {
    return
  }

  const deadline = Date.now() + STEP_TIMEOUT_MS
  const runDeadline = Date.now() + RUN_TIMEOUT_MS
  let lastStep = ""
  let victoryHandled = false
  let infiltrationStarted = false

  while (Date.now() < runDeadline) {
    if (isInfiltrationVictoryScreen()) {
      if (!victoryHandled) {
        const reward = collectInfiltrationVictoryReward(ns)
        if (reward.ok) {
          victoryHandled = true
          ns.print(`Victory reward: ${reward.detail}`)
          return
        }
        ns.print(`Victory reward failed: ${reward.detail}`)
      }
      await ns.sleep(POLL_MS)
      continue
    }
    victoryHandled = false

    if (infiltrationStarted && isInfiltrationActive()) {
      await ns.sleep(POLL_MS)
      continue
    }

    if (Date.now() >= deadline && !infiltrationStarted) {
      ns.print(`ERROR: Timed out visiting ${locationName}`)
      return
    }

    if (isInfiltrationActive()) {
      ns.print(`Infiltration running at ${locationName}. Use infiltrationDom.js for minigames.`)
      infiltrationStarted = true
      await ns.sleep(POLL_MS)
      continue
    }

    if (isOnInfiltrationIntro(locationName) && clickStartInfiltration()) {
      ns.print(`Started infiltration at ${locationName}`)
      infiltrationStarted = true
      await ns.sleep(POLL_MS)
      continue
    }

    if (Date.now() >= deadline) {
      await ns.sleep(POLL_MS)
      continue
    }

    const result = visitInfiltrationTargetDom(locationName)
    if (result.step !== lastStep) {
      ns.print(`Step: ${result.step}${result.detail ? ` (${result.detail})` : ""}`)
      lastStep = result.step
    }

    if (!result.ok) {
      ns.print(`ERROR: ${result.step}${result.detail ? `: ${result.detail}` : ""}`)
      return
    }

    if (result.step === "started") {
      ns.print(`Infiltration started at ${locationName}`)
      infiltrationStarted = true
      await ns.sleep(POLL_MS)
      continue
    }

    await ns.sleep(POLL_MS)
  }

  ns.print(`ERROR: Timed out waiting for infiltration at ${locationName}`)
}
