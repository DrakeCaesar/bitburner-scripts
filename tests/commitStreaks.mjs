#!/usr/bin/env node
/**
 * Find active commit streaks in a git repo.
 *
 * A streak is a run of calendar days with at least one commit, where the gap
 * between consecutive commit days is at most MAX_GAP_DAYS (default 5).
 *
 * Usage:
 *   node tests/commitStreaks.mjs
 *   node tests/commitStreaks.mjs --max-gap 3
 *   node tests/commitStreaks.mjs --author "Dominik"
 *   node tests/commitStreaks.mjs --repo /path/to/repo
 */

import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

function parseArgs(argv) {
  const options = {
    repo: process.cwd(),
    maxGapDays: 5,
    author: null,
    showGaps: true,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--max-gap" || arg === "-g") {
      options.maxGapDays = Number(argv[++i])
    } else if (arg === "--author" || arg === "-a") {
      options.author = argv[++i]
    } else if (arg === "--repo" || arg === "-r") {
      options.repo = resolve(argv[++i])
    } else if (arg === "--no-gaps") {
      options.showGaps = false
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${arg}`)
      printHelp()
      process.exit(1)
    }
  }

  if (!Number.isFinite(options.maxGapDays) || options.maxGapDays < 0) {
    console.error("--max-gap must be a non-negative number")
    process.exit(1)
  }

  return options
}

function printHelp() {
  console.log(`commitStreaks - find active commit streaks in a git repo

Usage:
  node tests/commitStreaks.mjs [options]

Options:
  -g, --max-gap <days>   Max days between commit days in one streak (default: 5)
  -a, --author <pattern> Only include commits whose author matches (git log --author)
  -r, --repo <path>      Repo path (default: current directory)
      --no-gaps          Skip printing gaps between streaks
  -h, --help             Show this help
`)
}

function gitLogDates(repo, author) {
  const args = ["log", "--all", "--format=%aI"]
  if (author) {
    args.push(`--author=${author}`)
  }

  const output = execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((iso) => new Date(iso))
    .sort((a, b) => a - b)
}

function toDayKey(date) {
  return date.toISOString().slice(0, 10)
}

function daysBetween(dayA, dayB) {
  const a = new Date(`${dayA}T12:00:00Z`)
  const b = new Date(`${dayB}T12:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

function formatSpan(start, end) {
  const days = daysBetween(start, end) + 1
  return days === 1 ? "1 day" : `${days} days`
}

function countCommitsOnDays(commitDates, days) {
  const daySet = new Set(days)
  return commitDates.filter((date) => daySet.has(toDayKey(date))).length
}

function findStreaks(uniqueDays, maxGapDays) {
  if (uniqueDays.length === 0) {
    return []
  }

  const streaks = []
  let start = uniqueDays[0]
  let prev = uniqueDays[0]
  let activeDays = [uniqueDays[0]]

  for (let i = 1; i < uniqueDays.length; i++) {
    const day = uniqueDays[i]
    const gap = daysBetween(prev, day)

    if (gap <= maxGapDays) {
      activeDays.push(day)
      prev = day
    } else {
      streaks.push({ start, end: prev, activeDays })
      start = day
      prev = day
      activeDays = [day]
    }
  }

  streaks.push({ start, end: prev, activeDays })
  return streaks
}

function findGaps(uniqueDays, maxGapDays) {
  const gaps = []

  for (let i = 1; i < uniqueDays.length; i++) {
    const prev = uniqueDays[i - 1]
    const next = uniqueDays[i]
    const gap = daysBetween(prev, next)
    if (gap > maxGapDays) {
      gaps.push({ from: prev, to: next, gapDays: gap })
    }
  }

  return gaps
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const commitDates = gitLogDates(options.repo, options.author)

  const uniqueDays = [...new Set(commitDates.map(toDayKey))].sort()
  const streaks = findStreaks(uniqueDays, options.maxGapDays)
  const gaps = findGaps(uniqueDays, options.maxGapDays)

  const authorLabel = options.author ? ` (author: ${options.author})` : ""
  console.log(`Repo: ${options.repo}`)
  console.log(`Max gap between commit days: ${options.maxGapDays} day(s)${authorLabel}`)
  console.log(`Total commits: ${commitDates.length}`)
  console.log(`Unique commit days: ${uniqueDays.length}`)
  console.log(`Streaks: ${streaks.length}`)
  console.log("")

  if (streaks.length === 0) {
    console.log("No commits found.")
    return
  }

  const col = {
    num: 4,
    start: 10,
    end: 10,
    span: 8,
    active: 12,
    commits: 8,
  }

  console.log(
    `${"#".padStart(col.num)}  ${"Start".padEnd(col.start)}  ${"End".padEnd(col.end)}  ${"Span".padEnd(col.span)}  ${"Active days".padEnd(col.active)}  Commits`
  )
  console.log("-".repeat(col.num + col.start + col.end + col.span + col.active + col.commits + 10))

  streaks.forEach((streak, index) => {
    const commits = countCommitsOnDays(commitDates, streak.activeDays)
    console.log(
      `${String(index + 1).padStart(col.num)}  ${streak.start.padEnd(col.start)}  ${streak.end.padEnd(col.end)}  ${formatSpan(streak.start, streak.end).padEnd(col.span)}  ${String(streak.activeDays.length).padEnd(col.active)}  ${commits}`
    )
  })

  if (options.showGaps && gaps.length > 0) {
    console.log("")
    console.log("Gaps between streaks:")
    gaps.forEach((gap) => {
      console.log(`  ${gap.from} -> ${gap.to}: ${gap.gapDays} days`)
    })
  }
}

main()
