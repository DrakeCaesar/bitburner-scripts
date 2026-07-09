#include "patterns.hpp"

#include <array>
#include <string>
#include <vector>

namespace ipvgo::game {

namespace {

using Pattern = std::array<std::string, 3>;

// Base 3x3 patterns from src/Go/boardAnalysis/patternMatching.ts.
const std::vector<Pattern>& basePatterns() {
  static const std::vector<Pattern> patterns = {
      {"XOX", "...", "???"},  // hane - enclosing
      {"XO.", "...", "?.?"},  // hane - non-cutting
      {"XO?", "X..", "o.?"},  // hane - magari
      {".O.", "X..", "..."},  // katatsuke / diagonal attachment
      {"XO?", "O.x", "?x?"},  // cut1 - unprotected
      {"XO?", "O.X", "???"},  // cut1 - peeped
      {"?X?", "O.O", "xxx"},  // cut2 (de)
      {"OX?", "x.O", "???"},  // cut keima
      {"X.?", "O.?", "   "},  // side - chase
      {"OX?", "X.O", "   "},  // side - block side cut
      {"?X?", "o.O", "   "},  // side - block side connection
      {"?XO", "o.o", "   "},  // side - sagari
      {"?OX", "X.O", "   "},  // side - cut
  };
  return patterns;
}

Pattern rotate90(const Pattern& p) {
  return {std::string({p[2][0], p[1][0], p[0][0]}), std::string({p[2][1], p[1][1], p[0][1]}),
          std::string({p[2][2], p[1][2], p[0][2]})};
}

Pattern verticalMirror(const Pattern& p) { return {p[2], p[1], p[0]}; }

// base + 4 rotations, then add vertical mirror of each. (horizontalMirror in the
// game is a no-op due to a bug, so it is intentionally omitted.)
const std::vector<Pattern>& expandedPatterns() {
  static const std::vector<Pattern> expanded = [] {
    std::vector<Pattern> rotated;
    for (const auto& p : basePatterns()) rotated.push_back(p);
    for (const auto& p : basePatterns()) rotated.push_back(rotate90(p));
    for (const auto& p : basePatterns()) rotated.push_back(rotate90(rotate90(p)));
    for (const auto& p : basePatterns()) rotated.push_back(rotate90(rotate90(rotate90(p))));

    std::vector<Pattern> mirrored = rotated;
    for (const auto& p : rotated) mirrored.push_back(verticalMirror(p));
    return mirrored;
  }();
  return expanded;
}

// Cell content code: 'X','O','.','#', or '\0' for off-board.
char cellAt(const SimpleBoard& board, int N, int x, int y) {
  if (x < 0 || y < 0 || x >= N || y >= N) return '\0';
  return board[x][y];
}

bool matches(char patternChar, char cell, char me, char opp) {
  switch (patternChar) {
    case 'X': return cell == me;
    case 'O': return cell == opp;
    case 'x': return cell != opp;   // stone of opponent color required to fail; off-board passes
    case 'o': return cell != me;
    case '.': return cell == '.';
    case ' ': return cell == '#';   // matches offline node only (not off-board)
    case '?': return true;
  }
  return false;
}

}  // namespace

bool matchesAnyPattern(const SimpleBoard& board, int x, int y, Color player) {
  const int N = static_cast<int>(board.size());
  const char me = colorChar(player);
  const char opp = colorChar(oppositeColor(player));

  std::array<char, 9> nb{};
  int k = 0;
  for (int dx = -1; dx <= 1; ++dx) {
    for (int dy = -1; dy <= 1; ++dy) {
      nb[k++] = cellAt(board, N, x + dx, y + dy);
    }
  }

  for (const auto& pattern : expandedPatterns()) {
    bool ok = true;
    for (int i = 0; i < 9 && ok; ++i) {
      const char pc = pattern[i / 3][i % 3];
      if (!matches(pc, nb[i], me, opp)) ok = false;
    }
    if (ok) return true;
  }
  return false;
}

}  // namespace ipvgo::game
