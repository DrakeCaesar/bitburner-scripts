#include "safety.hpp"

#include <algorithm>
#include <iterator>

namespace ipvgo::game {
namespace {

// Flat index is x * n + y, so +-1 walks along y and +-n along x.
template <typename F>
inline void eachNeighbor(int n, int p, F&& fn) {
  const int x = p / n;
  const int y = p % n;
  if (x > 0) fn(p - n);
  if (x + 1 < n) fn(p + n);
  if (y > 0) fn(p - 1);
  if (y + 1 < n) fn(p + 1);
}

// Chains for which every empty point of the region is a liberty. Benson's
// "healthy" relation, computed as the intersection over the region's empty
// points of the chains adjacent to each one.
void healthyChainsFor(const SimpleBoard& board, const ChainSet& cs, char mine, const SafetyRegion& region,
                      std::vector<int>& out) {
  const int n = board.size();
  out.clear();
  bool first = true;
  for (const int p : region.emptyPoints) {
    std::vector<int> adjacent;
    eachNeighbor(n, p, [&](int q) {
      const int chain = cs.id[static_cast<size_t>(q)];
      if (chain >= 0 && cs.chainColor[static_cast<size_t>(chain)] == mine) adjacent.push_back(chain);
    });
    std::sort(adjacent.begin(), adjacent.end());
    adjacent.erase(std::unique(adjacent.begin(), adjacent.end()), adjacent.end());
    if (first) {
      out = std::move(adjacent);
      first = false;
    } else {
      std::vector<int> keep;
      std::set_intersection(out.begin(), out.end(), adjacent.begin(), adjacent.end(),
                            std::back_inserter(keep));
      out.swap(keep);
    }
    if (out.empty()) return;
  }
  // A region whose points are all prisoners has no empty points; it is vacuously
  // healthy for each chain around it.
  if (first) out = region.borderChains;
}

// Benson's fixpoint for one colour (Information Sciences 10:17-29, 1976, §7):
// repeatedly drop chains without two vital regions, then drop regions touching a
// dropped chain, until neither changes.
void benson(const SimpleBoard& board, const ChainSet& cs, char mine, const std::vector<SafetyRegion>& regions,
            std::vector<char>& alive, std::vector<char>& regionVital) {
  alive.assign(static_cast<size_t>(cs.count), 0);
  for (int c = 0; c < cs.count; ++c) alive[static_cast<size_t>(c)] = cs.chainColor[static_cast<size_t>(c)] == mine ? 1 : 0;

  std::vector<char> regionInSet(regions.size(), 0);
  std::vector<std::vector<int>> healthy(regions.size());
  for (size_t r = 0; r < regions.size(); ++r) {
    if (!regions[r].small || regions[r].borderChains.empty()) continue;
    healthyChainsFor(board, cs, mine, regions[r], healthy[r]);
    regionInSet[r] = healthy[r].empty() ? 0 : 1;
  }

  bool changed = true;
  while (changed) {
    changed = false;
    for (size_t r = 0; r < regions.size(); ++r) {
      if (!regionInSet[r]) continue;
      for (const int b : regions[r].borderChains) {
        if (!alive[static_cast<size_t>(b)]) {
          regionInSet[r] = 0;
          changed = true;
          break;
        }
      }
    }
    for (int b = 0; b < cs.count; ++b) {
      if (!alive[static_cast<size_t>(b)]) continue;
      int vital = 0;
      for (size_t r = 0; r < regions.size() && vital < 2; ++r) {
        if (!regionInSet[r]) continue;
        if (std::find(healthy[r].begin(), healthy[r].end(), b) != healthy[r].end()) ++vital;
      }
      if (vital < 2) {
        alive[static_cast<size_t>(b)] = 0;
        changed = true;
      }
    }
  }

  regionVital.assign(regions.size(), 0);
  for (size_t r = 0; r < regions.size(); ++r) {
    if (!regionInSet[r]) continue;
    for (const int b : regions[r].borderChains) {
      if (!alive[static_cast<size_t>(b)]) continue;
      if (std::find(healthy[r].begin(), healthy[r].end(), b) != healthy[r].end()) {
        regionVital[r] = 1;
        break;
      }
    }
  }
}

// Bounded work for the Vital level: each trial is a board copy plus two chain
// builds, so a leaf with many unsettled regions must not run away.
constexpr int kMaxVitalTrials = 32;
constexpr int kMinRegionForTrial = 2;  // one empty point cannot become two eyes
constexpr int kMaxRegionForTrial = 8;

}  // namespace

std::vector<SafetyRegion> buildSafetyRegions(const SimpleBoard& board, const ChainSet& cs, Color color) {
  const int n = board.size();
  const char mine = colorChar(color);
  std::vector<char> visited(static_cast<size_t>(n * n), 0);
  std::vector<SafetyRegion> out;
  std::vector<int> stack;

  for (int start = 0; start < n * n; ++start) {
    if (visited[static_cast<size_t>(start)]) continue;
    const char here = board[start / n][start % n];
    if (here == mine || here == '#') continue;  // own stones and obstacles are walls

    SafetyRegion region;
    region.borderColor = mine;
    stack.clear();
    stack.push_back(start);
    visited[static_cast<size_t>(start)] = 1;
    while (!stack.empty()) {
      const int p = stack.back();
      stack.pop_back();
      region.points.push_back(p);
      if (board[p / n][p % n] == '.') region.emptyPoints.push_back(p);
      eachNeighbor(n, p, [&](int q) {
        const char t = board[q / n][q % n];
        if (t == mine) {
          const int chain = cs.id[static_cast<size_t>(q)];
          if (chain >= 0) region.borderChains.push_back(chain);
          return;
        }
        if (t == '#') return;
        if (!visited[static_cast<size_t>(q)]) {
          visited[static_cast<size_t>(q)] = 1;
          stack.push_back(q);
        }
      });
    }
    std::sort(region.borderChains.begin(), region.borderChains.end());
    region.borderChains.erase(std::unique(region.borderChains.begin(), region.borderChains.end()),
                              region.borderChains.end());
    region.small = !region.emptyPoints.empty();
    for (const int p : region.emptyPoints) {
      bool touchesMine = false;
      eachNeighbor(n, p, [&](int q) {
        if (board[q / n][q % n] == mine) touchesMine = true;
      });
      if (!touchesMine) {
        region.small = false;
        break;
      }
    }
    out.push_back(std::move(region));
  }
  return out;
}

SafetyResult analyzeSafety(const SimpleBoard& board, const ChainSet& cs, Color color, bool extendWithVital) {
  const char mine = colorChar(color);
  const int n = board.size();
  const std::vector<SafetyRegion> regions = buildSafetyRegions(board, cs, color);

  std::vector<char> alive;
  std::vector<char> regionVital;
  benson(board, cs, mine, regions, alive, regionVital);

  SafetyResult result;
  result.chain.assign(static_cast<size_t>(cs.count), SafetyLevel::None);
  result.vitalPoint.assign(static_cast<size_t>(n * n), 0);
  for (int c = 0; c < cs.count; ++c) {
    if (alive[static_cast<size_t>(c)]) {
      result.chain[static_cast<size_t>(c)] = SafetyLevel::Benson;
      ++result.bensonChains;
    }
  }
  for (size_t r = 0; r < regions.size(); ++r) {
    if (!regionVital[r]) continue;
    for (const int p : regions[r].emptyPoints) result.vitalPoint[static_cast<size_t>(p)] = 1;
  }
  if (!extendWithVital) return result;

  // Vital level: if the defender answers somewhere in its own small region and
  // that makes it pass-alive, the chain was already safe under alternating play.
  int trials = 0;
  for (const SafetyRegion& region : regions) {
    if (trials >= kMaxVitalTrials) break;
    if (!region.small || region.borderChains.empty()) continue;
    const int empties = static_cast<int>(region.emptyPoints.size());
    if (empties < kMinRegionForTrial || empties > kMaxRegionForTrial) continue;
    // Only regions where every surrounding chain is already Benson-alive can
    // improve: a region with a dying chain around it is not an eye.
    bool allBorderAlive = true;
    for (const int b : region.borderChains) {
      if (!alive[static_cast<size_t>(b)]) allBorderAlive = false;
    }
    if (allBorderAlive) continue;

    for (const int p : region.emptyPoints) {
      if (trials >= kMaxVitalTrials) break;
      ++trials;
      SimpleBoard placed = board;
      placed[p / n][p % n] = mine;
      updateCaptures(placed, color);
      const ChainSet after = computeChains(placed);
      const int chain = after.id[static_cast<size_t>(p)];
      if (chain < 0) continue;
      std::vector<char> aliveAfter;
      std::vector<char> vitalAfter;
      benson(placed, after, mine, buildSafetyRegions(placed, after, color), aliveAfter, vitalAfter);
      if (chain >= static_cast<int>(aliveAfter.size()) || !aliveAfter[static_cast<size_t>(chain)]) continue;
      // The placed stone joined (or formed) that chain, so every chain of the
      // region that touches this point is alive too.
      eachNeighbor(n, p, [&](int q) {
        const int original = cs.id[static_cast<size_t>(q)];
        if (original >= 0 && cs.chainColor[static_cast<size_t>(original)] == mine &&
            result.chain[static_cast<size_t>(original)] == SafetyLevel::None) {
          result.chain[static_cast<size_t>(original)] = SafetyLevel::Vital;
          ++result.vitalChains;
        }
      });
    }
  }
  return result;
}

}  // namespace ipvgo::game
