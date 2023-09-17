/** @param {import("..").NS } ns */
export function main(ns) {
  let list = ns.ls("home", ".js")

  list.forEach((element) => {
    ns.tprint(element)
    ns.rm(element)
  })
}
