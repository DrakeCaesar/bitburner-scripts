#pragma once

#include "koth_game.hpp"

#include <array>
#include <cstdint>
#include <random>
#include <string>
#include <vector>

namespace koth {

struct ImprovedConfig {
  double clusterMargin = 1.1;
  int clusterDetectAlt = 500;
  int mainPeakModeAlt = 9600;
  int refinePeakCountMain = 1;
  int findHillQuickRounds = 3;
  int coarseMinDivisor = 56;
  int coarseHillFactor = 8;
  int rescanDivisor1 = 100;
  int rescanDivisor2 = 280;
  int rescanDivisor3 = 750;
  int refineSpanHillDivisor = 3;
  int refineCoarsePasses = 5;
  int refineFinePasses = 4;
  int refineRadiusShrink = 6;
  int refineStepShrink = 3;
  int sideHillSweepWidthDivisor = 2;
  int centroidMinAlt = 9000;
  double centroidAltFraction = 0.88;
  int centroidRefineRadius = 12;
  int centroidRefinePasses = 4;
  int hillClimbInitialDivisor = 64;
  int hillClimbShrink = 4;
  double hillClimbFlatAltDelta = 0.01;
  int zoomInitialDivisor = 40;
  int zoomMaxPasses = 8;
  int zoomStepDivisor = 8;
  double parabolicFlatEpsilon = 1e-12;

  std::array<int, 3> rescanDivisorsSorted{};  // filled by normalize
  int rescanDivisorCount = 0;
};

enum class GeneType { Int, Float };

struct TunableSpec {
  const char* key;
  GeneType type;
  double minVal;
  double maxVal;
  double step;
  size_t intOffset;    // offsetof for int fields, SIZE_MAX if float
  size_t floatOffset;  // offsetof for float fields, SIZE_MAX if int
};

ImprovedConfig defaultImprovedConfig();
ImprovedConfig normalizeImprovedConfig(const ImprovedConfig& raw);
const std::vector<TunableSpec>& tunableSpecs();

ImprovedConfig randomIndividual(std::mt19937& rng);
ImprovedConfig crossover(const ImprovedConfig& a, const ImprovedConfig& b, std::mt19937& rng);
ImprovedConfig mutateConfig(const ImprovedConfig& parent, double mutationRate, std::mt19937& rng);

bool loadConfigFromJsonFile(const std::string& path, ImprovedConfig* out);
void saveBestJson(const std::string& path, const ImprovedConfig& cfg, const struct EvalScore& best,
                  int generation, uint32_t seed, int count, int difficulty, int64_t evaluations,
                  int64_t elapsedMs, const char* reason);

struct EvalScore {
  ImprovedConfig config{};
  int solved = 0;
  int total = 0;
  int unsolved = 0;
  int64_t totalGuesses = 0;
  double avgGuesses = 0.0;
  int maxGuesses = 0;
  int minGuesses = 0;
  int64_t fitness = 0;
};

EvalScore evaluateImprovedConfig(const std::vector<Assignment>& assignments, const ImprovedConfig& cfg);

}  // namespace koth
