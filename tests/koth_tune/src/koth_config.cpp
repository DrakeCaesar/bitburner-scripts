#include "koth_config.hpp"

#include "koth_solver.hpp"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <limits>
#include <sstream>
#include <stdexcept>

namespace koth {

namespace {

enum class GeneId {
  ClusterMargin,
  ClusterDetectAlt,
  MainPeakModeAlt,
  RefinePeakCountMain,
  FindHillQuickRounds,
  CoarseMinDivisor,
  CoarseHillFactor,
  RescanDivisor1,
  RescanDivisor2,
  RescanDivisor3,
  RefineSpanHillDivisor,
  RefineCoarsePasses,
  RefineFinePasses,
  RefineRadiusShrink,
  RefineStepShrink,
  SideHillSweepWidthDivisor,
  CentroidMinAlt,
  CentroidAltFraction,
  CentroidRefineRadius,
  CentroidRefinePasses,
  HillClimbInitialDivisor,
  HillClimbShrink,
  HillClimbFlatAltDelta,
  ZoomInitialDivisor,
  ZoomMaxPasses,
  ZoomStepDivisor,
  ParabolicFlatNegLog10,
  MainPeakDetectAlt,
  MainPeakWindowWidths,
  GaussEstimateMinAlt,
  GaussHeightFraction,
  EnableGaussianEstimate,
  TernaryMaxItersCap,
  TernaryWidthStop,
  TernarySpanDivisor,
  EnableTernarySearch,
  ExpandMaxStepDivisor,
  ExpandStepMultiplier,
  EnableExpandFromBest,
  SubdivNarrowStepFactor,
  EnableSubdivNarrow,
  CentroidLogWeight,
  FinalMainRadius,
  FinalSideMinRadius,
  FinalSideMaxRadius,
  FinalSideSpanDivisor,
  FinalTinySpan,
};

struct SpecDef {
  GeneId id;
  GeneType type;
  double minVal;
  double maxVal;
  double step;
};

constexpr SpecDef kSpecs[] = {
    {GeneId::ClusterMargin, GeneType::Float, 1.0, 1.3, 0.05},
    {GeneId::ClusterDetectAlt, GeneType::Int, 300, 800, 50},
    {GeneId::MainPeakModeAlt, GeneType::Int, 9000, 9900, 100},
    {GeneId::RefinePeakCountMain, GeneType::Int, 1, 3, 1},
    {GeneId::FindHillQuickRounds, GeneType::Int, 1, 5, 1},
    {GeneId::CoarseMinDivisor, GeneType::Int, 40, 80, 4},
    {GeneId::CoarseHillFactor, GeneType::Int, 4, 12, 1},
    {GeneId::RescanDivisor1, GeneType::Int, 0, 200, 10},
    {GeneId::RescanDivisor2, GeneType::Int, 0, 400, 20},
    {GeneId::RescanDivisor3, GeneType::Int, 0, 900, 50},
    {GeneId::RefineSpanHillDivisor, GeneType::Int, 2, 6, 1},
    {GeneId::RefineCoarsePasses, GeneType::Int, 3, 7, 1},
    {GeneId::RefineFinePasses, GeneType::Int, 2, 6, 1},
    {GeneId::RefineRadiusShrink, GeneType::Int, 3, 10, 1},
    {GeneId::RefineStepShrink, GeneType::Int, 2, 5, 1},
    {GeneId::SideHillSweepWidthDivisor, GeneType::Int, 1, 4, 1},
    {GeneId::CentroidMinAlt, GeneType::Int, 8000, 9600, 100},
    {GeneId::CentroidAltFraction, GeneType::Float, 0.8, 0.95, 0.01},
    {GeneId::CentroidRefineRadius, GeneType::Int, 6, 20, 2},
    {GeneId::CentroidRefinePasses, GeneType::Int, 2, 6, 1},
    {GeneId::HillClimbInitialDivisor, GeneType::Int, 32, 128, 8},
    {GeneId::HillClimbShrink, GeneType::Int, 2, 8, 1},
    {GeneId::HillClimbFlatAltDelta, GeneType::Float, 0.001, 0.1, 0.005},
    {GeneId::ZoomInitialDivisor, GeneType::Int, 20, 80, 5},
    {GeneId::ZoomMaxPasses, GeneType::Int, 4, 12, 1},
    {GeneId::ZoomStepDivisor, GeneType::Int, 4, 16, 1},
    {GeneId::ParabolicFlatNegLog10, GeneType::Int, 6, 15, 1},
    {GeneId::MainPeakDetectAlt, GeneType::Int, 6500, 8500, 100},
    {GeneId::MainPeakWindowWidths, GeneType::Int, 2, 6, 1},
    {GeneId::GaussEstimateMinAlt, GeneType::Int, 0, 500, 25},
    {GeneId::GaussHeightFraction, GeneType::Float, 0.85, 1.0, 0.01},
    {GeneId::EnableGaussianEstimate, GeneType::Int, 0, 1, 1},
    {GeneId::TernaryMaxItersCap, GeneType::Int, 8, 128, 4},
    {GeneId::TernaryWidthStop, GeneType::Int, 1, 12, 1},
    {GeneId::TernarySpanDivisor, GeneType::Int, 2, 8, 1},
    {GeneId::EnableTernarySearch, GeneType::Int, 0, 1, 1},
    {GeneId::ExpandMaxStepDivisor, GeneType::Int, 1, 8, 1},
    {GeneId::ExpandStepMultiplier, GeneType::Int, 2, 4, 1},
    {GeneId::EnableExpandFromBest, GeneType::Int, 0, 1, 1},
    {GeneId::SubdivNarrowStepFactor, GeneType::Int, 1, 6, 1},
    {GeneId::EnableSubdivNarrow, GeneType::Int, 0, 1, 1},
    {GeneId::CentroidLogWeight, GeneType::Float, 0.0, 1.0, 0.1},
    {GeneId::FinalMainRadius, GeneType::Int, 3, 20, 1},
    {GeneId::FinalSideMinRadius, GeneType::Int, 10, 50, 5},
    {GeneId::FinalSideMaxRadius, GeneType::Int, 50, 150, 5},
    {GeneId::FinalSideSpanDivisor, GeneType::Int, 20, 80, 5},
    {GeneId::FinalTinySpan, GeneType::Int, 6, 24, 2},
};

double getGeneDouble(const ImprovedConfig& cfg, GeneId id) {
  switch (id) {
    case GeneId::ClusterMargin: return cfg.clusterMargin;
    case GeneId::ClusterDetectAlt: return cfg.clusterDetectAlt;
    case GeneId::MainPeakModeAlt: return cfg.mainPeakModeAlt;
    case GeneId::RefinePeakCountMain: return cfg.refinePeakCountMain;
    case GeneId::FindHillQuickRounds: return cfg.findHillQuickRounds;
    case GeneId::CoarseMinDivisor: return cfg.coarseMinDivisor;
    case GeneId::CoarseHillFactor: return cfg.coarseHillFactor;
    case GeneId::RescanDivisor1: return cfg.rescanDivisor1;
    case GeneId::RescanDivisor2: return cfg.rescanDivisor2;
    case GeneId::RescanDivisor3: return cfg.rescanDivisor3;
    case GeneId::RefineSpanHillDivisor: return cfg.refineSpanHillDivisor;
    case GeneId::RefineCoarsePasses: return cfg.refineCoarsePasses;
    case GeneId::RefineFinePasses: return cfg.refineFinePasses;
    case GeneId::RefineRadiusShrink: return cfg.refineRadiusShrink;
    case GeneId::RefineStepShrink: return cfg.refineStepShrink;
    case GeneId::SideHillSweepWidthDivisor: return cfg.sideHillSweepWidthDivisor;
    case GeneId::CentroidMinAlt: return cfg.centroidMinAlt;
    case GeneId::CentroidAltFraction: return cfg.centroidAltFraction;
    case GeneId::CentroidRefineRadius: return cfg.centroidRefineRadius;
    case GeneId::CentroidRefinePasses: return cfg.centroidRefinePasses;
    case GeneId::HillClimbInitialDivisor: return cfg.hillClimbInitialDivisor;
    case GeneId::HillClimbShrink: return cfg.hillClimbShrink;
    case GeneId::HillClimbFlatAltDelta: return cfg.hillClimbFlatAltDelta;
    case GeneId::ZoomInitialDivisor: return cfg.zoomInitialDivisor;
    case GeneId::ZoomMaxPasses: return cfg.zoomMaxPasses;
    case GeneId::ZoomStepDivisor: return cfg.zoomStepDivisor;
    case GeneId::ParabolicFlatNegLog10: return cfg.parabolicFlatNegLog10;
    case GeneId::MainPeakDetectAlt: return cfg.mainPeakDetectAlt;
    case GeneId::MainPeakWindowWidths: return cfg.mainPeakWindowWidths;
    case GeneId::GaussEstimateMinAlt: return cfg.gaussEstimateMinAlt;
    case GeneId::GaussHeightFraction: return cfg.gaussHeightFraction;
    case GeneId::EnableGaussianEstimate: return cfg.enableGaussianEstimate;
    case GeneId::TernaryMaxItersCap: return cfg.ternaryMaxItersCap;
    case GeneId::TernaryWidthStop: return cfg.ternaryWidthStop;
    case GeneId::TernarySpanDivisor: return cfg.ternarySpanDivisor;
    case GeneId::EnableTernarySearch: return cfg.enableTernarySearch;
    case GeneId::ExpandMaxStepDivisor: return cfg.expandMaxStepDivisor;
    case GeneId::ExpandStepMultiplier: return cfg.expandStepMultiplier;
    case GeneId::EnableExpandFromBest: return cfg.enableExpandFromBest;
    case GeneId::SubdivNarrowStepFactor: return cfg.subdivNarrowStepFactor;
    case GeneId::EnableSubdivNarrow: return cfg.enableSubdivNarrow;
    case GeneId::CentroidLogWeight: return cfg.centroidLogWeight;
    case GeneId::FinalMainRadius: return cfg.finalMainRadius;
    case GeneId::FinalSideMinRadius: return cfg.finalSideMinRadius;
    case GeneId::FinalSideMaxRadius: return cfg.finalSideMaxRadius;
    case GeneId::FinalSideSpanDivisor: return cfg.finalSideSpanDivisor;
    case GeneId::FinalTinySpan: return cfg.finalTinySpan;
  }
  return 0.0;
}

void setGeneDouble(ImprovedConfig& cfg, GeneId id, double v) {
  switch (id) {
    case GeneId::ClusterMargin: cfg.clusterMargin = v; break;
    case GeneId::ClusterDetectAlt: cfg.clusterDetectAlt = static_cast<int>(std::llround(v)); break;
    case GeneId::MainPeakModeAlt: cfg.mainPeakModeAlt = static_cast<int>(std::llround(v)); break;
    case GeneId::RefinePeakCountMain: cfg.refinePeakCountMain = static_cast<int>(std::llround(v)); break;
    case GeneId::FindHillQuickRounds: cfg.findHillQuickRounds = static_cast<int>(std::llround(v)); break;
    case GeneId::CoarseMinDivisor: cfg.coarseMinDivisor = static_cast<int>(std::llround(v)); break;
    case GeneId::CoarseHillFactor: cfg.coarseHillFactor = static_cast<int>(std::llround(v)); break;
    case GeneId::RescanDivisor1: cfg.rescanDivisor1 = static_cast<int>(std::llround(v)); break;
    case GeneId::RescanDivisor2: cfg.rescanDivisor2 = static_cast<int>(std::llround(v)); break;
    case GeneId::RescanDivisor3: cfg.rescanDivisor3 = static_cast<int>(std::llround(v)); break;
    case GeneId::RefineSpanHillDivisor: cfg.refineSpanHillDivisor = static_cast<int>(std::llround(v)); break;
    case GeneId::RefineCoarsePasses: cfg.refineCoarsePasses = static_cast<int>(std::llround(v)); break;
    case GeneId::RefineFinePasses: cfg.refineFinePasses = static_cast<int>(std::llround(v)); break;
    case GeneId::RefineRadiusShrink: cfg.refineRadiusShrink = static_cast<int>(std::llround(v)); break;
    case GeneId::RefineStepShrink: cfg.refineStepShrink = static_cast<int>(std::llround(v)); break;
    case GeneId::SideHillSweepWidthDivisor: cfg.sideHillSweepWidthDivisor = static_cast<int>(std::llround(v)); break;
    case GeneId::CentroidMinAlt: cfg.centroidMinAlt = static_cast<int>(std::llround(v)); break;
    case GeneId::CentroidAltFraction: cfg.centroidAltFraction = v; break;
    case GeneId::CentroidRefineRadius: cfg.centroidRefineRadius = static_cast<int>(std::llround(v)); break;
    case GeneId::CentroidRefinePasses: cfg.centroidRefinePasses = static_cast<int>(std::llround(v)); break;
    case GeneId::HillClimbInitialDivisor: cfg.hillClimbInitialDivisor = static_cast<int>(std::llround(v)); break;
    case GeneId::HillClimbShrink: cfg.hillClimbShrink = static_cast<int>(std::llround(v)); break;
    case GeneId::HillClimbFlatAltDelta: cfg.hillClimbFlatAltDelta = v; break;
    case GeneId::ZoomInitialDivisor: cfg.zoomInitialDivisor = static_cast<int>(std::llround(v)); break;
    case GeneId::ZoomMaxPasses: cfg.zoomMaxPasses = static_cast<int>(std::llround(v)); break;
    case GeneId::ZoomStepDivisor: cfg.zoomStepDivisor = static_cast<int>(std::llround(v)); break;
    case GeneId::ParabolicFlatNegLog10: cfg.parabolicFlatNegLog10 = static_cast<int>(std::llround(v)); break;
    case GeneId::MainPeakDetectAlt: cfg.mainPeakDetectAlt = static_cast<int>(std::llround(v)); break;
    case GeneId::MainPeakWindowWidths: cfg.mainPeakWindowWidths = static_cast<int>(std::llround(v)); break;
    case GeneId::GaussEstimateMinAlt: cfg.gaussEstimateMinAlt = static_cast<int>(std::llround(v)); break;
    case GeneId::GaussHeightFraction: cfg.gaussHeightFraction = v; break;
    case GeneId::EnableGaussianEstimate: cfg.enableGaussianEstimate = static_cast<int>(std::llround(v)); break;
    case GeneId::TernaryMaxItersCap: cfg.ternaryMaxItersCap = static_cast<int>(std::llround(v)); break;
    case GeneId::TernaryWidthStop: cfg.ternaryWidthStop = static_cast<int>(std::llround(v)); break;
    case GeneId::TernarySpanDivisor: cfg.ternarySpanDivisor = static_cast<int>(std::llround(v)); break;
    case GeneId::EnableTernarySearch: cfg.enableTernarySearch = static_cast<int>(std::llround(v)); break;
    case GeneId::ExpandMaxStepDivisor: cfg.expandMaxStepDivisor = static_cast<int>(std::llround(v)); break;
    case GeneId::ExpandStepMultiplier: cfg.expandStepMultiplier = static_cast<int>(std::llround(v)); break;
    case GeneId::EnableExpandFromBest: cfg.enableExpandFromBest = static_cast<int>(std::llround(v)); break;
    case GeneId::SubdivNarrowStepFactor: cfg.subdivNarrowStepFactor = static_cast<int>(std::llround(v)); break;
    case GeneId::EnableSubdivNarrow: cfg.enableSubdivNarrow = static_cast<int>(std::llround(v)); break;
    case GeneId::CentroidLogWeight: cfg.centroidLogWeight = v; break;
    case GeneId::FinalMainRadius: cfg.finalMainRadius = static_cast<int>(std::llround(v)); break;
    case GeneId::FinalSideMinRadius: cfg.finalSideMinRadius = static_cast<int>(std::llround(v)); break;
    case GeneId::FinalSideMaxRadius: cfg.finalSideMaxRadius = static_cast<int>(std::llround(v)); break;
    case GeneId::FinalSideSpanDivisor: cfg.finalSideSpanDivisor = static_cast<int>(std::llround(v)); break;
    case GeneId::FinalTinySpan: cfg.finalTinySpan = static_cast<int>(std::llround(v)); break;
  }
}

double clampGene(const SpecDef& spec, double v) {
  v = std::max(spec.minVal, std::min(spec.maxVal, v));
  if (spec.type == GeneType::Int) {
    return static_cast<double>(static_cast<int>(std::llround(v)));
  }
  const double steps = std::round((v - spec.minVal) / spec.step);
  return spec.minVal + steps * spec.step;
}

double randomInSpec(const SpecDef& spec, std::mt19937& rng) {
  std::uniform_real_distribution<double> dist(0.0, 1.0);
  const double span = spec.maxVal - spec.minVal;
  if (spec.type == GeneType::Int) {
    const int steps = static_cast<int>(span / spec.step);
    std::uniform_int_distribution<int> idist(0, steps);
    return spec.minVal + idist(rng) * spec.step;
  }
  const int steps = static_cast<int>(span / spec.step);
  std::uniform_int_distribution<int> idist(0, steps);
  return spec.minVal + idist(rng) * spec.step;
}

void fillRescanDivisors(ImprovedConfig& cfg) {
  int vals[3] = {cfg.rescanDivisor1, cfg.rescanDivisor2, cfg.rescanDivisor3};
  std::sort(vals, vals + 3);
  cfg.rescanDivisorCount = 0;
  for (int v : vals) {
    if (v > 0) cfg.rescanDivisorsSorted[static_cast<size_t>(cfg.rescanDivisorCount++)] = v;
  }
}

std::string trim(const std::string& s) {
  size_t b = 0;
  while (b < s.size() && std::isspace(static_cast<unsigned char>(s[b]))) ++b;
  size_t e = s.size();
  while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) --e;
  return s.substr(b, e - b);
}

bool parseJsonNumberAfterKey(const std::string& text, const std::string& key, double* out) {
  const std::string needle = "\"" + key + "\"";
  size_t pos = text.find(needle);
  if (pos == std::string::npos) return false;
  pos = text.find(':', pos);
  if (pos == std::string::npos) return false;
  ++pos;
  while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) ++pos;
  size_t end = pos;
  while (end < text.size() && (std::isdigit(static_cast<unsigned char>(text[end])) || text[end] == '.' || text[end] == '-' ||
                               text[end] == 'e' || text[end] == 'E' || text[end] == '+')) {
    ++end;
  }
  if (end == pos) return false;
  try {
    *out = std::stod(text.substr(pos, end - pos));
    return true;
  } catch (...) {
    return false;
  }
}

bool extractJsonObjectAfterKey(const std::string& text, const std::string& key, std::string* out) {
  const std::string needle = "\"" + key + "\"";
  const size_t keyPos = text.find(needle);
  if (keyPos == std::string::npos) return false;
  const size_t bracePos = text.find('{', text.find(':', keyPos));
  if (bracePos == std::string::npos) return false;

  int depth = 0;
  for (size_t i = bracePos; i < text.size(); ++i) {
    if (text[i] == '{') {
      ++depth;
    } else if (text[i] == '}') {
      --depth;
      if (depth == 0) {
        *out = text.substr(bracePos, i - bracePos + 1);
        return true;
      }
    }
  }
  return false;
}

const char* geneKey(GeneId id) {
  switch (id) {
    case GeneId::ClusterMargin: return "clusterMargin";
    case GeneId::ClusterDetectAlt: return "clusterDetectAlt";
    case GeneId::MainPeakModeAlt: return "mainPeakModeAlt";
    case GeneId::RefinePeakCountMain: return "refinePeakCountMain";
    case GeneId::FindHillQuickRounds: return "findHillQuickRounds";
    case GeneId::CoarseMinDivisor: return "coarseMinDivisor";
    case GeneId::CoarseHillFactor: return "coarseHillFactor";
    case GeneId::RescanDivisor1: return "rescanDivisor1";
    case GeneId::RescanDivisor2: return "rescanDivisor2";
    case GeneId::RescanDivisor3: return "rescanDivisor3";
    case GeneId::RefineSpanHillDivisor: return "refineSpanHillDivisor";
    case GeneId::RefineCoarsePasses: return "refineCoarsePasses";
    case GeneId::RefineFinePasses: return "refineFinePasses";
    case GeneId::RefineRadiusShrink: return "refineRadiusShrink";
    case GeneId::RefineStepShrink: return "refineStepShrink";
    case GeneId::SideHillSweepWidthDivisor: return "sideHillSweepWidthDivisor";
    case GeneId::CentroidMinAlt: return "centroidMinAlt";
    case GeneId::CentroidAltFraction: return "centroidAltFraction";
    case GeneId::CentroidRefineRadius: return "centroidRefineRadius";
    case GeneId::CentroidRefinePasses: return "centroidRefinePasses";
    case GeneId::HillClimbInitialDivisor: return "hillClimbInitialDivisor";
    case GeneId::HillClimbShrink: return "hillClimbShrink";
    case GeneId::HillClimbFlatAltDelta: return "hillClimbFlatAltDelta";
    case GeneId::ZoomInitialDivisor: return "zoomInitialDivisor";
    case GeneId::ZoomMaxPasses: return "zoomMaxPasses";
    case GeneId::ZoomStepDivisor: return "zoomStepDivisor";
    case GeneId::ParabolicFlatNegLog10: return "parabolicFlatNegLog10";
    case GeneId::MainPeakDetectAlt: return "mainPeakDetectAlt";
    case GeneId::MainPeakWindowWidths: return "mainPeakWindowWidths";
    case GeneId::GaussEstimateMinAlt: return "gaussEstimateMinAlt";
    case GeneId::GaussHeightFraction: return "gaussHeightFraction";
    case GeneId::EnableGaussianEstimate: return "enableGaussianEstimate";
    case GeneId::TernaryMaxItersCap: return "ternaryMaxItersCap";
    case GeneId::TernaryWidthStop: return "ternaryWidthStop";
    case GeneId::TernarySpanDivisor: return "ternarySpanDivisor";
    case GeneId::EnableTernarySearch: return "enableTernarySearch";
    case GeneId::ExpandMaxStepDivisor: return "expandMaxStepDivisor";
    case GeneId::ExpandStepMultiplier: return "expandStepMultiplier";
    case GeneId::EnableExpandFromBest: return "enableExpandFromBest";
    case GeneId::SubdivNarrowStepFactor: return "subdivNarrowStepFactor";
    case GeneId::EnableSubdivNarrow: return "enableSubdivNarrow";
    case GeneId::CentroidLogWeight: return "centroidLogWeight";
    case GeneId::FinalMainRadius: return "finalMainRadius";
    case GeneId::FinalSideMinRadius: return "finalSideMinRadius";
    case GeneId::FinalSideMaxRadius: return "finalSideMaxRadius";
    case GeneId::FinalSideSpanDivisor: return "finalSideSpanDivisor";
    case GeneId::FinalTinySpan: return "finalTinySpan";
  }
  return "";
}

}  // namespace

ImprovedConfig defaultImprovedConfig() { return ImprovedConfig{}; }

ImprovedConfig normalizeImprovedConfig(const ImprovedConfig& raw) {
  ImprovedConfig cfg = raw;
  for (const auto& spec : kSpecs) {
    setGeneDouble(cfg, spec.id, clampGene(spec, getGeneDouble(cfg, spec.id)));
  }
  cfg.enableGaussianEstimate = cfg.enableGaussianEstimate != 0 ? 1 : 0;
  cfg.enableTernarySearch = cfg.enableTernarySearch != 0 ? 1 : 0;
  cfg.enableExpandFromBest = cfg.enableExpandFromBest != 0 ? 1 : 0;
  cfg.enableSubdivNarrow = cfg.enableSubdivNarrow != 0 ? 1 : 0;
  cfg.parabolicFlatEpsilon = std::pow(10.0, -static_cast<double>(cfg.parabolicFlatNegLog10));
  fillRescanDivisors(cfg);
  return cfg;
}

const std::vector<TunableSpec>& tunableSpecs() {
  static const std::vector<TunableSpec> empty;
  return empty;
}

ImprovedConfig randomIndividual(std::mt19937& rng) {
  ImprovedConfig cfg;
  for (const auto& spec : kSpecs) {
    setGeneDouble(cfg, spec.id, randomInSpec(spec, rng));
  }
  return normalizeImprovedConfig(cfg);
}

ImprovedConfig crossover(const ImprovedConfig& a, const ImprovedConfig& b, std::mt19937& rng) {
  ImprovedConfig cfg;
  std::uniform_real_distribution<double> coin(0.0, 1.0);
  for (const auto& spec : kSpecs) {
    const double va = getGeneDouble(a, spec.id);
    const double vb = getGeneDouble(b, spec.id);
    double v;
    if (coin(rng) < 0.35) {
      if (spec.type == GeneType::Int) {
        const int lo = static_cast<int>(std::min(va, vb));
        const int hi = static_cast<int>(std::max(va, vb));
        if (lo == hi) {
          v = lo;
        } else {
          std::uniform_int_distribution<int> between(lo, hi);
          v = between(rng);
        }
      } else {
        v = (va + vb) * 0.5;
      }
    } else {
      v = coin(rng) < 0.5 ? va : vb;
    }
    setGeneDouble(cfg, spec.id, v);
  }
  return normalizeImprovedConfig(cfg);
}

ImprovedConfig mutateConfig(const ImprovedConfig& parent, double mutationRate, double macroMutationRate, std::mt19937& rng) {
  ImprovedConfig cfg = parent;
  std::uniform_real_distribution<double> dist(0.0, 1.0);
  for (const auto& spec : kSpecs) {
    if (dist(rng) > mutationRate) continue;
    if (dist(rng) < macroMutationRate) {
      setGeneDouble(cfg, spec.id, randomInSpec(spec, rng));
      continue;
    }
    double v = getGeneDouble(cfg, spec.id);
    if (spec.type == GeneType::Int) {
      const int deltaSteps = 1 + (rng() % 3);
      const double delta = spec.step * deltaSteps * (dist(rng) < 0.5 ? -1.0 : 1.0);
      v += delta;
    } else {
      const double delta = spec.step * (1.0 + dist(rng) * 2.0) * (dist(rng) < 0.5 ? -1.0 : 1.0);
      v += delta;
    }
    setGeneDouble(cfg, spec.id, v);
  }
  return normalizeImprovedConfig(cfg);
}

ImprovedConfig scatterMutateConfig(const ImprovedConfig& parent, double geneFraction, std::mt19937& rng) {
  ImprovedConfig cfg = parent;
  std::uniform_real_distribution<double> dist(0.0, 1.0);
  for (const auto& spec : kSpecs) {
    if (dist(rng) < geneFraction) {
      setGeneDouble(cfg, spec.id, randomInSpec(spec, rng));
    }
  }
  return normalizeImprovedConfig(cfg);
}

int64_t computeImprovedFitness(int unsolved, int64_t totalGuesses, int maxGuesses) {
  if (unsolved > 0) {
    return std::numeric_limits<int64_t>::max() - static_cast<int64_t>(unsolved) * 1000000000LL + totalGuesses;
  }
  return totalGuesses * 1000LL + maxGuesses;
}

bool loadConfigFromJsonFile(const std::string& path, ImprovedConfig* out) {
  std::ifstream in(path);
  if (!in) return false;
  std::ostringstream ss;
  ss << in.rdbuf();
  const std::string text = ss.str();

  std::string configJson;
  if (!extractJsonObjectAfterKey(text, "config", &configJson)) return false;

  ImprovedConfig cfg = defaultImprovedConfig();
  for (const auto& spec : kSpecs) {
    double v = getGeneDouble(cfg, spec.id);
    if (parseJsonNumberAfterKey(configJson, geneKey(spec.id), &v)) {
      setGeneDouble(cfg, spec.id, v);
    }
  }
  *out = normalizeImprovedConfig(cfg);
  return true;
}

EvalScore evaluateImprovedConfig(const std::vector<Assignment>& assignments, const ImprovedConfig& cfgIn) {
  const ImprovedConfig cfg = normalizeImprovedConfig(cfgIn);
  EvalScore score;
  score.config = cfg;
  score.total = static_cast<int>(assignments.size());
  score.minGuesses = std::numeric_limits<int>::max();

  for (size_t i = 0; i < assignments.size(); ++i) {
    const SolverResult r = runSolverImproved(assignments[i], cfg);
    if (r.solved) {
      ++score.solved;
      score.totalGuesses += r.guesses;
      score.maxGuesses = std::max(score.maxGuesses, r.guesses);
      score.minGuesses = std::min(score.minGuesses, r.guesses);
    } else if (r.guesses >= SOLVER_MAX_PROBES) {
      score.unsolved = score.total - score.solved;
      score.fitness = computeImprovedFitness(score.unsolved, score.totalGuesses, score.maxGuesses);
      score.avgGuesses = 0.0;
      return score;
    }
  }

  score.unsolved = score.total - score.solved;
  if (score.unsolved > 0) {
    score.fitness = computeImprovedFitness(score.unsolved, score.totalGuesses, score.maxGuesses);
    score.avgGuesses = 0.0;
  } else {
    score.fitness = computeImprovedFitness(0, score.totalGuesses, score.maxGuesses);
    score.avgGuesses = static_cast<double>(score.totalGuesses) / static_cast<double>(score.total);
  }
  return score;
}

void saveBestJson(const std::string& path, const ImprovedConfig& cfg, const EvalScore& best) {
  std::ofstream out(path);
  out << std::setprecision(12);
  out << "{\n";
  out << "  \"avgGuesses\": " << best.avgGuesses << ",\n";
  out << "  \"totalGuesses\": " << best.totalGuesses << ",\n";
  out << "  \"fitness\": " << best.fitness << ",\n";
  out << "  \"config\": {\n";
  for (size_t i = 0; i < sizeof(kSpecs) / sizeof(kSpecs[0]); ++i) {
    const auto& spec = kSpecs[i];
    out << "    \"" << geneKey(spec.id) << "\": ";
    const double v = getGeneDouble(cfg, spec.id);
    if (spec.type == GeneType::Int) out << static_cast<int>(std::llround(v));
    else out << v;
    out << (i + 1 < sizeof(kSpecs) / sizeof(kSpecs[0]) ? ",\n" : "\n");
  }
  out << "  }\n";
  out << "}\n";
}

}  // namespace koth
