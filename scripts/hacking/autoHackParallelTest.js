/** @param {import("../..").NS } ns */
export async function main(ns) {
    let target = ns.args[0]
    let hostname = ns.getHostname()
    

    
    
    let server = ns.getServer(ns, target);
    let growProc = 0.9
    let hackProc = 0.9
    
    

    
    
    
    
}
/** @param {import("../..").NS } ns */

export function getHackProp(ns, target, hackProc){
    let server = ns.getServer(ns, target);
    
    if (
        server.moneyAvailable != server.moneyMax || 
        server.baseDifficulty != server.hackDifficulty
        ){
        return null
    }
    
    return {
        "threads" : Math.floor(ns.hackAnalyze(server.moneyMax * hackProc )),
        "time" : ns.getHackTime(target),
        "security" : ns.hackAnalyzeSecurity(this.threads,target),
    }
    
    
    
}

/** @param {import("../..").NS } ns */

export function getGrowProp(ns, target){
    
}