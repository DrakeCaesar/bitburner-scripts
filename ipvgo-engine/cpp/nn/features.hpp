#pragma once

#include <vector>

#include "go_game.hpp"

namespace ipvgo::nn {

using ipvgo::game::Color;
using ipvgo::game::GameState;

// Number of feature planes produced by encodeState.
constexpr int kNumPlanes = 12;

// Action index convention: 0..N*N-1 are board points (x = a / N, y = a % N);
// action N*N is "pass".
inline int passAction(int N) { return N * N; }
inline int actionCount(int N) { return N * N + 1; }

// Encode a position from `player`'s perspective into kNumPlanes planes of size
// NxN, returned flattened as [plane][x][y] (row-major over planes then x then y).
//
// Planes:
//   0  own stones            1  opponent stones
//   2  empty points          3  offline nodes
//   4  legal moves for player 5  all-ones bias
//   6  komi (constant, /10)   7  ones if own turn (always here) constant
//   8  own stones 1 move ago  9  opponent stones 1 move ago
//   10 own stones 2 moves ago 11 opponent stones 2 moves ago
std::vector<float> encodeState(const GameState& state, Color player);

// Convenience: legal-move mask (size N*N+1; pass always legal) for `player`.
std::vector<char> legalActionMask(const GameState& state, Color player);

}  // namespace ipvgo::nn
