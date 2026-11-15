#pragma once

#include <utility>
#include <vector>

#include "go_game.hpp"

namespace ipvgo::game {

// The four cheat actions available via ns.go.cheat (Source-File 14.2).
enum class CheatType {
  RemoveRouter,      // clear the stone at (x,y) -> empty
  PlayTwoMoves,      // place player's stones at two points at once
  RepairOfflineNode, // turn an offline node back into an empty point
  DestroyNode,       // turn any point into an offline node
};

// Player-dependent inputs to the success formula (see cheatSuccessChance):
//   crimeSuccessMult = Player.mults.crime_success
//   sourceFileBonus  = 0.25 if SF14 level 3, else 0
struct CheatParams {
  double crimeSuccessMult = 1.0;
  double sourceFileBonus = 0.0;
};

enum class CheatResult {
  Success,       // effect applied; opponent still to reply
  TurnSkipped,   // failed, turn passed (no ejection)
  Ejected,       // failed with prior cheats -> ejected, game over
  InvalidTarget, // target point(s) invalid (e.g. offline where not allowed)
};

// Faithful port of cheatSuccessChance: clamp(0.6*(0.7-0.02n)^n*crime + SFbonus, 0, 1).
double cheatSuccessChance(int cheatCount, const CheatParams& params);

// Attempt a cheat as `player`, faithfully porting determineCheatSuccess:
//   - resets passCount, uses successRng/ejectRng in [0,1) (matching the game's
//     RngOverride hooks) to decide success/eject/skip,
//   - on success applies the effect and resolves captures,
//   - on failure either skips the turn or (with prior cheats, 10%) ends the game,
//   - increments the relevant cheat counter (except on ejection).
// Does NOT run the opponent's reply; callers/environment handle that.
// `points` holds the target coordinate(s): one (x,y) for all cheats except
// PlayTwoMoves which needs two.
CheatResult applyCheat(GameState& state, Color player, CheatType type,
                       const std::vector<std::pair<int, int>>& points, double successRng, double ejectRng,
                       const CheatParams& params);

// First half of PlayTwoMoves modeled as an extended action: rolls once, and on
// success places a single stone at (x,y) WITHOUT resolving captures and WITHOUT
// yielding the turn, so the same player moves again (the caller places the
// second stone via the normal environment step, which resolves captures with
// both stones present -- equivalent to the game's simultaneous two-stone play).
// Failure (skip / eject) behaves exactly like applyCheat. Returns Success,
// TurnSkipped, Ejected, or InvalidTarget.
CheatResult beginPlayTwoMoves(GameState& state, Color player, int x, int y, double successRng, double ejectRng,
                              const CheatParams& params);

}  // namespace ipvgo::game
