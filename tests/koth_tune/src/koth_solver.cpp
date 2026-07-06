#include "koth_solver.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <unordered_map>
#include <utility>
#include <vector>

namespace koth {

namespace {

struct Bounds {
  int64_t min;
  int64_t max;
};

struct Sample {
  int64_t x;
  double alt;
};

struct ProbeSession {
  Server server;
  int64_t min;
  int64_t max;
  int guesses = 0;
  bool solved = false;
  bool exhausted = false;
  int64_t bestVal = 0;
  double bestAlt = -1.0;
  std::unordered_map<int64_t, double> samples;

  ProbeSession(Server s, int64_t mn, int64_t mx) : server(std::move(s)), min(mn), max(mx), bestVal(mn) {}

  struct ProbeResult {
    double alt;
    bool cached;
    bool ok;
  };

  ProbeResult probe(int64_t x) {
    if (exhausted || solved) return {0.0, false, false};
    const int64_t xi = x;
    if (xi < min || xi > max) return {0.0, false, false};
    const auto it = samples.find(xi);
    if (it != samples.end()) return {it->second, true, true};
    if (guesses >= SOLVER_MAX_PROBES) {
      exhausted = true;
      return {0.0, false, false};
    }
    ++guesses;
    double alt = 0.0;
    if (authKingOfTheHill(server, xi, &alt)) {
      solved = true;
      return {std::numeric_limits<double>::infinity(), false, true};
    }
    samples.emplace(xi, alt);
    if (alt > bestAlt) {
      bestAlt = alt;
      bestVal = xi;
    }
    return {alt, false, true};
  }

  void sweep(int64_t start, int64_t end, int64_t step, double stopAlt, bool hasStop,
             const ImprovedConfig* flatTailCfg = nullptr) {
    if (step <= 0) step = 1;
    int64_t peakX = bestVal;
    double peakAlt = bestAlt;
    for (int64_t x = start; x <= end; x += step) {
      probe(x);
      if (solved || exhausted) return;
      if (hasStop && bestAlt >= stopAlt) return;
      if (flatTailCfg != nullptr && peakAlt >= flatTailCfg->mainPeakDetectAlt) {
        const int64_t xi = x;
        const auto it = samples.find(xi);
        if (it != samples.end() && xi > peakX && it->second < peakAlt * 0.7 &&
            it->second < flatTailCfg->clusterDetectAlt) {
          return;
        }
      }
      if (bestAlt > peakAlt) {
        peakX = bestVal;
        peakAlt = bestAlt;
      }
    }
    if (end >= start && end <= max && samples.find(end) == samples.end()) {
      probe(end);
      if (solved || exhausted) return;
      if (hasStop && bestAlt >= stopAlt) return;
    }
  }

  std::vector<Sample> sortedSamples() const {
    std::vector<Sample> out;
    out.reserve(samples.size());
    for (const auto& kv : samples) out.push_back({kv.first, kv.second});
    std::sort(out.begin(), out.end(), [](const Sample& a, const Sample& b) { return a.x < b.x; });
    return out;
  }
};

int64_t clusterHalfWidth(int hillCount, int passwordLength, double clusterMargin) {
  const int64_t width = kingOfTheHillGaussianWidth(passwordLength);
  return static_cast<int64_t>(std::ceil((hillCount - 1) * width * KOTH_HILL_SPACING_WIDTHS * clusterMargin));
}

Bounds clusterSearchWindow(int64_t fullMin, int64_t fullMax, int64_t center, int hillCount, int passwordLength,
                           const ImprovedConfig& cfg) {
  const int64_t half = clusterHalfWidth(hillCount, passwordLength, cfg.clusterMargin);
  return {std::max(fullMin, center - half), std::min(fullMax, center + half)};
}

Bounds improvedSearchWindow(int64_t fullMin, int64_t fullMax, const ProbeSession& session, int hillCount,
                            int passwordLength, int64_t gaussWidth, const ImprovedConfig& cfg) {
  if (session.bestAlt >= cfg.mainPeakModeAlt) {
    const int64_t half = gaussWidth * cfg.mainPeakWindowWidths;
    int64_t winMin = std::max(fullMin, session.bestVal - half);
    int64_t winMax = std::min(fullMax, session.bestVal + half);
    if (session.bestVal - fullMin <= half * 2) winMin = fullMin;
    if (fullMax - session.bestVal <= half * 2) winMax = fullMax;
    return {winMin, winMax};
  }
  if (session.bestAlt > cfg.clusterDetectAlt) {
    return clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg);
  }
  return {fullMin, fullMax};
}

double parabolicPeak(int64_t x0, double y0, int64_t x1, double y1, int64_t x2, double y2, const ImprovedConfig& cfg) {
  const double denom = y0 - 2.0 * y1 + y2;
  if (!std::isfinite(denom) || std::abs(denom) < cfg.parabolicFlatEpsilon) return static_cast<double>(x1);
  return static_cast<double>(x1) + ((static_cast<double>(x1 - x0) * (y0 - y2)) / (2.0 * denom));
}

struct Peak {
  int64_t x;
  double alt;
};

std::vector<Peak> findLocalPeaks(const std::vector<Sample>& sorted) {
  std::vector<Peak> peaks;
  if (sorted.empty()) return peaks;
  for (size_t i = 1; i + 1 < sorted.size(); ++i) {
    if (sorted[i].alt >= sorted[i - 1].alt && sorted[i].alt > sorted[i + 1].alt) {
      peaks.push_back({sorted[i].x, sorted[i].alt});
    }
  }
  Peak best{sorted[0].x, sorted[0].alt};
  for (const auto& row : sorted) {
    if (row.alt > best.alt) best = {row.x, row.alt};
  }
  peaks.push_back(best);
  std::sort(peaks.begin(), peaks.end(), [](const Peak& a, const Peak& b) { return a.alt > b.alt; });
  std::vector<Peak> unique;
  for (const auto& p : peaks) {
    if (std::any_of(unique.begin(), unique.end(), [&](const Peak& u) { return u.x == p.x; })) continue;
    unique.push_back(p);
  }
  return unique;
}

bool refinePeakCandidates(ProbeSession& session, int64_t searchMin, int64_t searchMax, const std::vector<Peak>& peaks,
                          int64_t refineRadius, int count, const ImprovedConfig& cfg);

int64_t refinePeak(ProbeSession& session, int64_t mn, int64_t mx, int64_t center, int64_t initialRadius, int passes,
                   const ImprovedConfig& cfg) {
  int64_t c = center;
  int64_t r = std::max<int64_t>(1, initialRadius);
  const bool onMainHill = session.bestAlt >= cfg.mainPeakModeAlt;
  const int maxPasses = onMainHill ? std::min(passes, 2) : passes;
  for (int p = 0; p < maxPasses; ++p) {
    const int64_t x0 = std::max(mn, c - r);
    const int64_t x2 = std::min(mx, c + r);
    const int64_t x1 = c;
    const double y0 = session.probe(x0).alt;
    if (session.solved) return c;
    const double y1 = session.probe(x1).alt;
    if (session.solved) return c;
    const double y2 = session.probe(x2).alt;
    if (session.solved) return c;
    const double peak = parabolicPeak(x0, y0, x1, y1, x2, y2, cfg);
    c = static_cast<int64_t>(std::llround(clampInt64(static_cast<int64_t>(std::llround(peak)), mn, mx)));
    r = std::max<int64_t>(1, ceilDiv(r, cfg.refineStepShrink));
  }
  return c;
}

void tryParabolicPinpointMain(ProbeSession& session, int64_t mn, int64_t mx, int64_t gaussWidth,
                              const ImprovedConfig& cfg) {
  if (session.bestAlt < cfg.mainPeakModeAlt) return;
  const int64_t r = std::max<int64_t>(1, static_cast<int64_t>(std::ceil(static_cast<double>(gaussWidth) / 4.0)));
  const int64_t c = session.bestVal;
  const int64_t x0 = std::max(mn, c - r);
  const int64_t x2 = std::min(mx, c + r);
  if (x0 >= x2) return;
  const double y0 = session.probe(x0).alt;
  if (session.solved) return;
  double y1 = 0.0;
  const auto it = session.samples.find(c);
  if (it != session.samples.end()) {
    y1 = it->second;
  } else {
    y1 = session.probe(c).alt;
  }
  if (session.solved) return;
  const double y2 = session.probe(x2).alt;
  if (session.solved) return;
  const double peak = parabolicPeak(x0, y0, c, y1, x2, y2, cfg);
  const int64_t px = static_cast<int64_t>(std::llround(clampInt64(static_cast<int64_t>(std::llround(peak)), mn, mx)));
  if (px != c) session.probe(px);
}

void probeRangeAnchors(ProbeSession& session, int64_t lo, int64_t hi) {
  session.probe(lo);
  if (session.solved || session.exhausted) return;
  session.probe(hi);
  if (session.solved || session.exhausted) return;
  const int64_t span = hi - lo;
  if (span < 4) return;
  for (const double frac : {0.25, 0.5, 0.75}) {
    session.probe(static_cast<int64_t>(std::llround(static_cast<double>(lo) + static_cast<double>(span) * frac)));
    if (session.solved || session.exhausted) return;
  }
}

bool weightedCentroid(const ProbeSession& session, double minAlt, int64_t* out) {
  double sumW = 0.0;
  double sumX = 0.0;
  for (const auto& kv : session.samples) {
    if (kv.second < minAlt) continue;
    sumW += kv.second;
    sumX += static_cast<double>(kv.first) * kv.second;
  }
  if (sumW <= 0.0) return false;
  *out = static_cast<int64_t>(std::llround(sumX / sumW));
  return true;
}

bool logWeightedCentroid(const ProbeSession& session, double minAlt, int64_t* out) {
  double sumW = 0.0;
  double sumX = 0.0;
  for (const auto& kv : session.samples) {
    if (kv.second <= minAlt) continue;
    const double w = std::log1p(kv.second - minAlt);
    sumW += w;
    sumX += static_cast<double>(kv.first) * w;
  }
  if (sumW <= 0.0) return false;
  *out = static_cast<int64_t>(std::llround(sumX / sumW));
  return true;
}

bool blendedCentroid(const ProbeSession& session, double minAlt, const ImprovedConfig& cfg, int64_t* out) {
  int64_t linear = 0;
  int64_t logc = 0;
  const bool haveLinear = weightedCentroid(session, minAlt, &linear);
  const bool haveLog = logWeightedCentroid(session, minAlt, &logc);
  if (!haveLinear && !haveLog) return false;
  const double w = cfg.centroidLogWeight;
  if (!haveLog || w <= 0.0) {
    *out = linear;
    return haveLinear;
  }
  if (!haveLinear || w >= 1.0) {
    *out = logc;
    return haveLog;
  }
  *out = static_cast<int64_t>(std::llround(static_cast<double>(linear) * (1.0 - w) + static_cast<double>(logc) * w));
  return true;
}

void applyGaussianJump(ProbeSession& session, int64_t mn, int64_t mx, int64_t gaussWidth, const ImprovedConfig& cfg) {
  if (session.bestAlt < cfg.gaussEstimateMinAlt) return;
  const double height = static_cast<double>(KOTH_PEAK_HEIGHT) * cfg.gaussHeightFraction;
  const double ratio = std::min(session.bestAlt / height, 0.999999);
  if (ratio <= 1e-12) return;
  const double offset = static_cast<double>(gaussWidth) * std::sqrt(-std::log(ratio));
  const int64_t o = std::max<int64_t>(1, static_cast<int64_t>(std::llround(offset)));
  for (const int64_t candidate : {session.bestVal - o, session.bestVal + o}) {
    if (candidate >= mn && candidate <= mx) {
      session.probe(candidate);
      if (session.solved) return;
    }
  }
}

void tryGaussianPeakEstimate(ProbeSession& session, int64_t mn, int64_t mx, int64_t gaussWidth, const ImprovedConfig& cfg) {
  if (!cfg.enableGaussianEstimate) return;
  applyGaussianJump(session, mn, mx, gaussWidth, cfg);
}

void tryTernaryPeakSearch(ProbeSession& session, int64_t lo, int64_t hi, int maxIters, int widthStop) {
  if (lo >= hi || session.solved || session.exhausted) return;
  const int64_t initialWidth = hi - lo;
  const int safeWidthStop = std::max(1, widthStop);
  const int minIters =
      static_cast<int>(std::ceil(std::log(static_cast<double>(initialWidth) / static_cast<double>(safeWidthStop)) /
                                 std::log(1.5)));
  const int itersBudget = std::min(64, std::max(maxIters, minIters));

  int iters = 0;
  while (hi - lo > safeWidthStop && iters < itersBudget && !session.solved && !session.exhausted) {
    const int64_t m1 = lo + (hi - lo) / 3;
    const int64_t m2 = hi - (hi - lo) / 3;
    const double a1 = session.probe(m1).alt;
    if (session.solved || session.exhausted) return;
    const double a2 = session.probe(m2).alt;
    if (session.solved || session.exhausted) return;
    if (a1 < a2) {
      lo = m1;
    } else {
      hi = m2;
    }
    ++iters;
  }

  const int64_t width = hi - lo;
  if (width <= TERNARY_MAX_LINEAR_SCAN) {
    for (int64_t x = lo; x <= hi && !session.solved && !session.exhausted; ++x) {
      session.probe(x);
    }
    return;
  }

  const int64_t step = std::max<int64_t>(1, ceilDiv(width, safeWidthStop));
  session.sweep(lo, hi, step, 0.0, false);
}

void gallopFromBest(ProbeSession& session, int64_t lo, int64_t hi, int64_t initialStep, double stopAlt, int mult) {
  if (initialStep <= 0) initialStep = 1;
  mult = std::max(2, mult);
  for (const int sign : {-1, 1}) {
    int64_t dist = initialStep;
    int64_t lastGoodDist = 0;
    while (dist <= hi - lo && !session.solved && !session.exhausted) {
      const int64_t x = session.bestVal + static_cast<int64_t>(sign) * dist;
      if (x < lo || x > hi) break;
      const double before = session.bestAlt;
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

void tryExpandFromBest(ProbeSession& session, int64_t mn, int64_t mx, int64_t gaussWidth, double stopAlt,
                       const ImprovedConfig& cfg) {
  if (!cfg.enableExpandFromBest) return;
  int64_t step = std::max<int64_t>(1, ceilDiv(gaussWidth, cfg.expandMaxStepDivisor));
  const int64_t maxStep = std::max(step, ceilDiv(mx - mn, std::max(cfg.coarseMinDivisor, 8)));
  const int64_t mult = std::max<int64_t>(2, cfg.expandStepMultiplier);
  while (step <= maxStep && !session.solved && !session.exhausted) {
    bool improved = false;
    for (const int sign : {-1, 1}) {
      const int64_t x = session.bestVal + static_cast<int64_t>(sign) * step;
      if (x < mn || x > mx) continue;
      const double before = session.bestAlt;
      session.probe(x);
      if (session.solved) return;
      if (session.bestAlt > before) improved = true;
      if (session.bestAlt >= stopAlt) return;
    }
    if (!improved && step >= gaussWidth) break;
    step = std::max<int64_t>(1, step * mult);
  }
}

std::vector<int64_t> buildFinals(int64_t mn, int64_t mx, int64_t bestVal, double bestAlt, const ImprovedConfig& cfg) {
  const int64_t span = mx - mn;
  std::vector<int64_t> out;
  if (span <= cfg.finalTinySpan) {
    for (int64_t d = 0; d <= span; ++d) {
      if (d == 0) {
        if (bestVal >= mn && bestVal <= mx) out.push_back(bestVal);
        continue;
      }
      for (int sign : {-1, 1}) {
        const int64_t c = bestVal + sign * d;
        if (c >= mn && c <= mx) out.push_back(c);
      }
    }
    return out;
  }
  const bool nearMainPeak = bestAlt >= cfg.mainPeakModeAlt;
  const int64_t maxRadius = nearMainPeak ? cfg.finalMainRadius
                                         : std::min<int64_t>(cfg.finalSideMaxRadius,
                                                             std::max<int64_t>(cfg.finalSideMinRadius,
                                                                               ceilDiv(span, cfg.finalSideSpanDivisor)));
  for (int64_t d = 0; d <= maxRadius; ++d) {
    if (d == 0) {
      if (bestVal >= mn && bestVal <= mx) out.push_back(bestVal);
      continue;
    }
    for (int sign : {-1, 1}) {
      const int64_t c = bestVal + sign * d;
      if (c >= mn && c <= mx) out.push_back(c);
    }
  }
  return out;
}

void tryFinalCandidates(ProbeSession& session, int64_t mn, int64_t mx, const ImprovedConfig& cfg) {
  for (const int64_t c : buildFinals(mn, mx, session.bestVal, session.bestAlt, cfg)) {
    session.probe(c);
    if (session.solved) return;
  }
}

int refinePeakCount(const ProbeSession& session, int hillCount, const ImprovedConfig& cfg) {
  if (session.bestAlt >= cfg.mainPeakModeAlt) return cfg.refinePeakCountMain;
  return hillCount;
}

void probeSparseFractions(ProbeSession& session, int64_t lo, int64_t hi, int count) {
  const int64_t span = hi - lo;
  if (span <= 0 || count <= 1) return;
  for (int i = 1; i < count; ++i) {
    session.probe(lo + (span * static_cast<int64_t>(i)) / static_cast<int64_t>(count));
    if (session.solved || session.exhausted) return;
  }
}

void locateHill(ProbeSession& session, int64_t fullMin, int64_t fullMax, int hillCount, int passwordLength,
                int64_t gaussWidth, const ImprovedConfig& cfg) {
  int64_t lo = fullMin;
  int64_t hi = fullMax;
  const int64_t span = hi - lo;
  if (span <= 0) return;

  const int sparseCount = std::max(4, cfg.findHillQuickRounds * 4);
  probeSparseFractions(session, lo, hi, sparseCount);
  if (session.solved || session.exhausted || session.bestAlt >= cfg.mainPeakModeAlt) return;

  const int64_t coarseStep =
      std::max<int64_t>(1, ceilDiv(span, std::max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  const int64_t gallopStep = std::max(coarseStep, gaussWidth);
  const int mult = std::max(2, cfg.expandStepMultiplier);
  const double stopAlt = static_cast<double>(cfg.mainPeakModeAlt);

  for (int pass = 0; pass < std::max(1, cfg.findHillQuickRounds) && !session.solved && !session.exhausted; ++pass) {
    if (session.bestAlt >= stopAlt) return;

    gallopFromBest(session, lo, hi, gallopStep, stopAlt, mult);
    if (session.solved || session.exhausted || session.bestAlt >= stopAlt) return;

    if (session.bestAlt >= cfg.clusterDetectAlt) {
      applyGaussianJump(session, lo, hi, gaussWidth, cfg);
      if (session.solved || session.exhausted || session.bestAlt >= stopAlt) return;
    }

    if (session.bestAlt >= cfg.clusterDetectAlt) {
      const Bounds win = clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg);
      lo = win.min;
      hi = win.max;
    } else if (session.bestAlt > 0.0) {
      const int64_t half = std::max(gaussWidth * 2, coarseStep * 2);
      lo = std::max(fullMin, session.bestVal - half);
      hi = std::min(fullMax, session.bestVal + half);
    }
  }

  if (!session.solved && !session.exhausted && session.bestAlt < cfg.mainPeakModeAlt) {
    session.sweep(lo, hi, coarseStep, stopAlt, true, &cfg);
  }
}

void seekHigherPeakInCluster(ProbeSession& session, int64_t fullMin, int64_t fullMax, int hillCount,
                             int passwordLength, int64_t gaussWidth, const ImprovedConfig& cfg) {
  if (session.solved || session.exhausted) return;
  if (session.bestAlt >= cfg.mainPeakModeAlt) return;
  if (session.bestAlt < cfg.clusterDetectAlt) return;

  const Bounds win = clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg);
  const int64_t span = win.max - win.min;
  const int64_t step =
      std::max<int64_t>(1, ceilDiv(span, std::max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  session.sweep(win.min, win.max, step, static_cast<double>(cfg.mainPeakModeAlt), true, &cfg);
  if (session.solved || session.exhausted) return;

  applyGaussianJump(session, win.min, win.max, gaussWidth, cfg);
  if (session.solved) return;

  const std::vector<Sample> sorted = session.sortedSamples();
  std::vector<Peak> peaks = findLocalPeaks(sorted);
  const int64_t refineRadius = std::max(step, gaussWidth);
  refinePeakCandidates(session, win.min, win.max, peaks, refineRadius, hillCount, cfg);
}

void tryHillClimbFinals(ProbeSession& session, int64_t searchMin, int64_t searchMax, int64_t gaussWidth, int64_t fullMin,
                        int64_t fullMax, const ImprovedConfig& cfg) {
  int64_t step = std::max<int64_t>(1, ceilDiv(gaussWidth, cfg.hillClimbInitialDivisor));
  int64_t x = session.bestVal;

  while (step >= 1 && !session.solved && !session.exhausted) {
    const int64_t left = std::max(searchMin, x - step);
    const int64_t right = std::min(searchMax, x + step);
    const double yL = session.probe(left).alt;
    if (session.solved) return;
    const double yC = (left == right) ? yL : session.probe(x).alt;
    if (session.solved) return;
    const double yR = session.probe(right).alt;
    if (session.solved) return;

    if (yL > yC) x = left;
    else if (yR > yC) x = right;

    const bool flat = std::abs(yL - yC) <= cfg.hillClimbFlatAltDelta && std::abs(yR - yC) <= cfg.hillClimbFlatAltDelta;
    if (flat || (yC >= yL && yC >= yR)) {
      const int64_t nextStep = std::max<int64_t>(1, ceilDiv(step, cfg.hillClimbShrink));
      if (nextStep >= step) break;
      step = nextStep;
    }
  }
  tryFinalCandidates(session, fullMin, fullMax, cfg);
}

void tryZoomFinals(ProbeSession& session, int64_t searchMin, int64_t searchMax, int64_t fullMin, int64_t fullMax,
                   const ImprovedConfig& cfg) {
  int64_t step = std::max<int64_t>(1, ceilDiv(searchMax - searchMin, cfg.zoomInitialDivisor));
  for (int pass = 0; pass < cfg.zoomMaxPasses && !session.solved && !session.exhausted; ++pass) {
    const int64_t lo = std::max(searchMin, session.bestVal - step);
    const int64_t hi = std::min(searchMax, session.bestVal + step);
    session.sweep(lo, hi, std::max<int64_t>(1, ceilDiv(step, cfg.zoomStepDivisor)), 0.0, false);
    if (session.solved) return;
    tryFinalCandidates(session, fullMin, fullMax, cfg);
    if (session.solved) return;
    const int64_t nextStep = std::max<int64_t>(1, ceilDiv(step, cfg.zoomStepDivisor));
    if (nextStep >= step) break;
    step = nextStep;
  }
}

bool refinePeakCandidates(ProbeSession& session, int64_t searchMin, int64_t searchMax, const std::vector<Peak>& peaks,
                          int64_t refineRadius, int count, const ImprovedConfig& cfg) {
  const int n = std::min(count, static_cast<int>(peaks.size()));
  for (int i = 0; i < n; ++i) {
    const int64_t refined =
        refinePeak(session, searchMin, searchMax, peaks[static_cast<size_t>(i)].x, refineRadius, cfg.refineCoarsePasses, cfg);
    if (session.solved) return true;
    refinePeak(session, searchMin, searchMax, refined, std::max<int64_t>(1, ceilDiv(refineRadius, cfg.refineRadiusShrink)),
               cfg.refineFinePasses, cfg);
    if (session.solved) return true;
  }
  return session.solved;
}

}  // namespace

SolverResult runSolverImproved(const Assignment& assignment, const ImprovedConfig& cfgIn) {
  const ImprovedConfig cfg = normalizeImprovedConfig(cfgIn);
  SolverResult result;
  const Server server = toServer(assignment);
  const NumericRange range = assignmentNumericRange(assignment);
  const int hillCount = kingOfTheHillHillCount(assignment.difficulty);
  const int64_t gaussWidth = kingOfTheHillGaussianWidth(assignment.passwordLength);
  ProbeSession session(server, range.min, range.max);

  probeRangeAnchors(session, range.min, range.max);
  if (session.solved) {
    result.guesses = session.guesses;
    result.solved = true;
    result.bestVal = session.bestVal;
    result.bestAlt = session.bestAlt;
    return result;
  }

  locateHill(session, range.min, range.max, hillCount, assignment.passwordLength, gaussWidth, cfg);
  if (!session.solved && session.bestAlt >= cfg.clusterDetectAlt) {
    tryGaussianPeakEstimate(session, range.min, range.max, gaussWidth, cfg);
  }
  if (!session.solved && session.bestAlt < cfg.mainPeakModeAlt && cfg.enableTernarySearch) {
    const Bounds win =
        improvedSearchWindow(range.min, range.max, session, hillCount, assignment.passwordLength, gaussWidth, cfg);
    const int ternaryIters = static_cast<int>(std::min<int64_t>(
        cfg.ternaryMaxItersCap, ceilDiv(win.max - win.min, std::max(1, cfg.ternarySpanDivisor))));
    tryTernaryPeakSearch(session, win.min, win.max, ternaryIters, cfg.ternaryWidthStop);
  }
  if (session.solved) {
    result.guesses = session.guesses;
    result.solved = true;
    result.bestVal = session.bestVal;
    result.bestAlt = session.bestAlt;
    return result;
  }

  Bounds search = improvedSearchWindow(range.min, range.max, session, hillCount, assignment.passwordLength, gaussWidth, cfg);
  int64_t searchSpan = search.max - search.min;
  int64_t coarseStep = std::max<int64_t>(1, ceilDiv(searchSpan, std::max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));

  for (int ri = 0; ri < cfg.rescanDivisorCount; ++ri) {
    if (session.bestAlt >= cfg.centroidMinAlt) break;
    if (session.bestAlt >= cfg.mainPeakModeAlt) break;
    search = improvedSearchWindow(range.min, range.max, session, hillCount, assignment.passwordLength, gaussWidth, cfg);
    searchSpan = search.max - search.min;
    const int divisor = cfg.rescanDivisorsSorted[static_cast<size_t>(ri)];
    session.sweep(search.min, search.max, std::max<int64_t>(1, ceilDiv(searchSpan, divisor)),
                  static_cast<double>(cfg.mainPeakModeAlt), true, &cfg);
    if (session.solved) goto done;
  }

  search = improvedSearchWindow(range.min, range.max, session, hillCount, assignment.passwordLength, gaussWidth, cfg);
  searchSpan = search.max - search.min;
  coarseStep = std::max<int64_t>(1, ceilDiv(searchSpan, std::max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));

  {
    const std::vector<Sample> sorted = session.sortedSamples();
    std::vector<Peak> peaks = findLocalPeaks(sorted);
    int64_t refineRadius = std::max(coarseStep, ceilDiv(searchSpan, hillCount * cfg.refineSpanHillDivisor));
    refinePeakCandidates(session, search.min, search.max, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg);
    if (session.solved) goto done;
  }

  if (session.bestAlt < cfg.mainPeakModeAlt) {
    search = improvedSearchWindow(range.min, range.max, session, hillCount, assignment.passwordLength, gaussWidth, cfg);
    tryExpandFromBest(session, search.min, search.max, gaussWidth, static_cast<double>(cfg.mainPeakModeAlt), cfg);
    if (session.solved) goto done;
    applyGaussianJump(session, search.min, search.max, gaussWidth, cfg);
    if (session.solved) goto done;
    session.sweep(search.min, search.max, std::max<int64_t>(1, ceilDiv(gaussWidth, cfg.sideHillSweepWidthDivisor)),
                  static_cast<double>(cfg.mainPeakModeAlt), true);
    if (session.solved) goto done;
    const std::vector<Sample> sorted = session.sortedSamples();
    std::vector<Peak> peaks = findLocalPeaks(sorted);
    const int64_t refineRadius = std::max<int64_t>(1, gaussWidth);
    refinePeakCandidates(session, search.min, search.max, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg);
    if (session.solved) goto done;
  }

  if (!session.solved && session.bestAlt >= cfg.clusterDetectAlt && session.bestAlt < cfg.mainPeakModeAlt) {
    seekHigherPeakInCluster(session, range.min, range.max, hillCount, assignment.passwordLength, gaussWidth, cfg);
    if (session.solved) goto done;
  }

  if (session.bestAlt >= cfg.centroidMinAlt) {
    search = improvedSearchWindow(range.min, range.max, session, hillCount, assignment.passwordLength, gaussWidth, cfg);
    int64_t centroid = 0;
    const double centroidMin = session.bestAlt * cfg.centroidAltFraction;
    const bool haveCentroid = blendedCentroid(session, centroidMin, cfg, &centroid);
    if (haveCentroid) {
      session.probe(centroid);
      if (!session.solved) {
        refinePeak(session, search.min, search.max, centroid, cfg.centroidRefineRadius, cfg.centroidRefinePasses, cfg);
      }
    }
  }

  if (!session.solved) tryFinalCandidates(session, range.min, range.max, cfg);
  if (!session.solved && session.bestAlt >= cfg.mainPeakModeAlt) {
    const Bounds climbWindow =
        improvedSearchWindow(range.min, range.max, session, hillCount, assignment.passwordLength, gaussWidth, cfg);
    tryParabolicPinpointMain(session, climbWindow.min, climbWindow.max, gaussWidth, cfg);
    if (!session.solved) tryFinalCandidates(session, range.min, range.max, cfg);
    if (cfg.enableTernarySearch) {
      const int ternaryIters = static_cast<int>(std::min<int64_t>(
          cfg.ternaryMaxItersCap,
          ceilDiv(climbWindow.max - climbWindow.min, std::max(1, cfg.ternarySpanDivisor))));
      tryTernaryPeakSearch(session, climbWindow.min, climbWindow.max, ternaryIters, cfg.ternaryWidthStop);
    }
    if (!session.solved) tryFinalCandidates(session, range.min, range.max, cfg);
    if (!session.solved) tryGaussianPeakEstimate(session, climbWindow.min, climbWindow.max, gaussWidth, cfg);
    if (!session.solved) tryFinalCandidates(session, range.min, range.max, cfg);
    if (!session.solved) {
      tryHillClimbFinals(session, climbWindow.min, climbWindow.max, gaussWidth, range.min, range.max, cfg);
    }
    if (!session.solved && session.bestAlt < cfg.mainPeakModeAlt) {
      tryZoomFinals(session, climbWindow.min, climbWindow.max, range.min, range.max, cfg);
    }
    if (!session.solved) tryFinalCandidates(session, range.min, range.max, cfg);
  }

done:
  result.guesses = session.guesses;
  result.solved = session.solved;
  result.bestVal = session.bestVal;
  result.bestAlt = session.bestAlt;
  return result;
}

}  // namespace koth
