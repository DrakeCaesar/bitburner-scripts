import { NS } from "@ns"
import {
  CONTROL_PORT,
  LORE_PORT,
  MUTATION_PORT,
  PORT_POOL_SIZE,
  PORT_POOL_START,
} from "../constants.js"

/** Clear a worker command port and its reply port (command + 1). */
export function clearWorkerPortPair(ns: NS, commandPort: number): void {
  if (commandPort <= 0) return
  ns.clearPort(commandPort)
  ns.clearPort(commandPort + 1)
}

/** Clear all dnet v2 Netscript ports before a fresh crawl session. */
export function clearDnetGlobalPorts(ns: NS): void {
  ns.clearPort(MUTATION_PORT)
  ns.clearPort(LORE_PORT)
  ns.clearPort(CONTROL_PORT)
  for (let i = 0; i < PORT_POOL_SIZE; i++) {
    ns.clearPort(PORT_POOL_START + i * 2)
    ns.clearPort(PORT_POOL_START + i * 2 + 1)
  }
}
