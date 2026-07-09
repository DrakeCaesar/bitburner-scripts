#include "koth_solver.hpp"

#include "koth_config.hpp"
#include "koth_tuning.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <optional>
#include <unordered_map>
#include <utility>
#include <vector>

namespace koth {
namespace {

constexpr double kHPeak = KOTH_PEAK_HEIGHT;
constexpr int kStepW = KOTH_HILL_SPACING_WIDTHS;
constexpr double kMainTh = kHPeak - 0.5 * KOTH_HEIGHT_OFFSET_BASE;

enum class CoarseEarlyStopMode {
  PositiveAny,
};

bool coarseScanEarlyStop(double alt, CoarseEarlyStopMode mode) {
  (void)mode;
  return alt > 0.0;
}

int64_t clampProbe(double x, int64_t lo, int64_t hi) {
  return clampInt64(static_cast<int64_t>(std::llround(x)), lo, hi);
}

class ProbeSession {
 public:
  ProbeSession(const Server& server, int64_t password, int64_t lo, int64_t hi, int cap)
      : server_(server), password_(password), lo_(lo), hi_(hi), cap_(cap), bestX_(lo), bestAlt_(-1e18) {}

  bool solved() const { return solved_; }
  int guesses() const { return guesses_; }
  int64_t bestX() const { return bestX_; }
  double bestAlt() const { return bestAlt_; }

  std::optional<double> probe(int64_t x) {
    const int64_t xi = clampProbe(static_cast<double>(x), lo_, hi_);
    if (xi < lo_ || xi > hi_) return std::nullopt;
    const auto it = samples_.find(xi);
    if (it != samples_.end()) return it->second;
    if (guesses_ >= cap_) return std::nullopt;
    ++guesses_;
    if (xi == password_) {
      solved_ = true;
      samples_[xi] = std::numeric_limits<double>::infinity();
      bestX_ = xi;
      bestAlt_ = std::numeric_limits<double>::infinity();
      return samples_[xi];
    }
    const double a = getKingOfTheHillAltitude(server_, xi);
    samples_[xi] = a;
    if (a > bestAlt_) {
      bestAlt_ = a;
      bestX_ = xi;
    }
    return a;
  }

  std::optional<double> sampleAt(int64_t x) const {
    const auto it = samples_.find(x);
    if (it == samples_.end()) return std::nullopt;
    return it->second;
  }

  void restoreBest(int64_t x, double a) {
    bestX_ = x;
    bestAlt_ = a;
  }

 private:
  const Server& server_;
  int64_t password_;
  int64_t lo_;
  int64_t hi_;
  int cap_;
  int guesses_ = 0;
  bool solved_ = false;
  int64_t bestX_;
  double bestAlt_;
  std::unordered_map<int64_t, double> samples_;
};

double invertCenter(double x1, double a1, double x2, double a2, int64_t w) {
  const double wd = static_cast<double>(w);
  return (x1 + x2) / 2.0 - (wd * wd) * std::log(a1 / a2) / (2.0 * (x2 - x1));
}

/**
 * Near-zone finisher: inside |x-p| < 0.03p the altitude is a PURE Gaussian
 * 10000*exp(-(x-p)^2/w^2), so a single reading pins |x-p| exactly:
 * d = w*sqrt(ln(10000/a)). Probe both candidates x+d and x-d; if the reading
 * was a near-zone reading, one of them is exactly the password.
 */
bool sqrtSnipe(ProbeSession& sess, int64_t x, double a, int64_t w, int64_t lo, int64_t hi) {
  const LadderSnipeTuning& tune = activeLadderSnipeTuning();
  // Side hills top out at ~7530 (10000 - 2600*0.95); sqrtSnipeMinAlt is a slack floor.
  if (!(a > tune.sqrtSnipeMinAlt) || !(a < kHPeak)) return false;
  const double d = static_cast<double>(w) * std::sqrt(std::log(kHPeak / a));
  if (!std::isfinite(d)) return false;
  const double nearCap = (KOTH_NEAR_ZONE_FRACTION + tune.sqrtSnipeNearZoneExtra) * static_cast<double>(x);
  if (d > nearCap) return false;
  const int64_t dd = std::max<int64_t>(1, std::llround(d));
  sess.probe(clampInt64(x + dd, lo, hi));
  if (sess.solved()) return true;
  sess.probe(clampInt64(x - dd, lo, hi));
  return sess.solved();
}

int hopK(double H) {
  return std::max(1, static_cast<int>(std::llround((kHPeak - H) / KOTH_HEIGHT_OFFSET_BASE)));
}

std::pair<int64_t, double> crest(ProbeSession& sess, int64_t xSeed, int64_t w, int64_t lo, int64_t hi) {
  int64_t x = clampProbe(static_cast<double>(xSeed), lo, hi);
  std::optional<double> aOpt = sess.sampleAt(x);
  double a = aOpt.value_or(0.0);
  if (!aOpt) {
    aOpt = sess.probe(x);
    if (sess.solved()) return {x, aOpt.value_or(std::numeric_limits<double>::infinity())};
    a = aOpt.value_or(-1e18);
  }
  const int64_t off = std::max<int64_t>(1, std::llround(0.5 * static_cast<double>(w)));
  int64_t xb = (x + off <= hi) ? x + off : x - off;
  std::optional<double> abOpt = sess.probe(xb);
  if (sess.solved()) return {xb, abOpt.value_or(std::numeric_limits<double>::infinity())};

  if (aOpt && abOpt && *aOpt > 0 && *abOpt > 0 && xb != x) {
    try {
      const double c = invertCenter(static_cast<double>(x), *aOpt, static_cast<double>(xb), *abOpt, w);
      const int64_t cx = clampProbe(c, lo, hi);
      std::optional<double> acOpt = sess.sampleAt(cx);
      if (!acOpt) {
        acOpt = sess.probe(cx);
        if (sess.solved()) return {cx, acOpt.value_or(std::numeric_limits<double>::infinity())};
      }
      auto best = std::make_pair(*aOpt, x);
      if (abOpt && *abOpt > best.first) best = {*abOpt, xb};
      if (acOpt && *acOpt > best.first) best = {*acOpt, cx};
      if (best.second != x && best.first > *aOpt * 1.02) {
        const int64_t bx = best.second;
        int64_t xb2 = bx + std::max<int64_t>(1, off / 2);
        if (xb2 > hi) xb2 = bx - std::max<int64_t>(1, off / 2);
        std::optional<double> ab2Opt = sess.probe(xb2);
        if (sess.solved()) return {xb2, ab2Opt.value_or(std::numeric_limits<double>::infinity())};
        if (ab2Opt && *ab2Opt > 0 && xb2 != bx && best.first > 0) {
          try {
            const double c2 = invertCenter(static_cast<double>(bx), best.first, static_cast<double>(xb2), *ab2Opt, w);
            const int64_t cx2 = clampProbe(c2, lo, hi);
            std::optional<double> ac2Opt = sess.probe(cx2);
            if (sess.solved()) return {cx2, ac2Opt.value_or(std::numeric_limits<double>::infinity())};
            auto best2 = best;
            if (ab2Opt && *ab2Opt > best2.first) best2 = {*ab2Opt, xb2};
            if (ac2Opt && *ac2Opt > best2.first) best2 = {*ac2Opt, cx2};
            return {best2.second, best2.first};
          } catch (...) {
          }
        }
      }
      return {best.second, best.first};
    } catch (...) {
    }
  }

  const int64_t xc = clampProbe((x - off >= lo) ? static_cast<double>(x - off) : static_cast<double>(x + 2 * off), lo, hi);
  std::optional<double> acOpt = sess.probe(xc);
  if (sess.solved()) return {xc, acOpt.value_or(std::numeric_limits<double>::infinity())};
  auto best = std::make_pair(aOpt.value_or(-1e18), x);
  if (abOpt && *abOpt > best.first) best = {*abOpt, xb};
  if (acOpt && *acOpt > best.first) best = {*acOpt, xc};
  return {best.second, best.first};
}

std::pair<int64_t, double> gallop(ProbeSession& sess, int64_t xSeed, int64_t w, int64_t lo, int64_t hi) {
  int64_t x = clampProbe(static_cast<double>(xSeed), lo, hi);
  double a = sess.sampleAt(x).value_or(-1e18);
  if (!sess.sampleAt(x)) {
    std::optional<double> probed = sess.probe(x);
    if (sess.solved()) return {x, probed.value_or(std::numeric_limits<double>::infinity())};
    if (probed) a = *probed;
  }
  const LadderSnipeTuning& tune = activeLadderSnipeTuning();
  int64_t step = std::max<int64_t>(1, std::llround(tune.gallopStepW * static_cast<double>(w)));
  int64_t stop = std::max<int64_t>(1, std::llround(tune.gallopStopW * static_cast<double>(w)));
  while (step >= stop) {
    int bd = 0;
    double ba = a;
    int64_t bx = x;
    for (const int d : {1, -1}) {
      const int64_t xn = clampProbe(static_cast<double>(x + d * step), lo, hi);
      if (xn == x) continue;
      std::optional<double> anOpt = sess.probe(xn);
      if (sess.solved()) return {xn, anOpt.value_or(std::numeric_limits<double>::infinity())};
      if (anOpt && *anOpt > ba) {
        ba = *anOpt;
        bx = xn;
        bd = d;
      }
    }
    if (bd != 0) {
      x = bx;
      a = ba;
    } else {
      step /= 2;
    }
  }
  return {x, a};
}

void pinpoint(ProbeSession& sess, int64_t seedX, int64_t w, int64_t lo, int64_t hi, int rounds, int finalRadius,
              bool snipe) {
  int64_t pc = clampProbe(static_cast<double>(seedX), lo, hi);
  if (snipe) {
    std::optional<double> aSeed = sess.sampleAt(pc);
    if (!aSeed) {
      aSeed = sess.probe(pc);
      if (sess.solved()) return;
    }
    if (aSeed && sqrtSnipe(sess, pc, *aSeed, w, lo, hi)) return;
  }
  int64_t off = std::max<int64_t>(1, std::llround(activeLadderSnipeTuning().pairProbeOffsetW * static_cast<double>(w)));
  for (int r = 0; r < rounds; ++r) {
    std::optional<double> a0Opt = sess.sampleAt(pc);
    if (!a0Opt) {
      a0Opt = sess.probe(pc);
      if (sess.solved()) return;
    }
    if (!a0Opt || *a0Opt <= 0) break;
    const int64_t x1 = (pc + off <= hi) ? pc + off : pc - off;
    std::optional<double> a1Opt = sess.probe(x1);
    if (sess.solved()) return;
    if (!a1Opt || *a1Opt <= 0 || x1 == pc) break;
    try {
      const double c = invertCenter(static_cast<double>(pc), *a0Opt, static_cast<double>(x1), *a1Opt, w);
      const int64_t nc = clampProbe(c, lo, hi);
      if (nc == pc) {
        if (off == 1) break;
        off = std::max<int64_t>(1, off / 4);
        continue;
      }
      pc = nc;
      off = std::max<int64_t>(1, std::min(off, std::llround(0.25 * static_cast<double>(w))));
    } catch (...) {
      break;
    }
  }
  sess.probe(pc);
  if (sess.solved()) return;
  for (int d = 1; d <= finalRadius; ++d) {
    for (const int sgn : {-1, 1}) {
      sess.probe(pc + sgn * d);
      if (sess.solved()) return;
    }
  }
}

void clusterSweep(ProbeSession& sess, int64_t w, int64_t lo, int64_t hi) {
  const LadderSnipeTuning& tune = activeLadderSnipeTuning();
  const int64_t center = sess.bestX();
  const int64_t reach = std::llround(tune.clusterReachW * static_cast<double>(w));
  const int64_t step = std::max<int64_t>(1, std::llround(tune.clusterStepW * static_cast<double>(w)));
  int64_t x = std::max(lo, center - reach);
  const int64_t b = std::min(hi, center + reach);
  while (x <= b && !sess.solved()) {
    sess.probe(x);
    x += step;
  }
}

void clusterSweepSmart(ProbeSession& sess, int64_t w, int64_t lo, int64_t hi) {
  const LadderSnipeTuning& tune = activeLadderSnipeTuning();
  const int64_t center = sess.bestX();
  const int64_t reach = std::llround(tune.clusterReachW * static_cast<double>(w));
  const int64_t step = std::max<int64_t>(1, std::llround(tune.clusterStepW * static_cast<double>(w)));
  const int64_t left = std::max(lo, center - reach);
  const int64_t right = std::min(hi, center + reach);

  auto march = [&](int64_t start, int64_t end, int64_t delta) {
    int drops = 0;
    double prev = sess.bestAlt();
    for (int64_t x = start; (delta > 0 ? x <= end : x >= end) && !sess.solved(); x += delta) {
      std::optional<double> aOpt = sess.probe(x);
      if (sess.solved()) return;
      if (!aOpt) continue;
      if (*aOpt + 1.0 < prev) {
        if (++drops >= 2) break;
      } else {
        drops = 0;
        prev = *aOpt;
      }
    }
  };

  if (!sess.sampleAt(center)) sess.probe(center);
  if (sess.solved()) return;
  march(center + step, right, step);
  march(center - step, left, -step);
}

void backstop(ProbeSession& sess, int64_t w, int64_t lo, int64_t hi) {
  const LadderSnipeTuning& tune = activeLadderSnipeTuning();
  const int64_t step = std::max<int64_t>(1, std::llround(0.7 * static_cast<double>(w)));
  int64_t x = lo;
  while (x <= hi && !sess.solved()) {
    sess.probe(x);
    x += step;
  }
  if (!sess.solved()) pinpoint(sess, sess.bestX(), w, lo, hi, tune.pinpointRounds, 30, false);
}

std::vector<int> spreadOrder(int m) {
  if (m <= 1) return {0};
  std::vector<int> order;
  std::vector<char> seen(static_cast<size_t>(m), 0);
  auto add = [&](int i) {
    if (i >= 0 && i < m && !seen[static_cast<size_t>(i)]) {
      seen[static_cast<size_t>(i)] = 1;
      order.push_back(i);
    }
  };
  add(m / 2);
  add(0);
  add(m - 1);
  std::vector<std::pair<int, int>> stack = {{0, m - 1}};
  while (static_cast<int>(order.size()) < m && !stack.empty()) {
    std::vector<std::pair<int, int>> nxt;
    for (const auto& seg : stack) {
      const int mid = (seg.first + seg.second) / 2;
      add(mid);
      if (mid - seg.first > 1) nxt.emplace_back(seg.first, mid);
      if (seg.second - mid > 1) nxt.emplace_back(mid, seg.second);
    }
    stack = std::move(nxt);
  }
  for (int i = 0; i < m; ++i) add(i);
  return order;
}

std::vector<int64_t> scanGrid(int64_t lo, int64_t hi, int64_t w, int hc) {
  const int64_t span = hi - lo;
  if (span <= 0) return {lo};
  int64_t spacing;
  if (hc > 1) {
    spacing = std::max<int64_t>(1, static_cast<int64_t>((hc - 1) * 3 * w * 0.9 * 0.98));
  } else {
    spacing = std::max<int64_t>(1, 3 * w);
  }
  const int64_t m = std::max<int64_t>(1, (span + spacing - 1) / spacing);
  std::vector<int64_t> xs;
  xs.reserve(static_cast<size_t>(m + 1));
  for (int64_t i = 0; i <= m; ++i) {
    xs.push_back(lo + std::llround(static_cast<double>(span) * static_cast<double>(i) / static_cast<double>(m)));
  }
  std::sort(xs.begin(), xs.end());
  xs.erase(std::unique(xs.begin(), xs.end()), xs.end());
  return xs;
}

bool walkAndPinpoint(ProbeSession& sess, int64_t w, int64_t lo, int64_t hi, bool snipe = false) {
  const int64_t step = kStepW * w;
  auto [x, a] = crest(sess, sess.bestX(), w, lo, hi);
  if (sess.solved()) return true;
  std::optional<int> lastDir;
  if (x <= lo) lastDir = 1;
  else if (x >= hi) lastDir = -1;

  for (int hop = 0; hop < 10; ++hop) {
    if (a >= kMainTh) break;
    const int k = hopK(a);
    std::vector<int> order;
    if (!lastDir) {
      const int64_t xR = clampProbe(static_cast<double>(x + k * step), lo, hi);
      const int64_t xL = clampProbe(static_cast<double>(x - k * step), lo, hi);
      std::optional<double> aROpt = sess.probe(xR);
      if (sess.solved()) return true;
      std::optional<double> aLOpt = sess.probe(xL);
      if (sess.solved()) return true;
      const double aR = aROpt.value_or(-1e18);
      const double aL = aLOpt.value_or(-1e18);
      order = (aR >= aL) ? std::vector<int>{1, -1} : std::vector<int>{-1, 1};
    } else {
      order = {*lastDir, -*lastDir};
    }

    std::optional<std::tuple<double, int64_t, int>> best;
    for (const int d : order) {
      const std::vector<int> ks = lastDir ? std::vector<int>{k, k - 1, k + 1, 1} : std::vector<int>{k};
      for (const int kk : ks) {
        if (kk < 1) continue;
        auto [nx, na] = crest(sess, x + d * kk * step, w, lo, hi);
        if (sess.solved()) return true;
        if (na > a + 1.0) {
          best = std::make_tuple(na, nx, d);
          break;
        }
      }
      if (best) break;
    }
    if (!best) break;
    a = std::get<0>(*best);
    x = std::get<1>(*best);
    lastDir = std::get<2>(*best);
  }

  pinpoint(sess, sess.bestX(), w, lo, hi, activeLadderSnipeTuning().pinpointRounds,
           activeLadderSnipeTuning().pinpointFinalRadius, snipe);
  return a >= kMainTh;
}

/**
 * Model-based climb exploiting the generator structure:
 *  - hills sit at p + (i-pwIdx)*3w*u (u in [0.9,1.1]), heights 10000 - k*2600*v (v in [0.95,1.05])
 *  - two same-sign probes 0.5w apart invert the dominating hill's center exactly (log-space),
 *    even for denormal-tiny far-tail readings (signal reaches ~26 widths in doubles)
 *  - probing that center reads its height, whose ladder position gives the rank k
 *    (number of hills to the main peak), including negative-height fringe hills
 *  - jump k*3w toward the taller side and repeat; k shrinks each round until pinpoint
 */
bool ladderTraceEnabled() {
#ifdef _MSC_VER
#pragma warning(push)
#pragma warning(disable : 4996)
#endif
  static const bool enabled = std::getenv("KOTH_LADDER_TRACE") != nullptr;
#ifdef _MSC_VER
#pragma warning(pop)
#endif
  return enabled;
}

void ladderClimb(ProbeSession& sess, int64_t x0, double a0, int64_t w, int hc, int64_t lo, int64_t hi, bool snipe) {
  const LadderSnipeTuning& tune = activeLadderSnipeTuning();
  const double wd = static_cast<double>(w);
  int prevK = 1 << 20;
  int postJumpCapK = 1 << 20;
  std::vector<int64_t> seenCenters;
  for (int iter = 0; iter < tune.ladderMaxIters && !sess.solved(); ++iter) {
    if (ladderTraceEnabled()) {
      std::fprintf(stderr, "[ladder] iter=%d x0=%lld a0=%.6g guesses=%d\n", iter, static_cast<long long>(x0), a0,
                   sess.guesses());
    }
    if (a0 == 0.0 || !std::isfinite(a0)) return;
    // 0.25w keeps both pair samples inside the single-hill-dominated region even
    // on a flank ~1.5w out; 0.5w pairs get contaminated by the neighbor hill.
    const int64_t off = std::max<int64_t>(1, std::llround(tune.pairProbeOffsetW * wd));
    int64_t x1 = (x0 + off <= hi) ? x0 + off : x0 - off;
    if (x1 == x0) return;
    std::optional<double> a1Opt = sess.probe(x1);
    if (sess.solved()) return;
    // Deep-tail anchors sit a few e-folds above underflow; stepping away from the
    // hill can flush the pair sample to zero. Retry on the other side once.
    if (a1Opt && *a1Opt != 0.0 && (a0 > 0.0) != (*a1Opt > 0.0)) {
      // The pair straddles a sign crossing. Sign flips only happen between the
      // positive core and negative fringe hills, so the positive sample points
      // toward the cluster interior: march that way and re-anchor.
      const bool a1Positive = *a1Opt > 0.0;
      const int dirIn = (a1Positive == (x1 > x0)) ? 1 : -1;
      const int64_t base = a1Positive ? x1 : x0;
      const int64_t xn = clampInt64(base + dirIn * std::max<int64_t>(1, std::llround(tune.signCrossMarchW * wd)), lo, hi);
      const std::optional<double> anOpt = sess.probe(xn);
      if (sess.solved()) return;
      if (!anOpt || *anOpt == 0.0) return;
      x0 = xn;
      a0 = *anOpt;
      continue;
    }
    if (!a1Opt || *a1Opt == 0.0) {
      const int64_t x1b = x0 - (x1 - x0);
      if (x1b < lo || x1b > hi || x1b == x0) return;
      x1 = x1b;
      a1Opt = sess.probe(x1);
      if (sess.solved()) return;
      if (!a1Opt || *a1Opt == 0.0) return;
      if ((a0 > 0.0) != (*a1Opt > 0.0)) return;
    }
    const double a1 = *a1Opt;

    const double c = invertCenter(static_cast<double>(x0), a0, static_cast<double>(x1), a1, w);
    if (!std::isfinite(c) || std::abs(c - static_cast<double>(x0)) > tune.centerSanityMaxDistW * wd) return;
    const int64_t ci = clampProbe(c, lo, hi);
    for (const int64_t seen : seenCenters) {
      // Re-inverting to an already-visited center means we are orbiting the same
      // hill without progress; let the generic pipeline take over.
      if (std::abs(ci - seen) < static_cast<int64_t>(std::llround(tune.orbitDistW * wd))) return;
    }
    seenCenters.push_back(ci);
    const std::optional<double> acOpt = sess.probe(ci);
    if (sess.solved()) return;
    if (!acOpt) return;
    const double ac = *acOpt;

    // Possibly on the main hill flank already; near-zone sqrt candidates are cheap.
    if (ac > tune.ladderEntryMaxAbs && sqrtSnipe(sess, ci, ac, w, lo, hi)) return;
    if (ac >= kMainTh) {
      pinpoint(sess, sess.bestX(), w, lo, hi, tune.pinpointRounds, tune.pinpointFinalRadius, snipe);
      return;
    }

    // Model consistency. A genuine hill center must (a) not have been clamped to
    // the range edge, (b) read a height on the generator's ladder
    // 10000 - k*2600*v with v in [0.95, 1.05] (plus neighbor contamination), and
    // (c) locally match H*exp(-d^2/w^2) against the anchor pair. Saddle points
    // between hills fail these and would alias to a bogus rank.
    const double dxa = static_cast<double>(x0) - static_cast<double>(ci);
    bool trusted = ac != 0.0 && (a0 > 0.0) == (ac > 0.0) && c >= static_cast<double>(lo) &&
                   c <= static_cast<double>(hi);
    int k = static_cast<int>(std::llround((kHPeak - ac) / KOTH_HEIGHT_OFFSET_BASE));
    if (k < 1) k = 1;
    if (k > hc - 1) k = hc - 1;
    if (trusted) {
      const double kd = static_cast<double>(k);
      const double bandHi = kHPeak - kd * KOTH_HEIGHT_OFFSET_BASE * 0.95 + tune.heightBandSlack;
      const double bandLo = kHPeak - kd * KOTH_HEIGHT_OFFSET_BASE * 1.05 - tune.heightBandSlack;
      if (ac < bandLo || ac > bandHi) trusted = false;
    }
    // After a trusted jump of k rungs, cumulative location jitter bounds the
    // landing error to ~0.3k widths, i.e. at most a rung or two from the main
    // hill. A larger rank estimate here is flank contamination, not a hill.
    if (trusted && k > postJumpCapK) trusted = false;
    if (trusted && std::abs(dxa) <= tune.logResidualMaxDistW * wd) {
      const double logResidual =
          std::log(std::abs(a0)) - (std::log(std::abs(ac)) - (dxa * dxa) / (wd * wd));
      if (std::abs(logResidual) > tune.logResidualMax) trusted = false;
    }
    if (ladderTraceEnabled()) {
      std::fprintf(stderr, "[ladder]   c=%.3f ci=%lld ac=%.6g k=%d trusted=%d\n", c, static_cast<long long>(ci), ac,
                   k, trusted ? 1 : 0);
    }
    if (!trusted && ac > 0.0) {
      // Positive saddle between hills: a 3w hop would leap over the main hill.
      // Take a 1.5w half-step uphill instead so the next pair inversion anchors
      // on a single dominating hill. Try the pair's gradient direction first.
      const int64_t half = std::max<int64_t>(1, std::llround(tune.halfStepW * wd));
      const int gradDir = ((a1 > a0) == (x1 > x0)) ? 1 : -1;
      bool stepped = false;
      for (const int sgn : {gradDir, -gradDir}) {
        const int64_t xs = clampInt64(ci + sgn * half, lo, hi);
        const std::optional<double> asOpt = sess.probe(xs);
        if (sess.solved()) return;
        if (asOpt && *asOpt > ac) {
          x0 = xs;
          a0 = *asOpt;
          stepped = true;
          break;
        }
      }
      if (stepped) continue;
      return;  // local max that fails the ladder bands; hand off to the walk
    }
    if (!trusted) {
      // Negative readings can only exist several rungs out (H < 0 needs k >= 4),
      // so the rank magnitude stays useful even when the exact band check fails.
    } else {
      if (k >= prevK) return;  // not converging; hand off to the generic pipeline
      prevK = k;
    }

    int dir;
    const int64_t step3 = 3 * w;
    if (std::abs(static_cast<double>(ci) - static_cast<double>(x0)) > tune.outsideClusterDistW * wd) {
      // Anchor was farther from the hill center than any intra-cluster point can
      // be (max ~1.7w), so we approached from outside: main lies deeper inward.
      dir = (ci >= x0) ? 1 : -1;
    } else if (ci + step3 > hi) {
      dir = -1;
    } else if (ci - step3 < lo) {
      dir = 1;
    } else {
      const std::optional<double> arOpt = sess.probe(ci + step3);
      if (sess.solved()) return;
      if (!arOpt) {
        dir = -1;
      } else {
        // Off the cluster edge the reading collapses to the anchor hill's own tail
        // (~1e-4 of |ac|), which would read "higher" than a negative center and
        // fake a toward-main signal; any real neighbor hill reads far larger.
        const bool bareTail = std::abs(*arOpt) < tune.bareTailFrac * (std::abs(ac) + KOTH_HEIGHT_OFFSET_BASE);
        if (bareTail) dir = -1;
        else dir = (*arOpt > ac) ? 1 : -1;  // heights increase monotonically toward the main hill
      }
    }

    int64_t target =
        clampProbe(static_cast<double>(ci) + static_cast<double>(dir) * static_cast<double>(k) * 3.0 * wd, lo, hi);
    if (ladderTraceEnabled()) {
      std::fprintf(stderr, "[ladder]   k=%d dir=%d target=%lld\n", k, dir, static_cast<long long>(target));
    }
    std::optional<double> atOpt = sess.probe(target);
    if (sess.solved()) return;
    if (!atOpt) return;
    if (*atOpt <= 0.0) {
      // A correct jump lands within ~2w of the main peak, which always reads
      // positive; a non-positive landing means the direction (or rank) was wrong.
      const int64_t target2 =
          clampProbe(static_cast<double>(ci) - static_cast<double>(dir) * static_cast<double>(k) * 3.0 * wd, lo, hi);
      if (ladderTraceEnabled()) {
        std::fprintf(stderr, "[ladder]   flip -> target=%lld\n", static_cast<long long>(target2));
      }
      const std::optional<double> at2Opt = sess.probe(target2);
      if (sess.solved()) return;
      // Keep climbing from the higher landing even if both are negative:
      // less-negative means fewer rungs from the main hill on the height ladder.
      if (at2Opt && *at2Opt > *atOpt) {
        target = target2;
        atOpt = at2Opt;
      }
      if (*atOpt == 0.0) return;
    }
    postJumpCapK = std::max(1, static_cast<int>(std::llround(tune.postJumpCapScale * static_cast<double>(k) +
                                                             tune.postJumpCapBias)));
    x0 = target;
    a0 = *atOpt;
  }
}

void runInitialCoarseScan(ProbeSession& sess, int64_t lo, int64_t hi, int64_t w, int hc, CoarseScanSample* out,
                           CoarseEarlyStopMode earlyStopMode = CoarseEarlyStopMode::PositiveAny) {
  const std::vector<int64_t> xs = scanGrid(lo, hi, w, hc);
  const std::vector<int> order = spreadOrder(static_cast<int>(xs.size()));
  if (out) {
    out->gridPoints = static_cast<int>(xs.size());
    out->probesUsed = 0;
    out->anyNonZero = false;
  }
  for (const int idx : order) {
    std::optional<double> aOpt = sess.probe(xs[static_cast<size_t>(idx)]);
    if (out) {
      out->probesUsed++;
      if (aOpt && *aOpt != 0.0) out->anyNonZero = true;
    }
    if (sess.solved()) return;
    if (aOpt && coarseScanEarlyStop(*aOpt, earlyStopMode)) break;
  }
}

void runPostCoarsePipeline(ProbeSession& sess, int64_t lo, int64_t hi, int64_t w, int hc, bool snipe) {
  const LadderSnipeTuning& tune = activeLadderSnipeTuning();
  walkAndPinpoint(sess, w, lo, hi, snipe);
  if (sess.solved()) return;

  const std::vector<int64_t> xs = scanGrid(lo, hi, w, hc);
  for (const int64_t x : xs) {
    sess.probe(x);
    if (sess.solved()) return;
  }
  walkAndPinpoint(sess, w, lo, hi, snipe);
  if (sess.solved()) return;

  gallop(sess, sess.bestX(), w, lo, hi);
  if (sess.solved()) return;
  pinpoint(sess, sess.bestX(), w, lo, hi, tune.pinpointRounds, tune.pinpointFinalRadius, snipe);
  if (sess.solved()) return;
  clusterSweep(sess, w, lo, hi);
  if (sess.solved()) return;
  pinpoint(sess, sess.bestX(), w, lo, hi, tune.pinpointRounds, tune.pinpointFinalRadiusWide, snipe);
  if (sess.solved()) return;

  backstop(sess, w, lo, hi);
}

void runSolverCore(ProbeSession& sess, int64_t lo, int64_t hi, int64_t w, int hc, CoarseEarlyStopMode earlyStopMode,
                   CoarseScanSample* coarseOut = nullptr, bool snipe = false) {
  runInitialCoarseScan(sess, lo, hi, w, hc, coarseOut, earlyStopMode);
  if (sess.solved()) return;
  runPostCoarsePipeline(sess, lo, hi, w, hc, snipe);
}

struct LadderCoarseHit {
  int64_t x = 0;
  double a = 0.0;
};

bool isFarTailAnchor(double a) {
  if (a == 0.0) return false;
  return std::abs(a) < activeLadderSnipeTuning().farTailAnchorMaxAbs;
}

/**
 * Coarse scan for ladder: stop on the first far-tail nonzero (any sign, including
 * denormals), else the first positive. Skip |a| >= 200 negatives (#237479).
 */
std::optional<LadderCoarseHit> ladderCoarseScan(ProbeSession& sess, int64_t lo, int64_t hi, int64_t w, int hc,
                                                CoarseScanSample* out) {
  const std::vector<int64_t> xs = scanGrid(lo, hi, w, hc);
  const std::vector<int> order = spreadOrder(static_cast<int>(xs.size()));
  if (out) {
    out->gridPoints = static_cast<int>(xs.size());
    out->probesUsed = 0;
    out->anyNonZero = false;
  }
  for (const int idx : order) {
    const int64_t x = xs[static_cast<size_t>(idx)];
    const std::optional<double> aOpt = sess.probe(x);
    if (out) {
      out->probesUsed++;
      if (aOpt && *aOpt != 0.0) out->anyNonZero = true;
    }
    if (sess.solved()) return std::nullopt;
    if (!aOpt || *aOpt == 0.0) continue;
    if (isFarTailAnchor(*aOpt)) return LadderCoarseHit{x, *aOpt};
    if (*aOpt > 0.0) return LadderCoarseHit{x, *aOpt};
  }
  return std::nullopt;
}

void runSolverCoreBaseline(ProbeSession& sess, int64_t lo, int64_t hi, int64_t w, int hc,
                           CoarseScanSample* coarseOut = nullptr) {
  runSolverCore(sess, lo, hi, w, hc, CoarseEarlyStopMode::PositiveAny, coarseOut);
}

void runSolverCoreNew(ProbeSession& sess, int64_t lo, int64_t hi, int64_t w, int hc,
                      CoarseScanSample* coarseOut = nullptr) {
  // Experimental branch slot; currently mirrors baseline.
  runSolverCore(sess, lo, hi, w, hc, CoarseEarlyStopMode::PositiveAny, coarseOut);
}

void runSolverCoreSnipe(ProbeSession& sess, int64_t lo, int64_t hi, int64_t w, int hc,
                        CoarseScanSample* coarseOut = nullptr) {
  runSolverCore(sess, lo, hi, w, hc, CoarseEarlyStopMode::PositiveAny, coarseOut, true);
}

void runSolverCoreLadder(ProbeSession& sess, int64_t lo, int64_t hi, int64_t w, int hc, bool snipe,
                         CoarseScanSample* coarseOut = nullptr) {
  if (hc < 5) {
    runSolverCore(sess, lo, hi, w, hc, CoarseEarlyStopMode::PositiveAny, coarseOut, snipe);
    return;
  }
  const std::optional<LadderCoarseHit> hit = ladderCoarseScan(sess, lo, hi, w, hc, coarseOut);
  if (sess.solved()) return;

  bool havePositiveRestore = false;
  int64_t restoreX = lo;
  double restoreA = -1e18;

  if (hit) {
    if (hit->a > 0.0) {
      restoreX = hit->x;
      restoreA = hit->a;
      havePositiveRestore = true;
    }
    const LadderSnipeTuning& tune = activeLadderSnipeTuning();
    const int64_t span = hi - lo;
    const bool skipPositiveLadder =
        hit->a > 0.0 && tune.positiveLadderSkipRangeFraction > 0.0 &&
        hit->x > lo + static_cast<int64_t>(tune.positiveLadderSkipRangeFraction * static_cast<double>(span));
    if (std::abs(hit->a) < tune.ladderEntryMaxAbs && !skipPositiveLadder) {
      ladderClimb(sess, hit->x, hit->a, w, hc, lo, hi, snipe);
    } else if (hit->a > 0.0) {
      sqrtSnipe(sess, hit->x, hit->a, w, lo, hi);
    }
    if (sess.solved()) return;
  }

  // Negative far-tail entry with no positive stop: re-anchor bestX from a positive probe.
  if (!havePositiveRestore) {
    runInitialCoarseScan(sess, lo, hi, w, hc, nullptr, CoarseEarlyStopMode::PositiveAny);
    if (sess.solved()) return;
    if (sess.bestAlt() > 0.0) {
      restoreX = sess.bestX();
      restoreA = sess.bestAlt();
      havePositiveRestore = true;
    }
  }

  if (havePositiveRestore) sess.restoreBest(restoreX, restoreA);
  runPostCoarsePipeline(sess, lo, hi, w, hc, snipe);
}

class ActiveTuningGuard {
 public:
  explicit ActiveTuningGuard(const LadderSnipeTuning* tuning) { setActiveLadderSnipeTuning(tuning); }
  ~ActiveTuningGuard() { setActiveLadderSnipeTuning(nullptr); }
};

NumericRange numericRange(int passwordLength) {
  int64_t lo = ipow10(passwordLength - 1);
  const int64_t hi = ipow10(passwordLength) - 1;
  if (passwordLength == 1) lo = 0;
  return {lo, hi};
}

SolveResult solveInternal(const Assignment& assignment, int cap, SolverVariant variant,
                          CoarseScanSample* coarseOut) {
  SolveResult out;
  const Server server = toServer(assignment);
  const int64_t password = parsePasswordInt(assignment.password);
  NumericRange range = numericRange(assignment.passwordLength);
  const int64_t w = kingOfTheHillGaussianWidth(assignment.passwordLength);
  const int hc = kingOfTheHillHillCount(assignment.difficulty);

  ProbeSession sess(server, password, range.min, range.max, cap);
  if (password < range.min || password > range.max) return out;

  switch (variant) {
    case SolverVariant::Baseline:
      runSolverCoreBaseline(sess, range.min, range.max, w, hc, coarseOut);
      break;
    case SolverVariant::New:
      runSolverCoreNew(sess, range.min, range.max, w, hc, coarseOut);
      break;
    case SolverVariant::Snipe:
      runSolverCoreSnipe(sess, range.min, range.max, w, hc, coarseOut);
      break;
    case SolverVariant::Ladder:
      runSolverCoreLadder(sess, range.min, range.max, w, hc, false, coarseOut);
      break;
    case SolverVariant::LadderSnipe:
      runSolverCoreLadder(sess, range.min, range.max, w, hc, true, coarseOut);
      break;
    case SolverVariant::LadderSnipeTuned: {
      const LadderSnipeTuning* tuned = tunedLadderSnipeConfig();
      if (tuned) {
        ActiveTuningGuard guard(tuned);
        runSolverCoreLadder(sess, range.min, range.max, w, hc, true, coarseOut);
      } else {
        runSolverCoreLadder(sess, range.min, range.max, w, hc, true, coarseOut);
      }
      break;
    }
  }

  out.solved = sess.solved();
  out.guesses = sess.guesses();
  out.bestX = sess.bestX();
  out.bestAlt = sess.bestAlt();
  if (coarseOut) {
    out.hasCoarseScan = true;
    out.coarseScan = *coarseOut;
  }
  return out;
}

}  // namespace

const char* solverVariantName(SolverVariant variant) {
  switch (variant) {
    case SolverVariant::Baseline:
      return "baseline";
    case SolverVariant::New:
      return "new";
    case SolverVariant::Snipe:
      return "snipe";
    case SolverVariant::Ladder:
      return "ladder";
    case SolverVariant::LadderSnipe:
      return "ladder_snipe";
    case SolverVariant::LadderSnipeTuned:
      return "ladder_snipe_tuned";
  }
  return "unknown";
}

const char* solverVariantDescription(SolverVariant variant) {
  switch (variant) {
    case SolverVariant::Baseline:
      return "Phase-1 early stop when alt > 0";
    case SolverVariant::New:
      return "Experimental branch (currently mirrors baseline)";
    case SolverVariant::Snipe:
      return "Near-zone sqrt candidate guesses before pinpoint inversion";
    case SolverVariant::Ladder:
      return "Pair-inversion + height-rank ladder jumps (nonzero-tail coarse stop)";
    case SolverVariant::LadderSnipe:
      return "Ladder combined with sqrt snipe finisher";
    case SolverVariant::LadderSnipeTuned:
      return "ladder_snipe with GA-tuned constants from JSON";
  }
  return "";
}

std::vector<SolverVariant> allSolverVariants() {
  return {SolverVariant::Baseline, SolverVariant::New, SolverVariant::Snipe, SolverVariant::Ladder,
          SolverVariant::LadderSnipe, SolverVariant::LadderSnipeTuned};
}

bool parseSolverVariant(const std::string& name, SolverVariant* out) {
  for (const SolverVariant v : allSolverVariants()) {
    if (name == solverVariantName(v)) {
      *out = v;
      return true;
    }
  }
  return false;
}

SolveResult solve(const Assignment& assignment, int cap, SolverVariant variant,
                  CoarseScanSample* coarseScanOut) {
  return solveInternal(assignment, cap, variant, coarseScanOut);
}

SolveResult solve(const Assignment& assignment, int cap, SolverVariant variant) {
  return solveInternal(assignment, cap, variant, nullptr);
}

CoarseScanSample coarseScanSample(const Assignment& assignment) {
  CoarseScanSample out;
  const Server server = toServer(assignment);
  const int64_t password = parsePasswordInt(assignment.password);
  NumericRange range = numericRange(assignment.passwordLength);
  const int64_t w = kingOfTheHillGaussianWidth(assignment.passwordLength);
  const int hc = kingOfTheHillHillCount(assignment.difficulty);

  ProbeSession sess(server, password, range.min, range.max, 600);
  if (password < range.min || password > range.max) return out;

  runInitialCoarseScan(sess, range.min, range.max, w, hc, &out);
  return out;
}

CoarseScanDifficultyStats summarizeCoarseScans(int difficulty,
                                             const std::vector<Assignment>& assignments) {
  CoarseScanDifficultyStats stats;
  stats.difficulty = difficulty;
  stats.assignments = static_cast<int>(assignments.size());
  for (const Assignment& assignment : assignments) {
    const CoarseScanSample sample = coarseScanSample(assignment);
    if (stats.gridPoints == 0) {
      stats.gridPoints = sample.gridPoints;
      stats.passwordLength = assignment.passwordLength;
    }
    if (sample.anyNonZero) stats.withNonZero++;
  }
  return stats;
}

}  // namespace koth
