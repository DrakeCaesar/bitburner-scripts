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

  int mainPeakDetectAlt = 7500;
  int mainPeakWindowWidths = 3;
  int gaussEstimateMinAlt = 50;
  double gaussHeightFraction = 1.0;
  int enableGaussianEstimate = 1;
  int ternaryMaxItersCap = 64;
  int ternaryWidthStop = 4;
  int ternarySpanDivisor = 3;
  int enableTernarySearch = 1;
  int expandMaxStepDivisor = 1;
  int expandStepMultiplier = 2;
  int enableExpandFromBest = 1;
  int subdivNarrowStepFactor = 2;
  int enableSubdivNarrow = 1;
  double centroidLogWeight = 1.0;
  int finalMainRadius = 9;
  int finalSideMinRadius = 25;
  int finalSideMaxRadius = 99;
  int finalSideSpanDivisor = 40;
  int finalTinySpan = 12;
  int parabolicFlatNegLog10 = 12;

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
ImprovedConfig mutateConfig(const ImprovedConfig& parent, double mutationRate, double macroMutationRate, std::mt19937& rng);
ImprovedConfig scatterMutateConfig(const ImprovedConfig& parent, double geneFraction, std::mt19937& rng);

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

int64_t computeImprovedFitness(int unsolved, int64_t totalGuesses, int maxGuesses);
bool loadConfigFromJsonFile(const std::string& path, ImprovedConfig* out);
void saveBestJson(const std::string& path, const ImprovedConfig& cfg, const EvalScore& best);

EvalScore evaluateImprovedConfig(const std::vector<Assignment>& assignments, const ImprovedConfig& cfg);

}  // namespace koth
