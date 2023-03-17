import { tFormat } from "./format"

export function batchingTime(params) {
   const hack_time = params.hack_time
   const hack_time_max = params.hack_time_max
   const hack_time_min = params.hack_time_min
   const grow_time = 3.2 * hack_time
   const weak_time = 4 * hack_time
   const max_depth = params.max_depth
   const t0 = params.t0

   let period, depth
   const kW_max = max_depth
      ? Math.min(Math.floor(1 + (weak_time - 4 * t0) / (8 * t0)), max_depth)
      : Math.floor(1 + (weak_time - 4 * t0) / (8 * t0))
   schedule: for (let kW = kW_max; kW >= 1; --kW) {
      const t_min_W = (weak_time + 4 * t0) / kW
      const t_max_W = (weak_time - 4 * t0) / (kW - 1)
      const kG_min = Math.ceil(Math.max((kW - 1) * 0.8, 1))
      const kG_max = Math.floor(1 + kW * 0.8)
      for (let kG = kG_max; kG >= kG_min; --kG) {
         const t_min_G = (grow_time + 3 * t0) / kG
         const t_max_G = (grow_time - 3 * t0) / (kG - 1)
         const kH_min = Math.ceil(
            Math.max((kW - 1) * 0.25, (kG - 1) * 0.3125, 1)
         )
         const kH_max = Math.floor(Math.min(1 + kW * 0.25, 1 + kG * 0.3125))
         for (let kH = kH_max; kH >= kH_min; --kH) {
            const t_min_H = hack_time_max
               ? (hack_time_max + 5 * t0) / kH
               : (hack_time + 5 * t0) / kH
            const t_max_H = hack_time_min
               ? (hack_time_min - 1 * t0) / (kH - 1)
               : (hack_time - 1 * t0) / (kH - 1)
            const t_min = Math.max(t_min_H, t_min_G, t_min_W)
            const t_max = Math.min(t_max_H, t_max_G, t_max_W)
            if (t_min <= t_max) {
               period = t_min
               depth = kW
               break schedule
            }
         }
      }
   }

   const hack_delay = depth * period - 4 * t0 - hack_time
   const weak_delay_1 = depth * period - 3 * t0 - weak_time
   const grow_delay = depth * period - 2 * t0 - grow_time
   const weak_delay_2 = depth * period - 1 * t0 - weak_time

   console.log("th: " + tFormat(hack_time))
   console.log("tg: " + tFormat(grow_time))
   console.log("tw: " + tFormat(weak_time))
   console.log("t0: " + tFormat(t0))
   console.log("")

   console.log("T:  " + tFormat(period))
   console.log("k:  " + String(depth).padStart(6))
   console.log("dh: " + tFormat(hack_delay))
   console.log("dw1:" + tFormat(weak_delay_1))
   console.log("dg: " + tFormat(grow_delay))
   console.log("dw2:" + tFormat(weak_delay_2))
   console.log("")

   return {
      period,
      depth,
   }
}

/** 
* @author modar <gist.github.com/xmodar> 
* {@link https://www.reddit.com/r/Bitburner/comments/tgtkr1/here_you_go_i_fixed_growthanalyze_and_growpercent/} *
* @typedef {Partial<{ * moneyAvailable: number; * hackDifficulty: number; * ServerGrowthRate: number 
// ns.getBitNodeMultipliers().ServerGrowthRate * ; 
// https://github.com/danielyxie/bitburner/blob/dev/src/BitNode/BitNode.tsx * }>} GrowOptions 
*/

export function calculateGrowGain(ns, host, threads = 1, cores = 1, opts = {}) {
   threads = Math.max(Math.floor(threads), 0)
   const moneyMax = ns.getServerMaxMoney(host)
   const { moneyAvailable = ns.getServerMoneyAvailable(host) } = opts
   const rate = growPercent(ns, host, threads, cores, opts)
   return Math.min(moneyMax, rate * (moneyAvailable + threads)) - moneyAvailable
}

/** @param {number} gain money to be added to the server after grow */ export function calculateGrowThreads(
   ns,
   host,
   gain,
   cores = 1,
   opts = {}
) {
   const moneyMax = ns.getServerMaxMoney(host)
   const { moneyAvailable = ns.getServerMoneyAvailable(host) } = opts
   const money = Math.min(Math.max(moneyAvailable + gain, 0), moneyMax)
   const rate = Math.log(growPercent(ns, host, 1, cores, opts))
   const logX = Math.log(money * rate) + moneyAvailable * rate
   return Math.max(lambertWLog(logX) / rate - moneyAvailable, 0)
}

function growPercent(ns, host, threads = 1, cores = 1, opts = {}) {
   const {
      ServerGrowthRate = 1,
      hackDifficulty = ns.getServerSecurityLevel(host),
   } = opts
   const growth = ns.getServerGrowth(host) / 100
   const multiplier = ns.getPlayer().hacking_grow_mult
   const base = Math.min(1 + 0.03 / hackDifficulty, 1.0035)
   const power = growth * ServerGrowthRate * multiplier * ((cores + 15) / 16)
   return base ** (power * threads)
}

/**
 * Lambert W-function for log(x) when k = 0
 * {@link https://gist.github.com/xmodar/baa392fc2bec447d10c2c20bbdcaf687}
 */

function lambertWLog(logX) {
   if (isNaN(logX)) return NaN
   const logXE = logX + 1
   const logY = 0.5 * log1Exp(logXE)
   const logZ = Math.log(log1Exp(logY))
   const logN = log1Exp(0.13938040121300527 + logY)
   const logD = log1Exp(-0.7875514895451805 + logZ)
   let w = -1 + 2.036 * (logN - logD)
   w *= (logXE - Math.log(w)) / (1 + w)
   w *= (logXE - Math.log(w)) / (1 + w)
   w *= (logXE - Math.log(w)) / (1 + w)
   return isNaN(w) ? (logXE < 0 ? 0 : Infinity) : w
}
const log1Exp = (x) => (x <= 0 ? Math.log(1 + Math.exp(x)) : x + log1Exp(-x))
