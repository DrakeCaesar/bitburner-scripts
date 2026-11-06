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
  int reps = 1;         // repeats per position; the fastest run counts
  uint64_t seed = 1;
  std::vector<std::string> factions;  // empty = every faction for this board size
  int beam = 12;
  int whiteChildren = 6;
  int threads = 0;
};

// Fixed-depth search benchmark. Builds one reproducible position set and times
// the search on it, printing progress line by line. The node count and value of
// each search are printed so two builds can be compared for parity.
int runOptBench(const OptBenchOptions& options);

}  // namespace ipvgo::nn
