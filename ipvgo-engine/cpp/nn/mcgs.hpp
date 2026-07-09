#pragma once

#include <cstdint>
#include <vector>

#include "go_game.hpp"
#include "rng.hpp"

namespace ipvgo::nn {

struct McgsConfig {
  int playouts = 10000;
  int threads = 0;  // 0 = all hardware threads
  double exploration = 0.3;
  bool useAiTweaks = false;  // rollouts use real faction AI; tweaks filter tree edges only
  bool pruneBlackMoves = true;  // search only AI-exploit moves for Black
  bool playOpponent = true;  // White children = faction MoveGen candidates, not all legal Go moves
  bool suppressTransposition = true;
};

struct McgsResult {
  std::vector<float> visitPolicy;  // size actionCount(N); pass at index N*N
  int bestAction = 0;
  float rootValue = 0.0f;
  int64_t totalRootVisits = 0;
};

// Monte Carlo Graph Search from a Black-to-move position (no cheats).
// White is modeled as the faction AI (one reply per position); playtime clock is not used.
McgsResult runMcgs(const ipvgo::game::GameState& root, const McgsConfig& cfg, uint64_t seed,
                   uint64_t mathSeed = 0, int whiteMovesCompleted = 0);

}  // namespace ipvgo::nn
