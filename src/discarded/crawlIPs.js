/** @param {import("../../NetscriptDefinitions").NS } ns */
export async function main(ns) {
  for (let i = 0; i < 100; i++) {
    for (let j = 0; j < 10; j++) {
      for (let k = 0; k < 10; k++) {
        for (let l = 0; l < 10; l++) {
          let ip = i + "." + j + "." + k + "." + l
          if (ns.serverExists(ip)) {
            let playerLevel = ns.getPlayer().hacking
            let serverLevel = ns.getServerRequiredHackingLevel(ip)
            //ns.tprint("ERROR: " + ip)
            let list = ns.scan(ip)
            /*
                            for (const item of list) {
                                ns.tprintf(item)
                            }
                            */
            if (list.length == 0) {
              ns.tprintf("world daemon: " + ip)
              /*
                                
                                let files = ns.ls(ip)
                                for (const item of files) {
                                    ns.tprintf(item)
                                }
                                */
              await ns.scp("printHostname.js", ip)
              ns.exec("printHostname.js", ip, 1, ip)
              let numPortsOpen = 0
              if (ns.fileExists("BruteSSH.exe", "home")) {
                ns.brutessh(ip)
                ++numPortsOpen
              }
              if (ns.fileExists("FTPCrack.exe", "home")) {
                ns.ftpcrack(ip)
                ++numPortsOpen
              }
              if (ns.fileExists("relaySMTP.exe", "home")) {
                ns.relaysmtp(ip)
                ++numPortsOpen
              }
              if (ns.fileExists("relaySMTP.exe", "home")) {
                ns.relaysmtp(ip)
                ++numPortsOpen
              }
              if (ns.fileExists("HTTPWorm.exe", "home")) {
                ns.httpworm(ip)
                ++numPortsOpen
              }
              if (ns.fileExists("SQLInject.exe", "home")) {
                ns.sqlinject(ip)
                ++numPortsOpen
              }
              if (
                ns.fileExists("NUKE.exe", "home") &&
                serverLevel <= playerLevel &&
                ns.getServerNumPortsRequired(ip) <= numPortsOpen
              ) {
                ns.nuke(ip)
                await ns.scp("printHostname.js", ip)
                ns.exec("printHostname.js", ip, 1, ip)
              }
            }
          }
        }
      }
    }
  }
}
