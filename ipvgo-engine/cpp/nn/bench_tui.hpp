#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace ipvgo::nn {

struct BenchOptions {
  int size = 5;
  int gamesPerFaction = 20;
  int budgetMs = 300;  // per-move wall-clock budget (iterative deepening)
  long iterations = 0;  // per-move node budget; takes precedence over budgetMs
  int depth = 2;       // fixed depth, used when there is no budget
  int maxDepth = 10;   // iterative-deepening ceiling
  uint64_t seed = 1;
  std::vector<std::string> factions;  // empty = every faction for this board size
};

struct FactionBenchRow {
  std::string faction;
  int games = 0;
  int wins = 0;
  int losses = 0;
  double marginSum = 0.0;
  double msSum = 0.0;
  long moves = 0;

  double winRate() const { return games > 0 ? 100.0 * static_cast<double>(wins) / games : 0.0; }
  double avgMargin() const { return games > 0 ? marginSum / games : 0.0; }
  double avgMs() const { return moves > 0 ? msSum / static_cast<double>(moves) : 0.0; }
};

// Runs Black (policy exploiter) against every faction in-process and renders a
// continuously updating terminal view: live board, current search numbers, and
// a per-faction win table. Falls back to plain lines when stdout is not a tty.
// Returns the number of factions that did not reach 100% wins.
int runExploitBench(const BenchOptions& options);

// Same run, but streams newline-delimited JSON events to stdout for the web
// bench UI (see server.js and web/bench.html).
int runExploitBenchJson(const BenchOptions& options);

}  // namespace ipvgo::nn
