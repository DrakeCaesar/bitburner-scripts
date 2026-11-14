// Fixed-depth search benchmark.
//
// One process, one reproducible position set. Each position is searched to a
// fixed depth (no time budget, so the work is identical run to run) and the
// fastest of --reps runs is kept. Node count and value are printed per search:
// when comparing two builds, differing nodes mean the search itself changed and
// the timings are not directly comparable. Progress is flushed line by line.
#include "optbench.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <random>
#include <string>
#include <utility>
#include <vector>

#include "exploiter.hpp"
#include "features.hpp"
#include "game_engine.hpp"
#include "go_game.hpp"
#include "opponents.hpp"
#include "setup.hpp"

namespace ipvgo::search {
namespace {

using Clock = std::chrono::steady_clock;
using namespace ipvgo::game;

struct Position {
  GameState state;  // Black to move
  std::string faction;
  int ply = 0;
};

std::vector<std::string> defaultFactions(int size) {
  if (size <= 13) return {"Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati"};
  return {"WorldDaemon"};
}

void say(const std::string& line) {
  std::cout << line << "\n";
  std::cout.flush();
}

std::string actionText(int action, int size) {
  if (action == passAction(size)) return "pass";
  char buf[32];
  std::snprintf(buf, sizeof(buf), "(%d,%d)", action / size, action % size);
  return buf;
}

// Plays both sides with the scripted faction policy so the sampled positions
// look like the ones the search sees in real games. Positions are generated
// round-robin over the factions so any prefix still covers every faction.
std::vector<Position> buildPositions(const OptBenchOptions& options, const std::vector<std::string>& factions) {
  std::vector<Position> positions;
  std::mt19937_64 rng(options.seed ? options.seed : 1u);

  // Spread the samples over the opening/middle game; late positions barely
  // branch, so they would drown the measurement in noise.
  const int plyTargets[] = {6, 9, 12, 15};

  for (int n = 0; n < 4; ++n) {
    for (const std::string& name : factions) {
      const Opponent ai = parseOpponent(name).value_or(Opponent::Netburners);
      const int targetPly = plyTargets[n] * options.size / 5;
      MathRandom mathRng(rng());
      const double clockMs = static_cast<double>(rng() % 30000000u);
      GameState state = newBoardState(options.size, ai, true, clockMs, mathRng);

      int ply = 0;
      bool captured = false;
      while (!state.gameOver && ply <= targetPly + options.size * options.size) {
        if (whoseTurn(state) == Color::Black && ply >= targetPly) {
          positions.push_back({state, name, ply});
          captured = true;
          break;
        }
        // Both sides follow the scripted policy; only plausible boards matter.
        const Color mover = whoseTurn(state);
        const Play play = getMove(state, mover, ai, static_cast<double>(rng() % 30000000u), mathRng);
        if (play.type == PlayType::Pass) {
          passTurn(state, mover);
        } else if (!makeMove(state, play.x, play.y, mover)) {
          passTurn(state, mover);
        }
        ++ply;
      }
      if (!captured && !state.gameOver && whoseTurn(state) == Color::Black) {
        positions.push_back({state, name, ply});
      }
    }
  }
  return positions;
}

double elapsedMs(Clock::time_point since) {
  return std::chrono::duration<double, std::milli>(Clock::now() - since).count();
}

}  // namespace

int runOptBench(const OptBenchOptions& options) {
  const std::vector<std::string> factions =
      options.factions.empty() ? defaultFactions(options.size) : options.factions;
  if (factions.empty()) {
    std::cerr << "optbench: no factions selected\n";
    return 2;
  }

  say("optbench: " + std::to_string(options.size) + "x" + std::to_string(options.size) +
      " depth=" + std::to_string(options.depth) + " reps=" + std::to_string(options.reps) +
      " seed=" + std::to_string(options.seed));

  const auto buildStart = Clock::now();
  std::vector<Position> positions = buildPositions(options, factions);
  if (positions.empty()) {
    std::cerr << "optbench: could not build any positions\n";
    return 1;
  }
  const size_t candidates = positions.size();
  say("positions: " + std::to_string(candidates) + " candidates built in " +
      std::to_string(static_cast<long long>(elapsedMs(buildStart))) + " ms");

  ExploitConfig cfg;
  cfg.depth = std::max(1, options.depth);
  cfg.beam = options.beam;
  cfg.whiteChildren = options.whiteChildren;
  cfg.threads = options.threads;
  cfg.deterministic = true;  // a benchmark has to be repeatable
  // IPVGO_DYNAMIC=1 measures the scheduler play actually uses, at the cost of
  // repeatability.
  if (std::getenv("IPVGO_DYNAMIC") != nullptr) cfg.deterministic = false;
  cfg.budgetMs = 0;
  cfg.nodeLimit = 0;

  // Size the sweep to the requested duration: one probe search gives the cost
  // per search on this machine.
  size_t wanted = candidates;
  if (options.positions > 0) {
    wanted = std::min(candidates, static_cast<size_t>(options.positions));
  } else {
    const auto probeStart = Clock::now();
    runExploiter(positions[0].state, cfg);
    const double probeMs = elapsedMs(probeStart);
    const double perPosition = std::max(probeMs * 0.85, 1.0) * static_cast<double>(std::max(1, options.reps));
    const double fit = options.seconds * 1000.0 / std::max(perPosition, 1.0);
    wanted = std::min(candidates, static_cast<size_t>(std::max(1.0, std::floor(fit))));
    say("budget   : " + std::to_string(static_cast<long long>(probeMs)) + " ms per search -> " +
        std::to_string(wanted) + " position(s) for about " + std::to_string(static_cast<int>(options.seconds)) +
        " s (override with --positions=N)");
  }
  positions.resize(wanted);

  const int reps = std::max(1, options.reps);
  double totalMs = 0.0;
  long long totalNodes = 0;
  int searches = 0;
  const auto sweepStart = Clock::now();
  for (size_t p = 0; p < positions.size(); ++p) {
    const Position& position = positions[p];
    double bestMs = 0.0;
    ExploitResult result;
    for (int rep = 0; rep < reps; ++rep) {
      ReplyCache cache;
      const auto t0 = Clock::now();
      result = runExploiter(position.state, cfg, &cache);
      const double ms = elapsedMs(t0);
      if (rep == 0 || ms < bestMs) bestMs = ms;
    }
    totalMs += bestMs;
    totalNodes += result.nodes;
    ++searches;

    char lineText[240];
    std::snprintf(lineText, sizeof(lineText), "  pos %2zu/%2zu %-14s ply %2d nodes %-7ld ms %9.2f  best %-8s value %9.4f",
                  p + 1, positions.size(), position.faction.c_str(), position.ply, result.nodes, bestMs,
                  actionText(result.bestAction, options.size).c_str(), result.value);
    say(lineText);
  }

  char summary[240];
  std::snprintf(summary, sizeof(summary),
                "== summary: %d searches, depth %d, %d rep(s), %lld ms wall: total %.2f ms, per search %.2f ms, nodes %lld ==",
                searches, cfg.depth, reps, static_cast<long long>(elapsedMs(sweepStart)), totalMs,
                searches > 0 ? totalMs / searches : 0.0, totalNodes);
  say("");
  say(summary);
  return 0;
}

}  // namespace ipvgo::search
