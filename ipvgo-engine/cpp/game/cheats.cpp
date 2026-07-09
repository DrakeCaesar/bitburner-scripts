#include "cheats.hpp"

#include <algorithm>
#include <cmath>

namespace ipvgo::game {

double cheatSuccessChance(int cheatCount, const CheatParams& params) {
  const double cheatCountScalar = std::pow(0.7 - 0.02 * cheatCount, cheatCount);
  const double raw = 0.6 * cheatCountScalar * params.crimeSuccessMult + params.sourceFileBonus;
  return std::max(std::min(raw, 1.0), 0.0);
}

namespace {

bool inBounds(const GameState& state, int x, int y) {
  return x >= 0 && y >= 0 && x < state.size && y < state.size;
}

bool isOffline(const GameState& state, int x, int y) { return state.board[x][y] == '#'; }

// Apply the successful cheat's board mutation. Returns false if a target is
// invalid for the given cheat (mirrors the game's pre-checks).
bool applyEffect(GameState& state, Color player, CheatType type,
                 const std::vector<std::pair<int, int>>& points) {
  const char playerChar = colorChar(player);
  switch (type) {
    case CheatType::RemoveRouter: {
      const auto [x, y] = points[0];
      if (isOffline(state, x, y)) return false;  // "point is already offline"
      state.board[x][y] = '.';
      return true;
    }
    case CheatType::PlayTwoMoves: {
      const auto [x1, y1] = points[0];
      const auto [x2, y2] = points[1];
      if (isOffline(state, x1, y1) || isOffline(state, x2, y2)) return false;
      state.board[x1][y1] = playerChar;
      state.board[x2][y2] = playerChar;
      return true;
    }
    case CheatType::RepairOfflineNode: {
      const auto [x, y] = points[0];
      state.board[x][y] = '.';
      return true;
    }
    case CheatType::DestroyNode: {
      const auto [x, y] = points[0];
      state.board[x][y] = '#';
      return true;
    }
  }
  return false;
}

}  // namespace

CheatResult applyCheat(GameState& state, Color player, CheatType type,
                       const std::vector<std::pair<int, int>>& points, double successRng, double ejectRng,
                       const CheatParams& params) {
  const size_t needed = type == CheatType::PlayTwoMoves ? 2 : 1;
  if (points.size() < needed) return CheatResult::InvalidTarget;
  for (size_t i = 0; i < needed; ++i) {
    if (!inBounds(state, points[i].first, points[i].second)) return CheatResult::InvalidTarget;
  }
  // RemoveRouter / PlayTwoMoves reject already-offline targets up front, as the
  // game does before attempting the cheat.
  if (type == CheatType::RemoveRouter && isOffline(state, points[0].first, points[0].second)) {
    return CheatResult::InvalidTarget;
  }
  if (type == CheatType::PlayTwoMoves &&
      (isOffline(state, points[0].first, points[0].second) || isOffline(state, points[1].first, points[1].second))) {
    return CheatResult::InvalidTarget;
  }

  state.passCount = 0;
  const int priorCheatCount = player == Color::White ? state.cheatCountForWhite : state.cheatCount;
  const double chance = cheatSuccessChance(state.cheatCount, params);

  CheatResult result;
  if (successRng <= chance) {
    if (!applyEffect(state, player, type, points)) return CheatResult::InvalidTarget;
    result = CheatResult::Success;
  } else if (priorCheatCount && ejectRng < 0.1 && state.ai != Opponent::None) {
    // Ejected: game ends immediately, cheat counter is NOT incremented.
    state.gameOver = true;
    return CheatResult::Ejected;
  } else {
    passTurn(state, player, false);
    result = CheatResult::TurnSkipped;
  }

  if (player == Color::White) {
    state.cheatCountForWhite++;
  } else {
    state.cheatCount++;
  }
  state.previousPlayer = player;
  updateCaptures(state.board, player);
  return result;
}

}  // namespace ipvgo::game
