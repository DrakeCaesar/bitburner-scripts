# How the stock trader works, from zero

A ground-up explanation of `stockTrader.ts`: what the game's stock market actually does, where the
profit comes from, and how the two versions of the strategy (v1 and the current one) decide what to
trade. Written to be readable with no prior knowledge of the script or of trading.

Code references:

- [`../src/libraries/stock/trader.ts`](../src/libraries/stock/trader.ts) — the current strategy
- [`../src/libraries/stock/config.ts`](../src/libraries/stock/config.ts) — its tunables and defaults
- [`../bench/stock/traderV1.ts`](../bench/stock/traderV1.ts) — v1 frozen as the comparison baseline
- [`../bench/stock/stockMarketModel.ts`](../bench/stock/stockMarketModel.ts) — the local copy of the
  game's market used to measure both

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

Two more facts that matter:

- Every tick, the forecast itself drifts (it is "popular opinion" and it changes). It tends to wander
  between 0 and 1 and spends time near 0.5.
- **Trading moves the forecast against you.** Buying a lot of shares pushes the forecast toward 0.5.
  So a huge order makes its own edge worse.

## 3. Where the profit comes from: "edge"

If the forecast says 70% up and 30% down, and up moves and down moves are similar in size, then over
many ticks you win 70% of the time and lose 30%:

```
expected move per tick = (2 × forecast − 1) × (average move size)
                       = (2 × 0.70 − 1) × (volatility / 2)
```

Both strategies are built on the first half of that expression, which the code calls **edge**:

```
edge = (2 × forecast − 1) × volatility
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

The wild company has the *worse* forecast but **4× the edge**. Any strategy that ranks by forecast
alone will pick the calm one. That single observation is most of the difference between the two
versions.

Two measured properties of the model, both important:

1. **Edge persists** — its tick-to-tick correlation is 0.987. If a company has a big edge now, it very
   probably still has it next tick. So you hold positions for many ticks rather than flipping them.
2. **Edge must beat the round trip.** Buying and selling the same shares costs
   `2 × spread + 2 × $100k commission`. On $10m that is about $240k (2.4%) for a 0.2%-spread stock —
   roughly **6 ticks of a 0.4%-per-tick edge**. So the strategy must hold long enough to earn back the
   entry+exit cost, and must not churn.

## 4. Version 1 (the original, frozen in traderV1.ts)

It runs one function every tick. In plain terms: *sell anything the forecast has turned against, trim
anything too big, then buy every company whose forecast is high enough, spending at most 12% of the
cash per company.*

```
CONFIG: keep $1b cash, buy at forecast ≥ 0.60, sell at < 0.50
        short at ≤ 0.35, cover at > 0.50
        max 25% of a company's allowed shares
        each position ≤ 12% of net worth, trimmed 5% per tick if bigger
        each company gets ≤ 12% of this tick's cash, minimum order 50 shares

TICK:
  netWorth = cash + Σ(shares × price) + Σ(short value)

  ── step A: walk all 33 companies, deal with what we already hold ──
  for each company s:
      f = forecast(s)
      if we are LONG s:
          if f < 0.50:  sell everything           // the coin is no longer favourable
          else:         trim(s)                    // (see below)
      if we are SHORT s:
          if f > 0.50:  buy back everything        // the coin turned against the short
          else:         trim(s)

  trim(s):                                     // only if the position got too big
      if shares < 50: return
      if shares × price ≤ 12% of netWorth: return
      target = floor(12% of netWorth / price)
      sell   = min(shares − target,  max(50, 5% of shares))   // at most 5% per tick
      if sell ≥ 50: sell(s, sell)

  ── step B: build the shopping list ──
  cashForBuying = cash − $1b
  longs = []; shorts = []
  for each company s:
      if volatility(s) > 0.05: skip            // (never true: max volatility is 0.04)
      if forecast(s) ≥ 0.60: longs  += s
      if forecast(s) ≤ 0.35: shorts += s
  sort longs by forecast, best first
  sort shorts by forecast, worst first
  list = longs followed by shorts              // ALL longs are funded before any short

  ── step C: buy, in list order, until the money runs out ──
  for each candidate in list:
      if cashForBuying ≤ 0: stop
      allowance = min(cashForBuying, 12% of (cash − $1b))     // per-company slice
      room      = floor(maxShares(s) × 0.25) − shares we hold
      shares    = min(room, floor((allowance − $100k) / ask price))
      while shares ≥ 50 and true cost(shares) > allowance: shares -= 1
      if shares < 50: skip this company
      buy(s, shares);  cashForBuying -= what we actually spent
```

**Where the money leaks, in plain words:**

1. **It ranks by forecast but ignores jump size** — see the calm-vs-wild table. It systematically
   prefers stocks that barely move.
2. **It spreads money wide and keeps cutting winners.** Every position is forced to 12% of net worth,
   so the portfolio becomes ~8 equally-sized bets no matter how good each one is. A winner that grows
   past 12% is sold 5% at a time.
3. **It flips in and out.** Sell at forecast < 0.50, buy again at ≥ 0.60. A company drifting between
   those two numbers gets sold and rebought over and over, paying $200k in commission plus the spread
   every single time. Measured: **26,334 trades and $2.63b of commission per 5h run** — that is 25% of
   the starting capital handed back in fees.

## 5. Version 2 (current, trader.ts)

In plain terms: *score all 33 companies by edge, drop anything whose edge is gone, keep at most 4
positions, each about a quarter of net worth, and always make room for a company that is much better
than what you hold.*

```
CONFIG: keep $1b cash, open at |edge| ≥ 0.0025, close at edge ≤ 0
        at most 4 positions, each ~1/positions of net worth, never more than 34%
        may hold up to 100% of a company's allowed shares
        swap a holding only if a new company's edge is ≥ 1.5× better
        minimum order 50 shares

TICK:
  ── step A: score everything ──
  for each company s:
      edge[s] = (2 × forecast(s) − 1) × volatility(s)

  ── step B: drop positions whose expectation is gone ──
  held = empty set
  for each company s:
      if we are LONG s:
          if edge[s] ≤ 0: sell everything
          else:           held += s              // still positive: keep it
      if we are SHORT s:
          if edge[s] ≥ 0: buy back everything
          else:           held += s

  ── step C: what is worth owning now? (one ranked list, longs and shorts together) ──
  candidates = []
  for each company s:
      if edge[s] ≥ +0.0025:  candidates += {s, side: long,  strength: edge[s]}
      if edge[s] ≤ −0.0025:  candidates += {s, side: short, strength: |edge[s]|}
  sort candidates by strength, best first

  netWorth = cash + Σ(shares × price) + Σ(short value)
  weight   = min(0.34, 1 / min(4, count(candidates)))
              // 4 candidates → 25% each, 3 → 33%, 1 → 34% and 66% stays in cash
  cashForBuying = cash − $1b

  ── step D: fill empty slots, best edge first ──
  for each candidate c in candidates:
      if count(held) ≥ 4 or cashForBuying ≤ 0: stop
      if c is already held: skip
      if grow(c):  held += c                 // grow() is defined below

  ── step E: rotation — is something much better sitting idle? ──
  for each candidate c in candidates:
      if count(held) < 4: stop              // there was room, nothing to swap
      if c is already held: skip
      weakest = the held company with the smallest |edge|
      if strength(c) ≤ 1.5 × |edge[weakest]|: skip     // not better enough
      sell the whole weakest position
      held -= weakest
      cashForBuying = cash − $1b            // money is free again
      if grow(c): held += c

  ── step F: top up the keepers with whatever cash is left ──
  for each candidate c in candidates:
      if cashForBuying ≤ 0: stop
      if c is held: grow(c)

  grow(c):
      target = floor(netWorth × weight / price(c))
      room   = floor(maxShares(c) × 1.0) − (shares held long + shares held short)
      want   = min(target − shares we already hold on c's side, room)
      shares = largest number ≤ want whose cost still fits in cashForBuying
      if shares < 50: return false
      buy;  cashForBuying -= spent;  return true
```

## 6. The same tick, both versions

One tick, $10,000,000 cash, $1,000,000 kept aside, three companies on offer:

| | price | volatility | forecast | edge = (2f−1)×vol | expected profit/tick |
|---|---|---|---|---|---|
| calm | $100 | 0.004 | 0.65 | 0.0012 | 0.06% |
| wild | $500 | 0.020 | 0.62 | **0.0048** | **0.24%** |
| dull | $50 | 0.010 | 0.45 | −0.0010 | −0.05% |

**Version 1** — forecast is what matters, so `calm` (0.65) is the top pick and `wild` (0.62) comes
second. Its per-company slice is 12% of $9m = $1.08m:

- buys 9,800 `calm` = $1.08m
- buys 1,960 `wild` = $1.08m
- `dull` fails both thresholds, ignored
- **Result: $2.16m invested, $6.84m left idle.** It bought the *worse* company first, gave it the same
  money, and had no way to spend the rest.

**Version 2** — `calm`'s edge (0.0012) is below the 0.0025 threshold, so it is not a candidate at all.
`wild` (0.0048) is the only candidate:

- weight = min(0.34, 1/1) = 0.34 → target = 34% of $10m / $500 = 6,800 shares
- buys 6,800 `wild` = $3.4m
- `dull`: −0.0010 does not reach −0.0025, ignored
- **Result: $3.4m in the one company with a real edge, $6.6m left idle.**

Leaving money idle is intentional: if no company's edge is large enough to pay for the round trip,
holding cash is the better trade. Version 1 could never do that — its only cash rule was "buy whatever
clears 0.60".

Then, on the following ticks, the two diverge further:

- If `wild`'s edge falls to 0.001, version 2 keeps it (still positive) but stops adding. When the
  forecast eventually crosses 0.50 and the edge turns negative, it sells the whole thing at once —
  **2 transactions for the whole stay in the position**.
- Version 1 would sell at forecast < 0.50 and buy again the moment it crossed 0.60, so a wobbling
  company costs it 2 transactions per wobble. That is the entire explanation for 26,334 trades vs 597.

## 7. Why the numbers moved so much

| | v1 | current |
|---|---|---|
| which companies | forecast ≥ 0.60, i.e. calm ones first | largest edge first, i.e. jump size counted |
| how many | up to ~8, forced equal weight, trimmed when big | 4, equal weight, never trimmed |
| when to sell | forecast < 0.50 | expected move ≤ 0 |
| switching | none | only when a new company is 1.5× better |
| trades per 5h run | 26,307 | 584 |
| commission paid | $2.63b | $58m |
| $10b start, 100 seeds | +881% | **+5738%** |
| same-seed ratio (paired) | — | **5.79×** (95% 5.44×–6.17×) |
| worst drawdown | −1.4% | −3.2% (worst seed −9.1%) |

Fewer, bigger, longer positions in the jumpiest favourable names; ~45× fewer fees; ~6.5× the return,
for roughly twice the drawdown.

## 8. How long you run it changes the answer

The comparison in section 7 is measured over **3000 updates** (5 hours). Keep running and it stops
meaning the same thing, because the market has a *fixed size* and your money does not.

Two hard limits:

- **`getMaxShares`** — you may never own more than 20% of a company's shares, and that share count
  never grows.
- **`maxWeightPerSymbol`** — the strategy aims for at most 34% of net worth in one name.

Starting with $10b, a 34% target is a few billion dollars, far below those caps, so the rules decide
everything. Start compounding and the target grows past the caps instead: every position becomes
"all the shares there are", the strategy turns away new ideas because its 4 slots are full of shares
it cannot sell without giving up a good name, and the cash pile grows faster than anything can be
bought with it.

`capital ... % of net worth in positions` (the new line in the aggregate report) is how you see it:

| updates | game time | v1 capital deployed | current capital deployed | current vs v1 |
|---|---|---|---|---|
| 3000 | 5h | 95% | 91% | **5.79×** (100 seeds, 100/100 better) |
| 10000 | 17h | — | — | 6.0× (one seed) |
| 20000 | 33h | — | — | 2.3× (one seed) |
| 30000 | 50h | 32% | 22% | **3.14×** (100 seeds, 84/100 better) |

The last row is why you have to average over many seeds. At 30,000 updates roughly three quarters of
both portfolios is idle cash, so which names happened to be at their cap during a price run is most of
the outcome. One seed therefore proves nothing:

- seed 1337 — v1 wins, $105.9t vs $51.9t
- seed 11310 — current wins, $101.1t vs $29.7t
- seed 21283 — current wins, $268.8t vs $59.5t
- **100 seeds** — current wins on 84 of them; geometric mean ratio 3.14×, 95% interval
  2.45×–4.03×. The spread is so wide that the standard deviation of the mean return (±6,649,063%)
  is *larger than the mean itself* (+4,321,255%). Even the losing seeds lose big: seed 1337 alone
  suggests v1 is twice as good, which is not true on average.

One knob moves that number further than the gap between the strategies (30k updates, 3 seeds):

| change | mean net worth |
|---|---|
| `entryEdge` 0.0025 → 0.006 (fewer, pickier entries) | $186t |
| `maxPositions` 4 → 1 | $320t |
| `maxShareFraction` 1.0 → 0.25 | $287t |
| nothing (defaults) | $141t |

Smaller positions are *easier to roll over*: a capped-out $50t holding cannot be rotated into the
next winner, but a $12t one can. None of this is reachable in the game — a BitNode run ends long
before $10b turns into $100t — so 30,000 updates is a stress test of the model, not a target.

**Use 3000 updates for judging strategy changes.** Watch `capital` stay above ~60%: below that, extra
time can no longer compound and you are measuring luck.

### What counts as a valid number of updates

One update is one 6-second stock tick *and* one strategy decision, so the number is "how many
decisions, and how much time". Requirements, from strict to advisory:

| rule | why |
|---|---|
| whole number, **1 or more** | The CLI rejects anything else (`--ticks 0` is an error); the GUI clamps to 1. Fractional values are truncated. |
| **4 or more** for the no-4S estimate | The estimator needs at least 3 log returns, i.e. 4 recorded prices before it can make its first decision. Under that the run never trades and ends flat. |
| **41 or more** for the no-4S estimate to be at full strength | `historyTicks` defaults to 40, so the window only fills at update 41. Shorter runs trade on a partial window and behave more erratically. |
| **2 or more** to draw a chart | A single point has no line. |
| multiples of 75 if you care about cycle boundaries | The game's forecast drift runs in 75-update cycles; the model wraps them, so nothing breaks, but a run that stops mid-cycle ends on an arbitrary forecast state. |
| **~20,000 or less** for a meaningful comparison | Past that the market's share caps bind and the score turns into a draw from a wide distribution (section 8's table). |

In 4S mode there is no warm-up at all: one update already buys four names, which is why `--ticks 1`
shows a real (fee-dominated) loss rather than nothing.

### How many seeds is enough

One seed cannot separate two strategies whose results differ by 5× on average, because the spread
between seeds is comparable to the mean. The benchmark therefore reports a **paired** comparison: both
strategies are run on the *same* seeds, so each seed contributes one ratio (current net worth ÷ v1 net
worth) instead of two independent noisy numbers.

```
paired  net worth ratio current/v1, same seed: 100/100 seeds better | geometric mean 5.79x (95% 5.44x - 6.17x) | median 5.83x
verdict current is better on average (95% interval excludes 1x)
```

Read it as: on a typical seed the current strategy ends with ~5.8× more money, and the interval says
that even in the worst case for the measurement it is above 5.4×. The interval is 95% by the usual
normal approximation on the log ratios, so it is a guide to how much is noise, not a guarantee.

At the default 3000 updates, 20–25 seeds is already plenty (the interval is narrow). Use 100 seeds
when you want to check something subtle, or when comparing at a long horizon where a single seed can
lie. The GUI always runs seeds `1..n`, so its *Seeds* box is exactly the range, and it matches
`--seed-range 1-n` on the command line.

### How the chart averages several seeds

The graph plots **net worth on a logarithmic axis**: money compounds, so equal vertical distance is an
equal multiple ($10b → $100b is the same height as $100b → $1t). On the old linear "% return" axis a
5,000% and a 10,000% run were plotted wildly far apart, which made the band unreadable.

Per strategy it draws two things:

- **the median seed** (solid line) — the middle of the pack, i.e. what a typical run looks like. The
  *mean* is not used for the line because compounding has a long right tail: at 30,000 updates the
  mean return (+4,321,255%) is almost 3× the median (+1,472,872%), so a mean line would be dragged up
  by a handful of explosive runs and would not describe anything you would actually experience.
- **a p10–p90 band** (shaded) — the middle 80% of seeds. Its width *is* the result: a band that fans
  out over time means the outcome is mostly luck, and two strategies whose bands overlap heavily are
  not meaningfully different. A single run (the buy-and-hold baselines) has no band.

Both are the `aggregateCurves()` helpers in `bench/stock/stockBenchCore.ts`, so the CLI and the page
compute them identically. The exact end-of-run numbers stay in the cards above the chart (mean,
median, worst seed, std dev) for those who want the tail as well as the middle.

## 9. How to watch it happen

- `pnpm run stock:viz` → open `bench/stock/stockTraderViz.html`. **Strategy → edge (current)** with
  **compare with v1** ticked draws both strategies on one chart as the median seed plus a p10–p90 band
  (log axis), and fills in the same paired ratio and win count as the CLI. *Seeds* is the range `1..n`;
  the default 25 finishes in under a second, 100 in about two.
- `pnpm run test:stock -- --compare --seed-range 1-100` prints the paired comparison in the terminal.
- `pnpm run test:stock -- --compare --seeds 25` does the same with 25 seeds spaced 9,973 apart.
- `pnpm run test:stock -- --strategy v1` runs the frozen baseline on its own.
- In game, the trader's Positions tab now shows an **Edge** column next to Forecast and Vol, so you can
  see the exact ranking the script is acting on.

## 10. When there is no 4S data

The 4S Market Data TIX API (25b) is what publishes the forecast. Without it the game does not merely
hide the number — `ns.stock.getForecast()` and `ns.stock.getVolatility()` **throw**
(`NetscriptFunctions/StockMarket.ts`). Everything else still works with only the TIX API: prices,
ask/bid, positions, `getMaxShares`, purchase costs, buying and selling.

So the strategy switches to estimating the edge from the price history it collects itself:

```
every tick, for each company:
    remember the price (keep the last `historyTicks` prices, default 40 = 4 minutes)

    edge estimate = 2 × (average log return per update over that window)
```

That is not a heuristic picked out of the air: over one update the price moves by `± v × volatility`
and the up/down coin is biased by the forecast, so the **average log return per update is exactly
half the edge**. Doubling it estimates the same quantity the 4S forecast gives, in the same units —
which is why the same threshold means the same thing in both modes.

### How good is the estimate?

Measured over 3 seeds × 4000 updates × 33 companies:

| window | corr(estimate, real edge) | corr(estimate, next move) | top 5% realised edge | bottom 5% |
|---|---|---|---|---|
| 10 | 0.41 | 0.059 | +0.196% | −0.163% |
| **40** | **0.55** | **0.078** | **+0.246%** | −0.240% |
| 80 | 0.47 | 0.068 | +0.238% | −0.233% |
| 160 | 0.35 | 0.053 | +0.177% | −0.176% |
| 320 | 0.24 | 0.037 | +0.140% | −0.101% |

So the signal is real but soft: it ranks companies in roughly the right order (top picks really do go
up, bottom picks really do go down) yet it is far weaker than the real forecast, and it degrades if the
window is too long because the forecast regime moves on while the average is still remembering the old
one.

### What that changes in the strategy

Two of the four decision rules become unreliable, so both are tightened automatically while running
blind (the values are in the config, `no4sEntryEdge` and `no4sRotateMargin`):

- **Entry threshold** 0.0025 → **0.004**. A noisier estimate needs a higher bar to clear the same
  round-trip cost.
- **Rotation** 1.5× → **100×**, i.e. effectively off. Comparing two noisy numbers and swapping on the
  result mostly trades noise, and every swap pays two spreads.
- Exits and position sizing are unchanged: hold while the estimate stays positive, 4 positions at a
  quarter of net worth each.
- Until a company has at least 3 price samples the estimate is `null`: no entry, and existing positions
  are left alone.

Effect of those two changes alone (15 seeds, 3000 updates, $10b):

| | trades | mean return | mean max DD |
|---|---|---|---|
| blind, 4S defaults | 1,663 | +49.6% | −31.6% |
| blind, tuned | **622** | **+554.7%** | **−12.5%** |
| with 4S | 583 | +6,689.3% | −3.7% |
| hold everything (no cost, no decisions) | 33 | +99.6% | −11.8% |

Blind mode beats owning the whole market by ~5.5×, but it is ~12× worse than having the forecast. The
honest summary: it works, it is worth running if you have no 4S, and buying 4S is worth far more than
any tuning here.

In game it says so: with no 4S the script prints a warning at startup, the dashboard's Edge column is
labelled **Edge est** and Forecast/Vol show `-` instead of numbers.

