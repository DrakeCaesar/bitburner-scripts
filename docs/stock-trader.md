# How the stock trader works, from zero

A ground-up explanation of `stockTrader.ts`: what the game's stock market actually does, where the
profit comes from, and how the strategy decides what to trade. Written to be readable with no prior
knowledge of the script or of trading.

Code references:

- [`../src/libraries/stock/trader.ts`](../src/libraries/stock/trader.ts) — the strategy
- [`../src/libraries/stock/config.ts`](../src/libraries/stock/config.ts) — its tunables and defaults
- [`../bench/stock/stockMarketModel.ts`](../bench/stock/stockMarketModel.ts) — the local copy of the
  game's market used to measure it

## 1. The vocabulary

The game has **33 companies**, each with a short code (ECP, FSIG, NTLK…). Everything below is about
those 33.

| Term | What it means here |
|---|---|
| **Share** | One unit of a company. You buy and sell them for money. |
| **Position** | The shares you currently own. "No position" = you own none. |
| **Long** | You bought shares and want the price to **go up**. Profit = (price now − price you paid) × shares. |
| **Short** | The reverse: you "borrow and sell" shares, then buy them back later. You want the price to **go down**. Profit = (price you sold at − price now) × shares. Only available in BitNode 8, or with Source-File 8 at level 2 or higher — that is what `canUseStockShorts` checks. |
| **Price** | The "middle" price of a share, e.g. $100. |
| **Spread** | A fee baked into the price. To buy you pay the **ask** = price × (1 + spread). To sell you receive the **bid** = price × (1 − spread). Spread is 0.1%–2% depending on the company. |
| **Commission** | A flat **$100,000** the game charges on *every* transaction (buy, sell, short, cover). |
| **Forecast** | A number between 0.00 and 1.00 published by the "4S Market Data" upgrade. It is *literally the probability that the next price change is upward*. 0.70 = 70% chance up. |
| **Outlook** | How far the forecast leans, in points: `|forecast − 0.50| × 100`. A forecast of 0.70 has outlook 20. The game calls it `otlkMag`. |
| **Volatility** | A number like 0.004 (calm) to 0.04 (wild). It controls **how far** the price jumps, regardless of direction. |
| **Max shares** | The game refuses to let you hold more than 20% of a company's shares (long and short counted together). `ns.stock.getMaxShares()`. |
| **Tick / update** | The game recalculates all prices every **6 seconds**. One tick = one price update. "3000 updates" = 5 hours of game time. |
| **Net worth** | Your cash on hand + the current value of all positions. |
| **Drawdown** | How far your net worth fell from its previous peak. "Max drawdown 3%" = at the worst moment you were 3% below your best. |

## 2. What the game does every 6 seconds

For each of the 33 companies:

```
v  = random number between 0 and 1     (one shared v for ALL companies this tick)
av = v × volatility                    ← the size of this tick's move, as a fraction
c  = random number between 0 and 1     (fresh for each company)

if c < forecast:  new price = price × (1 + av)     ← "up" move, happens `forecast` of the time
else:             new price = price ÷ (1 + av)     ← "down" move, the rest of the time
```

So with volatility 0.02 and an "up" tick where `v = 0.5`, the price rises 1%. Because `v` averages
0.5, **the average move is half the volatility** (1% for a 2% volatility), and the same `v` is used
for every company, so all prices tend to move together on a given tick.

Three more facts decide how to trade:

- **The forecast drifts slowly.** Each tick it moves by a few percent of its own outlook, wandering
  toward a hidden target (the "second-order forecast"). A company with a strong lean keeps it for a
  long time: the edge's tick-to-tick correlation is 0.987.
- **Every 75 ticks there is a cycle.** Each company independently flips direction with probability
  0.45: the forecast is mirrored around 0.50 (0.70 becomes 0.30), and so is its hidden target. Between
  cycles a strong forecast cannot cross 0.50, so with 4S data the cycle is visible exactly.
- **Trading moves the forecast against you.** Every `shareTxForMovement` shares bought *or sold*
  (30 000 to 216 000 depending on the company) take 0.006 off the outlook, down to a floor of 5, and
  nudge the hidden target toward 0.50 too. A big order erodes the very edge it was bought for.

## 3. Where the profit comes from: "edge"

If the forecast says 70% up and 30% down, and up moves and down moves are similar in size, then over
many ticks you win 70% of the time and lose 30%:

```
expected move per tick = (2 × forecast − 1) × (average move size)
                       = (2 × 0.70 − 1) × (volatility / 2)
```

The strategy is built on the first half of that expression, which the code calls **edge**:

```
edge = (2 × forecast − 1) × volatility  =  outlook / 50 × volatility
```

- `(2 × forecast − 1)` = how one-sided the coin is: +0.4 when forecast is 0.70, 0 when forecast is
  exactly 0.50, −0.4 when forecast is 0.30.
- Multiplying by `volatility` = how big the coin's payoff is.
- **Expected profit per tick ≈ edge ÷ 2** (in fraction of the position's value).

Why multiply, and not just use the forecast? Because the same forecast is worth much more on a jumpy
stock:

| company | forecast | 2f−1 | volatility | edge | expected profit per tick |
|---|---|---|---|---|---|
| calm | 0.65 | 0.30 | 0.004 | 0.0012 | 0.06% |
| wild | 0.62 | 0.24 | 0.020 | 0.0048 | 0.24% |

The wild company has the *worse* forecast but **4× the edge**. Ranking by forecast alone picks the
calm one; that mistake was most of what the first version of this script got wrong (section 12).

**Edge must beat the round trip.** Buying and selling the same shares costs
`2 × spread + 2 × $100k commission`, plus the edge the trade itself removes. A position has to be held
long enough to earn that back, so the strategy trades rarely and holds for many ticks.

## 4. The strategy

One call per stock update (`runStockTradingTick`):

```
note which forecasts crossed 0.50 from a clear lean  -> ticks until the next cycle

1. exits: close any position whose edge has fallen to exitEdge (0: the expected move turned against it)

2. rotation: compare the best company not held with the weakest holding
     candidate edge = its edge after the impact of buying it at the holding's size
     horizon        = ticks until the cycle + 0.55/0.45 cycles   (each survives a cycle with p = 0.55)
     swap if (candidate edge − holding edge) / 2 × horizon > rotationCostFactor × candidate round trip

3. allocation: hand the investable cash out in `slices` equal slices; each slice goes to the company
   whose expected growth rises most from it, counting that
     - buying lowers the outlook of every share already held there (until the floor of 5),
     - a company at its share cap gains nothing,
     - only companies with edge >= entryEdge, at most maxOpenPositions held, maxWeight each,
     - a new position needs at least minNewWeight of net worth.

never trim: only exits and rotation sell
```

The allocation is the heart of it. Expected growth from holding weight `w` of a company is
`w × volatility × outlook / 100`, and buying `w` removes `impact × w` points of outlook, where
`impact` = 0.006 × net worth ÷ (price × shares per movement). So:

- **A small account concentrates.** Its trades barely move anything, so every slice goes to the
  strongest edge until that company's share cap, then to the next strongest.
- **A large account spreads out.** Each further slice in the same company costs edge on every share
  already held there, so at some point the second-best company pays more.
- **Share caps cost nothing extra.** The strongest edges belong to small, jumpy companies whose 20%
  is worth little; once one is full, the money flows to the next company instead of waiting as cash.

No slot count or weight cap has to be chosen for the account size: `maxOpenPositions` (8) is a limit,
and `maxWeight` defaults to 100%.

The game does not report `shareTxForMovement`, so the strategy uses the midpoint of each company's
range from the game's `InitStockMetadata` (`SHARES_PER_MOVEMENT` in `trader.ts`), which is within a
factor of two of the drawn value. Pricing the impact matters: with it switched off (`impactScale 0`)
the same rules return 1.34× v3 instead of 1.70×.

**The reserve** is the larger of `moneyKeep` (dollars, default 0, the in-game script's first
argument) and `reserveFraction` of net worth (0.1%, enough to pay commissions at any size).

**Without 4S data** the game throws from `getForecast`/`getVolatility`, so both are estimated from the
last `historyTicks` prices (section 11) and the same rules run on the estimates, with a higher entry
bar (`no4sEntryEdge`) and a much higher rotation hurdle (`no4sRotationCostFactor`): swapping on two
noisy numbers mostly trades noise.

## 5. Why it is built this way

These measurements, on 30 seeds × 3000 updates at $10b, decided the design. The previous best
strategy (v3, four equal-ish slots, section 12) earned log growth 4.11 per run against 4.48 expected
from what it held, while a cost-free trader limited only by share caps would expect 5.99. Three leaks:

1. **Idle money behind full share caps.** v3's deployment fell from 100% in the first tenth of a run
   to 72% in the last: slots full of every share they may own, while their target weight sat as cash.
2. **Our own trades.** Switching the forecast impact off in the model shows its size directly (40
   seeds, each side paired against v3 in the same market):

   | | with impact (the real game) | impact switched off |
   |---|---|---|
   | one position, cheap rotation (cost × 2) | 1.44× | 2.45× |
   | one position, strict rotation (cost × 8) | 1.71× | 2.26× |

   The cost grows with order size, which is why concentrating and fast rotation used to lose: both
   trade bigger blocks, and each block erodes the edge it was bought for.
3. **The cycle is visible.** Detecting it from forecasts that cross 0.50 caught 1199 of 1199 cycles
   with no false positives, which gives the rotation test a real horizon.

How the design got there, paired against v3 on seeds 1-40:

| step | vs v3 | trades | capital deployed |
|---|---|---|---|
| v3 | 1.00× | 552 | 91.5% |
| weights follow actual holdings and share caps | 1.12× | 446 | 95.2% |
| + spill money a capped slot cannot hold into the next candidates | 1.25× | 340 | 99.9% |
| + concentrate (3 slots, 50% cap, rotation on value) | 1.49× | 238 | 99.9% |
| + one slot at 100% with spill | 1.71× | 135 | 99.9% |
| impact-aware allocation (shipped) | 1.71× | 170 | 98.9% |

The last two score the same at $10b; the allocation is shipped because it lowers mean drawdown (4.2%
against 5.2%) and does not depend on a slot count chosen for one account size.

Ideas that did nothing: not entering in the last 2-5 updates before a cycle (±0.01×), a lower or
higher spill threshold, more spill positions, more open positions, finer slices, a higher exit bar.
The cycle tick itself is cheap (0.05 log per run), because the edge still averages 0.1× its usual
value on the flip update. Exiting before a cycle to dodge the 45% flip cannot pay either (by
arithmetic, not measured): it saves at most 0.45 of one update's edge and pays a round trip on the
55% that would have kept their edge.

## 6. Results

`pnpm run test:stock -- --seed-range 1-100` ($10b, 3000 updates = 5 hours):

| | mean return | median | trades | mean max drawdown | worst drawdown |
|---|---|---|---|---|---|
| with 4S | +11,300% | +9,890% | 180 | 4.70% | 27.80% |
| without 4S (seeds 201-300) | +834% | +483% | 336 | 23.50% | 58.64% |

Against the earlier versions on the same seeds (section 12 describes them), paired net worth:

| | v1 | v2 | v3 |
|---|---|---|---|
| seeds 1-100 | 10.76× (100/100) | 1.86× (95/100) | 1.73× (93/100) |
| seeds 201-400, never used to choose anything | — | — | 1.81× (194/200) |
| without 4S, seeds 201-300 | — | — | 1.33× (67/100) |

Robustness, seeds 201-240, paired against v3: $100m 1.53×, $1b 1.44×, $100b 1.53×, $1t 1.05×; 1000
updates 1.14×, 10 000 updates 1.29×. At $1t the market is the limit rather than the rules: only ~40%
of the money can be placed in companies that clear the entry edge.

**Concentration has a tail.** A small account holds one or two companies, so a cycle flip on that
company hits most of the portfolio: the worst of 100 seeds draws down 27.8% (v3: 10.2%). `maxWeight
0.6` trades some return for less of this (1.56× v3 instead of 1.71×, mean drawdown 3.6% on seeds
1-40). Without 4S the drawdowns are deeper still, because the estimated edge is often wrong about
which company deserves the concentration.

## 7. Capital and horizon

### Capital decides the early game

The commission is a **fixed $100 000 per transaction**, so its cost relative to the position falls
only as the account grows. Measured over 1000 updates (20 seeds, `--seed-stream 5`):

| starting capital | with 4S | without 4S |
|---|---|---|
| $1b | +433% | +68% |
| $100m | +418% | +67% |
| $30m | +419% | +69% |
| $10m | +388% | +23% |
| $3m | +305% | **−76%** (median −97%) |

With 4S the strategy trades rarely enough (15–25 trades in 1000 updates) that even $3m comes out
well ahead; the old four-slot strategy lost 41% there. Without 4S — which is what a fresh BitNode
has, since the 4S Market Data TIX API costs $25b — it needs roughly $10m before trading beats idling. The benchmark
prints a warning once commission passes 25% of the starting capital.

### How long you run it changes the answer

The market has a *fixed size* and your money does not. `getMaxShares` is 20% of a company and never
grows, so as the account compounds, more and more of it cannot be placed above the entry edge. The
aggregate report's `capital ... % of net worth in positions` shows it: below ~60%, extra time can no
longer compound and the score measures which companies happened to be capped during a price run.
**Use 3000 updates for judging changes**; at very long horizons a single seed can suggest the opposite
verdict, and only many seeds are trustworthy.

### What counts as a valid number of updates

| rule | why |
|---|---|
| whole number, **1 or more** | The CLI rejects anything else (`--ticks 0` is an error); the GUI clamps to 1. |
| **4 or more** for the no-4S estimate | The estimator needs at least 3 log returns before its first decision. Under that the run never trades. |
| **41 or more** for the no-4S estimate to be at full strength | `historyTicks` defaults to 40, so the window only fills at update 41. |
| **2 or more** to draw a chart | A single point has no line. |
| **~20,000 or less** for a meaningful comparison | Past that the share caps bind and the score turns into a draw from a wide distribution. |

## 8. Measuring a change honestly

### How many seeds is enough

One seed cannot separate two configs, because the spread between seeds is comparable to the mean.
`--compare` (CLI) and the GUI's cards therefore report a **paired** comparison: both configs run on
the *same* seeds, so each seed contributes one ratio instead of two independent noisy numbers.

```
paired  net worth ratio this config / shipped defaults, same seed: 93/100 seeds better | geometric mean 1.73x (95% 1.61x - 1.86x)
verdict this config is better on average (95% interval excludes 1x)
```

At 3000 updates, 20–25 seeds is enough to see a real difference; use 100 for something subtle.

### Where the seeds come from

Seeds are drawn from a **deterministic pseudo-random stream**: the *Seed* field picks the sequence,
*Seeds* is how many of it to use. The same stream and count always produce the same seeds, and asking
for 50 gives the first 50 of what 100 would give, so raising the count only adds markets. Contiguous
seeds share market structure; a pseudo-random draw does not. `--seed-stream <seed> --seeds <n>`
reproduces exactly what the page ran, and `--seed-range a-b` still runs an explicit range.

### How the chart averages several seeds

The chart plots **net worth on a logarithmic axis** (money compounds, so equal height is an equal
multiple). Each line is the **median seed** with a **p10–p90 band**: the median because compounding
has a long right tail that drags a mean upward, the band because its width is the result — two lines
whose bands overlap heavily are not meaningfully different. Every line, including buy-and-hold, runs
on every seed. `moneyKeep` comes from the form for every line, because it is the account's cash
policy rather than part of a config; a line that never traded is labelled `(no trades)`.

## 9. How to watch it happen

- `pnpm run stock:viz` → open `bench/stock/stockTraderViz.html`. One run draws the config **as
  shipped**, the stored **tuned** genome, the **edited config** (only when it differs from both), and
  the buy-and-hold references, each as the median seed with a p10–p90 band. The cards compare the
  edited config with the shipped one on the same seeds.
- **The legend is the switchboard.** It is a table — series, seeds, median return, p10, p90 — and
  clicking a row hides that line; clicking again brings it back. The axis rescales to what is drawn.
- `pnpm run test:stock -- --rotation 4 --compare --seed-range 1-100` prints a changed config's paired
  comparison against the shipped defaults in the terminal.
- In game, the trader's Positions tab shows an **Edge** column next to Forecast and Vol, so you can
  see what the script is acting on.

## 10. Tuning the config by search

The benchmark can search the config itself, using the same genetic algorithm the IPvGO bench uses for
its search widths (`ipvgo-engine/cpp/game/game_cli.cpp`, `runTune`), ported to
`bench/stock/stockTuner.ts`.

### What is a genome, and what is fitness

A **genome** is one candidate config: entry and exit edge, rotation hurdle, max positions, max weight,
max share fraction, impact scale, cash reserve, and whether shorts are allowed. Without 4S data three
more genes join (entry edge, rotation hurdle and history length for the estimates) — a gene that
cannot change the outcome would only be noise. `moneyKeep`, `minShares`, `minNewWeight` and `slices`
stay out: they are questions of scale or precision, not strategy.

**Fitness** is the mean of `log(final money / starting money)` over the training seeds — the
*geometric* mean growth. Ties break toward the lower drawdown. Not the plain mean return: one
explosive seed would decide a genome's fate.

### Three ideas that make it work

1. **Common random numbers.** Every genome in a generation is measured on *identical* seeds, so a
   difference between two genomes is a difference in their behaviour, not in which markets they drew.
2. **Fitness is a pure function of the genome.** A genome seen in an earlier generation is taken from
   a cache instead of being re-run.
3. **Held-back validation.** A search will happily find a genome that exploits the seeds it was given.
   The winner is re-measured against the shipped defaults on 3× as many seeds (at least 60) that the
   search never saw, with the per-seed paired difference. *That is the number that decides whether to
   keep it.*

### The loop

```
population = defaults + random genomes   (or: stored best + mutations around it, on a resume)
repeat for each generation:
    measure every genome the cache does not have   (population x seeds runs)
    rank by geometric mean growth
    keep the best two   (elitism)
    fill the rest: tournament-of-2 parents -> uniform crossover per gene
                   -> 40% chance of nudging each gene, clamped to its range
winner: re-measure against the defaults on held-back seeds, report the paired gain
```

Gene ranges are deliberately narrow. An entry edge above ~1.5%/tick never fires on the model, so such
a genome never trades and teaches the search nothing; and the search clamps `exitEdge < entryEdge`,
because an exit at or above the entry closes every position the tick after it opens.

### How to read the numbers

- **growth** is the geometric mean return over the training seeds, **±se** its standard error. A gap
  smaller than about two standard errors is not yet a gap.
- **vs default** is the paired difference against the shipped config on the same seeds. This is the
  honest "is it better" column.
- **maxDD** is the average worst drawdown, the tie-breaker.

Sixteen training seeds and nine genes is enough to fit noise, and the search will do exactly that if
you let it: a training gain that turns negative on the held-back seeds is the tool working.

### Running it

- GUI: **Genetic tuning** section. The result is stored and charted as **tuned**; *Apply best to
  form* loads it into the config. **Export** saves it as `stock-tune-yyyy-mm-dd-hh-mm.json` (the
  genome, the growth it scored, how far the search ran, and the config it was measured against);
  **Import file...** replaces the stored result. Imported genes are clamped to the search's own
  ranges and unknown genes dropped, so a hand-edited file cannot quietly change what is drawn. Files
  from the old v2/v3 tuner are refused: their genes no longer exist.
- CLI: `pnpm run test:stock -- --tune --seed-range 1-40 --population 8 --generations 6`. The seeds
  given are the training seeds (at least 4, else a block of 16 from `--seed`), `--tune-seed` seeds
  the search itself.
- More seeds beat more generations, and a genome is only meaningful for the market it was measured
  on: capital, update count, BitNode and 4S availability all move the answer.

### What the search remembers

The search caches one score per genome for the whole run, so **everything a cached score holds is
multiplied by every genome ever tried**. Holding each seed's equity curve cost 680 KB per genome at
3000 updates and 7.9 MB at 40 000, which killed the browser tab on long searches. A cached score now
keeps only the scalars (13–14 KB at any horizon); the curve is re-measured once for the winner
whenever it improves, and the GUI's workers never send training curves back at all.

## 11. When there is no 4S data

The 4S Market Data TIX API is what publishes the forecast. Without it the game does not merely hide
the number — `ns.stock.getForecast()` and `ns.stock.getVolatility()` **throw**. Everything else still
works: prices, ask/bid, positions, `getMaxShares`, purchase costs, buying and selling. So the strategy
estimates both from the prices it records itself:

```
every tick, for each company: remember the price (the last historyTicks + 1, default 41)

edge estimate       = 2 × (average log return per update over the window)
volatility estimate = 2 × (average absolute log return per update)
outlook estimate    = edge estimate ÷ volatility estimate × 50
```

Both follow from section 2: one update moves the price by `± v × volatility` with `v` uniform on
[0, 1], so the mean log return is half the edge and the mean absolute log return is half the
volatility.

The edge estimate is real but soft. Measured over 3 seeds × 4000 updates × 33 companies:

| window | corr(estimate, real edge) | corr(estimate, next move) | top 5% realised edge | bottom 5% |
|---|---|---|---|---|
| 10 | 0.41 | 0.059 | +0.196% | −0.163% |
| **40** | **0.55** | **0.078** | **+0.246%** | −0.240% |
| 80 | 0.47 | 0.068 | +0.238% | −0.233% |
| 160 | 0.35 | 0.053 | +0.177% | −0.176% |
| 320 | 0.24 | 0.037 | +0.140% | −0.101% |

It ranks companies in roughly the right order, but far less reliably than the real forecast, and it
degrades if the window is too long because the forecast moves on while the average still remembers
the old one. Hence the stricter `no4sEntryEdge` (0.3%) and a rotation hurdle of 64 round trips: on
100 held-out seeds those two settings beat no rotation at all by 1.15× and the old four-slot fallback
by 1.33×. The cycle cannot be seen without forecasts, so the
rotation horizon uses half a cycle instead.

The honest summary: blind mode works and is worth running from about $10m, but it is ~13× worse than
having the forecast, with drawdowns around 24% instead of 5%. Buying 4S is worth far more than any
tuning here. In game the script prints a warning at startup, the dashboard's Edge column is labelled
**Edge est**, and Forecast/Vol show `-`.

## 12. History

Four strategies were measured on the same model; only the last remains in the code.

| version | idea | $10b, 3000 updates, 100 seeds |
|---|---|---|
| v1 | buy forecast ≥ 0.60, up to ~8 names at equal weight, trim when over-weight | +881%, 26,307 trades |
| v2 | rank by edge, 4 equal slots, swap at 1.5× the weakest edge, never trim | +5,738%, 584 trades |
| v3 | v2 with weight ∝ edge and a reserve of 0.1% of net worth instead of $1b | +6,257%, 550 trades |
| current | impact-aware allocation, cycle-aware value rotation | +11,300%, 180 trades |

Lessons that carried forward:

- **Rank by edge, not forecast** (v1 → v2, 6.5×): forecast alone prefers calm companies with tiny
  moves.
- **Trade rarely and never trim** (v1 → v2): v1 paid $2.6b in commission per run; trimming a
  position back to target every tick was later measured at 0.81× on v2.
- **Reserves should be proportional** (v2 → v3): an absolute $1b reserve is 10% of a $10b account and
  made v2 completely inert at $1b.
- **Kelly sizing loses** (0.83× on v2): it divides by per-tick variance, but an edge persists for many
  ticks, so a volatile position is far less risky over its life than its per-tick variance suggests.
- **What looked like "concentration loses" was impact.** With four fixed slots, 2 positions at 50%
  measured 0.95× and faster rotation 0.95×; both trade bigger blocks, and the forecast impact of those
  blocks was not in the cost model. Once allocation priced it, and capped money spilled to the next
  company, concentrating became the largest single gain.

## 13. Caveats

- **The impact table is game data.** If `InitStockMetadata` changes upstream, update
  `SHARES_PER_MOVEMENT` in `trader.ts` along with the model.
- **Missed updates** only blur the cycle count until the next detected cycle resynchronises it.
- **The game offers a lever the model leaves out.** `hack()` and `grow()` with `{ stock: true }` move a
  company's hidden forecast target (`PlayerInfluencing.ts`), so a script that grows the servers of
  companies the trader is long on would push their forecasts the other way from our own trading. The
  benchmark does not model hacking, so this is untested.
