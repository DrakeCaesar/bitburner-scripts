#include "mcgs.hpp"

#include "analysis.hpp"
#include "features.hpp"
#include "opponents.hpp"
#include "rng.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <future>
#include <limits>
#include <random>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

namespace ipvgo::nn {

using namespace ipvgo::game;

namespace {

constexpr int kWeightCapture = 1000;
constexpr int kWeightDefend = 800;
constexpr int kWeightEye = 600;
constexpr int kWeightAtari = 400;
constexpr int kWeightCulled = -1;

struct McgsMove {
  bool passMove = false;
  int x = -1;
  int y = -1;
};

struct McgsNode;

struct McgsChild {
  McgsMove move;
  int weight = 0;
  int64_t visits = 0;
  McgsNode* node = nullptr;
};

struct McgsNode {
  GameState state;
  double U = 0.0;
  int64_t N = 0;
  double S = 0.0;
  double SS = 0.0;
  int whiteMovesCompleted = 0;
  std::vector<McgsChild> children;
  bool movesBuilt = false;
};

struct SearchContext {
  MathRandom* mathRng = nullptr;
};

// Faction getMove() WHRNG seed; playtime clock is intentionally ignored in search.
constexpr double kFactionAiSeedMs = 0.0;

uint64_t fnv1a64(uint64_t h, uint64_t v) {
  h ^= v;
  h *= 0x100000001b3ULL;
  return h;
}

uint64_t positionKey(const GameState& state) {
  uint64_t h = 0xcbf29ce484222325ULL;
  for (const auto& col : state.board) {
    for (const char c : col) h = fnv1a64(h, static_cast<uint64_t>(c));
  }
  h = fnv1a64(h, static_cast<uint64_t>(state.previousPlayer));
  h = fnv1a64(h, static_cast<uint64_t>(state.passCount));
  h = fnv1a64(h, state.gameOver ? 1ULL : 0ULL);
  h = fnv1a64(h, static_cast<uint64_t>(state.previousBoards.size()));
  for (size_t i = 0; i < state.previousBoards.size() && i < 4; ++i) {
    for (const char c : state.previousBoards[i]) h = fnv1a64(h, static_cast<uint64_t>(c));
  }
  return h;
}

double blackOutcomeValue(const GameState& state) {
  if (!state.gameOver) {
    const Score sc = getScore(state);
    const double margin = sc.blackSum - sc.whiteSum;
    const double scale = std::max(4.0, static_cast<double>(state.size * state.size));
    return std::tanh(margin / scale);
  }
  return blackWins(getScore(state)) ? 1.0 : -1.0;
}

bool opponentPassedLast(const GameState& state, Color player) {
  return state.passCount > 0 && state.previousPlayer == oppositeColor(player);
}

bool hasAdjacentStone(const SimpleBoard& board, int x, int y) {
  const int N = static_cast<int>(board.size());
  constexpr std::pair<int, int> dirs[] = {{0, 1}, {1, 0}, {0, -1}, {-1, 0}};
  for (const auto& [dx, dy] : dirs) {
    const int nx = x + dx;
    const int ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const char c = board[nx][ny];
    if (c == 'X' || c == 'O') return true;
  }
  return false;
}

bool isCaptureMove(const GameState& state, int x, int y, Color player) {
  const WeakestChain wc =
      findEnemyNeighborChainWithFewestLiberties(state.board, x, y, oppositeColor(player));
  return wc.found && wc.liberties.size() == 1;
}

bool isDefendMove(const GameState& state, int x, int y, Color player) {
  const int oldLib = findMinLibertyCountOfAdjacentChains(state.board, x, y, player);
  const int newLib = static_cast<int>(findEffectiveLibertiesOfNewMove(state.board, x, y, player).size());
  return oldLib <= 2 && newLib > oldLib;
}

bool isAtariMove(const GameState& state, int x, int y, Color player) {
  const WeakestChain wc =
      findEnemyNeighborChainWithFewestLiberties(state.board, x, y, oppositeColor(player));
  return wc.found && wc.liberties.size() == 2;
}

bool isEyeMove(const GameState& state, int x, int y, Color player) {
  const int libs = static_cast<int>(findEffectiveLibertiesOfNewMove(state.board, x, y, player).size());
  return libs >= 3;
}

bool inOpponentTerritory(const GameState& state, int x, int y, Color player) {
  const ChainSet cs = computeChains(state.board);
  const int idx = flatIndex(state.size, x, y);
  if (idx < 0 || idx >= cs.N * cs.N || cs.id[idx] < 0) return false;
  const int chain = cs.id[idx];
  if (cs.chainColor[chain] != '.') return false;

  bool hasPlayer = false;
  bool hasOpp = false;
  for (const int nIdx : onBoardNeighbors(state.size, x, y)) {
    const char c = state.board[nIdx / state.size][nIdx % state.size];
    if (c == colorChar(player)) hasPlayer = true;
    if (c == colorChar(oppositeColor(player))) hasOpp = true;
  }
  return hasOpp && !hasPlayer;
}

int whiteMoveWeight(const GameState& state, int x, int y, bool useAiTweaks) {
  if (!useAiTweaks) return 1;
  if (!hasAdjacentStone(state.board, x, y)) return kWeightCulled;
  if (inOpponentTerritory(state, x, y, Color::White)) return kWeightCulled;

  int weight = 1;
  if (isCaptureMove(state, x, y, Color::White)) {
    weight = std::max(weight, kWeightCapture + (inOpponentTerritory(state, x, y, Color::Black) ? 0 : 1));
  }
  if (isDefendMove(state, x, y, Color::White)) weight = std::max(weight, kWeightDefend);
  if (isEyeMove(state, x, y, Color::White)) weight = std::max(weight, kWeightEye);
  if (isAtariMove(state, x, y, Color::White)) weight = std::max(weight, kWeightAtari);
  return weight;
}

int blackPlayoutWeight(const GameState& state, int x, int y) {
  if (isCaptureMove(state, x, y, Color::Black)) return 8;
  if (isDefendMove(state, x, y, Color::Black)) return 4;
  if (isAtariMove(state, x, y, Color::Black)) return 2;
  if (isEyeMove(state, x, y, Color::Black)) return 0;
  return 1;
}

bool blackPlayoutLegal(const GameState& state, int x, int y) {
  if (evaluateIfMoveIsValid(state, x, y, Color::Black) != Validity::Valid) return false;
  if (isEyeMove(state, x, y, Color::Black) && !isCaptureMove(state, x, y, Color::Black)) return false;
  if (!isCaptureMove(state, x, y, Color::Black)) {
    const WeakestChain wc = findEnemyNeighborChainWithFewestLiberties(state.board, x, y, Color::White);
    if (wc.found && wc.liberties.size() > 1) {
      // Avoid capturing healthy groups during rollout.
      const SimpleBoard after = evaluateMoveResult(state.board, x, y, Color::Black);
      const ChainSet afterCs = computeChains(after);
      for (int c = 0; c < afterCs.count; ++c) {
        if (afterCs.chainColor[c] == 'O' && afterCs.liberties[c].empty()) return false;
      }
    }
  }
  return true;
}

GameState applyPass(GameState state, Color player) {
  passTurn(state, player);
  return state;
}

GameState applyPlay(const GameState& state, int x, int y, Color player) {
  GameState next = state;
  if (!makeMove(next, x, y, player)) passTurn(next, player);
  return next;
}

GameState applyMove(const GameState& state, const McgsMove& move, Color player) {
  if (move.passMove) return applyPass(state, player);
  return applyPlay(state, move.x, move.y, player);
}

void buildChildren(McgsNode* node, const McgsConfig& cfg, const SearchContext& ctx) {
  if (node->movesBuilt) return;
  node->movesBuilt = true;
  const Color player = whoseTurn(node->state);
  if (player == Color::Empty) return;

  const bool passOk = !node->state.gameOver && node->state.previousPlayer != player;
  if (passOk) {
    McgsChild passChild;
    passChild.move.passMove = true;
    passChild.weight = 1;
    node->children.push_back(passChild);
  }

  if (player == Color::White && cfg.playOpponent) {
    MathRandom localMr(1ULL);
    MathRandom& mr = ctx.mathRng ? *ctx.mathRng : localMr;
    for (const auto& [x, y] : enumerateFactionMoves(node->state, player, node->state.ai, mr)) {
      McgsChild child;
      child.move.x = x;
      child.move.y = y;
      child.weight = 1;
      node->children.push_back(child);
    }
    return;
  }

  std::vector<std::pair<int, int>> moves;
  if (player == Color::Black && cfg.pruneBlackMoves) {
    moves = blackExploitMoves(node->state, node->state.ai, kFactionAiSeedMs);
  } else {
    moves = getAllValidMoves(node->state, player);
  }

  for (const auto& [x, y] : moves) {
    McgsChild child;
    child.move.x = x;
    child.move.y = y;
    if (player == Color::White) {
      child.weight = whiteMoveWeight(node->state, x, y, cfg.useAiTweaks);
      if (child.weight == kWeightCulled) continue;
    } else {
      child.weight = 1;
    }
    node->children.push_back(child);
  }
}

double nodeStddev(const McgsNode* node) {
  if (!node || node->N <= 0) return 1.0;
  const double mean = node->S / static_cast<double>(node->N);
  double var = node->SS / static_cast<double>(node->N) - mean * mean;
  if (var < 0.0) var = 0.0;
  return std::sqrt(var) + 1e-6;
}

double childMean(const McgsChild& child) {
  if (child.node && child.node->N > 0) return child.node->S / static_cast<double>(child.node->N);
  if (child.node) return child.node->U;
  return 0.0;
}

bool whiteAllowsPass(const std::vector<McgsChild>& children) {
  int maxWeight = 0;
  for (const auto& c : children) {
    if (c.move.passMove) continue;
    maxWeight = std::max(maxWeight, c.weight);
  }
  if (maxWeight >= kWeightCapture) return false;
  return maxWeight % 10 != 1;
}

std::vector<int> selectableChildren(const McgsNode* node, Color player, const McgsConfig& cfg) {
  std::vector<int> idxs;
  int maxWeight = 0;
  for (const auto& c : node->children) {
    if (!c.move.passMove) maxWeight = std::max(maxWeight, c.weight);
  }
  for (size_t i = 0; i < node->children.size(); ++i) {
    const McgsChild& c = node->children[i];
    if (c.move.passMove) {
      if (player == Color::White && cfg.useAiTweaks && !whiteAllowsPass(node->children)) continue;
      idxs.push_back(static_cast<int>(i));
      continue;
    }
    if (player == Color::White && cfg.useAiTweaks && c.weight < maxWeight - 1) continue;
    idxs.push_back(static_cast<int>(i));
  }
  if (idxs.empty()) {
    for (size_t i = 0; i < node->children.size(); ++i) idxs.push_back(static_cast<int>(i));
  }
  return idxs;
}

int64_t parentVisits(const McgsNode* node) {
  int64_t total = 0;
  for (const auto& c : node->children) total += c.visits;
  return std::max<int64_t>(total, 1);
}

int selectChild(McgsNode* node, Color player, const McgsConfig& cfg) {
  const std::vector<int> candidates = selectableChildren(node, player, cfg);
  const double sign = player == Color::Black ? 1.0 : -1.0;
  const double parentN = static_cast<double>(parentVisits(node));

  int bestIdx = candidates[0];
  double bestScore = -std::numeric_limits<double>::infinity();
  for (const int idx : candidates) {
    const McgsChild& child = node->children[static_cast<size_t>(idx)];
    const double q = childMean(child);
    const double sd = child.node ? nodeStddev(child.node) : 1.0;
    const double explore = cfg.exploration * sd * std::sqrt(parentN) / (1.0 + static_cast<double>(child.visits));
    const double score = sign * q + explore;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

McgsNode* getOrCreateNode(GameState state, std::vector<std::unique_ptr<McgsNode>>& storage,
                          std::unordered_map<uint64_t, McgsNode*>& graph, std::mt19937_64& rng,
                          const McgsConfig& cfg) {
  const uint64_t key = positionKey(state);
  if (auto it = graph.find(key); it != graph.end()) return it->second;

  auto node = std::make_unique<McgsNode>();
  node->state = std::move(state);
  McgsNode* raw = node.get();
  storage.push_back(std::move(node));
  graph[key] = raw;
  return raw;
}

double fastPlayout(GameState state, std::mt19937_64& rng, const McgsConfig& cfg, const SearchContext& ctx,
                   int whiteMovesCompleted) {
  const int N = state.size;
  const int maxPlies = N * N * 4 + 10;

  for (int ply = 0; ply < maxPlies; ++ply) {
    if (state.gameOver) break;
    const Color player = whoseTurn(state);
    if (player == Color::Empty) break;

    if (opponentPassedLast(state, player)) {
      state.gameOver = true;
      break;
    }

    if (player == Color::White) {
      MathRandom localMr(ctx.mathRng ? 0 : static_cast<uint64_t>(rng()));
      MathRandom& mr = ctx.mathRng ? *ctx.mathRng : localMr;
      const Play wp = getMove(state, Color::White, state.ai, kFactionAiSeedMs, mr);
      if (wp.type == PlayType::Pass) {
        passTurn(state, player);
      } else {
        state = applyPlay(state, wp.x, wp.y, player);
      }
      ++whiteMovesCompleted;
      if (state.gameOver) break;
      continue;
    }

    // Black rollout: random among legal moves (prefer tactical weights).
    std::vector<std::pair<int, int>> moves;
    std::vector<int> weights;
    for (const auto& [x, y] : getAllValidMoves(state, Color::Black)) {
      moves.emplace_back(x, y);
      weights.push_back(blackPlayoutWeight(state, x, y));
    }
    if (moves.empty()) {
      passTurn(state, player);
      if (state.gameOver) break;
      continue;
    }
    std::discrete_distribution<int> dist(weights.begin(), weights.end());
    const auto [x, y] = moves[dist(rng)];
    state = applyPlay(state, x, y, player);
    if (state.gameOver) break;
  }

  if (!state.gameOver) {
  const Score sc = getScore(state);
  const double margin = sc.blackSum - sc.whiteSum;
  const double scale = std::max(4.0, static_cast<double>(state.size * state.size));
  return std::tanh(margin / scale);
  }
  return blackOutcomeValue(state);
}

void backup(std::vector<std::pair<McgsNode*, size_t>>& path, double value) {
  for (auto it = path.rbegin(); it != path.rend(); ++it) {
    McgsNode* parent = it->first;
    const size_t childIdx = it->second;
    McgsChild& edge = parent->children[childIdx];
    edge.visits++;
    if (edge.node) {
      edge.node->N++;
      edge.node->S += value;
      edge.node->SS += value * value;
    }
  }
}

McgsNode* expandChild(McgsNode* parent, size_t childIdx, std::vector<std::unique_ptr<McgsNode>>& storage,
                      std::unordered_map<uint64_t, McgsNode*>& graph, std::mt19937_64& rng,
                      const McgsConfig& cfg, const SearchContext& ctx) {
  McgsChild& edge = parent->children[childIdx];
  const Color player = whoseTurn(parent->state);
  GameState next = applyMove(parent->state, edge.move, player);
  if (edge.move.passMove && opponentPassedLast(parent->state, player)) {
    next.gameOver = true;
  }

  McgsNode* childNode = getOrCreateNode(std::move(next), storage, graph, rng, cfg);
  edge.node = childNode;
  childNode->whiteMovesCompleted = parent->whiteMovesCompleted + (player == Color::White ? 1 : 0);
  if (childNode->N == 0 && childNode->U == 0.0) {
    childNode->U = fastPlayout(childNode->state, rng, cfg, ctx, childNode->whiteMovesCompleted);
  }
  return childNode;
}

int findChildIndex(const McgsNode* node, const McgsMove& move) {
  for (size_t i = 0; i < node->children.size(); ++i) {
    const McgsChild& c = node->children[i];
    if (c.move.passMove == move.passMove && c.move.x == move.x && c.move.y == move.y) return static_cast<int>(i);
  }
  return -1;
}

McgsMove playToMove(const Play& play) {
  McgsMove move;
  if (play.type == PlayType::Pass) {
    move.passMove = true;
  } else {
    move.x = play.x;
    move.y = play.y;
  }
  return move;
}

int findOrAddChild(McgsNode* node, const McgsMove& move) {
  if (int idx = findChildIndex(node, move); idx >= 0) return idx;
  McgsChild child;
  child.move = move;
  child.weight = 1;
  node->children.push_back(child);
  return static_cast<int>(node->children.size()) - 1;
}

unsigned resolveThreadCount(int requestedThreads, int playouts) {
  unsigned threads = 0;
  if (requestedThreads > 0) {
    threads = static_cast<unsigned>(requestedThreads);
  } else {
    threads = std::thread::hardware_concurrency();
  }
  if (threads == 0) threads = 4;
  threads = std::max(1u, std::min(threads, static_cast<unsigned>(std::max(playouts, 1))));
  return threads;
}

void splitPlayouts(int playouts, unsigned threads, std::vector<int>& perThread) {
  perThread.assign(threads, playouts / static_cast<int>(threads));
  const int remainder = playouts % static_cast<int>(threads);
  for (int i = 0; i < remainder; ++i) {
    perThread[static_cast<size_t>(i)]++;
  }
}

uint64_t makeThreadSeed(uint64_t baseSeed, unsigned threadIndex) {
  return baseSeed ^ (static_cast<uint64_t>(threadIndex) * 0x9E3779B9ULL) ^ 0x85EBCA6BULL;
}

McgsResult mergeMcgsResults(const std::vector<McgsResult>& parts, int N) {
  McgsResult merged;
  merged.visitPolicy.assign(static_cast<size_t>(actionCount(N)), 0.0f);
  double rootValueSum = 0.0;
  int64_t totalVisits = 0;

  for (const McgsResult& part : parts) {
    const float scale = static_cast<float>(part.totalRootVisits);
    for (size_t i = 0; i < merged.visitPolicy.size() && i < part.visitPolicy.size(); ++i) {
      merged.visitPolicy[i] += part.visitPolicy[i] * scale;
    }
    rootValueSum += static_cast<double>(part.rootValue) * static_cast<double>(part.totalRootVisits);
    totalVisits += part.totalRootVisits;
  }

  merged.totalRootVisits = totalVisits;
  if (totalVisits > 0) {
    for (float& v : merged.visitPolicy) v /= static_cast<float>(totalVisits);
    merged.rootValue = static_cast<float>(rootValueSum / static_cast<double>(totalVisits));
  }

  int bestAction = passAction(N);
  float bestVisits = -1.0f;
  for (size_t i = 0; i < merged.visitPolicy.size(); ++i) {
    if (merged.visitPolicy[i] > bestVisits) {
      bestVisits = merged.visitPolicy[i];
      bestAction = static_cast<int>(i);
    }
  }
  merged.bestAction = bestAction;
  return merged;
}

McgsResult runMcgsSingle(const GameState& rootState, const McgsConfig& cfg, int playouts, uint64_t seed,
                         uint64_t mathSeed, int initialWhiteMoves) {
  McgsResult result;
  const int N = rootState.size;
  result.visitPolicy.assign(static_cast<size_t>(actionCount(N)), 0.0f);

  if (rootState.gameOver || whoseTurn(rootState) != Color::Black) {
    result.rootValue = static_cast<float>(blackOutcomeValue(rootState));
    result.bestAction = passAction(N);
    return result;
  }

  SearchContext ctx;
  MathRandom mathRng(mathSeed ? mathSeed : 1ULL);
  ctx.mathRng = mathSeed ? &mathRng : nullptr;

  std::mt19937_64 rng(seed ? seed : 1);
  std::vector<std::unique_ptr<McgsNode>> storage;
  std::unordered_map<uint64_t, McgsNode*> graph;

  GameState rootCopy = rootState;
  McgsNode* root = getOrCreateNode(std::move(rootCopy), storage, graph, rng, cfg);
  root->whiteMovesCompleted = initialWhiteMoves;
  root->U = fastPlayout(root->state, rng, cfg, ctx, initialWhiteMoves);
  buildChildren(root, cfg, ctx);

  for (int i = 0; i < playouts; ++i) {
    std::vector<std::pair<McgsNode*, size_t>> path;
    McgsNode* node = root;
    double value = 0.0;

    while (true) {
      if (node->state.gameOver) {
        value = blackOutcomeValue(node->state);
        break;
      }

      const Color player = whoseTurn(node->state);
      if (player == Color::Empty) {
        value = blackOutcomeValue(node->state);
        break;
      }

      buildChildren(node, cfg, ctx);

      if (node->children.empty()) {
        value = fastPlayout(node->state, rng, cfg, ctx, node->whiteMovesCompleted);
        break;
      }

      const int childIdx = selectChild(node, player, cfg);
      McgsChild& edge = node->children[static_cast<size_t>(childIdx)];

      if (!edge.node) {
        expandChild(node, static_cast<size_t>(childIdx), storage, graph, rng, cfg, ctx);
        value = edge.node ? edge.node->U : 0.0;
        path.emplace_back(node, static_cast<size_t>(childIdx));
        break;
      }

      if (cfg.suppressTransposition && edge.visits > 0 && edge.visits <= edge.node->N) {
        value = edge.node->U;
        path.emplace_back(node, static_cast<size_t>(childIdx));
        break;
      }

      path.emplace_back(node, static_cast<size_t>(childIdx));
      node = edge.node;
    }

    backup(path, value);
  }

  int64_t totalVisits = 0;
  int bestIdx = -1;
  int64_t bestVisits = -1;
  for (size_t i = 0; i < root->children.size(); ++i) {
    const McgsChild& c = root->children[i];
    if (c.move.passMove) {
      const int passIdx = passAction(N);
      result.visitPolicy[static_cast<size_t>(passIdx)] = static_cast<float>(c.visits);
    } else {
      const int action = c.move.x * N + c.move.y;
      if (action >= 0 && action < N * N) result.visitPolicy[static_cast<size_t>(action)] = static_cast<float>(c.visits);
    }
    totalVisits += c.visits;
    if (c.visits > bestVisits) {
      bestVisits = c.visits;
      bestIdx = static_cast<int>(i);
    }
  }

  if (bestIdx >= 0) {
    const McgsChild& best = root->children[static_cast<size_t>(bestIdx)];
    result.bestAction = best.move.passMove ? passAction(N) : best.move.x * N + best.move.y;
  } else {
    result.bestAction = passAction(N);
  }

  if (totalVisits > 0) {
    for (float& v : result.visitPolicy) v = v / static_cast<float>(totalVisits);
  }
  result.totalRootVisits = totalVisits;

  result.rootValue =
      root->N > 0 ? static_cast<float>(root->S / static_cast<double>(root->N)) : static_cast<float>(root->U);
  const int64_t rootEdgeVisits = parentVisits(root);
  if (rootEdgeVisits > 0) {
    double rootSum = 0.0;
    for (const auto& c : root->children) rootSum += static_cast<double>(c.visits) * childMean(c);
    result.rootValue = static_cast<float>(rootSum / static_cast<double>(rootEdgeVisits));
  }
  return result;
}

}  // namespace

McgsResult runMcgs(const GameState& rootState, const McgsConfig& cfg, uint64_t seed, uint64_t mathSeed,
                   int initialWhiteMoves) {
  const unsigned threadCount = resolveThreadCount(cfg.threads, cfg.playouts);
  if (threadCount <= 1) {
    return runMcgsSingle(rootState, cfg, cfg.playouts, seed, mathSeed, initialWhiteMoves);
  }

  std::vector<int> perThread;
  splitPlayouts(cfg.playouts, threadCount, perThread);

  std::vector<std::future<McgsResult>> futures;
  futures.reserve(threadCount);
  for (unsigned t = 0; t < threadCount; ++t) {
    const int threadPlayouts = perThread[t];
    const uint64_t threadSeed = makeThreadSeed(seed, t);
    const uint64_t threadMathSeed = mathSeed ? makeThreadSeed(mathSeed, t) : 0ULL;
    futures.push_back(std::async(std::launch::async, [=, &rootState]() {
      return runMcgsSingle(rootState, cfg, threadPlayouts, threadSeed, threadMathSeed, initialWhiteMoves);
    }));
  }

  std::vector<McgsResult> parts;
  parts.reserve(threadCount);
  for (auto& fut : futures) parts.push_back(fut.get());
  return mergeMcgsResults(parts, rootState.size);
}

}  // namespace ipvgo::nn
