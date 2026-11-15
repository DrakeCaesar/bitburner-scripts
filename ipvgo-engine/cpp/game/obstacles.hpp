#pragma once

#include "go_game.hpp"

namespace ipvgo::game {

// Fixed 19x19 board shape used by the secret w0r1d_d43m0n opponent
// (bitverseBoardShape rotated 90 degrees, as the game does).
SimpleBoard bitverseBoard();

// Procedurally add offline/blocked nodes to an (all-empty) board, faithfully
// reproducing src/Go/boardState/offlineNodes.ts including its RNG draw order
// and the stale-coordinate rotation behavior. seedMs stands in for
// Player.totalPlaytime (milliseconds).
void addObstacles(GameState& state, double seedMs);

}  // namespace ipvgo::game
