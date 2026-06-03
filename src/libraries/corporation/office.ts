import { CityName, CorpEmployeePosition, NS } from "@ns"

export const OFFICE_FUND_BUFFER = 5e6

export const CORE_JOBS: Exclude<CorpEmployeePosition, "Unassigned">[] = [
  "Operations",
  "Engineer",
  "Business",
  "Management",
  "Research & Development",
]

/** Spread employees across core roles; remainder go to Operations. */
export function balanceJobs(ns: NS, divisionName: string, city: CityName): void {
  const corp = ns.corporation
  const office = corp.getOffice(divisionName, city)
  const n = office.numEmployees
  if (n === 0) return

  const internTarget = n >= 9 ? Math.floor(n / 9) : n > 5 ? 1 : 0
  let remaining = n - internTarget
  const targets: Record<Exclude<CorpEmployeePosition, "Unassigned">, number> = {
    Operations: 0,
    Engineer: 0,
    Business: 0,
    Management: 0,
    "Research & Development": 0,
    Intern: internTarget,
  }

  for (const job of CORE_JOBS) {
    if (remaining <= 0) break
    targets[job] = 1
    remaining--
  }
  targets.Operations += remaining

  for (const job of CORE_JOBS) {
    corp.setJobAssignment(divisionName, city, job, targets[job])
  }
  corp.setJobAssignment(divisionName, city, "Intern", targets.Intern)
}

/** Hire (one per tick) and rebalance jobs. No office upgrades or tea. */
export function maintainOfficeStaff(
  ns: NS,
  divisionName: string,
  city: CityName,
  funds: number,
  lines: string[]
): void {
  const corp = ns.corporation
  const office = corp.getOffice(divisionName, city)

  if (office.numEmployees < office.size && funds > OFFICE_FUND_BUFFER) {
    try {
      if (corp.hireEmployee(divisionName, city)) {
        const updated = corp.getOffice(divisionName, city)
        lines.push(`${divisionName}/${city}: hired (${updated.numEmployees}/${updated.size})`)
      }
    } catch (err) {
      lines.push(`${divisionName}/${city}: hire failed: ${String(err)}`)
    }
  }

  balanceJobs(ns, divisionName, city)
}
