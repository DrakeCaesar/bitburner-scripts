#pragma once

#include "go_game.hpp"

namespace ipvgo::game {

// True if any of the game's expanded 3x3 patterns matches at (x,y) for `player`.
// Note: the game's horizontalMirror expansion is broken (Array.join() inserts
// commas) so those variants never match; we faithfully reproduce the effective
// pattern set (base + 4 rotations + vertical mirror = 104 patterns).
bool matchesAnyPattern(const SimpleBoard& board, int x, int y, Color player);

}  // namespace ipvgo::game
