/**
 * Stock influence through hacking.
 *
 * `grow(host, { stock: true })` raises the second-order forecast of the company that owns `host` by
 * 0.1 with probability (money grown / max money), and `hack(host, { stock: true })` lowers it the
 * same way (bitburner-src PlayerInfluencing.ts). The forecast drifts toward that hidden target, so
 * growing the server of a company we are long on, or hacking one we are short on, pushes its
 * forecast our way — the opposite of what our own trading does to it.
 *
 * The trader publishes which side it holds per server; the hack/grow workers in src/hacking read it
 * (an inline copy of the check, because workers are copied to other hosts without their imports)
 * and set the flag only when it helps the position. Without a message every flag stays off, which
 * is the old behaviour. Ports cost 0 GB and are global, unlike files, which a worker on another
 * host cannot read. The workers hardcode port 31: keep it in sync with STOCK_INFLUENCE_PORT.
 */

import { NS } from "@ns"
import { STOCK_INFLUENCE_PORT } from "@/libraries/ports.js"

/**
 * Hostnames whose organisation owns each stock (bitburner-src Server/data/servers.ts and
 * SpecialServers.ts). Watchdog Security has no server.
 */
export const STOCK_SERVERS: Record<string, readonly string[]> = {
  ECP: ["ecorp"],
  MGCP: ["megacorp"],
  BLD: ["blade"],
  CLRK: ["clarkinc"],
  OMTK: ["omnitek"],
  FSIG: ["4sigma"],
  KGI: ["kuai-gong"],
  FLCM: ["fulcrumtech", "fulcrumassets"],
  STM: ["stormtech"],
  DCOMM: ["defcomm"],
  HLS: ["helios"],
  VITA: ["vitalife"],
  ICRS: ["icarus"],
  UNV: ["univ-energy"],
  AERO: ["aerocorp"],
  OMN: ["omnia"],
  SLRS: ["solaris"],
  GPH: ["global-pharm"],
  NVMD: ["nova-med"],
  LXO: ["lexo-corp"],
  RHOC: ["rho-construction"],
  APHE: ["alpha-ent"],
  SYSC: ["syscore"],
  CTK: ["computek"],
  NTLK: ["netlink"],
  OMGA: ["omega-net"],
  FNS: ["foodnstuff"],
  SGC: ["sigma-cosmetics"],
  JGN: ["joesguns"],
  CTYS: ["catalyst"],
  MDYN: ["microdyne"],
  TITN: ["titan-labs"],
}

/** Side held per hostname: grow helps a long, hack helps a short. */
export type StockInfluence = Record<string, "long" | "short">

/** The influence wanted for the current positions; a company held both ways is left alone. */
export function stockInfluenceFor(ns: NS): StockInfluence {
  const influence: StockInfluence = {}
  for (const symbol of ns.stock.getSymbols()) {
    const [longShares, , shortShares] = ns.stock.getPosition(symbol)
    if ((longShares > 0) === (shortShares > 0)) continue
    for (const host of STOCK_SERVERS[symbol] ?? []) influence[host] = longShares > 0 ? "long" : "short"
  }
  return influence
}

/** Replace the broadcast; an empty map tells workers to stop influencing anything. */
export function publishStockInfluence(ns: NS, influence: StockInfluence): void {
  ns.clearPort(STOCK_INFLUENCE_PORT)
  ns.writePort(STOCK_INFLUENCE_PORT, JSON.stringify(influence))
}
