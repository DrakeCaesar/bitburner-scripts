/** @param {import("../..").NS } ns */
export async function main(ns) {
    ns.disableLog("ALL")
    let target = ns.args[0]
    target = "n00dles"
    let steal = 0.9
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


    ns.print("start")
    ns.print(
        "\nmoney         " + ((moneyCur / moneyMax) * 100).toFixed(2) + "%" +
        "\nmoney         " + (moneyMax * (1 - steal) * (1 - monT)).toFixed(0) + " <= " + moneyCur.toFixed(0) + " <= " + (moneyMax * (1 - steal) * (1 + monT)).toFixed(0) +
        "\nsecurity      " + (securityMin).toFixed(2) + " + " + (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
        "\n"
    )
    await ns.sleep(1000)


    let needSetGrow = true
    let needSetHack = true

    ns.print("variable setup")


    while (needSetGrow || needSetHack) {

        moneyCur = ns.getServerMoneyAvailable(target)
        securityCur = ns.getServerSecurityLevel(target);

        if (moneyMax == moneyCur && securityMin == securityCur) {

            hackThreads = Math.floor(ns.hackAnalyzeThreads(target, moneyMax * steal));
            hackTime = ns.getHackTime(target)
            hackSecurity = ns.hackAnalyzeSecurity(hackThreads, target)

            for (hackWeakThreads = 0; ns.weakenAnalyze(hackWeakThreads) <= hackSecurity; ++hackWeakThreads);
            hackWeakThreads = Math.ceil(hackWeakThreads)
            hackWeakTime = ns.getWeakenTime(target)
            needSetHack = false
            if (needSetGrow) {
                ns.print("hacking variables setup")
                ns.print(
                    "\n" +
                    "\nhack Threads  " + hackThreads +
                    "\nhack Time     " + ns.tFormat(hackTime) +
                    "\nhack Security " + hackSecurity.toFixed(2) +
                    "\n" +
                    "\nweak Threads  " + hackWeakThreads +
                    "\nweak Time     " + ns.tFormat(hackWeakTime) +
                    "\n" +
                    "\nmoney         " + ((moneyCur / moneyMax) * 100).toFixed(2) + "%" +
                    "\nsecurity      " + (securityMin).toFixed(2) + " + " + (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
                    "\n"
                )
                ns.print("RUN HACK")
                var pid1 = ns.run("/hacking/hack.js", hackThreads, target)
                ns.print("RUN WEAK")
                var pid2 = hackWeakThreads ? ns.run("/hacking/weaken.js", hackWeakThreads, target) : pid1
                if (ns.getRunningScript(pid1) == null || ns.getRunningScript(pid2) == null) {
                    ns.kill(pid1);
                    ns.kill(pid2);
                    ns.print("out of Memory")
                    continue;
                }
                await ns.sleep(Math.max(hackTime, hackWeakThreads ? hackWeakTime : 0))
                while (ns.getRunningScript(pid1) != null || ns.getRunningScript(pid2) != null) {
                    ns.print("this should not happen")
                    await ns.sleep(100)
                }
                moneyCur = ns.getServerMoneyAvailable(target)
                securityCur = ns.getServerSecurityLevel(target);
                ns.print(
                    "\nmoney         " + ((moneyCur / moneyMax) * 100).toFixed(2) + "%" +
                    "\nsecurity      " + (securityMin).toFixed(2) + " + " + (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
                    "\n"
                )
            }


        } else if (moneyCur >= moneyMax * (1 - steal) * (1 - monT) && moneyCur <= moneyMax * (1 - steal) * (1 + monT) && securityMin == securityCur) {

            growThreads = Math.ceil(ns.growthAnalyze(target, 1 / (1 - steal)))
            growTime = ns.getGrowTime(target)
            growSecurity = ns.growthAnalyzeSecurity(growThreads, target, 1)

            for (growWeakThreads = 0; ns.weakenAnalyze(growWeakThreads) <= growSecurity; ++growWeakThreads);
            growWeakTime = ns.getWeakenTime(target)
            growWeakThreads = Math.ceil(growWeakThreads)
            needSetGrow = false

            if (needSetHack) {
                ns.print("growing variables setup")
                ns.print(
                    "\n" +
                    "\ngrow Threads  " + growThreads +
                    "\ngrow Time     " + ns.tFormat(growTime) +
                    "\ngrow Security " + growSecurity.toFixed(2) +
                    "\n" +
                    "\nweak Threads  " + growWeakThreads +
                    "\nweak Time     " + ns.tFormat(growWeakTime) +
                    "\n" +
                    "\nmoney         " + ((moneyCur / moneyMax) * 100).toFixed(2) + "%" +
                    "\nsecurity      " + (securityMin).toFixed(2) + " + " + (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
                    "\n"
                )
                ns.print("RUN GROW")
                var pid1 = ns.run("/hacking/grow.js", growThreads, target)
                ns.print("RUN WEAK")
                var pid2 = growWeakThreads ? ns.run("/hacking/weaken.js", growWeakThreads, target) : pid1
                if (ns.getRunningScript(pid1) == null || ns.getRunningScript(pid2) == null) {
                    ns.kill(pid1);
                    ns.kill(pid2);
                    ns.print("out of Memory")
                    continue;
                }
                await ns.sleep(Math.max(growTime, growWeakThreads ? growWeakTime : 0))
                while (ns.getRunningScript(pid1) != null || ns.getRunningScript(pid2) != null) {
                    ns.print("this should not happen")
                    await ns.sleep(100)
                }
                moneyCur = ns.getServerMoneyAvailable(target)
                securityCur = ns.getServerSecurityLevel(target);
                ns.print(
                    "\nmoney         " + ((moneyCur / moneyMax) * 100).toFixed(2) + "%" +
                    "\nsecurity      " + (securityMin).toFixed(2) + " + " + (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
                    "\n"
                )
            }

        } else {
            ns.print("undesirable state")
            var tempGrowThreads = Math.ceil(ns.growthAnalyze(target, moneyMax / moneyCur))
            var tempGrowTime = ns.getGrowTime(target)
            var tempGrowSecurity = ns.growthAnalyzeSecurity(tempGrowThreads, target, 1) + securityCur - securityMin
            var tempGrowWeakThreads
            for (tempGrowWeakThreads = 0; ns.weakenAnalyze(tempGrowWeakThreads) <= tempGrowSecurity; ++tempGrowWeakThreads);
            var tempGrowWeakTime = ns.getWeakenTime(target)
            tempGrowWeakThreads = Math.ceil(tempGrowWeakThreads)
            ns.print("RUN GROW AFTER BUG")
            var pid1 = ns.run("/hacking/grow.js", (tempGrowThreads > 0) ? tempGrowThreads : 1, target)
            ns.print("RUN WEAK AFTER BUG")
            var pid2 = tempGrowWeakThreads ? ns.run("/hacking/weaken.js", tempGrowWeakThreads, target) : pid1
            if (ns.getRunningScript(pid1) == null || ns.getRunningScript(pid2) == null) {
                ns.kill(pid1);
                ns.kill(pid2);
                ns.print("out of Memory")
                continue;
            }
            await ns.sleep(Math.max(tempGrowTime, tempGrowWeakThreads ? tempGrowWeakTime : 0))
            while (ns.getRunningScript(pid1) != null || ns.getRunningScript(pid2) != null) {
                ns.print("this should not happen")
                await ns.sleep(100)
            }

        }
        await ns.sleep(100)
    }
    ns.print("end print")
    ns.print(
        "\n" +
        "\nhack Threads  " + hackThreads +
        "\nhack Time     " + ns.tFormat(hackTime) +
        "\nhack Security " + hackSecurity.toFixed(2) +
        "\n" +
        "\nweak Threads  " + hackWeakThreads +
        "\nweak Time     " + ns.tFormat(hackWeakTime) +
        "\n" +
        "\ngrow Threads  " + growThreads +
        "\ngrow Time     " + ns.tFormat(growTime) +
        "\ngrow Security " + growSecurity.toFixed(2) +
        "\n" +
        "\nweak Threads  " + growWeakThreads +
        "\nweak Time     " + ns.tFormat(growWeakTime) +
        "\n" +
        "\nmoney         " + ((moneyCur / moneyMax) * 100).toFixed(2) + "%" +
        "\nsecurity      " + (securityMin).toFixed(2) + " + " + (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
        "\n"
    )
    let sleepOffset = 100;
    let loop = 0;
    /*
    if (moneyCur <= moneyMax) {
        ns.run("/hacking/grow.js", growThreads, target, growWeakTime - growTime, ++loop)
        await debugPrint(ns, sleepOffset, target)
        ns.run("/hacking/weaken.js", growWeakThreads, target, 0, ++loop)
        await debugPrint(ns, sleepOffset, target)
    }
    */

    let totalMemory = (2.6 * (2 * hackWeakTime - hackTime - growTime) + 1.7 * (hackTime * hackThreads) + 1.75 * (growTime * growThreads)) / hackWeakTime +
        1.75 * (hackWeakThreads + growWeakThreads)

    let realMemory = 0

    ns.tprint("total: " + totalMemory)
    ns.tprint("real : " + realMemory)

    while (true) {
        ns.run("/hacking/hackRunner.js", 1, hackThreads, target, hackWeakTime - hackTime, ++loop)
        //let message = "| " + await debugPrint(ns, sleepOffset, target)
        ns.run("/hacking/weaken.js", hackWeakThreads, target, ++loop)
        //message += await debugPrint(ns, sleepOffset, target)
        ns.run("/hacking/growRunner.js", 1, growThreads, target, growWeakTime - growTime, ++loop)
        //message += await debugPrint(ns, sleepOffset, target)
        ns.run("/hacking/weaken.js", growWeakThreads, target, ++loop)
        //message += await debugPrint(ns, sleepOffset, target)
        //ns.print(message)
        let time = 0
        let sum = 0
        while (true) {
            let currentMem = ns.getServerUsedRam(ns.getHostname()) - 9.05
            time++
            if (currentMem != 0) {
                sum += currentMem
                //ns.tprint(currentMem)
                await ns.sleep(100)
            } else {
                ns.tprint(
                    "\n" +
                    "\nestimate:   " + totalMemory +
                    "\nactual:     " + sum / time +
                    "\ndifference: " + (totalMemory - sum / time) +
                    "\n"
                )
                return
            }

        }

    }

}



/** @param {import("../..").NS } ns */
export async function debugPrint(ns, sleepOffset, target) {
    await ns.sleep(sleepOffset * .9)
    let moneyMax = ns.getServerMaxMoney(target)
    let securityMin = ns.getServerMinSecurityLevel(target);
    let moneyCur = ns.getServerMoneyAvailable(target)
    let securityCur = ns.getServerSecurityLevel(target);
    let message = (moneyCur / moneyMax * 100).toFixed(2).padStart(6) + "% " + (securityCur - securityMin).toFixed(2) + " | "
    await ns.sleep(sleepOffset * .1)
    return message
}

/** @param {import("../..").NS } ns */
export async function parameters(ns, sleepOffset, target) {

}