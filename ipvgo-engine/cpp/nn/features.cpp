#include "features.hpp"

#include "analysis.hpp"

namespace ipvgo::nn {

using namespace ipvgo::game;

namespace {

// Fill own/opp/empty/offline planes from a board string into dst at plane base.
void fillStonePlanes(const SimpleBoard& board, int N, char me, char opp, std::vector<float>& dst, int ownPlane,
                     int oppPlane) {
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      const char c = board[x][y];
      const int cell = x * N + y;
      if (c == me) dst[ownPlane * N * N + cell] = 1.0f;
      else if (c == opp) dst[oppPlane * N * N + cell] = 1.0f;
    }
  }
}

}  // namespace

std::vector<char> legalActionMask(const GameState& state, Color player) {
  const int N = state.size;
  std::vector<char> mask(actionCount(N), 0);
  for (const auto& [x, y] : getAllValidMoves(state, player)) mask[x * N + y] = 1;
  mask[passAction(N)] = 1;  // pass is always legal
  return mask;
}

std::vector<float> encodeState(const GameState& state, Color player) {
  const int N = state.size;
  const char me = colorChar(player);
  const char opp = colorChar(oppositeColor(player));
  std::vector<float> planes(static_cast<size_t>(kNumPlanes) * N * N, 0.0f);

  const SimpleBoard& board = state.board;
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      const char c = board[x][y];
      const int cell = x * N + y;
      if (c == me) planes[0 * N * N + cell] = 1.0f;
      else if (c == opp) planes[1 * N * N + cell] = 1.0f;
      else if (c == '.') planes[2 * N * N + cell] = 1.0f;
      else if (c == '#') planes[3 * N * N + cell] = 1.0f;
    }
  }

  // Legal-move plane (board points only).
  for (const auto& [x, y] : getAllValidMoves(state, player)) planes[4 * N * N + (x * N + y)] = 1.0f;

  // Bias + komi + turn constant planes.
  const float komiNorm = static_cast<float>(getKomi(state)) / 10.0f;
  for (int cell = 0; cell < N * N; ++cell) {
    planes[5 * N * N + cell] = 1.0f;
    planes[6 * N * N + cell] = komiNorm;
    planes[7 * N * N + cell] = 1.0f;
  }

  // History planes: previousBoards[0] is one move ago, [1] two moves ago.
  if (state.previousBoards.size() >= 1) {
    fillStonePlanes(simpleBoardFromString(state.previousBoards[0]), N, me, opp, planes, 8, 9);
  }
  if (state.previousBoards.size() >= 2) {
    fillStonePlanes(simpleBoardFromString(state.previousBoards[1]), N, me, opp, planes, 10, 11);
  }

  return planes;
}

}  // namespace ipvgo::nn
