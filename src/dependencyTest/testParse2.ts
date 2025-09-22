import { NS } from "@ns"

import { test } from "/src/dependencyTest/testParse.js"

export function test2(ns: NS) {
  ns.tprint("Hello World!")
  ns.stock.getPrice("")
  test(ns)
}
