#include "autokroos.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>
#include <thread>

#if defined(_MSC_VER)
#include <intrin.h>
#endif

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

// The same four neighbours per point, with -1 for off-board. Every kernel walks its stones'
// neighbours many times over, and deriving x and y from a point costs a divide and a modulo each
// time; one cached load replaces both. The order is the reference's: x-1, x+1, y-1, y+1.
struct NeighbourTable {
  int8_t at[kPoints][4];
  constexpr NeighbourTable() : at{} {
    for (int x = 0; x < kSize; ++x) {
      for (int y = 0; y < kSize; ++y) {
        const int pos = kSize * x + y;
        at[pos][0] = x > 0 ? static_cast<int8_t>(pos - kSize) : static_cast<int8_t>(-1);
        at[pos][1] = x + 1 < kSize ? static_cast<int8_t>(pos + kSize) : static_cast<int8_t>(-1);
        at[pos][2] = y > 0 ? static_cast<int8_t>(pos - 1) : static_cast<int8_t>(-1);
        at[pos][3] = y + 1 < kSize ? static_cast<int8_t>(pos + 1) : static_cast<int8_t>(-1);
      }
    }
  }
};
constexpr NeighbourTable kNeighbours{};

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

  for (int pos = 0; pos < kPoints; ++pos) {
    if (out[pos] != -1 || board[pos] <= 0) continue;

    int group[kPoints];
    int groupSize = 0;
    int liberties = 0;
    const int8_t colour = board[pos];
    // The flood used to clear a 25-byte array once per group. The points of a 5x5 board fit in
    // one machine word, so the same membership test is a register op.
    uint32_t seen = 1u << pos;
    group[groupSize++] = pos;

    for (int i = 0; i < groupSize; ++i) {
      const int current = group[i];
      for (int d = 0; d < 4; ++d) {
        const int next = kNeighbours.at[current][d];
        if (next < 0) continue;
        if ((seen & (1u << next)) != 0) continue;
        seen |= 1u << next;
        if (board[next] == colour) group[groupSize++] = next;
        else if (board[next] == kEmpty) ++liberties;
      }
    }
    for (int i = 0; i < groupSize; ++i) out[group[i]] = static_cast<int8_t>(liberties);
  }
}

// ---- Move application -----------------------------------------------------

namespace {

// `applyMove` in point space. `removed` receives the points the move actually took off the board,
// each exactly once - the playout needs that to keep its Zobrist hash up to date without rescanning
// the board.
bool applyMoveAt(const Board& board, Board& next, const int8_t* liberties, int pos, bool blackToPlay,
                 int* removed, int& removedCount) {
  if (board[pos] != kEmpty) return false;

  // A move is legal if it lands next to an empty point, next to one of its own chains that has a
  // liberty to spare, or next to an enemy chain it captures. Everything else is suicide.
  int pending[kPoints * 5];
  int pendingCount = 0;
  bool legal = false;
  for (int d = 0; d < 4; ++d) {
    const int neighbour = kNeighbours.at[pos][d];
    if (neighbour < 0) continue;
    const int8_t colour = board[neighbour];
    if (colour == kEmpty) {
      legal = true;
    } else if (colour == kBlackStone) {
      if (blackToPlay) {
        if (liberties[neighbour] > 1) legal = true;
      } else if (liberties[neighbour] == 1) {
        legal = true;
        pending[pendingCount++] = neighbour;
      }
    } else if (colour == kWhiteStone) {
      if (blackToPlay) {
        if (liberties[neighbour] == 1) {
          legal = true;
          pending[pendingCount++] = neighbour;
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
  // around it. A point may be pushed twice; clearing an already-empty point is harmless, and only
  // the first removal of each stone is recorded.
  const int8_t enemy = blackToPlay ? kWhiteStone : kBlackStone;
  removedCount = 0;
  for (int i = 0; i < pendingCount; ++i) {
    const int at = pending[i];
    if (next[at] != enemy) continue;
    next[at] = kEmpty;
    removed[removedCount++] = at;
    for (int d = 0; d < 4; ++d) {
      const int neighbour = kNeighbours.at[at][d];
      if (neighbour < 0) continue;
      if (next[neighbour] == enemy && pendingCount < kPoints * 5) pending[pendingCount++] = neighbour;
    }
  }
  return true;
}

}  // namespace

bool applyMove(const Board& board, Board& next, const int8_t* liberties, int x, int y,
               bool blackToPlay) {
  if (!onBoard(x, y)) return false;
  int removed[kPoints * 5];
  int removedCount = 0;
  return applyMoveAt(board, next, liberties, pointIndex(x, y), blackToPlay, removed, removedCount);
}

// ---- Influence ------------------------------------------------------------

void influenceMap(const Board& board, int8_t* out) {
  int16_t checked[kPoints];
  for (int i = 0; i < kPoints; ++i) {
    checked[i] = 0;
    out[i] = board[i];
  }

  for (int start = 0; start < kPoints; ++start) {
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
      for (int d = 0; d < 4; ++d) {
        const int neighbour = kNeighbours.at[current][d];
        if (neighbour < 0) continue;
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
        for (int d = 0; d < 4; ++d) {
          const int neighbour = kNeighbours.at[current][d];
          if (neighbour < 0) continue;
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
  for (int start = 0; start < kPoints; ++start) {
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
      for (int d = 0; d < 4; ++d) {
        const int neighbour = kNeighbours.at[current][d];
        if (neighbour < 0) continue;
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
        for (int d = 0; d < 4; ++d) {
          const int neighbour = kNeighbours.at[current][d];
          if (neighbour < 0) continue;
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
        for (int d = 0; d < 4; ++d) {
          const int neighbour = kNeighbours.at[current][d];
          if (neighbour < 0) continue;
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
  return eyes;
}

// ---- Playout --------------------------------------------------------------

namespace {

// A cheap per-thread generator. A playout needs a stream of draws, not a good one, and keeping it
// thread-local means no synchronisation and no shared state between playouts.
uint64_t& randomState() {
  static thread_local uint64_t state = 0x853C49E6748FEA9BULL;
  return state;
}

uint32_t nextRandom() {
  uint64_t& state = randomState();
  state ^= state << 13;
  state ^= state >> 7;
  state ^= state << 17;
  return static_cast<uint32_t>(state >> 32);
}

// Reseeds this thread's stream. Every thread starts from the same thread-local seed, so parallel
// workers have to be told apart explicitly or each tree would replay the same games.
void seedRandom(uint64_t seed) {
  randomState() = seed != 0 ? seed : 0x853C49E6748FEA9BULL;
}

// ---- Superko --------------------------------------------------------------

// The reference keeps a Set of every board hash on the line: the game's own history plus every
// position the playout has reached. Measured on the shipping workload that set was 29% of the whole
// search, and almost none of it was the answer - it was `unordered_dense` machinery: a hash applied
// to a key that is already a Zobrist XOR (uniform in every bit), a bucket array that points into a
// separate value array, and a full rebuild for each of the 10000 playouts.
//
// Three changes, none of which alters which boards are in the set:
//   * a fixed 512-entry table of `key + 1`, linear probed from the low bits of the key. Eight
//     entries share a cache line, so a hit is one load and a miss usually two.
//   * the game history is inserted once per move rather than once per playout.
//   * a playout records the slots it wrote, and the next playout clears only those, so clearing is
//     one store per position played instead of a rebuild.
//
// The capacity is not reachable: a playout runs at most 1.5 * 25 plies and a 5x5 game's history is
// bounded by the game, which puts the worst case near a quarter load.
class Superko {
 public:
  void reset() {
    clearTouched();
    std::memset(entry, 0, sizeof(entry));
  }

  // Drops everything a playout added, keeping the history inserted with `insertPermanent`.
  void beginPlayout() { clearTouched(); }

  void insertPermanent(uint32_t key) { insertEntry(key, false); }

  void insert(uint32_t key) { insertEntry(key, true); }

  bool contains(uint32_t key) const {
    const uint64_t wanted = static_cast<uint64_t>(key) + 1;
    uint32_t slot = key & kMask;
    for (int probe = 0; probe < kSlots; ++probe) {
      const uint64_t held = entry[slot];
      if (held == 0) return false;
      if (held == wanted) return true;
      slot = (slot + 1) & kMask;
    }
    return false;
  }

 private:
  static constexpr uint32_t kSlots = 512;
  static constexpr uint32_t kMask = kSlots - 1;

  void clearTouched() {
    for (int i = 0; i < touchedCount; ++i) entry[touched[i]] = 0;
    touchedCount = 0;
  }

  void insertEntry(uint32_t key, bool record) {
    const uint64_t wanted = static_cast<uint64_t>(key) + 1;
    uint32_t slot = key & kMask;
    for (int probe = 0; probe < kSlots; ++probe) {
      const uint64_t held = entry[slot];
      if (held == wanted) return;  // already present: nothing was written, so nothing to undo
      if (held == 0) {
        entry[slot] = wanted;
        if (record && touchedCount < static_cast<int>(kSlots)) {
          touched[touchedCount++] = static_cast<int16_t>(slot);
        }
        return;
      }
      slot = (slot + 1) & kMask;
    }
  }

  uint64_t entry[kSlots] = {};
  int16_t touched[kSlots] = {};
  int touchedCount = 0;
};

// Liberty counts for the position after a move, derived from the position before it.
//
// A chain's liberty count depends only on the occupancy of the points beside its stones, so only
// chains that touch a point whose occupancy changed - the stone just placed, the stones just
// captured - can have a different count. `libs` arrives holding the counts for the previous board
// and is corrected in place; recounting the handful of affected chains replaces a full-board scan
// for every candidate the playout tries.
void libertiesAfter(const Board& board, int pos, const int* removed, int removedCount, int8_t* libs) {
  for (int i = 0; i < removedCount; ++i) libs[removed[i]] = -1;

  int seeds[1 + 4 + 4 * kPoints];
  int seedCount = 0;
  seeds[seedCount++] = pos;
  for (int d = 0; d < 4; ++d) {
    const int neighbour = kNeighbours.at[pos][d];
    if (neighbour >= 0 && board[neighbour] > 0) seeds[seedCount++] = neighbour;
  }
  for (int i = 0; i < removedCount; ++i) {
    for (int d = 0; d < 4; ++d) {
      const int neighbour = kNeighbours.at[removed[i]][d];
      if (neighbour >= 0 && board[neighbour] > 0) seeds[seedCount++] = neighbour;
    }
  }

  uint32_t recounted = 0;
  for (int s = 0; s < seedCount; ++s) {
    const int seed = seeds[s];
    if ((recounted & (1u << seed)) != 0) continue;

    const int8_t colour = board[seed];
    uint32_t seen = 1u << seed;
    uint32_t members = 1u << seed;
    int group[kPoints];
    int groupSize = 0;
    int liberties = 0;
    group[groupSize++] = seed;
    for (int i = 0; i < groupSize; ++i) {
      const int current = group[i];
      for (int d = 0; d < 4; ++d) {
        const int next = kNeighbours.at[current][d];
        if (next < 0) continue;
        if ((seen & (1u << next)) != 0) continue;
        seen |= 1u << next;
        if (board[next] == colour) {
          group[groupSize++] = next;
          members |= 1u << next;
        } else if (board[next] == kEmpty) {
          ++liberties;
        }
      }
    }
    // Only the stones of the chain count as recounted: `seen` also holds the empty points and the
    // enemy stones the flood touched, and marking those would skip a chain that still needs a count.
    recounted |= members;
    for (int i = 0; i < groupSize; ++i) libs[group[i]] = static_cast<int8_t>(liberties);
  }
}

// Index of the lowest set bit; the caller has already checked that the mask is not empty.
inline int lowestBit(uint32_t mask) {
#if defined(_MSC_VER)
  unsigned long index = 0;
  _BitScanForward(&index, mask);
  return static_cast<int>(index);
#else
  return __builtin_ctz(mask);
#endif
}

// "Filling an eye" as a policy question, not a rules question: the point has no empty neighbour,
// no friendly stone beside it and nothing of the opponent's that it would capture. Playing there
// removes one of the mover's own liberties and tells the playout nothing.
bool fillsOwnEye(const Board& board, const int8_t* liberties, int pos, bool blackToPlay) {
  const int8_t own = blackToPlay ? kBlackStone : kWhiteStone;
  const int8_t enemy = blackToPlay ? kWhiteStone : kBlackStone;
  for (int d = 0; d < 4; ++d) {
    const int neighbour = kNeighbours.at[pos][d];
    if (neighbour < 0) continue;
    if (board[neighbour] == kEmpty) return false;
    if (board[neighbour] == own) return false;
    if (board[neighbour] == enemy && liberties[neighbour] == 1) return false;
  }
  return true;
}

}  // namespace

namespace {

// The playout proper. `seen` arrives holding the superko set for the line the rollout starts from
// and is extended as it goes; the caller owns clearing it, because the set is shared with the
// descent that reached this position and the descent's own entries live in the same table.
double playoutFrom(Board board, bool blackToPlay, Superko& seen, double komi) {
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
  int removed[kPoints * 5];
  int removedCount = 0;
  libertyCounts(board, liberties);

  // The superko key is the stone pattern alone, so a move changes it by exactly the stone it placed
  // and the stones it captured. That turns a 25-point rescan per candidate into three XORs.
  const uint32_t* keys = zobrist().key;
  uint32_t stoneHash = hashBoard(board, false);

  // The empty points, as a mask. Building the candidate list walks only these rather than all 25
  // points, which matters because most points are stones by the middle of a playout.
  uint32_t emptyMask = 0;
  for (int pos = 0; pos < kPoints; ++pos) {
    if (board[pos] == kEmpty) emptyMask |= 1u << pos;
  }

  bool lastPassed = false;
  const int maxIterations = static_cast<int>(1.5 * kPoints) + 1;

  for (int iteration = 0; iteration < maxIterations; ++iteration) {
    int moves[kPoints];
    int moveCount = 0;
    for (uint32_t remaining = emptyMask; remaining != 0; remaining &= remaining - 1) {
      const int pos = lowestBit(remaining);
      if (fillsOwnEye(board, liberties, pos, blackToPlay)) continue;
      moves[moveCount++] = pos;
    }

    bool played = false;
    uint32_t playedHash = 0;
    int playedPos = 0;
    while (moveCount > 0) {
      const int pick = static_cast<int>(nextRandom() % static_cast<uint32_t>(moveCount));
      const int pos = moves[pick];

      if (!applyMoveAt(board, next, liberties, pos, blackToPlay, removed, removedCount)) {
        moves[pick] = moves[--moveCount];
        continue;
      }
      uint32_t hash = stoneHash ^ keys[2 * pos + (blackToPlay ? 1 : 0)];
      for (int i = 0; i < removedCount; ++i) {
        hash ^= keys[2 * removed[i] + (blackToPlay ? 0 : 1)];
      }
      if (seen.contains(hash)) {
        moves[pick] = moves[--moveCount];
        continue;
      }

      std::memcpy(nextLiberties, liberties, sizeof(nextLiberties));
      libertiesAfter(next, pos, removed, removedCount, nextLiberties);
      if (nextLiberties[pos] == 1) {
        // Sacrificing a lone stone, or extending from one already in atari, is how eye destruction
        // works. Walking a healthy chain into atari is not, so reject that. The colours come from
        // the board the playout started from and the liberties from the current one, exactly as the
        // reference does it.
        const int8_t own = blackToPlay ? kBlackStone : kWhiteStone;
        bool healthyNeighbour = false;
        for (int d = 0; d < 4 && !healthyNeighbour; ++d) {
          const int neighbour = kNeighbours.at[pos][d];
          if (neighbour < 0) continue;
          if (startBoard[neighbour] == own && liberties[neighbour] > 1) healthyNeighbour = true;
        }
        if (healthyNeighbour) {
          moves[pick] = moves[--moveCount];
          continue;
        }
      }

      playedHash = hash;
      playedPos = pos;
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
      stoneHash = playedHash;
      emptyMask &= ~(1u << playedPos);
      for (int i = 0; i < removedCount; ++i) emptyMask |= 1u << removed[i];
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
    seen.insert(stoneHash);
  }

  return terminalScore(board, false);
}

}  // namespace

double playout(Board board, bool blackToPlay, const ankerl::unordered_dense::set<uint32_t>& history,
               double komi) {
  Superko seen;
  seen.reset();
  for (const uint32_t hash : history) seen.insertPermanent(hash);
  return playoutFrom(board, blackToPlay, seen, komi);
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
  // Every child allocates its own edge vector; reserving the full set once per node replaces the
  // six-odd growth steps a fresh vector would take.
  node.children.clear();
  node.children.reserve(kPoints + 1);

  // A child's hash is the parent's stone pattern with the placed stone XORed in and the captured
  // ones XORed out, so no child needs a rescan of its own board.
  const uint32_t* keys = zobrist().key;
  const uint32_t parentStones = node.hash ^ (node.blackToPlay ? turnKey() : 0u);
  const uint32_t childTurn = node.blackToPlay ? 0u : turnKey();

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

  for (int pos = 0; pos < kPoints; ++pos) {
    if (node.board[pos] != kEmpty) continue;
    Board next{};
    int removed[kPoints * 5];
    int removedCount = 0;
    if (!applyMoveAt(node.board, next, liberties, pos, node.blackToPlay, removed, removedCount))
      continue;

    Edge edge;
    edge.pos = pos;
    edge.board = next;
    uint32_t stones = parentStones ^ keys[2 * pos + (node.blackToPlay ? 1 : 0)];
    for (int i = 0; i < removedCount; ++i) {
      stones ^= keys[2 * removed[i] + (node.blackToPlay ? 0 : 1)];
    }
    edge.hash = stones ^ childTurn;
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
        const int neighbour = kNeighbours.at[pos][d];
        if (neighbour < 0) {
          ++whiteOrOfflineNeighbours;
          continue;
        }
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
                for (int dd = 0; dd < 4; ++dd) {
                  const int at = kNeighbours.at[current][dd];
                  if (at < 0) continue;
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
                // One connected liberty space means the group can be chased, not killed.
                bool adjacent = false;
                for (int dd = 0; dd < 4 && !adjacent; ++dd) {
                  if (kNeighbours.at[groupLiberties[0]][dd] == groupLiberties[1]) adjacent = true;
                }
                if (adjacent) isBigAtari = true;
              }
            }
          }
        }

        if (node.board[neighbour] == kWhiteStone) {
          hasNeighbour = true;
          ++whiteOrOfflineNeighbours;
          bool isLone = true;
          for (int dd = 0; dd < 4; ++dd) {
            const int at = kNeighbours.at[neighbour][dd];
            if (at < 0) continue;
            if (node.board[at] == kWhiteStone) isLone = false;
          }
          if (!isLone) isNobi = true;
          if (liberties[neighbour] == 1) isDefend = true;
          else if (liberties[neighbour] > neighbourLiberties)
            neighbourLiberties = liberties[neighbour];
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

int createNode(Graph& graph, const Board& board, bool blackToPlay, const Config& cfg, Superko& seen,
               uint32_t nodeHash) {
  Node node;
  node.board = board;
  node.blackToPlay = blackToPlay;
  node.hash = nodeHash;
  buildChildren(node, cfg);

  // The playout that gives the node its first value runs with the superko of the line that reached
  // it, so it cannot walk back into a board already on that line.
  node.own = playoutFrom(board, blackToPlay, seen, cfg.komi);
  node.n = 1;
  node.s = node.own;
  node.ss = node.own * node.own;

  const int index = static_cast<int>(graph.nodes.size());
  graph.nodes.push_back(std::move(node));
  graph.table[graph.nodes.back().hash] = index;
  return index;
}

// ---- The search -----------------------------------------------------------
//
// One playout is: descend by PUCT, expand the node it reached, back up the line. Everything that
// state lives in is a `Tree`, so a playout can be driven from anywhere - and that is what lets the
// search run on several cores without a lock.
//
// Each worker owns its own graph. The alternative - one shared graph, atomics on every visit
// counter, a lock around node creation - puts synchronisation in the hottest loop in the engine,
// because node creation is most of the work, in exchange for pooling transpositions between
// workers. Independent trees have no contention at all and each still pools its own
// transpositions; what they cannot do is share evidence with each other, so only the root is
// merged. That is the classic root-parallel split.

// A worker's search: its graph, its descent scratch, and the game state the root starts from.
struct Tree {
  Graph graph;
  int rootIndex = -1;
  std::vector<int> path;
  // The superko set, shared by the descent and by the rollout of the node it expands: the descent
  // has finished its line by the time the rollout runs, so one table serves both and the per-playout
  // history copy disappears. The game history lives in here permanently.
  Superko seen;
  uint32_t rootHash = 0;
  bool whitePassedLast = false;
};

// A playout creates at most one node, so this is the true bound. The old flat 65536 reserved
// twelve times the memory a 10000-playout search ever touched.
long treeReserveFor(const Config& cfg) {
  return std::min<long>(cfg.maxNodes, std::max<long>(cfg.playouts + 1, 1024));
}

void initTree(Tree& tree, const Board& root, uint32_t rootHash, bool whitePassedLast,
              const std::vector<uint32_t>& seenHashes, const Config& cfg, long reserveNodes) {
  tree.graph.nodes.clear();
  tree.graph.table.clear();
  const int reserve = static_cast<int>(std::min<long>(cfg.maxNodes, std::max<long>(reserveNodes, 1)));
  tree.graph.nodes.reserve(static_cast<size_t>(reserve));
  tree.graph.table.reserve(1 << 14);
  tree.path.clear();
  tree.path.reserve(128);
  tree.rootHash = rootHash;
  tree.whitePassedLast = whitePassedLast;

  // The playout that gives the root its first value runs with an empty history, as in the
  // reference: the root is a position, not a line. So the history goes in afterwards, and every
  // later playout of this tree starts from it.
  Superko empty;
  empty.reset();
  tree.rootIndex = createNode(tree.graph, root, true, cfg, empty, hashBoard(root, true));

  tree.seen.reset();
  for (const uint32_t hash : seenHashes) tree.seen.insertPermanent(hash);
  tree.seen.insertPermanent(rootHash);
}

// One playout: descend to a leaf or an unexpanded edge, create the node, walk the line back.
void runOnePlayout(Tree& tree, const Config& cfg) {
  Graph& graph = tree.graph;
  const int rootIndex = tree.rootIndex;
  std::vector<int>& path = tree.path;
  // The superko table carries the game history permanently and is cleared of the previous line
  // here; the rollout that expands the node found below adds to the same table and is cleared the
  // same way, next time round.
  Superko& seen = tree.seen;
  seen.beginPlayout();
  bool lastPassed = tree.whitePassedLast;

  path.clear();
  path.push_back(rootIndex);

  int current = rootIndex;
  for (;;) {
    // A safety bound, not a search limit: with transpositions a line can in principle revisit a
    // node, and a hang is worse than a short path.
    if (path.size() >= 128) break;

    Node& node = graph.nodes[static_cast<size_t>(current)];
    const double sign = node.blackToPlay ? 1.0 : -1.0;

    // The stone hash of each child, and whether the superko set rules it out. Both passes below
    // need the same answer and `seen` does not change inside a node, so it is asked once.
    uint32_t childHash[kPoints + 1];
    bool blocked[kPoints + 1];
    for (size_t i = 0; i < node.children.size(); ++i) {
      const Edge& edge = node.children[i];
      if (edge.pos == -1) {
        childHash[i] = edge.hash;
        blocked[i] = false;
        continue;
      }
      childHash[i] = edge.hash ^ (node.blackToPlay ? 0u : turnKey());
      blocked[i] = seen.contains(childHash[i]);
    }

    // The heaviest opponent reply decides which side of White's distribution survives culling.
    int maxWeight = 1;
    for (size_t i = 0; i < node.children.size(); ++i) {
      if (blocked[i]) continue;
      if (node.children[i].weight > maxWeight) maxWeight = node.children[i].weight;
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

    // Both terms are fixed for the whole scan, so the square root and the division are hoisted out
    // of the loop rather than repeated per child.
    const double visitRoot = std::sqrt(static_cast<double>(node.n));
    const double unexpandedQ = node.n > 0 ? node.s / static_cast<double>(node.n) : 0.0;
    const double exploration = cfg.exploration;

    for (size_t i = 0; i < node.children.size(); ++i) {
      Edge& edge = node.children[i];
      if (blocked[i]) continue;
      if (lastPassed && edge.pos == -1) continue;

      if (edge.child < 0) {
        const auto it = graph.table.find(edge.hash);
        if (it != graph.table.end()) edge.child = it->second;
      }

      const double prior =
          edge.child >= 0 ? graph.nodes[static_cast<size_t>(edge.child)].prior()
                          : static_cast<double>(kPoints);
      const double q =
          edge.child >= 0 ? graph.nodes[static_cast<size_t>(edge.child)].mean() : unexpandedQ;
      double score = sign * q +
                     exploration * prior * visitRoot / (1.0 + static_cast<double>(edge.visits));

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
    seen.insert(childHash[static_cast<size_t>(bestChild)]);

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
    // `edge.hash` is already hashBoard(childBoard, childBlackToPlay), so the new node needs no
    // rehash of its own.
    const uint32_t childNodeHash = edge.hash;
    const int created =
        createNode(graph, childBoard, childBlackToPlay, cfg, seen, childNodeHash);
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

// The root's children as the search reports them: the child's mean for every edge that has one,
// and the double-pass pseudo-child folded onto the pass edge when White passed last.
void finaliseRoot(Tree& tree) {
  Node& rootNode = tree.graph.nodes[static_cast<size_t>(tree.rootIndex)];
  for (Edge& edge : rootNode.children) {
    if (edge.child >= 0) edge.value = tree.graph.nodes[static_cast<size_t>(edge.child)].mean();
  }
  if (tree.whitePassedLast) {
    // White passed, so the pass edge is the double-pass option rather than a move.
    if (!rootNode.children.empty()) {
      rootNode.children[0].visits = rootNode.endVisits;
      rootNode.children[0].value = rootNode.endScore;
    }
  }
}

void harvest(Tree& tree, Result& result) {
  finaliseRoot(tree);
  const Node& rootNode = tree.graph.nodes[static_cast<size_t>(tree.rootIndex)];
  result.q = rootNode.mean();
  result.s = rootNode.prior();
  result.nodes = static_cast<long>(tree.graph.nodes.size());
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
}

// The root children of every worker, summed.
//
// A move's total is the visits every tree gave it, and its value is the visit-weighted mean of
// theirs, so a tree that searched a move harder counts for more. Nothing below the root is merged:
// two workers' children for the same move are nodes in different graphs, and adding their sub-trees
// would report counts that were never gathered on one tree.
void mergeTrees(const std::vector<std::unique_ptr<Tree>>& trees, Result& result) {
  constexpr int kSlots = kPoints + 1;  // the pass edge, then one per point
  long visits[kSlots] = {};
  double weighted[kSlots] = {};
  int weight[kSlots] = {};
  bool present[kSlots] = {};
  long nodes = 0;
  double sumS = 0.0;
  double sumN = 0.0;
  double sumPrior = 0.0;

  for (const std::unique_ptr<Tree>& held : trees) {
    Tree& tree = *held;
    finaliseRoot(tree);
    const Node& rootNode = tree.graph.nodes[static_cast<size_t>(tree.rootIndex)];
    const double n = static_cast<double>(rootNode.n);
    sumS += rootNode.s;
    sumN += n;
    sumPrior += rootNode.prior() * n;
    nodes += static_cast<long>(tree.graph.nodes.size());
    for (const Edge& edge : rootNode.children) {
      const int slot = edge.pos < 0 ? 0 : edge.pos + 1;
      visits[slot] += edge.visits;
      weighted[slot] += static_cast<double>(edge.visits) * edge.value;
      if (edge.weight > weight[slot]) weight[slot] = edge.weight;
      present[slot] = true;
    }
  }

  result.q = sumN > 0.0 ? sumS / sumN : 0.0;
  result.s = sumN > 0.0 ? sumPrior / sumN : 0.0;
  result.nodes = nodes;
  result.moves.reserve(kSlots);
  for (int slot = 0; slot < kSlots; ++slot) {
    if (!present[slot]) continue;
    MoveResult move;
    move.pos = slot == 0 ? -1 : slot - 1;
    move.visits = visits[slot];
    move.value = visits[slot] > 0 ? weighted[slot] / static_cast<double>(visits[slot]) : 0.0;
    move.weight = weight[slot];
    result.moves.push_back(move);
  }
  std::stable_sort(result.moves.begin(), result.moves.end(),
                   [](const MoveResult& a, const MoveResult& b) { return a.visits > b.visits; });
}

// 0 is "one per hardware thread", and never more workers than there are playouts to give them.
unsigned resolveThreads(int requested, long playouts) {
  unsigned threads;
  if (requested > 1) {
    threads = static_cast<unsigned>(requested);
  } else if (requested == 0) {
    threads = std::thread::hardware_concurrency();
    if (threads == 0) threads = 1;
  } else {
    threads = 1;
  }
  const long available = playouts > 0 ? playouts : 1;
  const unsigned cap = static_cast<unsigned>(std::min<long>(available, 256));
  return std::max(1u, std::min(threads, cap));
}

// A draw sequence per worker. Every thread starts from the same thread-local seed, so without this
// every tree would replay the same games and the workers would add up to one worker's evidence.
uint64_t workerSeed(unsigned index, uint32_t rootHash) {
  static std::atomic<uint64_t> counter{0};
  uint64_t x = static_cast<uint64_t>(rootHash) * 0x9E3779B97F4A7C15ULL;
  x ^= static_cast<uint64_t>(index + 1) * 0xD1B54A32D192ED03ULL;
  x ^= counter.fetch_add(1, std::memory_order_relaxed) * 0xA24BAED4963EE407ULL;
  // splitmix64's finaliser, so neighbouring workers do not share a prefix.
  x += 0x9E3779B97F4A7C15ULL;
  x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ULL;
  x = (x ^ (x >> 27)) * 0x94D049BB133111EBULL;
  x ^= x >> 31;
  return x;
}

Result searchParallel(const Board& root, uint32_t rootHash, bool whitePassedLast,
                      const std::vector<uint32_t>& seenHashes, const Config& cfg, unsigned threads) {
  Result result;

  Config treeCfg = cfg;
  treeCfg.maxNodes = std::max(1, cfg.maxNodes / static_cast<int>(threads));

  // One playout creates at most one node, and the root adds its own children on top.
  const long perTree = cfg.playouts / static_cast<long>(threads) + 1;
  const long reserveNodes = std::min<long>(treeCfg.maxNodes, perTree + kPoints + 1);

  std::vector<std::unique_ptr<Tree>> trees;
  trees.reserve(threads);
  for (unsigned t = 0; t < threads; ++t) trees.push_back(std::make_unique<Tree>());

  // Workers claim batches from one counter instead of being handed a fixed share. What a playout
  // costs depends on how deep it lands and whether it expands a White node - which the scheduler
  // cannot know in advance - so a fixed share leaves every worker waiting on the slowest draw. A
  // batch is small enough that a slow one costs a few percent of a worker's time, and large enough
  // that the counter is nowhere near the hot path.
  const long batch =
      std::max<long>(1, std::min<long>(256, cfg.playouts / (static_cast<long>(threads) * 16)));
  std::atomic<long> claimed{0};
  std::atomic<bool> cancelled{false};

  const auto work = [&](unsigned index) {
    Tree& tree = *trees[index];
    seedRandom(workerSeed(index, rootHash));
    initTree(tree, root, rootHash, whitePassedLast, seenHashes, treeCfg, reserveNodes);
    for (;;) {
      if (cancelled.load(std::memory_order_relaxed)) return;
      const long base = claimed.fetch_add(batch, std::memory_order_relaxed);
      if (base >= cfg.playouts) return;
      const long end = std::min(cfg.playouts, base + batch);
      for (long i = base; i < end; ++i) {
        if (cfg.cancel != nullptr && cfg.cancel->load(std::memory_order_relaxed)) {
          cancelled.store(true, std::memory_order_relaxed);
          return;
        }
        runOnePlayout(tree, treeCfg);
      }
    }
  };

  // The calling thread is a worker too. The search already owns every core it asked for, so
  // parking it while N others run would only take a core away from the last worker.
  std::vector<std::thread> workers;
  workers.reserve(threads - 1);
  try {
    for (unsigned t = 1; t < threads; ++t) workers.emplace_back(work, t);
  } catch (const std::system_error&) {
    // Out of threads. Dynamic claiming means fewer workers is slower, not wrong.
  }
  work(0);
  for (std::thread& worker : workers) worker.join();

  if (cancelled.load(std::memory_order_relaxed)) result.cancelled = true;
  mergeTrees(trees, result);
  return result;
}

}  // namespace

unsigned workerCount(int requested, long playouts) { return resolveThreads(requested, playouts); }

Result search(const Board& root, bool whitePassedLast, const std::vector<uint32_t>& seenHashes,
              const Config& cfg) {
  Result result;
  const uint32_t rootHash = hashBoard(root, false);

  const unsigned threads = resolveThreads(cfg.threads, cfg.playouts);
  if (threads > 1) return searchParallel(root, rootHash, whitePassedLast, seenHashes, cfg, threads);

  Tree tree;
  initTree(tree, root, rootHash, whitePassedLast, seenHashes, cfg, treeReserveFor(cfg));
  for (long playoutIndex = 0; playoutIndex < cfg.playouts; ++playoutIndex) {
    if (cfg.cancel != nullptr && cfg.cancel->load(std::memory_order_relaxed)) {
      result.cancelled = true;
      break;
    }
    runOnePlayout(tree, cfg);
  }
  harvest(tree, result);
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

