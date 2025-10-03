import { CityName, CompanyName, NS } from "@ns"

import { FloatingWindow } from "./libraries/floatingWindow.js"

export function main(ns: NS) {
  // Remove existing jobs window if it exists
  const existingWindow = document.querySelector("#jobs-list-window")
  if (existingWindow) {
    existingWindow.remove()
  }

  const cities: CityName[] = ["Aevum", "Chongqing", "Sector-12", "New Tokyo", "Ishima", "Volhaven"]

  const companies: CompanyName[] = [
    "ECorp",
    "MegaCorp",
    "Bachman & Associates",
    "Blade Industries",
    "NWO",
    "Clarke Incorporated",
    "OmniTek Incorporated",
    "Four Sigma",
    "KuaiGong International",
    "Fulcrum Technologies",
    "Storm Technologies",
    "DefComm",
    "Helios Labs",
    "VitaLife",
    "Icarus Microsystems",
    "Universal Energy",
    "Galactic Cybersystems",
    "AeroCorp",
    "Omnia Cybersystems",
    "Solaris Space Systems",
    "DeltaOne",
    "Global Pharmaceuticals",
    "Nova Medical",
    "Central Intelligence Agency",
    "National Security Agency",
    "Watchdog Security",
    "LexoCorp",
    "Rho Construction",
    "Alpha Enterprises",
    "Aevum Police Headquarters",
    "SysCore Securities",
    "CompuTek",
    "NetLink Technologies",
    "Carmichael Security",
    "FoodNStuff",
    "Joe's Guns",
    "Omega Software",
    "Noodle Bar",
  ]

  // Build job data grouped by city
  const jobsByCity = new Map<string, { company: string; positions: string[] }[]>()

  for (const city of cities) {
    const cityJobs: { company: string; positions: string[] }[] = []

    for (const company of companies) {
      try {
        // Get available positions at this company
        const positions = ns.singularity.getCompanyPositions(company)
        if (positions && positions.length > 0) {
          cityJobs.push({ company, positions })
        }
      } catch (e) {
        // Company might not exist or be accessible
        continue
      }
    }

    if (cityJobs.length > 0) {
      jobsByCity.set(city, cityJobs)
    }
  }

  // Build table with box-drawing characters
  let tableContent = ""

  for (const [city, jobs] of jobsByCity) {
    // City header
    tableContent += `\n${"═".repeat(80)}\n`
    tableContent += `${city.toUpperCase()}\n`
    tableContent += `${"═".repeat(80)}\n\n`

    for (const { company, positions } of jobs) {
      // Company name
      tableContent += `┌─ ${company}\n`

      // List positions
      for (let i = 0; i < positions.length; i++) {
        const position = positions[i]
        const isLast = i === positions.length - 1

        if (isLast) {
          tableContent += `└── ${position}\n`
        } else {
          tableContent += `├── ${position}\n`
        }
      }

      tableContent += `\n`
    }
  }

  // Extract primary text color from game's CSS
  const primaryElement = document.querySelector('[class*="css-"][class*="-primary"]') as HTMLElement
  let primaryColor = "#0f0" // Fallback green
  if (primaryElement) {
    const computedStyle = window.getComputedStyle(primaryElement)
    primaryColor = computedStyle.color || primaryColor
  }

  // Create pre element for monospace formatting
  const pre = document.createElement("pre")
  pre.style.margin = "0"
  pre.style.fontFamily = "monospace"
  pre.style.fontSize = "12px"
  pre.style.whiteSpace = "pre"
  pre.style.lineHeight = "1.2"
  pre.style.color = primaryColor
  pre.style.overflow = "auto"
  pre.textContent = tableContent

  // Create floating window
  new FloatingWindow({
    title: `Jobs by City (${jobsByCity.size} cities)`,
    content: pre,
    width: 800,
    height: 600,
    id: "jobs-list-window",
  })
}
