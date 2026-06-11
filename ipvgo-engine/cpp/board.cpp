#include "board.hpp"

#include <algorithm>
#include <cmath>
#include <memory>
#include <stack>

namespace ipvgo {

int boardSize(const Board& board) { return board.empty() ? 0 : static_cast<int>(board[0].size()); }

Board cloneBoard(const Board& board) { return board; }

std::string boardKey(const Board& board) {
  std::string key;
  for (const auto& col : board) {
    key += col;
    key += '|';
  }
  return key;
}

std::vector<Point> neighbors(const Board& board, int x, int y) {
  const int size = boardSize(board);
  std::vector<Point> out;
  if (y > 0) out.emplace_back(x, y - 1);
  if (x < size - 1) out.emplace_back(x + 1, y);
  if (y < size - 1) out.emplace_back(x, y + 1);
  if (x > 0) out.emplace_back(x - 1, y);
  return out;
}

std::vector<Point> collectChain(const Board& board, int x, int y, Color color) {
  const char want = static_cast<char>(color);
  std::set<std::string> visited;
  std::stack<Point> stack;
  stack.emplace(x, y);
  std::vector<Point> chain;

  while (!stack.empty()) {
    auto [cx, cy] = stack.top();
    stack.pop();
    const std::string key = std::to_string(cx) + "," + std::to_string(cy);
    if (visited.count(key)) continue;
    if (board[cx][cy] != want) continue;
    visited.insert(key);
    chain.emplace_back(cx, cy);
    for (const auto& [nx, ny] : neighbors(board, cx, cy)) {
      if (!visited.count(std::to_string(nx) + "," + std::to_string(ny)) && board[nx][ny] == want) {
        stack.emplace(nx, ny);
      }
    }
  }
  return chain;
}

std::set<std::string> chainLiberties(const Board& board, const std::vector<Point>& chain) {
  std::set<std::string> liberties;
  for (const auto& [x, y] : chain) {
    for (const auto& [nx, ny] : neighbors(board, x, y)) {
      if (board[nx][ny] == static_cast<char>(Color::Empty)) {
        liberties.insert(std::to_string(nx) + "," + std::to_string(ny));
      }
    }
  }
  return liberties;
}

void removeChain(Board& board, const std::vector<Point>& chain) {
  for (const auto& [x, y] : chain) {
    board[x][y] = static_cast<char>(Color::Empty);
  }
}

bool wouldCapture(const Board& board, int x, int y, Color color) {
  const Color opp = opponent(color);
  for (const auto& [nx, ny] : neighbors(board, x, y)) {
    if (board[nx][ny] != static_cast<char>(opp)) continue;
    auto chain = collectChain(board, nx, ny, opp);
    auto liberties = chainLiberties(board, chain);
    liberties.erase(std::to_string(x) + "," + std::to_string(y));
    if (liberties.empty()) return true;
  }
  return false;
}

std::vector<std::vector<Point>> allChainsOfColor(const Board& board, Color color) {
  const int size = boardSize(board);
  std::set<std::string> visited;
  std::vector<std::vector<Point>> chains;
  const char want = static_cast<char>(color);

  for (int x = 0; x < size; x++) {
    for (int y = 0; y < size; y++) {
      if (board[x][y] != want) continue;
      const std::string key = std::to_string(x) + "," + std::to_string(y);
      if (visited.count(key)) continue;
      auto chain = collectChain(board, x, y, color);
      for (const auto& [cx, cy] : chain) visited.insert(std::to_string(cx) + "," + std::to_string(cy));
      chains.push_back(std::move(chain));
    }
  }
  return chains;
}

bool resolveCaptures(Board& board, Color playerWhoMoved) {
  const Color opp = opponent(playerWhoMoved);
  bool removedAny = false;

  for (const auto& chain : allChainsOfColor(board, opp)) {
    if (chainLiberties(board, chain).empty()) {
      removeChain(board, chain);
      removedAny = true;
    }
  }
  if (removedAny) return true;

  for (const auto& chain : allChainsOfColor(board, playerWhoMoved)) {
    if (chainLiberties(board, chain).empty()) {
      removeChain(board, chain);
      return true;
    }
  }
  return false;
}

Board* applyMove(const Board& board, int x, int y, Color color) {
  const int size = boardSize(board);
  if (x < 0 || y < 0 || x >= size || y >= size) return nullptr;
  if (board[x][y] != static_cast<char>(Color::Empty)) return nullptr;

  auto* next = new Board(cloneBoard(board));
  (*next)[x][y] = static_cast<char>(color);

  while (resolveCaptures(*next, color)) {
  }

  if ((*next)[x][y] != static_cast<char>(color)) {
    delete next;
    return nullptr;
  }

  auto ownChain = collectChain(*next, x, y, color);
  if (chainLiberties(*next, ownChain).empty()) {
    delete next;
    return nullptr;
  }

  return next;
}

bool isSuperko(const Board& board, const std::vector<Board>& history) {
  const std::string key = boardKey(board);
  for (const auto& prior : history) {
    if (boardKey(prior) == key) return true;
  }
  return false;
}

std::vector<Move> getLegalMoves(
    const Board& board,
    const std::vector<Board>& history,
    Color color,
    const ValidMask* validMask,
    bool allowPass) {
  const int size = boardSize(board);
  std::vector<Move> moves;

  for (int x = 0; x < size; x++) {
    for (int y = 0; y < size; y++) {
      if (validMask && (x >= static_cast<int>(validMask->size()) || y >= static_cast<int>((*validMask)[x].size()) ||
                        !(*validMask)[x][y])) {
        continue;
      }
      if (board[x][y] != static_cast<char>(Color::Empty)) continue;
      Board* played = applyMove(board, x, y, color);
      if (!played) continue;
      if (isSuperko(*played, history)) {
        delete played;
        continue;
      }
      delete played;
      moves.push_back({MoveType::Play, x, y});
    }
  }

  if (allowPass || moves.empty()) {
    moves.push_back({MoveType::Pass, -1, -1});
  }
  return moves;
}

Color territoryOwner(const Board& board, const std::vector<Point>& emptyChain) {
  std::set<char> colors;
  for (const auto& [x, y] : emptyChain) {
    for (const auto& [nx, ny] : neighbors(board, x, y)) {
      const char stone = board[nx][ny];
      if (stone == static_cast<char>(Color::Black) || stone == static_cast<char>(Color::White)) {
        colors.insert(stone);
      }
    }
  }
  if (colors.size() == 1) return static_cast<Color>(*colors.begin());
  return Color::Empty;
}

std::vector<std::vector<Point>> emptyChains(const Board& board) {
  const int size = boardSize(board);
  std::set<std::string> visited;
  std::vector<std::vector<Point>> chains;

  for (int x = 0; x < size; x++) {
    for (int y = 0; y < size; y++) {
      if (board[x][y] != static_cast<char>(Color::Empty)) continue;
      const std::string key = std::to_string(x) + "," + std::to_string(y);
      if (visited.count(key)) continue;
      std::vector<Point> chain;
      std::stack<Point> stack;
      stack.emplace(x, y);
      while (!stack.empty()) {
        auto [cx, cy] = stack.top();
        stack.pop();
        const std::string ckey = std::to_string(cx) + "," + std::to_string(cy);
        if (visited.count(ckey)) continue;
        if (board[cx][cy] != static_cast<char>(Color::Empty)) continue;
        visited.insert(ckey);
        chain.emplace_back(cx, cy);
        for (const auto& [nx, ny] : neighbors(board, cx, cy)) {
          if (!visited.count(std::to_string(nx) + "," + std::to_string(ny)) &&
              board[nx][ny] == static_cast<char>(Color::Empty)) {
            stack.emplace(nx, ny);
          }
        }
      }
      chains.push_back(std::move(chain));
    }
  }
  return chains;
}

Score scoreBoard(const Board& board, double komi) {
  Score s;
  const int size = boardSize(board);
  for (int x = 0; x < size; x++) {
    for (int y = 0; y < size; y++) {
      if (board[x][y] == static_cast<char>(Color::Black)) s.black += 1;
      else if (board[x][y] == static_cast<char>(Color::White)) s.white += 1;
    }
  }
  for (const auto& chain : emptyChains(board)) {
    const Color owner = territoryOwner(board, chain);
    if (owner == Color::Black) s.black += static_cast<double>(chain.size());
    else if (owner == Color::White) s.white += static_cast<double>(chain.size());
  }
  s.white += komi;
  return s;
}

bool ownChainInAtari(const Board& board, int x, int y, Color color) {
  for (const auto& [nx, ny] : neighbors(board, x, y)) {
    if (board[nx][ny] != static_cast<char>(color)) continue;
    auto chain = collectChain(board, nx, ny, color);
    auto liberties = chainLiberties(board, chain);
    if (liberties.size() == 1 && liberties.count(std::to_string(x) + "," + std::to_string(y))) return true;
  }
  return false;
}

int moveHeuristic(const Board& board, const Move& move, Color color) {
  if (move.type == MoveType::Pass) return -1000;
  int score = 0;
  if (wouldCapture(board, move.x, move.y, color)) score += 500;
  if (ownChainInAtari(board, move.x, move.y, color)) score += 300;
  for (const auto& [nx, ny] : neighbors(board, move.x, move.y)) {
    const char stone = board[nx][ny];
    if (stone == static_cast<char>(color)) score += 6;
    else if (stone == static_cast<char>(opponent(color))) score += 3;
  }
  const int size = boardSize(board);
  if (move.x == 0 || move.y == 0 || move.x == size - 1 || move.y == size - 1) score += 2;
  const int center = size / 2;
  score += std::max(0, 4 - (std::abs(move.x - center) + std::abs(move.y - center)));
  return score;
}

bool applyTurn(const Board& board, const std::vector<Board>& history, const Move& move, Color color, TurnResult& out) {
  if (move.type == MoveType::Pass) {
    out.board = board;
    out.history = history;
    out.next = opponent(color);
    out.passes = 1;
    return true;
  }

  Board* played = applyMove(board, move.x, move.y, color);
  if (!played) return false;

  std::vector<Board> nextHistory = history;
  nextHistory.push_back(cloneBoard(board));
  if (isSuperko(*played, nextHistory)) {
    delete played;
    return false;
  }

  out.board = *played;
  out.history = std::move(nextHistory);
  out.next = opponent(color);
  out.passes = 0;
  delete played;
  return true;
}

} // namespace ipvgo
