#include "obstacles.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <utility>

#include "rng.hpp"

namespace ipvgo::game {

namespace {

// A cell that carries its own logical coordinates. Rotations move cells around
// but do NOT rewrite these coordinates (only resetCoordinates does) -- this
// reproduces the game's use of stale point.x/point.y after rotation.
struct GCell {
  bool offline = false;
  int cx = 0;
  int cy = 0;
};

using Grid = std::vector<std::vector<GCell>>;

int getScale(int size) {
  switch (size) {
    case 5: return 0;
    case 7: return 1;
    case 9: return 2;
    case 13: return 3;
    case 19: return 4;
  }
  return 0;
}

Grid gridFromBoard(const SimpleBoard& board) {
  const int N = static_cast<int>(board.size());
  Grid g(N, std::vector<GCell>(N));
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      g[x][y].offline = board[x][y] == '#';
      g[x][y].cx = x;
      g[x][y].cy = y;
    }
  }
  return g;
}

SimpleBoard boardFromGrid(const Grid& g) {
  const int N = static_cast<int>(g.size());
  SimpleBoard board(N, std::string(N, '.'));
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      board[x][y] = g[x][y].offline ? '#' : '.';
    }
  }
  return board;
}

// newBoard[i][j] = old[N-1-j][i]
Grid rotate90(const Grid& g) {
  const int N = static_cast<int>(g.size());
  Grid r(N, std::vector<GCell>(N));
  for (int i = 0; i < N; ++i) {
    for (int j = 0; j < N; ++j) {
      r[i][j] = g[N - 1 - j][i];
    }
  }
  return r;
}

Grid rotateNTimes(Grid g, int n) {
  for (int i = 0; i < n; ++i) g = rotate90(g);
  return g;
}

using Rand = std::function<int(double, double)>;

Grid randomizeRotation(Grid g, const Rand& random) { return rotateNTimes(std::move(g), random(0, 3)); }

void addDeadCorner(Grid& g, const Rand& random, int size) {
  const int N = static_cast<int>(g.size());
  int currentSize = size;
  for (int i = 0; i < size && i < currentSize; ++i) {
    if (random(0, 1)) currentSize--;
    for (int index = 0; index < N; ++index) {
      const GCell& pt = g[i][index];
      if (index < currentSize && !pt.offline) {
        g[pt.cx][pt.cy].offline = true;  // stale coordinates, as in the game
      }
    }
  }
}

Grid addDeadCorners(Grid g, const Rand& random, int size) {
  const int scale = size + 1;
  addDeadCorner(g, random, scale);
  if (!random(0, 3)) {
    g = rotate90(g);
    g = rotate90(g);
    addDeadCorner(g, random, scale - 2);
  }
  return randomizeRotation(std::move(g), random);
}

Grid addCenterBreak(Grid g, const Rand& random, int scale) {
  const int N = static_cast<int>(g.size());
  const int maxOffset = scale;
  const int xIndex = random(0, maxOffset * 2) - maxOffset + N / 2;
  const int length = random(1, std::floor(N / 2.0 - 1));
  for (int index = 0; index < N && index < length; ++index) {
    g[xIndex][index].offline = true;
  }
  return randomizeRotation(std::move(g), random);
}

Grid removeRows(Grid g, const Rand& random, int scale) {
  const int N = static_cast<int>(g.size());
  const int rowsToRemove = std::max(random(-2, scale), 1);
  for (int i = 0; i < rowsToRemove && i < N; ++i) {
    for (int y = 0; y < N; ++y) g[i][y].offline = true;
  }
  return rotateNTimes(std::move(g), 3);
}

Grid addDeadNodesToEdge(Grid g, const Rand& random, int maxPerEdge) {
  const int N = static_cast<int>(g.size());
  for (int i = 0; i < 4; ++i) {
    const int count = random(0, maxPerEdge);
    for (int j = 0; j < count; ++j) {
      const int yIndex = std::max(random(-2, N - 1), 0);
      g[0][yIndex].offline = true;
    }
    g = rotate90(g);
  }
  return g;
}

void ensureOfflineNodes(Grid& g) {
  for (const auto& col : g) {
    for (const auto& cell : col) {
      if (cell.offline) return;
    }
  }
  g[0][0].offline = true;
}

void resetCoordinates(Grid& g) {
  const int N = static_cast<int>(g.size());
  for (int x = 0; x < N; ++x) {
    for (int y = 0; y < N; ++y) {
      if (!g[x][y].offline) {
        g[x][y].cx = x;
        g[x][y].cy = y;
      }
    }
  }
}

void removeIslands(SimpleBoard& board) {
  const ChainSet cs = computeChains(board);
  const int N = cs.N;
  for (int c = 0; c < cs.count; ++c) {
    if (cs.chainColor[c] == '.' && static_cast<int>(cs.members[c].size()) <= 2) {
      for (const int idx : cs.members[c]) board[idx / N][idx % N] = '#';
    }
  }
}

}  // namespace

SimpleBoard bitverseBoard() {
  static const std::array<const char*, 19> shape = {
      "########...########", "######.#...#.######", "###.#..#...#..#.###", ".#..#..#...#..#..#.",
      ".#.....#...#.....#.", "...................", "...................", "...................",
      "...................", ".....##.....##.....", "....###.....###....", "....##.......##....",
      "....#.........#....", ".........#.........", "#........#........#", "##.......#.......##",
      "##.......#.......##", "###.............###", "####...........####"};
  SimpleBoard raw(19);
  for (int i = 0; i < 19; ++i) raw[i] = shape[i];

  // The game does resetCoordinates(rotate90Degrees(board)); the rotation is a
  // pure position remap here: rotated[i][j] = raw[N-1-j][i].
  SimpleBoard rotated(19, std::string(19, '.'));
  for (int i = 0; i < 19; ++i) {
    for (int j = 0; j < 19; ++j) {
      rotated[i][j] = raw[18 - j][i];
    }
  }
  return rotated;
}

void addObstacles(GameState& state, double seedMs) {
  const int N = state.size;
  const int scale = getScale(N);
  WHRNG rng(seedMs);
  const Rand random = [&rng](double n1, double n2) -> int {
    return static_cast<int>(n1 + std::floor((n2 - n1 + 1.0) * rng.random()));
  };

  Grid g = gridFromBoard(state.board);

  const bool shouldRemoveCorner = random(0, 4) == 0;
  bool shouldRemoveRows = false;
  if (!shouldRemoveCorner) shouldRemoveRows = random(0, 4) == 0;
  int centerBreakRaw = -1;  // -1 stands for JS `false`
  if (!shouldRemoveCorner && !shouldRemoveRows) centerBreakRaw = random(0, 3);
  const bool shouldAddCenterBreak = centerBreakRaw > 0;

  const int obstacleTypeCount =
      (shouldRemoveCorner ? 1 : 0) + (shouldRemoveRows ? 1 : 0) + (centerBreakRaw > 0 ? centerBreakRaw : 0);

  const int edgeDeadCount = random(1, (scale + 2 - obstacleTypeCount) * 1.5);

  if (shouldRemoveCorner) g = addDeadCorners(std::move(g), random, scale);
  if (shouldAddCenterBreak) g = addCenterBreak(std::move(g), random, scale);
  g = randomizeRotation(std::move(g), random);
  if (shouldRemoveRows) g = removeRows(std::move(g), random, scale);
  g = addDeadNodesToEdge(std::move(g), random, edgeDeadCount);
  ensureOfflineNodes(g);
  resetCoordinates(g);

  SimpleBoard board = boardFromGrid(g);
  removeIslands(board);
  state.board = board;
}

}  // namespace ipvgo::game
