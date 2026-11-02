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

// Cell classes, relative to the player so that one table serves both colours.
enum CellClass : int {
  kEmpty = 0,
  kMine = 1,
  kTheirs = 2,
  kWall = 3,
  kOffBoard = 4,
  kCellClasses = 5,
};

constexpr char representative(CellClass c) {
  switch (c) {
    case kEmpty: return '.';
    case kMine: return 'X';
    case kTheirs: return 'O';
    case kWall: return '#';
    default: return '\0';
  }
}

int classOf(char cell, char me, char opp) {
  if (cell == '.') return kEmpty;
  if (cell == me) return kMine;
  if (cell == opp) return kTheirs;
  if (cell == '#') return kWall;
  return kOffBoard;
}

// One bit per pattern, tested nine cells at a time.
//
// The previous loop walked every pattern and every cell with a switch, which the
// profiler put at 46% of total runtime (patterns.cpp:93-95). Transposing the
// problem turns it into nine AND operations over all patterns at once: for cell
// position i and cell class c, `accept[i][c]` holds the bitmask of patterns that
// allow that combination.
constexpr int kPatternWords = 2;  // 128 patterns max

struct PatternMasks {
  uint64_t accept[9][kCellClasses][kPatternWords] = {};
  int words = 1;
  uint64_t validMask[kPatternWords] = {};  // bits beyond the pattern count are cleared
};

const PatternMasks& patternMasks() {
  static const PatternMasks masks = [] {
    PatternMasks m;
    const std::vector<Pattern>& patterns = expandedPatterns();
    const int count = std::min<int>(static_cast<int>(patterns.size()), kPatternWords * 64);
    m.words = std::max(1, (count + 63) / 64);
    for (int p = 0; p < count; ++p) {
      const uint64_t bit = 1ULL << (p % 64);
      m.validMask[p / 64] |= bit;
      for (int i = 0; i < 9; ++i) {
        const char pc = patterns[static_cast<size_t>(p)][static_cast<size_t>(i / 3)][static_cast<size_t>(i % 3)];
        for (int c = 0; c < kCellClasses; ++c) {
          if (matches(pc, representative(static_cast<CellClass>(c)), 'X', 'O')) {
            m.accept[i][c][p / 64] |= bit;
          }
        }
      }
    }
    return m;
  }();
  return masks;
}

}  // namespace

// Reference implementation, kept because the fast path is checked against it.
bool matchesAnyPatternSlow(const SimpleBoard& board, int x, int y, Color player) {
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
      const char pc = pattern[static_cast<size_t>(i / 3)][static_cast<size_t>(i % 3)];
      if (!matches(pc, nb[i], me, opp)) ok = false;
    }
    if (ok) return true;
  }
  return false;
}

bool matchesAnyPattern(const SimpleBoard& board, int x, int y, Color player) {
  const int N = static_cast<int>(board.size());
  const char me = colorChar(player);
  const char opp = colorChar(oppositeColor(player));
  const PatternMasks& masks = patternMasks();

  uint64_t alive[kPatternWords];
  for (int w = 0; w < masks.words; ++w) alive[w] = ~0ULL;

  int k = 0;
  for (int dx = -1; dx <= 1; ++dx) {
    for (int dy = -1; dy <= 1; ++dy) {
      const int c = classOf(cellAt(board, N, x + dx, y + dy), me, opp);
      const uint64_t* acc = masks.accept[k++][c];
      uint64_t any = 0;
      for (int w = 0; w < masks.words; ++w) {
        alive[w] &= acc[w];
        any |= alive[w];
      }
      if (any == 0) return false;
    }
  }
  for (int w = 0; w < masks.words; ++w) {
    if ((alive[w] & masks.validMask[w]) != 0) return true;
  }
  return false;
}

}  // namespace ipvgo::game
