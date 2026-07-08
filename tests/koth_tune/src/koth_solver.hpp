#pragma once

#include "koth_game.hpp"

#include <string>
#include <vector>

namespace koth {

struct SolveResult {
  bool solved = false;
  int guesses = 0;
  int64_t bestX = 0;
  double bestAlt = -1e18;
};

enum class SolverVariant {
  Baseline,
  TailFast,
};

const char* solverVariantName(SolverVariant variant);
const char* solverVariantDescription(SolverVariant variant);
std::vector<SolverVariant> allSolverVariants();
bool parseSolverVariant(const std::string& name, SolverVariant* out);

/** Port of tests/koth_tune/python/solver.py (and solverCore.ts). */
SolveResult solve(const Assignment& assignment, int cap = 600,
                  SolverVariant variant = SolverVariant::Baseline);

}  // namespace koth
