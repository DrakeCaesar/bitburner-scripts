#include "puct_mcts.hpp"

#include <algorithm>
#include <numeric>
#include <cmath>
#include <memory>
#include <random>
#include <unordered_map>
#include <utility>
#include <vector>

namespace ipvgo::nn {

namespace {

struct MctsNode {
  EnvState state;
  bool terminal = false;
  float terminalValue = 0.0f;
  bool expanded = false;
  std::vector<int> actions;
  std::vector<float> prior;
  std::vector<int64_t> visits;
  std::vector<double> totalValue;
  std::vector<std::unique_ptr<MctsNode>> children;
};

using Path = std::vector<std::pair<MctsNode*, int>>;

void softmaxOverLegal(const std::vector<float>& logits, const std::vector<int>& actions, std::vector<float>& out) {
  out.resize(actions.size());
  if (actions.empty()) return;
  float maxLogit = logits[actions[0]];
  for (int a : actions) maxLogit = std::max(maxLogit, logits[static_cast<size_t>(a)]);
  double sum = 0.0;
  for (size_t i = 0; i < actions.size(); ++i) {
    const double e = std::exp(static_cast<double>(logits[static_cast<size_t>(actions[i])]) - maxLogit);
    out[i] = static_cast<float>(e);
    sum += e;
  }
  if (sum > 0) {
    for (float& v : out) v = static_cast<float>(v / sum);
  }
}

void setExpanded(MctsNode& node, const std::vector<float>& logits, float value) {
  node.prior.resize(node.actions.size());
  softmaxOverLegal(logits, node.actions, node.prior);
  node.visits.assign(node.actions.size(), 0);
  node.totalValue.assign(node.actions.size(), 0.0);
  node.children.clear();
  node.children.resize(node.actions.size());
  node.expanded = true;
  (void)value;
}

void addDirichletNoise(MctsNode& node, float alpha, float epsilon, std::mt19937_64& rng) {
  if (node.prior.empty()) return;
  std::gamma_distribution<float> gamma(alpha, 1.0f);
  std::vector<float> noise(node.prior.size());
  float sum = 0.0f;
  for (size_t i = 0; i < noise.size(); ++i) {
    noise[i] = std::max(gamma(rng), 1e-8f);
    sum += noise[i];
  }
  if (sum > 0) {
    for (float& v : noise) v /= sum;
  }
  for (size_t i = 0; i < node.prior.size(); ++i) {
    node.prior[i] = (1.0f - epsilon) * node.prior[i] + epsilon * noise[i];
  }
}

int selectAction(const MctsNode& node, float cPuct) {
  const int64_t total = std::accumulate(node.visits.begin(), node.visits.end(), int64_t{0});
  const double sqrtTotal = std::sqrt(static_cast<double>(std::max<int64_t>(1, total)));
  int best = 0;
  double bestScore = -1e30;
  for (size_t i = 0; i < node.actions.size(); ++i) {
    const double q = node.visits[i] > 0 ? node.totalValue[i] / node.visits[i] : 0.0;
    const double u = cPuct * node.prior[i] * sqrtTotal / (1.0 + node.visits[i]);
    const double score = q + u;
    if (score > bestScore) {
      bestScore = score;
      best = static_cast<int>(i);
    }
  }
  return best;
}

void backpropagate(const Path& path, float value) {
  for (const auto& [parent, idx] : path) {
    parent->visits[static_cast<size_t>(idx)] += 1;
    parent->totalValue[static_cast<size_t>(idx)] += value;
  }
}

void expandNode(MctsNode& node, const CheatSettings& settings, const std::vector<float>& logits, float value) {
  const std::vector<char> mask = extendedLegalMask(node.state, settings);
  node.actions.clear();
  for (int a = 0; a < static_cast<int>(mask.size()); ++a) {
    if (mask[static_cast<size_t>(a)]) node.actions.push_back(a);
  }
  setExpanded(node, logits, value);
}

}  // namespace

PuctMctsResult runPuctMcts(const EnvState& rootState, const CheatSettings& settings, const PuctMctsConfig& cfg,
                           uint64_t seed, NnBatchCallback callback) {
  const int n = rootState.gs.size;
  const int actionCount = extendedActionCount(n);
  const size_t samplePlaneSize = static_cast<size_t>(kInputPlanes) * n * n;

  std::mt19937_64 rng(seed);

  auto root = std::make_unique<MctsNode>();
  root->state = rootState;

  // Root expansion (single).
  float rootValue = 0.0f;
  {
    std::vector<float> planes = extendedEncode(root->state, settings);
    std::vector<float> logits(static_cast<size_t>(actionCount), 0.0f);
    std::vector<float> value(1, 0.0f);
    callback(planes.data(), 1, n, actionCount, logits.data(), value.data());
    rootValue = value[0];
    expandNode(*root, settings, logits, rootValue);
    if (cfg.addRootNoise) addDirichletNoise(*root, cfg.dirichletAlpha, cfg.dirichletEpsilon, rng);
  }

  int simsDone = 0;
  const int leafBatch = std::max(1, cfg.leafBatchSize);

  while (simsDone < cfg.simulations) {
    const int micro = std::min(leafBatch, cfg.simulations - simsDone);

    struct Pending {
      MctsNode* node = nullptr;
      Path path;
    };
    std::vector<Pending> pending;
    pending.reserve(static_cast<size_t>(micro));

    for (int s = 0; s < micro; ++s) {
      MctsNode* node = root.get();
      Path path;
      while (true) {
        if (node->terminal) {
          backpropagate(path, node->terminalValue);
          break;
        }
        if (!node->expanded) {
          pending.push_back({node, std::move(path)});
          break;
        }
        const int idx = selectAction(*node, cfg.cPuct);
        path.emplace_back(node, idx);
        if (!node->children[static_cast<size_t>(idx)]) {
          const StepResult sr = extendedStep(node->state, node->actions[static_cast<size_t>(idx)], rng, settings);
          auto child = std::make_unique<MctsNode>();
          child->state = std::move(sr.next);
          child->terminal = sr.terminal;
          child->terminalValue = sr.blackValue;
          node->children[static_cast<size_t>(idx)] = std::move(child);
        }
        node = node->children[static_cast<size_t>(idx)].get();
      }
      ++simsDone;
    }

    if (pending.empty()) continue;

    // Group paths that ended on the same unexpanded node.
    std::unordered_map<MctsNode*, std::vector<Path>> groups;
    groups.reserve(pending.size());
    for (auto& p : pending) {
      groups[p.node].push_back(std::move(p.path));
    }

    std::vector<MctsNode*> nodes;
    nodes.reserve(groups.size());
    for (auto& [node, _] : groups) nodes.push_back(node);

    const int batch = static_cast<int>(nodes.size());
    std::vector<float> batchPlanes(static_cast<size_t>(batch) * samplePlaneSize);
    for (int i = 0; i < batch; ++i) {
      const std::vector<float> enc = extendedEncode(nodes[static_cast<size_t>(i)]->state, settings);
      std::copy(enc.begin(), enc.end(), batchPlanes.begin() + static_cast<size_t>(i) * samplePlaneSize);
    }

    std::vector<float> batchLogits(static_cast<size_t>(batch) * actionCount, 0.0f);
    std::vector<float> batchValues(static_cast<size_t>(batch), 0.0f);
    callback(batchPlanes.data(), batch, n, actionCount, batchLogits.data(), batchValues.data());

    for (int i = 0; i < batch; ++i) {
      MctsNode* node = nodes[static_cast<size_t>(i)];
      if (node->expanded) continue;
      const float* logits = batchLogits.data() + static_cast<size_t>(i) * actionCount;
      expandNode(*node, settings, std::vector<float>(logits, logits + actionCount), batchValues[static_cast<size_t>(i)]);
      const float leafValue = batchValues[static_cast<size_t>(i)];
      for (const Path& path : groups[node]) {
        backpropagate(path, leafValue);
      }
    }
  }

  PuctMctsResult result;
  result.visitPolicy.assign(static_cast<size_t>(actionCount), 0.0f);
  result.rootValue = rootValue;
  result.bestAction = 0;

  int64_t totalVisits = 0;
  int bestVisits = -1;
  for (size_t i = 0; i < root->actions.size(); ++i) {
    totalVisits += root->visits[i];
    const int a = root->actions[i];
    if (root->visits[i] > bestVisits) {
      bestVisits = static_cast<int>(root->visits[i]);
      result.bestAction = a;
    }
  }
  if (totalVisits > 0) {
    for (size_t i = 0; i < root->actions.size(); ++i) {
      result.visitPolicy[static_cast<size_t>(root->actions[i])] =
          static_cast<float>(root->visits[i]) / static_cast<float>(totalVisits);
    }
  }
  return result;
}

}  // namespace ipvgo::nn
