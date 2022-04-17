/** @param {import("..").NS } ns */
export async function main(ns) {  
    ns.disableLog("ALL")       
    let target = ns.args[0];
    let mF = 0.75;

    let moneyMax = ns.getServerMaxMoney(target)
    let securityMin = ns.getServerMinSecurityLevel(target)
    let securityT = 5;

    let pid = 0
    let pidW = 0
    let weaken = 0

    while(true) {
        await ns.sleep(100)
        let moneyCur = ns.getServerMoneyAvailable(target)
        let securityCur = (ns.getServerSecurityLevel(target) - securityMin).toFixed(2)
        let moneyP = String(Math.floor(moneyCur/moneyMax*100) +'%').padStart(4)
        let ramT = 1
        let current = ns.getHostname();
        let ramC = ns.getServerUsedRam(current) / ns.getServerMaxRam(current);

        if (ns.getRunningScript(pid) == null && ramC <= ramT){
            let action
            let threads
            let runtime

            if (ns.getRunningScript(pidW) == null && securityCur > securityT){
                for (threads = 1; securityCur > ns.weakenAnalyze(threads); threads ++){}
                action = "weak"
                runtime = ns.getWeakenTime(target)
                pidW = ns.run("weaken.js", threads, target)
                weaken = 1

            } else if (moneyCur == moneyMax && securityCur < securityT*2){
                threads = Math.ceil(ns.hackAnalyzeThreads(target, moneyMax*mF))
                action = "hack"
                runtime = ns.getHackTime(target)
                pid = ns.run("hack.js", threads, target)

            } else if (moneyCur < moneyMax && securityCur < securityT*2){
                //threads = Math.ceil(ns.growthAnalyze(target,1.0/(1.0-mF)))
                if (moneyCur < moneyMax*0.01){
                    threads = 1000
                }else{
                    threads = Math.ceil(ns.growthAnalyze(target,moneyMax/moneyCur))
                }

                action = "grow"
                runtime = ns.getGrowTime(target)
                pid = ns.run("grow.js", threads, target)
            }

            

            if (ns.getRunningScript(pid) != null || weaken == 1){

                var message =
                    target.padEnd(18) + " | " +
                    action + " | " +
                    "t " + String(threads).padStart(4) + " | " + 
                    "S " + String(securityMin).padStart(3) + " + " + (securityCur).padStart(6)  + " | " + 
                    "$ " + moneyP + " | " + 
                    "T " + ns.tFormat(runtime).padStart(30)
                
                //ns.tprint(message)
                ns.print(message)
                weaken = 0;

            }else{
                //ns.print("failed")
            }
        }
    }
}
