#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace ipvgo::nn {

struct OptBenchOptions {
  int size = 5;
  int positions = 0;    // 0 = pick automatically to fit `seconds`
  double seconds = 20;  // target wall-clock time for the timing sweep
  int depth = 3;        // fixed search depth, no budget so runs are repeatable
  int reps = 1;         // repeats per (position, config); the fastest run counts
  uint64_t seed = 1;
  std::vector<std::string> factions;  // empty = every faction for this board size
  std::vector<std::string> only;      // empty = every config
  int beam = 12;
  int whiteChildren = 6;
  int threads = 0;
};

// A/B benchmark of the search optimisations from game/opt_flags.hpp. Builds one
// position set, proves every variant returns the same answers, then times the
// baseline against each flag alone and all of them together on the same
// positions, printing progress as it goes. Returns non-zero on a mismatch.
int runOptBench(const OptBenchOptions& options);

}  // namespace ipvgo::nn
