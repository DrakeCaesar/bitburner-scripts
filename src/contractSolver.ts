import { NS } from "@ns"
import { crawl } from "./libraries/crawl"

type ContractTypeMap = Map<
   string,
   {
      contracts: Array<{
         server: string
         name: string
         data: any
         answer?: any
      }>
      totalTime: number
   }
>

export async function main(ns: NS): Promise<void> {
   const solve: boolean = ns.args.length > 0 && ns.args[0] === "solve"
   const knownServers = crawl(ns)
   const contractMap: ContractTypeMap = new Map()

   // Loop through all known servers and their contracts
   for (const server of knownServers) {
      const contracts = ns.ls(server, ".cct")
      for (const contract of contracts) {
         const type = ns.codingcontract.getContractType(contract, server)
         const data = ns.codingcontract.getData(contract, server)

         // Add the contract to the map based on its type
         if (!contractMap.has(type)) {
            contractMap.set(type, { contracts: [], totalTime: 0 })
         }
         contractMap
            .get(type)
            ?.contracts?.push({ server, name: contract, data })
      }
   }
   const url = URL.createObjectURL(
      new Blob([`${ns.read("contractWorker.js")}`], {
         type: "text/javascript",
      })
   )

   const numWorkers = 8
   const contractEntries = Array.from(contractMap.entries())
   const workers: Worker[] = []

   for (let i = 0; i < numWorkers; i++) {
      workers.push(new Worker(url))

      //workers.push(new Worker(createWorkerUrl()))
   }

   // Send all contracts to the worker and update the map with the answers and execution times
   for (const [type, list] of contractEntries) {
      const promises: Promise<string | null>[] = []
      const start = performance.now()

      // Spawn new workers for each contract type to avoid contention

      for (let i = 0; i < list.contracts.length; i++) {
         const current = list.contracts[i]
         const worker = workers[i % numWorkers]
         const { server, name, data } = current

         // Send the contract data to the worker
         const promise = new Promise<string | null>((resolve) => {
            worker.onmessage = (event) => {
               const result = event.data as string | null
               resolve(result)
            }
            worker.postMessage({ type, data })
         })
         promises.push(promise)

         if (
            promises.length === numWorkers ||
            i === list.contracts.length - 1
         ) {
            const results = await Promise.all(promises)

            for (let j = 0; j < promises.length; j++) {
               const index = i - j
               const current = list.contracts[index]

               current.answer = results[promises.length - j - 1] ?? null

               // if (type === "Algorithmic Stock Trader III") {
               //    ns.tprint(current.answer)
               // }

               if (solve) {
                  ns.codingcontract.attempt(
                     current.answer,
                     current.name,
                     current.server
                  )
               }
            }

            promises.length = 0
         }
      }
      const end = performance.now()
      list.totalTime = end - start
   }
   // Terminate all workers for this contract type
   for (const worker of workers) {
      worker.terminate()
   }

   const nT = "Contract Type"
   const cT = "Count"
   const tT = "Avg. Time"

   let nL = nT.length
   let cL = cT.length
   let tL = tT.length

   // Get longest length for count and time columns
   for (const [type, list] of contractMap) {
      nL = Math.max(nL, type.length)
      cL = Math.max(cL, list.contracts.length.toString().length)
      tL = Math.max(tL, list.totalTime.toFixed(2).toString().length)
   }

   // Create table rows
   let tableRows = ""
   // Convert map to array of objects
   const contractArr = Array.from(contractMap, ([type, list]) => ({
      type,
      list,
   }))
   // Sort array by averageTime in descending order
   contractArr.sort(
      (a, b) =>
         b.list.totalTime / b.list.contracts.length -
         a.list.totalTime / a.list.contracts.length
   )

   for (const { type, list } of contractArr) {
      const count = list.contracts.length.toString().padStart(cL)
      const averageTime = (list.totalTime / list.contracts.length)
         .toFixed(2)
         .padStart(tL)
      tableRows += `┃ ${type.padEnd(nL)} ┃ ${count} ┃ ${averageTime} ┃\n`
   }
   const output =
      `\n` +
      `┏━${"━".repeat(nL)}━┳━${"━".repeat(cL)}━┳━${"━".repeat(tL)}━┓\n` +
      `┃ ${nT.padEnd(nL)} ┃ ${cT.padStart(cL)} ┃ ${tT.padStart(tL)} ┃\n` +
      `┣━${"━".repeat(nL)}━╋━${"━".repeat(cL)}━╋━${"━".repeat(tL)}━┫\n` +
      `${tableRows}` +
      `┗━${"━".repeat(nL)}━┻━${"━".repeat(cL)}━┻━${"━".repeat(tL)}━┛\n`

   ns.tprint(output)
}
