#include "koth_config.hpp"

#include "koth_solver.hpp"
#include "koth_tuning.hpp"

#include <algorithm>
#include <cmath>
#include <cctype>
#include <fstream>
#include <limits>
#include <mutex>
#include <random>
#include <sstream>
#include <stdexcept>

namespace koth {
namespace {

double clampGene(double v, const GeneSpec& spec) {
  v = std::max(spec.minValue, std::min(spec.maxValue, v));
  if (spec.isInt) v = std::llround(v);
  return v;
}

double readField(const std::string& json, const std::string& key, double fallback) {
  const std::string needle = "\"" + key + "\":";
  const size_t pos = json.find(needle);
  if (pos == std::string::npos) return fallback;
  size_t i = pos + needle.size();
  while (i < json.size() && std::isspace(static_cast<unsigned char>(json[i]))) ++i;
  const size_t start = i;
  while (i < json.size() && (std::isdigit(static_cast<unsigned char>(json[i])) || json[i] == '.' ||
                             json[i] == '-' || json[i] == '+' || json[i] == 'e' || json[i] == 'E')) {
    ++i;
  }
  if (start == i) return fallback;
  try {
    return std::stod(json.substr(start, i - start));
  } catch (...) {
    return fallback;
  }
}

void setGene(LadderSnipeGenome* genome, int idx, double value) {
  (*genome)[static_cast<size_t>(idx)] = clampGene(value, LADDER_SNIPE_GENE_SPECS[static_cast<size_t>(idx)]);
}

}  // namespace

const std::array<GeneSpec, LADDER_SNIPE_GENE_COUNT> LADDER_SNIPE_GENE_SPECS = {{
    {"farTailAnchorMaxAbs", 80.0, 400.0, false},
    {"ladderEntryMaxAbs", 4000.0, 9000.0, false},
    {"positiveLadderSkipRangeFraction", 0.0, 0.75, false},
    {"pairProbeOffsetW", 0.15, 0.45, false},
    {"signCrossMarchW", 0.75, 2.5, false},
    {"centerSanityMaxDistW", 12.0, 45.0, false},
    {"ladderMaxIters", 4, 12, true},
    {"orbitDistW", 0.5, 2.0, false},
    {"heightBandSlack", 50.0, 300.0, false},
    {"logResidualMax", 0.03, 0.35, false},
    {"logResidualMaxDistW", 1.0, 6.0, false},
    {"halfStepW", 0.75, 2.5, false},
    {"outsideClusterDistW", 1.0, 4.0, false},
    {"bareTailFrac", 0.002, 0.05, false},
    {"postJumpCapScale", 0.1, 0.6, false},
    {"postJumpCapBias", 0.3, 1.5, false},
    {"sqrtSnipeMinAlt", 7400.0, 7900.0, false},
    {"sqrtSnipeNearZoneExtra", 0.0, 0.01, false},
    {"gallopStepW", 1.0, 2.5, false},
    {"gallopStopW", 0.05, 0.25, false},
    {"clusterReachW", 18.0, 36.0, false},
    {"clusterStepW", 0.8, 1.8, false},
}};

LadderSnipeTuning tuningFromGenome(const LadderSnipeGenome& genome) {
  LadderSnipeTuning t = defaultLadderSnipeTuning();
  t.farTailAnchorMaxAbs = genome[0];
  t.ladderEntryMaxAbs = genome[1];
  t.positiveLadderSkipRangeFraction = genome[2];
  t.pairProbeOffsetW = genome[3];
  t.signCrossMarchW = genome[4];
  t.centerSanityMaxDistW = genome[5];
  t.ladderMaxIters = static_cast<int>(genome[6]);
  t.orbitDistW = genome[7];
  t.heightBandSlack = genome[8];
  t.logResidualMax = genome[9];
  t.logResidualMaxDistW = genome[10];
  t.halfStepW = genome[11];
  t.outsideClusterDistW = genome[12];
  t.bareTailFrac = genome[13];
  t.postJumpCapScale = genome[14];
  t.postJumpCapBias = genome[15];
  t.sqrtSnipeMinAlt = genome[16];
  t.sqrtSnipeNearZoneExtra = genome[17];
  t.gallopStepW = genome[18];
  t.gallopStopW = genome[19];
  t.clusterReachW = genome[20];
  t.clusterStepW = genome[21];
  return t;
}

LadderSnipeGenome genomeFromTuning(const LadderSnipeTuning& t) {
  LadderSnipeGenome g{};
  g[0] = t.farTailAnchorMaxAbs;
  g[1] = t.ladderEntryMaxAbs;
  g[2] = t.positiveLadderSkipRangeFraction;
  g[3] = t.pairProbeOffsetW;
  g[4] = t.signCrossMarchW;
  g[5] = t.centerSanityMaxDistW;
  g[6] = static_cast<double>(t.ladderMaxIters);
  g[7] = t.orbitDistW;
  g[8] = t.heightBandSlack;
  g[9] = t.logResidualMax;
  g[10] = t.logResidualMaxDistW;
  g[11] = t.halfStepW;
  g[12] = t.outsideClusterDistW;
  g[13] = t.bareTailFrac;
  g[14] = t.postJumpCapScale;
  g[15] = t.postJumpCapBias;
  g[16] = t.sqrtSnipeMinAlt;
  g[17] = t.sqrtSnipeNearZoneExtra;
  g[18] = t.gallopStepW;
  g[19] = t.gallopStopW;
  g[20] = t.clusterReachW;
  g[21] = t.clusterStepW;
  for (size_t i = 0; i < g.size(); ++i) {
    g[i] = clampGene(g[i], LADDER_SNIPE_GENE_SPECS[i]);
  }
  return g;
}

LadderSnipeGenome randomGenome(std::mt19937& rng) {
  LadderSnipeGenome g{};
  std::uniform_real_distribution<double> unit(0.0, 1.0);
  for (size_t i = 0; i < g.size(); ++i) {
    const GeneSpec& spec = LADDER_SNIPE_GENE_SPECS[i];
    g[i] = spec.minValue + unit(rng) * (spec.maxValue - spec.minValue);
    g[i] = clampGene(g[i], spec);
  }
  return g;
}

LadderSnipeGenome mutateGenome(const LadderSnipeGenome& parent, std::mt19937& rng, double mutationRate) {
  LadderSnipeGenome child = parent;
  std::uniform_real_distribution<double> unit(0.0, 1.0);
  std::normal_distribution<double> jitter(0.0, 0.12);
  for (size_t i = 0; i < child.size(); ++i) {
    if (unit(rng) > mutationRate) continue;
    const GeneSpec& spec = LADDER_SNIPE_GENE_SPECS[i];
    const double span = spec.maxValue - spec.minValue;
    child[i] = clampGene(child[i] + jitter(rng) * span, spec);
  }
  return child;
}

LadderSnipeGenome crossoverGenomes(const LadderSnipeGenome& a, const LadderSnipeGenome& b, std::mt19937& rng) {
  LadderSnipeGenome child{};
  std::uniform_real_distribution<double> unit(0.0, 1.0);
  for (size_t i = 0; i < child.size(); ++i) {
    child[i] = unit(rng) < 0.5 ? a[i] : b[i];
    child[i] = clampGene(child[i], LADDER_SNIPE_GENE_SPECS[i]);
  }
  return child;
}

TuneEvalResult evaluateLadderSnipeTuning(const LadderSnipeTuning& tuning,
                                         const std::vector<Assignment>& assignments, int cap,
                                         double maxGuessPenalty) {
  TuneEvalResult out;
  out.count = static_cast<int>(assignments.size());
  setActiveLadderSnipeTuning(&tuning);
  int maxG = 0;
  for (const Assignment& assignment : assignments) {
    const SolveResult result = solve(assignment, cap, SolverVariant::LadderSnipe);
    if (!result.solved) {
      ++out.unsolved;
      out.totalGuesses += cap;
      maxG = std::max(maxG, cap);
      continue;
    }
    out.totalGuesses += result.guesses;
    maxG = std::max(maxG, result.guesses);
  }
  setActiveLadderSnipeTuning(nullptr);
  out.maxGuesses = maxG;
  out.avgGuesses = out.count > 0 ? static_cast<double>(out.totalGuesses) / static_cast<double>(out.count) : 0.0;
  out.fitness = static_cast<double>(out.totalGuesses) + maxGuessPenalty * static_cast<double>(maxG) +
                static_cast<double>(out.unsolved) * static_cast<double>(cap) * 10.0;
  return out;
}

std::string tuningToJson(const LadderSnipeTuning& tuning, const TuneEvalResult* stats) {
  std::ostringstream oss;
  oss << "{\n";
  oss << "  \"variant\": \"ladder_snipe\",\n";
  oss << "  \"difficulty\": 60,\n";
  if (stats) {
    oss << "  \"fitness\": " << stats->fitness << ",\n";
    oss << "  \"avgGuesses\": " << stats->avgGuesses << ",\n";
    oss << "  \"maxGuesses\": " << stats->maxGuesses << ",\n";
    oss << "  \"totalGuesses\": " << stats->totalGuesses << ",\n";
    oss << "  \"unsolved\": " << stats->unsolved << ",\n";
  }
  oss << "  \"tuning\": {\n";
  const LadderSnipeGenome g = genomeFromTuning(tuning);
  for (size_t i = 0; i < g.size(); ++i) {
    const GeneSpec& spec = LADDER_SNIPE_GENE_SPECS[i];
    oss << "    \"" << spec.name << "\": ";
    if (spec.isInt) {
      oss << static_cast<int>(g[i]);
    } else {
      oss << g[i];
    }
    oss << (i + 1 < g.size() ? ",\n" : "\n");
  }
  oss << "  }\n";
  oss << "}\n";
  return oss.str();
}

bool tuningFromJsonFile(const std::string& path, LadderSnipeTuning* out, TuneEvalResult* statsOut) {
  std::ifstream in(path);
  if (!in) return false;
  std::ostringstream buf;
  buf << in.rdbuf();
  const std::string json = buf.str();
  LadderSnipeTuning t = defaultLadderSnipeTuning();
  LadderSnipeGenome g = genomeFromTuning(t);
  for (size_t i = 0; i < g.size(); ++i) {
    setGene(&g, static_cast<int>(i), readField(json, LADDER_SNIPE_GENE_SPECS[i].name, g[i]));
  }
  *out = tuningFromGenome(g);
  if (statsOut) {
    statsOut->fitness = readField(json, "fitness", statsOut->fitness);
    statsOut->avgGuesses = readField(json, "avgGuesses", statsOut->avgGuesses);
    statsOut->maxGuesses = static_cast<int>(readField(json, "maxGuesses", static_cast<double>(statsOut->maxGuesses)));
    statsOut->totalGuesses =
        static_cast<int>(readField(json, "totalGuesses", static_cast<double>(statsOut->totalGuesses)));
    statsOut->unsolved = static_cast<int>(readField(json, "unsolved", static_cast<double>(statsOut->unsolved)));
  }
  return true;
}

std::string defaultTunedJsonPath() { return "ladder_snipe.diff60.best.json"; }

namespace {

std::mutex gTunedConfigMu;
std::string gTunedConfigPath = defaultTunedJsonPath();
LadderSnipeTuning gTunedConfig;
bool gTunedConfigLoaded = false;

}  // namespace

void setTunedLadderSnipeConfigPath(const std::string& path) {
  std::lock_guard<std::mutex> lock(gTunedConfigMu);
  gTunedConfigPath = path;
  gTunedConfigLoaded = false;
}

bool ensureTunedLadderSnipeConfigLoaded() { return tunedLadderSnipeConfig() != nullptr; }

const LadderSnipeTuning* tunedLadderSnipeConfig() {
  std::lock_guard<std::mutex> lock(gTunedConfigMu);
  if (!gTunedConfigLoaded) {
    if (!tuningFromJsonFile(gTunedConfigPath, &gTunedConfig, nullptr)) return nullptr;
    gTunedConfigLoaded = true;
  }
  return &gTunedConfig;
}

}  // namespace koth
