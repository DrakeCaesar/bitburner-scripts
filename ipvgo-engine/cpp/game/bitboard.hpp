// Packed bit planes for a board, so the connectivity questions in the rules can
// be answered with a handful of word operations instead of a flood fill plus
// half a dozen heap allocations.
//
// A point index is x * N + y (the same flat index the rest of the engine uses).
// Points live in six 64-bit words, which covers 19x19 = 361, the largest subnet
// the game has. Every mask below is per word: point 70 lives in word 1, bit 6.
#pragma once

#include <array>
#include <cstdint>

#include "bit_ops.hpp"
#include "go_game.hpp"

namespace ipvgo::game {

constexpr int kBitWords = 6;  // 6 x 64 = 384 >= 19*19

// Per board size edge masks, so a +-1 shift never wraps a row into the next
// column.
struct BitLayout {
  uint64_t board[kBitWords] = {0, 0, 0, 0, 0, 0};      // all valid points
  uint64_t notTop[kBitWords] = {0, 0, 0, 0, 0, 0};     // points with y < N-1
  uint64_t notBottom[kBitWords] = {0, 0, 0, 0, 0, 0};  // points with y > 0

  static const BitLayout& forSize(int n) {
    // One thread-safe initialisation for every size the game supports.
    static const std::array<BitLayout, 20> table = [] {
      std::array<BitLayout, 20> built{};
      for (int size = 0; size < 20; ++size) {
        BitLayout layout;
        for (int x = 0; x < size; ++x) {
          for (int y = 0; y < size; ++y) {
            const int idx = x * size + y;
            if (idx >= kBitWords * 64) continue;
            const uint64_t bit = 1ULL << (idx & 63);
            layout.board[idx >> 6] |= bit;
            if (y < size - 1) layout.notTop[idx >> 6] |= bit;
            if (y > 0) layout.notBottom[idx >> 6] |= bit;
          }
        }
        built[static_cast<size_t>(size)] = layout;
      }
      return built;
    }();
    const int size = n >= 0 && n < 20 ? n : 0;
    return table[static_cast<size_t>(size)];
  }
};

// Bit planes for one position.
struct BitPlanes {
  uint64_t black[kBitWords] = {0, 0, 0, 0, 0, 0};
  uint64_t white[kBitWords] = {0, 0, 0, 0, 0, 0};
  uint64_t blocked[kBitWords] = {0, 0, 0, 0, 0, 0};
  uint64_t occupied[kBitWords] = {0, 0, 0, 0, 0, 0};
  uint64_t empty[kBitWords] = {0, 0, 0, 0, 0, 0};
  int N = 0;

  static bool fits(int n) { return n > 0 && n * n <= kBitWords * 64; }

  void reset(int n) {
    N = n;
    for (int w = 0; w < kBitWords; ++w) {
      black[w] = white[w] = blocked[w] = occupied[w] = empty[w] = 0;
    }
  }

  void set(int x, int y, char cell) {
    const int idx = x * N + y;
    const uint64_t bit = 1ULL << (idx & 63);
    uint64_t* word = nullptr;
    switch (cell) {
      case 'X': word = black; break;
      case 'O': word = white; break;
      case '#': word = blocked; break;
      default: return;
    }
    word[idx >> 6] |= bit;
  }

  // Rebuilds occupied/empty from the stone planes and the board mask.
  void seal(const BitLayout& layout) {
    for (int w = 0; w < kBitWords; ++w) {
      occupied[w] = black[w] | white[w] | blocked[w];
      empty[w] = layout.board[w] & ~occupied[w];
    }
  }

  static void load(const SimpleBoard& board, BitPlanes& out) {
    const int n = board.size();
    out.reset(n);
    for (int x = 0; x < n; ++x) {
      const char* col = board.column(x);
      for (int y = 0; y < n; ++y) {
        const char cell = col[y];
        if (cell != '.' && cell != 'X' && cell != 'O' && cell != '#') continue;
        out.set(x, y, cell);
      }
    }
    out.seal(BitLayout::forSize(n));
  }
};

namespace bits {

// Every kernel is templated on the word count W so a 7x7 board (49 points)
// loops over one word instead of six. `by` must stay below 64 (boards <= 19).
template <int W>
inline void shiftUp(uint64_t* m, int by) {  // toward higher point indices
  for (int w = W - 1; w >= 0; --w) {
    const uint64_t carry = w > 0 ? m[w - 1] >> (64 - by) : 0;
    m[w] = (m[w] << by) | carry;
  }
}

template <int W>
inline void shiftDown(uint64_t* m, int by) {  // toward lower point indices
  for (int w = 0; w < W; ++w) {
    const uint64_t carry = w + 1 < W ? m[w + 1] << (64 - by) : 0;
    m[w] = (m[w] >> by) | carry;
  }
}

// Points adjacent to the given set (N/E/S/W), clipped to the board.
template <int W>
inline void neighbours(const uint64_t* m, const BitLayout& layout, int n, uint64_t* out) {
  uint64_t up[W];
  uint64_t down[W];
  uint64_t east[W];
  uint64_t west[W];
  for (int w = 0; w < W; ++w) {
    up[w] = m[w] & layout.notTop[w];
    down[w] = m[w] & layout.notBottom[w];
    east[w] = m[w];
    west[w] = m[w];
  }
  shiftUp<W>(up, 1);
  shiftDown<W>(down, 1);
  shiftUp<W>(east, n);
  shiftDown<W>(west, n);

  for (int w = 0; w < W; ++w) {
    out[w] = (up[w] | down[w] | east[w] | west[w]) & layout.board[w];
  }
}

// Grows `seed` over the points in `through` until it encloses nothing new.
template <int W>
inline void flood(const uint64_t* through, uint64_t* seed, const BitLayout& layout, int n) {
  uint64_t next[W];
  bool changed = true;
  while (changed) {
    changed = false;
    neighbours<W>(seed, layout, n, next);
    for (int w = 0; w < W; ++w) {
      const uint64_t grown = seed[w] | (next[w] & through[w]);
      if (grown != seed[w]) changed = true;
      seed[w] = grown;
    }
  }
}

template <int W>
inline bool any(const uint64_t* m) {
  for (int w = 0; w < W; ++w) {
    if (m[w] != 0) return true;
  }
  return false;
}

// Index of the lowest set point, or -1 when empty.
template <int W>
inline int lowest(const uint64_t* m) {
  for (int w = 0; w < W; ++w) {
    if (m[w] == 0) continue;
    return w * 64 + lowestBit(m[w]);
  }
  return -1;
}

}  // namespace bits

}  // namespace ipvgo::game