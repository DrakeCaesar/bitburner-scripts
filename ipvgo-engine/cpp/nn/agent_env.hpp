#pragma once

#include <cstdint>
#include <random>
#include <vector>

#include "cheats.hpp"
#include "features.hpp"
#include "go_game.hpp"

namespace ipvgo::nn {

constexpr int kCheatPlanes = 4;
constexpr int kFactionPlanes = 7;
constexpr int kInputPlanes = kNumPlanes + kCheatPlanes + kFactionPlanes;  // 12 + 4 + 7 = 23
constexpr int kPointActionTypes = 5;

struct CheatSettings {
  bool enabled = true;
  double crimeSuccessMult = 1.0;
  double sourceFileBonus = 0.0;
};

struct EnvState {
  game::GameState gs;
  bool extraMove = false;
};

struct ActionBases {
  int P;
  int pass;
  int remove;
  int repair;
  int destroy;
  int p2m;
};

struct StepResult {
  EnvState next;
  bool terminal = false;
  float blackValue = 0.0f;
};

ActionBases actionBases(int n);
int extendedActionCount(int n);

double cheatChance(const game::GameState& gs, const CheatSettings& settings);

// [kInputPlanes * N * N] float32, plane-major.
std::vector<float> extendedEncode(const EnvState& env, const CheatSettings& settings);

// size extendedActionCount(N); 1 = legal.
std::vector<char> extendedLegalMask(const EnvState& env, const CheatSettings& settings);

// Apply one Black action (board / pass / cheat). White reply is folded in unless
// playTwoMoves succeeds (extraMove stays true for the second stone).
StepResult extendedStep(const EnvState& env, int action, std::mt19937_64& rng, const CheatSettings& settings);

}  // namespace ipvgo::nn
