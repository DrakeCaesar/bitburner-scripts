/** @param {import("../NetscriptDefinitions").NS } ns */

import { test } from "./testparse.js"

export function test2(ns) {
   ns.tprint("Hello World!")
   test(ns)
}
