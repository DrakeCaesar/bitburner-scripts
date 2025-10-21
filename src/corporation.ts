import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
  const corp = ns.corporation

  if (!corp.hasCorporation()) {
    if (corp.canCreateCorporation(true) == "Success") {
      corp.createCorporation("DraeCorp", true)
    } else if (corp.canCreateCorporation(false)) {
      corp.createCorporation("DraeCorp", false)
    } else {
      ns.tprint("I can't afford it")
      return
    }
  }

  const constants = corp.getConstants()
  const stats = corp.getCorporation()
  ns.tprint(JSON.stringify(stats, null, 2))
}
