#include "engine.hpp"

#include "board.hpp"
#include "mcts.hpp"

namespace ipvgo {

Move findTacticalMove(const Board& board, const ValidMask& validMask, Color color) {
  const int size = boardSize(board);
  const Color opp = opponent(color);

  for (int x = 0; x < size; x++) {
    for (int y = 0; y < size; y++) {
      if (x >= static_cast<int>(validMask.size()) || y >= static_cast<int>(validMask[x].size()) || !validMask[x][y]) {
        continue;
      }
      for (const auto& [nx, ny] : neighbors(board, x, y)) {
        if (board[nx][ny] != static_cast<char>(opp)) continue;
        auto chain = collectChain(board, nx, ny, opp);
        auto liberties = chainLiberties(board, chain);
        liberties.erase(std::to_string(x) + "," + std::to_string(y));
        if (liberties.empty()) return {MoveType::Play, x, y};
      }
    }
  }

  for (int x = 0; x < size; x++) {
    for (int y = 0; y < size; y++) {
      if (x >= static_cast<int>(validMask.size()) || y >= static_cast<int>(validMask[x].size()) || !validMask[x][y]) {
        continue;
      }
      for (const auto& [nx, ny] : neighbors(board, x, y)) {
        if (board[nx][ny] != static_cast<char>(color)) continue;
        auto chain = collectChain(board, nx, ny, color);
        auto liberties = chainLiberties(board, chain);
        if (liberties.size() == 1 && liberties.count(std::to_string(x) + "," + std::to_string(y))) {
          return {MoveType::Play, x, y};
        }
      }
    }
  }

  return {MoveType::Pass, -1, -1};
}

MoveResult findBestMove(
    const Board& board,
    const std::vector<Board>& history,
    double komi,
    Color playAs,
    int iterations,
    const ValidMask* validMask) {
  if (validMask) {
    Move tactical = findTacticalMove(board, *validMask, playAs);
    if (tactical.type == MoveType::Play) {
      MoveResult out;
      out.move = tactical;
      out.iterations = 0;
      out.elapsedMs = 0;
      return out;
    }
  }
  return findBestMoveMcts(board, history, komi, playAs, iterations, validMask);
}

} // namespace ipvgo
