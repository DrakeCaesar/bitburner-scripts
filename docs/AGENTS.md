# Agent guide

Context for AI coding assistants working in this repository.

## Common development commands

### Development and file sync

- `pnpm run dev` — Runs **viteburner**, which connects to the game, compiles TypeScript, and syncs scripts with hot reload. **Assume this is always running** — edits in `src/` appear in the game automatically; no manual copy step is needed.

### Code quality

- `pnpm run lint` — Run prettier, eslint, and sort-package-json (auto-fixes)

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

`index.html` at the repo root is the landing page for every browser tool, so any static server rooted at the repo serves it at `/`. `pnpm run tools` provides one (port 8123, `HTML_TOOLS_PORT` overrides); it is needed for pages that load module workers:

| Tool | Path | Needs |
|------|------|-------|
| Stock trader benchmark | `bench/stock/stockTraderViz.html` | nothing (self-contained page) |
| KingOfTheHill profiles | `bench/koth/kingOfTheHillViz.html` | http origin, `pnpm run test:koth:bundle` |
| IPvGO engine bench | `ipvgo-engine/web/bench.html` | `pnpm run server` (port 3010) |

Add a card to `index.html` when adding a new HTML tool.

#### Shared UI kit (`webui/`)

All three pages link `webui/toolUi.css` (before their own `<style>`, so a page can override anything) and `webui/toolUi.js`:

- **`toolUi.css`** — the in-game tail look: `#141414` background, monospace 12px, 1px translucent borders, square corners. Carries the tokens (`--text`, `--dim`, `--line`, `--accent`, `--bad`, …), the shell (`header`/`main`/`section h2` with `=== ` prefixes), form controls (`label.field`, 150px inputs, drawn checkboxes, `button.primary`/`.ghost`), tables, `.cards`/`.card` stat cards, `.tabs`/`.tab`, and the text tones (`.pos`/`.neg`, `.dim`, `.hint`, `.err`).
- **`toolUi.js`** — `ToolUi.el`, `ToolUi.store` (guarded localStorage JSON), `ToolUi.numberOf`/`textOf`, `ToolUi.persist(key, scope)` (save/restore/clear every control with an id; opt out with `data-nopersist`), `ToolUi.format`, `ToolUi.setCards`, `ToolUi.setStatus`, and `ToolUi.pool(source, size)` (blob-URL worker pool).
- **Numbers are written out in full with a space every three digits** (`10 000 000`, `+12 502 852.61%`), not with k/m/b/t suffixes — at this game's scales `$1.25q` hides the magnitude. `ToolUi.format.money`/`signedMoney`/`pct`/`signedPct`/`grouped`/`count` all do this; `ToolUi.format.number` is the compact suffix form and is only for width-constrained spots such as chart axis ticks. Seed values are identifiers, so they stay ungrouped.
- **Inputs show grouped numbers too.** A numeric input opts in with `type="text" inputmode="numeric" data-group="1"` (a `type="number"` input cannot hold spaces); a document-level `focusout` handler rewrites it via `ToolUi.groupedInput`. Typing the default back in clears the field instead, so "empty means default" and the grey/white convention still hold. `ToolUi.numberOf` strips the separators.

Conventions both bench pages follow:

- **Defaults are grey, overrides are white.** An input starts empty and shows its default as its grey `placeholder`; `ToolUi.numberOf` reads the typed value or falls back to `data-default`/the placeholder. Nothing else tracks "is this default?".
- **Settings survive reloads.** `ToolUi.persist("toolui.<tool>.v1", document)` on load, and it saves on every `input`/`change`.
- **Seeds come from a deterministic pseudo-random stream, not a range.** `randomSeeds(stream, count)` in `stockBenchCore.ts` (mulberry32) is the single source: the *Seed* field picks the sequence, *Seeds* is the count, and a shorter run is a prefix of a longer one. Contiguous `1..n` was the old behaviour and shared market structure across seeds; keep explicit ranges on the CLI (`--seed-range`) where they are asked for by name.
- **Workers come from the page text.** A page that needs threads keeps its bundle in `<script id="…">` and builds the worker script from `thatScript.textContent`, so there is one copy of the code and it still works from `file://` (blob workers are allowed there; ES module imports are not). The stock page caps at 12 workers (measured on a 12-thread CPU: 1 worker 960 ms, 6 → 310 ms, 8 → 285 ms, 12 → 335 ms for 25 seeds × 3000 updates, so mid single digits is the sweet spot).
- The shared colours replace the older ad-hoc palettes; the KingOfTheHill plot colours are remapped to the same accent/red/warn tokens.
- Chart series get one hue each, never a positional colour, and the stock page's comparison view is fixed: **v2 tuned** (green `#3ddc84`), **v3 tuned** (magenta `#cc79a7`), **v2** shipped (blue `#4c9df0`), **v3** shipped (violet `#8f7bff`), **v1** (amber `#e0a33a`), an **edited config** (cyan `#22d3ee`, drawn only when its results differ from every other line), **hold (filtered)** (yellow `#f2e85c`) and **hold (all)** (grey `#808080`). Rules learned the hard way: never give two series the same hue (the first palette had `#43bf43` and `#4f8f4f`, distinguishable only by brightness), and avoid red for a positive-return curve because `.neg` already means loss in the UI. Each line is drawn with a dark 4px casing under a 2px colour stroke so overlapping bands stay readable.
- **The legend is a `<table class="legend">`, one row per series, built as elements (not one innerHTML blob) so each row owns a click handler** that adds its series id to `hiddenSeries` and redraws. Columns are series, seeds, median return, p10, p90 so the numbers line up; a hidden row keeps its place with `tr.off`. The y-axis rescales to the visible series only. The page always draws every strategy and version — v1, v2, v3, each stored tuned genome, the edited config, hold — so the Strategy control became **Editing** (`#configFor`, which config the form edits) and a new **Target** (`#tuneTarget`: v2 | v3 | both) drives the search. `runTuners()` runs one `StockTuner` per target and batches each generation's pending genomes from all of them into a single `runJobs` call.
- **A canvas is sized from its CSS box in *both* directions.** `#chart` owns the display size in CSS (`width: 100%; height: 300px`); `drawChart` reads `clientWidth`/`clientHeight`, sizes the backing store to that times `devicePixelRatio`, and draws in CSS pixels. The earlier code read `clientWidth` but assumed a fixed height of 300 while the CSS said 260, which squashed every label and gridline by ~15% by an amount that changed with the window. A `ResizeObserver` (falling back to `resize`) redraws the last series, and a `matchMedia` dppx query catches moves to a display with different scaling.

#### Stock market benchmark

Everything lives in `bench/stock/`:

| File | Purpose |
|------|---------|
| `stockMarketModel.ts` | Local port of the game's market (`../bitburner-src` `stable`: `Stock.ts`, `processStockPrices`/`stockMarketCycle`, `BuyingAndSelling.tsx`, `StockMarketHelpers.ts`, `InitStockMetadata.ts`) |
| `stockBenchCore.ts` | Shared, environment-free benchmark logic (pure; no CLI/DOM) |
| `stockTuner.ts` | Genetic search over the strategy config, ported from the ipvgo tuner (`ipvgo-engine/cpp/game/game_cli.cpp`, `runTune`): common random numbers, cached pure fitness, elitism + tournament + uniform crossover, held-back validation, resumable |
| `traderV1.ts` | Frozen copy of the original strategy, kept as the baseline the current one is measured against |
| `stockTraderBench.ts` | CLI front end |
| `stockTraderViz.template.html` | GUI front end (source) |
| `stockTraderBench.mjs`, `stockTraderViz.html` | Generated artifacts (gitignored; do not edit) |

The model uses a seeded RNG, so a seed fully determines the market. Both front ends run the real strategy from `src/libraries/stock/trader.ts` via a fake `NS`, one `runStockTradingTick` per 6s stock update.

The strategy ranks symbols by **edge** = `(2 * forecast - 1) * volatility`, the expected price move per update. The forecast is the game's published up-move probability, so edge is the expected return; `bench/stock/traderV1.ts` is the previous forecast-threshold strategy, frozen as a comparison point. For a from-scratch explanation of the market, the metric, and both strategies with pseudocode, see [stock-trader.md](./stock-trader.md).

Three strategies exist: `v1` (frozen), `current` = v2 (`src/libraries/stock/trader.ts`), and `v3` (`src/libraries/stock/traderV3.ts`: v2's rules with weight ∝ edge and a fractional cash reserve). `--strategy <id>` picks one; `--compare` pairs whichever is selected against the earlier ones on the same seeds (v3 → v2 and v1, v2 → v1). v3 beats v2 by 1.07-1.08x paired net worth and v1 by ~6.2x; see section 11 of [stock-trader.md](./stock-trader.md) for the full experiment log, including the sizing ideas that lost (Kelly, more slots, concentration, trimming).

- `pnpm run test:stock` — bundles `stockTraderBench.ts` (`build/bundleStockTraderBench.cjs`) and runs it. Defaults: `$10b` capital, 3000 updates (~5h of game time), seed 1337, BitNode 8 (shorts unlocked).
- `pnpm run test:stock -- --selftest` — verify the port: buy/sell/short formulas, commission and spread, share caps, forecast influence, determinism, up-move rate vs. published forecast, P/L identity.
- `pnpm run stock:viz` — builds `stockTraderViz.html` from the template, inlining the core into the page. Open the file directly (VS Code browser or any browser): the page links `webui/toolUi.css` + `toolUi.js` and spawns its seeds as blob workers, both of which work from `file://`. Seeds come from the **Seed** stream and **Seeds** count (`randomSeeds(stream, count)`: reproducible, and a shorter run is a prefix of a longer one); the chart is `aggregateCurves()`: median seed on a log net-worth axis plus a p10–p90 band, so the mean is not distorted by the long right tail of compounding.
- `--capital <k|m|b|t>`, `--ticks <n>`, `--seed <n>`, `--seeds <n>` (seed `n + i * 9973`).
- Config overrides mirror `src/libraries/stock/config.ts`: `--entry-edge`, `--exit-edge`, `--no4s-entry-edge`, `--no4s-rotate-margin`, `--max-positions`, `--max-weight`, `--max-share-fraction`, `--rotate-margin`, `--history-ticks`, `--min-shares`, `--money-keep`, `--shorts 0|1`.
- `--no-4s` models a player without the 4S Market Data TIX API. The game throws from `getForecast`/`getVolatility` in that case, so the strategy estimates the edge as `2 x mean log return` over the last `--history-ticks` prices and switches to the stricter `no4sEntryEdge` / `no4sRotateMargin` defaults. Measured at 15 seeds / 3000 updates: +555% versus +6,689% with 4S; see [stock-trader.md](./stock-trader.md).
- `--compare` runs the frozen v1 strategy on the same seeds and prints the difference, plus a **paired** ratio (current/v1 net worth per seed: geometric mean, 95% interval, and how many seeds current wins). Pairing removes most of the seed-to-seed noise, so 20–25 seeds is enough to see a real difference; `--strategy v1` runs only the baseline.
- `--seed-stream <n>` draws the seeds from deterministic pseudo-random stream `n` instead of the fixed 9,973 stride: same stream and count always give the same seeds, and a shorter run is a prefix of a longer one, so raising the count only adds markets. This is what the GUI does (its **Seed** field is the stream, **Seeds** the count), so any GUI run can be reproduced exactly with `--seed-stream <seed> --seeds <count>`.
- `--seed-range <a-b>` runs exactly seeds `a..b` inclusive (`--seed-range 1-100`), which is the reproducible way to get aggregate numbers; `--seed`/`--seeds` keep the old 9,973-spaced behaviour. 100 seeds x 3000 updates takes ~6s.
- The aggregate report includes `capital ... % of net worth in positions`. Below ~60% the share caps and `maxWeightPerSymbol` bind, so extra run length cannot compound and the score is measuring which names happened to be capped during a price run rather than the rules. 3000 updates is the horizon for judging strategy changes; at 30,000 a single seed can suggest the opposite verdict (seed 1337 favours v1 by 2x, while 100 seeds give 84/100 for current at 3.14x). See section 8 of [stock-trader.md](./stock-trader.md).
- `--grid entry-edge=0.002,0.0025,0.003 --grid max-positions=3,4 --seeds 5` ranks every combination by mean return.
- `--headroom` prints the ideal-frictionless ceiling for the horizon next to the run and how much of it the run captured, plus how many swaps tracking that ideal would need and what its spread would cost. Measured: no strategy gets past ~66%, and every attempt to trade closer to it loses (section 12 of [stock-trader.md](./stock-trader.md)).
- `--baseline none|filtered|all` adds a buy-and-hold reference, measured on every seed like the strategies (one seed's hold is noise against a multi-seed mean); `--json` emits it as `baselines.holdFiltered.{aggregate,runs}`.
- **Capital, not the rules, decides a small-account run.** The commission is a fixed $100k per transaction, so it only becomes cheap as the account grows: measured at 1000 updates, $100m pays 7% of capital in fees (+351%) while $30m without 4S pays 56% and *loses* 8%, and $10m without 4S loses 96%. `warnFeeShare()` prints a warning once commission passes 25% of the starting capital. Two related traps: v2 is completely inert at `--capital 1b` because `moneyKeep` is an absolute $1b (0 trades, 0.00%), and 3 positions beat 4 at every capital up to $1b (+82 points at $10m) while 4–5 win at $10b. Section 8 of [stock-trader.md](./stock-trader.md) has the tables.
- `printWarnings()` must not gate v3 on `moneyKeep` (v3 reserves a fraction of net worth), and the no-4S history check applies to v2 *and* v3 — v1 is the only strategy that cannot run without 4S.
- `--tune` runs the genetic search instead of one config: it trains on the seeds from `--seed-range`/`--seed-stream`/`--seeds` (a contiguous block of 16 when fewer than 4 were asked for), then re-measures the winner against the shipped defaults on 3x as many held-back seeds. It tunes `--strategy v2` (default) or `v3`; v3's genome adds `weight tilt` and `cash reserve`, and v1 is rejected because it is frozen and has no genes. `--population <n>` (default 6), `--generations <n>` (default 6), `--tune-seed <n>`. Fitness is mean log growth (geometric mean return); the `vs default` column is the paired per-seed difference, which is the number to trust.
- **What a tuning score may hold is multiplied by every genome ever tried.** The cache keeps one score per genome for the whole run — that is what makes the `reused` counts and resuming work — so `scoreGenome()` deliberately keeps scalars only and blanks `equityCurve` and `perSymbol`. Retaining the raw `BenchResult`s cost 680 KB per genome at 3000 updates and 7.9 MB at 40 000 (one number per update per seed), i.e. 158 MB for 240 genomes and several GB for a 100-seed x 20-generation x 12-population search, which killed the browser tab. After the fix it is 13–14 KB per genome at either horizon. Curves are re-measured only for an improving incumbent (the one line the chart draws), and GUI workers receive `lite: true` so training jobs never post curves back at all. Apply the same rule to any new per-genome state.
- The GUI keeps per-strategy state in separate keys: `toolui.stockBench.tuned.<strategy>.v1` (the genome plus the config it was tuned against) and `toolui.stockBench.config.<strategy>.v1` (that strategy's form values). The config fields carry `data-nopersist` so the shared `ToolUi.persist` snapshot never stores them — otherwise reloading would restore whichever config was active last and the per-strategy copies would be dead weight. Programmatic writers (apply-best, grid row click) must call `saveConfigFor()`, because setting `.value` fires no `input` event.
- **Export both** / **Import file...** move the whole tuning store as one file (`stock-tune-<date>-<hh>-<mm>.json`, shaped `{v2: entry, v3: entry}`, entry = genome + growthPct + generation/generations + the config it was measured against). This mirrors the ipvgo tuning store deliberately: one snapshot for everything, and an import that *replaces* both strategies rather than merging, so a file holding only v2 cannot leave a stale v3 behind. `sanitizeTuningStore()` rebuilds an entry from allowed fields only, clamping genes to `stockGeneSpecs()`'s own ranges (both 4S modes, since the file does not say which produced it) and counting anything it drops; a file with nothing usable is refused and the store is left alone. The per-strategy form configs are not part of the file.
- Edits to `src/libraries/stock/*` take effect on the next run because the bundle is rebuilt first.
- **`moneyKeep` comes from the form for every comparison line**, and v1's frozen config honours a caller-supplied `moneyKeep` too (`runTraderScenario`). It is an account policy, not a strategy gene, and per-line values produced a chart where the shipped `$1b` reserve made v2-as-shipped, v1 and genomes tuned on a `$10b` account all read `+0.00%` on a `$250m` account. A line with zero trades is labelled `(no trades)` in the legend and explained in the status bar, so a silent run cannot be mistaken for a flat result. The `small-capital` harness scenario asserts this.
- To benchmark a different strategy, import `runScenario`/`createNsStub`, or point `build/bundleStockTraderBench.cjs` at a new entry file.
- Keep the model in sync with `../bitburner-src` when the game's stock internals change; the self-test catches formula drift, not missing mechanics.

#### KingOfTheHill benchmark

`bench/koth/` holds the simulation (`kingOfTheHillSim.mjs`), the parallel benchmark (`kingOfTheHillBench.mjs`), the browser viz, and `koth_tune/` (C++ tuner plus Python harness). `kingOfTheHillCore.ts` is the shared core; the `.mjs` files next to it are esbuild output from `build/bundleKingOfTheHill*.cjs`, so edit the `.ts` and re-run `pnpm run test:koth:bundle`.

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
