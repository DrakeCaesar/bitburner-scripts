import { NS } from "@ns"
export async function main(ns: NS) {
  const player = ns.getPlayer()
  const server = ns.getServer("omega-net")
  const hackTime = ns.formulas.hacking.hackTime(server, player)
  ns.tprint(`hackTime: ${hackTime}`)
  const delta = getDelta(hackTime, 5)
  ns.tprint(`delta: ${delta}`)
}

function getDeltaInterval(hackTime: number, index: number) {
  if (index === 0) {
    return [hackTime, Infinity]
  } else {
    const lowerBound = hackTime / (2 * index + 1)
    const upperBound = hackTime / (2 * index)
    return [lowerBound, upperBound]
  }
}

function getDelta(hackTime: number, index: number) {
  if (index === 0) {
    // For index 0, the interval is [hackTime, Infinity), so we'll just return hackTime.
    return hackTime
  } else {
    const [lower, upper] = getDeltaInterval(hackTime, index)
    return (lower + upper) / 2
  }
}
