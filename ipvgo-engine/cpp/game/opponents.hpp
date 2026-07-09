#pragma once

#include "go_game.hpp"
#include "rng.hpp"

namespace ipvgo::game {

// Compute the faction AI's move for `player` (always white in normal games),
// faithfully porting src/Go/boardAnalysis/goAI.ts. seedMs seeds the WHRNG used
// for the four rng.random() draws; mathRng backs the getDefendMove tie-break.
Play getMove(const GameState& state, Color player, Opponent opponent, double seedMs, MathRandom& mathRng);

// Whether the given faction uses "smart" failsafes for this move (isSmart),
// given a uniform draw in [0,1).
bool isSmart(Opponent faction, double rng);

}  // namespace ipvgo::game
