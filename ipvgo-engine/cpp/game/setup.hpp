#pragma once

#include "go_game.hpp"
#include "rng.hpp"

namespace ipvgo::game {

// Number of starting white handicap stones for the given opponent/size.
int getHandicap(int boardSize, Opponent ai);

// Place `handicap` white stones on an empty board (mirrors applyHandicap,
// including the 5x5 center special-case). Uses `mathRng` for Math.random().
void applyHandicap(SimpleBoard& board, int handicap, MathRandom& mathRng);

// Create a new game (optionally with procedural obstacles and handicap).
// seedMs stands in for Player.totalPlaytime (ms); mathRng backs handicap RNG.
GameState newBoardState(int boardSize, Opponent ai, bool applyObstacles, double seedMs, MathRandom& mathRng);

}  // namespace ipvgo::game
