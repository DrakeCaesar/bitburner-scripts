#include "setup.hpp"

#include <cmath>

#include "analysis.hpp"
#include "obstacles.hpp"

namespace ipvgo::game {

int getHandicap(int boardSize, Opponent ai) {
  if (ai == Opponent::Illuminati || ai == Opponent::WorldDaemon) {
    switch (boardSize) {
      case 5: return 1;
      case 7: return 3;
      case 9: return 4;
      case 13: return 5;
      case 19: return 7;
    }
  }
  return 0;
}

void applyHandicap(SimpleBoard& board, int handicap, MathRandom& mathRng) {
  const int N = static_cast<int>(board.size());
  std::vector<Pt> availableMoves;
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      const char c = board[x][y];
      if (c == '#') continue;
      if (c != '.') return;  // game already in progress; do not apply handicap
      availableMoves.emplace_back(x, y);
    }
  }

  std::vector<Pt> options = getExpansionMoveArray(board, availableMoves);

  // 5x5 special handling: extra weight on a single center handicap piece.
  if (static_cast<int>(availableMoves.size()) < 26 && N > 2 && board[2][2] != '#' && mathRng.random() < 0.2) {
    board[2][2] = 'O';
    return;
  }

  for (int i = 0; i < handicap && i < static_cast<int>(options.size()); ++i) {
    const int index = static_cast<int>(std::floor(mathRng.random() * options.size()));
    const auto [x, y] = options[index];
    board[x][y] = 'O';
    options.erase(options.begin() + index);
  }
}

GameState newBoardState(int boardSize, Opponent ai, bool applyObstacles, double seedMs, MathRandom& mathRng) {
  GameState state;
  state.ai = ai;
  state.previousPlayer = Color::White;  // black (player) moves first
  state.gameOver = false;

  if (ai == Opponent::WorldDaemon) {
    state.board = bitverseBoard();
    state.size = 19;
    applyObstacles = false;
  } else {
    state.size = boardSize;
    state.board.assign(boardSize, std::string(boardSize, '.'));
  }

  if (applyObstacles) addObstacles(state, seedMs);

  const int handicap = getHandicap(state.size, ai);
  if (handicap) applyHandicap(state.board, handicap, mathRng);
  return state;
}

}  // namespace ipvgo::game
