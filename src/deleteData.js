/** @param {import("..").NS } ns */
export async function main(ns) {
  const list = ns.ls(ns.getHostname(), "/data/")
  for (const file of list) {
    ns.rm(file)
  }
}
