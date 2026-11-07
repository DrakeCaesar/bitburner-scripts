#include "analysis.hpp"

#include <algorithm>
#include <array>
#include <unordered_map>
#include <ankerl/unordered_dense.h>
#include <unordered_set>


namespace ipvgo::game {

namespace {

constexpr std::array<std::pair<int, int>, 4> kNeighbors = {{{0, 1}, {1, 0}, {0, -1}, {-1, 0}}};

struct Spread {
  int north, south, east, west;  // maxY, minY, maxX, minX
};

Spread furthestPoints(const ChainSet& cs, int chain) {
  const int N = cs.N;
  const int first = cs.members(chain)[0];
  Spread s{first % N, first % N, first / N, first / N};
  for (const int idx : cs.members(chain)) {
    const int x = idx / N;
    const int y = idx % N;
    s.north = std::max(s.north, y);
    s.south = std::min(s.south, y);
    s.east = std::max(s.east, x);
    s.west = std::min(s.west, x);
  }
  return s;
}

// Distinct non-empty neighbor chains of a set of cells, evaluated on the given
// board/ChainSet (mirrors getAllNeighboringChains over an arbitrary cell set).
//
// The result is at most four chains, so it lives in fixed storage and is copied
// into the caller's vector only once. The intermediate `std::vector<int>` growth
// was the single largest allocation site in the profile (229M reallocations).
using SmallChains = ChainList;

// Neighbour chains of one whole chain. The chain's own points are recognised by
// chain id, so no point set has to be built.
SmallChains neighborChainsOfChain(const ChainSet& cs, int c) {
  const NeighborTable nt = neighborTable(cs.N);
  SmallChains result;
  for (const int idx : cs.members(c)) {
    const int nbCount = nt.count[idx];
    const auto& nbIdx = nt.idx[idx];
    for (int k = 0; k < nbCount; ++k) {
      const int nc = cs.id[nbIdx[k]];
      if (nc < 0 || nc == c || cs.chainColor[nc] == '.') continue;
      bool seen = false;
      for (int i = 0; i < result.count; ++i) {
        if (result.idx[i] == nc) {
          seen = true;
          break;
        }
      }
      if (seen || result.count >= SmallChains::kMax) continue;
      result.idx[result.count++] = nc;
    }
  }
  return result;
}

SmallChains neighborChainsSmall(const SimpleBoard& board, const ChainSet& cs, ChainSpan cells) {
  (void)board;
  const int N = cs.N;
  const NeighborTable nt = neighborTable(N);
  PointMask cellSet;
  for (const int idx : cells) cellSet.insert(idx);
  SmallChains result;
  for (const int idx : cells) {
    const int nbCount = nt.count[idx];
    const auto& nbIdx = nt.idx[idx];
    for (int k = 0; k < nbCount; ++k) {
      const int nIdx = nbIdx[k];
      if (cellSet.count(nIdx)) continue;
      const int nc = cs.id[nIdx];
      if (nc < 0 || cs.chainColor[nc] == '.') continue;
      bool seen = false;
      for (int i = 0; i < result.count; ++i) {
        if (result.idx[i] == nc) {
          seen = true;
          break;
        }
      }
      if (seen || result.count >= SmallChains::kMax) continue;
      result.idx[result.count++] = nc;
    }
  }
  return result;
}

}  // namespace

Neighbors onBoardNeighbors(int N, int x, int y) {
  Neighbors out;
  for (const auto& [dx, dy] : kNeighbors) {
    const int nx = x + dx;
    const int ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    out.idx[out.count++] = flatIndex(N, nx, ny);
  }
  return out;
}

std::vector<int> neighborChainIndices(const SimpleBoard& board, const ChainSet& cs, int c) {
  (void)board;
  return neighborChainsOfChain(cs, c).toVector();
}

std::vector<int> findEffectiveLibertiesOfNewMove(const SimpleBoard& board, int x, int y, Color player) {
  const ChainSet& cs = chainsCached(board);
  const int N = cs.N;
  const char me = colorChar(player);
  const int self = flatIndex(N, x, y);

  std::vector<int> all;
  PointMask seen;
  auto add = [&](int idx) {
    if (idx == self) return;
    if (seen.count(idx)) return;
    seen.insert(idx);
    all.push_back(idx);
  };

  // Direct empty liberties first, then friendly chain liberties.
  for (const auto& [dx, dy] : kNeighbors) {
    const int nx = x + dx;
    const int ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (board[nx][ny] == '.') add(flatIndex(N, nx, ny));
  }
  for (const auto& [dx, dy] : kNeighbors) {
    const int nx = x + dx;
    const int ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (board[nx][ny] != me) continue;
    const int chain = cs.id[flatIndex(N, nx, ny)];
    for (const int lib : cs.liberties(chain)) add(lib);
  }
  return all;
}

WeakestChain findEnemyNeighborChainWithFewestLiberties(const SimpleBoard& board, int x, int y, Color player) {
  const ChainSet& cs = chainsCached(board);
  const int N = cs.N;
  const char me = colorChar(player);

  std::vector<int> neighborChainsInOrder;
  for (const auto& [dx, dy] : kNeighbors) {
    const int nx = x + dx;
    const int ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (board[nx][ny] != me) continue;
    neighborChainsInOrder.push_back(cs.id[flatIndex(N, nx, ny)]);
  }
  if (neighborChainsInOrder.empty()) return {};

  int minLib = 99;
  for (const int c : neighborChainsInOrder) minLib = std::min(minLib, cs.libertyCount(c));
  int chosen = -1;
  for (const int c : neighborChainsInOrder) {
    if (cs.libertyCount(c) == minLib) {
      chosen = c;
      break;
    }
  }

  WeakestChain wc;
  wc.found = true;
  wc.length = static_cast<int>(cs.members(chosen).size());
  const ChainSpan liberties = cs.liberties(chosen);
  wc.liberties.assign(liberties.begin(), liberties.end());
  return wc;
}

int findMinLibertyCountOfAdjacentChains(const SimpleBoard& board, int x, int y, Color player) {
  const WeakestChain wc = findEnemyNeighborChainWithFewestLiberties(board, x, y, player);
  return wc.found ? static_cast<int>(wc.liberties.size()) : 99;
}

namespace {

// Core of getAllPotentialEyes(): the same scan, with the candidate handed to the
// caller instead of pushed into a vector. The eye summary runs this on every reply
// distribution, and the vector was the largest single allocation site in the
// profile, so the summary takes this path.
//
// `visit(neighbors, emptyChain)` is called once per single-colour empty region.
template <typename Visit>
void forEachPotentialEye(const ChainSet& cs, Color player, double maxSize, Visit&& visit) {
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] != '.') continue;
    if (static_cast<double>(cs.members(c).size()) > maxSize) continue;

    const ChainList neighbors = neighborChainsOfChain(cs, c);
    bool hasWhite = false;
    bool hasBlack = false;
    for (const int nc : neighbors) {
      if (cs.chainColor[nc] == 'O') hasWhite = true;
      else if (cs.chainColor[nc] == 'X') hasBlack = true;
    }
    const bool whiteEye = hasWhite && !hasBlack && player == Color::White;
    const bool blackEye = !hasWhite && hasBlack && player == Color::Black;
    if (whiteEye || blackEye) visit(neighbors, c);
  }
}

}  // namespace

std::vector<EyeCandidate> getAllPotentialEyes(const SimpleBoard& board, const ChainSet& cs, Color player,
                                              int maxSizeOverride) {
  const double maxSize =
      maxSizeOverride >= 0 ? static_cast<double>(maxSizeOverride) : eyeCandidateMaxSize(board);
  std::vector<EyeCandidate> candidates;
  forEachPotentialEye(cs, player, maxSize,
                      [&candidates](const ChainList& neighbors, int emptyChain) {
                        candidates.push_back({neighbors, emptyChain});
                      });
  return candidates;
}

namespace {

// Mirrors findNeighboringChainsThatFullyEncircleEmptySpace.
std::vector<int> chainsThatFullyEncircle(const SimpleBoard& board, const ChainSet& cs, int candidateEmptyChain,
                                         const ChainList& neighborChainList) {
  const int N = cs.N;
  const int boardMax = N - 1;
  const Spread candidateSpread = furthestPoints(cs, candidateEmptyChain);
  const int examplePoint = cs.members(candidateEmptyChain)[0];

  std::vector<int> result;
  for (size_t index = 0; index < neighborChainList.size(); ++index) {
    const int neighborChain = neighborChainList[index];
    const Spread ns = furthestPoints(cs, neighborChain);

    const bool wrapN = ns.north > candidateSpread.north || (candidateSpread.north == boardMax && ns.north == boardMax);
    const bool wrapE = ns.east > candidateSpread.east || (candidateSpread.east == boardMax && ns.east == boardMax);
    const bool wrapS = ns.south < candidateSpread.south || (candidateSpread.south == 0 && ns.south == 0);
    const bool wrapW = ns.west < candidateSpread.west || (candidateSpread.west == 0 && ns.west == 0);
    if (!wrapN || !wrapE || !wrapS || !wrapW) continue;

    SimpleBoard eval = board;
    for (size_t j = 0; j < neighborChainList.size(); ++j) {
      if (j == index) continue;
      for (const int idx : cs.members(neighborChainList[j])) eval[idx / N][idx % N] = '.';
    }
    const ChainSet evalCs = computeChains(eval);
    const int expandedChain = evalCs.id[examplePoint];
    const ChainList newNeighbors = neighborChainsSmall(board, cs, evalCs.members(expandedChain));
    if (newNeighbors.size() == 1) result.push_back(neighborChain);
  }
  return result;
}

}  // namespace

EyeMap getAllEyesByChainId(const SimpleBoard& board, Color player) {
  EyeMap out;
  out.cs = chainsCached(board);
  const std::vector<EyeCandidate> candidates = getAllPotentialEyes(board, out.cs, player);

  ankerl::unordered_dense::map<int, size_t> keyIndex;
  auto addEye = [&](int chainIdx, int emptyChain) {
    auto it = keyIndex.find(chainIdx);
    if (it == keyIndex.end()) {
      keyIndex[chainIdx] = out.eyes.size();
      out.eyes.push_back({chainIdx, {emptyChain}});
    } else {
      out.eyes[it->second].second.push_back(emptyChain);
    }
  };

  for (const auto& candidate : candidates) {
    if (candidate.neighborChains.empty()) continue;
    if (candidate.neighborChains.size() == 1) {
      addEye(candidate.neighborChains[0], candidate.emptyChain);
      continue;
    }
    const std::vector<int> encircling =
        chainsThatFullyEncircle(board, out.cs, candidate.emptyChain, candidate.neighborChains);
    for (const int nc : encircling) addEye(nc, candidate.emptyChain);
  }
  return out;
}

double eyeCandidateMaxSize(const SimpleBoard& board) {
  const int n = board.size();
  const char* cells = board.flat();
  int nodeCount = 0;
  for (int i = 0; i < n * n; ++i) nodeCount += cells[i] != '#' ? 1 : 0;
  return std::min(nodeCount * 0.4, 11.0);
}

EyeBoardSummary summarizeEyes(const SimpleBoard& board, const ChainSet& cs, Color player) {
  EyeBoardSummary out;

  auto addEye = [&out](int chain, int region) {
    if (out.perChain[static_cast<size_t>(chain)] < 255) ++out.perChain[static_cast<size_t>(chain)];
    const int count = out.ownerCount[static_cast<size_t>(region)];
    if (count < EyeBoardSummary::kMaxOwners) {
      out.owners[static_cast<size_t>(region)][static_cast<size_t>(count)] = static_cast<int16_t>(chain);
      out.ownerCount[static_cast<size_t>(region)] = static_cast<uint8_t>(count + 1);
    }
  };

  // No candidate vector: this runs on every reply distribution.
  forEachPotentialEye(cs, player, eyeCandidateMaxSize(board),
                      [&](const ChainList& neighbors, int emptyChain) {
                        if (neighbors.empty()) return;
                        if (neighbors.size() == 1) {
                          addEye(neighbors[0], emptyChain);
                          return;
                        }
                        ++out.multiNeighbour;
                        if (out.multiRegionCount < EyeBoardSummary::kMaxMultiRegions) {
                          // Past the cap the incremental path simply refuses; the totals
                          // here stay exact either way.
                          EyeBoardSummary::MultiRegion& multi =
                              out.multiRegions[static_cast<size_t>(out.multiRegionCount++)];
                          multi.region = emptyChain;
                          multi.neighbors = neighbors;
                        }
                        for (const int nc : chainsThatFullyEncircle(board, cs, emptyChain, neighbors)) {
                          addEye(nc, emptyChain);
                        }
                      });

  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] == '.') continue;
    const int eyes = out.perChain[static_cast<size_t>(c)];
    if (eyes >= 1) ++out.totals.eyeCount;
    if (eyes >= 2) ++out.totals.livingGroups;
  }
  return out;
}

namespace {

// A single move touches the region it lands in, the regions around the chains it
// joins, and the chains those regions counted as eyes. Well under this in
// practice; past it the incremental path declines and the caller does the
// board-wide analysis.
constexpr int kMaxTouchedChains = 32;

}  // namespace

bool eyeTotalsAfterMove(const SimpleBoard& board, const ChainSet& cs, const EyeBoardSummary& before,
                        Color player, int x, int y, double maxSize, EyeTotals& out, EyeBail* bail) {
  const auto refuse = [bail](EyeBail reason) {
    if (bail != nullptr) *bail = reason;
    return false;
  };
  if (bail != nullptr) *bail = EyeBail::None;
  // One stone is local only if it captures nothing: a capture empties cells that
  // can be anywhere the captured chain reaches.
  const int N = cs.N;
  if (N <= 0 || x < 0 || y < 0 || x >= N || y >= N) return refuse(EyeBail::Input);
  if (cs.count + 1 >= ChainSet::kMaxPoints) return refuse(EyeBail::Input);
  const int point = flatIndex(N, x, y);
  const char* cells = board.flat();
  if (cells[point] != '.') return refuse(EyeBail::Input);

  const char me = colorChar(player);
  const char opp = colorChar(oppositeColor(player));
  const NeighborTable nt = neighborTable(N);
  const int nbCount = nt.count[point];
  const int* nbIdx = nt.idx[point].data();

  int merged[4];
  int mergedCount = 0;
  for (int k = 0; k < nbCount; ++k) {
    const int n = nbIdx[k];
    const char c = cells[n];
    const int chain = cs.id[static_cast<size_t>(n)];
    if (chain < 0) continue;
    if (c == opp && cs.libertyCount(chain) == 1) return refuse(EyeBail::Capture);
    if (c != me) continue;
    bool seen = false;
    for (int i = 0; i < mergedCount; ++i) seen = seen || merged[i] == chain;
    if (!seen && mergedCount < 4) merged[mergedCount++] = chain;
  }

  // The chain the new stone ends up in. Existing chains keep their ids, so the
  // merged ones are folded into one slot past the end of the chain set.
  const int mergedSlot = cs.count;
  const auto remap = [&](int chain) {
    for (int i = 0; i < mergedCount; ++i) {
      if (merged[i] == chain) return mergedSlot;
    }
    return chain;
  };

  // Regions whose eye verdict came from the encirclement test cannot be re-derived
  // from their own cells. They only stay valid if the move leaves them alone:
  // - a chain they border must not be joined here, because that changes both the
  //   border (the pieces become one chain) and the bounding box the test compares;
  // - two joined chains must not collapse two of the chains around an expanded
  //   region into one, which would turn "two chains surround this" into "one does".
  if (before.multiRegionCount > 0) {
    std::array<uint8_t, ChainSet::kMaxPoints> nearMerged{};  // bit i: touches merged[i]
    if (mergedCount >= 2) {
      for (int i = 0; i < mergedCount; ++i) {
        for (const int cell : cs.members(merged[i])) {
          for (int k = 0; k < nt.count[cell]; ++k) {
            const int n = nt.idx[cell][k];
            const int chain = cs.id[static_cast<size_t>(n)];
            if (chain < 0 || cs.chainColor[chain] == '.') continue;
            if (remap(chain) == mergedSlot) continue;
            nearMerged[static_cast<size_t>(chain)] |= static_cast<uint8_t>(1u << i);
          }
        }
      }
    }
    for (int i = 0; i < before.multiRegionCount; ++i) {
      const EyeBoardSummary::MultiRegion& multi = before.multiRegions[static_cast<size_t>(i)];
      unsigned joinedNearby = 0;
      for (const int chain : multi.neighbors) {
        if (remap(chain) == mergedSlot) return refuse(EyeBail::EncircledBase);
        if (mergedCount >= 2) joinedNearby |= nearMerged[static_cast<size_t>(chain)];
      }
      // More than one bit: two joined chains could collapse into one, which is
      // what the encirclement test counts.
      if ((joinedNearby & (joinedNearby - 1u)) != 0u) return refuse(EyeBail::EncircledBase);
    }
  }

  // Only a handful of chains can change: the ones an affected region counted as
  // its eye, and the one the stone joins. Tracking those instead of copying the
  // whole per-chain table is what makes this cheaper than the board-wide pass.
  int touched[kMaxTouchedChains];
  int16_t touchedBefore[kMaxTouchedChains];
  int16_t touchedNow[kMaxTouchedChains];
  int touchedCount = 0;
  int mergedEyes = 0;
  for (int i = 0; i < mergedCount; ++i) mergedEyes += before.perChain[static_cast<size_t>(merged[i])];

  const auto findTouched = [&](int chain) {
    for (int i = 0; i < touchedCount; ++i) {
      if (touched[i] == chain) return i;
    }
    return -1;
  };
  // `chain` is a chain id of the board before the move; returns the slot its delta
  // is recorded in, or -1 when the bookkeeping is full (so the caller falls back).
  const auto touch = [&](int chain) {
    const int mapped = remap(chain);
    int index = findTouched(mapped);
    if (index >= 0) return index;
    if (touchedCount >= kMaxTouchedChains) return -1;
    index = touchedCount++;
    touched[index] = mapped;
    // The merged chain is not counted in the totals yet, so its "before" is zero
    // and its starting count is the eyes its pieces carry.
    touchedBefore[index] =
        mapped == mergedSlot ? 0 : static_cast<int16_t>(before.perChain[static_cast<size_t>(mapped)]);
    touchedNow[index] = mapped == mergedSlot ? static_cast<int16_t>(mergedEyes) : touchedBefore[index];
    return index;
  };

  // Regions whose verdict can change: the one the stone lands in (it is split),
  // and every region that touches a chain the stone joins (its border now reads
  // the joined chain instead of the pieces).
  thread_local std::array<uint32_t, ChainSet::kMaxPoints> regionStamp{};
  thread_local uint32_t regionGen = 0;
  if (++regionGen == 0) {
    regionStamp.fill(0);
    regionGen = 1;
  }
  int affected[ChainSet::kMaxPoints];
  int affectedCount = 0;
  const auto markAffected = [&](int region) {
    if (region < 0 || region >= cs.count) return;
    if (cs.chainColor[region] != '.') return;
    if (regionStamp[static_cast<size_t>(region)] == regionGen) return;
    regionStamp[static_cast<size_t>(region)] = regionGen;
    affected[affectedCount++] = region;
  };
  const int ownRegion = cs.id[static_cast<size_t>(point)];
  markAffected(ownRegion);
  for (int i = 0; i < mergedCount; ++i) {
    for (const int cell : cs.members(merged[i])) {
      for (int k = 0; k < nt.count[cell]; ++k) {
        const int n = nt.idx[cell][k];
        if (cells[n] == '.') markAffected(cs.id[static_cast<size_t>(n)]);
      }
    }
  }

  // Drop what those regions contributed before the move.
  for (int a = 0; a < affectedCount; ++a) {
    const int region = affected[a];
    const int owners = before.ownerCount[static_cast<size_t>(region)];
    for (int i = 0; i < owners; ++i) {
      const int slot = touch(before.owners[static_cast<size_t>(region)][static_cast<size_t>(i)]);
      if (slot < 0) return refuse(EyeBail::Input);
      if (touchedNow[slot] > 0) --touchedNow[slot];
    }
  }

  // Re-derive their verdicts on the board after the move. Every region is walked
  // as connected components, because the region the stone landed in is usually
  // cut into several.
  // One generation per region, reserved up front so that an early refusal below
  // cannot leave marks that a later call would mistake for its own visits.
  thread_local std::array<uint32_t, ChainSet::kMaxPoints> cellStamp{};
  thread_local uint32_t cellGen = 0;
  if (cellGen + static_cast<uint32_t>(affectedCount) + 2 >= 0xFFFF0000u) {
    cellStamp.fill(0);
    cellGen = 0;
  }
  uint32_t stamp = cellGen;
  cellGen += static_cast<uint32_t>(affectedCount) + 1;
  int stack[ChainSet::kMaxPoints];
  for (int a = 0; a < affectedCount; ++a) {
    const int region = affected[a];
    const ChainSpan members = cs.members(region);
    ++stamp;
    for (const int start : members) {
      if (start == point) continue;
      if (cellStamp[static_cast<size_t>(start)] == stamp) continue;

      int top = 0;
      stack[top++] = start;
      cellStamp[static_cast<size_t>(start)] = stamp;
      int size = 0;
      bool hasMe = false;
      bool hasOpp = false;
      int distinct[4] = {0, 0, 0, 0};
      int distinctCount = 0;

      while (top > 0) {
        const int cell = stack[--top];
        ++size;
        for (int k = 0; k < nt.count[cell]; ++k) {
          const int n = nt.idx[cell][k];
          const int chain = n == point ? mergedSlot : cs.id[static_cast<size_t>(n)];
          if (n != point) {
            const char c = cells[n];
            if (c == '.') {
              if (cellStamp[static_cast<size_t>(n)] != stamp) {
                cellStamp[static_cast<size_t>(n)] = stamp;
                stack[top++] = n;
              }
              continue;
            }
            if (c == '#') continue;  // offline points are not a border colour
            if (chain < 0) continue;
            if (c == me) hasMe = true; else hasOpp = true;
          } else {
            hasMe = true;  // the stone itself borders the joined chain
          }
          const int mapped = n == point ? mergedSlot : remap(chain);
          bool seen = false;
          for (int i = 0; i < distinctCount; ++i) seen = seen || distinct[i] == mapped;
          if (!seen && distinctCount < 4) distinct[distinctCount++] = mapped;
        }
      }

      // A region is an eye candidate only when one colour borders all of it.
      if (!hasMe || hasOpp) continue;
      // Two distinct chains of ours: that verdict needs the encirclement test,
      // which looks at the board rather than at the region.
      if (distinctCount != 1) return refuse(EyeBail::EncircledNew);
      if (static_cast<double>(size) > maxSize) continue;
      const int slot = touch(distinct[0]);
      if (slot < 0) return refuse(EyeBail::Input);
      ++touchedNow[slot];
    }
  }

  // Totals: the board's own, minus the pieces that are now one chain, plus the
  // status change of every chain the move touched.
  int eyeCount = before.totals.eyeCount;
  int livingGroups = before.totals.livingGroups;
  for (int i = 0; i < mergedCount; ++i) {
    const int eyes = before.perChain[static_cast<size_t>(merged[i])];
    if (eyes >= 1) --eyeCount;
    if (eyes >= 2) --livingGroups;
  }
  int mergedNow = mergedEyes;
  for (int i = 0; i < touchedCount; ++i) {
    if (touched[i] == mergedSlot) {
      mergedNow = touchedNow[i];
      continue;
    }
    eyeCount += (touchedNow[i] >= 1 ? 1 : 0) - (touchedBefore[i] >= 1 ? 1 : 0);
    livingGroups += (touchedNow[i] >= 2 ? 1 : 0) - (touchedBefore[i] >= 2 ? 1 : 0);
  }
  if (mergedNow >= 1) ++eyeCount;
  if (mergedNow >= 2) ++livingGroups;

  out.eyeCount = eyeCount;
  out.livingGroups = livingGroups;
  return true;
}

std::vector<Pt> getDisputedTerritoryMoves(const SimpleBoard& board, const std::vector<Pt>& availableSpaces,
                                          int maxChainSize) {
  const ChainSet& cs = chainsCached(board);
  const int N = cs.N;

  std::vector<Pt> out;
  out.reserve(availableSpaces.size());
  // Every point of an empty chain shares the same answer, so evaluate each
  // chain once (0 = unknown, 1 = not contested, 2 = contested).
  thread_local std::vector<signed char> verdict;
  verdict.assign(static_cast<size_t>(cs.count), 0);
  for (const auto& [x, y] : availableSpaces) {
    const int emptyChain = cs.id[flatIndex(N, x, y)];
    if (emptyChain < 0 || static_cast<int>(cs.members(emptyChain).size()) > maxChainSize) continue;

    signed char& v = verdict[static_cast<size_t>(emptyChain)];
    if (v == 0) {
      bool hasWhite = false;
      bool hasBlack = false;
      const SmallChains neighbours = neighborChainsOfChain(cs, emptyChain);
      for (int i = 0; i < neighbours.count; ++i) {
        const int nc = neighbours.idx[i];
        if (static_cast<int>(cs.members(nc).size()) > maxChainSize) continue;
        if (cs.chainColor[nc] == 'O') hasWhite = true;
        else if (cs.chainColor[nc] == 'X') hasBlack = true;
      }
      v = (hasWhite && hasBlack) ? 2 : 1;
    }
    if (v == 2) out.emplace_back(x, y);
  }
  return out;
}

std::vector<Pt> getExpansionMoveArray(const SimpleBoard& board, const std::vector<Pt>& availableSpaces) {
  const int N = static_cast<int>(board.size());
  std::vector<Pt> emptySpaces;
  for (const auto& [x, y] : availableSpaces) {
    int emptyNeighbors = 0;
    for (const auto& [dx, dy] : kNeighbors) {
      const int nx = x + dx;
      const int ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if (board[nx][ny] == '.') emptyNeighbors++;
    }
    if (emptyNeighbors == 4) emptySpaces.emplace_back(x, y);
  }

  if (!emptySpaces.empty()) return emptySpaces;
  return getDisputedTerritoryMoves(board, availableSpaces, 1);
}

std::vector<Pt> findDisputedTerritory(const GameState& state, Color player, bool excludeFriendlyEyes,
                                      const std::vector<Pt>* knownValidMoves) {
  const SimpleBoard& board = state.board;
  const int N = state.size;
  std::vector<Pt> validMoves = knownValidMoves != nullptr ? *knownValidMoves : getAllValidMoves(state, player);

  if (excludeFriendlyEyes) {
    const EyeMap em = getAllEyesByChainId(board, player);
    PointMask friendlyEyes;
    for (const auto& [chainIdx, emptyChains] : em.eyes) {
      if (emptyChains.size() < 2) continue;
      for (const int ec : emptyChains)
        for (const int idx : em.cs.members(ec)) friendlyEyes.insert(idx);
    }
    std::vector<Pt> filtered;
    filtered.reserve(validMoves.size());
    for (const auto& [x, y] : validMoves) {
      if (!friendlyEyes.count(flatIndex(N, x, y))) filtered.emplace_back(x, y);
    }
    validMoves = std::move(filtered);
  }

  const Color opponent = oppositeColor(player);
  const ChainSet& cs = chainsCached(board);
  const std::vector<EyeCandidate> enemyEyes = getAllPotentialEyes(board, cs, opponent);

  PointMask nodesInsideEyeSpaces;
  for (const auto& space : enemyEyes)
    for (const int idx : cs.members(space.emptyChain)) nodesInsideEyeSpaces.insert(idx);

  PointMask playableInsideEnemySpace;
  for (const auto& space : enemyEyes) {
    PointMask spaceCells;
    for (const int idx : cs.members(space.emptyChain)) spaceCells.insert(idx);
    for (const int neighborChain : space.neighborChains) {
      const ChainSpan liberties = cs.liberties(neighborChain);
      if (liberties.size() > 4) continue;

      const SmallChains border = neighborChainsOfChain(cs, neighborChain);
      bool touchesPlayer = false;
      for (int i = 0; i < border.count; ++i) {
        if (cs.chainColor[border.idx[i]] == colorChar(player)) {
          touchesPlayer = true;
          break;
        }
      }
      if (!touchesPlayer) continue;

      // All of this chain's liberties must lie inside the eye space; counting is
      // enough, so no temporary list is built.
      int inside = 0;
      for (const int lib : liberties) inside += spaceCells.count(lib) ? 1 : 0;
      if (inside != static_cast<int>(liberties.size())) continue;
      for (const int lib : liberties) playableInsideEnemySpace.insert(lib);
    }
  }

  std::vector<Pt> result;
  result.reserve(validMoves.size());
  for (const auto& [x, y] : validMoves) {
    const int idx = flatIndex(N, x, y);
    if (!nodesInsideEyeSpaces.count(idx) || playableInsideEnemySpace.count(idx)) result.emplace_back(x, y);
  }
  return result;
}

}  // namespace ipvgo::game
