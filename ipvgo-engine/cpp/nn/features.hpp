#pragma once

#include <cstddef>
#include <cstdint>

#include "go_game.hpp"

namespace ipvgo::nn {

// Action index convention: 0..N*N-1 are board points (x = a / N, y = a % N);
// action N*N is "pass".
inline int passAction(int N) { return N * N; }
inline int actionCount(int N) { return N * N + 1; }

inline uint64_t fnv1a64(uint64_t h, uint64_t v) {
  h ^= v;
  h *= 0x100000001b3ULL;
  return h;
}

// Position identity for transposition tables: board, turn, ko/superko history.
inline uint64_t positionKey(const ipvgo::game::GameState& state) {
  uint64_t h = 0xcbf29ce484222325ULL;
  const int n = state.board.size();
  for (int x = 0; x < n; ++x) {
    const char* col = state.board.column(x);
    for (int y = 0; y < n; ++y) h = fnv1a64(h, static_cast<uint64_t>(col[y]));
  }
  h = fnv1a64(h, static_cast<uint64_t>(state.previousPlayer));
  h = fnv1a64(h, static_cast<uint64_t>(state.passCount));
  h = fnv1a64(h, state.gameOver ? 1ULL : 0ULL);
  h = fnv1a64(h, static_cast<uint64_t>(state.previousBoards.size()));
  // Most recent first, exactly like the old "front = most recent" string list.
  const int stride = state.previousBoards.stride();
  const int count = state.previousBoards.size();
  for (int back = 0; back < 4 && back < count; ++back) {
    const uint64_t* words = state.previousBoards.entryWords(count - 1 - back);
    for (int w = 0; w < stride; ++w) h = fnv1a64(h, words[w]);
  }
  return h;
}

// History-free identity: transpositions that differ only in move order collapse,
// which endgame solves need to stay tractable.
inline uint64_t boardPositionKey(const ipvgo::game::GameState& state) {
  uint64_t h = 0xcbf29ce484222325ULL;
  const int n = state.board.size();
  for (int x = 0; x < n; ++x) {
    const char* col = state.board.column(x);
    for (int y = 0; y < n; ++y) h = fnv1a64(h, static_cast<uint64_t>(col[y]));
  }
  h = fnv1a64(h, static_cast<uint64_t>(state.previousPlayer));
  h = fnv1a64(h, static_cast<uint64_t>(state.passCount));
  h = fnv1a64(h, state.gameOver ? 1ULL : 0ULL);
  return h;
}

}  // namespace ipvgo::nn
