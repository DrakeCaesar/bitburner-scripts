import { NS } from "@ns"

import { connect } from "/src/libraries/connect"
export function main(ns: NS, target: string) {
  connect(ns, ns.args[0] as string)
}
