import { NS } from "@ns"
import { formatNumber } from "./libraries/format"

export async function main(ns: NS): Promise<void> {
   const doc = eval("document")
   const hook0 = doc.getElementById("overview-extra-hook-0")
   const hook1 = doc.getElementById("overview-extra-hook-1")

   //let karma = 0.23

   for (;;) {
      try {
         // eslint-disable-next-line @typescript-eslint/ban-ts-comment
         // @ts-ignore
         const karma = ns.heart.break()
         //karma *= 12.3

         const headers = []
         const values = []

         headers.push("Kar")
         values.push(formatNumber(karma))

         headers.push("Exp")
         values.push(formatNumber(ns.getTotalScriptExpGain()))

         headers.push("Mon")
         values.push(formatNumber(ns.getTotalScriptIncome()[0]))

         hook0.innerText = headers.join(" \n")
         hook1.innerText = values.join("\n")
         hook1.style.whiteSpace = "pre-wrap"
      } catch (err) {
         // This might come in handy later
         ns.print("ERROR: Update Skipped: " + String(err))
      }
      await ns.sleep(1000)
   }
}
