/** @param {import("..").NS } ns */
export async function main(ns) {
    //ns.disableLog("ALL")
    let target = ns.args[0]
    let mF = 0.08

    let moneyMax = ns.getServerMaxMoney(target)
    let securityMin = ns.getServerMinSecurityLevel(target)
    let securityT = 3

    let pid = 0
    let pidW = 0
    let weaken = 0

    for (;;) {
        await ns.sleep(100)
        let moneyCur = ns.getServerMoneyAvailable(target)
        let securityCur = (
            ns.getServerSecurityLevel(target) - securityMin
        ).toFixed(2)
        let moneyP = String(
            Math.floor((moneyCur / moneyMax) * 100) + "%"
        ).padStart(4)
        let ramT = 1
        let current = ns.getHostname()
        let ram = ns.getServerMaxRam(current) - ns.getServerUsedRam(current)
        //ns.tprint(ram)
        //ns.tprint(ram / ns.getScriptRam("/hacking/hack.js"))

        let ramC = ns.getServerUsedRam(current) / ns.getServerMaxRam(current)

        if (ns.getRunningScript(pid) == null && ramC <= ramT) {
            let action
            let threads
            let runtime

            if (ns.getRunningScript(pidW) == null && securityCur > securityT) {
                for (
                    threads = 1;
                    securityCur > ns.weakenAnalyze(threads);
                    threads++
                );
                threads = Math.min(
                    threads,
                    Math.floor(ram / ns.getScriptRam("/hacking/weaken.js"))
                )
                action = "weak"
                runtime = ns.getWeakenTime(target)
                if (threads)
                    pidW = ns.run("/hacking/weaken.js", threads, target)
                weaken = 1
            } else if (moneyCur == moneyMax && securityCur < securityT * 2) {
                threads = Math.ceil(
                    ns.hackAnalyzeThreads(target, moneyMax * mF)
                )
                threads = Math.min(
                    threads,
                    Math.floor(ram / ns.getScriptRam("/hacking/hack.js"))
                )
                action = "hack"
                runtime = ns.getHackTime(target)

                if (threads) pid = ns.run("/hacking/hack.js", threads, target)
            } else if (moneyCur < moneyMax && securityCur < securityT * 2) {
                //threads = Math.ceil(ns.growthAnalyze(target,1.0/(1.0-mF)))
                if (moneyCur < moneyMax * 0.01) {
                    threads = 1000
                } else {
                    threads = Math.ceil(
                        ns.growthAnalyze(target, moneyMax / moneyCur)
                    )
                }
                threads = Math.min(
                    threads,
                    Math.floor(ram / ns.getScriptRam("/hacking/grow.js"))
                )
                action = "grow"
                runtime = ns.getGrowTime(target)
                if (threads) pid = ns.run("/hacking/grow.js", threads, target)
            }

            if (
                ns.getRunningScript(pid != null || weaken == 1) &&
                threads &&
                !isNaN(runtime)
            ) {
                var message =
                    target.padEnd(18) +
                    " | " +
                    action +
                    " | " +
                    "t " +
                    String(threads).padStart(4) +
                    " | " +
                    "S " +
                    String(securityMin).padStart(3) +
                    " + " +
                    securityCur.padStart(6) +
                    " | " +
                    "$ " +
                    moneyP +
                    " | " +
                    "T " +
                    ns.tFormat(runtime).padStart(30)

                ns.tprint(message)
                ns.print(message)
                weaken = 0
            } else {
                ns.print("failed")
            }
        }
    }
}
