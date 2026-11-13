#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace ipvgo::nn {

struct BenchOptions {
  // A game to replay instead of generating one: exactly the game a previous run played.
  // Every game's inputs come from (seed, faction, game number), so naming those three is
  // enough to reproduce the board and White's replies; only the search settings differ.
  // That makes a locked set a regression test for tuning.
  struct ReplayGame {
    std::string faction;
    int game = 0;  // 1-based, as shown in the GUI
  };

  int size = 5;
  int gamesPerFaction = 20;
  int budgetMs = 300;  // per-move wall-clock budget (iterative deepening)
  long iterations = 0;  // per-move node budget; takes precedence over budgetMs
  int depth = 2;       // fixed depth, used when there is no budget
  // Iterative-deepening ceiling. 10 matches the engine default; 0 asks for the automatic
  // ceiling, which only takes effect with `autoDepth` (or IPVGO_AUTODEPTH=1).
  int maxDepth = 10;
  // The three deepening-loop switches (see ExploitConfig). Off = the pre-11-Nov behaviour.
  bool autoDepth = false;
  bool perMoveBudget = false;
  bool widen = false;
  uint64_t seed = 1;
  std::vector<std::string> factions;  // empty = every faction for this board size

  // Search tuning, mirrors ExploitConfig. Defaults equal the engine defaults.
  int beam = 12;
  int whiteChildren = 6;
  double whiteMass = 0.9;
  int endgameEmpties = 6;
  long nodeBudget = 30000;
  int threads = 0;
  bool carry = false;  // share a depth-aware memo across the moves of a game
  // Root scheduler. Off = the deterministic round-robin split: every worker gets a
  // fixed 1/threads slice of the node budget up front, which repeats exactly but
  // discards a ply as soon as one expensive root move outgrows its slice. On = the
  // dynamic scheduler play uses: a worker claims the next root move when it finishes
  // the previous one and each move gets a share of what is left, so it is both
  // stronger (-5 points at 12 threads) and unable to starve a move - at the cost of
  // run-to-run variation. See "The scheduler changes strength, not just speed".
  bool dynamicRoot = false;
  // Play this many games at the same time instead of one at a time. Each game still
  // searches on a single thread (`threads` is forced to 1), which is the trade the tuner
  // measured: independent games scale with the core count, parallel search inside one
  // game does not. Games are independent by construction - each is seeded from (seed,
  // faction, game number) - so the answers do not depend on this setting. 0 or 1 = one
  // game at a time.
  int gamesInParallel = 0;
  // Per-faction overrides of the three width settings, produced by `tune`. A faction
  // that is absent (or leaves a field at 0) uses the global values above, so a stored
  // setting only ever changes the faction it was tuned for.
  struct FactionTuning {
    int beam = 0;
    int whiteChildren = 0;
    double whiteMass = 0.0;
  };
  std::vector<std::pair<std::string, FactionTuning>> tuningByFaction;
  // Emit, per half-move, what the leaf evaluator thought of the position, how
  // likely the opponent's actual reply was under the policy model, and the value of
  // a fixed one-ply search. This is the audit trail the loss explanation is built
  // from; the cost is a fixed one-ply search plus one policy build per move -
  // measured under 10% at 5x5 and 7x7, about 13% at 13x13 and about 50% at 19x19 on
  // a 3000-node budget - so the web bench leaves it on.
  bool audit = true;
  // "Faction:game" entries. When set only those games run, each seeded from
  // (seed, faction, game) so it does not depend on the games played before it.
  std::vector<std::string> only;
  // When non-empty, exactly these games are played, in this order, and `factions`,
  // `gamesPerFaction` and `only` are ignored. Only the search settings come from
  // the rest of this struct.
  std::vector<ReplayGame> replay;
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
