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

struct Args {
  uint32_t seed = koth::DEFAULT_SEED;
  int count = 100000;
  int diffMin = 1;
  int diffMax = 60;
  int workers = static_cast<int>(std::thread::hardware_concurrency());
};

struct BenchRow {
  int difficulty = 0;
  std::vector<int> guesses;
  int unsolved = 0;
  double seconds = 0.0;
};

bool parseArgs(int argc, char** argv, Args* out) {
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
      if (!v) return false;
      out->seed = static_cast<uint32_t>(std::strtoul(v, nullptr, 0));
    } else if (arg == "--count" || arg == "-n") {
      const char* v = need(arg.c_str());
      if (!v) return false;
      out->count = std::atoi(v);
    } else if (arg == "--diff-min") {
      const char* v = need(arg.c_str());
      if (!v) return false;
      out->diffMin = std::atoi(v);
    } else if (arg == "--diff-max") {
      const char* v = need(arg.c_str());
      if (!v) return false;
      out->diffMax = std::atoi(v);
    } else if (arg == "--workers" || arg == "-w") {
      const char* v = need(arg.c_str());
      if (!v) return false;
      out->workers = std::max(1, std::atoi(v));
    } else if (arg == "--sequential") {
      out->workers = 1;
    } else if (arg == "--help" || arg == "-h") {
      std::cerr << "Usage: koth_bench [--seed N] [--count N] [--workers N] [--diff-min N] [--diff-max N]\n";
      return false;
    } else {
      std::cerr << "Unknown argument: " << arg << "\n";
      return false;
    }
  }
  if (out->workers < 1) out->workers = 1;
  if (out->count < 1) out->count = 1;
  if (out->diffMin > out->diffMax) std::swap(out->diffMin, out->diffMax);
  return true;
}

BenchRow benchDifficulty(uint32_t seed, int count, int difficulty) {
  const auto rows = koth::generateAssignments(seed, count, difficulty);
  const auto t0 = std::chrono::steady_clock::now();
  BenchRow row;
  row.difficulty = difficulty;
  row.guesses.reserve(static_cast<size_t>(count));
  for (const auto& assignment : rows) {
    const koth::SolveResult res = koth::solve(assignment);
    if (res.solved) row.guesses.push_back(res.guesses);
    else ++row.unsolved;
  }
  std::sort(row.guesses.begin(), row.guesses.end());
  row.seconds =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  return row;
}

void printProgress(int done, int total, std::mutex* mu) {
  const int pct = static_cast<int>(done * 100.0 / total);
  std::string bar(static_cast<size_t>(done), '#');
  bar.append(static_cast<size_t>(total - done), '.');
  std::lock_guard<std::mutex> lock(*mu);
  std::cout << "\r  [" << bar << "] " << done << "/" << total << "  (" << pct << "%)" << std::flush;
}

std::string formatRow(const BenchRow& row) {
  std::ostringstream oss;
  oss << std::fixed;
  const int unsolved = row.unsolved;
  if (!row.guesses.empty()) {
    const int n = static_cast<int>(row.guesses.size());
    const double sum = std::accumulate(row.guesses.begin(), row.guesses.end(), 0.0);
    const double avg = sum / n;
    const int median = row.guesses[static_cast<size_t>(n / 2)];
    const int lo = row.guesses.front();
    const int hi = row.guesses.back();
    const int p95 = row.guesses[static_cast<size_t>(static_cast<int>(0.95 * n))];
    const int p99 = row.guesses[static_cast<size_t>(static_cast<int>(0.99 * n))];
    oss << std::setw(4) << row.difficulty << "  " << std::setw(6) << n << "  " << std::setw(8) << unsolved << "  "
        << std::setw(7) << std::setprecision(2) << avg << "  " << std::setw(6) << median << "  " << std::setw(5) << lo
        << "  " << std::setw(5) << hi << "  " << std::setw(5) << p95 << "  " << std::setw(5) << p99 << "  "
        << std::setw(5) << std::setprecision(1) << row.seconds << "s";
  } else {
    oss << std::setw(4) << row.difficulty << "  " << std::setw(6) << 0 << "  " << std::setw(8) << unsolved << "  "
        << std::setw(7) << "\xE2\x80\x94" << "  " << std::setw(6) << "\xE2\x80\x94" << "  " << std::setw(5)
        << "\xE2\x80\x94" << "  " << std::setw(5) << "\xE2\x80\x94" << "  " << std::setw(5) << "\xE2\x80\x94" << "  "
        << std::setw(5) << "\xE2\x80\x94" << "  " << std::setw(5) << std::setprecision(1) << row.seconds << "s";
  }
  return oss.str();
}

}  // namespace

int main(int argc, char** argv) {
  Args args;
  if (!parseArgs(argc, argv, &args)) return 1;

  const int total = args.diffMax - args.diffMin + 1;
  const std::string hdr = "diff  solved  unsolved      avg  median    min    max    p95    p99    time";
  const std::string sep(hdr.size(), '-');

  std::cout << "Benchmark  N=" << args.count << " per difficulty  workers=" << args.workers << "\n";
  std::cout << sep << "\n" << hdr << "\n" << sep << "\n";

  const auto tTotal0 = std::chrono::steady_clock::now();
  std::vector<BenchRow> results(static_cast<size_t>(total));
  std::atomic<int> done{0};
  std::mutex progressMu;

  if (args.workers <= 1) {
    for (int d = args.diffMin; d <= args.diffMax; ++d) {
      results[static_cast<size_t>(d - args.diffMin)] = benchDifficulty(args.seed, args.count, d);
      printProgress(done.fetch_add(1) + 1, total, &progressMu);
    }
  } else {
    std::atomic<int> nextDiff{args.diffMin};
    std::vector<std::future<void>> workers;
    workers.reserve(static_cast<size_t>(args.workers));
    for (int w = 0; w < args.workers; ++w) {
      workers.push_back(std::async(std::launch::async, [&]() {
        for (;;) {
          const int d = nextDiff.fetch_add(1);
          if (d > args.diffMax) break;
          results[static_cast<size_t>(d - args.diffMin)] = benchDifficulty(args.seed, args.count, d);
          printProgress(done.fetch_add(1) + 1, total, &progressMu);
        }
      }));
    }
    for (auto& f : workers) f.get();
  }

  std::cout << "\n";

  bool failed = false;
  for (const BenchRow& row : results) {
    if (row.unsolved > 0) failed = true;
    std::cout << formatRow(row) << "\n";
  }

  const double totalSeconds =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - tTotal0).count();
  std::cout << sep << "\n";
  std::cout << "Total wall time: " << std::fixed << std::setprecision(1) << totalSeconds << "s\n";
  return failed ? 1 : 0;
}
