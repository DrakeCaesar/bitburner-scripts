// Reference playout player for 5x5 boards, reimplemented from the published algorithm of the
// classic Illuminati 5x5 script (widely distributed as "autokroos"). This is a baseline: it is
// here to be measured against, so it deliberately keeps the original's design decisions rather
// than improving on them.
//
// The algorithm, end to end:
//
//   board      A flat array of 25 small integers: -1 offline, 0 empty, 1 black, 2 white. Every
//              kernel - liberties, capture, legality, influence - walks that array with a
//              constant stride. No nested arrays, no per-move allocation.
//
//   identity   A Zobrist hash of (stones, side to move) identifies a position, so the search is a
//              graph. Two move orders that reach one board share a node, and a node's score is
//              rebuilt as the visit-weighted mean of its children rather than accumulated
//              independently. That is the whole point of the graph: work already done is reused.
//
//   value      A playout played to a finished board and scored by an influence map, not by a
//              hand-written evaluation. The playout avoids filling its own eyes and avoids
//              pointless self-atari, which is what separates a meaningful playout from a random
//              one.
//
//   selection  PUCT with a standard-deviation prior: an unexplored child is scored by how
//              uncertain its parent is, so a position the search knows little about is explored
//              before one whose value is already nailed down.
//
//   opponent   White is a scripted policy, not an adversary, so its edges are weighted by how
//              likely it is to play each reply and the tail of that distribution is culled. This
//              is what keeps the playouts from being spent on lines the opponent never plays.
//
// Deviations from the reference implementation, all deliberate:
//   * Zobrist keys are generated from a fixed splitmix sequence instead of a table of literals.
//     The values only have to be well spread and stable within a run.
//   * The playout's "is anything of mine already in atari next to this point" test reads the
//     current board. The reference reads the board the playout started from, which goes stale
//     after the first ply; reading the current board is what that code means.
//   * The transposition table is keyed by the same 32-bit Zobrist hash but stores node indices
//     rather than object references, so growing the node array cannot dangle.
#pragma once

#include <array>
#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

#include <ankerl/unordered_dense.h>

#include "go_game.hpp"

namespace ipvgo::search::playout::autokroos {

constexpr int kSize = 5;
constexpr int kPoints = kSize * kSize;

// Cell codes. The reference uses -1/0/1/2 and every kernel depends on that ordering.
constexpr int8_t kOffline = -1;
constexpr int8_t kEmpty = 0;
constexpr int8_t kBlackStone = 1;
constexpr int8_t kWhiteStone = 2;

using Board = std::array<int8_t, kPoints>;

struct Config {
  long playouts = 10000;
  double exploration = 0.3;
  bool useAiTweaks = true;
  bool suppressTransposition = true;
  double komi = 0.0;
  int maxNodes = 200000;
  const std::atomic<bool>* cancel = nullptr;
};

struct MoveResult {
  int pos = -1;     // flat index, -1 for pass
  long visits = 0;
  double value = 0.0;  // node score of the position after the move, 0..1 for Black
  int weight = 1;      // opponent-model weight, 1 when the tweaks are off or it is Black's turn
};

struct Result {
  double q = 0.0;  // root score
  double s = 0.0;  // root PUCT prior, reported for parity with the reference's return value
  std::vector<MoveResult> moves;  // best first, by visits
  long nodes = 0;
  bool cancelled = false;
};

// ---- Building blocks, exposed because each one is worth testing on its own ----

// Converts the engine's request state. `valid` is false when the board is not 5x5.
bool fromGameState(const ipvgo::game::GameState& state, Board& out);

// Board hashes of the game's move history, for superko. Empty when the history cannot be read.
std::vector<uint32_t> historyHashes(const ipvgo::game::GameState& state);

uint32_t hashBoard(const Board& board, bool blackToPlay);

// Liberty count of the chain holding each point; -1 for empty and offline points.
void libertyCounts(const Board& board, int8_t* out);

// Applies a move if it is legal, writing the result into `next` and reporting whether it was.
// `liberties` must come from libertyCounts() on `board`.
bool applyMove(const Board& board, Board& next, const int8_t* liberties, int x, int y,
               bool blackToPlay);

// Influence map: 1 where Black controls, 2 where White controls, 0 where neither does, and the
// stone colours on the stones themselves.
void influenceMap(const Board& board, int8_t* out);

// The engine's score for a finished board. `immediate` counts stones plus the influence map
// directly; otherwise the influence map alone decides, which is what the playout reports.
double terminalScore(const Board& board, bool immediate);

// How many separate eyes White has. Used by the opponent model to notice eye-making moves.
int whiteEyeCount(const Board& board);

// One playout. `history` is the superko set for the line this playout starts from, and is extended
// as the playout proceeds.
double playout(Board board, bool blackToPlay, const ankerl::unordered_dense::set<uint32_t>& history,
               double komi);

// ---- The search ----

// `whitePassedLast` seeds the "a pass has happened, so the game may end" state.
// `seenHashes` is the game's own history, which the search must respect for superko.
Result search(const Board& root, bool whitePassedLast, const std::vector<uint32_t>& seenHashes,
              const Config& cfg);

// Convenience wrapper for a request state. Returns false, leaving `out` empty, when the board is
// not 5x5.
bool searchGameState(const ipvgo::game::GameState& state, const Config& cfg, Result& out);

// The children a node would get, as (pos, weight) with the pass edge first as (-1, 0).
//
// This exists for parity testing: the weights are the opponent model, which is most of the
// engine's strength, and a single flipped condition there would be invisible in a win-rate
// measurement while changing every playout. Exposing the enumeration lets a test compare it
// against the reference implementation case by case.
void enumerateChildren(const Board& board, bool blackToPlay, const Config& cfg,
                       std::vector<std::pair<int, int>>& out);

}  // namespace ipvgo::search::playout::autokroos
