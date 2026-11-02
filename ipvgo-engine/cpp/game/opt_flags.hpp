#pragma once

namespace ipvgo::game {

// Runtime switches for the search optimisations. Every flag must preserve the
// exact result of the code path it replaces, so they can be A/B measured against
// each other on the same positions.
struct OptFlags {
  bool growthCache = false;   // MoveGen computes the liberty-growth list once
  bool fastQueries = false;   // chain-free local liberty queries
  bool persistCache = false;  // reply distribution cached across depths/threads
  bool forcedPath = false;    // skip pool construction when the reply is forced

  bool any() const { return growthCache || fastQueries || persistCache || forcedPath; }
  bool all() const { return growthCache && fastQueries && persistCache && forcedPath; }
};

// Process-wide switch read by the move generators. Set once (before any search
// thread starts) so reads are lock-free.
extern OptFlags g_opt;

}  // namespace ipvgo::game
