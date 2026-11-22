// Plays the exploiter against every faction and reports what the game pays for.
//
// usage: node bench/ipvgo/factionBench.mjs <exe> <label> [games=400] [size=5] [nodes=10000] [seed=1] [KEY=VALUE...]
//        node bench/ipvgo/factionBench.mjs --compare <labelA> <labelB>
//
// KEY=VALUE pairs are passed to the engine as environment variables, except:
//   BEAM=n WHITE=n MASS=x   override the per-faction widths below for every faction
//   THREADS=n               search threads per game process (default 1)
//   JOBS=n                  game processes run at once (default: all cores / THREADS)
//   FACTIONS=a,b            limit the run (also read from the environment)
//
// Game k starts from the same board in every run with the same seed (the engine derives each
// game's random stream from the seed and k), so two labels can be compared game by game:
// --compare prints the paired differences with their standard errors.
//
// What is reported, per faction:
//   win%    games won
//   score   Black's final score. The game adds score * difficulty * streak to node power.
//   moves   Black moves per game
//   ticks   game length on the 200 ms play clock: White answers in 2 ticks (3 for a fallback
//           move), a slipped tick now and then, plus every tick we chose to wait for a seed
//   waits   the ticks of that we waited by choice
//   ms      search time per move
//   pay     score * streak multiplier per game, with the streak carried through the run
//   pay/h   pay per hour of play: ticks * 200 ms + GAME_OVERHEAD_S between games
import { spawn } from "node:child_process"
import { cpus } from "node:os"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

const RUNS_DIR = new URL("./runs/", import.meta.url)
const GAME_OVERHEAD_S = 1.0
const SHARD_GAMES = 20

// The in-game client's widths (src/ipvgo.ts IPVGO_FACTION_SEARCH): beam, replies, reply mass.
const factions = {
  Netburners: [12, 6, 0.9],
  SlumSnakes: [4, 4, 0.76],
  TheBlackHand: [2, 6, 0.83],
  Tetrads: [2, 14, 0.4],
  Daedalus: [2, 8, 0.89],
  Illuminati: [2, 4, 0.97],
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
}

function stderr(xs) {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) / xs.length)
}

// The game's getWinstreakMultiplier, with the streak carried from game to game. A run starts
// on a full streak: that is where a 96%+ win rate spends its time.
function payoffs(games) {
  let streak = 8
  return games.map((g) => {
    const old = streak
    let mult
    if (g.win) {
      streak = old < 0 ? 1 : old + 1
      mult = old < 0 ? 1 + 0.5 * Math.min(-old, 8) : 1 + 0.25 * Math.min(streak, 8)
    } else {
      streak = old >= 0 ? -1 : old - 1
      mult = 0.5
    }
    return g.black * mult
  })
}

function summarize(games) {
  const pay = payoffs(games)
  const seconds = games.map((g) => g.ticks * 0.2 + GAME_OVERHEAD_S)
  const moves = games.reduce((a, g) => a + g.moves, 0)
  return {
    games: games.length,
    wins: games.filter((g) => g.win).length,
    score: mean(games.map((g) => g.black)),
    moves: moves / games.length,
    ticks: mean(games.map((g) => g.ticks)),
    waits: mean(games.map((g) => g.waits)),
    ms: games.reduce((a, g) => a + g.ms, 0) / Math.max(1, moves),
    pay: mean(pay),
    payPerHour: (3600 * pay.reduce((a, b) => a + b, 0)) / seconds.reduce((a, b) => a + b, 0),
  }
}

function line(label, name, s) {
  return (
    `${label.padEnd(16)} ${name.padEnd(13)} ${String(s.wins).padStart(4)}/${s.games} ${((100 * s.wins) / s.games).toFixed(1).padStart(5)}%` +
    `  score ${s.score.toFixed(2).padStart(5)}  moves ${s.moves.toFixed(1).padStart(4)}  ticks ${s.ticks.toFixed(1).padStart(5)}` +
    `  waits ${s.waits.toFixed(1).padStart(4)}  ${s.ms.toFixed(1).padStart(5)} ms  pay ${s.pay.toFixed(1).padStart(5)}  pay/h ${s.payPerHour.toFixed(0).padStart(6)}`
  )
}

function report(label, byFaction) {
  let wins = 0
  let total = 0
  const rates = []
  const all = []
  for (const [name, games] of Object.entries(byFaction)) {
    const s = summarize(games)
    wins += s.wins
    total += s.games
    rates.push(s.payPerHour)
    all.push(...games)
    console.log(line(label, name, s))
  }
  const s = summarize(all)
  console.log(
    `${label.padEnd(16)} TOTAL         ${String(wins).padStart(4)}/${total} ${((100 * wins) / total).toFixed(1).padStart(5)}%` +
      `  score ${s.score.toFixed(2).padStart(5)}  moves ${s.moves.toFixed(1).padStart(4)}  ticks ${s.ticks.toFixed(1).padStart(5)}` +
      `  waits ${s.waits.toFixed(1).padStart(4)}  ${s.ms.toFixed(1).padStart(5)} ms  pay ${mean(
        Object.values(byFaction).map((g) => summarize(g).pay)
      )
        .toFixed(1)
        .padStart(5)}  pay/h ${mean(rates).toFixed(0).padStart(6)}`
  )
}

function load(label) {
  return JSON.parse(readFileSync(new URL(`${label}.json`, RUNS_DIR), "utf8"))
}

function compare(labelA, labelB) {
  const a = load(labelA)
  const b = load(labelB)
  const fmt = (xs) => `${mean(xs) >= 0 ? "+" : ""}${mean(xs).toFixed(3)} ±${stderr(xs).toFixed(3)}`
  console.log(`${labelB} minus ${labelA}, paired by game (mean ± standard error)`)
  const allWin = []
  const allScore = []
  const allPay = []
  const allTicks = []
  for (const name of Object.keys(a.byFaction)) {
    const ga = a.byFaction[name]
    const gb = b.byFaction[name]
    if (!gb) continue
    const n = Math.min(ga.length, gb.length)
    const pa = payoffs(ga)
    const pb = payoffs(gb)
    const win = []
    const score = []
    const pay = []
    const ticks = []
    for (let i = 0; i < n; i++) {
      win.push(gb[i].win - ga[i].win)
      score.push(gb[i].black - ga[i].black)
      pay.push(pb[i] - pa[i])
      ticks.push(gb[i].ticks - ga[i].ticks)
    }
    allWin.push(...win)
    allScore.push(...score)
    allPay.push(...pay)
    allTicks.push(...ticks)
    console.log(
      `  ${name.padEnd(13)} n=${n}  win ${fmt(win)}  score ${fmt(score)}  pay ${fmt(pay)}  ticks ${fmt(ticks)}`
    )
  }
  console.log(
    `  ${"ALL".padEnd(13)} n=${allWin.length}  win ${fmt(allWin)}  score ${fmt(allScore)}  pay ${fmt(allPay)}  ticks ${fmt(allTicks)}`
  )
  const sa = Object.values(a.byFaction).map((g) => summarize(g).payPerHour)
  const sb = Object.values(b.byFaction).map((g) => summarize(g).payPerHour)
  console.log(
    `  pay/h (mean of factions): ${mean(sa).toFixed(0)} -> ${mean(sb).toFixed(0)}  (${((100 * mean(sb)) / mean(sa) - 100).toFixed(1)}%)`
  )
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv[0] === "--compare") return compare(argv[1], argv[2])
  if (argv[0] === "--show") return report(argv[1], load(argv[1]).byFaction)

  const [exe, label, gamesArg, sizeArg, nodesArg, seedArg, ...envArgs] = argv
  if (!exe || !label) {
    console.error("usage: factionBench.mjs <exe> <label> [games=400] [size=5] [nodes=10000] [seed=1] [KEY=VALUE...]")
    process.exit(2)
  }
  const games = Number(gamesArg ?? 400)
  const size = Number(sizeArg ?? 5)
  const nodes = Number(nodesArg ?? 10000)
  const seed = Number(seedArg ?? 1)
  const extra = Object.fromEntries(envArgs.map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]))
  const take = (key, fallback) => {
    const value = extra[key] ?? fallback
    delete extra[key]
    return value
  }
  const beamAll = take("BEAM")
  const whiteAll = take("WHITE")
  const massAll = take("MASS")
  const threads = Number(take("THREADS", 1))
  const jobs = Number(take("JOBS", Math.max(1, Math.floor(cpus().length / threads))))
  const only = (take("FACTIONS", process.env.FACTIONS) ?? Object.keys(factions).join(",")).split(",")

  const shards = []
  for (const name of only) {
    for (let start = 0; start < games; start += SHARD_GAMES) {
      shards.push({ name, start, count: Math.min(SHARD_GAMES, games - start) })
    }
  }
  // Longest factions first would be better still; interleaving keeps every core busy to the end.
  shards.sort((x, y) => x.start - y.start)

  const byFaction = Object.fromEntries(only.map((name) => [name, []]))
  const runShard = (shard) =>
    new Promise((resolve, reject) => {
      const [beam, white, mass] = factions[shard.name]
      const env = {
        ...process.env,
        IPVGO_NODE_LIMIT: String(nodes),
        IPVGO_WHITE_MASS: String(massAll ?? mass),
        IPVGO_VERIFY_ROOT: "1",
        IPVGO_CARRY: "1",
        IPVGO_THREADS: String(threads),
        IPVGO_GAMELOG: "1",
        IPVGO_GAME_OFFSET: String(shard.start),
        ...extra,
      }
      const args = [
        "exploitplay",
        shard.name,
        String(size),
        String(shard.count),
        "4",
        String(seed),
        "random",
        String(beamAll ?? beam),
        String(whiteAll ?? white),
      ]
      const child = spawn(exe, args, { env })
      let out = ""
      child.stdout.on("data", (d) => (out += d))
      child.stderr.on("data", (d) => (out += d))
      child.on("close", () => {
        const found = [
          ...out.matchAll(
            /^game idx=(\d+) win=(\d) black=([\d.]+) white=([\d.]+) moves=(\d+) ticks=(\d+) waits=(\d+) ms=([\d.]+)/gm
          ),
        ]
        if (found.length !== shard.count) return reject(new Error(`${shard.name} @${shard.start}: ${out.slice(-600)}`))
        for (const m of found) {
          byFaction[shard.name].push({
            idx: +m[1],
            win: +m[2],
            black: +m[3],
            white: +m[4],
            moves: +m[5],
            ticks: +m[6],
            waits: +m[7],
            ms: +m[8],
          })
        }
        resolve()
      })
    })

  const started = Date.now()
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(jobs, shards.length) }, async () => {
      while (next < shards.length) await runShard(shards[next++])
    })
  )
  for (const list of Object.values(byFaction)) list.sort((x, y) => x.idx - y.idx)

  report(label, byFaction)
  console.log(
    `${label.padEnd(16)} ${((Date.now() - started) / 1000).toFixed(0)}s wall, ${jobs} jobs x ${threads} threads`
  )
  mkdirSync(RUNS_DIR, { recursive: true })
  writeFileSync(
    new URL(`${label}.json`, RUNS_DIR),
    JSON.stringify({
      label,
      games,
      size,
      nodes,
      seed,
      env: extra,
      widths: { beamAll, whiteAll, massAll },
      at: new Date().toISOString(),
      byFaction,
    })
  )
}

await main()
