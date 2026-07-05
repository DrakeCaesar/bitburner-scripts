#include "koth_config.hpp"
#include "koth_game.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <random>
#include <string>
#include <thread>
#include <vector>

namespace {

struct Args {
  uint32_t seed = koth::DEFAULT_SEED;
  int count = koth::DEFAULT_COUNT;
  int difficulty = koth::DEFAULT_DIFFICULTY;
  int population = 20;
  int generations = -1;  // infinite
  double mutationRate = 0.35;
  double macroMutationRate = 0.08;
  int tournamentSize = 3;
  int eliteCount = 2;
  int stagnationGens = 12;
  double immigrantFraction = 0.1;
  double stagnationImmigrantFraction = 0.35;
  double eliteMutationRate = 0.12;
  int threads = 0;  // 0 = hardware_concurrency
  int saveEvery = 1;
  std::string loadPath;
  std::string outPath = "tests/kingOfTheHillTune.best.json";
};

std::atomic<bool> g_stop{false};

void onSignal(int) { g_stop.store(true); }

void printHelp() {
  std::cout
      << "Usage: koth_tune [options]\n\n"
      << "Options:\n"
      << "  --seed N            Assignment seed (default " << koth::DEFAULT_SEED << ")\n"
      << "  --count N           Assignments per evaluation (default 100)\n"
      << "  --difficulty N      Game difficulty (default " << koth::DEFAULT_DIFFICULTY << ")\n"
      << "  --population N      Population size (default 20)\n"
      << "  --generations N     Max generations; omit for infinite\n"
      << "  --threads N         Worker threads (default: CPU cores)\n"
      << "  --mutation-rate F   Per-gene mutation chance (default 0.35)\n"
      << "  --macro-mutation F  Jump-to-random gene chance when mutating (default 0.08)\n"
      << "  --stagnation N      Gens without global best before diversity boost (default 12)\n"
      << "  --tournament N      Tournament selection size (default 3)\n"
      << "  --elite N           Elite individuals per generation (default 2)\n"
      << "  --load PATH         Load seed config JSON\n"
      << "  --out PATH          Output JSON path\n"
      << "  --save-every N      Save checkpoint every N generations (default 1)\n"
      << "  --help              Show this help\n\n"
      << "Ctrl+C saves best config and exits.\n";
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
    else if (arg == "--difficulty") args->difficulty = std::stoi(need("--difficulty"));
    else if (arg == "--population") args->population = std::stoi(need("--population"));
    else if (arg == "--generations") args->generations = std::stoi(need("--generations"));
    else if (arg == "--threads") args->threads = std::stoi(need("--threads"));
    else if (arg == "--mutation-rate") args->mutationRate = std::stod(need("--mutation-rate"));
    else if (arg == "--macro-mutation") args->macroMutationRate = std::stod(need("--macro-mutation"));
    else if (arg == "--stagnation") args->stagnationGens = std::stoi(need("--stagnation"));
    else if (arg == "--tournament") args->tournamentSize = std::stoi(need("--tournament"));
    else if (arg == "--elite") args->eliteCount = std::stoi(need("--elite"));
    else if (arg == "--load") args->loadPath = need("--load");
    else if (arg == "--out") args->outPath = need("--out");
    else if (arg == "--save-every") args->saveEvery = std::stoi(need("--save-every"));
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

std::string formatScore(const koth::EvalScore& score) {
  if (score.unsolved > 0) return "FAIL " + std::to_string(score.unsolved) + " unsolved";
  char buf[128];
  std::snprintf(buf, sizeof(buf), "avg %.2f total %lld min %d max %d", score.avgGuesses,
                static_cast<long long>(score.totalGuesses), score.minGuesses, score.maxGuesses);
  return buf;
}

struct ScoredIndividual {
  koth::ImprovedConfig cfg;
  koth::EvalScore score;
};

void evaluatePopulationParallel(const std::vector<koth::Assignment>& assignments,
                                const std::vector<koth::ImprovedConfig>& population, std::vector<koth::EvalScore>& scores,
                                int threads, std::atomic<int64_t>& evaluations, koth::EvalScore& globalBest,
                                std::mutex& bestMu, int generation) {
  const int workerCount = std::max(1, threads);
  std::atomic<size_t> next{0};
  std::vector<std::thread> workers;
  workers.reserve(static_cast<size_t>(workerCount));

  for (int t = 0; t < workerCount; ++t) {
    workers.emplace_back([&]() {
      while (!g_stop.load()) {
        const size_t i = next.fetch_add(1);
        if (i >= population.size()) break;
        koth::EvalScore score = koth::evaluateImprovedConfig(assignments, population[i]);
        scores[i] = score;
        evaluations.fetch_add(1);

        std::lock_guard<std::mutex> lock(bestMu);
        if (score.fitness < globalBest.fitness) {
          globalBest = score;
          std::cout << "  [gen " << generation << " " << (i + 1) << "/" << population.size()
                    << "] NEW BEST: " << formatScore(score) << "\n";
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
  while (static_cast<int>(pop.size()) < population) pop.push_back(koth::randomIndividual(rng));
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
  if (explore.tier == 0) return "";
  std::string msg = " tier " + std::to_string(explore.tier);
  if (explore.restartPulse) msg += " restart-pulse";
  return msg;
}

}  // namespace

int main(int argc, char** argv) {
  Args args;
  if (!parseArgs(argc, argv, &args)) return args.generations == -1 && argc > 1 ? 1 : 0;

  if (args.threads <= 0) {
    const unsigned hw = std::thread::hardware_concurrency();
    args.threads = hw == 0 ? 4 : static_cast<int>(hw);
  }

  std::signal(SIGINT, onSignal);
#ifdef SIGTERM
  std::signal(SIGTERM, onSignal);
#endif

  const auto assignments = koth::generateAssignments(args.seed, args.count, args.difficulty);

  koth::ImprovedConfig loadedCfg;
  const koth::ImprovedConfig* loadedPtr = nullptr;
  if (!args.loadPath.empty()) {
    if (koth::loadConfigFromJsonFile(args.loadPath, &loadedCfg)) {
      loadedPtr = &loadedCfg;
      std::cout << "Loaded seed config from " << args.loadPath << "\n";
    } else {
      std::cerr << "Warning: could not load " << args.loadPath << "\n";
    }
  }

  std::mt19937 rng(static_cast<uint32_t>(args.seed ^ 0x9e3779b9u));

  std::cout << "=== KingOfTheHill improved solver tuner (C++) ===\n";
  std::cout << "assignments=" << args.count << " seed=" << args.seed << " difficulty=" << args.difficulty
            << " population=" << args.population << " threads=" << args.threads << "\n";
  std::cout << "out=" << args.outPath << "\nCtrl+C saves best config and exits.\n\n";

  const auto started = std::chrono::steady_clock::now();
  std::atomic<int64_t> evaluations{0};
  std::vector<HofEntry> hallOfFame;
  koth::EvalScore globalBest = koth::evaluateImprovedConfig(assignments, koth::defaultImprovedConfig());
  evaluations.store(1);
  updateHallOfFame(hallOfFame, globalBest, 8);
  std::cout << "baseline (defaults): " << formatScore(globalBest) << "\n";

  if (loadedPtr) {
    const koth::EvalScore loadedScore = koth::evaluateImprovedConfig(assignments, *loadedPtr);
    evaluations.fetch_add(1);
    std::cout << "loaded config: " << formatScore(loadedScore) << "\n";
    if (loadedScore.fitness < globalBest.fitness) globalBest = loadedScore;
    updateHallOfFame(hallOfFame, loadedScore, 8);
  }
  std::cout << "\n";

  std::vector<koth::ImprovedConfig> population = buildInitialPopulation(args.population, loadedPtr, rng);
  std::mutex bestMu;
  int generation = 0;
  int stagnationCount = 0;
  int64_t lastGlobalBestFitness = globalBest.fitness;

  while (!g_stop.load() && (args.generations < 0 || generation < args.generations)) {
    ++generation;
    std::vector<koth::EvalScore> scores(population.size());
    evaluatePopulationParallel(assignments, population, scores, args.threads, evaluations, globalBest, bestMu, generation);

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
    std::cout << "gen " << generation << " | pop best " << formatScore(scored.front().score) << " | global best "
              << formatScore(globalBest) << " | evals " << evaluations.load() << " | "
              << formatDuration(elapsedMs);
    if (stagnationCount > 0) {
      std::cout << " | stagnation " << stagnationCount << formatExploration(explore);
    }
    std::cout << "\n";

    if (args.saveEvery > 0 && generation % args.saveEvery == 0) {
      koth::saveBestJson(args.outPath, globalBest.config, globalBest, generation, args.seed, args.count, args.difficulty,
                         evaluations.load(), elapsedMs, "checkpoint");
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

  const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
  koth::saveBestJson(args.outPath, globalBest.config, globalBest, generation, args.seed, args.count, args.difficulty,
                     evaluations.load(), elapsedMs, g_stop.load() ? "interrupt" : "complete");

  std::cout << "\nSaved best config to " << args.outPath << "\n";
  std::cout << formatScore(globalBest) << "\n";
  return 0;
}
