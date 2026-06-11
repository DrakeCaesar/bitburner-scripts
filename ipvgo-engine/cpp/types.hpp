#pragma once

#include <string>
#include <vector>

namespace ipvgo {

enum class Color : char { Black = 'X', White = 'O', Empty = '.', Dead = '#' };

enum class MoveType { Play, Pass };

struct Move {
  MoveType type = MoveType::Pass;
  int x = -1;
  int y = -1;
};

using Board = std::vector<std::string>;
using ValidMask = std::vector<std::vector<bool>>;

struct MoveResult {
  Move move;
  int iterations = 0;
  double elapsedMs = 0;
};

inline Color opponent(Color c) { return c == Color::Black ? Color::White : Color::Black; }

} // namespace ipvgo
