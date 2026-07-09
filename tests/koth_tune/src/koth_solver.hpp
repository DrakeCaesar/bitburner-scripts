#pragma once

#include "koth_game.hpp"

#include <string>
#include <vector>

namespace koth {

/** Result of phase-1 spread-order coarse scan only (no walk/recovery). */
struct CoarseScanSample {
  int gridPoints = 0;
  int probesUsed = 0;
  bool anyNonZero = false;
};

struct CoarseScanDifficultyStats {
  int difficulty = 0;
  int passwordLength = 0;
  int gridPoints = 0;
  int assignments = 0;
  int withNonZero = 0;
};

struct SolveResult {
  bool solved = false;
  int guesses = 0;
  int64_t bestX = 0;
  double bestAlt = -1e18;
  bool hasCoarseScan = false;
  CoarseScanSample coarseScan;
};

enum class SolverVariant {
  Baseline,
  New,
  Snipe,
  Ladder,
  LadderSnipe,
  LadderSnipeTuned,
};

const char* solverVariantName(SolverVariant variant);
const char* solverVariantDescription(SolverVariant variant);
std::vector<SolverVariant> allSolverVariants();
bool parseSolverVariant(const std::string& name, SolverVariant* out);

/** Port of tests/koth_tune/python/solver.py (and solverCore.ts). */
SolveResult solve(const Assignment& assignment, int cap = 600,
                  SolverVariant variant = SolverVariant::Baseline);
SolveResult solve(const Assignment& assignment, int cap, SolverVariant variant,
                  CoarseScanSample* coarseScanOut);

CoarseScanSample coarseScanSample(const Assignment& assignment);
CoarseScanDifficultyStats summarizeCoarseScans(int difficulty,
                                               const std::vector<Assignment>& assignments);

}  // namespace koth
