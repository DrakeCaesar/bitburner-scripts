import { NS } from "@ns"
import { crawl } from "./libraries/crawl"

type ContractTypeMap = Map<
   string,
   Array<{
      server: string
      name: string
      data: any
      answer?: any
      time?: number
   }>
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
            contractMap.set(type, [])
         }
         contractMap.get(type)?.push({ server, name: contract, data })
      }
   }
   const url = URL.createObjectURL(
      new Blob([`${ns.read("contractWorker.js")}`], {
         type: "text/javascript",
      })
   )

   // Create a function to spawn a new worker URL
   function createWorkerUrl() {
      return URL.createObjectURL(
         new Blob([`${ns.read("contractWorker.js")}`], {
            type: "text/javascript",
         })
      )
   }

   const numWorkers = 8
   const contractEntries = Array.from(contractMap.entries())
   const workers: Worker[] = []

   for (let i = 0; i < numWorkers; i++) {
      workers.push(new Worker(url))

      //workers.push(new Worker(createWorkerUrl()))
   }

   // Send all contracts to the worker and update the map with the answers and execution times
   for (const [type, contracts] of contractEntries) {
      const promises: Promise<string | null>[] = []

      // Spawn new workers for each contract type to avoid contention

      for (let i = 0; i < contracts.length; i++) {
         const current = contracts[i]
         const worker = workers[i % numWorkers]
         const { server, name, data } = current

         // Send the contract data to the worker
         const startTime = performance.now()
         const promise = new Promise<string | null>((resolve) => {
            worker.onmessage = (event) => {
               const result = event.data as string | null
               resolve(result)
            }
            worker.postMessage({ type, data })
         })
         promises.push(promise)

         if (promises.length === numWorkers || i === contracts.length - 1) {
            const results = await Promise.all(promises)

            for (let j = 0; j < promises.length; j++) {
               const index = i - j
               const current = contracts[index]

               current.answer = results[promises.length - j - 1] ?? null
               current.time = performance.now() - (current.time ?? startTime)

               if (type === "Algorithmic Stock Trader III") {
                  ns.tprint(current.answer)
               }

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
   }
   // Terminate all workers for this contract type
   for (const worker of workers) {
      worker.terminate()
   }

   // Await all promises together and print the updated map with execution times
   for (const [type, contracts] of contractMap) {
      let totalTime = 0
      let numContracts = 0
      for (const contract of contracts) {
         // Get the answer from the promise and update the contract object with the execution time
         //await ns.sleep(1)
         const answer = contract.answer
         if (answer !== null) {
            //ns.tprint(answer)
            totalTime += contract.time ?? 0
            numContracts += 1
         }
      }
      if (numContracts > 0) {
         const averageTime = totalTime / numContracts
         ns.tprint(
            ` ${type.padEnd(40)}| ${numContracts
               .toString()
               .padEnd(5)} | ${averageTime.toFixed(2).padStart(8)}`
         )
      }
   }
}
