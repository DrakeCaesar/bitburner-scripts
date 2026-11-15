#pragma once

#include "go_game.hpp"

namespace ipvgo::game {

// True if any of the game's expanded 3x3 patterns matches at (x,y) for `player`.
// Note: the game's horizontalMirror expansion is broken (Array.join() inserts
// commas) so those variants never match; we faithfully reproduce the effective
// pattern set (base + 4 rotations + vertical mirror = 104 patterns).
bool matchesAnyPattern(const SimpleBoard& board, int x, int y, Color player);

// The same predicate written as the original nested loop (pattern at a time, cell
// at a time). Kept as an oracle: the bitset version must agree with it on every
// position, which selftest and fuzz both check.
bool matchesAnyPatternSlow(const SimpleBoard& board, int x, int y, Color player);

}  // namespace ipvgo::game
