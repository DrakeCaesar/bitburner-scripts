// Bit-plane liberty queries for the move generators.
//
// The chains these ask about are small, but there are a lot of queries per
// position (every liberty of every friendly chain, every liberty of every enemy
// chain), so they run off word masks instead of a stone-by-stone chain walk. The
// chain-walk versions they replaced were removed once every caller moved over;
// the reference implementations they were checked against are in analysis.cpp
// (selftest compares the two).
#include <algorithm>
#include <cstdint>

#include "analysis.hpp"
#include "go_game.hpp"

namespace ipvgo::game {

// ---- Bit-plane queries -----------------------------------------------------
//
// The chains these ask about are small, but there are a lot of queries per
// position (every liberty of every friendly chain, every liberty of every enemy
// chain), and the chain walk they replaced was the second-largest exclusive cost
// in the profile after the flood fill itself.

namespace {

template <int W>
void floodChainInto(const uint64_t* stones, int idx, const BitLayout& layout, int n, uint64_t* chain) {
  for (int w = 0; w < W; ++w) chain[w] = 0;
  chain[idx >> 6] |= 1ULL << (idx & 63);
  bits::flood<W>(stones, chain, layout, n);
}

template <int W>
int libertyCountBits(const uint64_t* chain, const BitPlanes& planes, const BitLayout& layout, int n,
                     uint64_t* liberties) {
  bits::neighbours<W>(chain, layout, n, liberties);
  int count = 0;
  for (int w = 0; w < W; ++w) {
    liberties[w] &= planes.empty[w];
    count += static_cast<int>(__popcnt64(liberties[w]));
  }
  return count;
}

template <int W>
int effectiveLibertyCountBits(const BitPlanes& planes, const BitLayout& layout, int n, int idx, bool black) {
  const uint64_t* stones = black ? planes.black : planes.white;
  uint64_t through[W];
  for (int w = 0; w < W; ++w) through[w] = stones[w];
  through[idx >> 6] |= 1ULL << (idx & 63);  // the stone being placed joins them all
  uint64_t chain[W];
  floodChainInto<W>(through, idx, layout, n, chain);
  uint64_t liberties[W];
  int count = libertyCountBits<W>(chain, planes, layout, n, liberties);
  // The point itself is empty and, if it touches a friendly stone, gets counted.
  count -= static_cast<int>((liberties[idx >> 6] >> (idx & 63)) & 1);
  return count;
}

template <int W>
int minAdjacentLibertyCountBits(const BitPlanes& planes, const BitLayout& layout, int n, int idx, bool black,
                                const NeighborTable& nt) {
  const uint64_t* stones = black ? planes.black : planes.white;
  uint64_t seen[W];
  for (int w = 0; w < W; ++w) seen[w] = 0;
  int best = 99;
  const int count = nt.count[idx];
  const int* neighbours = nt.idx[idx].data();
  for (int k = 0; k < count; ++k) {
    const int stone = neighbours[k];
    if (((stones[stone >> 6] >> (stone & 63)) & 1ULL) == 0) continue;
    if (((seen[stone >> 6] >> (stone & 63)) & 1ULL) != 0) continue;
    uint64_t chain[W];
    floodChainInto<W>(stones, stone, layout, n, chain);
    for (int w = 0; w < W; ++w) seen[w] |= chain[w];
    uint64_t liberties[W];
    best = std::min(best, libertyCountBits<W>(chain, planes, layout, n, liberties));
  }
  return best;
}

template <int W>
void weakestAdjacentBits(const BitPlanes& planes, const BitLayout& layout, int n, int idx, bool black,
                         const NeighborTable& nt, const ChainSet& cs, BoardBits::Weakest& out) {
  const uint64_t* stones = black ? planes.black : planes.white;
  uint64_t seen[W];
  for (int w = 0; w < W; ++w) seen[w] = 0;
  uint64_t bestLiberties[W];
  for (int w = 0; w < W; ++w) bestLiberties[w] = 0;
  const int count = nt.count[idx];
  const int* neighbours = nt.idx[idx].data();
  for (int k = 0; k < count; ++k) {
    const int stone = neighbours[k];
    if (((stones[stone >> 6] >> (stone & 63)) & 1ULL) == 0) continue;
    if (((seen[stone >> 6] >> (stone & 63)) & 1ULL) != 0) continue;
    uint64_t chain[W];
    floodChainInto<W>(stones, stone, layout, n, chain);
    for (int w = 0; w < W; ++w) seen[w] |= chain[w];
    uint64_t liberties[W];
    const int libertiesCount = libertyCountBits<W>(chain, planes, layout, n, liberties);
    // The first chain of the scan order wins a tie, matching the reference.
    if (!out.found || libertiesCount < out.liberties) {
      out.found = true;
      out.liberties = libertiesCount;
      int stoneCount = 0;
      for (int w = 0; w < W; ++w) stoneCount += static_cast<int>(__popcnt64(chain[w]));
      out.stones = stoneCount;
      for (int w = 0; w < W; ++w) bestLiberties[w] = liberties[w];
    }
  }
  if (!out.found) return;
  // Distinct chains the liberty points belong to.
  int groups[8];
  int groupCount = 0;
  for (int w = 0; w < W; ++w) {
    uint64_t word = bestLiberties[w];
    while (word != 0) {
      unsigned long bit = 0;
      _BitScanForward64(&bit, word);
      word &= word - 1;
      const int point = w * 64 + static_cast<int>(bit);
      const int chain = point < static_cast<int>(cs.id.size()) ? cs.id[static_cast<size_t>(point)] : -1;
      bool seenGroup = false;
      for (int i = 0; i < groupCount; ++i) seenGroup = seenGroup || groups[i] == chain;
      if (!seenGroup && groupCount < 8) groups[groupCount++] = chain;
    }
  }
  out.libertyGroups = groupCount;
}

}  // namespace

BoardBits::BoardBits(const SimpleBoard& board) {
  BitPlanes::load(board, planes_);
  n_ = planes_.N;
  layout_ = &BitLayout::forSize(n_);
}

int BoardBits::effectiveLibertyCount(int x, int y, Color player) const {
  const int idx = x * n_ + y;
  const bool black = player == Color::Black;
  switch ((n_ * n_ + 63) / 64) {
    case 1: return effectiveLibertyCountBits<1>(planes_, *layout_, n_, idx, black);
    case 2: return effectiveLibertyCountBits<2>(planes_, *layout_, n_, idx, black);
    case 3: return effectiveLibertyCountBits<3>(planes_, *layout_, n_, idx, black);
    case 4: return effectiveLibertyCountBits<4>(planes_, *layout_, n_, idx, black);
    case 5: return effectiveLibertyCountBits<5>(planes_, *layout_, n_, idx, black);
    default: return effectiveLibertyCountBits<6>(planes_, *layout_, n_, idx, black);
  }
}

int BoardBits::minAdjacentLibertyCount(int x, int y, Color player) const {
  const int idx = x * n_ + y;
  const bool black = player == Color::Black;
  const NeighborTable nt = neighborTable(n_);
  switch ((n_ * n_ + 63) / 64) {
    case 1: return minAdjacentLibertyCountBits<1>(planes_, *layout_, n_, idx, black, nt);
    case 2: return minAdjacentLibertyCountBits<2>(planes_, *layout_, n_, idx, black, nt);
    case 3: return minAdjacentLibertyCountBits<3>(planes_, *layout_, n_, idx, black, nt);
    case 4: return minAdjacentLibertyCountBits<4>(planes_, *layout_, n_, idx, black, nt);
    case 5: return minAdjacentLibertyCountBits<5>(planes_, *layout_, n_, idx, black, nt);
    default: return minAdjacentLibertyCountBits<6>(planes_, *layout_, n_, idx, black, nt);
  }
}

BoardBits::Weakest BoardBits::weakestAdjacent(const ChainSet& cs, int x, int y, Color stone) const {
  Weakest out;
  const int idx = x * n_ + y;
  const bool black = stone == Color::Black;
  const NeighborTable nt = neighborTable(n_);
  switch ((n_ * n_ + 63) / 64) {
    case 1: weakestAdjacentBits<1>(planes_, *layout_, n_, idx, black, nt, cs, out); break;
    case 2: weakestAdjacentBits<2>(planes_, *layout_, n_, idx, black, nt, cs, out); break;
    case 3: weakestAdjacentBits<3>(planes_, *layout_, n_, idx, black, nt, cs, out); break;
    case 4: weakestAdjacentBits<4>(planes_, *layout_, n_, idx, black, nt, cs, out); break;
    case 5: weakestAdjacentBits<5>(planes_, *layout_, n_, idx, black, nt, cs, out); break;
    default: weakestAdjacentBits<6>(planes_, *layout_, n_, idx, black, nt, cs, out); break;
  }
  return out;
}

}  // namespace ipvgo::game