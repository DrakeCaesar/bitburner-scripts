import { NS } from "@ns"
import { crawl } from "./libraries/crawl"
import { stringify } from "querystring"

export async function main(ns: NS): Promise<void> {
   const startScript = performance.now()

   const knownServers = crawl(ns)
   let solutions = ""
   const dict: Map<string, [string, string][]> = new Map()
   const timeDict: Map<string, number[]> = new Map()
   //const solve = ns.args[0] as boolean
   const solve = false
   const grep: string = (ns.args[1] as string)?.toLowerCase() ?? ""

   let totalC = 0
   let solvableC = 0

   const workerUrl = URL.createObjectURL(
      new Blob([`${ns.read("contractWorker.js")}`], { type: "text/javascript" })
   )

   const worker = new Worker(workerUrl)

   function sendMessageToWorker(
      message: unknown
   ): Promise<string | number | unknown[]> {
      return new Promise((resolve) => {
         worker.onmessage = (event) => {
            resolve(event.data)
         }
         worker.postMessage(message)
      })
   }

   for (const hostname of knownServers) {
      const listCCT = ns.ls(hostname, ".cct")

      if (listCCT.length) {
         totalC += listCCT.length
         for (const contract of listCCT) {
            const type: string = ns.codingcontract.getContractType(
               contract,
               hostname
            )

            if (!type.toLowerCase().includes(grep)) {
               continue
            }
            const data = ns.codingcontract.getData(contract, hostname)

            // const answerPromise = sendMessageToWorker({
            //    type: type,
            //    data: data,
            // })
            // ns.tprint(`data:     ${data}\n`)

            const start = performance.now()

            // const answer: string | number | unknown[] | null =
            //    await answerPromise

            const answer: string | number | unknown[] | null =
               await sendMessageToWorker({
                  type: type,
                  data: data,
               })

            const end = performance.now()

            if (
               answer != null &&
               (grep == null || type.toLowerCase().includes(grep))
            ) {
               solutions += `hostname: ${hostname}\n`
               solutions += `contract: ${contract}\n`
               solutions += `type:     ${type}\n`
               solutions += `data:     ${JSON.stringify(data)}\n`
               solutions += `answer:   ${JSON.stringify(answer)}\n`

               solvableC++

               let reward
               if (solve) {
                  reward = ns.codingcontract.attempt(answer, contract, hostname)
                  solutions += `reward:   ${reward}\n`
               }
               //solutions += "\n"

               if (!timeDict.has(type)) {
                  timeDict.set(type, [])
               }
               timeDict.get(type)?.push(end - start)
            } else {
               if (!dict.has(type)) {
                  dict.set(type, [])
               }
               dict.get(type)?.push([hostname, contract])
            }
         }
      }
   }

   let contractTypes
   const sortedTypes = Array.from(dict.keys()).sort()

   if (sortedTypes.length && grep == "") {
      contractTypes = "\nUnknown Types:\n\n"
      for (const key of sortedTypes) {
         contractTypes += key + "\n"
         if (grep) {
            for (const element of dict.get(key) ?? []) {
               if (
                  element[1]
                     .toLowerCase()
                     .includes((grep as string).toString().toLowerCase())
               ) {
                  contractTypes +=
                     "   " + element[0].padEnd(20) + element[1] + "\n"
               }
            }
         }
      }
      contractTypes += "\n"
   }
   if (solutions) {
      ns.tprintf("Solutions:\n\n" + solutions)
   }

   if (contractTypes) {
      ns.tprintf(contractTypes)
   }

   ns.tprintf("Total:    " + totalC)
   ns.tprintf("Solvable: " + solvableC)

   let totalTime = 0

   const sortedTimeRecords = Array.from(timeDict.entries()).sort((a, b) => {
      const avgA = avg(a[1])
      const avgB = avg(b[1])
      return avgB - avgA
   })

   contractTypes = "\nAverage execution time:\n\n"
   for (const [key, value] of sortedTimeRecords) {
      contractTypes += key.padEnd(40) + avg(value) + "\n"
      totalTime += sum(value)
   }
   contractTypes += "\n"

   if (contractTypes) {
      ns.tprintf(contractTypes)
   }

   ns.tprintf("Solver execution time:".padEnd(40) + totalTime)
   const endScript = performance.now()
   ns.tprintf("Script execution time:".padEnd(40) + (endScript - startScript))
}

function sum(numbers: number[]) {
   return numbers.reduce((a, b) => a + b, 0)
}

function avg(numbers: number[]): number {
   if (numbers.length === 0) {
      return 0
   }
   const total = numbers.reduce((a, b) => a + b)
   return total / numbers.length
}
