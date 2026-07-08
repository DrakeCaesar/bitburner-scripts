#include "koth_solver.hpp"

#include <algorithm>
#include <cmath>
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
  int64_t step = std::max<int64_t>(1, std::llround(1.5 * static_cast<double>(w)));
  int64_t stop = std::max<int64_t>(1, std::llround(0.1 * static_cast<double>(w)));
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

void pinpoint(ProbeSession& sess, int64_t seedX, int64_t w, int64_t lo, int64_t hi, int rounds = 5, int finalRadius = 8) {
  int64_t pc = clampProbe(static_cast<double>(seedX), lo, hi);
  int64_t off = std::max<int64_t>(1, std::llround(0.25 * static_cast<double>(w)));
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
  const int64_t center = sess.bestX();
  const int64_t reach = std::llround(28.0 * static_cast<double>(w));
  const int64_t step = std::max<int64_t>(1, std::llround(1.2 * static_cast<double>(w)));
  int64_t x = std::max(lo, center - reach);
  const int64_t b = std::min(hi, center + reach);
  while (x <= b && !sess.solved()) {
    sess.probe(x);
    x += step;
  }
}

void clusterSweepSmart(ProbeSession& sess, int64_t w, int64_t lo, int64_t hi) {
  const int64_t center = sess.bestX();
  const int64_t reach = std::llround(28.0 * static_cast<double>(w));
  const int64_t step = std::max<int64_t>(1, std::llround(1.2 * static_cast<double>(w)));
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
  const int64_t step = std::max<int64_t>(1, std::llround(0.7 * static_cast<double>(w)));
  int64_t x = lo;
  while (x <= hi && !sess.solved()) {
    sess.probe(x);
    x += step;
  }
  if (!sess.solved()) pinpoint(sess, sess.bestX(), w, lo, hi, 5, 30);
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

bool walkAndPinpoint(ProbeSession& sess, int64_t w, int64_t lo, int64_t hi) {
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

  pinpoint(sess, sess.bestX(), w, lo, hi);
  return a >= kMainTh;
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

void runSolverCore(ProbeSession& sess, int64_t lo, int64_t hi, int64_t w, int hc, CoarseEarlyStopMode earlyStopMode,
                   CoarseScanSample* coarseOut = nullptr) {
  runInitialCoarseScan(sess, lo, hi, w, hc, coarseOut, earlyStopMode);

  walkAndPinpoint(sess, w, lo, hi);
  if (sess.solved()) return;

  const std::vector<int64_t> xs = scanGrid(lo, hi, w, hc);
  for (const int64_t x : xs) {
    sess.probe(x);
    if (sess.solved()) return;
  }
  walkAndPinpoint(sess, w, lo, hi);
  if (sess.solved()) return;

  gallop(sess, sess.bestX(), w, lo, hi);
  if (sess.solved()) return;
  pinpoint(sess, sess.bestX(), w, lo, hi);
  if (sess.solved()) return;
  clusterSweep(sess, w, lo, hi);
  if (sess.solved()) return;
  pinpoint(sess, sess.bestX(), w, lo, hi, 5, 20);
  if (sess.solved()) return;

  backstop(sess, w, lo, hi);
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
  }
  return "unknown";
}

const char* solverVariantDescription(SolverVariant variant) {
  switch (variant) {
    case SolverVariant::Baseline:
      return "Phase-1 early stop when alt > 0";
    case SolverVariant::New:
      return "Experimental branch (currently mirrors baseline)";
  }
  return "";
}

std::vector<SolverVariant> allSolverVariants() {
  return {SolverVariant::Baseline, SolverVariant::New};
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
