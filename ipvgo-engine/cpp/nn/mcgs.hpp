#pragma once

#include <cstdint>
#include <vector>

#include "go_game.hpp"

namespace ipvgo::nn {

struct McgsConfig {
  int playouts = 10000;
  double exploration = 0.3;
  bool useAiTweaks = false;  // rollouts use real faction AI; tweaks filter tree edges only
  bool suppressTransposition = true;
};

struct McgsResult {
  std::vector<float> visitPolicy;  // size actionCount(N); pass at index N*N
  int bestAction = 0;
  float rootValue = 0.0f;
  int64_t totalRootVisits = 0;
};

// Monte Carlo Graph Search from a Black-to-move position (no cheats).
// Alternates Black (search) vs modeled White (biased tactical weights).
McgsResult runMcgs(const ipvgo::game::GameState& root, const McgsConfig& cfg, uint64_t seed);

}  // namespace ipvgo::nn
