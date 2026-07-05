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
    const int64_t xi = x;
    if (xi < min || xi > max) return {0.0, false, false};
    const auto it = samples.find(xi);
    if (it != samples.end()) return {it->second, true, true};
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

  void sweep(int64_t start, int64_t end, int64_t step, double stopAlt, bool hasStop) {
    if (step <= 0) step = 1;
    for (int64_t x = start; x <= end; x += step) {
      probe(x);
      if (solved) return;
      if (hasStop && bestAlt >= stopAlt) return;
    }
    if (end >= start && end <= max && samples.find(end) == samples.end()) {
      probe(end);
      if (solved) return;
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
  if (session.bestAlt >= KING_MAIN_PEAK_ALTITUDE) {
    const int64_t half = gaussWidth * KOTH_HILL_SPACING_WIDTHS;
    return {std::max(fullMin, session.bestVal - half), std::min(fullMax, session.bestVal + half)};
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

int64_t refinePeak(ProbeSession& session, int64_t mn, int64_t mx, int64_t center, int64_t initialRadius, int passes,
                   const ImprovedConfig& cfg) {
  int64_t c = center;
  int64_t r = std::max<int64_t>(1, initialRadius);
  for (int p = 0; p < passes; ++p) {
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

std::vector<int64_t> buildFinals(int64_t mn, int64_t mx, int64_t bestVal, double bestAlt) {
  const int64_t span = mx - mn;
  std::vector<int64_t> out;
  if (span <= LEGACY_FINALS_TINY_SPAN) {
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
  const bool nearMainPeak = bestAlt >= KING_MAIN_PEAK_ALTITUDE;
  const int64_t maxRadius = nearMainPeak ? LEGACY_FINAL_MAIN_RADIUS
                                         : std::min<int64_t>(LEGACY_FINAL_SIDE_MAX_RADIUS,
                                                             std::max<int64_t>(LEGACY_FINAL_SIDE_MIN_RADIUS,
                                                                               ceilDiv(span, LEGACY_FINAL_SIDE_SPAN_DIVISOR)));
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

void tryFinalCandidates(ProbeSession& session, int64_t mn, int64_t mx) {
  for (const int64_t c : buildFinals(mn, mx, session.bestVal, session.bestAlt)) {
    session.probe(c);
    if (session.solved) return;
  }
}

int refinePeakCount(const ProbeSession& session, int hillCount, const ImprovedConfig& cfg) {
  if (session.bestAlt >= cfg.mainPeakModeAlt) return cfg.refinePeakCountMain;
  return hillCount;
}

void findHillBySubdivision(ProbeSession& session, int64_t lo, int64_t hi, int quickRounds, const ImprovedConfig& cfg) {
  int64_t step = hi - lo;
  for (int round = 0; round < quickRounds && !session.solved; ++round) {
    const int64_t nextStep = std::max<int64_t>(1, ceilDiv(step, 2));
    if (nextStep >= step) break;
    step = nextStep;
    for (int64_t x = lo + step; x < hi; x += step) {
      session.probe(static_cast<int64_t>(std::llround(static_cast<double>(x))));
      if (session.solved) return;
    }
    if (session.bestAlt >= cfg.mainPeakModeAlt) return;
  }
}

void findHillLinearFallback(ProbeSession& session, int64_t lo, int64_t hi, int hillCount, const ImprovedConfig& cfg) {
  const int64_t span = hi - lo;
  const int64_t step = std::max<int64_t>(
      1, ceilDiv(span, std::max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)));
  session.sweep(lo, hi, step, static_cast<double>(cfg.mainPeakModeAlt), true);
}

void tryHillClimbFinals(ProbeSession& session, int64_t searchMin, int64_t searchMax, int64_t gaussWidth, int64_t fullMin,
                        int64_t fullMax, const ImprovedConfig& cfg) {
  int64_t step = std::max<int64_t>(1, ceilDiv(gaussWidth, cfg.hillClimbInitialDivisor));
  int64_t x = session.bestVal;

  while (step >= 1 && !session.solved) {
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
  tryFinalCandidates(session, fullMin, fullMax);
}

void tryZoomFinals(ProbeSession& session, int64_t searchMin, int64_t searchMax, int64_t fullMin, int64_t fullMax,
                   const ImprovedConfig& cfg) {
  int64_t step = std::max<int64_t>(1, ceilDiv(searchMax - searchMin, cfg.zoomInitialDivisor));
  for (int pass = 0; pass < cfg.zoomMaxPasses && !session.solved; ++pass) {
    const int64_t lo = std::max(searchMin, session.bestVal - step);
    const int64_t hi = std::min(searchMax, session.bestVal + step);
    session.sweep(lo, hi, std::max<int64_t>(1, ceilDiv(step, cfg.zoomStepDivisor)), 0.0, false);
    if (session.solved) return;
    tryFinalCandidates(session, fullMin, fullMax);
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

  findHillBySubdivision(session, range.min, range.max, cfg.findHillQuickRounds, cfg);
  if (!session.solved && session.bestAlt < KING_MAIN_PEAK_ALTITUDE) {
    int64_t fallbackLo = range.min;
    int64_t fallbackHi = range.max;
    if (session.bestAlt >= cfg.clusterDetectAlt) {
      const Bounds win = clusterSearchWindow(range.min, range.max, session.bestVal, hillCount, assignment.passwordLength, cfg);
      fallbackLo = win.min;
      fallbackHi = win.max;
    }
    findHillLinearFallback(session, fallbackLo, fallbackHi, hillCount, cfg);
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
                  static_cast<double>(cfg.mainPeakModeAlt), true);
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

  if (session.bestAlt < KING_MAIN_PEAK_ALTITUDE) {
    search = improvedSearchWindow(range.min, range.max, session, hillCount, assignment.passwordLength, gaussWidth, cfg);
    session.sweep(search.min, search.max, std::max<int64_t>(1, ceilDiv(gaussWidth, cfg.sideHillSweepWidthDivisor)),
                  static_cast<double>(KING_MAIN_PEAK_ALTITUDE), true);
    if (session.solved) goto done;
    const std::vector<Sample> sorted = session.sortedSamples();
    std::vector<Peak> peaks = findLocalPeaks(sorted);
    const int64_t refineRadius = std::max<int64_t>(1, gaussWidth);
    refinePeakCandidates(session, search.min, search.max, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg);
    if (session.solved) goto done;
  }

  if (session.bestAlt >= cfg.centroidMinAlt) {
    search = improvedSearchWindow(range.min, range.max, session, hillCount, assignment.passwordLength, gaussWidth, cfg);
    int64_t centroid = 0;
    if (weightedCentroid(session, session.bestAlt * cfg.centroidAltFraction, &centroid)) {
      session.probe(centroid);
      if (!session.solved) {
        refinePeak(session, search.min, search.max, centroid, cfg.centroidRefineRadius, cfg.centroidRefinePasses, cfg);
      }
    }
  }

  if (!session.solved) tryFinalCandidates(session, range.min, range.max);
  if (!session.solved && session.bestAlt >= KING_MAIN_PEAK_ALTITUDE) {
    const Bounds climbWindow =
        clusterSearchWindow(range.min, range.max, session.bestVal, hillCount, assignment.passwordLength, cfg);
    tryHillClimbFinals(session, climbWindow.min, climbWindow.max, gaussWidth, range.min, range.max, cfg);
    if (!session.solved) tryZoomFinals(session, climbWindow.min, climbWindow.max, range.min, range.max, cfg);
    if (!session.solved) tryFinalCandidates(session, range.min, range.max);
  }

done:
  result.guesses = session.guesses;
  result.solved = session.solved;
  result.bestVal = session.bestVal;
  result.bestAlt = session.bestAlt;
  return result;
}

}  // namespace koth
