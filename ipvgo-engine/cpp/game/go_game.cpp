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

}  // namespace

NeighborTable neighborTable(int n) {
  const FlatNeighbors& t = flatNeighbors(n);
  return {t.count.data(), t.idx.data()};
}

std::string boardString(const SimpleBoard& board) {
  const int n = board.size();
  std::string out(static_cast<size_t>(n) * static_cast<size_t>(n), '.');
  for (int x = 0; x < n; ++x) {
    std::memcpy(out.data() + static_cast<size_t>(x) * static_cast<size_t>(n), board.column(x),
                static_cast<size_t>(n));
  }
  return out;
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

void computeChainsInto(const SimpleBoard& board, ChainSet& cs) {
  const int N = static_cast<int>(board.size());
  const int points = N * N;
  const FlatNeighbors& neighbors = flatNeighbors(N);
  cs.N = N;
  cs.count = 0;
  for (int i = 0; i < points; ++i) cs.id[static_cast<size_t>(i)] = -1;

  std::array<int, ChainSet::kMaxPoints> stack;
  int stackSize = 0;
  int memberCount = 0;
  cs.memberOffsets[0] = 0;
  const char* cells = board.flat();
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      const int start = x * N + y;
      const char c = cells[start];
      if (c == '#') continue;
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
          if (cells[nIdx] != c) continue;
          if (cs.id[static_cast<size_t>(nIdx)] != -1) continue;
          cs.id[static_cast<size_t>(nIdx)] = chainId;
          cs.memberData[static_cast<size_t>(memberCount++)] = nIdx;
          stack[static_cast<size_t>(stackSize++)] = nIdx;
        }
      }
      cs.memberOffsets[static_cast<size_t>(chainId) + 1] = memberCount;
    }
  }

  // Liberties: unique empty neighbors of each chain. A thread-local stamp array
  // tagged with a per-call base replaces clearing a fresh array on every call.
  cs.libertyOffsets[0] = 0;
  static thread_local std::array<uint32_t, ChainSet::kMaxPoints> seenTag{};
  static thread_local uint32_t tagBase = 0;
  if (tagBase > 0xFFFF0000u) {
    seenTag.fill(0);
    tagBase = 0;
  }
  const uint32_t base = tagBase + 1;
  tagBase += static_cast<uint32_t>(cs.count);
  int libertyCount = 0;
  for (int c = 0; c < cs.count; ++c) {
    const uint32_t tag = base + static_cast<uint32_t>(c);
    for (const int idx : cs.members(c)) {
      const int nbCount = neighbors.count[static_cast<size_t>(idx)];
      const auto& nbIdx = neighbors.idx[static_cast<size_t>(idx)];
      for (int k = 0; k < nbCount; ++k) {
        const int nIdx = nbIdx[static_cast<size_t>(k)];
        if (cells[nIdx] != '.') continue;
        if (seenTag[static_cast<size_t>(nIdx)] == tag) continue;
        seenTag[static_cast<size_t>(nIdx)] = tag;
        cs.libertyData[static_cast<size_t>(libertyCount++)] = nIdx;
      }
    }
    cs.libertyOffsets[static_cast<size_t>(c) + 1] = libertyCount;
  }
}

ChainSet computeChains(const SimpleBoard& board) {
  ChainSet cs;
  computeChainsInto(board, cs);
  return cs;
}

// Small per-thread memo of recent boards. The move generators ask for the chains
// of the same position from several helpers; a hit skips the flood fill. The
// returned reference stays valid until six other boards are analysed.
const ChainSet& chainsCached(const SimpleBoard& board) {
  constexpr int kSlots = 6;
  struct Slot {
    SimpleBoard board;
    ChainSet cs;
    bool valid = false;
  };
  thread_local Slot ring[kSlots];
  thread_local int next = 0;

  for (Slot& slot : ring) {
    if (slot.valid && slot.board == board) return slot.cs;
  }
  Slot& slot = ring[next];
  next = (next + 1) % kSlots;
  slot.board = board;
  computeChainsInto(board, slot.cs);
  slot.valid = true;
  return slot.cs;
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
template <int W>
void collectDeadChains(const BitPlanes& planes, const uint64_t* plane, const BitLayout& layout, int n,
                       uint64_t* captured) {
  uint64_t unseen[W];
  for (int w = 0; w < W; ++w) unseen[w] = plane[w];

  while (bits::any<W>(unseen)) {
    const int idx = bits::lowest<W>(unseen);
    if (idx < 0) break;
    uint64_t chain[W];
    for (int w = 0; w < W; ++w) chain[w] = 0;
    chain[idx >> 6] = 1ULL << (idx & 63);
    bits::flood<W>(plane, chain, layout, n);

    bool hasLiberty = false;
    uint64_t adjacent[W];
    bits::neighbours<W>(chain, layout, n, adjacent);
    for (int w = 0; w < W; ++w) {
      if ((adjacent[w] & planes.empty[w]) != 0) {
        hasLiberty = true;
        break;
      }
    }
    if (!hasLiberty) {
      for (int w = 0; w < W; ++w) captured[w] |= chain[w];
    }
    for (int w = 0; w < W; ++w) unseen[w] &= ~chain[w];
  }
}

template <int W>
bool sweepCaptures(const BitPlanes& planes, const BitLayout& layout, int n, char opp, char me,
                   uint64_t* captured) {
  collectDeadChains<W>(planes, opp == 'X' ? planes.black : planes.white, layout, n, captured);
  if (!bits::any<W>(captured)) {
    collectDeadChains<W>(planes, me == 'X' ? planes.black : planes.white, layout, n, captured);
  }
  return bits::any<W>(captured);
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
  const int points = n * n;
  bool any;
  if (points <= 64) any = sweepCaptures<1>(planes, layout, n, opp, me, captured);
  else if (points <= 128) any = sweepCaptures<2>(planes, layout, n, opp, me, captured);
  else if (points <= 192) any = sweepCaptures<3>(planes, layout, n, opp, me, captured);
  else if (points <= 256) any = sweepCaptures<4>(planes, layout, n, opp, me, captured);
  else any = sweepCaptures<kBitWords>(planes, layout, n, opp, me, captured);

  if (!any) return true;
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

namespace {

// Local capture test for a stone placed at `idx` (a legal empty point): enemy
// chains touching the point die when the point was their last liberty; when
// nothing dies, the placed stone's own chain needs a liberty. Replaces the
// full-board sweep of updateCapturesBitwise, which floods every chain on the
// board for every candidate move. Returns false for suicide.
template <int W>
bool placeStoneBits(const BitPlanes& pl, const BitLayout& layout, int n, int idx, bool blackMoves,
                    uint64_t* captured) {
  const uint64_t* mine = blackMoves ? pl.black : pl.white;
  const uint64_t* enemy = blackMoves ? pl.white : pl.black;
  const uint64_t bit = 1ULL << (idx & 63);

  uint64_t emptyAfter[W];
  for (int w = 0; w < W; ++w) emptyAfter[w] = pl.empty[w];
  emptyAfter[idx >> 6] &= ~bit;

  uint64_t self[W] = {};
  self[idx >> 6] = bit;
  uint64_t adjacent[W];
  bits::neighbours<W>(self, layout, n, adjacent);

  uint64_t checked[W] = {};
  bool any = false;
  for (int w = 0; w < W; ++w) {
    for (;;) {
      const uint64_t candidates = adjacent[w] & enemy[w] & ~checked[w];
      if (candidates == 0) break;
      unsigned long b = 0;
      _BitScanForward64(&b, candidates);
      const int seedIdx = w * 64 + static_cast<int>(b);
      uint64_t chain[W] = {};
      chain[seedIdx >> 6] = 1ULL << (seedIdx & 63);
      bits::flood<W>(enemy, chain, layout, n);
      for (int k = 0; k < W; ++k) checked[k] |= chain[k];

      uint64_t around[W];
      bits::neighbours<W>(chain, layout, n, around);
      bool alive = false;
      for (int k = 0; k < W; ++k) {
        if ((around[k] & emptyAfter[k]) != 0) {
          alive = true;
          break;
        }
      }
      if (!alive) {
        for (int k = 0; k < W; ++k) captured[k] |= chain[k];
        any = true;
      }
    }
  }
  if (any) return true;

  uint64_t through[W];
  for (int w = 0; w < W; ++w) through[w] = mine[w] | self[w];
  uint64_t chain[W];
  for (int w = 0; w < W; ++w) chain[w] = self[w];
  bits::flood<W>(through, chain, layout, n);
  uint64_t around[W];
  bits::neighbours<W>(chain, layout, n, around);
  for (int w = 0; w < W; ++w) {
    if ((around[w] & emptyAfter[w]) != 0) return true;
  }
  return false;
}

bool placeStone(const BitPlanes& pl, int n, int idx, bool blackMoves, uint64_t* captured) {
  const BitLayout& layout = BitLayout::forSize(n);
  const int points = n * n;
  if (points <= 64) return placeStoneBits<1>(pl, layout, n, idx, blackMoves, captured);
  if (points <= 128) return placeStoneBits<2>(pl, layout, n, idx, blackMoves, captured);
  if (points <= 192) return placeStoneBits<3>(pl, layout, n, idx, blackMoves, captured);
  if (points <= 256) return placeStoneBits<4>(pl, layout, n, idx, blackMoves, captured);
  return placeStoneBits<kBitWords>(pl, layout, n, idx, blackMoves, captured);
}

// Shared body of evaluateIfMoveIsValid. `planes` may carry bit planes of the
// current board (so a caller scanning every point loads them once).
Validity validateMove(const GameState& state, int x, int y, Color player, SimpleBoard* resultBoard,
                      const BitPlanes* planes) {
  if (state.gameOver) return Validity::GameOver;
  if (state.previousPlayer == player) return Validity::NotYourTurn;
  if (x < 0 || y < 0 || x >= state.size || y >= state.size) return Validity::PointBroken;
  const char cell = state.board[x][y];
  if (cell == '#') return Validity::PointBroken;
  if (cell != '.') return Validity::PointNotEmpty;

  SimpleBoard eval;
  if (BitPlanes::fits(state.size)) {
    BitPlanes local;
    if (planes == nullptr) {
      BitPlanes::load(state.board, local);
      planes = &local;
    }
    const int n = state.size;
    uint64_t captured[kBitWords] = {0, 0, 0, 0, 0, 0};
    if (!placeStone(*planes, n, x * n + y, player == Color::Black, captured)) return Validity::NoSuicide;
    eval = state.board;
    eval[x][y] = colorChar(player);
    for (int w = 0; w < kBitWords; ++w) {
      uint64_t word = captured[w];
      while (word != 0) {
        unsigned long b = 0;
        _BitScanForward64(&b, word);
        word &= word - 1;
        const int idx = w * 64 + static_cast<int>(b);
        eval[idx / n][idx % n] = '.';
      }
    }
  } else {
    eval = evaluateMoveResult(state.board, x, y, player);
    if (eval[x][y] != colorChar(player)) return Validity::NoSuicide;
  }

  if (state.previousBoards.contains(eval)) return Validity::BoardRepeated;
  if (resultBoard != nullptr) *resultBoard = std::move(eval);
  return Validity::Valid;
}

}  // namespace

Validity evaluateIfMoveIsValid(const GameState& state, int x, int y, Color player, SimpleBoard* resultBoard) {
  return validateMove(state, x, y, player, resultBoard, nullptr);
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

std::vector<std::pair<int, int>> getAllValidMoves(const GameState& state, Color player) {
  const int N = static_cast<int>(state.board.size());
  std::vector<std::pair<int, int>> out;
  out.reserve(static_cast<size_t>(N) * static_cast<size_t>(N));
  // Both of these make every point invalid, so the scan can stop before it starts.
  if (state.gameOver || state.previousPlayer == player) return out;
  const char me = colorChar(player);

  BitPlanes planes;
  const BitPlanes* planesPtr = nullptr;
  if (BitPlanes::fits(N)) {
    BitPlanes::load(state.board, planes);
    planesPtr = &planes;
  }

  // Most points capture nothing: a point with an empty neighbour cannot be suicide,
  // and a point with no enemy stone next to it cannot capture, so the board after the
  // move is the board with one stone added. Those skip the general path - no board
  // copy, no capture sweep - and only have to answer superko, which the packed board
  // does: pack it once per scan and flip the stone's two bits per point.
  const uint64_t stoneCode = me == 'X' ? 1ULL : 2ULL;  // packBoard's code for X and O
  uint64_t packed[FlatNeighbors::kMaxPoints];
  const int stride = (N * N * 2 + 63) / 64;
  packBoard(state.board, packed, stride);
  const NeighborTable nt = neighborTable(N);
  const char* cells = state.board.flat();

  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      const int point = x * N + y;
      if (cells[point] != '.') continue;
      bool hasEmptyNeighbour = false;
      bool hasEnemyNeighbour = false;
      const int nbCount = nt.count[point];
      for (int k = 0; k < nbCount; ++k) {
        const char c = cells[nt.idx[point][k]];
        if (c == '.') hasEmptyNeighbour = true;
        else if (c != me && c != '#') hasEnemyNeighbour = true;
      }
      const int bit = point * 2;
      const int word = bit >> 6;
      const uint64_t shift = static_cast<uint64_t>(bit & 63);
      if (hasEmptyNeighbour && !hasEnemyNeighbour) {
        // Nothing to capture and no suicide: patch the stone in, ask superko, put the
        // word back.
        const uint64_t saved = packed[word];
        packed[word] = (saved & ~(3ULL << shift)) | (stoneCode << shift);
        const bool repeated = state.previousBoards.containsPacked(packed);
        packed[word] = saved;
        if (!repeated) out.emplace_back(x, y);
        continue;
      }
      // A contact point may capture: let the bit sweep find the captured stones, then
      // patch those points out of a scratch copy of the packed board instead of
      // building and packing the whole board after the move.
      if (planesPtr == nullptr) {
        if (validateMove(state, x, y, player, nullptr, nullptr) == Validity::Valid) out.emplace_back(x, y);
        continue;
      }
      uint64_t captured[kBitWords] = {0, 0, 0, 0, 0, 0};
      if (!placeStone(*planesPtr, N, point, player == Color::Black, captured)) continue;  // suicide
      uint64_t probe[kBitWords];
      for (int w = 0; w < kBitWords; ++w) probe[w] = packed[w];
      probe[word] = (probe[word] & ~(3ULL << shift)) | (stoneCode << shift);
      for (int w = 0; w < kBitWords; ++w) {
        uint64_t dead = captured[w];
        while (dead != 0) {
          unsigned long b = 0;
          _BitScanForward64(&b, dead);
          dead &= dead - 1;
          const int capturedBit = (w * 64 + static_cast<int>(b)) * 2;
          probe[capturedBit >> 6] &= ~(3ULL << (capturedBit & 63));
        }
      }
      if (!state.previousBoards.containsPacked(probe)) out.emplace_back(x, y);
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
