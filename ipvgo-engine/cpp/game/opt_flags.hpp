#pragma once

namespace ipvgo::game {

// Runtime switches for the search optimisations. Every flag must preserve the
// exact result of the code path it replaces, so they can be A/B measured against
// each other on the same positions (see nn/optbench.cpp).
struct OptFlags {
  bool growthCache = true;   // MoveGen computes the liberty-growth list once
  bool fastQueries = true;   // chain-free local liberty queries
  bool persistCache = true;  // reply distribution cached across depths/threads
  bool forcedPath = true;    // skip pool construction when the reply is forced

  bool any() const { return growthCache || fastQueries || persistCache || forcedPath; }
  bool all() const { return growthCache && fastQueries && persistCache && forcedPath; }
};

// Explicit presets: benchmark baselines must not follow the struct defaults.
constexpr OptFlags kOptAllOff{false, false, false, false};
constexpr OptFlags kOptAllOn{true, true, true, true};

// Process-wide switch read by the move generators. Set once (before any search
// thread starts) so reads are lock-free.
extern OptFlags g_opt;

}  // namespace ipvgo::game
