#include "autokroos.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

#include <ankerl/unordered_dense.h>

namespace ipvgo::search::playout::autokroos {
namespace {

// ---- Zobrist keys ---------------------------------------------------------
 
// One key per (point, colour) plus one for the side to move. Generated rather than written out as
// literals: they only have to be well spread and stable for the length of a run.
struct ZobristTable {
  uint32_t key[2 * kPoints + 1] = {};

  ZobristTable() {
    uint64_t state = 0x243F6A8885A308D3ULL;
    for (int i = 0; i < 2 * kPoints + 1; ++i) {
      state += 0x9E3779B97F4A7C15ULL;
      uint64_t z = state;
      z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
      z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
      key[i] = static_cast<uint32_t>(z ^ (z >> 31));
    }
  }
};

const ZobristTable& zobrist() {
  static const ZobristTable table;
  return table;
}

// The side-to-move key. Flipping it turns a Black-to-move hash into a White-to-move hash, which is
// how the reference moves between a position and its successors' hashes without rehashing.
uint32_t turnKey() { return zobrist().key[2 * kPoints]; }

inline int pointIndex(int x, int y) { return kSize * x + y; }

// Neighbour offsets as (dx, dy), matching the order the reference walks them in.
constexpr int kDx[4] = {-1, 1, 0, 0};
constexpr int kDy[4] = {0, 0, -1, 1};

inline bool onBoard(int x, int y) { return x >= 0 && x < kSize && y >= 0 && y < kSize; }

}  // namespace

// ---- Board and history conversion ----------------------------------------

bool fromGameState(const ipvgo::game::GameState& state, Board& out) {
  if (state.size != kSize) return false;
  out.fill(kEmpty);
  for (int x = 0; x < kSize; ++x) {
    const char* column = state.board.column(x);
    for (int y = 0; y < kSize; ++y) {
      switch (column[y]) {
        case '#': out[pointIndex(x, y)] = kOffline; break;
        case '.': out[pointIndex(x, y)] = kEmpty; break;
        case 'X': out[pointIndex(x, y)] = kBlackStone; break;
        case 'O': out[pointIndex(x, y)] = kWhiteStone; break;
        default: out[pointIndex(x, y)] = kEmpty; break;
      }
    }
  }
  return true;
}

std::vector<uint32_t> historyHashes(const ipvgo::game::GameState& state) {
  std::vector<uint32_t> hashes;
  const ipvgo::game::BoardHistory& previous = state.previousBoards;
  if (state.size != kSize || previous.empty()) return hashes;

  // The history is packed two bits per point: 0 empty, 1 black stone, 2 white stone, 3 offline.
  const int stride = previous.stride();
  hashes.reserve(static_cast<size_t>(previous.size()));
  for (int entry = 0; entry < previous.size(); ++entry) {
    const uint64_t* words = previous.entryWords(entry);
    Board board{};
    for (int i = 0; i < kPoints; ++i) {
      const int word = i >> 5;
      const int shift = (2 * i) & 63;
      const uint64_t code = word < stride ? (words[word] >> shift) & 3ULL : 0ULL;
      switch (code) {
        case 1: board[i] = kBlackStone; break;
        case 2: board[i] = kWhiteStone; break;
        case 3: board[i] = kOffline; break;
        default: board[i] = kEmpty; break;
      }
    }
    hashes.push_back(hashBoard(board, false));
  }
  return hashes;
}

uint32_t hashBoard(const Board& board, bool blackToPlay) {
  const ZobristTable& keys = zobrist();
  uint32_t hash = 0;
  for (int pos = 0; pos < kPoints; ++pos) {
    if (board[pos] == kBlackStone) hash ^= keys.key[2 * pos + 1];
    else if (board[pos] == kWhiteStone) hash ^= keys.key[2 * pos];
  }
  if (blackToPlay) hash ^= keys.key[2 * kPoints];
  return hash;
}

// ---- Liberties ------------------------------------------------------------

void libertyCounts(const Board& board, int8_t* out) {
  for (int i = 0; i < kPoints; ++i) out[i] = -1;

  int8_t seen[kPoints];
  for (int pos = 0; pos < kPoints; ++pos) {
    if (out[pos] != -1 || board[pos] <= 0) continue;

    int group[kPoints];
    int groupSize = 0;
    int liberties = 0;
    const int8_t colour = board[pos];
    std::memset(seen, 0, sizeof(seen));
    seen[pos] = 1;
    group[groupSize++] = pos;

    for (int i = 0; i < groupSize; ++i) {
      const int current = group[i];
      const int x = current / kSize;
      const int y = current % kSize;
      for (int d = 0; d < 4; ++d) {
        const int nx = x + kDx[d];
        const int ny = y + kDy[d];
        if (!onBoard(nx, ny)) continue;
        const int next = pointIndex(nx, ny);
        if (seen[next]) continue;
        seen[next] = 1;
        if (board[next] == colour) group[groupSize++] = next;
        else if (board[next] == kEmpty) ++liberties;
      }
    }
    for (int i = 0; i < groupSize; ++i) out[group[i]] = static_cast<int8_t>(liberties);
  }
}

// ---- Move application -----------------------------------------------------

bool applyMove(const Board& board, Board& next, const int8_t* liberties, int x, int y,
               bool blackToPlay) {
  if (!onBoard(x, y)) return false;
  const int pos = pointIndex(x, y);
  if (board[pos] != kEmpty) return false;

  // A move is legal if it lands next to an empty point, next to one of its own chains that has a
  // liberty to spare, or next to an enemy chain it captures. Everything else is suicide.
  int captures[kPoints * 5];
  int captureCount = 0;
  bool legal = false;
  for (int d = 0; d < 4; ++d) {
    const int nx = x + kDx[d];
    const int ny = y + kDy[d];
    if (!onBoard(nx, ny)) continue;
    const int neighbour = pointIndex(nx, ny);
    const int8_t colour = board[neighbour];
    if (colour == kEmpty) {
      legal = true;
    } else if (colour == kBlackStone) {
      if (blackToPlay) {
        if (liberties[neighbour] > 1) legal = true;
      } else if (liberties[neighbour] == 1) {
        legal = true;
        captures[captureCount++] = neighbour;
      }
    } else if (colour == kWhiteStone) {
      if (blackToPlay) {
        if (liberties[neighbour] == 1) {
          legal = true;
          captures[captureCount++] = neighbour;
        }
      } else if (liberties[neighbour] > 1) {
        legal = true;
      }
    }
  }
  if (!legal) return false;

  next = board;
  next[pos] = blackToPlay ? kBlackStone : kWhiteStone;

  // Removing one stone of a chain removes the chain, so each removal pushes the enemy stones
  // around it. A point may be pushed twice; clearing an already-empty point is harmless.
  const int8_t enemy = blackToPlay ? kWhiteStone : kBlackStone;
  for (int i = 0; i < captureCount; ++i) {
    const int captured = captures[i];
    if (next[captured] != enemy) continue;
    next[captured] = kEmpty;
    const int cx = captured / kSize;
    const int cy = captured % kSize;
    for (int d = 0; d < 4; ++d) {
      const int nx = cx + kDx[d];
      const int ny = cy + kDy[d];
      if (!onBoard(nx, ny)) continue;
      const int neighbour = pointIndex(nx, ny);
      if (next[neighbour] == enemy && captureCount < kPoints * 5) captures[captureCount++] = neighbour;
    }
  }
  return true;
}

// ---- Influence ------------------------------------------------------------

void influenceMap(const Board& board, int8_t* out) {
  int16_t checked[kPoints];
  for (int i = 0; i < kPoints; ++i) {
    checked[i] = 0;
    out[i] = board[i];
  }

  for (int x = 0; x < kSize; ++x) {
    for (int y = 0; y < kSize; ++y) {
      const int start = pointIndex(x, y);
      if (checked[start] != 0 || board[start] < 1) continue;

      const int16_t chainId = static_cast<int16_t>(start + 1);
      const int8_t chainColour = board[start];
      int chain[kPoints];
      int chainSize = 0;
      int liberties[kPoints];
      int libertyCount = 0;

      chain[chainSize++] = start;
      checked[start] = chainId;
      for (int i = 0; i < chainSize; ++i) {
        const int current = chain[i];
        const int cx = current / kSize;
        const int cy = current % kSize;
        for (int d = 0; d < 4; ++d) {
          const int nx = cx + kDx[d];
          const int ny = cy + kDy[d];
          if (!onBoard(nx, ny)) continue;
          const int neighbour = pointIndex(nx, ny);
          if (board[neighbour] == chainColour) {
            if (checked[neighbour] != 0) continue;
            chain[chainSize++] = neighbour;
            checked[neighbour] = chainId;
          } else if (board[neighbour] == kEmpty) {
            liberties[libertyCount++] = neighbour;
          }
        }
      }

      bool hasRealLiberty = false;
      for (int i = 0; i < libertyCount; ++i) {
        const int liberty = liberties[i];
        if (checked[liberty] != 0) {
          // Empty space already claimed for this chain by an earlier pass counts.
          if (out[liberty] == chainColour) hasRealLiberty = true;
          continue;
        }

        const int16_t regionId = static_cast<int16_t>(liberty + 1);
        checked[liberty] = regionId;
        int region[kPoints];
        int regionSize = 0;
        bool contested = false;
        region[regionSize++] = liberty;
        for (int r = 0; r < regionSize; ++r) {
          const int current = region[r];
          const int cx = current / kSize;
          const int cy = current % kSize;
          for (int d = 0; d < 4; ++d) {
            const int nx = cx + kDx[d];
            const int ny = cy + kDy[d];
            if (!onBoard(nx, ny)) continue;
            const int neighbour = pointIndex(nx, ny);
            if (board[neighbour] == 3 - chainColour) contested = true;
            if (board[neighbour] == kEmpty) {
              if (checked[neighbour] != 0) continue;
              checked[neighbour] = regionId;
              region[regionSize++] = neighbour;
            }
          }
        }
        // Only an enclosed, single-colour space is controlled; anything larger than the board's
        // usable area is not an eye at all and is left neutral.
        if (contested || regionSize > 11) continue;
        for (int r = 0; r < regionSize; ++r) out[region[r]] = chainColour;
        hasRealLiberty = true;
      }

      // A chain with no usable liberty of its own is dead: it holds nothing.
      if (!hasRealLiberty) {
        for (int i = 0; i < chainSize; ++i) out[chain[i]] = 0;
      }
    }
  }
}

double terminalScore(const Board& board, bool immediate) {
  int8_t influence[kPoints];
  influenceMap(board, influence);

  int blackScore = 0;
  int whiteScore = 0;
  int emptyScore = 0;
  if (immediate) {
    for (int i = 0; i < kPoints; ++i) {
      if (board[i] == kEmpty) {
        if (influence[i] == 1) ++blackScore;
        else if (influence[i] == 2) ++whiteScore;
      } else if (board[i] == kBlackStone) {
        ++blackScore;
      } else if (board[i] == kWhiteStone) {
        ++whiteScore;
      }
    }
  } else {
    for (int i = 0; i < kPoints; ++i) {
      if (influence[i] == 0) ++emptyScore;
      else if (influence[i] == 1) ++blackScore;
      else if (influence[i] == 2) ++whiteScore;
    }
  }

  // The reference's scale: Black's share of the board. White having nothing means Black has
  // everything; Black having nothing is worth nothing; otherwise the neutral space is split.
  if (whiteScore == 0) return static_cast<double>(emptyScore + blackScore);
  if (blackScore == 0) return 0.0;
  return blackScore + static_cast<double>(emptyScore) / 2.0;
}

// ---- White's eyes ---------------------------------------------------------

int whiteEyeCount(const Board& board) {
  int16_t checked[kPoints];
  for (int i = 0; i < kPoints; ++i) checked[i] = 0;

  int eyes = 0;
  for (int x = 0; x < kSize; ++x) {
    for (int y = 0; y < kSize; ++y) {
      const int start = pointIndex(x, y);
      if (checked[start] != 0 || board[start] != kWhiteStone) continue;

      const int16_t chainId = static_cast<int16_t>(start + 1);
      int chain[kPoints];
      int chainSize = 0;
      int liberties[kPoints];
      int libertyCount = 0;

      chain[chainSize++] = start;
      checked[start] = chainId;
      for (int i = 0; i < chainSize; ++i) {
        const int current = chain[i];
        const int cx = current / kSize;
        const int cy = current % kSize;
        for (int d = 0; d < 4; ++d) {
          const int nx = cx + kDx[d];
          const int ny = cy + kDy[d];
          if (!onBoard(nx, ny)) continue;
          const int neighbour = pointIndex(nx, ny);
          if (checked[neighbour] != 0) continue;
          if (board[neighbour] == kWhiteStone) {
            checked[neighbour] = chainId;
            chain[chainSize++] = neighbour;
          } else if (board[neighbour] == kEmpty) {
            liberties[libertyCount++] = neighbour;
          }
        }
      }

      for (int i = 0; i < libertyCount; ++i) {
        const int liberty = liberties[i];
        if (checked[liberty] != 0) continue;
        checked[liberty] = chainId;

        int region[kPoints];
        int regionSize = 0;
        int keep[kPoints];
        int keepCount = 0;
        bool isEye = true;

        region[regionSize++] = liberty;
        for (int r = 0; r < regionSize; ++r) {
          const int current = region[r];
          const int cx = current / kSize;
          const int cy = current % kSize;
          for (int d = 0; d < 4; ++d) {
            const int nx = cx + kDx[d];
            const int ny = cy + kDy[d];
            if (!onBoard(nx, ny)) continue;
            const int neighbour = pointIndex(nx, ny);
            if (board[neighbour] == kBlackStone) isEye = false;
            if (board[neighbour] == kEmpty) {
              if (checked[neighbour] != 0) continue;
              checked[neighbour] = chainId;
              region[regionSize++] = neighbour;
            }
            if (board[neighbour] == kWhiteStone && checked[neighbour] != chainId) {
              // A white stone of another chain touching this space has to be enclosed too,
              // otherwise this is not an eye but a shared liberty.
              if (keepCount < kPoints) keep[keepCount++] = neighbour;
            }
          }
        }
        if (!isEye || regionSize > 11) continue;

        bool surrounded = true;
        int8_t seen[kPoints];
        std::memset(seen, 0, sizeof(seen));
        int stack[kPoints * 4];
        int stackSize = 0;
        for (int k = 0; k < keepCount; ++k) {
          const int candidate = keep[k];
          if (seen[candidate]) continue;
          seen[candidate] = 1;
          stack[stackSize++] = candidate;
        }
        for (int s = 0; s < stackSize && surrounded; ++s) {
          const int current = stack[s];
          const int cx = current / kSize;
          const int cy = current % kSize;
          for (int d = 0; d < 4; ++d) {
            const int nx = cx + kDx[d];
            const int ny = cy + kDy[d];
            if (!onBoard(nx, ny)) continue;
            const int neighbour = pointIndex(nx, ny);
            if (board[neighbour] == kOffline) continue;
            if (board[neighbour] == kBlackStone) {
              surrounded = false;
              break;
            }
            if (board[neighbour] == kWhiteStone && checked[neighbour] == chainId) continue;
            if (seen[neighbour]) continue;
            seen[neighbour] = 1;
            if (stackSize < kPoints * 4) stack[stackSize++] = neighbour;
          }
        }

        if (surrounded) {
          ++eyes;
        } else {
          // Give the space back so a later chain of the same colour can evaluate it.
          for (int r = 0; r < regionSize; ++r) checked[region[r]] = 0;
        }
      }
    }
  }
  return eyes;
}

// ---- Playout --------------------------------------------------------------

namespace {

// A cheap per-thread generator. A playout needs a stream of draws, not a good one, and keeping it
// thread-local means no synchronisation and no shared state between playouts.
uint32_t nextRandom() {
  static thread_local uint64_t state = 0x853C49E6748FEA9BULL;
  state ^= state << 13;
  state ^= state >> 7;
  state ^= state << 17;
  return static_cast<uint32_t>(state >> 32);
}

// "Filling an eye" as a policy question, not a rules question: the point has no empty neighbour,
// no friendly stone beside it and nothing of the opponent's that it would capture. Playing there
// removes one of the mover's own liberties and tells the playout nothing.
bool fillsOwnEye(const Board& board, const int8_t* liberties, int pos, bool blackToPlay) {
  const int8_t own = blackToPlay ? kBlackStone : kWhiteStone;
  const int8_t enemy = blackToPlay ? kWhiteStone : kBlackStone;
  const int x = pos / kSize;
  const int y = pos % kSize;
  for (int d = 0; d < 4; ++d) {
    const int nx = x + kDx[d];
    const int ny = y + kDy[d];
    if (!onBoard(nx, ny)) continue;
    const int neighbour = pointIndex(nx, ny);
    if (board[neighbour] == kEmpty) return false;
    if (board[neighbour] == own) return false;
    if (board[neighbour] == enemy && liberties[neighbour] == 1) return false;
  }
  return true;
}

}  // namespace

double playout(Board board, bool blackToPlay, const ankerl::unordered_dense::set<uint32_t>& history,
               double komi) {
  (void)komi;  // the reference scores the finished board on Black's share of it, not on komi
  // The reference reads stone colours for its self-atari test from the board the playout *started*
  // from, while the liberty counts come from the board as it stands. It is a stale read - after the
  // first ply it is asking about stones that may be long gone - but it is what shaped every playout
  // the reference ever ran, so it is reproduced. Correcting it is an improvement, and improvements
  // are measured against `baselineplay` rather than mixed into the reproduction.
  const Board startBoard = board;
  Board next{};
  int8_t liberties[kPoints];
  int8_t nextLiberties[kPoints];
  libertyCounts(board, liberties);

  bool lastPassed = false;
  const int maxIterations = static_cast<int>(1.5 * kPoints) + 1;

  // A playout needs a fresh superko set every time, and there are 10000 playouts per move. Keeping
  // one set per thread and refilling it - `clear()` keeps the bucket array and the value buffer -
  // turns 10000 set allocations into one per thread. This is the single largest piece of overhead
  // in the search, and it does not change what any playout computes: the set is empty and then
  // filled with exactly the same hashes it would have been constructed with.
  static thread_local ankerl::unordered_dense::set<uint32_t> seen;
  seen.clear();
  seen.insert(history.begin(), history.end());

  for (int iteration = 0; iteration < maxIterations; ++iteration) {
    int moves[kPoints];
    int moveCount = 0;
    for (int pos = 0; pos < kPoints; ++pos) {
      if (board[pos] != kEmpty) continue;
      if (fillsOwnEye(board, liberties, pos, blackToPlay)) continue;
      moves[moveCount++] = pos;
    }

    bool played = false;
    while (moveCount > 0) {
      const int pick = static_cast<int>(nextRandom() % static_cast<uint32_t>(moveCount));
      const int pos = moves[pick];
      const int x = pos / kSize;
      const int y = pos % kSize;

      if (!applyMove(board, next, liberties, x, y, blackToPlay)) {
        moves[pick] = moves[--moveCount];
        continue;
      }
      if (seen.count(hashBoard(next, false)) != 0) {
        moves[pick] = moves[--moveCount];
        continue;
      }

      libertyCounts(next, nextLiberties);
      if (nextLiberties[pos] == 1) {
        // Sacrificing a lone stone, or extending from one already in atari, is how eye destruction
        // works. Walking a healthy chain into atari is not, so reject that. The colours come from
        // the board the playout started from and the liberties from the current one, exactly as the
        // reference does it.
        const int8_t own = blackToPlay ? kBlackStone : kWhiteStone;
        bool healthyNeighbour = false;
        for (int d = 0; d < 4 && !healthyNeighbour; ++d) {
          const int nx = x + kDx[d];
          const int ny = y + kDy[d];
          if (!onBoard(nx, ny)) continue;
          const int neighbour = pointIndex(nx, ny);
          if (startBoard[neighbour] == own && liberties[neighbour] > 1) healthyNeighbour = true;
        }
        if (healthyNeighbour) {
          moves[pick] = moves[--moveCount];
          continue;
        }
      }

      lastPassed = false;
      played = true;
      break;
    }

    if (!played) {
      // Nothing playable: a pass. Two of them end the game.
      if (lastPassed) break;
      lastPassed = true;
    } else {
      std::swap(board, next);
      std::memcpy(liberties, nextLiberties, sizeof(liberties));
    }

    // A side with no stones left cannot come back; stop rather than filling the board.
    if (iteration >= 2) {
      const int8_t opponent = blackToPlay ? kWhiteStone : kBlackStone;
      bool opponentAlive = false;
      for (int pos = 0; pos < kPoints && !opponentAlive; ++pos) {
        if (board[pos] == opponent) opponentAlive = true;
      }
      if (!opponentAlive) break;
    }

    blackToPlay = !blackToPlay;
    seen.insert(hashBoard(board, false));
  }

  return terminalScore(board, false);
}

// ---- The search graph -----------------------------------------------------

namespace {

struct Edge {
  uint32_t hash = 0;
  int pos = -1;  // -1 for the pass edge
  Board board{};
  int weight = 1;
  long visits = 0;
  int child = -1;  // resolved node index, -1 while unexplored
  double value = 0.0;
};

struct Node {
  Board board{};
  bool blackToPlay = true;
  uint32_t hash = 0;
  std::vector<Edge> children;

  // Value of the playout that created this node, and the totals that the visit-weighted mean is
  // rebuilt from on every backup.
  double own = 0.0;
  long n = 1;
  double s = 0.0;
  double ss = 0.0;

  // The "two passes and the game is over" pseudo-child. Its visits are counted here rather than on
  // an edge because the value comes from scoring the board, not from a playout.
  bool endValid = false;
  long endVisits = 0;
  double endScore = 0.0;

  // The exploration prior the parent uses for this node: never below 0.1, and wide while the node
  // is still barely visited.
  double prior() const {
    constexpr double kPriorMultiplier = 10.0;
    const double mean = n > 0 ? s / static_cast<double>(n) : 0.0;
    const double variance = n > 0 ? ss / static_cast<double>(n) - mean * mean : 0.0;
    const double deviation = std::max(0.1, variance > 0.0 ? std::sqrt(variance) : 0.0);
    return (kPriorMultiplier * std::sqrt(0.75 * kPoints) + static_cast<double>(n) * deviation) /
           (static_cast<double>(n) + kPriorMultiplier);
  }

  double mean() const { return n > 0 ? s / static_cast<double>(n) : 0.0; }
};

struct Graph {
  std::vector<Node> nodes;
  ankerl::unordered_dense::map<uint32_t, int> table;
};

// Builds the children of a node: the pass edge, then one edge per legal move. White's edges carry
// the opponent-model weight, which is what prunes the tail of its reply distribution.
//
// Superko is not applied here. Whether a successor repeats an earlier board depends on the line
// that reached this node, not on the node itself, so the reference leaves that check to selection.
void buildChildren(Node& node, const Config& cfg) {
  node.children.clear();

  Edge pass;
  pass.pos = -1;
  pass.hash = node.hash ^ turnKey();
  pass.board = node.board;
  // The pass edge carries no priority: it is not a move, so it never participates in the
  // opponent-model culling that White's reply weights drive.
  pass.weight = 0;
  node.children.push_back(pass);

  int8_t liberties[kPoints];
  libertyCounts(node.board, liberties);

  int8_t territory[kPoints];
  const bool tweaks = cfg.useAiTweaks && !node.blackToPlay;
  if (tweaks) influenceMap(node.board, territory);
  const int whiteEyes = tweaks ? whiteEyeCount(node.board) : 0;

  for (int x = 0; x < kSize; ++x) {
    for (int y = 0; y < kSize; ++y) {
      const int pos = pointIndex(x, y);
      Board next{};
      if (!applyMove(node.board, next, liberties, x, y, node.blackToPlay)) continue;

      Edge edge;
      edge.pos = pos;
      edge.board = next;
      edge.hash = hashBoard(next, !node.blackToPlay);
      edge.weight = 1;

      if (tweaks) {
        bool isAtari = false;
        bool isCapture = false;
        bool isDefend = false;
        bool isNobi = false;
        bool isBigAtari = false;
        int whiteOrOfflineNeighbours = 0;
        int emptyCount = 0;
        bool hasNeighbour = false;
        int neighbourLiberties = 1;

        for (int d = 0; d < 4; ++d) {
          const int nx = x + kDx[d];
          const int ny = y + kDy[d];
          if (!onBoard(nx, ny)) {
            ++whiteOrOfflineNeighbours;
            continue;
          }
          const int neighbour = pointIndex(nx, ny);
          if (node.board[neighbour] == kOffline) ++whiteOrOfflineNeighbours;

          if (node.board[neighbour] == kBlackStone) {
            hasNeighbour = true;
            if (liberties[neighbour] == 1) {
              isCapture = true;
            } else if (liberties[neighbour] == 2) {
              isAtari = true;
              // A large group in atari is a different animal from a lone stone: rescuing it is
              // not urgent in the same way.
              if (!isBigAtari) {
                // The reference's flood does not mark its seed stone before walking, so when the
                // group is reached through its other stones the seed is pushed a second time and
                // the group counts one too large. A two-stone group therefore passes the "large
                // group" test and is treated as a big atari. That is a bug, but it is the bug that
                // decided the weight of every atari reply the reference ever played, so it is
                // reproduced: the seed is deliberately left unmarked and the group array is sized
                // for the duplicate.
                int group[2 * kPoints];
                int groupSize = 0;
                int groupLiberties[kPoints];
                int groupLibertyCount = 0;
                int8_t seen[kPoints];
                std::memset(seen, 0, sizeof(seen));
                group[groupSize++] = neighbour;
                for (int i = 0; i < groupSize; ++i) {
                  const int current = group[i];
                  const int cx = current / kSize;
                  const int cy = current % kSize;
                  for (int dd = 0; dd < 4; ++dd) {
                    const int ax = cx + kDx[dd];
                    const int ay = cy + kDy[dd];
                    if (!onBoard(ax, ay)) continue;
                    const int at = pointIndex(ax, ay);
                    if (node.board[at] == kBlackStone) {
                      if (seen[at]) continue;
                      seen[at] = 1;
                      group[groupSize++] = at;
                    }
                    if (node.board[at] == kEmpty) {
                      if (seen[at]) continue;
                      seen[at] = 1;
                      groupLiberties[groupLibertyCount++] = at;
                    }
                  }
                }
                if (groupSize >= 3 && groupLibertyCount >= 2) {
                  const int ax = groupLiberties[0] / kSize;
                  const int ay = groupLiberties[0] % kSize;
                  const int bx = groupLiberties[1] / kSize;
                  const int by = groupLiberties[1] % kSize;
                  // One connected liberty space means the group can be chased, not killed.
                  if (std::abs(ax - bx) + std::abs(ay - by) == 1) isBigAtari = true;
                }
              }
            }
          }

          if (node.board[neighbour] == kWhiteStone) {
            hasNeighbour = true;
            ++whiteOrOfflineNeighbours;
            bool isLone = true;
            for (int dd = 0; dd < 4; ++dd) {
              const int ax = nx + kDx[dd];
              const int ay = ny + kDy[dd];
              if (!onBoard(ax, ay)) continue;
              if (node.board[pointIndex(ax, ay)] == kWhiteStone) isLone = false;
            }
            if (!isLone) isNobi = true;
            if (liberties[neighbour] == 1) isDefend = true;
            else if (liberties[neighbour] > neighbourLiberties) neighbourLiberties = liberties[neighbour];
          }

          if (node.board[neighbour] == kEmpty) ++emptyCount;
        }

        bool makesEye = false;
        if (!isCapture && !isDefend && isNobi && whiteEyes < 2) {
          Board withStone = node.board;
          withStone[pos] = kWhiteStone;
          if (whiteEyeCount(withStone) > whiteEyes) makesEye = true;
        }

        const bool outsideBlackTerritory = territory[pos] != 1;
        if (isCapture) {
          edge.weight = 1000 + (outsideBlackTerritory ? 1 : 0);
        } else if (isDefend && neighbourLiberties + emptyCount > 2) {
          edge.weight = 800 + (outsideBlackTerritory ? 1 : 0);
        } else if (makesEye && isNobi && whiteOrOfflineNeighbours > 1 && emptyCount > 0) {
          edge.weight = 600 + (outsideBlackTerritory ? 1 : 0);
        } else if (isAtari) {
          if (isBigAtari) {
            edge.weight = 400 + (outsideBlackTerritory ? 1 : 0);
          } else {
            Board withStone = node.board;
            withStone[pos] = kWhiteStone;
            int8_t newLiberties[kPoints];
            libertyCounts(withStone, newLiberties);
            if (newLiberties[pos] > 1) edge.weight = 400 + (outsideBlackTerritory ? 1 : 0);
          }
        } else {
          // A move that touches nothing is a wasted move.
          if (!hasNeighbour && emptyCount < 4) edge.weight = -1;
          // The reference has a second penalty here, written as
          // `if (!issurround && territory[BOARD_SIZE * x + y == 1]) weight = -1;`. `+` binds
          // tighter than `==`, so the subscript is the boolean `(5*x + y) == 1`, and `territory` is
          // an Int8Array - indexing one with a boolean converts the key to the string "true" or
          // "false", neither of which is a canonical numeric index, so the result is `undefined` and
          // `undefined == 1` is false. The branch is therefore dead in the reference: it never
          // fires for any board or any move.
          //
          // It is left out rather than reproduced as a no-op, because reproducing it would mean
          // writing a condition that can never be true and pretending it does something. The
          // behaviour is identical either way; only the comment differs. Making the rule actually
          // work - penalising a move inside Black's own area - is a candidate improvement, and
          // improvements are measured against `baselineplay`.
        }
        // The reference marks a priority move that was not culled for being inside Black's area
        // with a weight ending in 1. White will not pass while one of those is available, which
        // keeps the search from stopping the game while White still has something to do.
      }

      node.children.push_back(edge);
    }
  }
}

int createNode(Graph& graph, const Board& board, bool blackToPlay, const Config& cfg,
               const ankerl::unordered_dense::set<uint32_t>& history) {
  Node node;
  node.board = board;
  node.blackToPlay = blackToPlay;
  node.hash = hashBoard(board, blackToPlay);
  buildChildren(node, cfg);

  // The playout that gives the node its first value runs with the superko of the line that reached
  // it, so it cannot walk back into a board already on that line.
  node.own = playout(board, blackToPlay, history, cfg.komi);
  node.n = 1;
  node.s = node.own;
  node.ss = node.own * node.own;

  const int index = static_cast<int>(graph.nodes.size());
  graph.nodes.push_back(std::move(node));
  graph.table[graph.nodes.back().hash] = index;
  return index;
}

}  // namespace

Result search(const Board& root, bool whitePassedLast, const std::vector<uint32_t>& seenHashes,
              const Config& cfg) {
  Result result;

  Graph graph;
  graph.nodes.reserve(static_cast<size_t>(std::min(cfg.maxNodes, 65536)));
  graph.table.reserve(1 << 14);

  const int rootIndex = createNode(graph, root, true, cfg, ankerl::unordered_dense::set<uint32_t>{});

  std::vector<int> path;
  path.reserve(128);

  for (long playoutIndex = 0; playoutIndex < cfg.playouts; ++playoutIndex) {
    if (cfg.cancel != nullptr && cfg.cancel->load(std::memory_order_relaxed)) {
      result.cancelled = true;
      break;
    }

    // Same trick as in `playout`: the descent's superko set is refilled, not reallocated. It is a
    // separate scratch from the playout's, because a node created during the descent runs its own
    // playout and must not clobber the line being descended.
    static thread_local ankerl::unordered_dense::set<uint32_t> seen;
    seen.clear();
    seen.insert(seenHashes.begin(), seenHashes.end());
    seen.insert(hashBoard(root, false));
    bool lastPassed = whitePassedLast;

    path.clear();
    path.push_back(rootIndex);

    int current = rootIndex;
    for (;;) {
      // A safety bound, not a search limit: with transpositions a line can in principle revisit a
      // node, and a hang is worse than a short path.
      if (path.size() >= 128) break;

      Node& node = graph.nodes[static_cast<size_t>(current)];
      const double sign = node.blackToPlay ? 1.0 : -1.0;

      // The heaviest opponent reply decides which side of White's distribution survives culling.
      int maxWeight = 1;
      for (const Edge& edge : node.children) {
        if (edge.pos != -1) {
          const uint32_t probe =
              edge.hash ^ (node.blackToPlay ? 0u : turnKey());
          if (seen.count(probe) != 0) continue;
        }
        if (edge.weight > maxWeight) maxWeight = edge.weight;
      }

      double bestScore = -1e18;
      int bestChild = node.children.empty() ? -1 : 0;
      bool chosenEnd = false;

      if (lastPassed) {
        if (!node.endValid) {
          node.endValid = true;
          node.endVisits = 0;
          node.endScore = terminalScore(node.board, true);
        }
        // A terminal option has no variance, so it gets no exploration term.
        const double score = sign * node.endScore;
        if (score > bestScore) {
          bestScore = score;
          chosenEnd = true;
        }
      }

      for (size_t i = 0; i < node.children.size(); ++i) {
        Edge& edge = node.children[i];
        if (edge.pos != -1 && seen.count(edge.hash ^ (node.blackToPlay ? 0u : turnKey())) != 0) continue;
        if (lastPassed && edge.pos == -1) continue;

        if (edge.child < 0) {
          const auto it = graph.table.find(edge.hash);
          if (it != graph.table.end()) edge.child = it->second;
        }

        const double prior =
            edge.child >= 0 ? graph.nodes[static_cast<size_t>(edge.child)].prior()
                            : static_cast<double>(kPoints);
        const double q = edge.child >= 0 ? graph.nodes[static_cast<size_t>(edge.child)].mean()
                                         : (node.n > 0 ? node.s / static_cast<double>(node.n) : 0.0);
        double score = sign * q +
                       cfg.exploration * prior * std::sqrt(static_cast<double>(node.n)) /
                           (1.0 + static_cast<double>(edge.visits));

        if (cfg.useAiTweaks && !node.blackToPlay) {
          // White only considers replies near the top of its own priority ladder, and it will not
          // pass while a top-priority move is on the board.
          if (edge.pos != -1 && edge.weight < maxWeight - 1) continue;
          if (edge.pos == -1 && maxWeight > 1 && maxWeight % 10 == 1) continue;
        }

        if (score > bestScore) {
          bestScore = score;
          bestChild = static_cast<int>(i);
          chosenEnd = false;
        }
      }

      ++node.n;
      if (chosenEnd) {
        ++node.endVisits;
        break;
      }
      if (bestChild < 0) break;

      Edge& edge = node.children[static_cast<size_t>(bestChild)];
      ++edge.visits;
      lastPassed = edge.pos == -1;
      seen.insert(hashBoard(edge.board, false));

      if (edge.child >= 0) {
        // Walk into the existing node, unless it already holds more evidence than this edge has
        // contributed - in which case the position is settled enough and the path stops here.
        if (cfg.suppressTransposition && edge.visits <= graph.nodes[static_cast<size_t>(edge.child)].n) {
          break;
        }
        current = edge.child;
        path.push_back(current);
        continue;
      }

      if (static_cast<int>(graph.nodes.size()) >= cfg.maxNodes) break;
      // `createNode` pushes a node, which can move the vector and invalidate every reference into
      // it. Copy what the call needs first; the indices stay valid across the push.
      const Board childBoard = edge.board;
      const bool childBlackToPlay = !node.blackToPlay;
      const int created = createNode(graph, childBoard, childBlackToPlay, cfg, seen);
      graph.nodes[static_cast<size_t>(current)].children[static_cast<size_t>(bestChild)].child = created;
      path.push_back(created);
      break;
    }

    // Rebuild every node on the line from its children, walking back to the root. A node is worth
    // the visit-weighted mean of what its children are worth, plus the one playout it started
    // with - which is what lets two move orders reaching one position share their evidence.
    for (size_t i = path.size(); i-- > 0;) {
      Node& node = graph.nodes[static_cast<size_t>(path[i])];
      double sum = 0.0;
      double sumSq = 0.0;
      for (const Edge& edge : node.children) {
        if (edge.child < 0 || edge.visits == 0) continue;
        const double q = graph.nodes[static_cast<size_t>(edge.child)].mean();
        sum += static_cast<double>(edge.visits) * q;
        sumSq += static_cast<double>(edge.visits) * q * q;
      }
      if (node.endValid) {
        sum += static_cast<double>(node.endVisits) * node.endScore;
        sumSq += static_cast<double>(node.endVisits) * node.endScore * node.endScore;
      }
      node.s = node.own + sum;
      node.ss = node.own * node.own + sumSq;
    }
  }

  Node& rootNode = graph.nodes[static_cast<size_t>(rootIndex)];
  for (Edge& edge : rootNode.children) {
    if (edge.child >= 0) edge.value = graph.nodes[static_cast<size_t>(edge.child)].mean();
  }
  if (whitePassedLast) {
    // White passed, so the pass edge is the double-pass option rather than a move.
    if (!rootNode.children.empty()) {
      rootNode.children[0].visits = rootNode.endVisits;
      rootNode.children[0].value = rootNode.endScore;
    }
  }

  result.q = rootNode.mean();
  result.s = rootNode.prior();
  result.nodes = static_cast<long>(graph.nodes.size());
  result.moves.reserve(rootNode.children.size());
  for (const Edge& edge : rootNode.children) {
    MoveResult move;
    move.pos = edge.pos;
    move.visits = edge.visits;
    move.value = edge.value;
    move.weight = edge.weight;
    result.moves.push_back(move);
  }
  std::stable_sort(result.moves.begin(), result.moves.end(),
                   [](const MoveResult& a, const MoveResult& b) { return a.visits > b.visits; });
  return result;
}

bool searchGameState(const ipvgo::game::GameState& state, const Config& cfg, Result& out) {
  out = Result{};
  Board board{};
  if (!fromGameState(state, board)) return false;
  const std::vector<uint32_t> history = historyHashes(state);
  // It is Black's turn, so White moved last, and a pass count of one means that move was a pass -
  // any non-pass resets the count, and two passes would have ended the game.
  const bool whitePassedLast = state.passCount == 1;
  out = search(board, whitePassedLast, history, cfg);
  return true;
}

void enumerateChildren(const Board& board, bool blackToPlay, const Config& cfg,
                       std::vector<std::pair<int, int>>& out) {
  out.clear();
  Node node;
  node.board = board;
  node.blackToPlay = blackToPlay;
  node.hash = hashBoard(board, blackToPlay);
  buildChildren(node, cfg);
  out.reserve(node.children.size());
  for (const Edge& edge : node.children) out.emplace_back(edge.pos, edge.weight);
}

}  // namespace ipvgo::search::playout::autokroos

