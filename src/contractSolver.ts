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

   // Create a worker to process contracts
   const workerUrl = URL.createObjectURL(
      new Blob([`${ns.read("contractWorker.js")}`], { type: "text/javascript" })
   )

   const numWorkers = 8
   const workers: Worker[] = []
   for (let index = 0; index < numWorkers; index++) {
      workers[index] = new Worker(workerUrl)
   }

   // Send all contracts to the worker and update the map with the answers and execution times
   for (const [type, contracts] of contractMap) {
      let promises = []
      for (let index = 0; index < contracts.length; index++) {
         const contract = contracts[index]
         const worker = workers[index % numWorkers]

         const { server, name, data } = contract

         // Send the contract data to the worker
         contract.time = performance.now()
         worker.postMessage({ type, data })

         // Wait for the worker to finish processing the contract and send the answer back
         const promise = new Promise<string | null>((resolve) => {
            worker.onmessage = (event) => {
               const result = event.data as string | null
               resolve(result)
            }
         })
         promises.push(promise)

         if (promises.length == numWorkers || index == contracts.length - 1) {
            for (let i = 0; i < promises.length; i++) {
               const current = contracts[index - i]
               current.answer = await promises[promises.length - i - 1]
               current.time = performance.now() - (current.time ?? 0)
               if (solve) {
                  ns.codingcontract.attempt(
                     current.answer,
                     current.name,
                     current.server
                  )
               }
            }
            promises = []
         }
      }
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
   for (const worker of workers) {
      worker.terminate()
   }
}
