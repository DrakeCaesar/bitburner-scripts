// Chain-free ("fast") versions of the local liberty queries used by the move
// generators, plus the shared optimisation flag storage.
//
// The reference implementations in analysis.cpp build a full ChainSet (a board
// wide flood fill) to answer a question that only involves the chains touching a
// single point. These versions walk just those chains, which is why they are
// several times cheaper.
//
// Results are identical by construction: the walk visits stones in the same
// order as computeChains (same LIFO stack, same N/E/S/W neighbour order) and
// dedupes liberties by first occurrence, so the returned liberty vectors have
// the same contents and the same order as the reference implementation.
#include <algorithm>
#include <cstdint>
#include <utility>
#include <vector>

#include "analysis.hpp"
#include "go_game.hpp"

namespace ipvgo::game {

namespace {

constexpr std::pair<int, int> kNeighbors[4] = {{0, 1}, {1, 0}, {0, -1}, {-1, 0}};

// Per-thread scratch: stamp arrays plus reuse buffers, so repeated calls do not
// allocate or clear anything except on first use / generation wrap.
struct Scratch {
  std::vector<uint32_t> visited;  // stone already reached by the current walk
  std::vector<uint32_t> added;    // point already recorded as a liberty
  std::vector<int> stack;
  std::vector<int> libs;
  uint32_t visitGen = 0;
  uint32_t addGen = 0;

  uint32_t nextVisit() {
    if (++visitGen == 0) {
      std::fill(visited.begin(), visited.end(), 0);
      visitGen = 1;
    }
    return visitGen;
  }
  uint32_t nextAdd() {
    if (++addGen == 0) {
      std::fill(added.begin(), added.end(), 0);
      addGen = 1;
    }
    return addGen;
  }
};

Scratch& scratchFor(int points) {
  static thread_local Scratch scratch;
  if (static_cast<int>(scratch.visited.size()) < points) {
    scratch.visited.assign(static_cast<size_t>(points), 0);
    scratch.added.assign(static_cast<size_t>(points), 0);
    scratch.visitGen = 0;
    scratch.addGen = 0;
  }
  return scratch;
}

// Walks the chain of `stone` containing `start` exactly like computeChains does
// and fills `liberties` with its unique empty neighbours in discovery order.
// `addGen` must be fresh for this chain so liberty dedupe is per chain.
// Returns the chain length in stones.
int walkChain(const SimpleBoard& board, int start, char stone, uint32_t visitGen, uint32_t addGen,
              Scratch& scratch, std::vector<int>& liberties) {
  const int N = static_cast<int>(board.size());
  const NeighborTable nt = neighborTable(N);
  const char* cells = board.flat();
  uint32_t* visited = scratch.visited.data();
  uint32_t* added = scratch.added.data();
  liberties.clear();
  // A chain holds at most every point of the board once.
  int stack[ChainSet::kMaxPoints];
  int top = 0;
  stack[top++] = start;
  visited[start] = visitGen;
  int stones = 0;
  while (top > 0) {
    const int idx = stack[--top];
    ++stones;
    const int nbCount = nt.count[idx];
    const int* nbIdx = nt.idx[idx].data();
    for (int k = 0; k < nbCount; ++k) {
      const int nIdx = nbIdx[k];
      const char c = cells[nIdx];
      if (c == '.') {
        if (added[nIdx] == addGen) continue;
        added[nIdx] = addGen;
        liberties.push_back(nIdx);
      } else if (c == stone && visited[nIdx] != visitGen) {
        visited[nIdx] = visitGen;
        stack[top++] = nIdx;
      }
    }
  }
  return stones;
}

}  // namespace

// Allocation-free twin of findEffectiveLibertiesOfNewMoveFast(...).size().
int effectiveLibertyCountFast(const SimpleBoard& board, int x, int y, Color player) {
  const int N = static_cast<int>(board.size());
  const char me = colorChar(player);
  const int self = x * N + y;
  Scratch& scratch = scratchFor(N * N);
  const uint32_t visitGen = scratch.nextVisit();
  const uint32_t addGen = scratch.nextAdd();

  int count = 0;
  for (const auto& [dx, dy] : kNeighbors) {
    const int nx = x + dx;
    const int ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (board[static_cast<size_t>(nx)][static_cast<size_t>(ny)] != '.') continue;
    const int idx = nx * N + ny;
    if (scratch.added[static_cast<size_t>(idx)] == addGen) continue;
    scratch.added[static_cast<size_t>(idx)] = addGen;
    ++count;
  }
  for (const auto& [dx, dy] : kNeighbors) {
    const int nx = x + dx;
    const int ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (board[static_cast<size_t>(nx)][static_cast<size_t>(ny)] != me) continue;
    const int start = nx * N + ny;
    if (scratch.visited[static_cast<size_t>(start)] == visitGen) continue;
    walkChain(board, start, me, visitGen, addGen, scratch, scratch.libs);
    for (const int liberty : scratch.libs) {
      if (liberty != self) ++count;
    }
  }
  return count;
}

std::vector<int> findEffectiveLibertiesOfNewMoveFast(const SimpleBoard& board, int x, int y, Color player) {
  const int N = static_cast<int>(board.size());
  const char me = colorChar(player);
  const int self = x * N + y;
  Scratch& scratch = scratchFor(N * N);
  const uint32_t visitGen = scratch.nextVisit();
  // One liberty generation for the whole answer, so a point reached from both a
  // direct neighbour and a friendly chain is emitted only once.
  const uint32_t addGen = scratch.nextAdd();

  std::vector<int> out;
  out.reserve(8);
  const auto addLiberty = [&](int idx) {
    if (idx == self) return;
    if (scratch.added[static_cast<size_t>(idx)] == addGen) return;
    scratch.added[static_cast<size_t>(idx)] = addGen;
    out.push_back(idx);
  };

  // Direct empty neighbours first, then the liberties of adjacent friendly
  // chains - the same order the reference implementation produces.
  for (const auto& [dx, dy] : kNeighbors) {
    const int nx = x + dx;
    const int ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (board[static_cast<size_t>(nx)][static_cast<size_t>(ny)] == '.') addLiberty(nx * N + ny);
  }
  for (const auto& [dx, dy] : kNeighbors) {
    const int nx = x + dx;
    const int ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (board[static_cast<size_t>(nx)][static_cast<size_t>(ny)] != me) continue;
    const int start = nx * N + ny;
    if (scratch.visited[static_cast<size_t>(start)] == visitGen) continue;
    walkChain(board, start, me, visitGen, addGen, scratch, scratch.libs);
    for (const int liberty : scratch.libs) {
      // The walk already stamped each liberty with addGen, so push directly.
      if (liberty != self) out.push_back(liberty);
    }
  }
  return out;
}

WeakestChain findWeakestAdjacentChainFast(const SimpleBoard& board, int x, int y, Color chainColor) {
  WeakestChain weakest;
  const int N = static_cast<int>(board.size());
  const char me = colorChar(chainColor);
  Scratch& scratch = scratchFor(N * N);
  const uint32_t visitGen = scratch.nextVisit();

  for (const auto& [dx, dy] : kNeighbors) {
    const int nx = x + dx;
    const int ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (board[static_cast<size_t>(nx)][static_cast<size_t>(ny)] != me) continue;
    const int start = nx * N + ny;
    if (scratch.visited[static_cast<size_t>(start)] == visitGen) continue;

    // Fresh liberty generation per chain: adjacent chains may share liberties.
    const int stones = walkChain(board, start, me, visitGen, scratch.nextAdd(), scratch, scratch.libs);
    // Keep the first chain of the scan order on liberty-count ties, matching
    // findEnemyNeighborChainWithFewestLiberties.
    if (!weakest.found || static_cast<int>(scratch.libs.size()) < static_cast<int>(weakest.liberties.size())) {
      weakest.found = true;
      weakest.length = stones;
      weakest.liberties = scratch.libs;
    }
  }
  return weakest;
}

int findMinLibertyCountOfAdjacentChainsFast(const SimpleBoard& board, int x, int y, Color chainColor) {
  const int N = static_cast<int>(board.size());
  const char me = colorChar(chainColor);
  Scratch& scratch = scratchFor(N * N);
  const uint32_t visitGen = scratch.nextVisit();
  int best = 99;
  for (const auto& [dx, dy] : kNeighbors) {
    const int nx = x + dx;
    const int ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if (board[static_cast<size_t>(nx)][static_cast<size_t>(ny)] != me) continue;
    const int start = nx * N + ny;
    if (scratch.visited[static_cast<size_t>(start)] == visitGen) continue;
    walkChain(board, start, me, visitGen, scratch.nextAdd(), scratch, scratch.libs);
    best = std::min(best, static_cast<int>(scratch.libs.size()));
  }
  return best;
}

}  // namespace ipvgo::game