#pragma once

#include "koth_config.hpp"
#include "koth_game.hpp"

#include <cstdint>

namespace koth {

struct SolverResult {
  int guesses = 0;
  bool solved = false;
  int64_t bestVal = 0;
  double bestAlt = -1.0;
};

SolverResult runSolverImproved(const Assignment& assignment, const ImprovedConfig& cfg);

}  // namespace koth
