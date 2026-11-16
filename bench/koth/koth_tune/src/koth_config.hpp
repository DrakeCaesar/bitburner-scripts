#pragma once

#include "koth_game.hpp"
#include "koth_tuning.hpp"

#include <array>
#include <cstdint>
#include <random>
#include <string>
#include <vector>

namespace koth {

struct GeneSpec {
  const char* name;
  double minValue;
  double maxValue;
  bool isInt;
};

inline constexpr int LADDER_SNIPE_GENE_COUNT = 22;

extern const std::array<GeneSpec, LADDER_SNIPE_GENE_COUNT> LADDER_SNIPE_GENE_SPECS;

using LadderSnipeGenome = std::array<double, LADDER_SNIPE_GENE_COUNT>;

struct TuneEvalResult {
  double fitness = 1e18;
  double avgGuesses = 0.0;
  int totalGuesses = 0;
  int maxGuesses = 0;
  int unsolved = 0;
  int count = 0;
};

LadderSnipeTuning tuningFromGenome(const LadderSnipeGenome& genome);
LadderSnipeGenome genomeFromTuning(const LadderSnipeTuning& tuning);
LadderSnipeGenome randomGenome(std::mt19937& rng);
LadderSnipeGenome mutateGenome(const LadderSnipeGenome& parent, std::mt19937& rng, double mutationRate);
LadderSnipeGenome crossoverGenomes(const LadderSnipeGenome& a, const LadderSnipeGenome& b, std::mt19937& rng);

TuneEvalResult evaluateLadderSnipeTuning(const LadderSnipeTuning& tuning,
                                         const std::vector<Assignment>& assignments, int cap,
                                         double maxGuessPenalty);

std::string tuningToJson(const LadderSnipeTuning& tuning, const TuneEvalResult* stats = nullptr);
bool tuningFromJsonFile(const std::string& path, LadderSnipeTuning* out, TuneEvalResult* statsOut = nullptr);

std::string defaultTunedJsonPath();

void setTunedLadderSnipeConfigPath(const std::string& path);
bool ensureTunedLadderSnipeConfigLoaded();
const LadderSnipeTuning* tunedLadderSnipeConfig();

}  // namespace koth
