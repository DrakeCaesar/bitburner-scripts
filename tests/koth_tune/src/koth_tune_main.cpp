#include "koth_config.hpp"
#include "koth_game.hpp"

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
  int tournamentSize = 3;
  int eliteCount = 2;
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
  koth::EvalScore globalBest = koth::evaluateImprovedConfig(assignments, koth::defaultImprovedConfig());
  evaluations.store(1);
  std::cout << "baseline (defaults): " << formatScore(globalBest) << "\n";

  if (loadedPtr) {
    const koth::EvalScore loadedScore = koth::evaluateImprovedConfig(assignments, *loadedPtr);
    evaluations.fetch_add(1);
    std::cout << "loaded config: " << formatScore(loadedScore) << "\n";
    if (loadedScore.fitness < globalBest.fitness) globalBest = loadedScore;
  }
  std::cout << "\n";

  std::vector<koth::ImprovedConfig> population = buildInitialPopulation(args.population, loadedPtr, rng);
  std::mutex bestMu;
  int generation = 0;

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

    const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
    std::cout << "gen " << generation << " | pop best " << formatScore(scored.front().score) << " | global best "
              << formatScore(globalBest) << " | evals " << evaluations.load() << " | "
              << formatDuration(elapsedMs) << "\n";

    if (args.saveEvery > 0 && generation % args.saveEvery == 0) {
      koth::saveBestJson(args.outPath, globalBest.config, globalBest, generation, args.seed, args.count, args.difficulty,
                         evaluations.load(), elapsedMs, "checkpoint");
    }

    std::vector<koth::ImprovedConfig> next;
    next.reserve(population.size());
    for (int i = 0; i < args.eliteCount && i < static_cast<int>(scored.size()); ++i) {
      next.push_back(scored[static_cast<size_t>(i)].cfg);
    }
    while (static_cast<int>(next.size()) < args.population && !g_stop.load()) {
      const ScoredIndividual p1 = tournamentSelect(scored, args.tournamentSize, rng);
      const ScoredIndividual p2 = tournamentSelect(scored, args.tournamentSize, rng);
      koth::ImprovedConfig child = koth::crossover(p1.cfg, p2.cfg, rng);
      child = koth::mutateConfig(child, args.mutationRate, rng);
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
