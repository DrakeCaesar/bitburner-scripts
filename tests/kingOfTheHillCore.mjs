/* Auto-generated — edit tests/kingOfTheHillCore.ts; run pnpm run test:koth:bundle */
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// tests/kingOfTheHillTune.avg.json
var kingOfTheHillTune_avg_default = {
  objective: "avg",
  avgGuesses: 19.4183333333,
  maxGuesses: 59,
  totalGuesses: 11651,
  fitness: 11651059,
  benchmark: {
    seed: 1265595496,
    difficulty: 60,
    count: 600,
    selection: "sequential"
  },
  config: {
    clusterMargin: 1,
    clusterDetectAlt: 784,
    mainPeakModeAlt: 9e3,
    refinePeakCountMain: 3,
    findHillQuickRounds: 2,
    coarseMinDivisor: 60,
    coarseHillFactor: 10,
    rescanDivisor1: 115,
    rescanDivisor2: 400,
    rescanDivisor3: 651,
    refineSpanHillDivisor: 5,
    refineCoarsePasses: 7,
    refineFinePasses: 6,
    refineRadiusShrink: 5,
    refineStepShrink: 4,
    sideHillSweepWidthDivisor: 1,
    centroidMinAlt: 9428,
    centroidAltFraction: 0.86,
    centroidRefineRadius: 12,
    centroidRefinePasses: 3,
    hillClimbInitialDivisor: 104,
    hillClimbShrink: 7,
    hillClimbFlatAltDelta: 0.091,
    zoomInitialDivisor: 25,
    zoomMaxPasses: 10,
    zoomStepDivisor: 8,
    parabolicFlatNegLog10: 9,
    mainPeakDetectAlt: 7479,
    mainPeakWindowWidths: 2,
    gaussEstimateMinAlt: 220,
    gaussHeightFraction: 1,
    enableGaussianEstimate: 1,
    ternaryMaxItersCap: 68,
    ternaryWidthStop: 1,
    ternarySpanDivisor: 6,
    enableTernarySearch: 0,
    expandMaxStepDivisor: 7,
    expandStepMultiplier: 3,
    enableExpandFromBest: 0,
    centroidLogWeight: 1,
    finalMainRadius: 18,
    finalSideMinRadius: 47,
    finalSideMaxRadius: 87,
    finalSideSpanDivisor: 40,
    finalTinySpan: 6
  }
};

// tests/kingOfTheHillTune.max.json
var kingOfTheHillTune_max_default = {
  objective: "max",
  avgGuesses: 23.5816666667,
  maxGuesses: 42,
  totalGuesses: 14149,
  fitness: 42014149,
  benchmark: {
    seed: 1265595496,
    difficulty: 60,
    count: 600,
    selection: "sequential"
  },
  config: {
    clusterMargin: 1.15,
    clusterDetectAlt: 740,
    mainPeakModeAlt: 9e3,
    refinePeakCountMain: 2,
    findHillQuickRounds: 3,
    coarseMinDivisor: 60,
    coarseHillFactor: 4,
    rescanDivisor1: 190,
    rescanDivisor2: 18,
    rescanDivisor3: 97,
    refineSpanHillDivisor: 6,
    refineCoarsePasses: 3,
    refineFinePasses: 6,
    refineRadiusShrink: 5,
    refineStepShrink: 5,
    sideHillSweepWidthDivisor: 1,
    centroidMinAlt: 8451,
    centroidAltFraction: 0.87,
    centroidRefineRadius: 20,
    centroidRefinePasses: 2,
    hillClimbInitialDivisor: 84,
    hillClimbShrink: 2,
    hillClimbFlatAltDelta: 0.076,
    zoomInitialDivisor: 41,
    zoomMaxPasses: 11,
    zoomStepDivisor: 13,
    parabolicFlatNegLog10: 7,
    mainPeakDetectAlt: 8104,
    mainPeakWindowWidths: 4,
    gaussEstimateMinAlt: 161,
    gaussHeightFraction: 1,
    enableGaussianEstimate: 1,
    ternaryMaxItersCap: 20,
    ternaryWidthStop: 7,
    ternarySpanDivisor: 7,
    enableTernarySearch: 1,
    expandMaxStepDivisor: 8,
    expandStepMultiplier: 2,
    enableExpandFromBest: 1,
    centroidLogWeight: 0.9,
    finalMainRadius: 13,
    finalSideMinRadius: 20,
    finalSideMaxRadius: 133,
    finalSideSpanDivisor: 25,
    finalTinySpan: 14
  }
};

// src/dnet/solvers/kingOfTheHill/config.ts
var TUNED_MAX_CONFIG = kingOfTheHillTune_max_default.config;
var TUNED_AVG_CONFIG = kingOfTheHillTune_avg_default.config;
function getTunedBenchmark(objective = "max") {
  const raw = objective === "avg" ? kingOfTheHillTune_avg_default : kingOfTheHillTune_max_default;
  return raw.benchmark ?? null;
}
function getTunedJsonScores(objective = "max") {
  const raw = objective === "avg" ? kingOfTheHillTune_avg_default : kingOfTheHillTune_max_default;
  return {
    avgGuesses: raw.avgGuesses ?? null,
    maxGuesses: raw.maxGuesses ?? null,
    totalGuesses: raw.totalGuesses ?? null
  };
}
function finalizeImprovedConfig(raw) {
  const cfg = raw;
  if (cfg.rescanDivisors && cfg.parabolicFlatEpsilon !== void 0) {
    return cfg;
  }
  const out = { ...raw };
  out.enableGaussianEstimate = out.enableGaussianEstimate ? 1 : 0;
  out.enableTernarySearch = out.enableTernarySearch ? 1 : 0;
  out.enableExpandFromBest = out.enableExpandFromBest ? 1 : 0;
  out.parabolicFlatEpsilon = 10 ** -out.parabolicFlatNegLog10;
  out.rescanDivisors = [out.rescanDivisor1, out.rescanDivisor2, out.rescanDivisor3].filter((d) => d > 0).sort((a, b) => a - b);
  return out;
}
var TUNED_MAX_FINALIZED = finalizeImprovedConfig(TUNED_MAX_CONFIG);
var TUNED_AVG_FINALIZED = finalizeImprovedConfig(TUNED_AVG_CONFIG);
function getTunedImprovedConfig(objective = "max") {
  return objective === "avg" ? TUNED_AVG_FINALIZED : TUNED_MAX_FINALIZED;
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
  if (session.bestAlt >= cfg.mainPeakModeAlt) {
    const half = gaussWidth * cfg.mainPeakWindowWidths;
    let winMin = Math.max(fullMin, session.bestVal - half);
    let winMax = Math.min(fullMax, session.bestVal + half);
    if (session.bestVal - fullMin <= half * 2) winMin = fullMin;
    if (fullMax - session.bestVal <= half * 2) winMax = fullMax;
    return { min: winMin, max: winMax };
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
  const onMainHill = session.bestAlt >= cfg.mainPeakModeAlt;
  const maxPasses = onMainHill ? Math.min(passes, 2) : passes;
  for (let p = 0; p < maxPasses; p++) {
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
function tryParabolicPinpointMain(session, mn, mx, gaussWidth, cfg) {
  if (session.bestAlt < cfg.mainPeakModeAlt) return;
  const r = Math.max(1, Math.ceil(gaussWidth / 4));
  const c = session.bestVal;
  const x0 = Math.max(mn, c - r);
  const x2 = Math.min(mx, c + r);
  if (x0 >= x2) return;
  const y0 = session.probe(x0);
  if (session.solved) return;
  const y1 = session.samples.get(c) ?? session.probe(c);
  if (session.solved) return;
  const y2 = session.probe(x2);
  if (session.solved) return;
  const peak = parabolicPeak(x0, y0, c, y1, x2, y2, cfg);
  const px = Math.round(Math.max(mn, Math.min(mx, peak)));
  if (px !== c) session.probe(px);
}
function probeRangeAnchors(session, lo, hi) {
  session.probe(Math.round(lo));
  if (session.solved || session.exhausted) return;
  session.probe(Math.round(hi));
  if (session.solved || session.exhausted) return;
  const span = hi - lo;
  if (span < 4) return;
  for (const frac of [0.25, 0.5, 0.75]) {
    session.probe(Math.round(lo + span * frac));
    if (session.solved || session.exhausted) return;
  }
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
  const nearMainPeak = bestAlt >= cfg.mainPeakModeAlt;
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
function applyGaussianJump(session, mn, mx, gaussWidth, cfg) {
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
function tryGaussianPeakEstimate(session, mn, mx, gaussWidth, cfg) {
  if (!cfg.enableGaussianEstimate) return;
  applyGaussianJump(session, mn, mx, gaussWidth, cfg);
}
function sweep(session, start, end, step, stopAlt, cfg) {
  if (step <= 0) step = 1;
  let peakX = session.bestVal;
  let peakAlt = session.bestAlt;
  for (let x = start; x <= end; x += step) {
    session.probe(x);
    if (session.solved || session.exhausted) return;
    if (stopAlt != null && session.bestAlt >= stopAlt) return;
    if (cfg != null && peakAlt >= cfg.mainPeakDetectAlt) {
      const xi = Math.round(x);
      if (xi > peakX) {
        const alt = session.samples.get(xi);
        if (alt != null && alt < peakAlt * 0.7 && alt < cfg.clusterDetectAlt) return;
      }
    }
    if (session.bestAlt > peakAlt) {
      peakX = session.bestVal;
      peakAlt = session.bestAlt;
    }
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
function gallopFromBest(session, lo, hi, initialStep, stopAlt, mult) {
  if (initialStep <= 0) initialStep = 1;
  mult = Math.max(2, mult);
  for (const sign of [-1, 1]) {
    let dist = initialStep;
    let lastGoodDist = 0;
    while (dist <= hi - lo && !session.solved && !session.exhausted) {
      const x = session.bestVal + sign * dist;
      if (x < lo || x > hi) break;
      const before = session.bestAlt;
      session.probe(x);
      if (session.solved || session.exhausted) return;
      if (session.bestAlt >= stopAlt) return;
      if (session.bestAlt > before) {
        lastGoodDist = dist;
        dist *= mult;
        continue;
      }
      if (lastGoodDist > 0) break;
      dist *= mult;
    }
  }
}
function tryExpandFromBest(session, mn, mx, gaussWidth, stopAlt, cfg) {
  if (!cfg.enableExpandFromBest) return;
  let step = Math.max(1, ceilDiv(gaussWidth, cfg.expandMaxStepDivisor));
  const maxStep = Math.max(step, ceilDiv(mx - mn, Math.max(cfg.coarseMinDivisor, 8)));
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
    if (!improved && step >= gaussWidth) break;
    step = Math.max(1, step * mult);
  }
}
function refinePeakCount(session, hillCount, cfg) {
  if (session.bestAlt >= cfg.mainPeakModeAlt) return cfg.refinePeakCountMain;
  return hillCount;
}
function probeSparseFractions(session, lo, hi, count) {
  const span = hi - lo;
  if (span <= 0 || count <= 1) return;
  for (let i = 1; i < count; i++) {
    session.probe(lo + Math.floor(span * i / count));
    if (session.solved || session.exhausted) return;
  }
}
function locateHill(session, fullMin, fullMax, hillCount, passwordLength, gaussWidth, cfg) {
  let lo = fullMin;
  let hi = fullMax;
  const span = hi - lo;
  if (span <= 0) return;
  const sparseCount = Math.max(4, cfg.findHillQuickRounds * 4);
  probeSparseFractions(session, lo, hi, sparseCount);
  if (session.solved || session.exhausted || session.bestAlt >= cfg.mainPeakModeAlt) return;
  const coarseStep = Math.max(1, ceilDiv(span, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  const gallopStep = Math.max(coarseStep, gaussWidth);
  const mult = Math.max(2, cfg.expandStepMultiplier);
  const stopAlt = cfg.mainPeakModeAlt;
  for (let pass = 0; pass < Math.max(1, cfg.findHillQuickRounds) && !session.solved && !session.exhausted; pass++) {
    if (session.bestAlt >= stopAlt) return;
    gallopFromBest(session, lo, hi, gallopStep, stopAlt, mult);
    if (session.solved || session.exhausted || session.bestAlt >= stopAlt) return;
    if (session.bestAlt >= cfg.clusterDetectAlt) {
      applyGaussianJump(session, lo, hi, gaussWidth, cfg);
      if (session.solved || session.exhausted || session.bestAlt >= stopAlt) return;
    }
    if (session.bestAlt >= cfg.clusterDetectAlt) {
      const win = clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg);
      lo = win.min;
      hi = win.max;
    } else if (session.bestAlt > 0) {
      const half = Math.max(gaussWidth * 2, coarseStep * 2);
      lo = Math.max(fullMin, session.bestVal - half);
      hi = Math.min(fullMax, session.bestVal + half);
    }
  }
  if (!session.solved && !session.exhausted && session.bestAlt < cfg.mainPeakModeAlt) {
    sweep(session, lo, hi, coarseStep, stopAlt, cfg);
  }
}
function seekHigherPeakInCluster(session, fullMin, fullMax, hillCount, passwordLength, gaussWidth, cfg) {
  if (session.solved || session.exhausted) return;
  if (session.bestAlt >= cfg.mainPeakModeAlt) return;
  if (session.bestAlt < cfg.clusterDetectAlt) return;
  const win = clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg);
  const span = win.max - win.min;
  const step = Math.max(1, ceilDiv(span, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  sweep(session, win.min, win.max, step, cfg.mainPeakModeAlt, cfg);
  if (session.solved || session.exhausted) return;
  applyGaussianJump(session, win.min, win.max, gaussWidth, cfg);
  if (session.solved) return;
  const peaks = findLocalPeaks(sortedSamples(session));
  const refineRadius = Math.max(step, gaussWidth);
  refinePeakCandidates(session, win.min, win.max, peaks, refineRadius, hillCount, cfg);
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
  probeRangeAnchors(session, min, max);
  if (session.solved) return finish();
  locateHill(session, min, max, hillCount, passwordLength, gaussWidth, cfg);
  if (!session.solved && session.bestAlt >= cfg.clusterDetectAlt) {
    tryGaussianPeakEstimate(session, min, max, gaussWidth, cfg);
  }
  if (!session.solved && session.bestAlt < cfg.mainPeakModeAlt && cfg.enableTernarySearch) {
    const win = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
    const ternaryIters = Math.min(
      cfg.ternaryMaxItersCap,
      ceilDiv(win.max - win.min, Math.max(1, cfg.ternarySpanDivisor))
    );
    tryTernaryPeakSearch(session, win.min, win.max, ternaryIters, cfg.ternaryWidthStop);
  }
  if (session.solved) return finish();
  let search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
  let searchSpan = search.max - search.min;
  let coarseStep = Math.max(1, ceilDiv(searchSpan, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  for (const divisor of cfg.rescanDivisors) {
    if (session.bestAlt >= cfg.centroidMinAlt) break;
    if (session.bestAlt >= cfg.mainPeakModeAlt) break;
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
    searchSpan = search.max - search.min;
    sweep(session, search.min, search.max, Math.max(1, ceilDiv(searchSpan, divisor)), cfg.mainPeakModeAlt, cfg);
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
  if (session.bestAlt < cfg.mainPeakModeAlt) {
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
    tryExpandFromBest(session, search.min, search.max, gaussWidth, cfg.mainPeakModeAlt, cfg);
    if (session.solved) return finish();
    applyGaussianJump(session, search.min, search.max, gaussWidth, cfg);
    if (session.solved) return finish();
    sweep(session, search.min, search.max, Math.max(1, ceilDiv(gaussWidth, cfg.sideHillSweepWidthDivisor)), cfg.mainPeakModeAlt);
    if (session.solved) return finish();
    const peaks = findLocalPeaks(sortedSamples(session));
    const refineRadius = Math.max(1, gaussWidth);
    refinePeakCandidates(session, search.min, search.max, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg);
    if (session.solved) return finish();
  }
  if (!session.solved && session.bestAlt >= cfg.clusterDetectAlt && session.bestAlt < cfg.mainPeakModeAlt) {
    seekHigherPeakInCluster(session, min, max, hillCount, passwordLength, gaussWidth, cfg);
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
  if (!session.solved && session.bestAlt >= cfg.mainPeakModeAlt) {
    const climbWindow = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg);
    tryParabolicPinpointMain(session, climbWindow.min, climbWindow.max, gaussWidth, cfg);
    if (!session.solved) tryFinalCandidates(session, min, max, cfg);
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
    if (!session.solved && session.bestAlt < cfg.mainPeakModeAlt) {
      tryZoomFinals(session, climbWindow.min, climbWindow.max, min, max, cfg);
    }
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
  const nearLo = Math.max(min, Math.ceil(password * (1 - KOTH_NEAR_ZONE_FRACTION)));
  const nearHi = Math.min(max, Math.floor(password * (1 + KOTH_NEAR_ZONE_FRACTION)));
  const step = Math.max(1, Math.ceil((end - start) / pointCount));
  const nearStep = Math.max(1, Math.ceil(kingOfTheHillGaussianWidth(assignment.passwordLength) / 12));
  const pointByX = /* @__PURE__ */ new Map();
  function addPoint(x) {
    const xi = Math.round(x);
    if (xi < min || xi > max) return;
    pointByX.set(xi, {
      x: xi,
      altitude: getKingOfTheHillAltitude(server, String(xi)),
      nearZone: Math.abs((xi - password) / password) < KOTH_NEAR_ZONE_FRACTION
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
function runTunedBenchmarkAssignments(objective = "max") {
  const benchmark = getTunedBenchmark(objective);
  if (benchmark == null) return null;
  return generateAssignments(benchmark.seed, benchmark.count, benchmark.difficulty);
}
function verifyTunedConfigBenchmark(objective = "max") {
  const benchmark = getTunedBenchmark(objective);
  const jsonScores = getTunedJsonScores(objective);
  const cfg = getTunedImprovedConfig(objective);
  const result = {
    ok: false,
    objective,
    benchmark,
    checked: 0,
    unsolved: 0,
    jsAvgGuesses: null,
    jsMaxGuesses: null,
    jsTotalGuesses: null,
    jsonAvgGuesses: jsonScores.avgGuesses,
    jsonMaxGuesses: jsonScores.maxGuesses,
    jsonTotalGuesses: jsonScores.totalGuesses
  };
  if (benchmark == null) return result;
  const rows = generateAssignments(benchmark.seed, benchmark.count, benchmark.difficulty);
  let totalGuesses = 0;
  let maxGuesses = 0;
  let solved = 0;
  for (const { assignment } of rows) {
    result.checked++;
    const run = runSolverImproved2(assignment, { improvedConfig: cfg, objective });
    if (run.solved) {
      solved++;
      totalGuesses += run.guesses;
      maxGuesses = Math.max(maxGuesses, run.guesses);
    }
  }
  result.unsolved = result.checked - solved;
  if (solved === result.checked) {
    result.jsAvgGuesses = totalGuesses / solved;
    result.jsMaxGuesses = maxGuesses;
    result.jsTotalGuesses = totalGuesses;
  }
  const sameNumber = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-6;
  result.ok = result.unsolved === 0 && sameNumber(result.jsAvgGuesses, result.jsonAvgGuesses) && result.jsMaxGuesses === result.jsonMaxGuesses && result.jsTotalGuesses === result.jsonTotalGuesses;
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
  generateAssignmentAt,
  generateAssignments,
  getDefaultImprovedConfig,
  getKingOfTheHillAltitude,
  getPasswordSeeded,
  getTunedBenchmark,
  getTunedImprovedConfig,
  getTunedJsonScores,
  improvedConfigFitness,
  kingOfTheHillClusterHalfWidth,
  kingOfTheHillGaussianWidth,
  kingOfTheHillHillCount,
  mulberry32,
  runSolver,
  runSolverImproved2 as runSolverImproved,
  runTunedBenchmarkAssignments,
  sampleAltitudeProfile,
  toServer,
  verifyTunedConfigBenchmark
};
