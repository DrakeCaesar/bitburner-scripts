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
   const worker = new Worker(workerUrl)

   // Send all contracts to the worker and update the map with the answers and execution times
   const promises = []
   for (const [type, contracts] of contractMap) {
      for (const contract of contracts) {
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

         // Add the promise to the list of promises to await
         promises.push(promise)

         // Update the contract object with the promise
         contract.answer = await promise
      }
   }

   // Await all promises together and print the updated map with execution times
   await Promise.allSettled(promises)
   for (const [type, contracts] of contractMap) {
      let totalTime = 0
      let numContracts = 0
      for (const contract of contracts) {
         // Get the answer from the promise and update the contract object with the execution time
         const answer = await contract.answer
         if (answer !== null) {
            const time = performance.now() - (contract.time ?? 0)
            contract.time = time
            contract.answer = answer
            totalTime += time
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

   // Cleanup the worker
   worker.terminate()
}
