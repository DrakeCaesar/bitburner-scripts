/* Auto-generated — edit tests/kingOfTheHillCore.ts; run pnpm run test:koth:bundle */
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// tests/kingOfTheHillTune.avg.json
var kingOfTheHillTune_avg_default = {
  objective: "avg",
  avgGuesses: 21.75,
  maxGuesses: 72,
  totalGuesses: 5220,
  fitness: 5220071,
  config: {
    clusterMargin: 1.1,
    clusterDetectAlt: 300,
    mainPeakModeAlt: 9e3,
    refinePeakCountMain: 1,
    findHillQuickRounds: 4,
    coarseMinDivisor: 40,
    coarseHillFactor: 4,
    rescanDivisor1: 8,
    rescanDivisor2: 78,
    rescanDivisor3: 1,
    refineSpanHillDivisor: 6,
    refineCoarsePasses: 4,
    refineFinePasses: 2,
    refineRadiusShrink: 5,
    refineStepShrink: 5,
    sideHillSweepWidthDivisor: 4,
    centroidMinAlt: 8e3,
    centroidAltFraction: 0.94,
    centroidRefineRadius: 8,
    centroidRefinePasses: 2,
    hillClimbInitialDivisor: 112,
    hillClimbShrink: 3,
    hillClimbFlatAltDelta: 6e-3,
    zoomInitialDivisor: 41,
    zoomMaxPasses: 8,
    zoomStepDivisor: 13,
    parabolicFlatNegLog10: 9,
    mainPeakDetectAlt: 6500,
    mainPeakWindowWidths: 3,
    gaussEstimateMinAlt: 50,
    gaussHeightFraction: 1,
    enableGaussianEstimate: 1,
    ternaryMaxItersCap: 52,
    ternaryWidthStop: 7,
    ternarySpanDivisor: 4,
    enableTernarySearch: 0,
    expandMaxStepDivisor: 6,
    expandStepMultiplier: 4,
    enableExpandFromBest: 0,
    subdivNarrowStepFactor: 1,
    enableSubdivNarrow: 1,
    centroidLogWeight: 0.4,
    finalMainRadius: 3,
    finalSideMinRadius: 10,
    finalSideMaxRadius: 55,
    finalSideSpanDivisor: 40,
    finalTinySpan: 14
  }
};

// tests/kingOfTheHillTune.max.json
var kingOfTheHillTune_max_default = {
  objective: "max",
  avgGuesses: 23.6041666667,
  maxGuesses: 70,
  totalGuesses: 5665,
  fitness: 70005665,
  config: {
    clusterMargin: 1.05,
    clusterDetectAlt: 300,
    mainPeakModeAlt: 9e3,
    refinePeakCountMain: 1,
    findHillQuickRounds: 4,
    coarseMinDivisor: 40,
    coarseHillFactor: 4,
    rescanDivisor1: 7,
    rescanDivisor2: 120,
    rescanDivisor3: 50,
    refineSpanHillDivisor: 6,
    refineCoarsePasses: 3,
    refineFinePasses: 2,
    refineRadiusShrink: 3,
    refineStepShrink: 3,
    sideHillSweepWidthDivisor: 4,
    centroidMinAlt: 8400,
    centroidAltFraction: 0.81,
    centroidRefineRadius: 12,
    centroidRefinePasses: 2,
    hillClimbInitialDivisor: 104,
    hillClimbShrink: 7,
    hillClimbFlatAltDelta: 0.036,
    zoomInitialDivisor: 35,
    zoomMaxPasses: 12,
    zoomStepDivisor: 16,
    parabolicFlatNegLog10: 8,
    mainPeakDetectAlt: 6500,
    mainPeakWindowWidths: 3,
    gaussEstimateMinAlt: 500,
    gaussHeightFraction: 1,
    enableGaussianEstimate: 1,
    ternaryMaxItersCap: 24,
    ternaryWidthStop: 1,
    ternarySpanDivisor: 5,
    enableTernarySearch: 0,
    expandMaxStepDivisor: 8,
    expandStepMultiplier: 4,
    enableExpandFromBest: 1,
    subdivNarrowStepFactor: 1,
    enableSubdivNarrow: 1,
    centroidLogWeight: 0.5,
    finalMainRadius: 3,
    finalSideMinRadius: 35,
    finalSideMaxRadius: 110,
    finalSideSpanDivisor: 20,
    finalTinySpan: 24
  }
};

// src/dnet/solvers/kingOfTheHill/config.ts
var TUNED_MAX_CONFIG = kingOfTheHillTune_max_default.config;
var TUNED_AVG_CONFIG = kingOfTheHillTune_avg_default.config;
function finalizeImprovedConfig(raw) {
  const cfg = { ...raw };
  cfg.enableGaussianEstimate = cfg.enableGaussianEstimate ? 1 : 0;
  cfg.enableTernarySearch = cfg.enableTernarySearch ? 1 : 0;
  cfg.enableExpandFromBest = cfg.enableExpandFromBest ? 1 : 0;
  cfg.enableSubdivNarrow = cfg.enableSubdivNarrow ? 1 : 0;
  cfg.parabolicFlatEpsilon = 10 ** -cfg.parabolicFlatNegLog10;
  cfg.rescanDivisors = [cfg.rescanDivisor1, cfg.rescanDivisor2, cfg.rescanDivisor3].filter((d) => d > 0).sort((a, b) => a - b);
  return cfg;
}
function getTunedImprovedConfig(objective = "max") {
  return finalizeImprovedConfig(objective === "avg" ? TUNED_AVG_CONFIG : TUNED_MAX_CONFIG);
}
function computeImprovedFitness(objective, unsolved, totalGuesses, maxGuesses) {
  if (unsolved > 0) return Number.MAX_SAFE_INTEGER - unsolved * 1e9 + totalGuesses;
  if (objective === "max") return maxGuesses * 1e6 + totalGuesses;
  return totalGuesses * 1e3 + maxGuesses;
}

// src/dnet/solvers/kingOfTheHill/solverCore.ts
var KOTH_PEAK_HEIGHT = 1e4;
var KOTH_HILL_SPACING_WIDTHS = 3;
var KOTH_HILL_DIFFICULTY_DIVISOR = 8;
var KOTH_HILL_DIFFICULTY_CAP = 4;
var KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2;
var KOTH_GAUSS_WIDTH_PLUS = 1;
var SOLVER_MAX_PROBES = 5e3;
var TERNARY_MAX_LINEAR_SCAN = 64;
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
function ceilDiv(a, b) {
  return Math.floor((a + b - 1) / b);
}
function clusterHalfWidth(hillCount, passwordLength, clusterMargin) {
  const width = kingOfTheHillGaussianWidth(passwordLength);
  return Math.ceil((hillCount - 1) * width * KOTH_HILL_SPACING_WIDTHS * clusterMargin);
}
function clusterSearchWindow(fullMin, fullMax, center, hillCount, passwordLength, cfg) {
  const half = clusterHalfWidth(hillCount, passwordLength, cfg.clusterMargin);
  return { min: Math.max(fullMin, center - half), max: Math.min(fullMax, center + half) };
}
function improvedSearchWindow(fullMin, fullMax, session, hillCount, passwordLength, gaussWidth, cfg) {
  if (session.bestAlt >= cfg.mainPeakDetectAlt) {
    const half = gaussWidth * cfg.mainPeakWindowWidths;
    return { min: Math.max(fullMin, session.bestVal - half), max: Math.min(fullMax, session.bestVal + half) };
  }
  if (session.bestAlt > cfg.clusterDetectAlt) {
    return clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg);
  }
  return { min: fullMin, max: fullMax };
}
function parabolicPeak(x0, y0, x1, y1, x2, y2, cfg) {
  const denom = y0 - 2 * y1 + y2;
  if (!Number.isFinite(denom) || Math.abs(denom) < cfg.parabolicFlatEpsilon) return x1;
  return x1 + (x1 - x0) * (y0 - y2) / (2 * denom);
}
function findLocalPeaks(sorted) {
  if (sorted.length === 0) return [];
  const peaks = [];
  for (let i = 1; i < sorted.length - 1; i++) {
    if (sorted[i].alt >= sorted[i - 1].alt && sorted[i].alt > sorted[i + 1].alt) {
      peaks.push({ x: sorted[i].x, alt: sorted[i].alt });
    }
  }
  let best = sorted[0];
  for (const row of sorted) {
    if (row.alt > best.alt) best = row;
  }
  peaks.push({ x: best.x, alt: best.alt });
  peaks.sort((a, b) => b.alt - a.alt);
  const seen = /* @__PURE__ */ new Set();
  return peaks.filter((p) => {
    if (seen.has(p.x)) return false;
    seen.add(p.x);
    return true;
  });
}
function refinePeak(session, mn, mx, center, initialRadius, passes, cfg) {
  let c = center;
  let r = Math.max(1, initialRadius);
  for (let p = 0; p < passes; p++) {
    const x0 = Math.max(mn, c - r);
    const x2 = Math.min(mx, c + r);
    const x1 = c;
    const y0 = session.probe(x0);
    if (session.solved) return c;
    const y1 = session.probe(x1);
    if (session.solved) return c;
    const y2 = session.probe(x2);
    if (session.solved) return c;
    const peak = parabolicPeak(x0, y0, x1, y1, x2, y2, cfg);
    c = Math.round(Math.max(mn, Math.min(mx, peak)));
    r = Math.max(1, ceilDiv(r, cfg.refineStepShrink));
  }
  return c;
}
function weightedCentroid(session, minAlt) {
  let sumW = 0;
  let sumX = 0;
  for (const [x, alt] of session.samples) {
    if (alt < minAlt) continue;
    sumW += alt;
    sumX += x * alt;
  }
  if (sumW <= 0) return null;
  return Math.round(sumX / sumW);
}
function logWeightedCentroid(session, minAlt) {
  let sumW = 0;
  let sumX = 0;
  for (const [x, alt] of session.samples) {
    if (alt <= minAlt) continue;
    const w = Math.log1p(alt - minAlt);
    sumW += w;
    sumX += x * w;
  }
  if (sumW <= 0) return null;
  return Math.round(sumX / sumW);
}
function blendedCentroid(session, minAlt, cfg) {
  const linear = weightedCentroid(session, minAlt);
  const logc = logWeightedCentroid(session, minAlt);
  if (linear == null && logc == null) return null;
  const w = cfg.centroidLogWeight;
  if (logc == null || w <= 0) return linear;
  if (linear == null || w >= 1) return logc;
  return Math.round(linear * (1 - w) + logc * w);
}
function buildFinals(mn, mx, bestVal, bestAlt, cfg) {
  const span = mx - mn;
  const out = [];
  if (span <= cfg.finalTinySpan) {
    for (let d = 0; d <= span; d++) {
      if (d === 0) {
        if (bestVal >= mn && bestVal <= mx) out.push(bestVal);
        continue;
      }
      for (const sign of [-1, 1]) {
        const c = bestVal + sign * d;
        if (c >= mn && c <= mx) out.push(c);
      }
    }
    return out;
  }
  const nearMainPeak = bestAlt >= cfg.mainPeakDetectAlt;
  const maxRadius = nearMainPeak ? cfg.finalMainRadius : Math.min(cfg.finalSideMaxRadius, Math.max(cfg.finalSideMinRadius, ceilDiv(span, cfg.finalSideSpanDivisor)));
  for (let d = 0; d <= maxRadius; d++) {
    if (d === 0) {
      if (bestVal >= mn && bestVal <= mx) out.push(bestVal);
      continue;
    }
    for (const sign of [-1, 1]) {
      const c = bestVal + sign * d;
      if (c >= mn && c <= mx) out.push(c);
    }
  }
  return out;
}
function tryFinalCandidates(session, mn, mx, cfg) {
  for (const c of buildFinals(mn, mx, session.bestVal, session.bestAlt, cfg)) {
    session.probe(c);
    if (session.solved) return;
  }
}
function tryGaussianPeakEstimate(session, mn, mx, gaussWidth, cfg) {
  if (!cfg.enableGaussianEstimate) return;
  if (session.bestAlt < cfg.gaussEstimateMinAlt) return;
  const height = KOTH_PEAK_HEIGHT * cfg.gaussHeightFraction;
  const ratio = Math.min(session.bestAlt / height, 0.999999);
  if (ratio <= 1e-12) return;
  const offset = gaussWidth * Math.sqrt(-Math.log(ratio));
  const o = Math.max(1, Math.round(offset));
  for (const candidate of [session.bestVal - o, session.bestVal + o]) {
    if (candidate >= mn && candidate <= mx) {
      session.probe(candidate);
      if (session.solved) return;
    }
  }
}
function sweep(session, start, end, step, stopAlt) {
  if (step <= 0) step = 1;
  for (let x = start; x <= end; x += step) {
    session.probe(x);
    if (session.solved || session.exhausted) return;
    if (stopAlt != null && session.bestAlt >= stopAlt) return;
  }
  if (end >= start && end <= session.max && !session.samples.has(end)) {
    session.probe(end);
    if (session.solved || session.exhausted) return;
    if (stopAlt != null && session.bestAlt >= stopAlt) return;
  }
}
function tryTernaryPeakSearch(session, lo, hi, maxIters, widthStop) {
  if (lo >= hi || session.solved || session.exhausted) return;
  const initialWidth = hi - lo;
  const safeWidthStop = Math.max(1, widthStop);
  const minIters = Math.ceil(Math.log(initialWidth / safeWidthStop) / Math.log(1.5));
  const itersBudget = Math.min(64, Math.max(maxIters, minIters));
  let iters = 0;
  while (hi - lo > safeWidthStop && iters < itersBudget && !session.solved && !session.exhausted) {
    const m1 = lo + Math.floor((hi - lo) / 3);
    const m2 = hi - Math.floor((hi - lo) / 3);
    const a1 = session.probe(m1);
    if (session.solved || session.exhausted) return;
    const a2 = session.probe(m2);
    if (session.solved || session.exhausted) return;
    if (a1 < a2) lo = m1;
    else hi = m2;
    iters++;
  }
  const width = hi - lo;
  if (width <= TERNARY_MAX_LINEAR_SCAN) {
    for (let x = lo; x <= hi && !session.solved && !session.exhausted; x++) {
      session.probe(x);
    }
    return;
  }
  sweep(session, lo, hi, Math.max(1, ceilDiv(width, safeWidthStop)), null);
}
function tryExpandFromBest(session, mn, mx, gaussWidth, stopAlt, cfg) {
  if (!cfg.enableExpandFromBest) return;
  let step = 1;
  const maxStep = Math.max(1, ceilDiv(gaussWidth, cfg.expandMaxStepDivisor));
  const mult = Math.max(2, cfg.expandStepMultiplier);
  while (step <= maxStep && !session.solved && !session.exhausted) {
    let improved = false;
    for (const sign of [-1, 1]) {
      const x = session.bestVal + sign * step;
      if (x < mn || x > mx) continue;
      const before = session.bestAlt;
      session.probe(x);
      if (session.solved) return;
      if (session.bestAlt > before) improved = true;
      if (session.bestAlt >= stopAlt) return;
    }
    if (!improved && step > 1) break;
    step = Math.max(1, step * mult);
  }
}
function refinePeakCount(session, hillCount, cfg) {
  if (session.bestAlt >= cfg.mainPeakModeAlt) return cfg.refinePeakCountMain;
  return hillCount;
}
function findHillBySubdivision(session, lo, hi, quickRounds, fullMin, fullMax, hillCount, passwordLength, gaussWidth, cfg) {
  let step = hi - lo;
  for (let round = 0; round < quickRounds && !session.solved && !session.exhausted; round++) {
    const nextStep = Math.max(1, ceilDiv(step, 2));
    if (nextStep >= step) break;
    step = nextStep;
    for (let x = lo + step; x < hi; x += step) {
      session.probe(Math.round(x));
      if (session.solved) return;
    }
    if (session.bestAlt >= cfg.mainPeakModeAlt) return;
    if (!cfg.enableSubdivNarrow) continue;
    if (session.bestAlt >= cfg.clusterDetectAlt) {
      const win = clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg);
      lo = Math.max(lo, win.min);
      hi = Math.min(hi, win.max);
    } else if (session.bestAlt > 0) {
      const half = Math.max(step * cfg.subdivNarrowStepFactor, gaussWidth);
      lo = Math.max(lo, session.bestVal - half);
      hi = Math.min(hi, session.bestVal + half);
    }
  }
}
function findHillLinearFallback(session, lo, hi, hillCount, cfg) {
  const span = hi - lo;
  const step = Math.max(1, ceilDiv(span, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  sweep(session, lo, hi, step, cfg.mainPeakModeAlt);
}
function tryHillClimbFinals(session, searchMin, searchMax, gaussWidth, fullMin, fullMax, cfg) {
  let step = Math.max(1, ceilDiv(gaussWidth, cfg.hillClimbInitialDivisor));
  let x = session.bestVal;
  while (step >= 1 && !session.solved && !session.exhausted) {
    const left = Math.max(searchMin, x - step);
    const right = Math.min(searchMax, x + step);
    const yL = session.probe(left);
    if (session.solved) return;
    const yC = left === right ? yL : session.probe(x);
    if (session.solved) return;
    const yR = session.probe(right);
    if (session.solved) return;
    if (yL > yC) x = left;
    else if (yR > yC) x = right;
    const flat = Math.abs(yL - yC) <= cfg.hillClimbFlatAltDelta && Math.abs(yR - yC) <= cfg.hillClimbFlatAltDelta;
    if (flat || yC >= yL && yC >= yR) {
      const nextStep = Math.max(1, ceilDiv(step, cfg.hillClimbShrink));
      if (nextStep >= step) break;
      step = nextStep;
    }
  }
  tryFinalCandidates(session, fullMin, fullMax, cfg);
}
function tryZoomFinals(session, searchMin, searchMax, fullMin, fullMax, cfg) {
  let step = Math.max(1, ceilDiv(searchMax - searchMin, cfg.zoomInitialDivisor));
  for (let pass = 0; pass < cfg.zoomMaxPasses && !session.solved && !session.exhausted; pass++) {
    const lo = Math.max(searchMin, session.bestVal - step);
    const hi = Math.min(searchMax, session.bestVal + step);
    sweep(session, lo, hi, Math.max(1, ceilDiv(step, cfg.zoomStepDivisor)), null);
    if (session.solved) return;
    tryFinalCandidates(session, fullMin, fullMax, cfg);
    if (session.solved) return;
    const nextStep = Math.max(1, ceilDiv(step, cfg.zoomStepDivisor));
    if (nextStep >= step) break;
    step = nextStep;
  }
}
function refinePeakCandidates(session, searchMin, searchMax, peaks, refineRadius, count, cfg) {
  for (let i = 0; i < Math.min(count, peaks.length); i++) {
    const peak = peaks[i];
    const refined = refinePeak(session, searchMin, searchMax, peak.x, refineRadius, cfg.refineCoarsePasses, cfg);
    if (session.solved) return true;
    refinePeak(
      session,
      searchMin,
      searchMax,
      refined,
      Math.max(1, ceilDiv(refineRadius, cfg.refineRadiusShrink)),
      cfg.refineFinePasses,
      cfg
    );
    if (session.solved) return true;
  }
  return session.solved;
}
function sortedSamples(session) {
  return [...session.samples.entries()].map(([x, alt]) => ({ x, alt })).sort((a, b) => a.x - b.x);
}
function runSolverImprovedCore(session, ctx, cfgIn, options = {}) {
  const cfg = finalizeImprovedConfig(cfgIn);
  const returnSamples = options.returnSamples === true;
  const { min, max, hillCount, passwordLength, gaussWidth } = ctx;
  findHillBySubdivision(session, min, max, cfg.findHillQuickRounds, min, max, hillCount, passwordLength, gaussWidth, cfg);
  if (!session.solved && session.bestAlt >= cfg.clusterDetectAlt) {
    tryGaussianPeakEstimate(session, min, max, gaussWidth, cfg);
  }
  if (!session.solved && session.bestAlt < cfg.mainPeakDetectAlt) {
    let fallbackLo = min;
    let fallbackHi = max;
    if (session.bestAlt >= cfg.clusterDetectAlt) {
      const win = clusterSearchWindow(min, max, session.bestVal, hillCount, passwordLength, cfg);
      fallbackLo = win.min;
      fallbackHi = win.max;
    }
    findHillLinearFallback(session, fallbackLo, fallbackHi, hillCount, cfg);
  }
  if (session.solved) {
    return { guesses: session.guesses, solved: true, bestVal: session.bestVal, bestAlt: session.bestAlt };
  }
  let search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
  let searchSpan = search.max - search.min;
  let coarseStep = Math.max(1, ceilDiv(searchSpan, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  for (const divisor of cfg.rescanDivisors) {
    if (session.bestAlt >= cfg.centroidMinAlt) break;
    if (session.bestAlt >= cfg.mainPeakModeAlt) break;
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
    searchSpan = search.max - search.min;
    sweep(session, search.min, search.max, Math.max(1, ceilDiv(searchSpan, divisor)), cfg.mainPeakModeAlt);
    if (session.solved) return finish();
  }
  search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
  searchSpan = search.max - search.min;
  coarseStep = Math.max(1, ceilDiv(searchSpan, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  {
    const peaks = findLocalPeaks(sortedSamples(session));
    const refineRadius = Math.max(coarseStep, ceilDiv(searchSpan, hillCount * cfg.refineSpanHillDivisor));
    refinePeakCandidates(session, search.min, search.max, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg);
    if (session.solved) return finish();
  }
  if (session.bestAlt < cfg.mainPeakDetectAlt) {
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
    tryExpandFromBest(session, search.min, search.max, gaussWidth, cfg.mainPeakDetectAlt, cfg);
    if (session.solved) return finish();
    sweep(session, search.min, search.max, Math.max(1, ceilDiv(gaussWidth, cfg.sideHillSweepWidthDivisor)), cfg.mainPeakDetectAlt);
    if (session.solved) return finish();
    const peaks = findLocalPeaks(sortedSamples(session));
    const refineRadius = Math.max(1, gaussWidth);
    refinePeakCandidates(session, search.min, search.max, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg);
    if (session.solved) return finish();
  }
  if (session.bestAlt >= cfg.centroidMinAlt) {
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
    const centroidMin = session.bestAlt * cfg.centroidAltFraction;
    const centroid = blendedCentroid(session, centroidMin, cfg);
    if (centroid != null) {
      session.probe(centroid);
      if (!session.solved) {
        refinePeak(session, search.min, search.max, centroid, cfg.centroidRefineRadius, cfg.centroidRefinePasses, cfg);
      }
    }
  }
  if (!session.solved) tryFinalCandidates(session, min, max, cfg);
  if (!session.solved && session.bestAlt >= cfg.mainPeakDetectAlt) {
    const climbWindow = clusterSearchWindow(min, max, session.bestVal, hillCount, passwordLength, cfg);
    if (cfg.enableTernarySearch) {
      const ternaryIters = Math.min(
        cfg.ternaryMaxItersCap,
        ceilDiv(climbWindow.max - climbWindow.min, Math.max(1, cfg.ternarySpanDivisor))
      );
      tryTernaryPeakSearch(session, climbWindow.min, climbWindow.max, ternaryIters, cfg.ternaryWidthStop);
    }
    if (!session.solved) tryFinalCandidates(session, min, max, cfg);
    if (!session.solved) tryGaussianPeakEstimate(session, climbWindow.min, climbWindow.max, gaussWidth, cfg);
    if (!session.solved) tryFinalCandidates(session, min, max, cfg);
    if (!session.solved) tryHillClimbFinals(session, climbWindow.min, climbWindow.max, gaussWidth, min, max, cfg);
    if (!session.solved) tryZoomFinals(session, climbWindow.min, climbWindow.max, min, max, cfg);
    if (!session.solved) tryFinalCandidates(session, min, max, cfg);
  }
  return finish();
  function finish() {
    const result = {
      guesses: session.guesses,
      solved: session.solved,
      bestVal: session.bestVal,
      bestAlt: session.bestAlt
    };
    if (returnSamples) result.samples = session.samples;
    return result;
  }
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
    bestAlt: -1,
    samples,
    probe(x) {
      if (session.exhausted || session.solved) return 0;
      const xi = Math.round(x);
      if (xi < min || xi > max) return 0;
      if (samples.has(xi)) return samples.get(xi);
      if (session.guesses >= SOLVER_MAX_PROBES) {
        session.exhausted = true;
        return 0;
      }
      session.guesses++;
      const result = auth(String(xi));
      if (result.success) {
        session.solved = true;
        return Infinity;
      }
      const alt = parseKingOfTheHillAltitude(result.feedback, result.message) ?? -1;
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
  const cfg = finalizeImprovedConfig(options.improvedConfig ?? TUNED_MAX_CONFIG);
  const min = 10 ** (assignment.passwordLength - 1);
  const max = 10 ** assignment.passwordLength - 1;
  const ctx = {
    min,
    max,
    hillCount: kingOfTheHillHillCount(assignment.difficulty),
    passwordLength: assignment.passwordLength,
    gaussWidth: kingOfTheHillGaussianWidth(assignment.passwordLength)
  };
  const session = createAuthProbeSession(min, max, options.auth);
  return runSolverImprovedCore(session, ctx, cfg, { returnSamples: options.returnSamples === true });
}

// tests/kingOfTheHillCore.ts
var getDefaultImprovedConfig = () => getTunedImprovedConfig("max");
var NUMBERS = "0123456789";
var MAX_PASSWORD_LENGTH = 50;
var DEFAULT_DIFFICULTY = 60;
var DEFAULT_COUNT = 10;
var DEFAULT_SEED = 1265595496;
var KING_MAIN_PEAK_ALTITUDE = 7500;
var KOTH_NEAR_ZONE_FRACTION = 0.03;
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
  if (Math.abs((x - password) / password) < KOTH_NEAR_ZONE_FRACTION) {
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
  const passwordLength = Math.min(1 + difficulty / ASSIGNMENT_PASSWORD_LENGTH_DIVISOR, ASSIGNMENT_PASSWORD_LENGTH_CAP);
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
  const min = 10 ** (assignment.passwordLength - 1);
  const max = 10 ** assignment.passwordLength - 1;
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
  const step = Math.max(1, Math.ceil((end - start) / pointCount));
  const points = [];
  for (let x = start; x <= end; x += step) {
    points.push({
      x,
      altitude: getKingOfTheHillAltitude(server, String(x)),
      nearZone: Math.abs((x - password) / password) < KOTH_NEAR_ZONE_FRACTION
    });
  }
  const last = points[points.length - 1];
  if (!last || last.x !== end) {
    points.push({
      x: end,
      altitude: getKingOfTheHillAltitude(server, String(end)),
      nearZone: Math.abs((end - password) / password) < KOTH_NEAR_ZONE_FRACTION
    });
  }
  return { points, password, min, max, start, end };
}
function generateAssignments(seed, count, difficulty) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const rng = mulberry32(seed + i * ASSIGNMENT_SEED_STRIDE >>> 0);
    rows.push({ index: i + 1, assignment: buildAssignment(difficulty, rng) });
  }
  return rows;
}
function runSolver(assignment, options = {}) {
  return runSolverImproved2(assignment, options);
}
function kingOfTheHillClusterHalfWidth(hillCount, passwordLength, clusterMargin = getDefaultImprovedConfig().clusterMargin) {
  const width = kingOfTheHillGaussianWidth(passwordLength);
  return Math.ceil((hillCount - 1) * width * KOTH_HILL_SPACING_WIDTHS * clusterMargin);
}
function runSolverImproved2(assignment, options = {}) {
  const server = toServer(assignment);
  const improvedConfig = options.improvedConfig ?? getTunedImprovedConfig(options.objective ?? "max");
  const raw = runSolverImproved(assignment, {
    improvedConfig,
    auth: (guess) => authKingOfTheHill(server, guess),
    returnSamples: options.returnSamples === true
  });
  const result = {
    guesses: raw.guesses,
    solved: raw.solved,
    bestVal: raw.bestVal,
    bestAlt: raw.bestAlt >= 0 ? raw.bestAlt : null
  };
  if (options.returnSamples && raw.samples) {
    result.probes = [...raw.samples.entries()].map(([x, alt]) => ({ x, alt }));
  }
  return result;
}
function improvedConfigFitness({
  objective = "avg",
  unsolved,
  totalGuesses = 0,
  maxGuesses = 0
}) {
  return computeImprovedFitness(objective, unsolved, totalGuesses, maxGuesses);
}
function evaluateImprovedConfig(assignments, configOverrides = {}, objective = "avg") {
  const base = objective === "avg" ? TUNED_AVG_CONFIG : TUNED_MAX_CONFIG;
  const cfg = finalizeImprovedConfig({ ...base, ...configOverrides });
  let totalGuesses = 0;
  let solved = 0;
  let maxGuesses = 0;
  let minGuesses = Infinity;
  const failed = [];
  for (let i = 0; i < assignments.length; i++) {
    const result = runSolverImproved2(assignments[i], { improvedConfig: cfg, objective });
    if (result.solved) {
      solved++;
      totalGuesses += result.guesses;
      maxGuesses = Math.max(maxGuesses, result.guesses);
      minGuesses = Math.min(minGuesses, result.guesses);
    } else {
      failed.push(i + 1);
    }
  }
  const count = assignments.length;
  const unsolved = count - solved;
  return {
    config: cfg,
    solved,
    total: count,
    unsolved,
    failed,
    totalGuesses: unsolved > 0 ? null : totalGuesses,
    avgGuesses: unsolved > 0 ? null : totalGuesses / count,
    maxGuesses: unsolved > 0 ? null : maxGuesses,
    minGuesses: unsolved > 0 ? null : minGuesses,
    fitness: improvedConfigFitness({ objective, unsolved, totalGuesses, maxGuesses })
  };
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
  KOTH_NEAR_ZONE_FRACTION,
  KOTH_PEAK_HEIGHT,
  MAX_PASSWORD_LENGTH,
  NUMBERS,
  PROFILE_DEFAULT_POINT_COUNT,
  TUNED_AVG_CONFIG,
  TUNED_MAX_CONFIG,
  assignmentNumericRange,
  authKingOfTheHill,
  buildAssignment,
  computeImprovedFitness,
  evaluateImprovedConfig,
  finalizeImprovedConfig,
  generateAssignments,
  getDefaultImprovedConfig,
  getKingOfTheHillAltitude,
  getPasswordSeeded,
  getTunedImprovedConfig,
  improvedConfigFitness,
  kingOfTheHillClusterHalfWidth,
  kingOfTheHillGaussianWidth,
  kingOfTheHillHillCount,
  mulberry32,
  runSolver,
  runSolverImproved2 as runSolverImproved,
  sampleAltitudeProfile,
  toServer
};
