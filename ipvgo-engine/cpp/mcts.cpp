#include "mcts.hpp"

#include "board.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <memory>
#include <vector>

namespace ipvgo {

namespace {

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

Move simulationPolicy(const Board& board, const std::vector<Move>& moves, Color color) {
  std::vector<Move> captures;
  std::vector<Move> defends;
  std::vector<Move> nonPass;
  for (const auto& m : moves) {
    if (m.type != MoveType::Play) continue;
    nonPass.push_back(m);
    if (wouldCapture(board, m.x, m.y, color)) captures.push_back(m);
    if (ownChainInAtari(board, m.x, m.y, color)) defends.push_back(m);
  }

  if (!captures.empty() && (static_cast<double>(rand()) / RAND_MAX) < 0.92) {
    return captures[rand() % captures.size()];
  }
  if (!defends.empty() && (static_cast<double>(rand()) / RAND_MAX) < 0.8) {
    return defends[rand() % defends.size()];
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
  double roll = (static_cast<double>(rand()) / RAND_MAX) * total;
  for (size_t i = 0; i < topN; i++) {
    roll -= weighted[i].weight;
    if (roll <= 0) return weighted[i].move;
  }
  return weighted[topN - 1].move;
}

double simulate(MctsNode& node, Color rootColor) {
  Board board = node.board;
  std::vector<Board> history = node.history;
  Color player = node.player;
  int passes = node.passes;
  const int size = boardSize(board);
  const int maxPlies = size * size * 2;

  for (int ply = 0; ply < maxPlies; ply++) {
    if (passes >= 2) break;
    auto moves = getLegalMoves(board, history, player);
    Move move = simulationPolicy(board, moves, player);
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

} // namespace

MoveResult findBestMoveMcts(
    const Board& board,
    const std::vector<Board>& history,
    double komi,
    Color playAs,
    int iterations,
    const ValidMask* validMask) {
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
  const auto started = std::chrono::steady_clock::now();

  for (int i = 0; i < iterations; i++) {
    MctsNode* node = root;
    while (node->untried.empty() && !node->children.empty()) {
      node = selectChild(*node, exploration, playAs);
    }
    if (!node->untried.empty()) {
      node = expand(*node);
    }
    const double result = simulate(*node, playAs);
    backpropagate(node, result);
  }

  MoveResult out;
  out.iterations = iterations;
  out.elapsedMs =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();

  if (root->children.empty()) {
    auto fallback = getLegalMoves(board, history, playAs, validMask);
    for (const auto& m : fallback) {
      if (m.type == MoveType::Play) {
        out.move = m;
        return out;
      }
    }
    out.move = {MoveType::Pass, -1, -1};
    return out;
  }

  MctsNode* bestChild = root->children[0].get();
  double bestRate = -1;
  for (const auto& childPtr : root->children) {
    if (childPtr->visits < 3) continue;
    const double rate = childPtr->wins / childPtr->visits;
    if (rate > bestRate || (rate == bestRate && childPtr->visits > bestChild->visits)) {
      bestRate = rate;
      bestChild = childPtr.get();
    }
  }
  if (bestRate < 0) {
    for (const auto& childPtr : root->children) {
      if (childPtr->visits > bestChild->visits) bestChild = childPtr.get();
    }
  }

  out.move = bestChild->move;
  return out;
}

} // namespace ipvgo
