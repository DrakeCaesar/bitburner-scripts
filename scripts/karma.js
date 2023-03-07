import { formatNumber } from "./libraries/format"

/** @param {import("..").NS } ns */
export async function main(ns) {
    const doc = eval("document")
    const hook0 = doc.getElementById("overview-extra-hook-0")
    const hook1 = doc.getElementById("overview-extra-hook-1")
    for (;;) {
        try {
            const karma = ns.heart.break()
            const headers = []
            const values = []

            headers.push("Kar")
            values.push(formatNumber(karma))

            headers.push("Exp")
            values.push(formatNumber(ns.getScriptExpGain()))

            headers.push("Mon")
            values.push(formatNumber(ns.getScriptIncome()[0]))

            hook0.innerText = headers.join(" \n")
            hook1.innerText = values.join("\n")
        } catch (err) {
            // This might come in handy later
            ns.print("ERROR: Update Skipped: " + String(err))
        }
        await ns.sleep(1000)
    }
}
