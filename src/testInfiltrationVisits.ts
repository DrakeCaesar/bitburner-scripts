import { CityName, NS } from "@ns"
import {
  isInfiltrationActive,
  isOnAnyInfiltrationIntro,
  isOnInfiltrationIntro,
  resetToCityForNextVisit,
  visitInfiltrationIntroDom,
} from "./libraries/infiltration/infiltrationNavigation.js"
import {
  getInfiltrationApi,
  getInfiltrationTargetsByCity,
  type InfiltrationTarget,
} from "./libraries/infiltration/infiltrationTargets.js"
import { buildTable } from "./libraries/tableBuilder.js"

const POLL_MS = 200
const STEP_TIMEOUT_MS = 15000
const RESET_SLEEP_MS = 300

interface VisitTestResult {
  ok: boolean
  detail: string
}

async function travelToCity(ns: NS, city: CityName): Promise<boolean> {
  if (ns.getPlayer().city === city) {
    return true
  }

  if (!ns.singularity.travelToCity(city)) {
    return false
  }

  await ns.sleep(500)
  return true
}

async function tryVisitIntro(ns: NS, target: InfiltrationTarget): Promise<VisitTestResult> {
  resetToCityForNextVisit()
  await ns.sleep(RESET_SLEEP_MS)

  const deadline = Date.now() + STEP_TIMEOUT_MS
  let lastStep = ""

  while (Date.now() < deadline) {
    if (isInfiltrationActive()) {
      return { ok: false, detail: "infiltration started unexpectedly" }
    }

    if (isOnInfiltrationIntro(target.name)) {
      resetToCityForNextVisit()
      await ns.sleep(RESET_SLEEP_MS)
      return { ok: true, detail: "intro ok" }
    }

    if (isOnAnyInfiltrationIntro()) {
      resetToCityForNextVisit()
      await ns.sleep(RESET_SLEEP_MS)
      continue
    }

    const result = visitInfiltrationIntroDom(ns, target.name, target.city)
    if (result.step !== lastStep) {
      ns.print(`  step: ${result.step}${result.detail ? ` (${result.detail})` : ""}`)
      lastStep = result.step
    }

    if (!result.ok) {
      return { ok: false, detail: result.detail ?? result.step }
    }

    await ns.sleep(POLL_MS)
  }

  return { ok: false, detail: "timeout" }
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")
  ns.ui.openTail()
  ns.ui.setTailTitle("Infiltration visit test")

  if (!getInfiltrationApi(ns)) {
    ns.print("ERROR: ns.infiltration API is not available")
    return
  }

  if (isInfiltrationActive()) {
    ns.print("ERROR: Cancel any active infiltration before running this test")
    return
  }

  const cityGroups = getInfiltrationTargetsByCity(ns)
  const total = cityGroups.reduce((sum, group) => sum + group.targets.length, 0)

  if (total === 0) {
    ns.print("ERROR: No infiltration locations found")
    return
  }

  ns.print(`Testing ${total} locations across ${cityGroups.length} cities (intro only, no Start)`)
  ns.print("")

  const resultRows: string[][] = []
  let passed = 0
  let failed = 0

  for (const group of cityGroups) {
    ns.print(`--- ${group.city} (${group.targets.length}) ---`)

    if (!(await travelToCity(ns, group.city))) {
      for (const target of group.targets) {
        failed++
        resultRows.push([group.city, target.name, target.tier, "FAIL", "travelToCity failed"])
        ns.print(`FAIL  ${target.name}  travelToCity failed`)
      }
      ns.print("")
      continue
    }

    ns.print(`In ${group.city}`)

    for (const target of group.targets) {
      ns.print(`Visit ${target.name} (${target.tier}, rating ${target.rating.toFixed(0)})`)
      const result = await tryVisitIntro(ns, target)

      if (result.ok) {
        passed++
        resultRows.push([group.city, target.name, target.tier, "OK", result.detail])
        ns.print(`OK    ${target.name}`)
      } else {
        failed++
        resultRows.push([group.city, target.name, target.tier, "FAIL", result.detail])
        ns.print(`FAIL  ${target.name}  ${result.detail}`)
      }
    }

    ns.print("")
  }

  resetToCityForNextVisit()

  ns.print("")
  ns.print(`Done: ${passed} passed, ${failed} failed, ${total} total`)
  ns.print("")

  const table = buildTable({
    title: "Infiltration visit test results",
    columns: [
      { header: "City", align: "left", minWidth: 14 },
      { header: "Location", align: "left", minWidth: 28 },
      { header: "Tier", align: "left", minWidth: 10 },
      { header: "Result", align: "left", minWidth: 6 },
      { header: "Detail", align: "left", minWidth: 24 },
    ],
    rows: resultRows,
  })

  ns.print(table)
}
