/** @param {import("../..").NS } ns */
export async function main(ns) {
   let array = []

   let servers = ns.scan()
   for (;;) {
      var hostname = servers[Math.floor(Math.random() * servers.length)]
      if (!array.includes(hostname)) {
         array.push(hostname)
      }
      servers = ns.scan(hostname)
      await ns.sleep(1)

      ns.tprint(array)
      ns.tprint(array.length)
   }
}
