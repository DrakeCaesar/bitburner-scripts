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
struct SmallChains {
  static constexpr int kMax = 8;
  int count = 0;
  int idx[kMax] = {};

  std::vector<int> toVector() const {
    std::vector<int> out;
    out.reserve(static_cast<size_t>(count));
    for (int i = 0; i < count; ++i) out.push_back(idx[i]);
    return out;
  }
};

SmallChains neighborChainsSmall(const SimpleBoard& board, const ChainSet& cs, ChainSpan cells) {
  const int N = cs.N;
  PointMask cellSet;
  for (const int idx : cells) cellSet.insert(idx);
  SmallChains result;
  PointMask seen;
  for (const int idx : cells) {
    const int x = idx / N;
    const int y = idx % N;
    for (const auto& [dx, dy] : kNeighbors) {
      const int nx = x + dx;
      const int ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const int nIdx = flatIndex(N, nx, ny);
      if (cellSet.count(nIdx)) continue;
      const char c = board[nx][ny];
      if (c == '#' || c == '.') continue;
      const int nc = cs.id[nIdx];
      if (seen.count(nc)) continue;
      seen.insert(nc);
      if (result.count < SmallChains::kMax) result.idx[result.count] = nc;
      ++result.count;
    }
  }
  if (result.count > SmallChains::kMax) result.count = SmallChains::kMax;
  return result;
}

std::vector<int> neighborChainsOfCells(const SimpleBoard& board, const ChainSet& cs, ChainSpan cells) {
  return neighborChainsSmall(board, cs, cells).toVector();
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
  return neighborChainsOfCells(board, cs, cs.members(c));
}

std::vector<int> findEffectiveLibertiesOfNewMove(const SimpleBoard& board, int x, int y, Color player) {
  const ChainSet cs = computeChains(board);
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
  const ChainSet cs = computeChains(board);
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

std::vector<EyeCandidate> getAllPotentialEyes(const SimpleBoard& board, const ChainSet& cs, Color player,
                                              int maxSizeOverride) {
  int nodeCount = 0;
  for (int x = 0; x < static_cast<int>(board.size()); ++x) {
    const char* col = board.column(x);
    for (int y = 0; y < static_cast<int>(board.size()); ++y) {
      if (col[y] != '#') nodeCount++;
    }
  }

  const double maxSize = maxSizeOverride >= 0 ? static_cast<double>(maxSizeOverride)
                                              : std::min(nodeCount * 0.4, 11.0);

  std::vector<EyeCandidate> candidates;
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] != '.') continue;
    if (static_cast<double>(cs.members(c).size()) > maxSize) continue;

    const std::vector<int> neighbors = neighborChainIndices(board, cs, c);
    bool hasWhite = false;
    bool hasBlack = false;
    for (const int nc : neighbors) {
      if (cs.chainColor[nc] == 'O') hasWhite = true;
      else if (cs.chainColor[nc] == 'X') hasBlack = true;
    }
    const bool whiteEye = hasWhite && !hasBlack && player == Color::White;
    const bool blackEye = !hasWhite && hasBlack && player == Color::Black;
    if (whiteEye || blackEye) candidates.push_back({neighbors, c});
  }
  return candidates;
}

namespace {

// Mirrors findNeighboringChainsThatFullyEncircleEmptySpace.
std::vector<int> chainsThatFullyEncircle(const SimpleBoard& board, const ChainSet& cs, int candidateEmptyChain,
                                         const std::vector<int>& neighborChainList) {
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
    const std::vector<int> newNeighbors = neighborChainsOfCells(board, cs, evalCs.members(expandedChain));
    if (newNeighbors.size() == 1) result.push_back(neighborChain);
  }
  return result;
}

}  // namespace

EyeMap getAllEyesByChainId(const SimpleBoard& board, Color player) {
  EyeMap out;
  out.cs = computeChains(board);
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

std::vector<Pt> getDisputedTerritoryMoves(const SimpleBoard& board, const std::vector<Pt>& availableSpaces,
                                          int maxChainSize) {
  const ChainSet cs = computeChains(board);
  const int N = cs.N;

  std::vector<Pt> out;
  for (const auto& [x, y] : availableSpaces) {
    const int emptyChain = cs.id[flatIndex(N, x, y)];
    if (emptyChain < 0 || static_cast<int>(cs.members(emptyChain).size()) > maxChainSize) continue;

    bool hasWhite = false;
    bool hasBlack = false;
    const SmallChains neighbours = neighborChainsSmall(board, cs, cs.members(emptyChain));
    for (int i = 0; i < neighbours.count; ++i) {
      const int nc = neighbours.idx[i];
      if (static_cast<int>(cs.members(nc).size()) > maxChainSize) continue;
      if (cs.chainColor[nc] == 'O') hasWhite = true;
      else if (cs.chainColor[nc] == 'X') hasBlack = true;
    }
    if (hasWhite && hasBlack) out.emplace_back(x, y);
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

std::vector<Pt> findDisputedTerritory(const GameState& state, Color player, bool excludeFriendlyEyes) {
  const SimpleBoard& board = state.board;
  const int N = state.size;
  std::vector<Pt> validMoves = getAllValidMoves(state, player);

  if (excludeFriendlyEyes) {
    const EyeMap em = getAllEyesByChainId(board, player);
    PointMask friendlyEyes;
    for (const auto& [chainIdx, emptyChains] : em.eyes) {
      if (emptyChains.size() < 2) continue;
      for (const int ec : emptyChains)
        for (const int idx : em.cs.members(ec)) friendlyEyes.insert(idx);
    }
    std::vector<Pt> filtered;
    for (const auto& [x, y] : validMoves) {
      if (!friendlyEyes.count(flatIndex(N, x, y))) filtered.emplace_back(x, y);
    }
    validMoves = std::move(filtered);
  }

  const Color opponent = oppositeColor(player);
  const ChainSet cs = computeChains(board);
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

      const SmallChains border = neighborChainsSmall(board, cs, cs.members(neighborChain));
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
  for (const auto& [x, y] : validMoves) {
    const int idx = flatIndex(N, x, y);
    if (!nodesInsideEyeSpaces.count(idx) || playableInsideEnemySpace.count(idx)) result.emplace_back(x, y);
  }
  return result;
}

}  // namespace ipvgo::game
