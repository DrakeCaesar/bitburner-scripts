import { JobField, NS } from "@ns"

export async function main(ns: NS): Promise<void> {
  const jobs = Object.values(ns.enums.JobField) as JobField[]
  for (const job of jobs) {
    ns.tprint(`JobField: ${job}`)
  }

  const agent = ns.enums.JobField.agent
  ns.tprint(`Agent: ${agent}`)
}
