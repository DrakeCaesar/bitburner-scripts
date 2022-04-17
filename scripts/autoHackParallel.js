/** @param {import("..").NS } ns */
export async function main(ns) {
    let target = ns.args[0]
    target = "n00dles"
    let steal = 0.8
    let monT = 0.05

    let hackThreads
    let hackTime
    let hackSecurity
    let hackWeakThreads
    let hackweakTime

    let growThreads
    let growTime
    let growSecurity
    let growWeakThreads
    let growWeakTime

    let moneyMax = ns.getServerMaxMoney(target)
    let securityMin = ns.getServerMinSecurityLevel(target);

    let moneyCur = ns.getServerMoneyAvailable(target)
    let securityCur = ns.getServerSecurityLevel(target);


    ns.tprint("start")
    ns.tprint(
        "\nmoney         " + ((moneyCur / moneyMax) * 100).toFixed(2) + "%" +
        "\nmoney         " + (moneyMax * (1 - steal) * (1 - monT)).toFixed(0) + " <= " + moneyCur.toFixed(0) + " <= " + (moneyMax * (1 - steal) * (1 + monT)).toFixed(0) +
        "\nsecurity      " + (securityMin).toFixed(2) + " + " + (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
        "\n"
    )
    await ns.sleep(1000)


    let needSetGrow = true
    let needSetHack = true

    ns.tprint("variable setup")


    while (needSetGrow || needSetHack) {

        moneyCur = ns.getServerMoneyAvailable(target)
        securityCur = ns.getServerSecurityLevel(target);

        if (moneyMax == moneyCur && securityMin == securityCur) {

            hackThreads = Math.floor(ns.hackAnalyzeThreads(target, moneyMax * steal));
            hackTime = ns.getHackTime(target)
            hackSecurity = ns.hackAnalyzeSecurity(hackThreads, target)

            for (hackWeakThreads = 0; ns.weakenAnalyze(hackWeakThreads) <= hackSecurity; ++hackWeakThreads);
            hackWeakThreads = Math.ceil(hackWeakThreads)
            hackweakTime = ns.getWeakenTime(target)
            needSetHack = false
            if (needSetGrow) {
                ns.tprint("hacking variables setup")
                ns.tprint(
                    "\nhack Threads  " + hackThreads +
                    "\nhack Time     " + ns.tFormat(hackTime) +
                    "\nhack Security " + hackSecurity.toFixed(2) +
                    "\n" +
                    "\nweak Threads  " + hackWeakThreads +
                    "\nweak Time     " + ns.tFormat(hackweakTime) +
                    "\n" +
                    "\nmoney         " + ((moneyCur / moneyMax) * 100).toFixed(2) + "%" +
                    "\nsecurity      " + (securityMin).toFixed(2) + " + " + (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
                    "\n"
                )
                ns.tprint("RUN HACK")
                var pid1 = ns.run("hack.js", hackThreads, target)
                ns.tprint("RUN WEAK")
                var pid2 = hackWeakThreads ? ns.run("weaken.js", hackWeakThreads, target) : pid1
                if (ns.getRunningScript(pid1) == null || ns.getRunningScript(pid2) == null) {
                    ns.kill(pid1);
                    ns.kill(pid2);
                    ns.tprint("out of Memory")
                    continue;
                }
                await ns.sleep(Math.max(hackTime, hackWeakThreads ? hackweakTime : 0))
                while (ns.getRunningScript(pid1) != null || ns.getRunningScript(pid2) != null) {
                    ns.tprint("this should not happen")
                    await ns.sleep(100)
                }
                moneyCur = ns.getServerMoneyAvailable(target)
                securityCur = ns.getServerSecurityLevel(target);
                ns.tprint(
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
                ns.tprint("growing variables setup")
                ns.tprint(
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
                ns.tprint("RUN GROW")
                var pid1 = ns.run("grow.js", growThreads, target)
                ns.tprint("RUN WEAK")
                var pid2 = growWeakThreads ? ns.run("weaken.js", growWeakThreads, target) : pid1
                if (ns.getRunningScript(pid1) == null || ns.getRunningScript(pid2) == null) {
                    ns.kill(pid1);
                    ns.kill(pid2);
                    ns.tprint("out of Memory")
                    continue;
                }
                await ns.sleep(Math.max(growTime, growWeakThreads ? growWeakTime : 0))
                while (ns.getRunningScript(pid1) != null || ns.getRunningScript(pid2) != null) {
                    ns.tprint("this should not happen")
                    await ns.sleep(100)
                }
                moneyCur = ns.getServerMoneyAvailable(target)
                securityCur = ns.getServerSecurityLevel(target);
                ns.tprint(
                    "\nmoney         " + ((moneyCur / moneyMax) * 100).toFixed(2) + "%" +
                    "\nsecurity      " + (securityMin).toFixed(2) + " + " + (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
                    "\n"
                )
            }

        } else {

        }
        await ns.sleep(1000)
    }
    ns.tprint("end print")
    ns.tprint(
        "\nhack Threads  " + hackThreads +
        "\nhack Time     " + ns.tFormat(hackTime) +
        "\nhack Security " + hackSecurity.toFixed(2) +
        "\n" +
        "\nweak Threads  " + hackWeakThreads +
        "\nweak Time     " + ns.tFormat(hackweakTime) +
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



}