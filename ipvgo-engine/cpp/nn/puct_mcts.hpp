#pragma once

#include <cstdint>
#include <functional>
#include <vector>

#include "agent_env.hpp"

namespace ipvgo::nn {

struct PuctMctsConfig {
  int simulations = 128;
  float cPuct = 1.5f;
  float dirichletAlpha = 0.3f;
  float dirichletEpsilon = 0.25f;
  bool addRootNoise = true;
  int leafBatchSize = 32;
};

struct PuctMctsResult {
  std::vector<float> visitPolicy;  // size extendedActionCount(N)
  int bestAction = 0;
  float rootValue = 0.0f;
};

// Batch NN callback: planes [batch, kInputPlanes, N, N] row-major per sample.
// Writes policy logits [batch, actionCount] and values [batch].
using NnBatchCallback = std::function<void(
    const float* planes, int batch, int n, int actionCount, float* policyOut, float* valueOut)>;

PuctMctsResult runPuctMcts(const EnvState& root, const CheatSettings& settings, const PuctMctsConfig& cfg,
                           uint64_t seed, NnBatchCallback callback);

}  // namespace ipvgo::nn
