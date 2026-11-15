#pragma once

#include <optional>
#include <string>

#include "go_game.hpp"

namespace ipvgo::game {

// Parse an opponent name. Accepts both the game's display names ("Slum Snakes")
// and compact identifiers ("SlumSnakes"). Returns nullopt if unknown.
std::optional<Opponent> parseOpponent(const std::string& name);
std::string opponentName(Opponent ai);

Color parseColor(const std::string& s);  // "O" -> White, otherwise Black

}  // namespace ipvgo::game
