/** @param {import("..").NS } ns */
export async function main(ns) {         
    var target = ns.args[0];
    var moneyMax = ns.getServerMaxMoney(target);
    var securityMin = ns.getServerMinSecurityLevel(target);
    var moneyT = moneyMax * 0.75;
    var securityT = securityMin + 5;

    while(true) {
        let security = ns.getServerSecurityLevel(target);
        let money = ns.getServerMoneyAvailable(target);
        let offset = String(Math.round(Math.max(money/moneyMax,security/securityT))).length;
        ns.print("money:    " + String(Math.round(money/moneyMax*100    )).padStart(offset,' ') + "%")
        ns.print("security: " + String(Math.round(security/securityT*100)).padStart(offset,' ') + "%")
        if (security > securityT) {
            ns.print("action:   weaken" )
            await ns.weaken(target);
        } else if (money < moneyT) {
            ns.print("action:   grow" )
            await ns.grow(target);
        } else if (money < moneyMax){
            ns.print("action:   grow" )
            await ns.grow(target);
        } else{
            ns.print("action:   weaken" )
            await ns.weaken(target);
        }
    }
}
