import { NS } from "@ns"
import { crawl } from "./libraries/crawl"

export async function main(ns: NS): Promise<void> {
   const knownServers = crawl(ns)
   let solutions = ""
   const dict: Record<string, [string, string][]> = {}
   const timeDict: Record<string, number[]> = {}
   const solve = ns.args[0]
   const grep = ns.args[1]

   let totalC = 0
   let solvableC = 0

   // Create a new web worker
   const worker = new Worker("./contractWorker.js")

   for (const hostname of knownServers) {
      const listCCT = ns.ls(hostname, ".cct")

      if (listCCT.length) {
         totalC += listCCT.length
         for (const contract of listCCT) {
            const type = ns.codingcontract.getContractType(contract, hostname)
            const data = ns.codingcontract.getData(contract, hostname)

            const start = performance.now()

            worker.postMessage({
               type: type,
               data: data,
            })

            // Listen for messages from the worker
            worker.onmessage = (event) => {
               const answer = event.data
               //console.log(`Answer: ${answer}`)
               const end = performance.now()

               if (answer != null && answer != undefined) {
                  solutions += "hostname: " + hostname + "\n"
                  solutions += "contract: " + contract + "\n"
                  solutions += "type:     " + type + "\n"
                  solutions += "data:     " + data + "\n"
                  solutions += "answer:   " + String(answer) + "\n"

                  solvableC++

                  let reward
                  if (solve) {
                     reward = ns.codingcontract.attempt(
                        answer,
                        contract,
                        hostname
                     )
                     solutions += "reward:   " + reward + "\n"
                  }
                  solutions += "\n"
                  if (!(type in timeDict)) {
                     timeDict[type] = []
                  }
                  timeDict[type].push(end - start)
               } else {
                  if (!(type in dict)) {
                     dict[type] = []
                  }
                  dict[type].push([hostname, contract])
               }
            }
         }
      }
   }

   let contractTypes
   const keys = Object.keys(dict).sort()

   if (keys.length) {
      contractTypes = "\nUnknown Types:\n\n"
      for (const item of keys) {
         contractTypes += item + "\n"
         if (grep) {
            for (const element of dict[item.trim()]) {
               if (
                  element[1]
                     .toLowerCase()
                     .includes(grep.toString().toLowerCase())
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
      //ns.tprintf("Solutions:\n\n" + solutions)
   }

   if (contractTypes) {
      ns.tprintf(contractTypes)
   }

   ns.tprintf("Total:    " + totalC)
   ns.tprintf("Solvable: " + solvableC)

   let totalTime = 0

   const sortedRecord = Object.fromEntries(
      Object.entries(timeDict).sort((a, b) => {
         const avgA = a[1].reduce((acc, curr) => acc + curr, 0) / a[1].length
         const avgB = b[1].reduce((acc, curr) => acc + curr, 0) / b[1].length
         return avgB - avgA
      })
   )

   contractTypes = "\nAverage execution time:\n\n"
   for (const [key, value] of Object.entries(sortedRecord)) {
      contractTypes += key.padEnd(40) + avg(value) + "\n"
      totalTime += sum(value)
   }
   contractTypes += "\n"

   if (contractTypes) {
      ns.tprintf(contractTypes)
   }

   ns.tprintf("Total execution time:".padEnd(40) + totalTime)
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
