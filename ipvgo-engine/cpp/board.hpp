#pragma once

#include "types.hpp"

#include <set>
#include <string>
#include <utility>
#include <vector>

namespace ipvgo {

int boardSize(const Board& board);
Board cloneBoard(const Board& board);
std::string boardKey(const Board& board);

using Point = std::pair<int, int>;

std::vector<Point> neighbors(const Board& board, int x, int y);
std::vector<Point> collectChain(const Board& board, int x, int y, Color color);
std::set<std::string> chainLiberties(const Board& board, const std::vector<Point>& chain);
void removeChain(Board& board, const std::vector<Point>& chain);

bool wouldCapture(const Board& board, int x, int y, Color color);
bool resolveCaptures(Board& board, Color playerWhoMoved);
std::vector<std::vector<Point>> allChainsOfColor(const Board& board, Color color);

Board* applyMove(const Board& board, int x, int y, Color color);
bool isSuperko(const Board& board, const std::vector<Board>& history);

std::vector<Move> getLegalMoves(
    const Board& board,
    const std::vector<Board>& history,
    Color color,
    const ValidMask* validMask = nullptr,
    bool allowPass = true);

struct Score {
  double black = 0;
  double white = 0;
};

Score scoreBoard(const Board& board, double komi);
bool ownChainInAtari(const Board& board, int x, int y, Color color);
int moveHeuristic(const Board& board, const Move& move, Color color);

struct TurnResult {
  Board board;
  std::vector<Board> history;
  Color next;
  int passes = 0;
};

bool applyTurn(const Board& board, const std::vector<Board>& history, const Move& move, Color color, TurnResult& out);

} // namespace ipvgo
