# Agent guide

Context for AI coding assistants working in this repository.

## Common development commands

### Development and file sync

- `pnpm run dev` — Runs **viteburner**, which connects to the game, compiles TypeScript, and syncs scripts with hot reload. **Assume this is always running** — edits in `src/` appear in the game automatically; no manual copy step is needed.

### Code quality

- `pnpm run lint` — Run prettier, eslint, and sort-package-json (auto-fixes)
- ESLint uses the flat config in `eslint.config.mjs`. `src/` and the bench TS cores are linted type-aware (TS project service), Node tooling gets Node globals, and prettier runs last as an ESLint rule. A new file that needs type info but sits outside `tsconfig.json` must be added to its `include` or to the config's `allowDefaultProject`.

### Legacy watch scripts

The `watch:*` scripts are an older alternative sync setup (`build/` + bitburner-filesync). The active workflow uses `pnpm run dev` instead.

## Architecture overview

### Bitburner game integration

This repository contains scripts for the Bitburner programming game. Scripts run inside the game environment with the Netscript API. **viteburner** (`pnpm run dev`) keeps the game connected — assume it is running when writing or editing scripts.

### File structure

- `src/` — Source TypeScript/JavaScript entry scripts (**only this folder is synced to the game**)
- `src/libraries/` — Shared modules (batching, crawling, UI helpers, dashboard, etc.)
- `dist/` — Compiled output (synced to game)
- `bench/` — Non-shipping code that measures or analyses:
  - `bench/stock/` — stock market model + benchmark CLI and GUI
  - `bench/koth/` — KingOfTheHill simulation, benchmark, viz and the `koth_tune/` C++/Python tuner
  - `bench/scratch/` — one-off sims and coding-contract solvers, not wired to any script
- `build/` — Bundlers and watch/sync tooling
- `docs/` — Markdown documentation, including this guide
- `webui/` — Shared UI kit (`toolUi.css`, `toolUi.js`) linked by every browser tool
- `index.html` — landing page for the local HTML tools
- `ipvgo-engine/` — standalone IPvGO engine (native C++ plus its own Node server and web UI)
- `ideas/discarded/` — Old experiments; not part of the active workflow
- `NetscriptDefinitions.d.ts` — **Complete Bitburner API type definitions (10,000+ lines)**
  - **Always reference this file when using NS functions** to verify signatures, parameters, RAM costs, and return types
  - Contains comprehensive JSDoc documentation for all Netscript API methods

### Module system

- **Netscript import**: Use `import { NS } from "@ns"` for Bitburner API types
- **Local modules**: Prefer the `@/` alias (e.g. `"@/libraries/connect.js"`) or relative `./` paths. Both are valid in source; see [Viteburner import paths](#viteburner-import-paths) below.
- **Path aliases**: `@/*` and `/src/*` in `vite.config.ts` / `tsconfig.json` resolve to `./src/*` for Vite and TypeScript only. They are **not** game paths.
- **Template reference**: the upstream viteburner template's config files were copied to the repo root; there is no vendored copy to keep in sync
- **Import extensions**: Imports use `.js` extensions even when importing from `.ts` files (TypeScript compilation requirement). When editing files referenced in imports with `.js` extensions, check for corresponding `.ts` source files first.

#### Viteburner import paths

This section documents a real failure mode: RAM calculation (and runtime imports) breaking with paths like `"/src/libraries/corporation/farmland.ts" does not exist on server: home`.

**Two different roots**

| Context | Root | Example |
|---------|------|---------|
| Repo / Vite / TypeScript | `src/` folder on disk | `src/libraries/corporation/farmland.ts` |
| Bitburner `home` server | No `src/` prefix | `/libraries/corporation/farmland.js` |

`src/` exists only in the repository. viteburner uploads `src/foo.ts` to `@home:/foo.js` (strips the `src/` prefix and `.ts` → `.js`). Anything still pointing at `/src/...` or `*.ts` in **synced** script text is wrong for the game.

**What the pipeline does**

1. You write imports in source (e.g. `@/libraries/foo.js` or `./foo.js`).
2. Vite transforms modules and often emits absolute paths such as `from "/src/libraries/foo.ts"` (`.ts` extension, `/src/` prefix).
3. On upload, viteburner runs `fixImportPath` ([docs](https://github.com/Tanimodori/viteburner/blob/main/docs/guide/transform.md)), which rewrites **only top-level** `import { } from "..."` declarations to game paths like `"/libraries/foo.js"`.
4. It does **not** rewrite:
   - `export { x } from "..."` (re-exports)
   - `export * from "..."`
   - Dynamic `import("...")`
5. Inline sourcemaps (`sourcemap: "inline"`) can also reference original `.ts` paths; RAM calculation may follow those and fail similarly.

**Do not**

- Put `"/src/libraries/..."` in import strings — that is not a path on `home`.
- Rely on path rewrites fixing `export { } from "..."` — use a direct import and export, or import from the module consumers need.
- Assume renaming a source file fixes game errors without a full resync (`u` in viteburner) — stale `.js` on `home` may still reference old paths.
- Use `sourcemap: "inline"` for synced scripts unless you have a specific reason (this repo uses `sourcemap: false` in `viteburner` config).

**Do**

- Use `@/` or relative `./` imports with a `.js` extension in TypeScript source.
- Import constants from the defining module (e.g. `OFFICE_FUND_BUFFER` from `farmland.js`) instead of re-exporting through another file unless necessary.
- Keep dynamic `import()` relative when possible; the `bitburnerImportPaths` plugin in `vite.config.ts` still normalizes `/src/libraries/` → `/libraries/` and `.ts` → `.js` in emitted code for cases viteburner does not fix.
- After changing `vite.config.ts`, **restart** `pnpm run dev`, then press **`u`** for a full upload.
- If debugging, check synced files on `home` (e.g. `libraries/corporation/office.js`) for leftover `/src/` or `.ts` in import/export strings. Remove a stray `home/src/` folder if created during experiments.

**Repo safeguards** (`vite.config.ts`)

- `bitburnerImportPaths` Vite plugin (post-transform): `/src/libraries/` → `/libraries/`, `.ts` → `.js` in module path strings.
- `viteburner.sourcemap: false` to avoid inline maps pointing at `.ts` files during RAM calc.

**Example error**

```
Cannot calculate RAM usage of corporation.js. Reason: "/src/libraries/corporation/farmland.ts" does not exist on server: home
```

Typical causes: unrewritten `export { } from "/src/.../farmland.ts"` in uploaded JS, or dynamic `import("/src/.../farmland.ts")`, often after switching to `@/` without the Vite plugin or before removing re-exports.

### Script entry points

All Bitburner scripts must export a `main` function:

```typescript
import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
  // Script logic here
}
```

### Key script categories

- **Hacking automation**: `batch.ts`, `autoNuke.ts`, `analyzeTargets.ts`, `libraries/crawl.ts`, `libraries/batchExecution.ts`
- **Visual enhancements**: `glow.ts`, `scanline.ts`, `libraries/floatingWindow.ts` — UI changes via DOM manipulation
- **Contract solvers**: `contractSolver.ts`, `libraries/contractWorker.ts`
- **Utilities**: Connection helpers, server management, dashboards under `src/libraries/`

### File sync

- **viteburner** (`pnpm run dev`) handles compilation and game sync — treat the game connection as always available
- Source lives in `src/`; compiled output goes to `dist/` and is pushed to the game automatically
- Allowed file types in game: `.js`, `.script`, `.txt`

### Documentation sources

Use the right source depending on what you need:

| Source | When to use |
|--------|-------------|
| [`NetscriptDefinitions.d.ts`](NetscriptDefinitions.d.ts) | API signatures, JSDoc, RAM costs, return types while writing or editing scripts |
| [Bitburner docs (oddiz fork)](https://bitburner-fork-oddiz.readthedocs.io/en/latest/) | Gameplay mechanics, NS2 rules, migrations, and non-API topics |
| Cursor **@Docs** | Add the ReadTheDocs URL above in **Settings → Features → Docs** for semantic search over the full doc site in chat |
| Local game source (`../bitburner-src`) | Game client internals: UI routing, `Player` methods, infiltration flow, React components |

For Netscript API work, prefer `NetscriptDefinitions.d.ts` first — it matches this repo and is faster than fetching individual doc pages.

#### Local Bitburner game source (`../bitburner-src`)

A clone of [bitburner-official/bitburner-src](https://github.com/bitburner-official/bitburner-src) lives next to this repo at `../bitburner-src` (e.g. `c:\Users\domin\dev\bitburner-src`).

- **Branch:** Use **`stable`** when investigating behavior of the Steam/release client. Use `dev` only for unreleased mechanics or when intentionally tracking upstream in development.
- **Agents:** Read files from `../bitburner-src` directly. Do **not** fetch the same files from GitHub when the local clone is present.
- **Scope:** This is the game **client** (React UI, `Player`, `Router`, `Locations`, infiltration minigames). It is **not** a substitute for `NetscriptDefinitions.d.ts` for `ns.*` API work.

Useful paths for infiltration automation in this repo:

| Topic | Path in `../bitburner-src` |
|-------|----------------------------|
| `Player.initInfiltration` | `src/PersonObjects/Player/PlayerObjectGeneralMethods.ts` |
| `Infiltration.startInfiltration` / `cancel` | `src/Infiltration/Infiltration.ts` |
| Infiltrate Company button | `src/Locations/ui/CompanyLocation.tsx` |
| City map navigation | `src/Locations/ui/City.tsx` |
| `Locations` map keys | `src/Locations/Locations.ts`, `src/Locations/data/LocationsMetadata.ts` |
| `ns.infiltration` API | `src/NetscriptFunctions/Infiltration.ts` |
| Page routing | `src/ui/GameRoot.tsx`, `src/ui/Router.ts` |

**`window` globals:** Production builds do **not** expose `Locations` or `Router` on `window`. The dev build only exposes `globalThis.Bitburner` (with `Player`, `Factions`, `Companies`, etc.) when `NODE_ENV === "development"` — see `src/engine.tsx`. Scripts that call `eval("window").Player` or `window.Locations` are relying on hooks that may be absent in release; DOM/React fallbacks exist for that reason.

### Development patterns

- Use `eval("document")` and `eval("window")` to access DOM in the game environment
- Import/export works between scripts, but files must be compiled to JavaScript
- Game has RAM costs for script execution — optimize for memory usage
- Scripts can be executed with arguments via `ns.args`

### Testing

- `bench/` holds the benchmarks and simulations; there is no formal test runner — manual testing in the game environment
- Documentation lives in `docs/` (`AGENTS.md` here, with a pointer stub at the repo root)

#### HTML tools index

`index.html` at the repo root is the landing page for every browser tool. **`pnpm run tools` is the
one command that serves them all** — it starts the Vite dev server (`http://localhost:5173/`,
`HTML_TOOLS_PORT` overrides) *and* the IPvGO backend, and stops both on ctrl-c:

| Tool | Path | Notes |
|------|------|-------|
| Stock trader benchmark | `bench/stock/stockTraderViz.html` | imports `stockBenchCore.ts`, module workers |
| KingOfTheHill profiles | `bench/koth/kingOfTheHillViz.html` | imports `kingOfTheHillCore.ts`, module workers |
| IPvGO engine bench | `ipvgo-engine/web/bench.html` (also `/bench`) | `/api` + `/health` proxied to the backend it starts |

How the pages stay current while you edit them: every page is served through Vite, so the injected
client reloads the tab when the HTML changes **and when any module it imports changes** — the `.ts`
model, a worker, or `webui/toolUi.js`. There is no per-tool build step in the way: pages import the
TypeScript model directly (`import * as StockBench from "./stockBenchCore.ts"`), Vite resolves the
`@/…` alias and `.js`→`.ts` specifiers, and a worker is
`new Worker(new URL("./xWorker.ts", import.meta.url), { type: "module" })`. `vite.tools.config.mts`
holds the manifest (rollup inputs, the `/api` proxy, the `/bench` alias).

`pnpm run tools:build` writes the same pages as a static site to `dist/tools/` (`tools:preview`
serves it with the backend attached). Nothing is generated per tool any more, and no page is
expected to work from `file://`: ES module imports and module workers need an http origin.

Add a card to `index.html` and, if the page is a new file, an entry to `rollupOptions.input` in
`vite.tools.config.mts`.

`pnpm run server` still runs the IPvGO server alone on port 3010, serving its own copy of
`/bench` — that is the path for using the bench without the tools dev server (and the only one
that exists outside the repo, since it needs the native engine).

#### Shared UI kit (`webui/`)

All three pages link `webui/toolUi.css` (before their own `<style>`, so a page can override anything) and `webui/toolUi.js`:

- **`toolUi.css`** — the in-game tail look: `#141414` background, monospace 12px, 1px translucent borders, square corners. Carries the tokens (`--text`, `--dim`, `--line`, `--accent`, `--bad`, …), the shell (`header`/`main`/`section h2` with `=== ` prefixes), form controls (`label.field`, 150px inputs, drawn checkboxes, `button.primary`/`.ghost`), tables, `.cards`/`.card` stat cards, `.tabs`/`.tab`, and the text tones (`.pos`/`.neg`, `.dim`, `.hint`, `.err`).
- **`toolUi.js`** — `ToolUi.el`, `ToolUi.store` (guarded localStorage JSON), `ToolUi.numberOf`/`textOf`, `ToolUi.persist(key, scope)` (save/restore/clear every control with an id; opt out with `data-nopersist`), `ToolUi.format`, `ToolUi.setCards`, `ToolUi.setStatus`, `ToolUi.poolFrom(createWorker, size)` (any worker: this is what module workers use) and `ToolUi.pool(source, size)` (workers built from a blob of script text). Both return the same pool object — `.size`, `.map(jobs, onProgress)`, `.terminate()`.
- **Numbers are written out in full with a space every three digits** (`10 000 000`, `+12 502 852.61%`), not with k/m/b/t suffixes — at this game's scales `$1.25q` hides the magnitude. `ToolUi.format.money`/`signedMoney`/`pct`/`signedPct`/`grouped`/`count` all do this; `ToolUi.format.number` is the compact suffix form and is only for width-constrained spots such as chart axis ticks. Seed values are identifiers, so they stay ungrouped.
- **Inputs show grouped numbers too.** A numeric input opts in with `type="text" inputmode="numeric" data-group="1"` (a `type="number"` input cannot hold spaces); a document-level `focusout` handler rewrites it via `ToolUi.groupedInput`. Typing the default back in clears the field instead, so "empty means default" and the grey/white convention still hold. `ToolUi.numberOf` strips the separators.

Conventions both bench pages follow:

- **Defaults are grey, overrides are white.** An input starts empty and shows its default as its grey `placeholder`; `ToolUi.numberOf` reads the typed value or falls back to `data-default`/the placeholder. Nothing else tracks "is this default?".
- **Settings survive reloads.** `ToolUi.persist("toolui.<tool>.v1", document)` on load, and it saves on every `input`/`change`.
- **Seeds come from a deterministic pseudo-random stream, not a range.** `randomSeeds(stream, count)` in `stockBenchCore.ts` (mulberry32) is the single source: the *Seed* field picks the sequence, *Seeds* is the count, and a shorter run is a prefix of a longer one. Contiguous `1..n` was the old behaviour and shared market structure across seeds; keep explicit ranges on the CLI (`--seed-range`) where they are asked for by name.
- **Workers are modules loaded from the page's own sources.** A page that needs threads writes `new Worker(new URL("./xWorker.ts", import.meta.url), { type: "module" })`, and the worker imports the same model the page does — one copy of the code on disk. Vite rewrites the URL in dev and bundles it for a build; a plain static server cannot serve it, which is why the pages require `pnpm run tools`. `ToolUi.poolFrom` wraps a set of them into a job pool; `ToolUi.pool(source, size)` remains for anything that still builds a worker from script text. The stock page caps at 12 workers (measured on a 12-thread CPU: 1 worker 960 ms, 6 → 310 ms, 8 → 285 ms, 12 → 335 ms for 25 seeds × 3000 updates, so mid single digits is the sweet spot).
- The shared colours replace the older ad-hoc palettes; the KingOfTheHill plot colours are remapped to the same accent/red/warn tokens.
- Chart series get one hue each, never a positional colour, and the stock page's comparison view is fixed: **tuned** (green `#3ddc84`, the stored genome), **v5 (shipped)** (blue `#4c9df0`), **v4** (coral `#ff8a65`: the same code with `V4_RULES` — no variance drag, no idle-cash pass, moving-average estimate without 4S), an **edited config** (cyan `#22d3ee`, drawn only when its results differ from every other line), **hold (filtered)** (yellow `#f2e85c`) and **hold (all)** (grey `#808080`). Rules learned the hard way: never give two series the same hue (an early palette had `#43bf43` and `#4f8f4f`, distinguishable only by brightness), and avoid red for a positive-return curve because `.neg` already means loss in the UI. Each line is drawn with a dark 4px casing under a 2px colour stroke so overlapping bands stay readable.
- **The legend is a `<table class="legend">`, one row per series, built as elements (not one innerHTML blob) so each row owns a click handler** that adds its series id to `hiddenSeries` and redraws. Columns are series, seeds, median return, p10, p90 so the numbers line up; a hidden row keeps its place with `tr.off`. The y-axis rescales to the visible series only. `drawChart` clears `#legendBody`, never `#legend` itself: emptying the table deletes the body `renderLegend` fills.

#### Stock market benchmark

Everything lives in `bench/stock/`:

| File | Purpose |
|------|---------|
| `stockMarketModel.ts` | Local port of the game's market (`../bitburner-src` `stable`: `Stock.ts`, `processStockPrices`/`stockMarketCycle`, `BuyingAndSelling.tsx`, `StockMarketHelpers.ts`, `InitStockMetadata.ts`) |
| `stockBenchCore.ts` | Shared, environment-free benchmark logic (pure; no CLI/DOM) |
| `stockTuner.ts` | Genetic search over the strategy config, ported from the ipvgo tuner (`ipvgo-engine/cpp/game/game_cli.cpp`, `runTune`): common random numbers, cached pure fitness, elitism + tournament + uniform crossover, held-back validation, resumable |
| `stockTraderBench.ts` | CLI front end |
| `stockTraderViz.html` | GUI front end (imports `stockBenchCore.ts` directly) |
| `stockVizWorker.ts` | GUI worker (imports the same core) |
| `stockTraderBench.mjs` | Generated CLI bundle (gitignored; do not edit) |

The model uses a seeded RNG, so a seed fully determines the market. Both front ends run the real strategy from `src/libraries/stock/trader.ts` via a fake `NS`, one `runStockTradingTick` per 6s stock update. There is one strategy; earlier versions were removed once it beat them (history and measurements in [stock-trader.md](./stock-trader.md)).

How the strategy works, in the terms the code uses:

- **Edge** = `(2 * forecast - 1) * volatility`, the expected price move per update. A company needs `entryEdge` to receive money; a position closes when its edge falls to `exitEdge`.
- **Every trade moves the forecast against the trader.** `processTransactionForecastMovement` takes 0.006 off the outlook magnitude (`|forecast - 0.5| * 100`, floor 5) per `shareTxForMovement` shares, buy or sell. With it switched off in the model the same rules return over twice as much, so position size has a real cost that grows with the account. `allocateWithImpact` hands investable cash out in slices to whichever company gains the most expected growth after the slice's own impact, which concentrates a small account, spreads a large one, and lets money a capped company cannot hold flow to the next one. The game does not report `shareTxForMovement`; `SHARES_PER_MOVEMENT` holds the midpoint of each company's range from `InitStockMetadata`, so keep it in sync with `../bitburner-src`.
- **The 75-update cycle is observable with 4S.** A strong forecast cannot cross 50% in an ordinary update, so one that does marks the cycle exactly (`observeCycle`; the self-test checks it against the model). The rotation test uses the updates left until the next cycle as part of its horizon: a swap must earn back `rotationCostFactor` round trips.
- **Never trim.** Only the exit rule and rotation sell; a per-update sell back to target pays the impact twice.
- **Variance drag and idle cash.** `impactedGrowth` subtracts `varianceScale × w² × volatility² / 6` (log-growth drag), which keeps a jumpy, weak-lean company from taking most of the account. When every eligible company is capped, a second allocation pass admits edges ≥ `idleEntryFraction` × entry with outlook ≥ `idleMinOutlook` (10). A company sold by rotation is excluded from that pass for the same update: without that, the pass bought back what rotation had just sold, every update. Low outlook (< ~5–10) is dangerous because the game moves such forecasts ten times faster, so they flip across 50% repeatedly.
- **Without 4S** `getForecast`/`getVolatility` throw, so both are estimated from prices (`estimateEdge`: twice the mean log return; `estimateVolatility`: twice the mean absolute log return) and the same rules run with `no4sEntryEdge` and the much higher `no4sRotationCostFactor`. With `no4sCycleAware` (default on), `blindCycle.ts` finds the 75-update cycle phase from prices (argmin of a per-phase reversal score — the true boundary is the *lowest* score, not a negative one) and tracks each company's edge sign across cycles; it replaces the moving average once the phase is known (150 updates). Measured 3.58× over the moving average alone. It keeps at most 3000 returns per company, dropping whole cycles. Its state lives in `StockTraderState.blindCycle`; `blindEdges` holds the last result for the dashboard.
- **Hacking influence.** `libraries/stock/influence.ts` publishes the held side per company server on port 31 (`STOCK_INFLUENCE_PORT`); `hacking/hack.ts`, `grow.ts` and `grindLoop.ts` peek it and pass `{ stock: true }` only when it helps (grow on a long, hack on a short). The check is inlined in each worker on purpose: workers are `scp`'d to other hosts without their imports, and `peek` costs 0 GB. `stockTrader.ts` publishes every update and clears the message on exit or liquidation. The bench models it with `--influence <events per update>` / the GUI's **Hack influence** field.
- **The reserve** is the larger of `moneyKeep` (dollars, default 0, the in-game script's first argument) and `reserveFraction` of net worth. `collectTraderSnapshot` reads edges with `estimateEdges(..., record = false)`: the trading tick already recorded this update's prices, and recording twice halves the no-4S window.

Commands and flags:

- `pnpm run test:stock` — bundles `stockTraderBench.ts` (`build/bundleStockTraderBench.cjs`) and runs it. Defaults: `$10b` capital, 3000 updates (~5h of game time), seed 1337, BitNode 8 (shorts unlocked).
- `pnpm run test:stock -- --selftest` — verify the port and the strategy: buy/sell/short formulas, commission and spread, share caps, forecast influence, determinism, up-move rate vs. published forecast, P/L identity, open-position cap, cycle tracking (4S and price-only), allocation spill past a share cap.
- `pnpm run tools` — the stock GUI, and every other HTML tool. One command serves all of them from Vite (`http://localhost:5173/`) and starts the IPvGO backend the bench page needs; editing a page or a model source reloads it. The page imports `stockBenchCore.ts` and runs its seeds in module workers. Seeds come from the **Seed** stream and **Seeds** count (`randomSeeds(stream, count)`: reproducible, and a shorter run is a prefix of a longer one); the chart is `aggregateCurves()`: median seed on a log net-worth axis plus a p10–p90 band, so the mean is not distorted by the long right tail of compounding.
- `--capital <k|m|b|t>`, `--ticks <n>`, `--seed <n>`, `--seeds <n>` (seed `n + i * 9973`).
- Config overrides mirror `src/libraries/stock/config.ts`: `--entry-edge`, `--exit-edge`, `--max-positions`, `--max-weight`, `--max-share-fraction`, `--rotation`, `--impact`, `--min-new-weight`, `--slices`, `--reserve`, `--money-keep`, `--min-shares`, `--shorts 0|1`, and for no-4S runs `--no4s-entry-edge`, `--no4s-rotation`, `--history-ticks`.
- `--no-4s` models a player without the 4S Market Data TIX API. Measured on seeds 201-300: +2,192% median (9.5% mean drawdown) against +10,086% with 4S on seeds 1-100.
- `--influence <n>` models `n` stock-flagged grow/hack events per update on each held company's server (0.05 roughly doubles the median, 1 multiplies it ~17× at $10b; see section 12 of [stock-trader.md](./stock-trader.md)).
- `--compare` also runs the shipped defaults on the same seeds and prints the difference plus a **paired** ratio (net worth per seed: geometric mean, 95% interval, seeds won). Pairing removes most of the seed-to-seed noise, so 20–25 seeds is enough to see a real difference.
- `--seed-stream <n>` draws the seeds from deterministic pseudo-random stream `n` instead of the fixed 9,973 stride: same stream and count always give the same seeds, and a shorter run is a prefix of a longer one, so raising the count only adds markets. This is what the GUI does (its **Seed** field is the stream, **Seeds** the count), so any GUI run can be reproduced exactly with `--seed-stream <seed> --seeds <count>`.
- `--seed-range <a-b>` runs exactly seeds `a..b` inclusive (`--seed-range 1-100`), which is the reproducible way to get aggregate numbers; `--seed`/`--seeds` keep the 9,973-spaced behaviour. 100 seeds x 3000 updates takes ~5s.
- The aggregate report includes `capital ... % of net worth in positions`. Below ~60% the share caps bind and the market, not the rules, limits the run (at $1t only ~40% can be placed above the entry edge). 3000 updates is the horizon for judging strategy changes; a single seed at long horizons can suggest the opposite verdict.
- `--grid entry-edge=0.002,0.0025,0.003 --grid max-positions=3,8 --seeds 5` ranks every combination by mean return.
- `--headroom` prints the ideal-frictionless ceiling (four equal slots, and one slot at full weight) next to the run and how much of it the run captured, plus how many swaps tracking that ideal would need.
- `--baseline none|filtered|all` adds a buy-and-hold reference, measured on every seed like the strategy (one seed's hold is noise against a multi-seed mean); `--json` emits it as `baselines.holdFiltered.{aggregate,runs}`.
- **Capital decides a small-account run.** The commission is a fixed $100k per transaction, so it only becomes cheap as the account grows. `warnFeeShare()` prints a warning once commission passes 25% of the starting capital.
- `--tune` runs the genetic search instead of one config: it trains on the seeds from `--seed-range`/`--seed-stream`/`--seeds` (a contiguous block of 16 when fewer than 4 were asked for), then re-measures the winner against the shipped defaults on 3x as many held-back seeds. Genes (`stockGeneSpecs`): entry/exit edge, rotation hurdle, max positions, max weight, max share fraction, impact scale, cash reserve, shorts, plus the no-4S genes when tuning without 4S. Every gene is a `StockTraderConfig` field. `--population <n>` (default 6), `--generations <n>` (default 6), `--tune-seed <n>`. Fitness is mean log growth (geometric mean return); the `vs default` column is the paired per-seed difference, which is the number to trust.
- **What a tuning score may hold is multiplied by every genome ever tried.** The cache keeps one score per genome for the whole run — that is what makes the `reused` counts and resuming work — so `scoreGenome()` deliberately keeps scalars only and blanks `equityCurve` and `perSymbol`. Retaining the raw `BenchResult`s cost 680 KB per genome at 3000 updates and 7.9 MB at 40 000 (one number per update per seed), i.e. 158 MB for 240 genomes and several GB for a 100-seed x 20-generation x 12-population search, which killed the browser tab. After the fix it is 13–14 KB per genome at either horizon. Curves are re-measured only for an improving incumbent (the one line the chart draws), and GUI workers receive `lite: true` so training jobs never post curves back at all. Apply the same rule to any new per-genome state.
- The GUI stores the config form in the shared `ToolUi.persist` snapshot and the tuning result in `toolui.stockBench.tuned.v2` (genome + growthPct + generation/generations + the config it was measured against; the key moved from `.v1` when the gene set changed, so old v2/v3 results are ignored). Programmatic writers (apply-best, grid row click) must call `form.save()`, because setting `.value` fires no `input` event.
- **Export** / **Import file...** move that result as one file (`stock-tune-<date>-<hh>-<mm>.json`). `sanitizeTuningEntry()` rebuilds it from allowed fields only, clamping genes to `stockGeneSpecs()`'s own ranges (both 4S modes, since the file does not say which produced it) and counting anything it drops; a file without a usable genome (including an old `{v2, v3}` file) is refused and the store is left alone.
- Edits to `src/libraries/stock/*` take effect on the next run because the bundle is rebuilt first.
- **`moneyKeep` comes from the form for every comparison line.** It is an account policy, not a gene, so the shipped and tuned lines use the form's value too. A line with zero trades is labelled `(no trades)` in the legend and explained in the status bar, so a silent run cannot be mistaken for a flat result.
- To benchmark a different strategy, import `runScenario`/`createNsStub`, or point `build/bundleStockTraderBench.cjs` at a new entry file.
- Keep the model in sync with `../bitburner-src` when the game's stock internals change; the self-test catches formula drift, not missing mechanics.

#### KingOfTheHill benchmark

`bench/koth/` holds the simulation (`kingOfTheHillSim.mjs`), the parallel benchmark (`kingOfTheHillBench.mjs`), the browser viz, and `koth_tune/` (C++ tuner plus Python harness). `kingOfTheHillCore.ts` is the shared core; the browser pages import it directly (Vite, via `pnpm run tools`), while the Node entry points import the esbuild output from `build/bundleKingOfTheHill*.cjs`, so edit the `.ts` and re-run `pnpm run test:koth:bundle` (or `test:koth:bench`) before running a CLI benchmark.

**Near-peak check** (`withNearPeakCheck` in `src/dnet/solvers/kingOfTheHill/ladderSnipeSolver.ts`). Within 3% of the password the game returns the main hill alone, so one reading `(x, alt)` taken there puts the password at `x + d` or `x - d` with `d = width * sqrt(ln(10000 / alt))`, whatever the altitude. Both candidates reproduce that reading by construction, so the choice between them comes from the other readings: `hillModel.ts` is a bit-exact port of the game's generator (WHRNG seeded with the password, 9 hills at `p + r*3w*(0.9..1.1)` with heights `10000 - r*2600*(0.95..1.05)`), and a candidate that does not reproduce *every* reading already taken is not the password. That replaces the wrong-side guess (worth ~0.43 guesses per solve) and also rejects candidates derived from a reading outside the true zone. The tolerance is `1e-12` relative on purpose: a candidate derived from one reading agrees with it to ~1e-8 because `d` is rounded to an integer, and re-deriving the *true* password reproduces each reading bit for bit. Candidate guesses count as guesses but are hidden from the ladder and do not move its best point. It needs the full-precision altitude from the response `data`; with only the five-decimal message it practically never fires. The C++ tuner (`koth_tune/src/koth_solver.cpp`) mirrors all of this (`ProbeSession::tryNearPeak`), so `koth_bench` and the shipped solver agree.

**Two other changes the same round.** The pair inversion already gives the hill's centre *and* its height (`h = a * exp(dx^2 / w^2)`), so the centre probe is skipped whenever that height lands on the generator's height ladder (`onHeightLadder`, with `|a| >= 1000` and the centre within `0.7w` of the anchor) — one guess less per hop. And the direction test is merged into the jump: the landing is verified by the rank it reads (`round((10000 - a) / 2600)`), so a hop that does not move closer to the peak is flipped instead of climbing on from a tail reading. `pinpoint` no longer scans adjacent integers on a side hill, and after the ladder the generic pipeline restarts from the best positive reading it saw rather than from the coarse anchor.

Measured at difficulty 60 (the first row is the viz default seed, `Tests` = 100 000):

| Seed / count | Mean guesses | p95 | p99 | Worst |
|---|---:|---:|---:|---:|
| 1265595496 / 100 000 | 7.194 -> 6.441 -> **5.659** | 16 -> 11 -> **9** | 16 -> 13 -> **12** | 54 -> 31 -> 32 |
| 4242 / 100 000 | 6.459 -> **5.675** | 11 -> **9** | 13 -> **12** | 47 -> 38 |

Over difficulties 1-60 (seed 4242, 2000 each) total guesses fell 9.3% against the previous solver; 53 of 60 difficulties improved, none got worse, and difficulties 1-7 (one hill) are unchanged. Most of the remaining spread is reaching the near zone: a one-hop solve is coarse probe + pair probe + jump + near-peak guess (4-5 guesses), and the histogram now peaks there (58 900 of 100 000 at 5). The ~1 500 cases that got slower are ones where the ladder now runs where it used to be skipped (`positiveLadderSkipRangeFraction` 0.74 -> 0, worth ~0.1 guesses on average but a long tail on a few dozen assignments). Where the ladder samples is still the open question, not how it refines.

The constants live in `TUNED_LADDER_SNIPE_DIFF60` (`src/dnet/solvers/kingOfTheHill/tuning.ts`) and `bench/koth/koth_tune/ladder_snipe.diff60.best.json` is kept as a mirror of it, so `koth_bench --variants ladder_snipe_tuned` reports the shipped numbers (5.68 at difficulty 60 versus 5.66 for the TS path — the last case differs, everything else agrees). A quick way to try a constant: bundle `kingOfTheHillCore.ts` and run `kingOfTheHillBench.mjs --count 100000 --diff-min 60 --diff-max 60 --workers 12` (about 12 s), or pass `tuning` overrides to `runSolverImproved` in a scratch script (about 2 s per 100 000 assignments).

**The bench must take the game's probes.** The bench runs the solver straight through (`createAuthProbeSession`); the game replays it from the stored samples for every guess (`solverModule.ts` -> `runUntilNextProbe` -> `createReplayProbeSession`). Until this change the two disagreed on 928 of 10 000 assignments and the game averaged 7.95 guesses where the bench reported 7.20. Two causes, both fixed: the replay session started from the best of all stored samples and let the ladder read samples it had not asked for yet, and `crest` wrapped its probes in a `try/catch` that swallowed the `STOP_PROBE` signal the replay session throws to request a probe. Keep both rules: nothing between the solver and the session may catch `STOP_PROBE`, and the solver reads samples only through the session it is given. `pnpm run test:koth -- --parity --count 10000` compares the two paths probe by probe and exits non-zero on any difference.

The game itself runs `src/dnet/solvers/solverWorker.js`, a gitignored bundle that `pnpm run dev` builds at start-up (`pnpm run bundle:solver-worker` rebuilds it alone), so a solver edit reaches the game only after one of those.

### Special considerations

- Game environment restrictions require careful DOM access patterns
- Memory constraints affect script design
- Real-time file syncing enables rapid development iteration
- Visual modification scripts use extensive DOM manipulation and CSS injection

### In-game UI text

Scripts that render in the game (tail logs, `printRaw`, terminal output, floating windows) should match the game's visual language:

- Use plain ASCII for labels and status text (letters, numbers, basic punctuation)
- Do not use decorative Unicode (arrows, bullets, emoji, box-drawing, fancy dashes, etc.) — they clash with the game's monospace UI
- Prefer styling (background color, font weight) over symbols to indicate state

## Instructions for agents

- **Always consult `NetscriptDefinitions.d.ts` when working with NS API functions** — it contains complete documentation, RAM costs, and type signatures
- **For game UI / `Player` / infiltration internals**, read `../bitburner-src` on the **`stable`** branch instead of fetching GitHub raw URLs
- Do not run linter, TypeScript checks, or build commands unless explicitly requested by the user
- Do what has been asked; nothing more, nothing less
- Do not create files unless they are absolutely necessary for the goal
- Prefer editing an existing file over creating a new one
