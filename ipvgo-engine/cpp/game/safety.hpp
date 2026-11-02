#pragma once

#include <vector>

#include "go_game.hpp"

namespace ipvgo::game {

// Static safety analysis: which chains cannot be captured. Used by the evaluator
// so it stops counting points that are not really held.
//
// Two levels, both static (no search over the game tree):
//
//   Benson - pass-alive. A chain is Benson-alive when it belongs to a set of
//            chains that between them enclose at least two "vital" regions. It
//            cannot be captured even if its owner always passes, so its stones
//            and those regions are certain points. Benson (Information Sciences
//            10:17-29, 1976) proves this is exact and complete. The converse does
//            NOT hold: a chain that is not Benson-alive is almost always alive in
//            real play, so this must never be read as "dead".
//
//   Vital  - safe under alternating play: the chain lives if it may answer inside
//            its own region. Implemented exactly - let the defender play a point
//            in the region, then re-run Benson - rather than with the static
//            predicate from Fuego's GoSafetySolver, whose exact form could not be
//            verified from a primary source.
//
// Neither level ever marks a chain dead; they only add confidence.
enum class SafetyLevel : unsigned char {
  None = 0,
  Benson = 1,  // pass-alive
  Vital = 2,   // alive when the defender answers in its own region
};

struct SafetyRegion {
  char borderColor = 0;           // colour the region belongs to
  std::vector<int> points;        // flat indices, includes opponent stones
  std::vector<int> emptyPoints;   // flat indices of '.' only
  std::vector<int> borderChains;  // chain indices of borderColor touching the region
  bool small = false;             // every empty point is a liberty of a border chain
};

struct SafetyResult {
  std::vector<SafetyLevel> chain;  // indexed by ChainSet chain index
  std::vector<char> vitalPoint;    // per flat point: in a vital region of a safe chain
  int bensonChains = 0;
  int vitalChains = 0;

  SafetyLevel level(int chainIdx) const {
    if (chainIdx < 0 || chainIdx >= static_cast<int>(chain.size())) return SafetyLevel::None;
    return chain[static_cast<size_t>(chainIdx)];
  }
  bool safe(int chainIdx) const { return level(chainIdx) != SafetyLevel::None; }
};

// Regions with no stones of `color`. Obstacles act as walls: they are unplayable,
// so they help enclose a region, which is the standard engineering reading.
std::vector<SafetyRegion> buildSafetyRegions(const SimpleBoard& board, const ChainSet& cs, Color color);

// Pass-alive chains of `color`. With `extendWithVital`, chains that live when the
// defender answers in one of their regions are marked Vital as well.
SafetyResult analyzeSafety(const SimpleBoard& board, const ChainSet& cs, Color color,
                           bool extendWithVital);

}  // namespace ipvgo::game
