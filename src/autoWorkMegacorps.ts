import { CompanyName, NS } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations.js"
import {
  buildMegacorpPositionRows,
  buildMegacorpPositionTableConfig,
  buildMegacorpRows,
  buildMegacorpTableConfig,
  getFactionName,
  getMegacorps,
  getRequiredRep,
  isMegacorpFactionUnlocked,
  isStudyingLeadershipAtVolhaven,
  isWorkingAtCompany,
  needsMegacorpJobApply,
  pickBestCompanyField,
  type MegacorpWorkSnapshot,
} from "./libraries/megacorpWork.js"
import { createTailLog, openTailLog } from "./libraries/scriptLogUiLayout.js"

const ACTIVE_INTERVAL_MS = 1000
const STABLE_INTERVAL_MS = 5000

async function renderMegacorpTable(ns: NS, snapshot: MegacorpWorkSnapshot, megacorps: CompanyName[]): Promise<void> {
  const log = createTailLog()
  const rows = buildMegacorpRows(ns, snapshot, megacorps)
  log.table(buildMegacorpTableConfig(ns, rows, snapshot))

  const positionRows = buildMegacorpPositionRows(ns, snapshot)
  if (positionRows.length > 0) {
    log.table(buildMegacorpPositionTableConfig(ns, positionRows, snapshot))
  }

  await log.render(ns)
}

export async function main(ns: NS): Promise<void> {
  await killOtherInstances(ns)
  openTailLog(ns, "Megacorp Work")

  const megacorps = getMegacorps(ns)
  const completedCompanies: CompanyName[] = []

  for (const company of megacorps) {
    const factionName = getFactionName(company)

    if (isMegacorpFactionUnlocked(ns, company)) {
      completedCompanies.push(company)
      const skipSnapshot: MegacorpWorkSnapshot = {
        currentCompany: company,
        completedCompanies,
        charismaGrind: false,
        focus: ns.singularity.isFocused(),
        bestField: null,
        bestPosition: null,
        bestRepPerSecond: null,
        alreadyWorking: false,
        needsApply: false,
        message: `Already in ${factionName} — skipping`,
      }
      await renderMegacorpTable(ns, skipSnapshot, megacorps)
      continue
    }

    const requiredRep = getRequiredRep(company)

    while (true) {
      const focus = ns.singularity.isFocused()
      const currentRep = ns.singularity.getCompanyRep(company)
      const currentCharisma = ns.getPlayer().skills.charisma
      const charismaGrind = currentCharisma < 500

      let snapshot: MegacorpWorkSnapshot = {
        currentCompany: company,
        completedCompanies,
        charismaGrind,
        focus,
        bestField: null,
        bestPosition: null,
        bestRepPerSecond: null,
        alreadyWorking: isWorkingAtCompany(ns, company),
        needsApply: false,
        message: charismaGrind ? "Training charisma (Volhaven)" : "",
      }

      if (charismaGrind) {
        if (!isStudyingLeadershipAtVolhaven(ns)) {
          ns.singularity.universityCourse(
            ns.enums.LocationName.VolhavenZBInstituteOfTechnology,
            ns.enums.UniversityClassType.leadership,
            focus
          )
        }
        await renderMegacorpTable(ns, snapshot, megacorps)
        await ns.sleep(ACTIVE_INTERVAL_MS)
        continue
      }

      if (currentRep >= requiredRep) {
        const invitations = ns.singularity.checkFactionInvitations()
        if (invitations.includes(factionName)) {
          ns.singularity.joinFaction(factionName)
          snapshot.message = `Joined ${factionName}`
        } else {
          snapshot.message = `Waiting for ${factionName} invite`
        }
        completedCompanies.push(company)
        await renderMegacorpTable(ns, snapshot, megacorps)
        break
      }

      const positions = ns.singularity.getCompanyPositions(company)
      if (positions.length === 0) {
        snapshot.message = `ERROR: No positions at ${company}`
        await renderMegacorpTable(ns, snapshot, megacorps)
        return
      }

      const player = ns.getPlayer()
      const companyFavor = ns.singularity.getCompanyFavor(company)
      const best = pickBestCompanyField(ns, company, positions, player, companyFavor, currentRep)

      if (!best) {
        snapshot.message = `ERROR: No qualified job at ${company}`
        await renderMegacorpTable(ns, snapshot, megacorps)
        return
      }

      const currentJob = player.jobs[company]
      const alreadyWorking = isWorkingAtCompany(ns, company)
      const needsApply = needsMegacorpJobApply(ns, company, best)

      snapshot = {
        ...snapshot,
        bestField: best.field,
        bestPosition: best.positionName,
        bestRepPerSecond: best.repPerSecond,
        alreadyWorking,
        needsApply,
        message: "",
      }

      if (needsApply) {
        const jobName = ns.singularity.applyToCompany(company, best.field)
        snapshot.message = jobName
          ? `Applied ${best.field}: ${jobName}`
          : currentJob
            ? `Cannot switch to ${best.field}`
            : `Cannot apply ${best.field}`
      } else if (!alreadyWorking) {
        const working = ns.singularity.workForCompany(company, focus)
        snapshot.message = working ? "Started work" : `ERROR: Failed to work at ${company}`
        snapshot.alreadyWorking = working ? isWorkingAtCompany(ns, company) : false
        if (!working) {
          await renderMegacorpTable(ns, snapshot, megacorps)
          return
        }
      }

      await renderMegacorpTable(ns, snapshot, megacorps)

      const interval = alreadyWorking && !needsApply ? STABLE_INTERVAL_MS : ACTIVE_INTERVAL_MS
      await ns.sleep(interval)
    }
  }

  const doneSnapshot: MegacorpWorkSnapshot = {
    currentCompany: megacorps[megacorps.length - 1],
    completedCompanies: [...megacorps],
    charismaGrind: false,
    focus: ns.singularity.isFocused(),
    bestField: null,
    bestPosition: null,
    bestRepPerSecond: null,
    alreadyWorking: false,
    needsApply: false,
    message: "All megacorps done — starting faction work",
  }
  await renderMegacorpTable(ns, doneSnapshot, megacorps)
  ns.exec("autoWorkFactions.js", "home")
}
