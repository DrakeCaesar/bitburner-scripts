#include "influence.hpp"

#include <algorithm>
#include <cstdlib>

namespace ipvgo::game {
namespace {

// Seed value of a stone. Large enough that a stone dominates its own point and
// the next one out, small enough that five iterations do not overflow anything.
constexpr int kStoneValue = 10;

template <typename F>
inline void eachNeighbor(int n, int p, F&& fn) {
  const int x = p / n;
  const int y = p % n;
  if (x > 0) fn(p - n);
  if (x + 1 < n) fn(p + n);
  if (y > 0) fn(p - 1);
  if (y + 1 < n) fn(p + 1);
}

}  // namespace

Influence computeInfluence(const SimpleBoard& board, int iterations) {
  const int n = board.size();
  Influence inf;
  inf.size = n;
  inf.value.assign(static_cast<size_t>(n * n), 0);

  for (int x = 0; x < n; ++x) {
    for (int y = 0; y < n; ++y) {
      const char c = board[x][y];
      const int p = flatIndex(n, x, y);
      if (c == 'X') inf.value[static_cast<size_t>(p)] = kStoneValue;
      else if (c == 'O') inf.value[static_cast<size_t>(p)] = -kStoneValue;
    }
  }

  std::vector<int> next = inf.value;
  for (int it = 0; it < iterations; ++it) {
    next = inf.value;
    for (int x = 0; x < n; ++x) {
      for (int y = 0; y < n; ++y) {
        const int p = flatIndex(n, x, y);
        if (board[x][y] != '.') continue;
        int blackNeighbours = 0;
        int whiteNeighbours = 0;
        eachNeighbor(n, p, [&](int q) {
          const int v = inf.value[static_cast<size_t>(q)];
          if (v > 0) ++blackNeighbours;
          else if (v < 0) ++whiteNeighbours;
        });
        // Only grow where the point is not contested, and only in one direction:
        // this is what keeps a boundary between the two colours instead of letting
        // the fields cancel into mush. The count is of neighbouring influence, not
        // neighbouring stones, so the field keeps spreading outwards each pass.
        const int current = inf.value[static_cast<size_t>(p)];
        if (blackNeighbours > 0 && whiteNeighbours == 0 && current >= 0) {
          next[static_cast<size_t>(p)] = current + blackNeighbours;
        } else if (whiteNeighbours > 0 && blackNeighbours == 0 && current <= 0) {
          next[static_cast<size_t>(p)] = current - whiteNeighbours;
        }
      }
    }
    inf.value.swap(next);
  }

  for (const int v : inf.value) {
    if (v > 0) inf.black += v;
    else inf.white += -v;
  }
  return inf;
}

}  // namespace ipvgo::game
