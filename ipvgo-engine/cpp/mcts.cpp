#include "mcts.hpp"

#include "board.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <memory>
#include <random>
#include <unordered_map>
#include <vector>

#if !defined(__EMSCRIPTEN__)
#include <future>
#include <thread>
#endif

namespace ipvgo {

namespace {

struct Rng {
  std::mt19937 gen;
  explicit Rng(uint32_t seed) : gen(seed) {}
  int nextInt(int maxExclusive) {
    if (maxExclusive <= 1) return 0;
    return static_cast<int>(gen() % static_cast<uint32_t>(maxExclusive));
  }
  double nextDouble() {
    return std::uniform_real_distribution<double>(0.0, 1.0)(gen);
  }
};

struct MctsNode {
  Move move{MoveType::Pass, -1, -1};
  Color player = Color::Black;
  Board board;
  std::vector<Board> history;
  double komi = 5.5;
  int passes = 0;
  MctsNode* parent = nullptr;
  std::vector<std::unique_ptr<MctsNode>> children;
  std::vector<Move> untried;
  int visits = 0;
  double wins = 0;
};

struct RootChildStats {
  Move move;
  int visits = 0;
  double wins = 0;
};

std::string moveKey(const Move& move) {
  if (move.type == MoveType::Pass) return "pass";
  return std::to_string(move.x) + "," + std::to_string(move.y);
}

MctsNode* createNode(
    const Move& move,
    Color player,
    const Board& board,
    const std::vector<Board>& history,
    double komi,
    int passes,
    MctsNode& parent) {
  auto node = std::make_unique<MctsNode>();
  node->move = move;
  node->player = player;
  node->board = board;
  node->history = history;
  node->komi = komi;
  node->passes = passes;
  node->parent = &parent;
  node->untried = getLegalMoves(board, history, player, nullptr, true);
  std::sort(node->untried.begin(), node->untried.end(), [&](const Move& a, const Move& b) {
    return moveHeuristic(board, a, player) > moveHeuristic(board, b, player);
  });
  MctsNode* raw = node.get();
  parent.children.push_back(std::move(node));
  return raw;
}

double uctValue(const MctsNode& node, const MctsNode& child, double exploration, const Board& board, Color rootColor) {
  if (child.visits == 0) return 1e18;
  const double exploitation = child.wins / child.visits;
  const double explore = exploration * std::sqrt(std::log(static_cast<double>(node.visits)) / child.visits);
  double prior = 0;
  if (child.move.type == MoveType::Play) {
    prior = static_cast<double>(moveHeuristic(board, child.move, rootColor)) / 500.0;
  }
  return exploitation + explore + prior * 0.05;
}

MctsNode* selectChild(MctsNode& node, double exploration, Color rootColor) {
  MctsNode* best = node.children[0].get();
  double bestValue = -1e18;
  for (const auto& childPtr : node.children) {
    const double value = uctValue(node, *childPtr, exploration, node.board, rootColor);
    if (value > bestValue) {
      bestValue = value;
      best = childPtr.get();
    }
  }
  return best;
}

MctsNode* expand(MctsNode& node) {
  if (node.untried.empty()) return &node;
  Move move = node.untried.back();
  node.untried.pop_back();
  TurnResult result;
  if (!applyTurn(node.board, node.history, move, node.player, result)) {
    return expand(node);
  }
  return createNode(move, result.next, result.board, result.history, node.komi, node.passes + result.passes, node);
}

Move simulationPolicy(const Board& board, const std::vector<Move>& moves, Color color, Rng& rng) {
  std::vector<Move> captures;
  std::vector<Move> defends;
  std::vector<Move> nonPass;
  for (const auto& m : moves) {
    if (m.type != MoveType::Play) continue;
    nonPass.push_back(m);
    if (wouldCapture(board, m.x, m.y, color)) captures.push_back(m);
    if (ownChainInAtari(board, m.x, m.y, color)) defends.push_back(m);
  }

  if (!captures.empty() && rng.nextDouble() < 0.92) {
    return captures[rng.nextInt(static_cast<int>(captures.size()))];
  }
  if (!defends.empty() && rng.nextDouble() < 0.8) {
    return defends[rng.nextInt(static_cast<int>(defends.size()))];
  }
  if (nonPass.empty()) return {MoveType::Pass, -1, -1};

  struct Weighted {
    Move move;
    int weight;
  };
  std::vector<Weighted> weighted;
  for (const auto& m : nonPass) {
    weighted.push_back({m, std::max(1, moveHeuristic(board, m, color))});
  }
  std::sort(weighted.begin(), weighted.end(), [](const Weighted& a, const Weighted& b) { return a.weight > b.weight; });
  const size_t topN = std::min<size_t>(8, weighted.size());
  int total = 0;
  for (size_t i = 0; i < topN; i++) total += weighted[i].weight;
  double roll = rng.nextDouble() * total;
  for (size_t i = 0; i < topN; i++) {
    roll -= weighted[i].weight;
    if (roll <= 0) return weighted[i].move;
  }
  return weighted[topN - 1].move;
}

double simulate(MctsNode& node, Color rootColor, Rng& rng) {
  Board board = node.board;
  std::vector<Board> history = node.history;
  Color player = node.player;
  int passes = node.passes;
  const int size = boardSize(board);
  const int maxPlies = size * size * 2;

  for (int ply = 0; ply < maxPlies; ply++) {
    if (passes >= 2) break;
    auto moves = getLegalMoves(board, history, player);
    Move move = simulationPolicy(board, moves, player, rng);
    TurnResult result;
    if (!applyTurn(board, history, move, player, result)) continue;
    board = std::move(result.board);
    history = std::move(result.history);
    player = result.next;
    if (result.passes > 0) passes += result.passes;
    else passes = 0;
  }

  const Score s = scoreBoard(board, node.komi);
  if (s.black == s.white) return 0.5;
  const bool blackWins = s.black > s.white;
  return blackWins == (rootColor == Color::Black) ? 1.0 : 0.0;
}

void backpropagate(MctsNode* node, double result) {
  while (node) {
    node->visits++;
    node->wins += result;
    node = node->parent;
  }
}

std::vector<RootChildStats> collectRootChildStats(const MctsNode& root) {
  std::vector<RootChildStats> stats;
  for (const auto& childPtr : root.children) {
    stats.push_back({childPtr->move, childPtr->visits, childPtr->wins});
  }
  return stats;
}

std::vector<RootChildStats> runSingleTreeMcts(
    const Board& board,
    const std::vector<Board>& history,
    double komi,
    Color playAs,
    int iterations,
    const ValidMask* validMask,
    uint32_t rngSeed) {
  Rng rng(rngSeed);

  auto rootOwner = std::make_unique<MctsNode>();
  MctsNode* root = rootOwner.get();
  root->player = playAs;
  root->board = board;
  root->history = history;
  root->komi = komi;
  root->untried = getLegalMoves(board, history, playAs, validMask, false);
  std::sort(root->untried.begin(), root->untried.end(), [&](const Move& a, const Move& b) {
    return moveHeuristic(board, a, playAs) > moveHeuristic(board, b, playAs);
  });

  const double exploration = 1.41;

  for (int i = 0; i < iterations; i++) {
    MctsNode* node = root;
    while (node->untried.empty() && !node->children.empty()) {
      node = selectChild(*node, exploration, playAs);
    }
    if (!node->untried.empty()) {
      node = expand(*node);
    }
    const double result = simulate(*node, playAs, rng);
    backpropagate(node, result);
  }

  return collectRootChildStats(*root);
}

void mergeRootStats(std::unordered_map<std::string, RootChildStats>& merged, const std::vector<RootChildStats>& batch) {
  for (const auto& stat : batch) {
    const std::string key = moveKey(stat.move);
    auto& entry = merged[key];
    if (entry.visits == 0) entry.move = stat.move;
    entry.visits += stat.visits;
    entry.wins += stat.wins;
  }
}

Move pickBestMoveFromStats(
    const std::unordered_map<std::string, RootChildStats>& merged,
    const Board& board,
    const std::vector<Board>& history,
    Color playAs,
    const ValidMask* validMask) {
  if (merged.empty()) {
    auto fallback = getLegalMoves(board, history, playAs, validMask);
    for (const auto& m : fallback) {
      if (m.type == MoveType::Play) return m;
    }
    return {MoveType::Pass, -1, -1};
  }

  const RootChildStats* best = nullptr;
  double bestRate = -1;
  for (const auto& [_, stat] : merged) {
    if (stat.visits < 3) continue;
    const double rate = stat.wins / stat.visits;
    if (!best || rate > bestRate || (rate == bestRate && stat.visits > best->visits)) {
      bestRate = rate;
      best = &stat;
    }
  }

  if (!best) {
    for (const auto& [_, stat] : merged) {
      if (!best || stat.visits > best->visits) best = &stat;
    }
  }

  return best->move;
}

unsigned resolveThreadCount(int requestedThreads, int iterations) {
  unsigned threads = 0;
  if (requestedThreads > 0) {
    threads = static_cast<unsigned>(requestedThreads);
  }
#if defined(__EMSCRIPTEN__)
  else {
    threads = 1;
  }
#else
  else {
    threads = std::thread::hardware_concurrency();
  }
#endif
  if (threads == 0) threads = 4;
  threads = std::max(1u, std::min(threads, static_cast<unsigned>(iterations)));
  return threads;
}

void splitIterations(int iterations, unsigned threads, std::vector<int>& perThread) {
  perThread.assign(threads, iterations / static_cast<int>(threads));
  const int remainder = iterations % static_cast<int>(threads);
  for (int i = 0; i < remainder; i++) {
    perThread[static_cast<size_t>(i)]++;
  }
}

uint32_t makeThreadSeed(uint32_t baseSeed, unsigned threadIndex) {
  return baseSeed ^ (threadIndex * 0x9E3779B9u) ^ 0x85EBCA6Bu;
}

} // namespace

MoveResult findBestMoveMcts(
    const Board& board,
    const std::vector<Board>& history,
    double komi,
    Color playAs,
    int iterations,
    const ValidMask* validMask,
    int threads) {
  const auto started = std::chrono::steady_clock::now();

  const uint32_t baseSeed = static_cast<uint32_t>(
      std::chrono::steady_clock::now().time_since_epoch().count());

  std::unordered_map<std::string, RootChildStats> merged;

#if defined(__EMSCRIPTEN__)
  const unsigned threadCount = 1;
  (void)threads;
  mergeRootStats(merged, runSingleTreeMcts(board, history, komi, playAs, iterations, validMask, baseSeed));
#else
  const unsigned threadCount = resolveThreadCount(threads, iterations);
  std::vector<int> perThread;
  splitIterations(iterations, threadCount, perThread);

  if (threadCount == 1) {
    mergeRootStats(merged, runSingleTreeMcts(board, history, komi, playAs, iterations, validMask, baseSeed));
  } else {
    std::vector<std::future<std::vector<RootChildStats>>> futures;
    futures.reserve(threadCount);

    for (unsigned t = 0; t < threadCount; t++) {
      const int threadIters = perThread[t];
      const uint32_t seed = makeThreadSeed(baseSeed, t);
      futures.push_back(std::async(
          std::launch::async,
          [=]() { return runSingleTreeMcts(board, history, komi, playAs, threadIters, validMask, seed); }));
    }

    for (auto& future : futures) {
      mergeRootStats(merged, future.get());
    }
  }
#endif

  MoveResult out;
  out.move = pickBestMoveFromStats(merged, board, history, playAs, validMask);
  out.iterations = iterations;
  out.elapsedMs =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
  return out;
}

} // namespace ipvgo
