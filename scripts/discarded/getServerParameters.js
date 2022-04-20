/** @param {import("../..").NS } ns */
export async function main(ns) {
    let target = ns.args[0]
    target = "n00dles"
    let steal = 0.8
    let monT = 0.05

    let hackThreads
    let hackTime
    let hackSecurity
    let hackWeakThreads
    let hackWeakTime

    let growThreads
    let growTime
    let growSecurity
    let growWeakThreads
    let growWeakTime

    let moneyMax = ns.getServerMaxMoney(target)
    let securityMin = ns.getServerMinSecurityLevel(target);

    let moneyCur = ns.getServerMoneyAvailable(target)
    let securityCur = ns.getServerSecurityLevel(target);

    let growMult = ns.getServerGrowth(target)

}