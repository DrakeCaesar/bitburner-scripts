import { NS } from "@ns"

import { connect } from "./libraries/connect.js"

export function main(ns: NS) {
  connect(ns, String(ns.args[0] ?? ""))
}
