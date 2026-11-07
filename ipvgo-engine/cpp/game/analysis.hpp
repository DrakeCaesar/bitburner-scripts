#pragma once

#include <array>
#include <optional>
#include <utility>
#include <vector>

#include "bitboard.hpp"
#include "go_game.hpp"

namespace ipvgo::game {

using Pt = std::pair<int, int>;  // (x, y)

// Up to four orthogonal neighbours in N, E, S, W order (the order every
// reference implementation walks them in). Fixed capacity: this used to return a
// std::vector and was one of the largest allocation sites in the search.
struct Neighbors {
  int idx[4] = {0, 0, 0, 0};
  int count = 0;
  const int* begin() const { return idx; }
  const int* end() const { return idx + count; }
};

// Neighbor flat indices (N, E, S, W order) that are on-board (any content).
Neighbors onBoardNeighbors(int N, int x, int y);

// Effective liberties a stone of `player` would have if played at (x,y):
// direct empty neighbors plus liberties of connected friendly chains, minus
// the move point itself. Returns unique liberty flat indices.
std::vector<int> findEffectiveLibertiesOfNewMove(const SimpleBoard& board, int x, int y, Color player);

// Fewest-liberty count among neighbor chains whose color == player (99 if none).
int findMinLibertyCountOfAdjacentChains(const SimpleBoard& board, int x, int y, Color player);

// Info about the neighbor chain (of color == player) with the fewest liberties.
struct WeakestChain {
  bool found = false;
  int length = 0;
  std::vector<int> liberties;  // flat indices
};
WeakestChain findEnemyNeighborChainWithFewestLiberties(const SimpleBoard& board, int x, int y, Color player);

// Chain-free equivalents (see fast_queries.cpp). Same results, without building
// a board-wide ChainSet.
std::vector<int> findEffectiveLibertiesOfNewMoveFast(const SimpleBoard& board, int x, int y, Color player);
// Same count as findEffectiveLibertiesOfNewMoveFast(...).size() without the vector.
int effectiveLibertyCountFast(const SimpleBoard& board, int x, int y, Color player);
WeakestChain findWeakestAdjacentChainFast(const SimpleBoard& board, int x, int y, Color chainColor);
int findMinLibertyCountOfAdjacentChainsFast(const SimpleBoard& board, int x, int y, Color chainColor);

// Bit-plane view of one board: load it once for a position and then answer many
// point queries from it. The move generators ask for the liberties of every
// candidate point, and these are the same answers fast_queries.cpp reaches by
// walking a chain stone by stone - a flood over words instead of over stones.
class BoardBits {
 public:
  explicit BoardBits(const SimpleBoard& board);
  const ipvgo::game::BitPlanes& planes() const { return planes_; }
  int size() const { return n_; }
  bool usable() const { return ipvgo::game::BitPlanes::fits(n_); }

  // Empty neighbours of the chain a stone of `player` at (x,y) would form, not
  // counting (x,y) itself: what effectiveLibertyCountFast() returns.
  int effectiveLibertyCount(int x, int y, Color player) const;

  // Fewest liberties among the distinct `player` chains touching (x,y), or 99 when
  // there are none: what findMinLibertyCountOfAdjacentChainsFast() returns.
  int minAdjacentLibertyCount(int x, int y, Color player) const;

  struct Weakest {
    bool found = false;
    int stones = 0;         // stones in the chain
    int liberties = 0;      // its distinct empty neighbours
    int libertyGroups = 0;  // distinct chains those liberties belong to
  };
  // The adjacent chain of `stone` colour with the fewest liberties (first in
  // N/E/S/W order on ties), which is what weakestAdjacentChain() is asked for.
  Weakest weakestAdjacent(const ChainSet& cs, int x, int y, Color stone) const;

 private:
  ipvgo::game::BitPlanes planes_;
  const ipvgo::game::BitLayout* layout_ = nullptr;
  int n_ = 0;
};

// At most a handful of distinct chains, held inline so a candidate costs no
// allocation. More than kMax neighbours are dropped (a large empty region can
// border many chains, and the callers only care about the first few).
struct ChainList {
  static constexpr int kMax = 8;
  int count = 0;
  int idx[kMax] = {};

  int size() const { return count; }
  bool empty() const { return count == 0; }
  int operator[](size_t i) const { return idx[i]; }
  const int* begin() const { return idx; }
  const int* end() const { return idx + count; }

  std::vector<int> toVector() const { return std::vector<int>(idx, idx + count); }
};

// Empty-region "eye" candidate: the empty chain plus the stone chains that
// border it (all one color). Indices refer to the ChainSet returned alongside.
struct EyeCandidate {
  ChainList neighborChains;  // stone chain indices bordering the empty chain
  int emptyChain = -1;       // empty chain index
};
std::vector<EyeCandidate> getAllPotentialEyes(const SimpleBoard& board, const ChainSet& cs, Color player,
                                              int maxSizeOverride = -1);

// Map of stone-chain index -> list of empty-chain indices that are true eyes of
// that chain (single-color enclosure). Returned with the ChainSet used.
struct EyeMap {
  ChainSet cs;
  std::vector<std::pair<int, std::vector<int>>> eyes;  // chainIdx -> empty chain indices
};
EyeMap getAllEyesByChainId(const SimpleBoard& board, Color player);

// The two numbers eyeCounts() derives from an eye map, so a caller that only
// compares before and after a move does not need the map at all.
struct EyeTotals {
  int eyeCount = 0;      // chains with at least one eye
  int livingGroups = 0;  // chains with at least two
};

// Everything getAllEyesByChainId() + eyeCounts() derive, in fixed storage: one
// count per stone chain, and one owner list per empty chain (which chain, if any,
// has that region as an eye). No map, no vector, no ChainSet copy, so this is what
// the move generators use while they evaluate candidate points.
struct EyeBoardSummary {
  static constexpr int kMaxOwners = ChainList::kMax;
  static constexpr int kMaxMultiRegions = 8;

  EyeTotals totals;
  std::array<uint8_t, ChainSet::kMaxPoints> perChain{};   // eyes per stone chain
  std::array<uint8_t, ChainSet::kMaxPoints> ownerCount{};  // owners per empty chain
  std::array<std::array<int16_t, kMaxOwners>, ChainSet::kMaxPoints> owners{};
  // Candidates that needed chainsThatFullyEncircle(): the ones whose verdict
  // depends on the whole board instead of on the region. Kept with their border
  // chains, because the incremental path below can still answer a move that
  // leaves those verdicts alone.
  struct MultiRegion {
    int region = -1;
    ChainList neighbors;
  };
  std::array<MultiRegion, kMaxMultiRegions> multiRegions{};
  int multiRegionCount = 0;
  int multiNeighbour = 0;  // candidates that needed the encirclement test
};

// Same result as eyeCounts(getAllEyesByChainId(board, player)), plus the detail
// that eyeTotalsAfterMove() needs. `cs` must be the chain set of `board`.
EyeBoardSummary summarizeEyes(const SimpleBoard& board, const ChainSet& cs, Color player);

// The largest empty region that can still count as an eye: the rule
// getAllPotentialEyes uses.
double eyeCandidateMaxSize(const SimpleBoard& board);

// Why the incremental path declined a position; only used to report the fast-path
// rate from `eyetest`.
enum class EyeBail {
  None,
  Input,        // not an empty in-board point, or the chain set is full
  Capture,      // the move captures, so the change is not local
  EncircledBase,  // an existing encirclement verdict would change
  EncircledNew,   // a re-derived region's verdict needs the encirclement test
};

// Totals for `board` with one extra `player` stone at (x,y), derived from the
// summary of the board without it. One stone only changes the empty region it
// lands in and the chains it joins, so re-deriving the board-wide analysis is
// wasted work; this does the local equivalent.
//
// Returns false when the position is outside what that reasoning covers - a
// capture (stones disappear all over the board), or a region whose verdict needs
// the encirclement test - and the caller must then do the full analysis.
bool eyeTotalsAfterMove(const SimpleBoard& board, const ChainSet& cs, const EyeBoardSummary& before,
                        Color player, int x, int y, double maxSize, EyeTotals& out,
                        EyeBail* bail = nullptr);
// Non-empty neighbor chains of chain c (distinct, first-encounter order).
std::vector<int> neighborChainIndices(const SimpleBoard& board, const ChainSet& cs, int c);

// findDisputedTerritory: valid moves worth considering (excludes dead interior
// of enemy-surrounded space unless attackable; optionally excludes friendly eyes).
std::vector<Pt> findDisputedTerritory(const GameState& state, Color player, bool excludeFriendlyEyes,
                                      const std::vector<Pt>* knownValidMoves = nullptr);

// Empty available spaces that border BOTH colors (contested).
std::vector<Pt> getDisputedTerritoryMoves(const SimpleBoard& board, const std::vector<Pt>& availableSpaces,
                                          int maxChainSize = 99);

// Open-area expansion targets (empty points surrounded by 4 empties), or, once
// none remain, disputed endgame points.
std::vector<Pt> getExpansionMoveArray(const SimpleBoard& board, const std::vector<Pt>& availableSpaces);

}  // namespace ipvgo::game
