// In-process profiler for the search, built into ipvgo_game for the profiling
// configuration only (RelWithDebInfo / x64-Profile, which defines IPVGO_PROFILER).
// The Visual Studio / ETW CPU profiler needs an elevated session; this runs
// unprivileged by looking at its own process instead.
//
//   ipvgo_game prof [faction] [boardSize] [games] [nodeLimit]
//
//  phase 1  count allocations/deallocations and attribute them to the calling
//           function via the return address of operator new
//  phase 2  sample the call stack of every thread with StackWalk64 while the
//           same games run again, then report exclusive/inclusive cost per
//           function, per source line and the heaviest caller->callee edges
//
// Needs the PDB next to the exe, which the profiling configuration produces.
#include "profiler.hpp"

#if defined(_WIN32) && defined(IPVGO_PROFILER)
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <intrin.h>
#include <windows.h>
#include <mmsystem.h>
#include <dbghelp.h>
#include <psapi.h>
#include <tlhelp32.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <mutex>
#include <random>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "exploiter.hpp"
#include "fast_alloc.hpp"
#include "game_engine.hpp"
#include "go_game.hpp"
#include "opponents.hpp"
#include "setup.hpp"

using namespace ipvgo::game;

// ---------------------------------------------------------------------------
// allocation instrumentation
// ---------------------------------------------------------------------------
namespace {

std::atomic<bool> g_countAllocs{false};
std::atomic<long long> g_allocCount{0};
std::atomic<long long> g_allocBytes{0};
std::atomic<long long> g_freeCount{0};

constexpr int kMaxSites = 4096;
uintptr_t g_siteAddr[kMaxSites] = {0};
std::atomic<long long> g_siteCounts[kMaxSites];
std::atomic<long long> g_siteBytes[kMaxSites];
std::atomic<int> g_sitesUsed{0};
thread_local bool t_inHook = false;

int siteIndex(void* caller) {
  const uintptr_t addr = reinterpret_cast<uintptr_t>(caller);
  size_t h = (addr >> 4) & (kMaxSites - 1);
  for (int probe = 0; probe < 256; ++probe) {
    const uintptr_t current = g_siteAddr[h];
    if (current == addr) return static_cast<int>(h);
    if (current == 0) {
      // single-threaded probe workload, no CAS needed
      g_siteAddr[h] = addr;
      g_sitesUsed.fetch_add(1, std::memory_order_relaxed);
      return static_cast<int>(h);
    }
    h = (h + 1) & (kMaxSites - 1);
  }
  return -1;
}

void* hookAlloc(size_t size, void* caller) {
  void* p = ipvgo::fastalloc::allocate(size);
  if (g_countAllocs.load(std::memory_order_relaxed) && !t_inHook) {
    t_inHook = true;
    g_allocCount.fetch_add(1, std::memory_order_relaxed);
    g_allocBytes.fetch_add(static_cast<long long>(size), std::memory_order_relaxed);
    const int idx = siteIndex(caller);
    if (idx >= 0) {
      g_siteCounts[idx].fetch_add(1, std::memory_order_relaxed);
      g_siteBytes[idx].fetch_add(static_cast<long long>(size), std::memory_order_relaxed);
    }
    t_inHook = false;
  }
  return p;
}

void hookFree(void* p) {
  if (p == nullptr) return;
  if (g_countAllocs.load(std::memory_order_relaxed)) g_freeCount.fetch_add(1, std::memory_order_relaxed);
  ipvgo::fastalloc::release(p);
}

}  // namespace

void* operator new(size_t size) { return hookAlloc(size, _ReturnAddress()); }
void* operator new[](size_t size) { return hookAlloc(size, _ReturnAddress()); }
void operator delete(void* p) noexcept { hookFree(p); }
void operator delete[](void* p) noexcept { hookFree(p); }
void operator delete(void* p, size_t) noexcept { hookFree(p); }
void operator delete[](void* p, size_t) noexcept { hookFree(p); }

namespace {

// ---------------------------------------------------------------------------
// symbols
// ---------------------------------------------------------------------------
struct Sym {
  std::string name;
  std::string file;
  int line = 0;
};

std::string demangle(const char* raw) {
  char buf[4096];
  if (UnDecorateSymbolName(raw, buf, sizeof(buf), UNDNAME_NAME_ONLY) == 0) return raw;
  return buf;
}

const Sym& resolve(DWORD64 addr) {
  static std::unordered_map<DWORD64, Sym> cache;
  const auto it = cache.find(addr);
  if (it != cache.end()) return it->second;

  Sym sym;
  char buffer[sizeof(SYMBOL_INFO) + 1024] = {0};
  SYMBOL_INFO* info = reinterpret_cast<SYMBOL_INFO*>(buffer);
  info->SizeOfStruct = sizeof(SYMBOL_INFO);
  info->MaxNameLen = 1000;
  DWORD64 displacement = 0;
  if (SymFromAddr(GetCurrentProcess(), addr, &displacement, info)) {
    sym.name = demangle(info->Name);
  } else {
    char text[64];
    std::snprintf(text, sizeof(text), "0x%llx", static_cast<unsigned long long>(addr));
    sym.name = text;
  }
  IMAGEHLP_LINE64 line{};
  line.SizeOfStruct = sizeof(line);
  DWORD lineDisplacement = 0;
  if (SymGetLineFromAddr64(GetCurrentProcess(), addr, &lineDisplacement, &line)) {
    sym.file = line.FileName;
    const size_t slash = sym.file.find_last_of("\\/");
    if (slash != std::string::npos) sym.file = sym.file.substr(slash + 1);
    sym.line = static_cast<int>(line.LineNumber);
  }
  return cache.emplace(addr, std::move(sym)).first->second;
}

DWORD64 g_moduleBase = 0;
DWORD64 g_moduleEnd = 0;
bool inMainModule(DWORD64 addr) { return addr >= g_moduleBase && addr < g_moduleEnd; }

// ---------------------------------------------------------------------------
// sampling profiler
// ---------------------------------------------------------------------------
std::atomic<bool> g_sampling{false};

// A sampled stack in fixed storage. The sampler runs while the other threads are
// suspended between SuspendThread and ResumeThread, so anything it does that can
// block - allocating, in particular - can deadlock against a suspended thread that
// holds the heap lock. `g_samples` is reserved before sampling starts and each
// sample is written in place, so no allocation happens inside that window.
struct SampleStack {
  static constexpr int kMaxFrames = 64;
  int count = 0;
  DWORD64 frames[kMaxFrames] = {};
};
std::vector<SampleStack> g_samples;
std::mutex g_samplesMutex;
std::atomic<long long> g_diagRounds{0}, g_diagCalls{0}, g_diagCallNs{0}, g_diagSuspendNs{0}, g_diagThreads{0};

// Takes one sample of `thread`; returns true when the stack contains engine code.
bool sampleThread(HANDLE thread) {
  const auto t0 = std::chrono::steady_clock::now();
  if (SuspendThread(thread) == static_cast<DWORD>(-1)) return false;
  const auto t1 = std::chrono::steady_clock::now();
  g_diagSuspendNs += std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count();
  ++g_diagCalls;
  bool inEngine = false;
  CONTEXT ctx{};
  ctx.ContextFlags = CONTEXT_FULL;
  if (GetThreadContext(thread, &ctx)) {
    // Unwind with the table-driven RtlVirtualUnwind instead of StackWalk64: it
    // needs no symbol lookups, which makes a sample cheap enough to take at ~1 kHz.
    SampleStack stack;
    for (int depth = 0; depth < SampleStack::kMaxFrames && ctx.Rip != 0; ++depth) {
      stack.frames[stack.count++] = ctx.Rip;
      if (inMainModule(ctx.Rip)) inEngine = true;
      DWORD64 imageBase = 0;
      UNWIND_HISTORY_TABLE history{};
      PRUNTIME_FUNCTION entry = RtlLookupFunctionEntry(ctx.Rip, &imageBase, &history);
      if (entry == nullptr) {
        // Leaf function without unwind data: the return address is at the top of the stack.
        ctx.Rip = *reinterpret_cast<DWORD64*>(ctx.Rsp);
        ctx.Rsp += 8;
      } else {
        void* handlerData = nullptr;
        DWORD64 establisher = 0;
        RtlVirtualUnwind(UNW_FLAG_NHANDLER, imageBase, ctx.Rip, entry, &ctx, &handlerData, &establisher, nullptr);
      }
    }
    if (inEngine) {
      std::lock_guard<std::mutex> lock(g_samplesMutex);
      if (g_samples.size() < g_samples.capacity()) g_samples.push_back(stack);
    }
  }
  ResumeThread(thread);
  g_diagCallNs += std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - t0).count();
  return inEngine;
}

struct SampledThread {
  DWORD id = 0;
  HANDLE handle = nullptr;
  int misses = 0;  // consecutive samples with no engine frame (idle system threads)
};

DWORD WINAPI samplerLoop(void*) {
  const DWORD pid = GetCurrentProcessId();
  const DWORD self = GetCurrentThreadId();
  // A process-wide thread snapshot costs milliseconds, far more than walking one
  // stack, so the thread list is refreshed only occasionally.
  std::vector<SampledThread> threads;
  auto lastRefresh = std::chrono::steady_clock::now() - std::chrono::seconds(1);
  unsigned long long round = 0;
  while (g_sampling.load(std::memory_order_relaxed)) {
    const auto now = std::chrono::steady_clock::now();
    if (now - lastRefresh > std::chrono::milliseconds(500)) {
      lastRefresh = now;
      std::vector<SampledThread> fresh;
      HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
      if (snapshot != INVALID_HANDLE_VALUE) {
        THREADENTRY32 entry{};
        entry.dwSize = sizeof(entry);
        if (Thread32First(snapshot, &entry)) {
          do {
            if (entry.th32OwnerProcessID != pid || entry.th32ThreadID == self) continue;
            // Keep the existing handle (and its miss count) for threads already known.
            const auto known = std::find_if(threads.begin(), threads.end(), [&](const SampledThread& t) {
              return t.id == entry.th32ThreadID;
            });
            if (known != threads.end()) {
              fresh.push_back(*known);
              known->handle = nullptr;
              continue;
            }
            HANDLE handle = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION,
                                       FALSE, entry.th32ThreadID);
            if (handle != nullptr) fresh.push_back({entry.th32ThreadID, handle, 0});
          } while (Thread32Next(snapshot, &entry));
        }
        CloseHandle(snapshot);
      }
      for (SampledThread& t : threads) {
        if (t.handle != nullptr) CloseHandle(t.handle);
      }
      threads = std::move(fresh);
    }
    ++round;
    ++g_diagRounds;
    g_diagThreads = static_cast<long long>(threads.size());
    for (SampledThread& t : threads) {
      // Idle system threads never run engine code; re-check them only now and then.
      if (t.misses >= 8 && (round & 255) != 0) continue;
      t.misses = sampleThread(t.handle) ? 0 : t.misses + 1;
    }
    // Sleep(1) can round up to ~15 ms for a windowless process, so spin instead.
    const auto resume = std::chrono::steady_clock::now() + std::chrono::microseconds(200);
    while (std::chrono::steady_clock::now() < resume) YieldProcessor();
  }
  for (SampledThread& t : threads) CloseHandle(t.handle);
  return 0;
}

}  // namespace

int runProfiler(int argc, char** argv) {
  const std::string faction = argc > 1 ? argv[1] : "Slum Snakes";
  const int boardSize = argc > 2 ? std::atoi(argv[2]) : 7;
  const int games = argc > 3 ? std::atoi(argv[3]) : 10;
  const long nodeLimit = argc > 4 ? std::atol(argv[4]) : 4000;

  SymSetOptions(SYMOPT_LOAD_LINES | SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS);
  char exePath[MAX_PATH] = {0};
  GetModuleFileNameA(nullptr, exePath, MAX_PATH);
  std::string searchPath = exePath;
  const size_t slash = searchPath.find_last_of("\\/");
  if (slash != std::string::npos) searchPath.resize(slash);
  if (!SymInitialize(GetCurrentProcess(), searchPath.c_str(), TRUE)) {
    std::printf("SymInitialize failed: %lu\n", GetLastError());
    return 1;
  }
  {
    // sanity: can we name our own main?
    const Sym& probe = resolve(reinterpret_cast<DWORD64>(&runProfiler));
    std::printf("symbol check: %s [%s:%d]\n", probe.name.c_str(), probe.file.c_str(), probe.line);
  }
  timeBeginPeriod(1);
  MODULEINFO modInfo{};
  if (GetModuleInformation(GetCurrentProcess(), GetModuleHandle(nullptr), &modInfo, sizeof(modInfo))) {
    g_moduleBase = reinterpret_cast<DWORD64>(modInfo.lpBaseOfDll);
    g_moduleEnd = g_moduleBase + modInfo.SizeOfImage;
  }

  const Opponent ai = parseOpponent(faction).value_or(Opponent::Netburners);
  std::mt19937_64 rng(1);

  ipvgo::nn::ExploitConfig cfg;
  cfg.depth = 2;
  cfg.threads = 1;          // one thread so the samples are not split across cores
  cfg.nodeLimit = nodeLimit;  // the budget the game's client actually gives us

  std::printf("workload: %s %dx%d, %d games, nodeLimit=%ld, threads=%d (the in-game configuration)\n",
              faction.c_str(), boardSize, boardSize, games, nodeLimit, cfg.threads);

  // ---- phase 1: allocations, over the same games ------------------------------
  g_countAllocs = true;
  const auto allocStart = std::chrono::steady_clock::now();
  long allocNodes = 0;
  long totalMoves = 0;
  int wins = 0;
  for (int g = 0; g < games; ++g) {
    const double clockMs = static_cast<double>(rng() % 30000000u);
    MathRandom mathRng(rng());
    GameState state = newBoardState(boardSize, ai, true, clockMs, mathRng);
    // A fresh session per game, exactly like the server.
    ipvgo::nn::SearchSession session;
    for (int m = 0; m < boardSize * boardSize * 4 && !state.gameOver; ++m) {
      if (whoseTurn(state) != Color::Black) break;
      session.noteRequest(static_cast<size_t>(state.previousBoards.size()));
      const ipvgo::nn::ExploitResult r = ipvgo::nn::runExploiter(state, cfg, nullptr, &session);
      allocNodes += r.nodes;
      ++totalMoves;
      if (r.bestAction == (boardSize * boardSize)) passTurn(state, Color::Black);
      else if (!makeMove(state, r.bestAction / boardSize, r.bestAction % boardSize, Color::Black)) {
        passTurn(state, Color::Black);
      }
      if (state.gameOver) break;
      const Play wp = getMove(state, Color::White, ai, static_cast<double>(rng() % 30000000u), mathRng);
      if (wp.type == PlayType::Pass) passTurn(state, Color::White);
      else if (!makeMove(state, wp.x, wp.y, Color::White)) passTurn(state, Color::White);
    }
    if (blackWins(getScore(state))) ++wins;
  }
  const double allocMs =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - allocStart).count();
  g_countAllocs = false;

  const long long allocs = g_allocCount.load();
  const long long bytes = g_allocBytes.load();
  std::printf("gameplay: %d games, %ld black moves, %d wins, %ld nodes, %.0f ms total, %.2f ms/move\n", games,
              totalMoves, wins, allocNodes, allocMs, allocMs / std::max<long>(totalMoves, 1));
  std::printf("allocs=%lld bytes=%lld frees=%lld  -> %.0f alloc/ms, %.0f bytes/alloc, %.0f alloc/move\n", allocs,
              bytes, g_freeCount.load(), static_cast<double>(allocs) / std::max(allocMs, 1e-9),
              static_cast<double>(bytes) / std::max<double>(1.0, static_cast<double>(allocs)),
              static_cast<double>(allocs) / std::max<long>(totalMoves, 1));

  struct AllocRow {
    uintptr_t addr = 0;
    long long count = 0;
    long long bytes = 0;
  };
  std::vector<AllocRow> rows;
  for (int i = 0; i < kMaxSites; ++i) {
    if (g_siteAddr[i] == 0) continue;
    rows.push_back({g_siteAddr[i], g_siteCounts[i].load(), g_siteBytes[i].load()});
  }
  std::sort(rows.begin(), rows.end(), [](const AllocRow& a, const AllocRow& b) { return a.bytes > b.bytes; });
  std::printf("\n== top allocation sites (by bytes) ==\n");
  std::printf("  %9s %12s %8s  %s\n", "allocs", "bytes", "avg", "site");
  for (size_t i = 0; i < rows.size() && i < 16; ++i) {
    if (rows[i].count == 0) continue;
    const Sym& sym = resolve(rows[i].addr);
    std::printf("  %9lld %12lld %8.1f  %s  [%s:%d]\n", rows[i].count, rows[i].bytes,
                static_cast<double>(rows[i].bytes) / static_cast<double>(rows[i].count), sym.name.c_str(),
                sym.file.c_str(), sym.line);
  }

  // ---- phase 2: cpu sampling, over the same kind of games --------------------
  g_samples.clear();
  g_samples.reserve(200000);  // no allocation from here on: see SampleStack
  g_sampling = true;
  HANDLE sampler = CreateThread(nullptr, 0, samplerLoop, nullptr, 0, nullptr);
  const auto cpuStart = std::chrono::steady_clock::now();
  long sampledNodes = 0;
  long sampledMoves = 0;
  for (int g = 0; g < games; ++g) {
    const double clockMs = static_cast<double>(rng() % 30000000u);
    MathRandom mathRng(rng());
    GameState state = newBoardState(boardSize, ai, true, clockMs, mathRng);
    ipvgo::nn::SearchSession session;
    for (int m = 0; m < boardSize * boardSize * 4 && !state.gameOver; ++m) {
      if (whoseTurn(state) != Color::Black) break;
      session.noteRequest(static_cast<size_t>(state.previousBoards.size()));
      const ipvgo::nn::ExploitResult r = ipvgo::nn::runExploiter(state, cfg, nullptr, &session);
      sampledNodes += r.nodes;
      ++sampledMoves;
      if (r.bestAction == (boardSize * boardSize)) passTurn(state, Color::Black);
      else if (!makeMove(state, r.bestAction / boardSize, r.bestAction % boardSize, Color::Black)) {
        passTurn(state, Color::Black);
      }
      if (state.gameOver) break;
      const Play wp = getMove(state, Color::White, ai, static_cast<double>(rng() % 30000000u), mathRng);
      if (wp.type == PlayType::Pass) passTurn(state, Color::White);
      else if (!makeMove(state, wp.x, wp.y, Color::White)) passTurn(state, Color::White);
    }
  }
  const double cpuMs =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - cpuStart).count();
  g_sampling = false;
  if (sampler) {
    WaitForSingleObject(sampler, 5000);
    CloseHandle(sampler);
  }
  std::printf("sampler diag: %lld rounds, %lld thread samples, %lld threads, suspend %.0f us avg, sample %.0f us avg\n",
              g_diagRounds.load(), g_diagCalls.load(), g_diagThreads.load(),
              g_diagCalls ? g_diagSuspendNs / 1000.0 / g_diagCalls : 0.0,
              g_diagCalls ? g_diagCallNs / 1000.0 / g_diagCalls : 0.0);
  std::printf("\nsampled gameplay: %ld moves, %ld nodes, %.0f ms, %zu samples (%.0f us/sample-equivalent)\n",
              sampledMoves, sampledNodes, cpuMs, g_samples.size(),
              g_samples.empty() ? 0.0 : 1000.0 * cpuMs / static_cast<double>(g_samples.size()));
  {
    size_t withExe = 0;
    size_t maxFrames = 0;
    for (const SampleStack& stack : g_samples) {
      bool found = false;
      for (int i = 0; i < stack.count; ++i) {
        if (inMainModule(stack.frames[i])) found = true;
      }
      if (found) ++withExe;
      maxFrames = std::max(maxFrames, static_cast<size_t>(stack.count));
    }
    std::printf("diagnostics: %zu/%zu samples have exe frames, max depth %zu, module [0x%llx,0x%llx)\n", withExe,
                g_samples.size(), maxFrames, static_cast<unsigned long long>(g_moduleBase),
                static_cast<unsigned long long>(g_moduleEnd));
    size_t shown = 0;
    for (const SampleStack& stack : g_samples) {
      if (shown >= 2) break;
      bool found = false;
      for (int i = 0; i < stack.count; ++i) {
        if (inMainModule(stack.frames[i])) found = true;
      }
      if (!found) continue;
      ++shown;
      std::printf("  stack of %d frames:\n", stack.count);
      for (int i = 0; i < stack.count && i < 14; ++i) {
        const DWORD64 addr = stack.frames[i];
        const Sym& sym = resolve(addr);
        std::printf("    %s%s  %s:%d\n", inMainModule(addr) ? "* " : "  ", sym.name.c_str(), sym.file.c_str(),
                    sym.line);
      }
    }
  }

  std::map<std::string, long long> exclusive;
  std::map<std::string, long long> inclusive;
  std::map<std::string, long long> lineExclusive;  // "file:line  (function)"
  std::map<std::pair<std::string, std::string>, long long> edges;
  std::map<std::string, long long> allocSites;  // callers that reach the allocator
  long long used = 0;
  for (const SampleStack& stack : g_samples) {
    std::vector<std::string> names;
    std::vector<DWORD64> addrs;
    for (int i = 0; i < stack.count; ++i) {
      const DWORD64 addr = stack.frames[i];
      if (!inMainModule(addr)) continue;
      names.push_back(resolve(addr).name);
      addrs.push_back(addr);
    }
    if (names.empty()) continue;
    ++used;
    for (size_t i = 0; i < names.size(); ++i) {
      if (names[i].find("hookAlloc") == std::string::npos) continue;
      // First caller above the allocator and the std:: container internals.
      for (size_t j = i + 1; j < names.size(); ++j) {
        if (names[j].rfind("std::", 0) == 0 || names[j].find("operator new") != std::string::npos) continue;
        const Sym& site = resolve(addrs[j]);
        char key[512];
        std::snprintf(key, sizeof(key), "%s:%d  (%s)", site.file.c_str(), site.line, site.name.c_str());
        ++allocSites[key];
        break;
      }
      break;
    }
    ++exclusive[names[0]];
    {
      const Sym& leaf = resolve(addrs[0]);
      if (leaf.line > 0) {
        char key[512];
        std::snprintf(key, sizeof(key), "%s:%d  (%s)", leaf.file.c_str(), leaf.line, leaf.name.c_str());
        ++lineExclusive[key];
      }
    }
    std::vector<std::string> seen;
    for (const auto& name : names) {
      if (std::find(seen.begin(), seen.end(), name) != seen.end()) continue;
      seen.push_back(name);
      ++inclusive[name];
    }
    for (size_t i = 0; i + 1 < names.size(); ++i) ++edges[{names[i], names[i + 1]}];
  }
  const long long total = std::max<long long>(used, 1);

  const auto print = [total](const char* title, std::map<std::string, long long>& data, size_t limit) {
    std::vector<std::pair<long long, std::string>> list;
    for (auto& [name, count] : data) list.emplace_back(count, name);
    std::sort(list.rbegin(), list.rend());
    std::printf("\n== %s ==\n  %7s %8s  %s\n", title, "pct", "count", "function");
    for (size_t i = 0; i < list.size() && i < limit; ++i) {
      std::printf("  %6.1f%% %8lld  %s\n", 100.0 * static_cast<double>(list[i].first) / total, list[i].first,
                  list[i].second.c_str());
    }
  };
  print("exclusive (leaf) cost", exclusive, 24);
  print("inclusive cost", inclusive, 30);
  print("hottest source lines (exclusive leaf)", lineExclusive, 34);
  print("allocation call sites (time inside the allocator)", allocSites, 25);

  std::vector<std::pair<long long, std::pair<std::string, std::string>>> edgeRows;
  for (auto& [key, count] : edges) edgeRows.emplace_back(count, key);
  std::sort(edgeRows.rbegin(), edgeRows.rend());
  std::printf("\n== hottest caller -> callee edges ==\n  %7s %8s  %s\n", "pct", "count", "edge");
  for (size_t i = 0; i < edgeRows.size() && i < 400; ++i) {
    std::printf("  %6.1f%% %8lld  %s -> %s\n", 100.0 * static_cast<double>(edgeRows[i].first) / total,
                edgeRows[i].first, edgeRows[i].second.first.c_str(), edgeRows[i].second.second.c_str());
  }
  return 0;
}

#else

#include <cstdio>

int runProfiler(int, char**) {
  std::fprintf(stderr, "prof: build the x64-Profile (RelWithDebInfo) configuration on Windows to enable the profiler\n");
  return 2;
}

#endif
