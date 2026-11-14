// The playout engine, as an adapter over the reference player in autokroos.{hpp,cpp}.
//
// Everything below the caller's vocabulary is the reference implementation: its own linear board,
// its own influence score, its own opponent model, its own graph search. That is deliberate. The
// engine started as a 1:1 reimplementation so that any later improvement has a number to beat, and
// `runAutokroosBaseline` pins the reference so that number stays fixed while `runPlayoutSearch`
// evolves.
#pragma once

#include <atomic>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "go_game.hpp"

#include "autokroos.hpp"

namespace ipvgo::search::playout {

constexpr int kSize = autokroos::kSize;

struct PlayoutConfig {
  // Playouts spent on one move. This is the engine's only search budget: no depth, no node count.
  long playoutsPerMove = 10000;
  // PUCT constant. Higher spreads playouts over more children.
  double exploration = 0.3;
  // White's replies weighted and culled by its faction policy. Off makes White explore every
  // legal point, which is a different (and much worse) opponent model.
  bool useAiTweaks = true;
  // Stop a descent when an edge has contributed less than the child already holds.
  bool suppressTransposition = true;
  double komi = 0.0;
  int maxNodes = 200000;
  // A wall-clock cap, converted to a playout count. 0 means "play the playouts asked for".
  int timeLimitMs = 0;
  const std::atomic<bool>* cancel = nullptr;
};

struct PlayoutResult {
  int bestAction = 0;  // x * N + y, or N * N for pass
  // Mean score of the chosen move's position: Black's share of the board, where higher is better
  // and the playout's finished board is what produced it.
  double value = 0.0;
  long playouts = 0;  // playouts that reached the root's children
  long nodes = 0;     // positions in the graph
  bool cancelled = false;
  std::string note;
  // Root children, best first: (action, value). `rootVisits` is aligned with it.
  std::vector<std::pair<int, double>> rootScores;
  std::vector<long> rootVisits;
};

// Kept so a caller can carry per-game state across a game without caring what the engine keeps.
// The graph search rebuilds its graph per move, so this only tracks the history length to notice a
// new game started.
class PlayoutSession {
 public:
  struct Impl;

  PlayoutSession();
  ~PlayoutSession();
  PlayoutSession(const PlayoutSession&) = delete;
  PlayoutSession& operator=(const PlayoutSession&) = delete;

  Impl* impl() const { return impl_; }

  void noteRequest(size_t historyEntries);
  void clear();
  size_t nodes() const;

 private:
  Impl* impl_;
};

// The engine. This is where improvements land.
PlayoutResult runPlayoutSearch(const ipvgo::game::GameState& root, const PlayoutConfig& cfg,
                               PlayoutSession* session = nullptr);

// The frozen reference: the same search with the reference's own constants, so `baselineplay` keeps
// reporting the number the engine is measured against.
PlayoutResult runAutokroosBaseline(const ipvgo::game::GameState& root, const PlayoutConfig& cfg);

// Runs the search again with the caller's cancel flag deciding when to stop. Used while waiting for
// White.
void ponderPlayouts(const ipvgo::game::GameState& root, const PlayoutConfig& cfg, PlayoutSession& session);

}  // namespace ipvgo::search::playout
