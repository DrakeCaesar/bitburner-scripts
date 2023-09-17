/** @param {import("..").NS } ns */
export async function main(ns) {
  const list = ns.ls(ns.getHostname(), ".lit")
  for (const file of list) {
    await ns.scp(file, "home")
    //ns.mv("home", file, "/literature/" + file)
  }
}
