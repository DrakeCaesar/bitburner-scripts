#pragma once

#include <utility>
#include <vector>

#include "analysis.hpp"
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

// Empty intersections the faction AI would even consider (disputed territory).
// Uses the same isSmart draw as getMove (first WHRNG step from seedMs).
std::vector<Pt> factionConsideredSpaces(const GameState& state, Color player, Opponent opponent,
                                        double seedMs);

// Black search moves pruned to exploit the scripted opponent (not full Go legality).
std::vector<std::pair<int, int>> blackExploitMoves(const GameState& state, Opponent opponent,
                                                   double seedMs);

// Board points the faction AI could play (MoveGen categories + availableSpaces), not all legal Go moves.
std::vector<Pt> enumerateFactionMoves(const GameState& state, Color player, Opponent opponent,
                                      MathRandom& mathRng);

// Faction-specific move universe for search (Netburners uses a tighter model).
std::vector<Pt> enumerateOpponentMoves(const GameState& state, Color player, Opponent opponent,
                                         MathRandom& mathRng);

// One possible faction reply with the probability its policy assigns to it.
struct WeightedReply {
  bool passMove = false;
  int x = -1;
  int y = -1;
  double prob = 0.0;
};

// Distribution of the faction AI's next move, derived from the ported priority
// tables: the faction branch draw is enumerated exactly (interval masses), pool
// picks are uniform (floorIndex), and the leading isSmart draw is mixed in with
// its known probability. This is what makes the scripted opponent predictable
// rather than adversarial.
struct ReplyDist {
  std::vector<WeightedReply> replies;  // sorted by prob desc; probs sum to 1
};

ReplyDist opponentReplyDistribution(const GameState& state, Color player, Opponent opponent);

}  // namespace ipvgo::game
