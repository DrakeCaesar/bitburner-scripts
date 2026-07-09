#pragma once

#include <optional>
#include <utility>
#include <vector>

#include "go_game.hpp"

namespace ipvgo::game {

using Pt = std::pair<int, int>;  // (x, y)

// Neighbor flat indices (N, E, S, W order) that are on-board (any content).
std::vector<int> onBoardNeighbors(int N, int x, int y);

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

// Empty-region "eye" candidate: the empty chain plus the stone chains that
// border it (all one color). Indices refer to the ChainSet returned alongside.
struct EyeCandidate {
  std::vector<int> neighborChains;  // stone chain indices bordering the empty chain
  int emptyChain = -1;              // empty chain index
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

// Non-empty neighbor chains of chain c (distinct, first-encounter order).
std::vector<int> neighborChainIndices(const SimpleBoard& board, const ChainSet& cs, int c);

// findDisputedTerritory: valid moves worth considering (excludes dead interior
// of enemy-surrounded space unless attackable; optionally excludes friendly eyes).
std::vector<Pt> findDisputedTerritory(const GameState& state, Color player, bool excludeFriendlyEyes);

// Empty available spaces that border BOTH colors (contested).
std::vector<Pt> getDisputedTerritoryMoves(const SimpleBoard& board, const std::vector<Pt>& availableSpaces,
                                          int maxChainSize = 99);

// Open-area expansion targets (empty points surrounded by 4 empties), or, once
// none remain, disputed endgame points.
std::vector<Pt> getExpansionMoveArray(const SimpleBoard& board, const std::vector<Pt>& availableSpaces);

}  // namespace ipvgo::game
