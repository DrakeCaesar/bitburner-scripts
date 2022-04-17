/** @param {import("..").NS } ns */
export async function main(ns) {
    let target = ns.args[0]
    target = "n00dles"
    let hackP = 0.8
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

    let needSetGrow = true
    let needSetHack = true

    ns.tprint("variable setup")

    while (true){

        if (moneyMax == moneyCur && securityMin == securityCur ){

            hackThreads = Math.floor( ns.hackAnalyzeThreads( target, moneyMax*hackP ) );
            hackTime = ns.getHackTime(target)
            hackSecurity = ns.hackAnalyzeSecurity(hackThreads,target)

            for (hackWeakThreads = 0; ns.weakenAnalyze(hackWeakThreads) <= hackSecurity; ++hackWeakThreads );
            hackWeakThreads = Math.ceil(hackWeakThreads)
            hackweakTime = ns.getWeakenTime(target)
            needSetHack = false
            if (needSetGrow){
                ns.tprint("hacking variables setup")
                ns.tprint(
                    "\nhack Threads  " + hackThreads +
                    "\nhack Time     " + ns.tFormat(hackTime) +
                    "\nhack Security " + hackSecurity.toFixed(2) +
                    "\n" +
                    "\nweak Threads  " + hackWeakThreads +
                    "\nweak Time     " + ns.tFormat(hackweakTime) +
                    "\n" +
                    "\nmoney         " + ((moneyCur / moneyMax)*100).toFixed(2) + "%" +
                    "\nsecurity      " + (securityMin).toFixed(2) + " + " +  (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
                    "\n"
                )

                var pid1 = ns.run("hack.js", hackThreads, target)
                var pid2 = hackWeakThreads ? ns.run("weaken.js", hackWeakThreads, target) : pid1
                if (ns.getRunningScript(pid1) == null || ns.getRunningScript(pid2)){
                    ns.kill(pid1);
                    ns.kill(pid2);
                    continue;
                }
                ns.sleep(Math.max(hackTime, hackWeakThreads ? hackweakTime : 0))
                while (ns.getRunningScript(pid1) != null || ns.getRunningScript(pid2) != null){
                    ns.sleep(100)
                }
                needSetGrow = false
            }


        //} else if (moneyCur >= moneyMax*(1-hackP)*(1-monT) && moneyCur <= moneyMax*(1-hackP)*(1+monT) && securityMin == securityCur){
        } else if (moneyCur <= moneyMax && securityMin <= securityCur){

            growThreads = Math.ceil( ns.growthAnalyze(target,1.0/hackP))
            growTime = ns.getGrowTime(target)
            growSecurity = ns.growthAnalyzeSecurity(growThreads,target, 1)

            for (growWeakThreads = 0; ns.weakenAnalyze(growWeakThreads) <= hackSecurity; ++growWeakThreads );
            growWeakTime = ns.getWeakenTime(target)
            growWeakThreads = Math.ceil(growWeakThreads)
            needSetGrow = false

            if (needSetHack){
                ns.tprint("growing variables setup")
                ns.tprint(
                    "\ngrow Threads  " + growThreads +
                    "\ngrow Time     " + ns.tFormat(growTime) +
                    "\ngrow Security " + growSecurity.toFixed(2) +
                    "\n" +
                    "\nweak Threads  " + growWeakThreads +
                    "\nweak Time     " + ns.tFormat(growWeakTime) +
                    "\n" +
                    "\nmoney         " + ((moneyCur / moneyMax)*100).toFixed(2) + "%" +
                    "\nsecurity      " + (securityMin).toFixed(2) + " + " +  (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
                    "\n"
                )
                var pid1 = ns.run("grow.js", growThreads, target)
                var pid2 = ns.run("weaken.js", growWeakThreads, target)
                if (ns.getRunningScript(pid1) == null || ns.getRunningScript(pid2)){
                    ns.kill(pid1);
                    ns.kill(pid2);
                    continue;
                }
                ns.sleep(Math.max(growTime, growWeakThreads))
                while (ns.getRunningScript(pid1) != null || ns.getRunningScript(pid2) != null){
                    ns.sleep(100)
                }
                needSetHack = false
            }

        }
        else{
            /*
            ns.tprint("things went awry")
            ns.tprint(
                "\nmoney         " + ((moneyCur / moneyMax)*100).toFixed(2) + "%" +
                "\nmoney         " + (moneyMax*(1-hackP)*(1-monT)).toFixed(0) + " <= " + moneyCur.toFixed(0) + " <= " + (moneyMax*(1-hackP)*(1+monT)).toFixed(0) +
                "\nsecurity      " + (securityMin).toFixed(2) + " + " +  (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
                "\n"
            )
            */
        }
        await ns.sleep(1000)
    }

    

}