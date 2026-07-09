#pragma once

#include <random>

#include "go_game.hpp"

namespace ipvgo::nn {

using ipvgo::game::GameState;

struct StepOutcome {
  GameState next;
  bool terminal = false;
  float blackValue = 0.0f;  // valid when terminal: +1 Black win/tie, -1 loss
};

// Terminal value from Black's perspective (Black wins ties, per IPvGO rules).
float blackTerminalValue(const GameState& state);

// Apply Black's `action` (0..N*N-1 = board point, N*N = pass) and, unless the
// game has ended, the scripted White (faction) reply. White RNG seeds are drawn
// from `rng` so the environment is stochastic across visits/games.
StepOutcome stepEnvironment(const GameState& state, int action, std::mt19937_64& rng);

}  // namespace ipvgo::nn
