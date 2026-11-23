#include "koth_config.hpp"
#include "koth_game.hpp"
#include "koth_tuning.hpp"

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <random>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr int kStatusEveryGenerations = 25;

struct Args {
  uint32_t seed = koth::DEFAULT_SEED;
  int count = koth::DEFAULT_COUNT;
  int difficulty = 60;
  int population = 24;
  int generations = 0;  // 0 = run until Ctrl+C
  double mutationRate = 0.35;
  int tournamentSize = 3;
  int eliteCount = 2;
  int threads = 0;
  double maxPenalty = 5.0;
  double tailPenalty = 0.0;
  int cap = 600;
  // Annealing: the mutation step starts at sigma0 of each gene's range and decays by 1/e every
  // annealGenerations, but never below sigmaMin. A fixed step (the old behaviour) keeps jumping the
  // whole range, so a population that finds a good basin can never settle inside it.
  double sigma0 = 0.12;
  double sigmaMin = 0.004;
  double annealGenerations = 60.0;
  // Start from mutations of the loaded genome instead of uniform genomes: 22 dimensions of uniform
  // noise are hopeless, and the loaded genome is usually already better than anything the GA can
  // reach from scratch in a few hundred generations.
  bool seedAroundLoad = true;
  // Pattern-search pass over the final best (each round halves the step).
  int refineRounds = 4;
  double refineSigma = 0.03;
  std::string loadPath;
  std::string outPath = koth::defaultTunedJsonPath();
};

std::atomic<bool> gStop{false};

void onSignal(int) { gStop.store(true); }

void printHelp() {
  std::cout
      << "Usage: koth_tune [options]\n\n"
      << "Genetic search for ladder_snipe heuristic constants at a fixed difficulty.\n"
      << "Stop anytime with Ctrl+C; best config is written to --out.\n\n"
      << "Options:\n"
      << "  --seed N           Assignment seed (default " << koth::DEFAULT_SEED << ")\n"
      << "  --count N          Assignments per fitness eval (default " << koth::DEFAULT_COUNT << ")\n"
      << "  --difficulty N     Target difficulty (default 60)\n"
      << "  --population N     GA population size (default 24)\n"
      << "  --generations N    Stop after N generations (0 = infinite)\n"
      << "  --mutation F       Per-gene mutation rate (default 0.35)\n"
      << "  --tournament N     Tournament size (default 3)\n"
      << "  --elite N          Elites copied each generation (default 2)\n"
      << "  --threads N        Worker threads (0 = hardware concurrency)\n"
      << "  --max-penalty F    Fitness += F * maxGuesses (default 5)\n"
      << "  --tail-penalty F   Fitness += F * sum(max(0, guesses - 12)) (default 0)\n"
      << "  --cap N            Probe cap per assignment (default 600)\n"
      << "  --sigma0 F         Initial mutation step, as a fraction of each gene's range (default 0.12)\n"
      << "  --sigma-min F      Smallest mutation step (default 0.004)\n"
      << "  --anneal N         Generations for the step to decay by 1/e (default 60)\n"
      << "  --no-seed-around   Start from uniform random genomes even when --load is given\n"
      << "  --refine N         Pattern-search rounds over the final best (default 4, 0 = off)\n"
      << "  --refine-sigma F   First pattern-search step (default 0.03)\n"
      << "  --load PATH        Seed population from JSON\n"
      << "  --out PATH         Output JSON (default " << koth::defaultTunedJsonPath() << ")\n";
}

bool parseInt(const char* s, int* out) {
  try {
    *out = std::stoi(s);
    return true;
  } catch (...) {
    return false;
  }
}

bool parseDouble(const char* s, double* out) {
  try {
    *out = std::stod(s);
    return true;
  } catch (...) {
    return false;
  }
}

bool parseArgs(int argc, char** argv, Args* args) {
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    auto need = [&](const char* name) -> const char* {
      if (i + 1 >= argc) {
        std::cerr << "Missing value for " << name << "\n";
        std::exit(2);
      }
      return argv[++i];
    };
    if (arg == "--help" || arg == "-h") {
      printHelp();
      std::exit(0);
    } else if (arg == "--seed") {
      args->seed = static_cast<uint32_t>(std::stoul(need("--seed")));
    } else if (arg == "--count") {
      parseInt(need("--count"), &args->count);
    } else if (arg == "--difficulty") {
      parseInt(need("--difficulty"), &args->difficulty);
    } else if (arg == "--population") {
      parseInt(need("--population"), &args->population);
    } else if (arg == "--generations") {
      parseInt(need("--generations"), &args->generations);
    } else if (arg == "--mutation") {
      parseDouble(need("--mutation"), &args->mutationRate);
    } else if (arg == "--tournament") {
      parseInt(need("--tournament"), &args->tournamentSize);
    } else if (arg == "--elite") {
      parseInt(need("--elite"), &args->eliteCount);
    } else if (arg == "--threads") {
      parseInt(need("--threads"), &args->threads);
    } else if (arg == "--max-penalty") {
      parseDouble(need("--max-penalty"), &args->maxPenalty);
    } else if (arg == "--tail-penalty") {
      parseDouble(need("--tail-penalty"), &args->tailPenalty);
    } else if (arg == "--cap") {
      parseInt(need("--cap"), &args->cap);
    } else if (arg == "--sigma0") {
      parseDouble(need("--sigma0"), &args->sigma0);
    } else if (arg == "--sigma-min") {
      parseDouble(need("--sigma-min"), &args->sigmaMin);
    } else if (arg == "--anneal") {
      parseDouble(need("--anneal"), &args->annealGenerations);
    } else if (arg == "--no-seed-around") {
      args->seedAroundLoad = false;
    } else if (arg == "--refine") {
      parseInt(need("--refine"), &args->refineRounds);
    } else if (arg == "--refine-sigma") {
      parseDouble(need("--refine-sigma"), &args->refineSigma);
    } else if (arg == "--load") {
      args->loadPath = need("--load");
    } else if (arg == "--out") {
      args->outPath = need("--out");
    } else {
      std::cerr << "Unknown option: " << arg << "\n";
      return false;
    }
  }
  return true;
}

struct Individual {
  koth::LadderSnipeGenome genome{};
  koth::TuneEvalResult eval{};
};

void saveBest(const Args& args, const Individual& best) {
  std::ofstream out(args.outPath, std::ios::trunc);
  if (!out) {
    std::cerr << "Failed to write " << args.outPath << "\n";
    return;
  }
  out << koth::tuningToJson(koth::tuningFromGenome(best.genome), &best.eval);
  std::cout << "  >> saved " << args.outPath << "  fitness=" << std::fixed << std::setprecision(1)
            << best.eval.fitness << " avg=" << std::setprecision(2) << best.eval.avgGuesses
            << " max=" << best.eval.maxGuesses << "\n";
}

void printProgress(int generation, const Individual& best, const Individual& median,
                   std::chrono::steady_clock::duration elapsed) {
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count();
  std::cout << "gen " << std::setw(4) << generation << "  best fitness=" << std::fixed << std::setprecision(1)
            << best.eval.fitness << " avg=" << std::setprecision(2) << best.eval.avgGuesses
            << " max=" << best.eval.maxGuesses << "  med avg=" << std::setprecision(2) << median.eval.avgGuesses
            << "  unsolved=" << best.eval.unsolved << "  " << ms << "ms\n";
}

int tournamentPick(const std::vector<Individual>& pop, std::mt19937& rng, int tournamentSize) {
  std::uniform_int_distribution<int> dist(0, static_cast<int>(pop.size()) - 1);
  int bestIdx = dist(rng);
  double bestFit = pop[static_cast<size_t>(bestIdx)].eval.fitness;
  for (int t = 1; t < tournamentSize; ++t) {
    const int idx = dist(rng);
    if (pop[static_cast<size_t>(idx)].eval.fitness < bestFit) {
      bestIdx = idx;
      bestFit = pop[static_cast<size_t>(idx)].eval.fitness;
    }
  }
  return bestIdx;
}

}  // namespace

int main(int argc, char** argv) {
  Args args;
  if (!parseArgs(argc, argv, &args)) return 2;
  if (args.population < 4) args.population = 4;
  if (args.eliteCount < 1) args.eliteCount = 1;
  if (args.eliteCount >= args.population) args.eliteCount = args.population - 1;
  if (args.threads <= 0) {
    const int hw = static_cast<int>(std::thread::hardware_concurrency());
    args.threads = hw > 0 ? hw : 4;
  }

  std::signal(SIGINT, onSignal);
#ifndef _WIN32
  std::signal(SIGTERM, onSignal);
#endif

  const std::vector<koth::Assignment> assignments =
      koth::generateAssignments(args.seed, args.count, args.difficulty);

  std::cout << "=== King of the Hill ladder_snipe tuner ===\n";
  std::cout << "seed=" << args.seed << "  count=" << args.count << "  difficulty=" << args.difficulty
            << "  population=" << args.population << "  threads=" << args.threads
            << "  maxPenalty=" << args.maxPenalty << "\n";
  std::cout << "Genes: " << koth::LADDER_SNIPE_GENE_COUNT << " heuristic constants (not generator-derived)\n";

  const koth::LadderSnipeTuning baseline = koth::defaultLadderSnipeTuning();
  const koth::TuneEvalResult baselineEval =
      koth::evaluateLadderSnipeTuning(baseline, assignments, args.cap, args.maxPenalty, args.tailPenalty);
  std::cout << "Baseline defaults: fitness=" << baselineEval.fitness << " avg=" << baselineEval.avgGuesses
            << " max=" << baselineEval.maxGuesses << "\n";

  std::mt19937 rng(args.seed ^ 0x9e3779b9u);
  std::vector<Individual> population(static_cast<size_t>(args.population));

  Individual globalBest{};
  globalBest.genome = koth::genomeFromTuning(baseline);
  globalBest.eval = baselineEval;

  koth::LadderSnipeGenome seedGenome{};
  bool haveSeed = false;
  if (!args.loadPath.empty()) {
    koth::LadderSnipeTuning loaded{};
    koth::TuneEvalResult loadedStats{};
    if (koth::tuningFromJsonFile(args.loadPath, &loaded, &loadedStats)) {
      population[0].genome = koth::genomeFromTuning(loaded);
      population[0].eval = koth::evaluateLadderSnipeTuning(loaded, assignments, args.cap, args.maxPenalty, args.tailPenalty);
      globalBest = population[0];
      seedGenome = population[0].genome;
      haveSeed = true;
      std::cout << "Loaded seed from " << args.loadPath << " fitness=" << population[0].eval.fitness
                << " avg=" << population[0].eval.avgGuesses << " max=" << population[0].eval.maxGuesses << "\n";
    } else {
      std::cerr << "Could not load " << args.loadPath << "\n";
    }
  }

  if (haveSeed && args.seedAroundLoad) {
    for (int i = 1; i < args.population; ++i) {
      population[static_cast<size_t>(i)].genome = koth::mutateGenome(seedGenome, rng, 1.0, args.sigma0);
    }
  } else {
    for (int i = haveSeed ? 1 : 0; i < args.population; ++i) {
      population[static_cast<size_t>(i)].genome = koth::randomGenome(rng);
    }
  }

  auto evaluateAll = [&](std::vector<Individual>& pop) -> bool {
    std::atomic<int> next{0};
    std::vector<std::thread> workers;
    workers.reserve(static_cast<size_t>(args.threads));
    for (int t = 0; t < args.threads; ++t) {
      workers.emplace_back([&]() {
        for (;;) {
          const int idx = next.fetch_add(1);
          if (idx >= args.population) break;
          const koth::LadderSnipeTuning tuning = koth::tuningFromGenome(pop[static_cast<size_t>(idx)].genome);
          pop[static_cast<size_t>(idx)].eval =
              koth::evaluateLadderSnipeTuning(tuning, assignments, args.cap, args.maxPenalty, args.tailPenalty);
        }
      });
    }
    for (auto& th : workers) th.join();
    std::sort(pop.begin(), pop.end(),
              [](const Individual& a, const Individual& b) { return a.eval.fitness < b.eval.fitness; });
    if (pop.front().eval.fitness < globalBest.eval.fitness) {
      globalBest = pop.front();
      return true;
    }
    return false;
  };

  const auto t0 = std::chrono::steady_clock::now();
  if (evaluateAll(population)) saveBest(args, globalBest);
  printProgress(0, population.front(), population[population.size() / 2],
                std::chrono::steady_clock::now() - t0);

  auto sigmaAt = [&](int gen) -> double {
    if (args.annealGenerations <= 0.0) return std::max(args.sigmaMin, args.sigma0);
    return std::max(args.sigmaMin, args.sigma0 * std::exp(-static_cast<double>(gen) / args.annealGenerations));
  };

  int generation = 0;
  while (!gStop.load()) {
    ++generation;
    if (args.generations > 0 && generation > args.generations) break;

    const double sigma = sigmaAt(generation);
    std::vector<Individual> nextPop(static_cast<size_t>(args.population));
    for (int i = 0; i < args.eliteCount; ++i) nextPop[static_cast<size_t>(i)] = population[static_cast<size_t>(i)];

    for (int i = args.eliteCount; i < args.population; ++i) {
      const int p1 = tournamentPick(population, rng, args.tournamentSize);
      const int p2 = tournamentPick(population, rng, args.tournamentSize);
      koth::LadderSnipeGenome child =
          koth::crossoverGenomes(population[static_cast<size_t>(p1)].genome,
                                 population[static_cast<size_t>(p2)].genome, rng);
      child = koth::mutateGenome(child, rng, args.mutationRate, sigma);
      nextPop[static_cast<size_t>(i)].genome = child;
    }

    population = std::move(nextPop);
    const bool improved = evaluateAll(population);
    if (improved) {
      saveBest(args, globalBest);
    } else if (generation % kStatusEveryGenerations == 0) {
      printProgress(generation, globalBest, population[population.size() / 2],
                    std::chrono::steady_clock::now() - t0);
      std::cout << "      sigma=" << std::setprecision(4) << sigma << "\n";
    }
  }

  // Pattern search over the final best: one gene at a time, both directions, step halved each
  // round. The annealed GA can only get near the basin; this settles inside it.
  if (args.refineRounds > 0 && !gStop.load()) {
    double sigma = args.refineSigma;
    for (int round = 0; round < args.refineRounds; ++round) {
      std::vector<Individual> candidates;
      candidates.reserve(static_cast<size_t>(2 * koth::LADDER_SNIPE_GENE_COUNT + 1));
      candidates.push_back(globalBest);
      for (size_t g = 0; g < globalBest.genome.size(); ++g) {
        const koth::GeneSpec& spec = koth::LADDER_SNIPE_GENE_SPECS[g];
        const double span = spec.maxValue - spec.minValue;
        for (const double dir : {1.0, -1.0}) {
          Individual cand;
          cand.genome = globalBest.genome;
          koth::setGenomeGene(&cand.genome, static_cast<int>(g), cand.genome[g] + dir * sigma * span);
          candidates.push_back(cand);
        }
      }
      std::atomic<int> next{0};
      std::vector<std::thread> workers;
      workers.reserve(static_cast<size_t>(args.threads));
      for (int t = 0; t < args.threads; ++t) {
        workers.emplace_back([&]() {
          for (;;) {
            const int idx = next.fetch_add(1);
            if (idx >= static_cast<int>(candidates.size())) break;
            const koth::LadderSnipeTuning tuning =
                koth::tuningFromGenome(candidates[static_cast<size_t>(idx)].genome);
            candidates[static_cast<size_t>(idx)].eval =
                koth::evaluateLadderSnipeTuning(tuning, assignments, args.cap, args.maxPenalty, args.tailPenalty);
          }
        });
      }
      for (auto& th : workers) th.join();
      std::sort(candidates.begin(), candidates.end(),
                [](const Individual& a, const Individual& b) { return a.eval.fitness < b.eval.fitness; });
      const bool improved = candidates.front().eval.fitness < globalBest.eval.fitness;
      if (improved) {
        globalBest = candidates.front();
        saveBest(args, globalBest);
      }
      std::cout << "  refine round " << (round + 1) << " sigma=" << std::setprecision(4) << sigma
                << " best fitness=" << std::fixed << std::setprecision(1) << globalBest.eval.fitness
                << " avg=" << std::setprecision(2) << globalBest.eval.avgGuesses
                << " max=" << globalBest.eval.maxGuesses << (improved ? "  (improved)\n" : "\n");
      sigma *= 0.5;
    }
  }

  saveBest(args, globalBest);
  std::cout << "\nBest config: " << args.outPath << "\n";
  std::cout << "fitness=" << globalBest.eval.fitness << " avg=" << globalBest.eval.avgGuesses
            << " max=" << globalBest.eval.maxGuesses << "\n";
  return 0;
}
