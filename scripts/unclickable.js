/** @param {import("..").NS } ns */
export async function main(ns) {
    const element = document.getElementById("unclickable")
    const handler = Object.keys(element)[1]
    element[handler].onClick({ target: element, isTrusted: true })
    let target = "n00dles"
    ns.exploit()
    await eval("ns.grow(target)")
}
