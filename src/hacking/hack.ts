import { NS } from "@ns"

export async function main(ns: NS) {
  const target = ns.args[0]
  const delay = ns.args[1] ? Number(ns.args[1]) : 0
  const stolen = await ns.hack(target as string, { additionalMsec: delay })

  const reportPort = ns.args.length >= 6 ? Number(ns.args[5]) : 0
  if (Number.isInteger(reportPort) && reportPort > 0) {
    ns.writePort(reportPort, stolen)
  }
}
