#include "koth_game.hpp"
#include "koth_solver.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <future>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <numeric>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {

class AsciiTable {
 public:
  void addColumn(const std::string& header, size_t minWidth = 0) {
    headers_.push_back(header);
    widths_.push_back(std::max(minWidth, header.size()));
  }

  void addRow(std::vector<std::string> cells) {
    if (cells.size() < headers_.size()) cells.resize(headers_.size());
    for (size_t i = 0; i < headers_.size(); ++i) {
      widths_[i] = std::max(widths_[i], cells[i].size());
    }
    rows_.push_back(std::move(cells));
  }

  void print(std::ostream& out) const {
    const auto sep = [&]() {
      out << '+';
      for (const size_t w : widths_) out << std::string(w + 2, '-') << '+';
      out << '\n';
    };
    const auto row = [&](const std::vector<std::string>& cells) {
      out << '|';
      for (size_t i = 0; i < widths_.size(); ++i) {
        const std::string& cell = i < cells.size() ? cells[i] : "";
        out << ' ' << std::setw(static_cast<int>(widths_[i])) << std::right << cell << " |";
      }
      out << '\n';
    };
    sep();
    row(headers_);
    sep();
    for (const auto& r : rows_) row(r);
    sep();
  }

 private:
  std::vector<std::string> headers_;
  std::vector<size_t> widths_;
  std::vector<std::vector<std::string>> rows_;
};

std::string fmtInt(int value) { return std::to_string(value); }

std::string fmtAvg(double value) {
  std::ostringstream oss;
  oss << std::fixed << std::setprecision(2) << value;
  return oss.str();
}

std::string fmtDelta(double value) {
  std::ostringstream oss;
  oss << std::fixed << std::setprecision(2) << std::showpos << value << std::noshowpos;
  return oss.str();
}

std::string fmtTime(double seconds) {
  std::ostringstream oss;
  oss << std::fixed << std::setprecision(1) << seconds << "s";
  return oss.str();
}

std::string fmtSignedInt(int value) {
  std::ostringstream oss;
  oss << std::showpos << value << std::noshowpos;
  return oss.str();
}

struct Args {
  uint32_t seed = koth::DEFAULT_SEED;
  int count = 100000;
  int diffMin = 1;
  int diffMax = 60;
  int caseDifficulty = 60;
  int workers = static_cast<int>(std::thread::hardware_concurrency());
  std::vector<koth::SolverVariant> variants = koth::allSolverVariants();
  std::vector<int> indices;
};

struct BenchStats {
  int solved = 0;
  int unsolved = 0;
  double avg = 0.0;
  int median = 0;
  int min = 0;
  int max = 0;
  int p95 = 0;
  int p99 = 0;
};

struct BenchRow {
  koth::SolverVariant variant = koth::SolverVariant::Baseline;
  int difficulty = 0;
  std::vector<int> guesses;
  int unsolved = 0;
  double seconds = 0.0;
};

struct DifficultyTask {
  int difficulty = 0;
  std::vector<koth::Assignment> assignments;
};

/** 0 = ok, 1 = error, 2 = list variants (success, no bench). */
int parseArgs(int argc, char** argv, Args* out) {
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    auto need = [&](const char* name) -> const char* {
      if (i + 1 >= argc) {
        std::cerr << "Missing value for " << name << "\n";
        return nullptr;
      }
      return argv[++i];
    };
    if (arg == "--seed" || arg == "-s") {
      const char* v = need(arg.c_str());
      if (!v) return 1;
      out->seed = static_cast<uint32_t>(std::strtoul(v, nullptr, 0));
    } else if (arg == "--count" || arg == "-n") {
      const char* v = need(arg.c_str());
      if (!v) return 1;
      out->count = std::atoi(v);
    } else if (arg == "--diff-min") {
      const char* v = need(arg.c_str());
      if (!v) return 1;
      out->diffMin = std::atoi(v);
    } else if (arg == "--diff-max") {
      const char* v = need(arg.c_str());
      if (!v) return 1;
      out->diffMax = std::atoi(v);
    } else if (arg == "--workers" || arg == "-w") {
      const char* v = need(arg.c_str());
      if (!v) return 1;
      out->workers = std::max(1, std::atoi(v));
    } else if (arg == "--variants" || arg == "--variant") {
      const char* v = need(arg.c_str());
      if (!v) return 1;
      out->variants.clear();
      std::string item;
      std::istringstream stream(v);
      while (std::getline(stream, item, ',')) {
        if (item.empty()) continue;
        koth::SolverVariant parsed;
        if (!koth::parseSolverVariant(item, &parsed)) {
          std::cerr << "Unknown solver variant: " << item << "\n";
          return 1;
        }
        out->variants.push_back(parsed);
      }
      if (out->variants.empty()) {
        std::cerr << "--variants requires at least one variant name\n";
        return 1;
      }
    } else if (arg == "--indices") {
      const char* v = need(arg.c_str());
      if (!v) return 1;
      out->indices.clear();
      std::string item;
      std::istringstream stream(v);
      while (std::getline(stream, item, ',')) {
        if (item.empty()) continue;
        out->indices.push_back(std::atoi(item.c_str()));
      }
      if (out->indices.empty()) {
        std::cerr << "--indices requires at least one 1-based assignment index\n";
        return 1;
      }
    } else if (arg == "--case-difficulty") {
      const char* v = need(arg.c_str());
      if (!v) return 1;
      out->caseDifficulty = std::atoi(v);
    } else if (arg == "--list-variants") {
      for (const koth::SolverVariant v : koth::allSolverVariants()) {
        std::cerr << koth::solverVariantName(v) << "  " << koth::solverVariantDescription(v) << "\n";
      }
      return 2;
    } else if (arg == "--sequential") {
      out->workers = 1;
    } else if (arg == "--help" || arg == "-h") {
      std::cerr << "Usage: koth_bench [options]\n"
                << "  --seed N           Assignment seed (default " << koth::DEFAULT_SEED << ")\n"
                << "  --count N          Assignments per difficulty (default 100000)\n"
                << "  --workers N        Parallel difficulty workers (default hardware concurrency)\n"
                << "  --diff-min N       First difficulty (default 1)\n"
                << "  --diff-max N       Last difficulty (default 60)\n"
                << "  --variants LIST    Comma-separated solver variants (default: all)\n"
                << "  --indices LIST     Comma-separated 1-based assignment indices (case mode)\n"
                << "  --case-difficulty N  Difficulty for --indices mode (default 60)\n"
                << "  --list-variants    List registered solver variants\n";
      return 1;
    } else {
      std::cerr << "Unknown argument: " << arg << "\n";
      return 1;
    }
  }
  if (out->workers < 1) out->workers = 1;
  if (out->count < 1) out->count = 1;
  if (out->diffMin > out->diffMax) std::swap(out->diffMin, out->diffMax);
  return 0;
}

BenchStats summarize(const BenchRow& row) {
  BenchStats stats;
  stats.unsolved = row.unsolved;
  if (row.guesses.empty()) return stats;
  const int n = static_cast<int>(row.guesses.size());
  stats.solved = n;
  const double sum = std::accumulate(row.guesses.begin(), row.guesses.end(), 0.0);
  stats.avg = sum / n;
  stats.median = row.guesses[static_cast<size_t>(n / 2)];
  stats.min = row.guesses.front();
  stats.max = row.guesses.back();
  stats.p95 = row.guesses[static_cast<size_t>(static_cast<int>(0.95 * n))];
  stats.p99 = row.guesses[static_cast<size_t>(static_cast<int>(0.99 * n))];
  return stats;
}

std::vector<BenchRow> benchDifficulty(const DifficultyTask& task, const std::vector<koth::SolverVariant>& variants) {
  std::vector<BenchRow> rows;
  rows.reserve(variants.size());
  for (const koth::SolverVariant variant : variants) {
    const auto t0 = std::chrono::steady_clock::now();
    BenchRow row;
    row.variant = variant;
    row.difficulty = task.difficulty;
    row.guesses.reserve(task.assignments.size());
    for (const auto& assignment : task.assignments) {
      const koth::SolveResult res = koth::solve(assignment, 600, variant);
      if (res.solved) row.guesses.push_back(res.guesses);
      else ++row.unsolved;
    }
    std::sort(row.guesses.begin(), row.guesses.end());
    row.seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    rows.push_back(std::move(row));
  }
  return rows;
}

void printProgress(int done, int total, std::mutex* mu) {
  const int pct = static_cast<int>(done * 100.0 / total);
  std::string bar(static_cast<size_t>(done), '#');
  bar.append(static_cast<size_t>(total - done), '.');
  std::lock_guard<std::mutex> lock(*mu);
  std::cout << "\r  [" << bar << "] " << done << "/" << total << "  (" << pct << "%)" << std::flush;
}

std::string fmtDash() { return "-"; }

std::vector<std::string> statsCells(const BenchStats& stats, double seconds) {
  if (stats.solved <= 0) {
    return {fmtInt(0), fmtInt(stats.unsolved), fmtDash(), fmtDash(), fmtDash(),
            fmtDash(), fmtDash(), fmtDash(), fmtTime(seconds)};
  }
  return {fmtInt(stats.solved), fmtInt(stats.unsolved), fmtAvg(stats.avg), fmtInt(stats.median),
          fmtInt(stats.min), fmtInt(stats.max), fmtInt(stats.p95), fmtInt(stats.p99), fmtTime(seconds)};
}

void printStatsTable(const std::vector<std::vector<BenchRow>>& results, bool compare) {
  AsciiTable table;
  table.addColumn("diff", 4);
  if (compare) table.addColumn("variant", 10);
  table.addColumn("solved", 6);
  table.addColumn("unsolved", 8);
  table.addColumn("avg", 7);
  table.addColumn("median", 6);
  table.addColumn("min", 5);
  table.addColumn("max", 5);
  table.addColumn("p95", 5);
  table.addColumn("p99", 5);
  table.addColumn("time", 6);

  for (const std::vector<BenchRow>& group : results) {
    if (group.empty()) continue;
    const int difficulty = group.front().difficulty;
    const BenchStats baseStats = summarize(group.front());
    for (size_t vi = 0; vi < group.size(); ++vi) {
      const BenchRow& row = group[vi];
      const BenchStats stats = summarize(row);
      std::vector<std::string> cells;
      cells.push_back(fmtInt(difficulty));
      if (compare) cells.push_back(koth::solverVariantName(row.variant));
      const auto tail = statsCells(stats, row.seconds);
      cells.insert(cells.end(), tail.begin(), tail.end());
      table.addRow(std::move(cells));
    }
    if (compare && group.size() > 1) {
      for (size_t vi = 1; vi < group.size(); ++vi) {
        const BenchStats stats = summarize(group[vi]);
        std::vector<std::string> cells = {
            "",
            "d " + std::string(koth::solverVariantName(group[vi].variant)),
            fmtSignedInt(stats.solved - baseStats.solved),
            fmtSignedInt(stats.unsolved - baseStats.unsolved),
            fmtDelta(stats.avg - baseStats.avg),
            fmtSignedInt(stats.median - baseStats.median),
            fmtSignedInt(stats.min - baseStats.min),
            fmtSignedInt(stats.max - baseStats.max),
            fmtSignedInt(stats.p95 - baseStats.p95),
            fmtSignedInt(stats.p99 - baseStats.p99),
            "-",
        };
        table.addRow(std::move(cells));
      }
    }
  }
  table.print(std::cout);
}

void printVariantLegend(const std::vector<koth::SolverVariant>& variants) {
  for (const koth::SolverVariant v : variants) {
    std::cout << "  " << koth::solverVariantName(v) << " - " << koth::solverVariantDescription(v) << "\n";
  }
}

int runCaseMode(const Args& args) {
  std::cout << "Case compare  seed=" << args.seed << "  difficulty=" << args.caseDifficulty << "  variants="
            << args.variants.size() << "\n";
  printVariantLegend(args.variants);
  std::cout << "\n";

  AsciiTable table;
  table.addColumn("index", 5);
  table.addColumn("password", 12);
  table.addColumn("variant", 10);
  table.addColumn("guesses", 7);
  table.addColumn("solved", 6);
  table.addColumn("best", 12);

  bool failed = false;
  for (const int index : args.indices) {
    const koth::Assignment assignment =
        koth::generateAssignmentAt(args.seed, index, args.caseDifficulty);
    std::vector<koth::SolveResult> results;
    results.reserve(args.variants.size());
    for (const koth::SolverVariant variant : args.variants) {
      results.push_back(koth::solve(assignment, 600, variant));
    }
    const int baseGuesses = results.front().guesses;
    for (size_t vi = 0; vi < args.variants.size(); ++vi) {
      const koth::SolveResult& res = results[vi];
      if (!res.solved) failed = true;
      table.addRow({fmtInt(index), assignment.password, koth::solverVariantName(args.variants[vi]),
                    fmtInt(res.guesses), res.solved ? "yes" : "no", std::to_string(res.bestX)});
    }
    if (args.variants.size() > 1) {
      for (size_t vi = 1; vi < args.variants.size(); ++vi) {
        table.addRow({"", "", "d " + std::string(koth::solverVariantName(args.variants[vi])),
                      fmtSignedInt(results[vi].guesses - baseGuesses), "", ""});
      }
    }
  }

  table.print(std::cout);
  return failed ? 1 : 0;
}

}  // namespace

int main(int argc, char** argv) {
  Args args;
  const int parseCode = parseArgs(argc, argv, &args);
  if (parseCode == 2) return 0;
  if (parseCode != 0) return 1;

  if (!args.indices.empty()) return runCaseMode(args);

  const int total = args.diffMax - args.diffMin + 1;
  const bool compare = args.variants.size() > 1;

  std::cout << "Benchmark  N=" << args.count << " per difficulty  workers=" << args.workers;
  if (compare) {
    std::cout << "  variants=" << args.variants.size();
  } else {
    std::cout << "  variant=" << koth::solverVariantName(args.variants.front());
  }
  std::cout << "\n";
  if (compare) printVariantLegend(args.variants);
  std::cout << "\n";

  const auto tTotal0 = std::chrono::steady_clock::now();
  std::vector<std::vector<BenchRow>> results(static_cast<size_t>(total));
  std::atomic<int> done{0};
  std::mutex progressMu;

  auto runPool = [&](auto&& workerFn) {
    if (args.workers <= 1) {
      for (int d = args.diffMin; d <= args.diffMax; ++d) workerFn(d);
      return;
    }
    std::atomic<int> nextDiff{args.diffMin};
    std::vector<std::future<void>> workers;
    workers.reserve(static_cast<size_t>(args.workers));
    for (int w = 0; w < args.workers; ++w) {
      workers.push_back(std::async(std::launch::async, [&]() {
        for (;;) {
          const int d = nextDiff.fetch_add(1);
          if (d > args.diffMax) break;
          workerFn(d);
        }
      }));
    }
    for (auto& f : workers) f.get();
  };

  runPool([&](int difficulty) {
    DifficultyTask task;
    task.difficulty = difficulty;
    task.assignments = koth::generateAssignments(args.seed, args.count, difficulty);
    results[static_cast<size_t>(difficulty - args.diffMin)] = benchDifficulty(task, args.variants);
    printProgress(done.fetch_add(1) + 1, total, &progressMu);
  });

  std::cout << "\n";

  bool failed = false;
  for (const std::vector<BenchRow>& group : results) {
    for (const BenchRow& row : group) {
      if (row.unsolved > 0) failed = true;
    }
  }
  printStatsTable(results, compare);

  const double totalSeconds =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - tTotal0).count();
  std::cout << "\nTotal wall time: " << std::fixed << std::setprecision(1) << totalSeconds << "s\n";
  return failed ? 1 : 0;
}
