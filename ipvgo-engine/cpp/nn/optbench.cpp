// A/B benchmark for the search optimisations in game/opt_flags.hpp.
//
// One process, one position set, every variant measured on exactly the same
// positions: baseline, each flag alone, and all of them together. The variants
// must produce identical answers, which is checked first so a "speedup" can
// never come from doing less work. Progress is printed and flushed line by line
// so the run can be followed live and stopped at any point.
#include "optbench.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
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
#include "opt_flags.hpp"
#include "opponents.hpp"
#include "setup.hpp"

namespace ipvgo::nn {
namespace {

using Clock = std::chrono::steady_clock;
using ipvgo::game::OptFlags;
using namespace ipvgo::game;

struct OptConfig {
  std::string key;
  OptFlags flags;
};

struct Position {
  GameState state;  // Black to move
  std::string faction;
  int ply = 0;
};

struct ConfigStats {
  std::string key;
  double totalMs = 0.0;
  long long nodes = 0;
  int searches = 0;
  int actionMismatches = 0;
  int valueMismatches = 0;
};

// Every configuration the benchmark knows about. Baseline first so the summary
// always has a reference row. The flags default to on, so the baseline has to
// spell out "all off".
std::vector<OptConfig> allConfigs() {
  std::vector<OptConfig> configs;
  configs.push_back({"baseline", ipvgo::game::kOptAllOff});
  configs.push_back({"growthCache", OptFlags{true, false, false, false}});
  configs.push_back({"fastQueries", OptFlags{false, true, false, false}});
  configs.push_back({"persistCache", OptFlags{false, false, true, false}});
  configs.push_back({"forcedPath", OptFlags{false, false, false, true}});
  configs.push_back({"all", ipvgo::game::kOptAllOn});
  return configs;
}

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

std::string pad(const std::string& text, size_t width) {
  return text.size() >= width ? text : text + std::string(width - text.size(), ' ');
}

double ratio(double base, double value) { return value > 1e-12 ? base / value : 0.0; }

// Plays both sides with the scripted faction policy so the sampled positions
// look like the ones the search sees in real games. Positions are generated
// round-robin over the factions so any prefix still covers every faction.
std::vector<Position> buildPositions(const OptBenchOptions& options, const std::vector<std::string>& factions) {
  g_opt = ipvgo::game::kOptAllOff;
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

// Board after one Black ply, i.e. the White-to-move position the search scores.
bool blackPlyThenWhiteToMove(const GameState& state, ExploitConfig cfg, GameState& out) {
  g_opt = ipvgo::game::kOptAllOff;
  cfg.flags = ipvgo::game::kOptAllOff;
  cfg.depth = 1;
  cfg.budgetMs = 0;
  cfg.nodeLimit = 0;
  const ExploitResult opening = runExploiter(state, cfg);
  out = state;
  if (opening.bestAction == passAction(state.size)) {
    passTurn(out, Color::Black);
  } else if (!makeMove(out, opening.bestAction / state.size, opening.bestAction % state.size, Color::Black)) {
    return false;
  }
  return !out.gameOver && whoseTurn(out) == Color::White;
}

bool sameReplySet(const ReplyDist& a, const ReplyDist& b) {
  if (a.replies.size() != b.replies.size()) return false;
  for (size_t i = 0; i < a.replies.size(); ++i) {
    const WeightedReply& x = a.replies[i];
    const WeightedReply& y = b.replies[i];
    if (x.passMove != y.passMove) return false;
    if (!x.passMove && (x.x != y.x || x.y != y.y)) return false;
    if (x.prob != y.prob) return false;
  }
  return true;
}

std::string summaryRow(const ConfigStats& s, double baseTotal) {
  char total[16];
  char per[16];
  char speed[16];
  std::snprintf(total, sizeof(total), "%.2f", s.totalMs);
  std::snprintf(per, sizeof(per), "%.2f", s.searches > 0 ? s.totalMs / s.searches : 0.0);
  std::snprintf(speed, sizeof(speed), "%.2fx", ratio(baseTotal, s.totalMs));
  const bool ok = s.actionMismatches == 0 && s.valueMismatches == 0;
  const std::string result = ok ? "identical"
                                : "DIFF (action " + std::to_string(s.actionMismatches) + ", value " +
                                      std::to_string(s.valueMismatches) + ")";
  return "  " + pad(s.key, 14) + pad(total, 12) + pad(per, 13) + pad(speed, 10) +
         pad(std::to_string(s.nodes), 10) + result;
}

}  // namespace

int runOptBench(const OptBenchOptions& options) {
  const std::vector<std::string> factions =
      options.factions.empty() ? defaultFactions(options.size) : options.factions;
  if (factions.empty()) {
    std::cerr << "optbench: no factions selected\n";
    return 2;
  }

  std::vector<OptConfig> configs = allConfigs();
  if (!options.only.empty()) {
    std::vector<OptConfig> filtered;
    for (const OptConfig& cfg : configs) {
      if (std::find(options.only.begin(), options.only.end(), cfg.key) != options.only.end()) filtered.push_back(cfg);
    }
    if (filtered.empty()) {
      std::cerr << "optbench: --only matched no config\n";
      return 2;
    }
    configs = std::move(filtered);
  }

  say("optbench: " + std::to_string(options.size) + "x" + std::to_string(options.size) +
      " depth=" + std::to_string(options.depth) + " reps=" + std::to_string(options.reps) +
      " seed=" + std::to_string(options.seed));

  std::string configLine;
  for (const OptConfig& cfg : configs) configLine += (configLine.empty() ? "" : "  ") + cfg.key;
  say("configs  : " + configLine);

  const auto buildStart = Clock::now();
  std::vector<Position> positions = buildPositions(options, factions);
  const double buildMs = std::chrono::duration<double, std::milli>(Clock::now() - buildStart).count();
  if (positions.empty()) {
    std::cerr << "optbench: could not build any positions\n";
    return 1;
  }
  const size_t candidates = positions.size();
  say("positions: " + std::to_string(candidates) + " candidates built in " +
      std::to_string(static_cast<long long>(buildMs)) + " ms");

  ExploitConfig cfg;
  cfg.depth = std::max(1, options.depth);
  cfg.beam = options.beam;
  cfg.whiteChildren = options.whiteChildren;
  cfg.threads = options.threads;
  cfg.budgetMs = 0;
  cfg.nodeLimit = 0;

  // Size the sweep to the requested duration: one probe search gives the cost
  // per search on this machine, and every config costs roughly that much.
  size_t wanted = candidates;
  if (options.positions > 0) {
    wanted = std::min(candidates, static_cast<size_t>(options.positions));
  } else {
    ExploitConfig probeCfg = cfg;
    probeCfg.flags = ipvgo::game::kOptAllOff;
    const auto probeStart = Clock::now();
    runExploiter(positions[0].state, probeCfg);
    const double probeMs =
        std::chrono::duration<double, std::milli>(Clock::now() - probeStart).count();
    const double perConfig = std::max(probeMs * 0.85, 1.0) * static_cast<double>(configs.size());
    const double fit = options.seconds * 1000.0 / std::max(perConfig, 1.0);
    wanted = std::min(candidates, static_cast<size_t>(std::max(1.0, std::floor(fit))));
    say("budget   : " + std::to_string(static_cast<long long>(probeMs)) + " ms per search -> " +
        std::to_string(wanted) + " position(s) for about " + std::to_string(static_cast<int>(options.seconds)) +
        " s (override with --positions=N)");
  }
  positions.resize(wanted);
  if (wanted < candidates) {
    say("using    : first " + std::to_string(wanted) + " of " + std::to_string(candidates) +
        " positions (round-robin over " + std::to_string(factions.size()) + " faction(s))");
  }

  // ---- 1. equivalence: every variant must return the same reply distribution
  say("");
  say("== reply-distribution equivalence (the White-to-move node the search hits first) ==");
  int equivalenceFailures = 0;
  int checked = 0;
  for (size_t p = 0; p < positions.size(); ++p) {
    GameState whiteToMove;
    if (!blackPlyThenWhiteToMove(positions[p].state, cfg, whiteToMove)) {
      say("  pos " + std::to_string(p) + " " + pad(positions[p].faction, 14) + " skipped (game ended)");
      continue;
    }
    const Opponent ai = parseOpponent(positions[p].faction).value_or(Opponent::Netburners);

    g_opt = ipvgo::game::kOptAllOff;
    const ReplyDist reference = opponentReplyDistribution(whiteToMove, Color::White, ai);

    std::string line = "  pos " + std::to_string(p) + " " + pad(positions[p].faction, 14) + " ply " +
                       std::to_string(positions[p].ply) + "  replies " + std::to_string(reference.replies.size());
    for (const OptConfig& variant : configs) {
      if (variant.key == "baseline") continue;
      g_opt = variant.flags;
      const bool same = sameReplySet(reference, opponentReplyDistribution(whiteToMove, Color::White, ai));
      if (!same) ++equivalenceFailures;
      line += "  " + variant.key + "=" + (same ? "ok" : "DIFF");
    }
    say(line);
    ++checked;
  }
  if (equivalenceFailures > 0) {
    say("FAIL: " + std::to_string(equivalenceFailures) + " variant(s) changed the reply distribution");
    return 1;
  }
  say("ok: " + std::to_string(checked) + " position(s), every variant identical");

  // ---- 2. timing: same searches, one config at a time, position by position
  say("");
  say("== timed searches ==");
  std::vector<ConfigStats> stats(configs.size());
  for (size_t i = 0; i < configs.size(); ++i) stats[i].key = configs[i].key;

  const int reps = std::max(1, options.reps);
  const double budgetMs = options.seconds * 1000.0;
  const auto sweepStart = Clock::now();
  size_t ran = 0;
  bool trimmed = false;
  for (size_t p = 0; p < positions.size(); ++p) {
    if (p > 0) {
      // Stop before a position that would overshoot the time budget; the
      // per-position cost varies a lot, so this is checked as we go.
      const double elapsed = std::chrono::duration<double, std::milli>(Clock::now() - sweepStart).count();
      if (options.positions == 0 && elapsed + elapsed / static_cast<double>(p) > budgetMs) {
        trimmed = true;
        break;
      }
    }
    const Position& position = positions[p];
    ExploitResult baseline;
    bool haveBaseline = false;

    for (size_t c = 0; c < configs.size(); ++c) {
      double bestMs = 0.0;
      ExploitResult result;
      for (int rep = 0; rep < reps; ++rep) {
        std::unique_ptr<ReplyCache> cache;
        if (configs[c].flags.persistCache) cache = std::make_unique<ReplyCache>();
        ExploitConfig runCfg = cfg;
        runCfg.flags = configs[c].flags;
        const auto t0 = Clock::now();
        result = runExploiter(position.state, runCfg, cache.get());
        const double ms = std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
        if (rep == 0 || ms < bestMs) bestMs = ms;
      }

      if (!haveBaseline && configs[c].key == "baseline") {
        baseline = result;
        haveBaseline = true;
      }

      ConfigStats& s = stats[c];
      s.totalMs += bestMs;
      s.nodes += result.nodes;
      ++s.searches;
      if (haveBaseline && configs[c].key != "baseline") {
        if (result.bestAction != baseline.bestAction) ++s.actionMismatches;
        if (std::fabs(result.value - baseline.value) > 1e-9) ++s.valueMismatches;
      }

      char lineText[240];
      std::snprintf(lineText, sizeof(lineText),
                    "  %-13s pos %2zu/%2zu %-14s ply %2d nodes %-7ld ms %9.2f  best %-8s value %9.4f",
                    configs[c].key.c_str(), p + 1, positions.size(), position.faction.c_str(), position.ply,
                    result.nodes, bestMs, actionText(result.bestAction, options.size).c_str(), result.value);
      say(lineText);
    }

    const double baseMs = stats[0].totalMs;
    std::string running = "  running ";
    for (size_t c = 0; c < configs.size(); ++c) {
      char buf[48];
      std::snprintf(buf, sizeof(buf), " %s %.2fx", configs[c].key.c_str(), ratio(baseMs, stats[c].totalMs));
      running += buf;
    }
    say(running);
    ++ran;
  }

  // ---- 3. summary
  const double wallMs = std::chrono::duration<double, std::milli>(Clock::now() - sweepStart).count();
  if (trimmed) {
    say("");
    say("stopped after " + std::to_string(ran) + " position(s) to stay near the " +
        std::to_string(static_cast<int>(options.seconds)) + " s budget (--seconds/--positions to change)");
  }
  say("");
  say("== summary: " + std::to_string(ran) + " positions, depth " + std::to_string(cfg.depth) + ", " +
      std::to_string(reps) + " rep(s), " + std::to_string(static_cast<long long>(wallMs)) + " ms total ==");
  say("  " + pad("config", 14) + pad("total ms", 12) + pad("per search", 13) + pad("speedup", 10) + pad("nodes", 10) +
      "result");

  const double baseTotal = stats[0].totalMs;
  int failures = 0;
  for (const ConfigStats& s : stats) {
    if (s.actionMismatches != 0 || s.valueMismatches != 0) ++failures;
    say(summaryRow(s, baseTotal));
  }

  if (failures > 0) {
    say("FAIL: " + std::to_string(failures) + " config(s) returned a different answer than baseline");
    return 1;
  }
  say("ok: every config returned the same best action and value");
  return 0;
}

}  // namespace ipvgo::nn
