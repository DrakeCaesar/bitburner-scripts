// Runs exploitplay for every faction with the in-game client's widths (src/ipvgo.ts
// IPVGO_FACTION_SEARCH) and prints one line per faction. Results append to results.jsonl here.
// usage: node bench/ipvgo/factionBench.mjs <exe> <label> [games=40] [size=7] [nodes=10000] [seed=1] [KEY=VALUE env...]
// FACTIONS=Illuminati,Tetrads limits the run.
import { spawn } from "node:child_process"
import { cpus } from "node:os"
import { appendFileSync } from "node:fs"

const [exe, label, gamesArg, sizeArg, nodesArg, seedArg, ...envArgs] = process.argv.slice(2)
const games = Number(gamesArg ?? 40)
const size = Number(sizeArg ?? 7)
const nodes = Number(nodesArg ?? 10000)
const seed = Number(seedArg ?? 1)
const extraEnv = Object.fromEntries(envArgs.map((kv) => kv.split("=")))

const factions = {
  Netburners: [12, 6, 0.9],
  SlumSnakes: [4, 4, 0.76],
  TheBlackHand: [2, 6, 0.83],
  Tetrads: [2, 14, 0.4],
  Daedalus: [2, 8, 0.89],
  Illuminati: [2, 4, 0.97],
}
const only = process.env.FACTIONS ? process.env.FACTIONS.split(",") : Object.keys(factions)
const threads = Math.max(1, Math.floor(cpus().length / only.length))

function run(name) {
  const [beam, white, mass] = factions[name]
  const env = {
    ...process.env,
    IPVGO_NODE_LIMIT: String(nodes),
    IPVGO_WHITE_MASS: String(mass),
    IPVGO_VERIFY_ROOT: "1",
    IPVGO_CARRY: "1",
    IPVGO_THREADS: String(threads),
    ...extraEnv,
  }
  const args = ["exploitplay", name, String(size), String(games), "4", String(seed), "random", String(beam), String(white)]
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(exe, args, { env })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    child.on("close", () => {
      const m = out.match(/wins=(\d+)\/(\d+).*avgBlackThinkMs=([\d.]+) avgMargin=([-\d.e+]+) avgDepth=([\d.]+)/)
      const s = out.match(/predicted=(\d+)\/(\d+)/)
      resolve({
        name,
        wins: m ? Number(m[1]) : NaN,
        games: m ? Number(m[2]) : NaN,
        ms: m ? Number(m[3]) : NaN,
        margin: m ? Number(m[4]) : NaN,
        depth: m ? Number(m[5]) : NaN,
        predicted: s ? `${s[1]}/${s[2]}` : "",
        secs: (Date.now() - started) / 1000,
        raw: m ? "" : out.slice(-400),
      })
    })
  })
}

const results = await Promise.all(only.map(run))
let wins = 0
let total = 0
for (const r of results) {
  wins += r.wins
  total += r.games
  console.log(
    `${label.padEnd(14)} ${r.name.padEnd(13)} ${String(r.wins).padStart(3)}/${r.games}  margin ${r.margin.toFixed(1).padStart(6)}  depth ${r.depth.toFixed(2)}  ${r.ms.toFixed(0).padStart(5)} ms/move ${r.predicted ? "pred " + r.predicted : ""} ${r.secs.toFixed(0)}s ${r.raw}`
  )
}
console.log(`${label.padEnd(14)} TOTAL ${wins}/${total}`)
appendFileSync(
  new URL("./results.jsonl", import.meta.url),
  JSON.stringify({ label, games, size, nodes, seed, extraEnv, results, at: new Date().toISOString() }) + "\n"
)
