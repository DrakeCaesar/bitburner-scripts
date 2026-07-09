/* Auto-generated — edit tests/kingOfTheHillCore.ts; run pnpm run test:koth:bundle */
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/dnet/solvers/kingOfTheHill/tuning.ts
var TUNED_LADDER_SNIPE_DIFF60 = {
  farTailAnchorMaxAbs: 397.16,
  ladderEntryMaxAbs: 7418.48,
  positiveLadderSkipRangeFraction: 0.737109,
  pairProbeOffsetW: 0.154316,
  signCrossMarchW: 1.0245,
  centerSanityMaxDistW: 38.425,
  ladderMaxIters: 8,
  orbitDistW: 0.5,
  heightBandSlack: 272.627,
  logResidualMax: 0.271547,
  logResidualMaxDistW: 1,
  halfStepW: 1.93344,
  outsideClusterDistW: 1,
  bareTailFrac: 0.021817,
  postJumpCapScale: 0.224271,
  postJumpCapBias: 0.911711,
  sqrtSnipeMinAlt: 7555.23,
  sqrtSnipeNearZoneExtra: 250204e-8,
  gallopStepW: 1.93321,
  gallopStopW: 0.185353,
  pinpointRounds: 5,
  pinpointFinalRadius: 8,
  pinpointFinalRadiusWide: 20,
  clusterReachW: 31.1991,
  clusterStepW: 1.79502
};

// src/dnet/solvers/kingOfTheHill/ladderSnipeSolver.ts
var KOTH_NEAR_ZONE_FRACTION = 0.03;
var H_PEAK = 1e4;
var STEP_W = 3;
var MAIN_TH = H_PEAK - 0.5 * 2600;
var HEIGHT_OFFSET = 2600;
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}
function invertCenter(x1, a1, x2, a2, w) {
  return (x1 + x2) / 2 - w * w * Math.log(a1 / a2) / (2 * (x2 - x1));
}
function hopK(H) {
  return Math.max(1, Math.round((H_PEAK - H) / HEIGHT_OFFSET));
}
function spreadOrder(m) {
  if (m <= 1) return [0];
  const order = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (i) => {
    if (i >= 0 && i < m && !seen.has(i)) {
      seen.add(i);
      order.push(i);
    }
  };
  add(Math.floor(m / 2));
  add(0);
  add(m - 1);
  let stack = [[0, m - 1]];
  while (order.length < m && stack.length > 0) {
    const nxt = [];
    for (const [a, b] of stack) {
      const mid = Math.floor((a + b) / 2);
      add(mid);
      if (mid - a > 1) nxt.push([a, mid]);
      if (b - mid > 1) nxt.push([mid, b]);
    }
    stack = nxt;
  }
  for (let i = 0; i < m; i++) add(i);
  return order;
}
function scanGrid(lo, hi, w, hc) {
  const span = hi - lo;
  if (span <= 0) return [lo];
  const spacing = hc > 1 ? Math.max(1, Math.floor((hc - 1) * 3 * w * 0.9 * 0.98)) : Math.max(1, 3 * w);
  const m = Math.max(1, Math.ceil(span / spacing));
  const xs = /* @__PURE__ */ new Set();
  for (let i = 0; i <= m; i++) xs.add(lo + Math.round(span * i / m));
  return [...xs].sort((a, b) => a - b);
}
function sqrtSnipe(sess, x, a, w, lo, hi, tune) {
  if (!(a > tune.sqrtSnipeMinAlt) || !(a < H_PEAK)) return false;
  const d = w * Math.sqrt(Math.log(H_PEAK / a));
  if (!Number.isFinite(d)) return false;
  const nearCap = (KOTH_NEAR_ZONE_FRACTION + tune.sqrtSnipeNearZoneExtra) * x;
  if (d > nearCap) return false;
  const dd = Math.max(1, Math.round(d));
  sess.probe(clamp(x + dd, lo, hi));
  if (sess.solved) return true;
  sess.probe(clamp(x - dd, lo, hi));
  return sess.solved;
}
function crest(sess, xSeed, w, lo, hi) {
  let x = clamp(xSeed, lo, hi);
  let a = sess.samples.get(x) ?? null;
  if (a === null) {
    a = sess.probe(x);
    if (sess.solved) return [x, a ?? Infinity];
  }
  const off = Math.max(1, Math.round(0.5 * w));
  let xb = x + off <= hi ? x + off : x - off;
  let ab = sess.probe(xb);
  if (sess.solved) return [xb, ab ?? Infinity];
  if (a !== null && ab !== null && a > 0 && ab > 0 && xb !== x) {
    try {
      const c = invertCenter(x, a, xb, ab, w);
      const cx = clamp(c, lo, hi);
      let ac2 = sess.samples.get(cx) ?? null;
      if (ac2 === null) {
        ac2 = sess.probe(cx);
        if (sess.solved) return [cx, ac2 ?? Infinity];
      }
      const cand2 = [
        [a, x],
        [ab, xb],
        [ac2 ?? -1e18, cx]
      ];
      let best2 = cand2[0];
      for (const pair of cand2.slice(1)) {
        if (pair[0] > best2[0]) best2 = pair;
      }
      if (best2[1] !== x && best2[0] > a * 1.02) {
        const bx = best2[1];
        let xb2 = bx + Math.max(1, Math.floor(off / 2));
        if (xb2 > hi) xb2 = bx - Math.max(1, Math.floor(off / 2));
        const ab2 = sess.probe(xb2);
        if (sess.solved) return [xb2, ab2 ?? Infinity];
        if (ab2 !== null && ab2 > 0 && xb2 !== bx && best2[0] > 0) {
          try {
            const c2 = invertCenter(bx, best2[0], xb2, ab2, w);
            const cx2 = clamp(c2, lo, hi);
            let ac22 = sess.samples.get(cx2) ?? null;
            if (ac22 === null) {
              ac22 = sess.probe(cx2);
              if (sess.solved) return [cx2, ac22 ?? Infinity];
            }
            const cand22 = [best2, [ab2, xb2], [ac22 ?? -1e18, cx2]];
            let best22 = cand22[0];
            for (const pair of cand22.slice(1)) {
              if (pair[0] > best22[0]) best22 = pair;
            }
            return [best22[1], best22[0]];
          } catch {
          }
        }
      }
      return [best2[1], best2[0]];
    } catch {
    }
  }
  const xc = clamp(x - off >= lo ? x - off : x + 2 * off, lo, hi);
  const ac = sess.probe(xc);
  if (sess.solved) return [xc, ac ?? Infinity];
  const cand = [
    [a ?? -1e18, x],
    [ab ?? -1e18, xb],
    [ac ?? -1e18, xc]
  ];
  let best = cand[0];
  for (const pair of cand.slice(1)) {
    if (pair[0] > best[0]) best = pair;
  }
  return [best[1], best[0]];
}
function gallop(sess, xSeed, w, lo, hi, tune) {
  let x = clamp(xSeed, lo, hi);
  let a = sess.samples.get(x) ?? -1e18;
  if (!sess.samples.has(x)) {
    const probed = sess.probe(x);
    if (sess.solved) return [x, probed ?? Infinity];
    if (probed !== null) a = probed;
  }
  let step = Math.max(1, Math.round(tune.gallopStepW * w));
  let stop = Math.max(1, Math.round(tune.gallopStopW * w));
  while (step >= stop) {
    let bd = 0;
    let ba = a;
    let bx = x;
    for (const d of [1, -1]) {
      const xn = clamp(x + d * step, lo, hi);
      if (xn === x) continue;
      const an = sess.probe(xn);
      if (sess.solved) return [xn, an ?? Infinity];
      if (an !== null && an > ba) {
        ba = an;
        bx = xn;
        bd = d;
      }
    }
    if (bd !== 0) {
      x = bx;
      a = ba;
    } else {
      step = Math.floor(step / 2);
    }
  }
  return [x, a];
}
function pinpoint(sess, seedX, w, lo, hi, tune, rounds, finalRadius, snipe) {
  let pc = clamp(seedX, lo, hi);
  if (snipe) {
    let aSeed = sess.samples.get(pc) ?? null;
    if (aSeed === null) {
      aSeed = sess.probe(pc);
      if (sess.solved) return;
    }
    if (aSeed !== null && sqrtSnipe(sess, pc, aSeed, w, lo, hi, tune)) return;
  }
  let off = Math.max(1, Math.round(tune.pairProbeOffsetW * w));
  for (let r = 0; r < rounds; r++) {
    let a0 = sess.samples.get(pc) ?? null;
    if (a0 === null) {
      a0 = sess.probe(pc);
      if (sess.solved) return;
    }
    if (a0 === null || a0 <= 0) break;
    const x1 = pc + off <= hi ? pc + off : pc - off;
    const a1 = sess.probe(x1);
    if (sess.solved) return;
    if (a1 === null || a1 <= 0 || x1 === pc) break;
    try {
      const c = invertCenter(pc, a0, x1, a1, w);
      const nc = clamp(c, lo, hi);
      if (nc === pc) {
        if (off === 1) break;
        off = Math.max(1, Math.floor(off / 4));
        continue;
      }
      pc = nc;
      off = Math.max(1, Math.min(off, Math.round(0.25 * w)));
    } catch {
      break;
    }
  }
  sess.probe(pc);
  if (sess.solved) return;
  for (let d = 1; d <= finalRadius; d++) {
    for (const sgn of [-1, 1]) {
      sess.probe(pc + sgn * d);
      if (sess.solved) return;
    }
  }
}
function clusterSweep(sess, w, lo, hi, tune) {
  const center = sess.bestVal;
  const reach = Math.round(tune.clusterReachW * w);
  const step = Math.max(1, Math.round(tune.clusterStepW * w));
  let x = Math.max(lo, center - reach);
  const b = Math.min(hi, center + reach);
  while (x <= b && !sess.solved) {
    sess.probe(x);
    x += step;
  }
}
function backstop(sess, w, lo, hi, tune) {
  const step = Math.max(1, Math.round(0.7 * w));
  let x = lo;
  while (x <= hi && !sess.solved) {
    sess.probe(x);
    x += step;
  }
  if (!sess.solved) pinpoint(sess, sess.bestVal, w, lo, hi, tune, tune.pinpointRounds, 30, false);
}
function walkAndPinpoint(sess, w, lo, hi, tune, snipe) {
  const step = STEP_W * w;
  let [x, a] = crest(sess, sess.bestVal, w, lo, hi);
  if (sess.solved) return true;
  let lastDir = x <= lo ? 1 : x >= hi ? -1 : null;
  for (let hop = 0; hop < 10; hop++) {
    if (a >= MAIN_TH) break;
    const k = hopK(a);
    let order;
    if (lastDir === null) {
      const xR = clamp(x + k * step, lo, hi);
      const xL = clamp(x - k * step, lo, hi);
      const aR = sess.probe(xR);
      if (sess.solved) return true;
      const aL = sess.probe(xL);
      if (sess.solved) return true;
      order = (aR ?? -1e18) >= (aL ?? -1e18) ? [1, -1] : [-1, 1];
    } else {
      order = [lastDir, -lastDir];
    }
    let best = null;
    for (const d of order) {
      const ks = lastDir === null ? [k] : [k, k - 1, k + 1, 1];
      for (const kk of ks) {
        if (kk < 1) continue;
        const [nx, na] = crest(sess, x + d * kk * step, w, lo, hi);
        if (sess.solved) return true;
        if (na > a + 1) {
          best = [na, nx, d];
          break;
        }
      }
      if (best !== null) break;
    }
    if (best === null) break;
    a = best[0];
    x = best[1];
    lastDir = best[2];
  }
  pinpoint(sess, sess.bestVal, w, lo, hi, tune, tune.pinpointRounds, tune.pinpointFinalRadius, snipe);
  return a >= MAIN_TH;
}
function isFarTailAnchor(a, tune) {
  if (a === 0) return false;
  return Math.abs(a) < tune.farTailAnchorMaxAbs;
}
function ladderCoarseScan(sess, lo, hi, w, hc, tune) {
  const xs = scanGrid(lo, hi, w, hc);
  const order = spreadOrder(xs.length);
  for (const idx of order) {
    const x = xs[idx];
    const a = sess.probe(x);
    if (sess.solved) return null;
    if (a === null || a === 0) continue;
    if (isFarTailAnchor(a, tune)) return { x, a };
    if (a > 0) return { x, a };
  }
  return null;
}
function runInitialCoarseScanPositive(sess, lo, hi, w, hc) {
  const xs = scanGrid(lo, hi, w, hc);
  const order = spreadOrder(xs.length);
  for (const idx of order) {
    const a = sess.probe(xs[idx]);
    if (sess.solved) return;
    if (a !== null && a > 0) break;
  }
}
function ladderClimb(sess, x0, a0, w, hc, lo, hi, tune, snipe) {
  const wd = w;
  let prevK = 1 << 20;
  let postJumpCapK = 1 << 20;
  const seenCenters = [];
  for (let iter = 0; iter < tune.ladderMaxIters && !sess.solved; iter++) {
    if (a0 === 0 || !Number.isFinite(a0)) return;
    const off = Math.max(1, Math.round(tune.pairProbeOffsetW * wd));
    let x1 = x0 + off <= hi ? x0 + off : x0 - off;
    if (x1 === x0) return;
    let a1Opt = sess.probe(x1);
    if (sess.solved) return;
    if (a1Opt !== null && a1Opt !== 0 && a0 > 0 !== a1Opt > 0) {
      const a1Positive = a1Opt > 0;
      const dirIn = a1Positive === x1 > x0 ? 1 : -1;
      const base = a1Positive ? x1 : x0;
      const xn = clamp(base + dirIn * Math.max(1, Math.round(tune.signCrossMarchW * wd)), lo, hi);
      const anOpt = sess.probe(xn);
      if (sess.solved) return;
      if (anOpt === null || anOpt === 0) return;
      x0 = xn;
      a0 = anOpt;
      continue;
    }
    if (a1Opt === null || a1Opt === 0) {
      const x1b = x0 - (x1 - x0);
      if (x1b < lo || x1b > hi || x1b === x0) return;
      x1 = x1b;
      a1Opt = sess.probe(x1);
      if (sess.solved) return;
      if (a1Opt === null || a1Opt === 0) return;
      if (a0 > 0 !== a1Opt > 0) return;
    }
    const a1 = a1Opt;
    const c = invertCenter(x0, a0, x1, a1, w);
    if (!Number.isFinite(c) || Math.abs(c - x0) > tune.centerSanityMaxDistW * wd) return;
    const ci = clamp(c, lo, hi);
    for (const seen of seenCenters) {
      if (Math.abs(ci - seen) < Math.round(tune.orbitDistW * wd)) return;
    }
    seenCenters.push(ci);
    const acOpt = sess.probe(ci);
    if (sess.solved) return;
    if (acOpt === null) return;
    const ac = acOpt;
    if (ac > tune.ladderEntryMaxAbs && sqrtSnipe(sess, ci, ac, w, lo, hi, tune)) return;
    if (ac >= MAIN_TH) {
      pinpoint(sess, sess.bestVal, w, lo, hi, tune, tune.pinpointRounds, tune.pinpointFinalRadius, snipe);
      return;
    }
    const dxa = x0 - ci;
    let trusted = ac !== 0 && a0 > 0 === ac > 0 && c >= lo && c <= hi;
    let k = Math.round((H_PEAK - ac) / HEIGHT_OFFSET);
    if (k < 1) k = 1;
    if (k > hc - 1) k = hc - 1;
    if (trusted) {
      const kd = k;
      const bandHi = H_PEAK - kd * HEIGHT_OFFSET * 0.95 + tune.heightBandSlack;
      const bandLo = H_PEAK - kd * HEIGHT_OFFSET * 1.05 - tune.heightBandSlack;
      if (ac < bandLo || ac > bandHi) trusted = false;
    }
    if (trusted && k > postJumpCapK) trusted = false;
    if (trusted && Math.abs(dxa) <= tune.logResidualMaxDistW * wd) {
      const logResidual = Math.log(Math.abs(a0)) - (Math.log(Math.abs(ac)) - dxa * dxa / (wd * wd));
      if (Math.abs(logResidual) > tune.logResidualMax) trusted = false;
    }
    if (!trusted && ac > 0) {
      const half = Math.max(1, Math.round(tune.halfStepW * wd));
      const gradDir = a1 > a0 === x1 > x0 ? 1 : -1;
      let stepped = false;
      for (const sgn of [gradDir, -gradDir]) {
        const xs = clamp(ci + sgn * half, lo, hi);
        const asOpt = sess.probe(xs);
        if (sess.solved) return;
        if (asOpt !== null && asOpt > ac) {
          x0 = xs;
          a0 = asOpt;
          stepped = true;
          break;
        }
      }
      if (stepped) continue;
      return;
    }
    if (trusted) {
      if (k >= prevK) return;
      prevK = k;
    }
    const step3 = 3 * w;
    let dir;
    if (Math.abs(ci - x0) > tune.outsideClusterDistW * wd) {
      dir = ci >= x0 ? 1 : -1;
    } else if (ci + step3 > hi) {
      dir = -1;
    } else if (ci - step3 < lo) {
      dir = 1;
    } else {
      const arOpt = sess.probe(ci + step3);
      if (sess.solved) return;
      if (arOpt === null) {
        dir = -1;
      } else {
        const bareTail = Math.abs(arOpt) < tune.bareTailFrac * (Math.abs(ac) + HEIGHT_OFFSET);
        dir = bareTail ? -1 : arOpt > ac ? 1 : -1;
      }
    }
    let target = clamp(ci + dir * k * 3 * wd, lo, hi);
    let atOpt = sess.probe(target);
    if (sess.solved) return;
    if (atOpt === null) return;
    if (atOpt <= 0) {
      const target2 = clamp(ci - dir * k * 3 * wd, lo, hi);
      const at2Opt = sess.probe(target2);
      if (sess.solved) return;
      if (at2Opt !== null && at2Opt > atOpt) {
        target = target2;
        atOpt = at2Opt;
      }
      if (atOpt === 0) return;
    }
    postJumpCapK = Math.max(1, Math.round(tune.postJumpCapScale * k + tune.postJumpCapBias));
    x0 = target;
    a0 = atOpt;
  }
}
function runPostCoarsePipeline(sess, lo, hi, w, hc, tune, snipe) {
  walkAndPinpoint(sess, w, lo, hi, tune, snipe);
  if (sess.solved) return;
  const xs = scanGrid(lo, hi, w, hc);
  for (const x of xs) {
    sess.probe(x);
    if (sess.solved) return;
  }
  walkAndPinpoint(sess, w, lo, hi, tune, snipe);
  if (sess.solved) return;
  gallop(sess, sess.bestVal, w, lo, hi, tune);
  if (sess.solved) return;
  pinpoint(sess, sess.bestVal, w, lo, hi, tune, tune.pinpointRounds, tune.pinpointFinalRadius, snipe);
  if (sess.solved) return;
  clusterSweep(sess, w, lo, hi, tune);
  if (sess.solved) return;
  pinpoint(sess, sess.bestVal, w, lo, hi, tune, tune.pinpointRounds, tune.pinpointFinalRadiusWide, snipe);
  if (sess.solved) return;
  backstop(sess, w, lo, hi, tune);
}
function runSolverCoreBaseline(sess, lo, hi, w, hc, tune) {
  runInitialCoarseScanPositive(sess, lo, hi, w, hc);
  if (sess.solved) return;
  runPostCoarsePipeline(sess, lo, hi, w, hc, tune, false);
}
function runSolverCoreLadderSnipe(sess, lo, hi, w, hc, tune) {
  if (hc < 5) {
    runSolverCoreBaseline(sess, lo, hi, w, hc, tune);
    return;
  }
  const hit = ladderCoarseScan(sess, lo, hi, w, hc, tune);
  if (sess.solved) return;
  let havePositiveRestore = false;
  let restoreX = lo;
  let restoreA = -1e18;
  if (hit) {
    if (hit.a > 0) {
      restoreX = hit.x;
      restoreA = hit.a;
      havePositiveRestore = true;
    }
    const span = hi - lo;
    const skipPositiveLadder = hit.a > 0 && tune.positiveLadderSkipRangeFraction > 0 && hit.x > lo + Math.floor(tune.positiveLadderSkipRangeFraction * span);
    if (Math.abs(hit.a) < tune.ladderEntryMaxAbs && !skipPositiveLadder) {
      ladderClimb(sess, hit.x, hit.a, w, hc, lo, hi, tune, true);
    } else if (hit.a > 0) {
      sqrtSnipe(sess, hit.x, hit.a, w, lo, hi, tune);
    }
    if (sess.solved) return;
  }
  if (!havePositiveRestore) {
    runInitialCoarseScanPositive(sess, lo, hi, w, hc);
    if (sess.solved) return;
    if (sess.bestAlt > 0) {
      restoreX = sess.bestVal;
      restoreA = sess.bestAlt;
      havePositiveRestore = true;
    }
  }
  if (havePositiveRestore) sess.restoreBest(restoreX, restoreA);
  runPostCoarsePipeline(sess, lo, hi, w, hc, tune, true);
}

// src/dnet/solvers/kingOfTheHill/solverCore.ts
var KOTH_PEAK_HEIGHT = 1e4;
var KOTH_HILL_SPACING_WIDTHS = 3;
var KOTH_HILL_DIFFICULTY_DIVISOR = 8;
var KOTH_HILL_DIFFICULTY_CAP = 4;
var KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2;
var KOTH_GAUSS_WIDTH_PLUS = 1;
var SOLVER_MAX_PROBES = 600;
function parseKingOfTheHillAltitude(feedback, message) {
  if (typeof feedback === "number" && Number.isFinite(feedback)) return feedback;
  if (typeof feedback === "string") {
    const trimmed = feedback.trim();
    if (trimmed.length > 0) {
      const direct = Number(trimmed);
      if (Number.isFinite(direct)) return direct;
    }
  }
  if (typeof message === "string") {
    const fromMessage = message.match(/current altitude:\s*([-\d.]+)/i);
    if (fromMessage) {
      const alt = Number(fromMessage[1]);
      if (Number.isFinite(alt)) return alt;
    }
  }
  return null;
}
function kingOfTheHillHillCount(difficulty) {
  return Math.min(Math.floor(difficulty / KOTH_HILL_DIFFICULTY_DIVISOR), KOTH_HILL_DIFFICULTY_CAP) * 2 + 1;
}
function kingOfTheHillGaussianWidth(passwordLength) {
  return 10 ** Math.max(passwordLength - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS;
}
function numericRange(passwordLength) {
  let min = 10 ** (passwordLength - 1);
  const max = 10 ** passwordLength - 1;
  if (passwordLength === 1) min = 0;
  return { min, max };
}
function createAuthProbeSession(min, max, auth) {
  const samples = /* @__PURE__ */ new Map();
  const session = {
    min,
    max,
    guesses: 0,
    solved: false,
    exhausted: false,
    bestVal: min,
    bestAlt: -Infinity,
    samples,
    restoreBest(x, a) {
      session.bestVal = x;
      session.bestAlt = a;
    },
    probe(x) {
      if (session.exhausted || session.solved) return null;
      const xi = Math.round(x);
      if (xi < min || xi > max) return null;
      if (samples.has(xi)) return samples.get(xi);
      if (session.guesses >= SOLVER_MAX_PROBES) {
        session.exhausted = true;
        return null;
      }
      session.guesses++;
      const result = auth(String(xi));
      if (result.success) {
        session.solved = true;
        samples.set(xi, Infinity);
        session.bestVal = xi;
        session.bestAlt = Infinity;
        return Infinity;
      }
      const alt = parseKingOfTheHillAltitude(result.feedback, result.message);
      if (alt === null) return null;
      samples.set(xi, alt);
      if (alt > session.bestAlt) {
        session.bestAlt = alt;
        session.bestVal = xi;
      }
      return alt;
    }
  };
  return session;
}
function runSolverImproved(assignment, options) {
  const { min, max } = numericRange(assignment.passwordLength);
  const tuning = options.tuning ?? TUNED_LADDER_SNIPE_DIFF60;
  const session = createAuthProbeSession(min, max, options.auth);
  runSolverCoreLadderSnipe(session, min, max, kingOfTheHillGaussianWidth(assignment.passwordLength), kingOfTheHillHillCount(assignment.difficulty), tuning);
  const result = {
    guesses: session.guesses,
    solved: session.solved,
    bestVal: session.bestVal,
    bestAlt: session.bestAlt
  };
  if (options.returnSamples === true) result.samples = session.samples;
  return result;
}

// tests/kingOfTheHillCore.ts
var NUMBERS = "0123456789";
var MAX_PASSWORD_LENGTH = 50;
var DEFAULT_DIFFICULTY = 60;
var DEFAULT_COUNT = 10;
var DEFAULT_SEED = 1265595496;
var KING_MAIN_PEAK_ALTITUDE = 7500;
var KOTH_NEAR_ZONE_FRACTION2 = 0.03;
var KOTH_LOCATION_JITTER_SCALE = 0.2;
var KOTH_LOCATION_JITTER_BASE = 0.9;
var KOTH_HEIGHT_OFFSET_BASE = 2600;
var KOTH_HEIGHT_JITTER_SCALE = 0.1;
var KOTH_HEIGHT_JITTER_BASE = 0.95;
var ASSIGNMENT_PASSWORD_LENGTH_DIVISOR = 6;
var ASSIGNMENT_PASSWORD_LENGTH_CAP = 10;
var ASSIGNMENT_SEED_STRIDE = 9973;
var ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS = 15;
var PROFILE_DEFAULT_POINT_COUNT = 800;
var WHRNG = class {
  constructor(totalPlaytime) {
    __publicField(this, "s1");
    __publicField(this, "s2");
    __publicField(this, "s3");
    const v = totalPlaytime / 1e3 % 3e4;
    this.s1 = v;
    this.s2 = v;
    this.s3 = v;
  }
  step() {
    this.s1 = 171 * this.s1 % 30269;
    this.s2 = 172 * this.s2 % 30307;
    this.s3 = 170 * this.s3 % 30323;
  }
  random() {
    this.step();
    return (this.s1 / 30269 + this.s2 / 30307 + this.s3 / 30323) % 1;
  }
};
function getAltitudeGivenHillSpecs(x, location, height, width) {
  return height * Math.exp((x - location) ** 2 / width ** 2 * -1);
}
function getKingOfTheHillAltitude(server, attemptedPassword) {
  const password = Number(server.password);
  const x = Number(attemptedPassword);
  const rng = new WHRNG(password);
  const hillCount = Math.min(Math.floor(server.difficulty / KOTH_HILL_DIFFICULTY_DIVISOR), KOTH_HILL_DIFFICULTY_CAP) * 2 + 1;
  const passwordHillIndex = Math.floor(rng.random() * (hillCount - 2)) + 1;
  const width = 10 ** Math.max(server.password.length - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS;
  if (password !== 0 && Math.abs((x - password) / password) < KOTH_NEAR_ZONE_FRACTION2) {
    return getAltitudeGivenHillSpecs(x, password, KOTH_PEAK_HEIGHT, width);
  }
  let altitude = 0;
  for (let i = 0; i < hillCount; i++) {
    const locationOffset = (i - passwordHillIndex) * width * KOTH_HILL_SPACING_WIDTHS * (rng.random() * KOTH_LOCATION_JITTER_SCALE + KOTH_LOCATION_JITTER_BASE);
    const heightOffset = Math.abs((i - passwordHillIndex) * KOTH_HEIGHT_OFFSET_BASE) * (rng.random() * KOTH_HEIGHT_JITTER_SCALE + KOTH_HEIGHT_JITTER_BASE);
    altitude += getAltitudeGivenHillSpecs(x, password + locationOffset, KOTH_PEAK_HEIGHT - heightOffset, width);
  }
  return altitude;
}
function authKingOfTheHill(server, attemptedPassword) {
  if (server.password === attemptedPassword) {
    return { success: true };
  }
  const altitude = getKingOfTheHillAltitude(server, attemptedPassword);
  const message = `current altitude: ${altitude.toFixed(5)} m; highest peak: ${KOTH_PEAK_HEIGHT.toLocaleString()} m`;
  return { success: false, feedback: `${altitude}`, message };
}
function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function getPasswordSeeded(length, rng, allowLetters = false) {
  const characters = NUMBERS + (allowLetters ? "" : "");
  let password = "";
  const cappedLength = clampNumber(length, 1, MAX_PASSWORD_LENGTH);
  for (let i = 0; i < cappedLength; i++) {
    password += characters[Math.floor(rng() * characters.length)];
  }
  if (!allowLetters && Number(password) > Number.MAX_SAFE_INTEGER) {
    password = password.slice(0, ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS);
  }
  if (!allowLetters) {
    return Number(password).toString();
  }
  return password;
}
function buildAssignment(difficulty, rng) {
  const passwordLength = Math.min(
    Math.floor(1 + difficulty / ASSIGNMENT_PASSWORD_LENGTH_DIVISOR),
    ASSIGNMENT_PASSWORD_LENGTH_CAP
  );
  const password = getPasswordSeeded(passwordLength, rng, false);
  return {
    difficulty,
    password,
    passwordLength: password.length,
    modelId: "globalMaxima",
    staticPasswordHint: "Ascend the highest mountain!"
  };
}
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function assignmentNumericRange(assignment) {
  let min = 10 ** (assignment.passwordLength - 1);
  const max = 10 ** assignment.passwordLength - 1;
  if (assignment.passwordLength === 1) min = 0;
  return { min, max };
}
function toServer(assignment) {
  return { password: assignment.password, difficulty: assignment.difficulty };
}
function sampleAltitudeProfile(assignment, options = {}) {
  const pointCount = options.pointCount ?? PROFILE_DEFAULT_POINT_COUNT;
  const password = Number(assignment.password);
  const { min, max } = assignmentNumericRange(assignment);
  const server = toServer(assignment);
  const start = min;
  const end = max;
  const nearLo = Math.max(min, Math.ceil(password * (1 - KOTH_NEAR_ZONE_FRACTION2)));
  const nearHi = Math.min(max, Math.floor(password * (1 + KOTH_NEAR_ZONE_FRACTION2)));
  const step = Math.max(1, Math.ceil((end - start) / pointCount));
  const nearStep = Math.max(1, Math.ceil(kingOfTheHillGaussianWidth(assignment.passwordLength) / 12));
  const pointByX = /* @__PURE__ */ new Map();
  function addPoint(x) {
    const xi = Math.round(x);
    if (xi < min || xi > max) return;
    pointByX.set(xi, {
      x: xi,
      altitude: getKingOfTheHillAltitude(server, String(xi)),
      nearZone: password !== 0 && Math.abs((xi - password) / password) < KOTH_NEAR_ZONE_FRACTION2
    });
  }
  for (let x = start; x <= end; x += step) addPoint(x);
  addPoint(end);
  for (let x = nearLo; x <= nearHi; x += nearStep) addPoint(x);
  for (const x of [nearLo, nearHi, password]) addPoint(x);
  const points = [...pointByX.values()].sort((a, b) => a.x - b.x);
  return { points, password, min, max, start, end, nearLo, nearHi };
}
function generateAssignmentAt(seed, index, difficulty) {
  const i = index - 1;
  const rng = mulberry32(seed + i * ASSIGNMENT_SEED_STRIDE >>> 0);
  return { index, assignment: buildAssignment(difficulty, rng) };
}
function generateAssignments(seed, count, difficulty) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(generateAssignmentAt(seed, i + 1, difficulty));
  }
  return rows;
}
function runSolver(assignment, options = {}) {
  const server = toServer(assignment);
  const raw = runSolverImproved(assignment, {
    auth: (guess) => authKingOfTheHill(server, guess),
    returnSamples: options.returnSamples === true
  });
  const result = {
    guesses: raw.guesses,
    solved: raw.solved,
    bestVal: raw.bestVal,
    bestAlt: Number.isFinite(raw.bestAlt) ? raw.bestAlt : null
  };
  if (options.returnSamples && raw.samples) {
    result.probes = [...raw.samples.entries()].map(([x, alt]) => ({ x, alt }));
  }
  return result;
}
export {
  ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS,
  ASSIGNMENT_PASSWORD_LENGTH_CAP,
  ASSIGNMENT_PASSWORD_LENGTH_DIVISOR,
  ASSIGNMENT_SEED_STRIDE,
  DEFAULT_COUNT,
  DEFAULT_DIFFICULTY,
  DEFAULT_SEED,
  KING_MAIN_PEAK_ALTITUDE,
  KOTH_HEIGHT_JITTER_BASE,
  KOTH_HEIGHT_JITTER_SCALE,
  KOTH_HEIGHT_OFFSET_BASE,
  KOTH_HILL_SPACING_WIDTHS,
  KOTH_LOCATION_JITTER_BASE,
  KOTH_LOCATION_JITTER_SCALE,
  KOTH_NEAR_ZONE_FRACTION2 as KOTH_NEAR_ZONE_FRACTION,
  KOTH_PEAK_HEIGHT,
  MAX_PASSWORD_LENGTH,
  NUMBERS,
  PROFILE_DEFAULT_POINT_COUNT,
  assignmentNumericRange,
  authKingOfTheHill,
  buildAssignment,
  generateAssignmentAt,
  generateAssignments,
  getKingOfTheHillAltitude,
  getPasswordSeeded,
  kingOfTheHillGaussianWidth,
  kingOfTheHillHillCount,
  mulberry32,
  runSolver,
  sampleAltitudeProfile,
  toServer
};
