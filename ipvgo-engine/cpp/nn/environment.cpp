#include "environment.hpp"

#include "features.hpp"
#include "opponents.hpp"

namespace ipvgo::nn {

using namespace ipvgo::game;

float blackTerminalValue(const GameState& state) {
  const Score sc = getScore(state);
  return blackWins(sc) ? 1.0f : -1.0f;
}

StepOutcome stepEnvironment(const GameState& state, int action, std::mt19937_64& rng) {
  StepOutcome out;
  out.next = state;
  const int N = state.size;

  // --- Black move ---
  if (action == passAction(N)) {
    passTurn(out.next, Color::Black);
  } else {
    const int x = action / N;
    const int y = action % N;
    if (!makeMove(out.next, x, y, Color::Black)) {
      // Illegal action requested; treat as pass (should not happen with masking).
      passTurn(out.next, Color::Black);
    }
  }

  if (out.next.gameOver) {
    out.terminal = true;
    out.blackValue = blackTerminalValue(out.next);
    return out;
  }

  // --- White (scripted faction) reply ---
  const double whiteSeed = static_cast<double>(rng() % 30000000u);
  MathRandom mr(rng());
  const Play wp = getMove(out.next, Color::White, out.next.ai, whiteSeed, mr);
  if (wp.type == PlayType::Move) {
    if (!makeMove(out.next, wp.x, wp.y, Color::White)) passTurn(out.next, Color::White);
  } else {
    passTurn(out.next, Color::White);
  }

  if (out.next.gameOver) {
    out.terminal = true;
    out.blackValue = blackTerminalValue(out.next);
  }
  return out;
}

}  // namespace ipvgo::nn
