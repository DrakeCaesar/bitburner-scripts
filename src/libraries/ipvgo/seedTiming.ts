import type { NS } from "@ns"

/**
 * White's reply is decided by the game clock, and we choose when to move.
 *
 * The faction AI (goAI.ts `getMove`) seeds its Wichmann-Hill RNG with `Player.totalPlaytime`,
 * read after one `waitCycle()` once our move lands: a 40 ms sleep while the Go bonus cycles
 * last, 200 ms after they run out. The play clock only moves in 200 ms game ticks, so the seed
 * is fixed by the tick we submit in - and the engine can compute White's exact reply for every
 * tick. We send it the seeds of the coming ticks, it answers with a plan (best tick and move
 * first), and we wait for that tick before moving.
 *
 * Submitting `SUBMIT_DELAY_MS` into a tick puts the seed read 100 ms clear of the next tick on
 * both sleeps: with bonus cycles it lands at +100 ms (same tick), without at +260 ms (the next).
 */
export const SEED_TICK_MS = 200
const SUBMIT_DELAY_MS = 60
const POLL_MS = 4

export type SeedClock = {
  /** Player.totalPlaytime when the clock was read. */
  playtime: number
  /** Go bonus cycles are left, so the AI's first sleep is the 40 ms one. */
  bonus: boolean
}

export function readSeedClock(ns: NS): SeedClock {
  return { playtime: ns.getPlayer().totalPlaytime, bonus: ns.go.getGameState().bonusCycles > 0 }
}

/** The seed White reads when our move lands in the tick whose clock shows `tickPlaytime`. */
export function seedForTick(tickPlaytime: number, bonus: boolean): number {
  return tickPlaytime + (bonus ? 0 : SEED_TICK_MS)
}

/** The tick to land in for White to read `seed`. */
export function tickForSeed(seed: number, bonus: boolean): number {
  return seed - (bonus ? 0 : SEED_TICK_MS)
}

/** Seeds of the next `count` ticks after the one the clock is in. */
export function upcomingSeeds(clock: SeedClock, count: number): number[] {
  const seeds: number[] = []
  for (let tick = 1; tick <= count; tick++) {
    seeds.push(seedForTick(clock.playtime + tick * SEED_TICK_MS, clock.bonus))
  }
  return seeds
}

/**
 * Waits until the tick showing `tickPlaytime` has started, then `SUBMIT_DELAY_MS` into it.
 * Returns false - and the caller moves on to its next choice - when that tick had already
 * started before we got here, or ended while we waited, because then the seed is not the one
 * the plan was made for.
 */
export async function waitForTick(ns: NS, tickPlaytime: number): Promise<boolean> {
  let now = ns.getPlayer().totalPlaytime
  if (now >= tickPlaytime) return false
  while (now < tickPlaytime) {
    await ns.sleep(POLL_MS)
    now = ns.getPlayer().totalPlaytime
  }
  if (now !== tickPlaytime) return false
  await ns.sleep(SUBMIT_DELAY_MS)
  return ns.getPlayer().totalPlaytime === tickPlaytime
}
