#include "go_game.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace ipvgo::game {

namespace {

// Cardinal neighbor offsets in the (x, y) coordinate system: N=+y, E=+x, S=-y, W=-x.
constexpr std::array<std::pair<int, int>, 4> kNeighborOffsets = {{{0, 1}, {1, 0}, {0, -1}, {-1, 0}}};

}  // namespace

std::string boardString(const SimpleBoard& board) {
  std::string out;
  out.reserve(board.size() * board.size());
  for (const auto& col : board) out += col;
  return out;
}

SimpleBoard simpleBoardFromString(const std::string& s) {
  const int size = static_cast<int>(std::lround(std::sqrt(static_cast<double>(s.size()))));
  SimpleBoard board(size);
  for (int x = 0; x < size; ++x) {
    board[x] = s.substr(static_cast<size_t>(x) * size, size);
  }
  return board;
}

double opponentKomi(Opponent ai) {
  switch (ai) {
    case Opponent::None: return 5.5;
    case Opponent::Netburners: return 1.5;
    case Opponent::SlumSnakes: return 3.5;
    case Opponent::TheBlackHand: return 3.5;
    case Opponent::Tetrads: return 5.5;
    case Opponent::Daedalus: return 5.5;
    case Opponent::Illuminati: return 7.5;
    case Opponent::WorldDaemon: return 9.5;
  }
  return 5.5;
}

ChainSet computeChains(const SimpleBoard& board) {
  const int N = static_cast<int>(board.size());
  ChainSet cs;
  cs.N = N;
  cs.id.assign(static_cast<size_t>(N) * N, -1);

  std::vector<int> stack;
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      const char c = board[x][y];
      if (c == '#') continue;
      const int start = flatIndex(N, x, y);
      if (cs.id[start] != -1) continue;

      const int chainId = cs.count++;
      cs.chainColor.push_back(c);
      cs.members.emplace_back();
      cs.id[start] = chainId;
      cs.members[chainId].push_back(start);  // record members in discovery order (matches game)
      stack.clear();
      stack.push_back(start);

      while (!stack.empty()) {
        const int idx = stack.back();
        stack.pop_back();
        const int cx = idx / N;
        const int cy = idx % N;
        for (const auto& [dx, dy] : kNeighborOffsets) {
          const int nx = cx + dx;
          const int ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          if (board[nx][ny] != c) continue;
          const int nIdx = flatIndex(N, nx, ny);
          if (cs.id[nIdx] != -1) continue;
          cs.id[nIdx] = chainId;
          cs.members[chainId].push_back(nIdx);
          stack.push_back(nIdx);
        }
      }
    }
  }

  // Liberties: unique empty neighbors of each chain.
  cs.liberties.assign(cs.count, {});
  std::vector<int> seenTag(static_cast<size_t>(N) * N, -1);
  for (int c = 0; c < cs.count; ++c) {
    for (const int idx : cs.members[c]) {
      const int cx = idx / N;
      const int cy = idx % N;
      for (const auto& [dx, dy] : kNeighborOffsets) {
        const int nx = cx + dx;
        const int ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        if (board[nx][ny] != '.') continue;
        const int nIdx = flatIndex(N, nx, ny);
        if (seenTag[nIdx] == c) continue;
        seenTag[nIdx] = c;
        cs.liberties[c].push_back(nIdx);
      }
    }
  }
  return cs;
}

void updateCaptures(SimpleBoard& board, Color playerWhoMoved) {
  const ChainSet cs = computeChains(board);
  const char me = colorChar(playerWhoMoved);
  const char opp = colorChar(oppositeColor(playerWhoMoved));

  // Opponent chains with no liberties are captured first; if none, own chains.
  std::vector<int> toCapture;
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] == opp && cs.liberties[c].empty()) toCapture.push_back(c);
  }
  if (toCapture.empty()) {
    for (int c = 0; c < cs.count; ++c) {
      if (cs.chainColor[c] == me && cs.liberties[c].empty()) toCapture.push_back(c);
    }
  }
  const int N = cs.N;
  for (const int c : toCapture) {
    for (const int idx : cs.members[c]) {
      board[idx / N][idx % N] = '.';
    }
  }
}

SimpleBoard evaluateMoveResult(const SimpleBoard& board, int x, int y, Color player) {
  SimpleBoard eval = board;
  if (x < 0 || y < 0 || x >= static_cast<int>(eval.size()) || y >= static_cast<int>(eval.size())) return board;
  eval[x][y] = colorChar(player);
  updateCaptures(eval, player);
  return eval;
}

Color whoseTurn(const GameState& state) {
  if (state.gameOver) return Color::Empty;
  return oppositeColor(state.previousPlayer);
}

Validity evaluateIfMoveIsValid(const GameState& state, int x, int y, Color player) {
  if (state.gameOver) return Validity::GameOver;
  if (state.previousPlayer == player) return Validity::NotYourTurn;
  if (x < 0 || y < 0 || x >= state.size || y >= state.size) return Validity::PointBroken;
  const char cell = state.board[x][y];
  if (cell == '#') return Validity::PointBroken;
  if (cell != '.') return Validity::PointNotEmpty;

  const SimpleBoard eval = evaluateMoveResult(state.board, x, y, player);
  if (eval[x][y] != colorChar(player)) return Validity::NoSuicide;

  if (!state.previousBoards.empty()) {
    const std::string evalString = boardString(eval);
    for (const auto& prior : state.previousBoards) {
      if (prior == evalString) return Validity::BoardRepeated;
    }
  }
  return Validity::Valid;
}

bool makeMove(GameState& state, int x, int y, Color player) {
  const Validity validity = evaluateIfMoveIsValid(state, x, y, player);
  if (validity != Validity::Valid || state.board[x][y] != '.') return false;

  state.previousBoards.insert(state.previousBoards.begin(), boardString(state.board));
  state.board[x][y] = colorChar(player);
  state.previousPlayer = player;
  state.passCount = 0;
  updateCaptures(state.board, player);
  return true;
}

void passTurn(GameState& state, Color player, bool allowEndGame) {
  if (state.gameOver || state.previousPlayer == player) return;
  state.previousPlayer = oppositeColor(state.previousPlayer);
  state.passCount++;
  if (state.passCount >= 2 && allowEndGame) {
    state.gameOver = true;
  }
}

std::vector<std::pair<int, int>> getEmptySpaces(const SimpleBoard& board) {
  std::vector<std::pair<int, int>> out;
  const int N = static_cast<int>(board.size());
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      if (board[x][y] == '.') out.emplace_back(x, y);
    }
  }
  return out;
}

std::vector<std::pair<int, int>> getAllValidMoves(const GameState& state, Color player) {
  std::vector<std::pair<int, int>> out;
  for (const auto& [x, y] : getEmptySpaces(state.board)) {
    if (evaluateIfMoveIsValid(state, x, y, player) == Validity::Valid) out.emplace_back(x, y);
  }
  return out;
}

double getKomi(const GameState& state) {
  if (state.hasKomiOverride) return state.komiOverride;
  return opponentKomi(state.ai);
}

Score getScore(const GameState& state) {
  const SimpleBoard& board = state.board;
  const int N = state.size;
  Score s;
  s.komi = getKomi(state);

  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      if (board[x][y] == 'X') s.blackPieces += 1;
      else if (board[x][y] == 'O') s.whitePieces += 1;
    }
  }

  const ChainSet cs = computeChains(board);
  const int hugeThreshold = N * N - 3;
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] != '.') continue;
    if (static_cast<int>(cs.members[c].size()) > hugeThreshold) continue;  // ignore huge open regions

    bool hasWhite = false;
    bool hasBlack = false;
    for (const int idx : cs.members[c]) {
      const int cx = idx / N;
      const int cy = idx % N;
      for (const auto& [dx, dy] : kNeighborOffsets) {
        const int nx = cx + dx;
        const int ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const char nc = board[nx][ny];
        if (nc == 'O') hasWhite = true;
        else if (nc == 'X') hasBlack = true;
      }
    }
    if (hasWhite && !hasBlack) s.whiteTerritory += static_cast<double>(cs.members[c].size());
    else if (hasBlack && !hasWhite) s.blackTerritory += static_cast<double>(cs.members[c].size());
  }

  s.whiteSum = s.whitePieces + s.whiteTerritory + s.komi;
  s.blackSum = s.blackPieces + s.blackTerritory;
  return s;
}

}  // namespace ipvgo::game
