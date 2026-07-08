#pragma once

#include "koth_game.hpp"

namespace koth {

struct SolveResult {
  bool solved = false;
  int guesses = 0;
  int64_t bestX = 0;
  double bestAlt = -1e18;
};

/** Port of tests/koth_tune/python/solver.py (and src/dnet/solvers/kingOfTheHill/solverCore.ts). */
SolveResult solve(const Assignment& assignment, int cap = 600);

}  // namespace koth
