/** @param {import("..").NS } ns */
export function main(ns) {
    let knownservers = {"home":[]}
    crawl(ns, knownservers)


    
    var sorteditems = []
    for (const key of Object.keys(knownservers)) {
        let playerLevel = ns.getPlayer().hacking;
        let serverLevel = ns.getServerRequiredHackingLevel(key);
        if (serverLevel <= playerLevel){
            sorteditems.push([key, ns.getServerRequiredHackingLevel(key)])
        }
        
    }
    sorteditems.sort(function(first, second) {
        return first[1] - second[1];
    });
    var bigConnectString = "\n";
    for (const [arg,level] of sorteditems) {
        var connectString = "home; "
        for (const hop of knownservers[arg]) {
            connectString += "connect " + hop +"; "
        }
        connectString += "backdoor;\n"
        navigator.clipboard.writeText(connectString )
        //ns.tprint("")
        //ns.tprint(arg + ": " + ns.getServerRequiredHackingLevel(arg))
        bigConnectString += connectString ;
        //ns.tprint(connectString)
    }
    ns.tprint(bigConnectString)
    navigator.clipboard.writeText(bigConnectString)
    
}

/** @param {import("..").NS } ns */
export function crawl(ns, knownservers, hostname, depth = 0, path = new Array){
    let servers = ns.scan(hostname)
    for (const element of servers) {
        
        if (!(element in knownservers)) {
            knownservers[element] = path.concat([element])
            crawl(ns, knownservers, element, depth + 1, path.concat([element]))
        }
    }
}
