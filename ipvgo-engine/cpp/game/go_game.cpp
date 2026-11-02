#include "go_game.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <utility>

#include "bitboard.hpp"

namespace ipvgo::game {

namespace {

// Cardinal neighbor offsets in the (x, y) coordinate system: N=+y, E=+x, S=-y, W=-x.
constexpr std::array<std::pair<int, int>, 4> kNeighborOffsets = {{{0, 1}, {1, 0}, {0, -1}, {-1, 0}}};

// Flat neighbor table, one entry per point, in kNeighborOffsets order so that
// chain member discovery order is unchanged. The flood fills used to divide and
// modulo by N for every neighbour of every point; N is not a power of two, so
// that was real division in the hottest loop. Built once per size at static-init
// time and read-only afterwards, which keeps it thread-safe.
struct FlatNeighbors {
  static constexpr int kMaxSize = 25;
  static constexpr int kMaxPoints = kMaxSize * kMaxSize;
  int size = 0;
  std::array<unsigned char, kMaxPoints> count{};
  std::array<std::array<int, 4>, kMaxPoints> idx{};
};

const FlatNeighbors& flatNeighbors(int n) {
  static const std::array<FlatNeighbors, FlatNeighbors::kMaxSize + 1> table = [] {
    std::array<FlatNeighbors, FlatNeighbors::kMaxSize + 1> all{};
    for (int size = 1; size <= FlatNeighbors::kMaxSize; ++size) {
      FlatNeighbors& t = all[static_cast<size_t>(size)];
      t.size = size;
      for (int x = 0; x < size; ++x) {
        for (int y = 0; y < size; ++y) {
          const int p = flatIndex(size, x, y);
          unsigned char k = 0;
          for (const auto& [dx, dy] : kNeighborOffsets) {
            const int nx = x + dx;
            const int ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            t.idx[static_cast<size_t>(p)][k++] = flatIndex(size, nx, ny);
          }
          t.count[static_cast<size_t>(p)] = k;
        }
      }
    }
    return all;
  }();
  return table[static_cast<size_t>(n)];
}

// Compares a board against a flattened board string without building a string
// (the superko check used to allocate one per legality test).
bool boardEqualsFlat(const SimpleBoard& board, const std::string& flat) {
  const int n = board.size();
  if (flat.size() != static_cast<size_t>(n) * static_cast<size_t>(n)) return false;
  for (int x = 0; x < n; ++x) {
    if (std::memcmp(flat.data() + static_cast<size_t>(x) * static_cast<size_t>(n), board.column(x),
                    static_cast<size_t>(n)) != 0) {
      return false;
    }
  }
  return true;
}

}  // namespace

std::string boardString(const SimpleBoard& board) {
  const int n = board.size();
  std::string out(static_cast<size_t>(n) * static_cast<size_t>(n), '.');
  for (int x = 0; x < n; ++x) {
    std::memcpy(out.data() + static_cast<size_t>(x) * static_cast<size_t>(n), board.column(x),
                static_cast<size_t>(n));
  }
  return out;
}

SimpleBoard simpleBoardFromString(const std::string& s) {
  const int size = static_cast<int>(std::lround(std::sqrt(static_cast<double>(s.size()))));
  SimpleBoard board(size);
  for (int x = 0; x < size; ++x) {
    std::memcpy(board.column(x), s.data() + static_cast<size_t>(x) * static_cast<size_t>(size),
                static_cast<size_t>(size));
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
  const int points = N * N;
  const FlatNeighbors& neighbors = flatNeighbors(N);
  ChainSet cs;
  cs.N = N;
  cs.count = 0;
  for (int i = 0; i < points; ++i) cs.id[static_cast<size_t>(i)] = -1;

  std::array<int, ChainSet::kMaxPoints> stack;
  int stackSize = 0;
  int memberCount = 0;
  cs.memberOffsets[0] = 0;
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      const char c = board[x][y];
      if (c == '#') continue;
      const int start = flatIndex(N, x, y);
      if (cs.id[static_cast<size_t>(start)] != -1) continue;

      const int chainId = cs.count++;
      cs.chainColor[static_cast<size_t>(chainId)] = c;
      cs.id[static_cast<size_t>(start)] = chainId;
      cs.memberData[static_cast<size_t>(memberCount++)] = start;  // discovery order (matches game)
      stackSize = 0;
      stack[static_cast<size_t>(stackSize++)] = start;

      while (stackSize > 0) {
        const int idx = stack[static_cast<size_t>(--stackSize)];
        const int nbCount = neighbors.count[static_cast<size_t>(idx)];
        const auto& nbIdx = neighbors.idx[static_cast<size_t>(idx)];
        for (int k = 0; k < nbCount; ++k) {
          const int nIdx = nbIdx[static_cast<size_t>(k)];
          if (board[nIdx / N][nIdx % N] != c) continue;
          if (cs.id[static_cast<size_t>(nIdx)] != -1) continue;
          cs.id[static_cast<size_t>(nIdx)] = chainId;
          cs.memberData[static_cast<size_t>(memberCount++)] = nIdx;
          stack[static_cast<size_t>(stackSize++)] = nIdx;
        }
      }
      cs.memberOffsets[static_cast<size_t>(chainId) + 1] = memberCount;
    }
  }

  // Liberties: unique empty neighbors of each chain.
  cs.libertyOffsets[0] = 0;
  std::array<int, ChainSet::kMaxPoints> seenTag;
  for (int i = 0; i < points; ++i) seenTag[static_cast<size_t>(i)] = -1;
  int libertyCount = 0;
  for (int c = 0; c < cs.count; ++c) {
    for (const int idx : cs.members(c)) {
      const int nbCount = neighbors.count[static_cast<size_t>(idx)];
      const auto& nbIdx = neighbors.idx[static_cast<size_t>(idx)];
      for (int k = 0; k < nbCount; ++k) {
        const int nIdx = nbIdx[static_cast<size_t>(k)];
        if (board[nIdx / N][nIdx % N] != '.') continue;
        if (seenTag[static_cast<size_t>(nIdx)] == c) continue;
        seenTag[static_cast<size_t>(nIdx)] = c;
        cs.libertyData[static_cast<size_t>(libertyCount++)] = nIdx;
      }
    }
    cs.libertyOffsets[static_cast<size_t>(c) + 1] = libertyCount;
  }
  return cs;
}

void updateCapturesFloodFill(SimpleBoard& board, Color playerWhoMoved) {
  const ChainSet cs = computeChains(board);
  const char me = colorChar(playerWhoMoved);
  const char opp = colorChar(oppositeColor(playerWhoMoved));

  // Opponent chains with no liberties are captured first; if none, own chains.
  std::vector<int> toCapture;
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] == opp && cs.liberties(c).empty()) toCapture.push_back(c);
  }
  if (toCapture.empty()) {
    for (int c = 0; c < cs.count; ++c) {
      if (cs.chainColor[c] == me && cs.liberties(c).empty()) toCapture.push_back(c);
    }
  }
  const int N = cs.N;
  for (const int c : toCapture) {
    for (const int idx : cs.members(c)) {
      board[idx / N][idx % N] = '.';
    }
  }
}

// Adds every dead chain of the colour in `plane` to `captured`. Order of the
// sweep does not matter: the result is the union of all liberty-less chains,
// which is exactly what the reference flood fill removes.
void collectDeadChains(const BitPlanes& planes, const uint64_t* plane, const BitLayout& layout, int n,
                       uint64_t* captured) {
  uint64_t unseen[kBitWords];
  for (int w = 0; w < kBitWords; ++w) unseen[w] = plane[w];

  while (bits::any(unseen)) {
    const int idx = bits::lowest(unseen);
    if (idx < 0) break;
    uint64_t chain[kBitWords];
    for (int w = 0; w < kBitWords; ++w) chain[w] = 0;
    chain[idx >> 6] = 1ULL << (idx & 63);
    bits::flood(plane, chain, layout, n);

    bool hasLiberty = false;
    uint64_t adjacent[kBitWords];
    bits::neighbours(chain, layout, n, adjacent);
    for (int w = 0; w < kBitWords; ++w) {
      if ((adjacent[w] & planes.empty[w]) != 0) {
        hasLiberty = true;
        break;
      }
    }
    if (!hasLiberty) {
      for (int w = 0; w < kBitWords; ++w) captured[w] |= chain[w];
    }
    for (int w = 0; w < kBitWords; ++w) unseen[w] &= ~chain[w];
  }
}

// Bitwise replacement for updateCapturesFloodFill(): same outcome (dead opponent
// chains are removed first, and only when there are none, the mover's own dead
// chains), but every step is a word operation instead of a flood fill that
// allocates a ChainSet.
bool updateCapturesBitwise(SimpleBoard& board, Color playerWhoMoved) {
  const int n = board.size();
  if (!BitPlanes::fits(n)) return false;

  const BitLayout& layout = BitLayout::forSize(n);
  BitPlanes planes;
  BitPlanes::load(board, planes);

  const char opp = colorChar(oppositeColor(playerWhoMoved));
  const char me = colorChar(playerWhoMoved);

  uint64_t captured[kBitWords] = {0, 0, 0, 0, 0, 0};
  collectDeadChains(planes, opp == 'X' ? planes.black : planes.white, layout, n, captured);
  if (!bits::any(captured)) {
    collectDeadChains(planes, me == 'X' ? planes.black : planes.white, layout, n, captured);
  }

  if (!bits::any(captured)) return true;
  for (int idx = 0; idx < n * n; ++idx) {
    if ((captured[idx >> 6] >> (idx & 63)) & 1ULL) board[idx / n][idx % n] = '.';
  }
  return true;
}

// Public entry point: bitwise sweep, falling back to the flood fill only for
// boards larger than the bit planes cover.
void updateCaptures(SimpleBoard& board, Color playerWhoMoved) {
  if (updateCapturesBitwise(board, playerWhoMoved)) return;
  updateCapturesFloodFill(board, playerWhoMoved);
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

Validity evaluateIfMoveIsValid(const GameState& state, int x, int y, Color player, SimpleBoard* resultBoard) {
  if (state.gameOver) return Validity::GameOver;
  if (state.previousPlayer == player) return Validity::NotYourTurn;
  if (x < 0 || y < 0 || x >= state.size || y >= state.size) return Validity::PointBroken;
  const char cell = state.board[x][y];
  if (cell == '#') return Validity::PointBroken;
  if (cell != '.') return Validity::PointNotEmpty;

  SimpleBoard eval = evaluateMoveResult(state.board, x, y, player);
  if (eval[x][y] != colorChar(player)) return Validity::NoSuicide;

  if (state.previousBoards.contains(eval)) return Validity::BoardRepeated;
  if (resultBoard != nullptr) *resultBoard = std::move(eval);
  return Validity::Valid;
}

namespace {

// Commits a move whose legality was already checked and whose resulting board
// was already computed.
void commitMove(GameState& state, SimpleBoard&& result, Color player) {
  state.previousBoards.append(state.board);
  state.board = std::move(result);
  state.previousPlayer = player;
  state.passCount = 0;
}

}  // namespace

bool makeMove(GameState& state, int x, int y, Color player) {
  // Reuse the board the legality check already built (stone placed, captures
  // applied) instead of rebuilding the chain set a second time.
  SimpleBoard result;
  if (evaluateIfMoveIsValid(state, x, y, player, &result) != Validity::Valid) return false;
  commitMove(state, std::move(result), player);
  return true;
}

bool applyMove(GameState& state, int x, int y, Color player, MoveUndo& undo) {
  SimpleBoard result;
  if (evaluateIfMoveIsValid(state, x, y, player, &result) != Validity::Valid) return false;
  undo.board = state.board;
  undo.previousPlayer = state.previousPlayer;
  undo.passCount = state.passCount;
  undo.gameOver = state.gameOver;
  undo.moved = true;
  commitMove(state, std::move(result), player);
  return true;
}

void applyPass(GameState& state, Color player, MoveUndo& undo) {
  undo.previousPlayer = state.previousPlayer;
  undo.passCount = state.passCount;
  undo.gameOver = state.gameOver;
  undo.moved = false;
  passTurn(state, player);
}

void undoMove(GameState& state, const MoveUndo& undo) {
  if (undo.moved) {
    state.previousBoards.pop();
    state.board = undo.board;
  }
  state.previousPlayer = undo.previousPlayer;
  state.passCount = undo.passCount;
  state.gameOver = undo.gameOver;
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
  const int N = static_cast<int>(board.size());
  std::vector<std::pair<int, int>> out;
  out.reserve(static_cast<size_t>(N) * static_cast<size_t>(N));  // one allocation, no regrowth
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      if (board[x][y] == '.') out.emplace_back(x, y);
    }
  }
  return out;
}

std::vector<std::pair<int, int>> getAllValidMoves(const GameState& state, Color player) {
  const int N = static_cast<int>(state.board.size());
  std::vector<std::pair<int, int>> out;
  out.reserve(static_cast<size_t>(N) * static_cast<size_t>(N));
  // Walk the board directly: the intermediate point list was one more allocation
  // and a copy per call, and this is on the hot path for every White node.
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      if (state.board[x][y] != '.') continue;
      if (evaluateIfMoveIsValid(state, x, y, player) == Validity::Valid) out.emplace_back(x, y);
    }
  }
  return out;
}

double getKomi(const GameState& state) {
  if (state.hasKomiOverride) return state.komiOverride;
  return opponentKomi(state.ai);
}

Score getScore(const GameState& state) { return getScore(state, computeChains(state.board)); }

Score getScore(const GameState& state, const ChainSet& cs) {
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

  const int hugeThreshold = N * N - 3;
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] != '.') continue;
    if (static_cast<int>(cs.members(c).size()) > hugeThreshold) continue;  // ignore huge open regions

    bool hasWhite = false;
    bool hasBlack = false;
    for (const int idx : cs.members(c)) {
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
    if (hasWhite && !hasBlack) s.whiteTerritory += static_cast<double>(cs.members(c).size());
    else if (hasBlack && !hasWhite) s.blackTerritory += static_cast<double>(cs.members(c).size());
  }

  s.whiteSum = s.whitePieces + s.whiteTerritory + s.komi;
  s.blackSum = s.blackPieces + s.blackTerritory;
  return s;
}

}  // namespace ipvgo::game
