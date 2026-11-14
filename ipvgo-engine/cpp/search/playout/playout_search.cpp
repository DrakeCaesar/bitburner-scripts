#include "playout_search.hpp"

#include <algorithm>
#include <chrono>

namespace ipvgo::search::playout {
namespace {

// Maps the caller's configuration onto the reference search. Every field here has a direct
// counterpart in autokroos::Config; nothing is second-guessed, because the point of this stage is
// that the engine and the reference behave identically.
autokroos::Config toReference(const PlayoutConfig& cfg) {
  autokroos::Config reference;
  reference.playouts = cfg.playoutsPerMove > 0 ? cfg.playoutsPerMove : 10000;
  reference.exploration = cfg.exploration;
  reference.useAiTweaks = cfg.useAiTweaks;
  reference.suppressTransposition = cfg.suppressTransposition;
  reference.komi = cfg.komi;
  reference.maxNodes = cfg.maxNodes;
  reference.cancel = cfg.cancel;
  return reference;
}

PlayoutResult fromReference(const ipvgo::game::GameState& root, const autokroos::Result& solved) {
  const int pass = root.size * root.size;
  PlayoutResult out;
  out.nodes = solved.nodes;
  out.cancelled = solved.cancelled;
  out.bestAction = solved.moves.empty() ? pass : solved.moves.front().pos;
  out.value = solved.moves.empty() ? 0.0 : solved.moves.front().value;

  for (const autokroos::MoveResult& move : solved.moves) {
    // The reference talks in -1 for a pass; the rest of the engine talks in N*N.
    const int action = move.pos < 0 ? pass : move.pos;
    out.rootScores.emplace_back(action, move.value);
    out.rootVisits.push_back(move.visits);
    out.playouts += move.visits;
  }
  if (out.bestAction < 0) out.bestAction = pass;
  return out;
}

PlayoutResult runReference(const ipvgo::game::GameState& root, const PlayoutConfig& cfg) {
  PlayoutResult out;
  if (root.size != kSize) {
    out.bestAction = root.size * root.size;
    out.note = "the playout engine plays 5x5 boards only";
    return out;
  }

  autokroos::Config reference = toReference(cfg);

  // A wall-clock limit becomes a playout count rather than stopping the search mid-descent: a
  // truncated descent leaves a node with visits it never earned, and the graph's values are only
  // meaningful when the playouts that produced them finished.
  if (cfg.timeLimitMs > 0) {
    // Measured on a 5x5 board: roughly 40 microseconds per playout with the opponent model in the
    // tree. The estimate only has to be the right order of magnitude, because the caller iterates.
    const long affordable = static_cast<long>(static_cast<double>(cfg.timeLimitMs) / 0.04);
    if (affordable > 0 && affordable < reference.playouts) reference.playouts = affordable;
  }

  autokroos::Result solved;
  if (!autokroos::searchGameState(root, reference, solved)) {
    out.bestAction = root.size * root.size;
    out.note = "the playout engine plays 5x5 boards only";
    return out;
  }
  return fromReference(root, solved);
}

}  // namespace

struct PlayoutSession::Impl {
  size_t history = 0;
};

PlayoutSession::PlayoutSession() : impl_(new Impl()) {}
PlayoutSession::~PlayoutSession() { delete impl_; }

void PlayoutSession::noteRequest(size_t historyEntries) {
  if (historyEntries < impl_->history) clear();
  impl_->history = historyEntries;
}

void PlayoutSession::clear() { impl_->history = 0; }

size_t PlayoutSession::nodes() const { return 0; }

PlayoutResult runPlayoutSearch(const ipvgo::game::GameState& root, const PlayoutConfig& cfg,
                               PlayoutSession* session) {
  if (session != nullptr) session->noteRequest(static_cast<size_t>(root.previousBoards.size()));
  return runReference(root, cfg);
}

PlayoutResult runAutokroosBaseline(const ipvgo::game::GameState& root, const PlayoutConfig& cfg) {
  // The reference's own constants, not the caller's: the baseline must not drift while the engine
  // is being changed.
  PlayoutConfig pinned;
  pinned.playoutsPerMove = cfg.playoutsPerMove > 0 ? cfg.playoutsPerMove : 10000;
  pinned.exploration = 0.3;
  pinned.useAiTweaks = true;
  pinned.suppressTransposition = true;
  pinned.komi = cfg.komi;
  pinned.cancel = cfg.cancel;
  return runReference(root, pinned);
}

void ponderPlayouts(const ipvgo::game::GameState& root, const PlayoutConfig& cfg, PlayoutSession& session) {
  (void)session;
  (void)runPlayoutSearch(root, cfg, nullptr);
}

}  // namespace ipvgo::search::playout
