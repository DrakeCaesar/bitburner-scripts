/** @param {import("..").NS } ns */
export function main(ns) {
   ns.tprint(
      "    " +
         String(ns.args[0]).padStart(9) +
         "    " +
         String(
            ns.getServerSecurityLevel(ns.getHostname()).toFixed(2)
         ).padStart(6) +
         "    " +
         ns.getHostname()
   )
}
