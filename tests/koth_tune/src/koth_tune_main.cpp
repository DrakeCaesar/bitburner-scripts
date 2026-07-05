#include "koth_config.hpp"
#include "koth_game.hpp"
#include "koth_solver.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <mutex>
#include <random>
#include <string>
#include <thread>
#include <vector>

namespace {

struct Args {
  uint32_t seed = koth::DEFAULT_SEED;
  int count = koth::DEFAULT_COUNT;
  int poolSize = 0;  // 0 = same as count (no pre-scan)
  int difficulty = koth::DEFAULT_DIFFICULTY;
  int population = 20;
  int generations = -1;  // infinite
  double mutationRate = 0.35;
  double macroMutationRate = 0.08;
  int tournamentSize = 3;
  int eliteCount = 2;
  int stagnationGens = 12;
  int radicalStagnationGens = 144;
  int radicalReseedPeriod = 48;
  double immigrantFraction = 0.1;
  double stagnationImmigrantFraction = 0.35;
  double eliteMutationRate = 0.12;
  int threads = 0;  // 0 = hardware_concurrency
  koth::FitnessObjective objective = koth::FitnessObjective::Max;
  bool writeBenchmark = false;
};

std::atomic<bool> g_stop{false};

void onSignal(int) { g_stop.store(true); }

void printHelp() {
  std::cout
      << "Usage: koth_tune [options]\n\n"
      << "Options:\n"
      << "  --seed N            Assignment seed (default " << koth::DEFAULT_SEED << ")\n"
      << "  --count N           Assignments per GA evaluation (default 100)\n"
      << "  --pool-size N       Scan N assignments first; keep worst --count for GA (default: count only)\n"
      << "  --difficulty N      Game difficulty (default " << koth::DEFAULT_DIFFICULTY << ")\n"
      << "  --population N      Population size (default 20)\n"
      << "  --generations N     Max generations; omit for infinite\n"
      << "  --threads N         Worker threads (default: CPU cores)\n"
      << "  --objective MODE    Fitness target: max or avg (default max)\n"
      << "  --mutation-rate F   Per-gene mutation chance (default 0.35)\n"
      << "  --macro-mutation F  Jump-to-random gene chance when mutating (default 0.08)\n"
      << "  --stagnation N      Gens without global best before diversity boost (default 12)\n"
      << "  --radical-stagnation N  Gens before full random reseed (default 144)\n"
      << "  --radical-period N  Repeat radical reseed every N stagnant gens (default 48)\n"
      << "  --tournament N      Tournament selection size (default 3)\n"
      << "  --elite N           Elite individuals per generation (default 2)\n"
      << "  --write-benchmark   Evaluate loaded config on GA assignments; write JSON + benchmark (no GA)\n"
      << "  --help              Show this help\n\n"
      << "Config JSON is tests/kingOfTheHillTune.<objective>.json (load + save).\n"
      << "Ctrl+C exits; JSON is updated only on improvement.\n";
}

bool parseObjective(const std::string& text, koth::FitnessObjective* out) {
  if (text == "max") {
    *out = koth::FitnessObjective::Max;
    return true;
  }
  if (text == "avg" || text == "average") {
    *out = koth::FitnessObjective::Avg;
    return true;
  }
  return false;
}

bool parseArgs(int argc, char** argv, Args* args) {
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    auto need = [&](const char* name) -> const char* {
      if (i + 1 >= argc) {
        std::cerr << "Missing value for " << name << "\n";
        std::exit(1);
      }
      return argv[++i];
    };
    if (arg == "--seed") args->seed = static_cast<uint32_t>(std::stoul(need("--seed")));
    else if (arg == "--count") args->count = std::stoi(need("--count"));
    else if (arg == "--pool-size") args->poolSize = std::stoi(need("--pool-size"));
    else if (arg == "--difficulty") args->difficulty = std::stoi(need("--difficulty"));
    else if (arg == "--population") args->population = std::stoi(need("--population"));
    else if (arg == "--generations") args->generations = std::stoi(need("--generations"));
    else if (arg == "--threads") args->threads = std::stoi(need("--threads"));
    else if (arg == "--objective") {
      if (!parseObjective(need("--objective"), &args->objective)) {
        std::cerr << "Unknown objective (use max or avg)\n";
        return false;
      }
    }
    else if (arg == "--mutation-rate") args->mutationRate = std::stod(need("--mutation-rate"));
    else if (arg == "--macro-mutation") args->macroMutationRate = std::stod(need("--macro-mutation"));
    else if (arg == "--stagnation") args->stagnationGens = std::stoi(need("--stagnation"));
    else if (arg == "--radical-stagnation") args->radicalStagnationGens = std::stoi(need("--radical-stagnation"));
    else if (arg == "--radical-period") args->radicalReseedPeriod = std::stoi(need("--radical-period"));
    else if (arg == "--tournament") args->tournamentSize = std::stoi(need("--tournament"));
    else if (arg == "--elite") args->eliteCount = std::stoi(need("--elite"));
    else if (arg == "--write-benchmark") args->writeBenchmark = true;
    else if (arg == "--help" || arg == "-h") {
      printHelp();
      return false;
    } else {
      std::cerr << "Unknown argument: " << arg << "\n";
      return false;
    }
  }
  return true;
}

std::string formatDuration(int64_t ms) {
  const int64_t sec = ms / 1000;
  const int64_t m = sec / 60;
  const int64_t s = sec % 60;
  if (m > 0) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%lldm%02llds", static_cast<long long>(m), static_cast<long long>(s));
    return buf;
  }
  char buf[16];
  std::snprintf(buf, sizeof(buf), "%llds", static_cast<long long>(s));
  return buf;
}

std::string formatScore(const koth::EvalScore& score, koth::FitnessObjective objective) {
  if (score.unsolved > 0) return "FAIL " + std::to_string(score.unsolved) + " unsolved";
  char buf[128];
  if (objective == koth::FitnessObjective::Max) {
    std::snprintf(buf, sizeof(buf), "max %d avg %.2f total %lld min %d", score.maxGuesses, score.avgGuesses,
                  static_cast<long long>(score.totalGuesses), score.minGuesses);
  } else {
    std::snprintf(buf, sizeof(buf), "avg %.2f max %d total %lld min %d", score.avgGuesses, score.maxGuesses,
                  static_cast<long long>(score.totalGuesses), score.minGuesses);
  }
  return buf;
}

struct ScoredIndividual {
  koth::ImprovedConfig cfg;
  koth::EvalScore score;
};

struct SaveContext {
  std::string jsonPath;
  koth::FitnessObjective objective = koth::FitnessObjective::Max;
  koth::TuneBenchmarkMeta benchmark{};
  const std::vector<koth::Assignment>* assignments = nullptr;
  int64_t runStartFitness = 0;
  int64_t savedFitness = std::numeric_limits<int64_t>::max();
  std::mutex mu;
};

class RateLimitedPrinter {
 public:
  explicit RateLimitedPrinter(std::chrono::milliseconds interval = std::chrono::milliseconds(1000))
      : interval_(interval) {}

  void println(const std::string& line) {
    std::lock_guard<std::mutex> lock(mu_);
    pending_ = line;
    maybeFlushLocked(std::chrono::steady_clock::now());
  }

  void printNow(const std::string& line) {
    std::lock_guard<std::mutex> lock(mu_);
    pending_.clear();
    std::cout << line << '\n' << std::flush;
    lastPrint_ = std::chrono::steady_clock::now();
  }

  void flush() {
    std::lock_guard<std::mutex> lock(mu_);
    if (!pending_.empty()) {
      std::cout << pending_ << '\n' << std::flush;
      pending_.clear();
      lastPrint_ = std::chrono::steady_clock::now();
    }
  }

 private:
  void maybeFlushLocked(std::chrono::steady_clock::time_point now) {
    if (pending_.empty()) return;
    if (lastPrint_.time_since_epoch().count() != 0 && now - lastPrint_ < interval_) return;
    std::cout << pending_ << '\n' << std::flush;
    pending_.clear();
    lastPrint_ = now;
  }

  std::mutex mu_;
  std::chrono::milliseconds interval_;
  std::chrono::steady_clock::time_point lastPrint_{};
  std::string pending_;
};

void trySaveBest(SaveContext& saveCtx, const koth::EvalScore& best) {
  if (best.fitness >= saveCtx.runStartFitness) return;
  std::lock_guard<std::mutex> lock(saveCtx.mu);
  if (best.fitness >= saveCtx.savedFitness) return;
  if (saveCtx.assignments == nullptr) return;
  koth::saveBestJson(saveCtx.jsonPath, best.config, best, saveCtx.objective, saveCtx.benchmark, *saveCtx.assignments);
  saveCtx.savedFitness = best.fitness;
}

void evaluatePopulationParallel(const std::vector<koth::Assignment>& assignments,
                                const std::vector<koth::ImprovedConfig>& population, std::vector<koth::EvalScore>& scores,
                                int threads, std::atomic<int64_t>& evaluations, koth::EvalScore& globalBest,
                                std::mutex& bestMu, SaveContext& saveCtx, RateLimitedPrinter& progress, int generation,
                                koth::FitnessObjective objective) {
  const int workerCount = std::max(1, threads);
  const size_t popSize = population.size();
  std::atomic<size_t> next{0};
  std::atomic<size_t> completed{0};
  std::vector<std::thread> workers;
  workers.reserve(static_cast<size_t>(workerCount));

  progress.printNow("gen " + std::to_string(generation) + " evaluating " + std::to_string(popSize) +
                    " individuals (" + std::to_string(assignments.size()) + " assignments each)...");

  for (int t = 0; t < workerCount; ++t) {
    workers.emplace_back([&]() {
      while (!g_stop.load()) {
        const size_t i = next.fetch_add(1);
        if (i >= popSize) break;
        koth::EvalScore score = koth::evaluateImprovedConfig(assignments, population[i], objective);
        scores[i] = score;
        evaluations.fetch_add(1);
        const size_t done = completed.fetch_add(1) + 1;

        progress.println("gen " + std::to_string(generation) + " evaluating " + std::to_string(done) + "/" +
                         std::to_string(popSize) + " | total evals " + std::to_string(evaluations.load()));

        std::lock_guard<std::mutex> lock(bestMu);
        if (score.fitness < globalBest.fitness) {
          globalBest = score;
          trySaveBest(saveCtx, globalBest);
          progress.printNow("  [gen " + std::to_string(generation) + " " + std::to_string(i + 1) + "/" +
                            std::to_string(popSize) + "] NEW BEST: " + formatScore(score, objective));
        }
      }
    });
  }
  for (auto& w : workers) w.join();
}

ScoredIndividual tournamentSelect(const std::vector<ScoredIndividual>& scored, int tournamentSize, std::mt19937& rng) {
  std::uniform_int_distribution<size_t> dist(0, scored.size() - 1);
  ScoredIndividual best = scored[dist(rng)];
  for (int i = 1; i < tournamentSize; ++i) {
    const ScoredIndividual& pick = scored[dist(rng)];
    if (pick.score.fitness < best.score.fitness) best = pick;
  }
  return best;
}

std::vector<koth::ImprovedConfig> buildInitialPopulation(int population, const koth::ImprovedConfig* loaded,
                                                         std::mt19937& rng) {
  std::vector<koth::ImprovedConfig> pop;
  pop.push_back(koth::normalizeImprovedConfig(koth::defaultImprovedConfig()));
  if (loaded) pop.push_back(koth::normalizeImprovedConfig(*loaded));
  const koth::ImprovedConfig& seedCfg = loaded ? *loaded : koth::defaultImprovedConfig();
  const int randomSlots = std::max(1, population / 8);
  int randomAdded = 0;
  while (static_cast<int>(pop.size()) < population) {
    if (randomAdded < randomSlots) {
      pop.push_back(koth::randomIndividual(rng));
      ++randomAdded;
    } else {
      pop.push_back(koth::mutateConfig(seedCfg, 0.35, 0.08, rng));
    }
  }
  pop.resize(static_cast<size_t>(population));
  return pop;
}

struct HofEntry {
  koth::ImprovedConfig cfg;
  int64_t fitness = 0;
};

struct ExplorationParams {
  int tier = 0;
  bool stagnant = false;
  bool restartPulse = false;
  double effectiveMutation = 0.0;
  double effectiveMacro = 0.0;
  double scatterGeneFraction = 0.0;
  int immigrantCount = 0;
  int championCount = 0;
  int scatterCount = 0;
  int hallOfFameCount = 0;
  int hofCrossCount = 0;
  int eliteCount = 0;
  double randomParentProb = 0.0;
  double bestRandomCrossProb = 0.0;
  int restartPulseRandom = 0;
  bool radicalReseed = false;
};

ExplorationParams computeExploration(int stagnationCount, const Args& args) {
  ExplorationParams p;
  const int u = args.stagnationGens;
  if (stagnationCount >= u * 8) {
    p.tier = 4;
  } else if (stagnationCount >= u * 4) {
    p.tier = 3;
  } else if (stagnationCount >= u * 2) {
    p.tier = 2;
  } else if (stagnationCount >= u) {
    p.tier = 1;
  }
  p.stagnant = p.tier >= 1;
  p.restartPulse = p.tier >= 3 && stagnationCount > 0 && stagnationCount % (u * 2) == 0;
  p.effectiveMutation = std::min(0.55, args.mutationRate + p.tier * 0.12);
  p.effectiveMacro = std::min(0.35, args.macroMutationRate + p.tier * 0.08);
  p.scatterGeneFraction = std::min(0.65, 0.2 + p.tier * 0.1);
  const double immigrantFrac =
      p.tier == 0 ? args.immigrantFraction
                  : std::min(0.65, args.stagnationImmigrantFraction + static_cast<double>(p.tier - 1) * 0.08);
  p.immigrantCount = std::max(1, static_cast<int>(args.population * immigrantFrac));
  p.championCount = p.tier >= 1 ? 2 + p.tier * 2 : 0;
  p.scatterCount = p.tier >= 2 ? p.tier : 0;
  p.hallOfFameCount = std::min(p.tier, 4);
  p.hofCrossCount = p.tier >= 4 ? 2 : 0;
  p.eliteCount = p.tier >= 3 ? 1 : args.eliteCount;
  p.randomParentProb = p.tier * 0.18;
  p.bestRandomCrossProb = p.tier >= 3 ? 0.35 : p.tier >= 2 ? 0.2 : p.tier >= 1 ? 0.1 : 0.0;
  p.restartPulseRandom = p.restartPulse ? std::max(2, args.population / 3) : 0;

  const int pop = args.population;
  p.hallOfFameCount = std::min(p.hallOfFameCount, std::max(0, pop / 7));
  p.eliteCount = std::min(p.eliteCount, std::max(1, pop / 10));
  p.championCount = std::min(p.championCount, std::max(0, pop / 5));
  p.scatterCount = std::min(p.scatterCount, std::max(0, pop / 6));
  p.hofCrossCount = std::min(p.hofCrossCount, std::max(0, pop / 10));
  p.immigrantCount = std::min(p.immigrantCount, std::max(1, pop / 3));
  p.restartPulseRandom = std::min(p.restartPulseRandom, std::max(0, pop / 4));

  if (stagnationCount >= args.radicalStagnationGens && args.radicalReseedPeriod > 0 &&
      (stagnationCount - args.radicalStagnationGens) % args.radicalReseedPeriod == 0) {
    p.radicalReseed = true;
  }
  return p;
}

void updateHallOfFame(std::vector<HofEntry>& hof, const koth::EvalScore& score, int maxSize) {
  if (score.unsolved > 0) return;
  for (const HofEntry& entry : hof) {
    if (entry.fitness == score.fitness) return;
  }
  hof.push_back({score.config, score.fitness});
  std::sort(hof.begin(), hof.end(), [](const HofEntry& a, const HofEntry& b) { return a.fitness < b.fitness; });
  if (static_cast<int>(hof.size()) > maxSize) hof.resize(static_cast<size_t>(maxSize));
}

ScoredIndividual selectParent(const std::vector<ScoredIndividual>& scored, int tournamentSize, double randomProb,
                              std::mt19937& rng) {
  std::uniform_real_distribution<double> dist(0.0, 1.0);
  if (dist(rng) < randomProb) {
    std::uniform_int_distribution<size_t> pick(0, scored.size() - 1);
    return scored[pick(rng)];
  }
  return tournamentSelect(scored, tournamentSize, rng);
}

std::string formatExploration(const ExplorationParams& explore) {
  if (explore.tier == 0 && !explore.radicalReseed) return "";
  std::string msg;
  if (explore.tier > 0) msg = " tier " + std::to_string(explore.tier);
  if (explore.restartPulse) msg += " restart-pulse";
  if (explore.radicalReseed) msg += " radical-reseed";
  return msg;
}

std::vector<koth::ImprovedConfig> buildRadicalPopulation(int population, std::mt19937& rng) {
  std::vector<koth::ImprovedConfig> pop;
  pop.reserve(static_cast<size_t>(population));
  while (static_cast<int>(pop.size()) < population) {
    pop.push_back(koth::randomIndividual(rng));
  }
  return pop;
}

struct RankedAssignment {
  size_t poolIndex = 0;
  int guesses = 0;
  bool solved = false;
};

bool assignmentHarder(const RankedAssignment& a, const RankedAssignment& b) {
  if (a.solved != b.solved) return !a.solved;
  if (a.guesses != b.guesses) return a.guesses > b.guesses;
  return a.poolIndex < b.poolIndex;
}

std::vector<koth::Assignment> selectWorstAssignments(const std::vector<koth::Assignment>& pool,
                                                     const koth::ImprovedConfig& cfg, int selectCount, int threads,
                                                     RateLimitedPrinter& progress) {
  const size_t poolSize = pool.size();
  const int workerCount = std::max(1, threads);
  const koth::ImprovedConfig normalized = koth::normalizeImprovedConfig(cfg);
  std::vector<RankedAssignment> ranked(poolSize);
  std::atomic<size_t> next{0};
  std::atomic<size_t> completed{0};

  progress.printNow("Scanning " + std::to_string(poolSize) + " assignments with current config (" +
                    std::to_string(workerCount) + " threads)...");

  std::vector<std::thread> workers;
  workers.reserve(static_cast<size_t>(workerCount));
  for (int t = 0; t < workerCount; ++t) {
    workers.emplace_back([&]() {
      while (!g_stop.load()) {
        const size_t i = next.fetch_add(1);
        if (i >= poolSize) break;
        const koth::SolverResult result = koth::runSolverImproved(pool[i], normalized);
        ranked[i] = {i, result.guesses, result.solved};
        const size_t done = completed.fetch_add(1) + 1;
        if (done % 500 == 0 || done == poolSize) {
          progress.println("scan " + std::to_string(done) + "/" + std::to_string(poolSize));
        }
      }
    });
  }
  for (auto& w : workers) w.join();
  progress.flush();

  std::sort(ranked.begin(), ranked.end(), assignmentHarder);

  const int take = std::max(1, std::min(selectCount, static_cast<int>(poolSize)));
  std::vector<koth::Assignment> selected;
  selected.reserve(static_cast<size_t>(take));

  int unsolved = 0;
  int minGuesses = std::numeric_limits<int>::max();
  int maxGuesses = 0;
  for (int i = 0; i < take; ++i) {
    const RankedAssignment& row = ranked[static_cast<size_t>(i)];
    selected.push_back(pool[row.poolIndex]);
    if (!row.solved) ++unsolved;
    else {
      minGuesses = std::min(minGuesses, row.guesses);
      maxGuesses = std::max(maxGuesses, row.guesses);
    }
  }

  std::cout << "Selected worst " << take << " / " << poolSize << " assignments";
  if (unsolved > 0) {
    std::cout << " (" << unsolved << " unsolved in selection)";
  } else {
    std::cout << " (guesses " << minGuesses << "-" << maxGuesses << ")";
  }
  std::cout << ". Cutoff assignment #" << (ranked[static_cast<size_t>(take - 1)].poolIndex + 1) << " had "
            << (ranked[static_cast<size_t>(take - 1)].solved
                    ? std::to_string(ranked[static_cast<size_t>(take - 1)].guesses) + " guesses"
                    : "FAILED")
            << ".\n";

  return selected;
}

}  // namespace

int main(int argc, char** argv) {
  Args args;
  if (!parseArgs(argc, argv, &args)) return args.generations == -1 && argc > 1 ? 1 : 0;

  if (args.threads <= 0) {
    const unsigned hw = std::thread::hardware_concurrency();
    args.threads = hw == 0 ? 4 : static_cast<int>(hw);
  }
  if (args.count < 1) {
    std::cerr << "--count must be >= 1\n";
    return 1;
  }
  const int poolSize = args.poolSize > 0 ? args.poolSize : args.count;
  if (poolSize < args.count) {
    std::cerr << "--pool-size must be >= --count\n";
    return 1;
  }

  const std::string jsonPath = koth::tunedConfigJsonPath(args.objective);

  std::signal(SIGINT, onSignal);
#ifdef SIGTERM
  std::signal(SIGTERM, onSignal);
#endif

  const auto pool = koth::generateAssignments(args.seed, poolSize, args.difficulty);

  koth::ImprovedConfig loadedCfg;
  const koth::ImprovedConfig* loadedPtr = nullptr;
  if (koth::loadConfigFromJsonFile(jsonPath, &loadedCfg)) {
    loadedPtr = &loadedCfg;
    std::cout << "Loaded seed config from " << jsonPath << "\n";
  } else {
    std::cerr << "Warning: could not load " << jsonPath << "\n";
  }

  const koth::ImprovedConfig scanCfg = loadedPtr ? *loadedPtr : koth::defaultImprovedConfig();
  RateLimitedPrinter progress;

  std::vector<koth::Assignment> assignments;
  if (poolSize > args.count) {
    assignments = selectWorstAssignments(pool, scanCfg, args.count, args.threads, progress);
  } else {
    assignments = pool;
  }

  std::mt19937 rng(static_cast<uint32_t>(args.seed ^ 0x9e3779b9u));

  std::cout << "=== KingOfTheHill improved solver tuner (C++) ===\n";
  std::cout << "ga-assignments=" << assignments.size() << " pool=" << poolSize << " seed=" << args.seed
            << " difficulty=" << args.difficulty << " population=" << args.population << " threads=" << args.threads
            << " objective=" << koth::fitnessObjectiveLabel(args.objective) << "\n";
  std::cout << "json=" << jsonPath << " (written only on improvement)\nCtrl+C exits.\n\n";

  const auto started = std::chrono::steady_clock::now();
  std::atomic<int64_t> evaluations{0};
  std::vector<HofEntry> hallOfFame;
  koth::EvalScore globalBest = koth::evaluateImprovedConfig(assignments, koth::defaultImprovedConfig(), args.objective);
  evaluations.store(1);
  updateHallOfFame(hallOfFame, globalBest, 8);
  std::cout << "baseline (defaults): " << formatScore(globalBest, args.objective) << "\n";

  if (loadedPtr) {
    const koth::EvalScore loadedScore = koth::evaluateImprovedConfig(assignments, *loadedPtr, args.objective);
    evaluations.fetch_add(1);
    std::cout << "loaded config: " << formatScore(loadedScore, args.objective) << "\n";
    if (loadedScore.fitness < globalBest.fitness) globalBest = loadedScore;
    updateHallOfFame(hallOfFame, loadedScore, 8);
  }

  if (args.writeBenchmark) {
    if (!loadedPtr) {
      std::cerr << "--write-benchmark requires an existing config in " << jsonPath << "\n";
      return 1;
    }
    koth::TuneBenchmarkMeta benchmark{};
    benchmark.seed = args.seed;
    benchmark.difficulty = args.difficulty;
    benchmark.poolSize = poolSize;
    benchmark.count = args.count;
    benchmark.selection = poolSize > args.count ? "worst" : "sequential";
    const koth::EvalScore score = koth::evaluateImprovedConfig(assignments, *loadedPtr, args.objective);
    koth::saveBestJson(jsonPath, *loadedPtr, score, args.objective, benchmark, assignments);
    std::cout << "\nWrote " << jsonPath << " with benchmark (" << assignments.size() << " assignments)\n";
    std::cout << formatScore(score, args.objective) << "\n";
    return 0;
  }

  std::cout << "\n";
  std::cout << "Starting genetic search...\n" << std::flush;

  std::vector<koth::ImprovedConfig> population = buildInitialPopulation(args.population, loadedPtr, rng);
  std::mutex bestMu;
  int generation = 0;
  int stagnationCount = 0;
  int64_t lastGlobalBestFitness = globalBest.fitness;
  SaveContext saveCtx;
  saveCtx.jsonPath = jsonPath;
  saveCtx.objective = args.objective;
  saveCtx.runStartFitness = globalBest.fitness;
  saveCtx.benchmark.seed = args.seed;
  saveCtx.benchmark.difficulty = args.difficulty;
  saveCtx.benchmark.poolSize = poolSize;
  saveCtx.benchmark.count = args.count;
  saveCtx.benchmark.selection = poolSize > args.count ? "worst" : "sequential";
  saveCtx.assignments = &assignments;

  while (!g_stop.load() && (args.generations < 0 || generation < args.generations)) {
    ++generation;
    std::vector<koth::EvalScore> scores(population.size());
    evaluatePopulationParallel(assignments, population, scores, args.threads, evaluations, globalBest, bestMu, saveCtx,
                               progress, generation, args.objective);

    if (g_stop.load()) break;

    std::vector<ScoredIndividual> scored;
    scored.reserve(population.size());
    for (size_t i = 0; i < population.size(); ++i) {
      scored.push_back({population[i], scores[i]});
    }
    std::sort(scored.begin(), scored.end(),
              [](const ScoredIndividual& a, const ScoredIndividual& b) { return a.score.fitness < b.score.fitness; });

    if (globalBest.fitness < lastGlobalBestFitness) {
      stagnationCount = 0;
      lastGlobalBestFitness = globalBest.fitness;
      updateHallOfFame(hallOfFame, globalBest, 8);
    } else {
      ++stagnationCount;
    }

    const ExplorationParams explore = computeExploration(stagnationCount, args);

    const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
    std::string line = "gen " + std::to_string(generation) + " | pop best " +
                       formatScore(scored.front().score, args.objective) + " | global best " +
                       formatScore(globalBest, args.objective) + " | evals " + std::to_string(evaluations.load()) +
                       " | " + formatDuration(elapsedMs);
    if (stagnationCount > 0) {
      line += " | stagnation " + std::to_string(stagnationCount) + formatExploration(explore);
    }
    progress.printNow(line);

    if (explore.radicalReseed) {
      population = buildRadicalPopulation(args.population, rng);
      continue;
    }

    std::vector<koth::ImprovedConfig> next;
    next.reserve(population.size());
    next.push_back(koth::mutateConfig(globalBest.config, args.eliteMutationRate, 0.0, rng));
    for (int i = 0; i < explore.hallOfFameCount && i < static_cast<int>(hallOfFame.size()); ++i) {
      next.push_back(koth::mutateConfig(hallOfFame[static_cast<size_t>(i)].cfg, explore.effectiveMutation,
                                        explore.effectiveMacro * 0.5, rng));
    }
    for (int i = 0; i < explore.eliteCount && i + 1 < static_cast<int>(scored.size()); ++i) {
      next.push_back(koth::mutateConfig(scored[static_cast<size_t>(i)].cfg, args.eliteMutationRate, 0.0, rng));
    }
    int championsAdded = 0;
    int scatterAdded = 0;
    int hofCrossAdded = 0;
    int immigrantsAdded = 0;
    int restartAdded = 0;
    std::uniform_real_distribution<double> dist(0.0, 1.0);
    while (static_cast<int>(next.size()) < args.population && !g_stop.load()) {
      if (championsAdded < explore.championCount) {
        next.push_back(koth::mutateConfig(globalBest.config, explore.effectiveMutation, explore.effectiveMacro, rng));
        ++championsAdded;
        continue;
      }
      if (scatterAdded < explore.scatterCount) {
        next.push_back(koth::scatterMutateConfig(globalBest.config, explore.scatterGeneFraction, rng));
        ++scatterAdded;
        continue;
      }
      if (hofCrossAdded < explore.hofCrossCount && !hallOfFame.empty()) {
        const size_t hofIdx = static_cast<size_t>(hofCrossAdded % hallOfFame.size());
        koth::ImprovedConfig child = koth::crossover(globalBest.config, hallOfFame[hofIdx].cfg, rng);
        child = koth::mutateConfig(child, explore.effectiveMutation, explore.effectiveMacro, rng);
        next.push_back(child);
        ++hofCrossAdded;
        continue;
      }
      if (immigrantsAdded < explore.immigrantCount) {
        next.push_back(koth::randomIndividual(rng));
        ++immigrantsAdded;
        continue;
      }
      if (restartAdded < explore.restartPulseRandom) {
        next.push_back(koth::randomIndividual(rng));
        ++restartAdded;
        continue;
      }
      koth::ImprovedConfig child;
      if (dist(rng) < explore.bestRandomCrossProb) {
        child = koth::crossover(globalBest.config, koth::randomIndividual(rng), rng);
      } else {
        const ScoredIndividual p1 = selectParent(scored, args.tournamentSize, explore.randomParentProb, rng);
        const ScoredIndividual p2 = selectParent(scored, args.tournamentSize, explore.randomParentProb, rng);
        child = koth::crossover(p1.cfg, p2.cfg, rng);
      }
      child = koth::mutateConfig(child, explore.effectiveMutation, explore.effectiveMacro, rng);
      next.push_back(child);
    }
    population = std::move(next);
  }

  progress.flush();

  std::cout << "\n";
  if (saveCtx.savedFitness < saveCtx.runStartFitness) {
    std::cout << "Saved best config to " << saveCtx.jsonPath << "\n";
  } else {
    std::cout << "No improvement; " << saveCtx.jsonPath << " unchanged\n";
  }
  std::cout << formatScore(globalBest, args.objective) << "\n";
  return 0;
}
