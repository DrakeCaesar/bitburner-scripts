#pragma once

#include <vector>

#include "go_game.hpp"

namespace ipvgo::game {

// Radial influence, after Bouzy's mathematical morphology ("Mathematical
// morphology applied to computer Go", IJPRAI 17(2):257-268, 2003).
//
// The operator here is the numeric dilation `Dz` only - five or so iterations of
// "grow into points that are not contested" - which Bouzy calls the influence or
// moyo estimate, `Xz(n,0)`. The erosion half (`Xz(21,5)`) turns influence into a
// territory estimate but assumes life and death is already known, which is the
// thing being evaluated here, so it is not used.
//
// Why the evaluator wants it: area scoring gives a scattered two-stone group the
// same value as two stones of a connected twenty-stone mass. Influence does not -
// a connected mass dominates the space around it, scattered stones do not - and
// that is the difference that decided the games the area score got wrong.
struct Influence {
  int size = 0;
  std::vector<int> value;  // per flat point, positive favours Black
  int black = 0;           // sum of positive values
  int white = 0;           // sum of |negative values|
  int diff() const { return black - white; }
};

// `iterations` is how many dilation steps to run; 5 reaches five points out.
Influence computeInfluence(const SimpleBoard& board, int iterations);

}  // namespace ipvgo::game
