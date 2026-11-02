// In-process profiler for the search. The Visual Studio / ETW CPU profiler
// needs an elevated session; this runs unprivileged by looking at its own
// process instead.
//
//   ipvgo_prof [faction] [depth] [ply] [reps]
//
//  phase 1  count allocations/deallocations and attribute them to the calling
//           function via the return address of operator new
//  phase 2  sample every thread's call stack with StackWalk64 while the same
//           search runs `reps` times, then report exclusive/inclusive cost per
//           function and the heaviest caller->callee edges
//
// Needs the PDB next to the exe, which the CMake target produces (/Zi /DEBUG).
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
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
#include "game_engine.hpp"
#include "go_game.hpp"
#include "opt_flags.hpp"
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

void* hookAlloc(size_t size) {
  void* p = std::malloc(size ? size : 1);
  if (p == nullptr) throw std::bad_alloc();
  if (g_countAllocs.load(std::memory_order_relaxed) && !t_inHook) {
    t_inHook = true;
    g_allocCount.fetch_add(1, std::memory_order_relaxed);
    g_allocBytes.fetch_add(static_cast<long long>(size), std::memory_order_relaxed);
    const int idx = siteIndex(_ReturnAddress());
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
  std::free(p);
}

}  // namespace

void* operator new(size_t size) { return hookAlloc(size); }
void* operator new[](size_t size) { return hookAlloc(size); }
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
std::vector<std::vector<DWORD64>> g_samples;
std::mutex g_samplesMutex;

BOOL CALLBACK readProcess(HANDLE, DWORD64 base, PVOID buffer, DWORD size, LPDWORD read) {
  SIZE_T bytes = 0;
  const BOOL ok = ReadProcessMemory(GetCurrentProcess(), reinterpret_cast<LPCVOID>(base), buffer, size, &bytes);
  *read = static_cast<DWORD>(bytes);
  return ok;
}

void sampleThread(HANDLE thread) {
  if (SuspendThread(thread) == static_cast<DWORD>(-1)) return;
  CONTEXT ctx{};
  ctx.ContextFlags = CONTEXT_FULL;
  if (GetThreadContext(thread, &ctx)) {
    STACKFRAME64 frame{};
    frame.AddrPC.Offset = ctx.Rip;
    frame.AddrPC.Mode = AddrModeFlat;
    frame.AddrStack.Offset = ctx.Rsp;
    frame.AddrStack.Mode = AddrModeFlat;
    frame.AddrFrame.Offset = ctx.Rbp;
    frame.AddrFrame.Mode = AddrModeFlat;

    std::vector<DWORD64> stack;
    stack.reserve(48);
    for (int depth = 0; depth < 48; ++depth) {
      if (!StackWalk64(IMAGE_FILE_MACHINE_AMD64, GetCurrentProcess(), thread, &frame, &ctx, readProcess,
                       SymFunctionTableAccess64, SymGetModuleBase64, nullptr)) {
        break;
      }
      if (frame.AddrPC.Offset == 0) break;
      stack.push_back(frame.AddrPC.Offset);
    }
    if (stack.size() > 200) stack.resize(200);
    if (!stack.empty()) {
      std::lock_guard<std::mutex> lock(g_samplesMutex);
      g_samples.push_back(std::move(stack));
    }
  }
  ResumeThread(thread);
}

DWORD WINAPI samplerLoop(void*) {
  const DWORD pid = GetCurrentProcessId();
  const DWORD self = GetCurrentThreadId();
  while (g_sampling.load(std::memory_order_relaxed)) {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snapshot != INVALID_HANDLE_VALUE) {
      THREADENTRY32 entry{};
      entry.dwSize = sizeof(entry);
      if (Thread32First(snapshot, &entry)) {
        do {
          if (entry.th32OwnerProcessID != pid || entry.th32ThreadID == self) continue;
          HANDLE thread = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION, FALSE,
                                     entry.th32ThreadID);
          if (thread == nullptr) continue;
          sampleThread(thread);
          CloseHandle(thread);
        } while (Thread32Next(snapshot, &entry));
      }
      CloseHandle(snapshot);
    }
    Sleep(1);
  }
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  const std::string faction = argc > 1 ? argv[1] : "Slum Snakes";
  const int depth = argc > 2 ? std::atoi(argv[2]) : 3;
  const int targetPly = argc > 3 ? std::atoi(argv[3]) : 6;

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
    const Sym& probe = resolve(reinterpret_cast<DWORD64>(&main));
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
  MathRandom mathRng(rng());
  GameState state = newBoardState(5, ai, true, static_cast<double>(rng() % 30000000u), mathRng);
  for (int ply = 0; ply < targetPly && !state.gameOver; ++ply) {
    const Color mover = whoseTurn(state);
    const Play play = getMove(state, mover, ai, static_cast<double>(rng() % 30000000u), mathRng);
    if (play.type == PlayType::Pass) {
      passTurn(state, mover);
    } else if (!makeMove(state, play.x, play.y, mover)) {
      passTurn(state, mover);
    }
  }
  if (state.gameOver || whoseTurn(state) != Color::Black) {
    std::printf("bad starting position\n");
    return 1;
  }

  ipvgo::nn::ExploitConfig cfg;
  cfg.depth = depth;
  cfg.threads = 1;

  std::printf("workload: %s 5x5 depth=%d ply=%d threads=%d\n", faction.c_str(), depth, targetPly, cfg.threads);

  // ---- phase 1: allocations -------------------------------------------------
  g_countAllocs = true;
  const auto allocStart = std::chrono::steady_clock::now();
  const ipvgo::nn::ExploitResult r1 = ipvgo::nn::runExploiter(state, cfg);
  const double allocMs =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - allocStart).count();
  g_countAllocs = false;

  const long long allocs = g_allocCount.load();
  const long long bytes = g_allocBytes.load();
  std::printf("search: nodes=%ld value=%.4f  %.1f ms\n", r1.nodes, r1.value, allocMs);
  std::printf("allocs=%lld bytes=%lld frees=%lld  -> %.2f alloc/ms, %.0f bytes/alloc\n", allocs, bytes,
              g_freeCount.load(), static_cast<double>(allocs) / std::max(allocMs, 1e-9),
              static_cast<double>(bytes) / std::max<double>(1.0, static_cast<double>(allocs)));

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

  // ---- phase 2: cpu sampling ------------------------------------------------
  const int reps = argc > 4 ? std::atoi(argv[4]) : 4;
  g_samples.clear();
  g_sampling = true;
  HANDLE sampler = CreateThread(nullptr, 0, samplerLoop, nullptr, 0, nullptr);
  const auto cpuStart = std::chrono::steady_clock::now();
  ipvgo::nn::ExploitResult r2;
  for (int i = 0; i < reps; ++i) r2 = ipvgo::nn::runExploiter(state, cfg);
  const double cpuMs =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - cpuStart).count();
  g_sampling = false;
  if (sampler) {
    WaitForSingleObject(sampler, 5000);
    CloseHandle(sampler);
  }
  std::printf("\nsampled search: nodes=%ld  %.1f ms x%d  samples=%zu\n", r2.nodes, cpuMs, reps, g_samples.size());
  {
    size_t withExe = 0;
    size_t maxFrames = 0;
    for (const auto& stack : g_samples) {
      bool found = false;
      for (const DWORD64 addr : stack) {
        if (inMainModule(addr)) found = true;
      }
      if (found) ++withExe;
      maxFrames = std::max(maxFrames, stack.size());
    }
    std::printf("diagnostics: %zu/%zu samples have exe frames, max depth %zu, module [0x%llx,0x%llx)\n", withExe,
                g_samples.size(), maxFrames, static_cast<unsigned long long>(g_moduleBase),
                static_cast<unsigned long long>(g_moduleEnd));
    size_t shown = 0;
    for (const auto& stack : g_samples) {
      if (shown >= 2) break;
      bool found = false;
      for (const DWORD64 addr : stack) {
        if (inMainModule(addr)) found = true;
      }
      if (!found) continue;
      ++shown;
      std::printf("  stack of %zu frames:\n", stack.size());
      for (size_t i = 0; i < stack.size() && i < 14; ++i) {
        const Sym& sym = resolve(stack[i]);
        std::printf("    %s%s  %s:%d\n", inMainModule(stack[i]) ? "* " : "  ", sym.name.c_str(), sym.file.c_str(),
                    sym.line);
      }
    }
  }

  std::map<std::string, long long> exclusive;
  std::map<std::string, long long> inclusive;
  std::map<std::pair<std::string, std::string>, long long> edges;
  long long used = 0;
  for (const auto& stack : g_samples) {
    std::vector<std::string> names;
    for (const DWORD64 addr : stack) {
      if (!inMainModule(addr)) continue;
      names.push_back(resolve(addr).name);
    }
    if (names.empty()) continue;
    ++used;
    ++exclusive[names[0]];
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

  std::vector<std::pair<long long, std::pair<std::string, std::string>>> edgeRows;
  for (auto& [key, count] : edges) edgeRows.emplace_back(count, key);
  std::sort(edgeRows.rbegin(), edgeRows.rend());
  std::printf("\n== hottest caller -> callee edges ==\n  %7s %8s  %s\n", "pct", "count", "edge");
  for (size_t i = 0; i < edgeRows.size() && i < 22; ++i) {
    std::printf("  %6.1f%% %8lld  %s -> %s\n", 100.0 * static_cast<double>(edgeRows[i].first) / total,
                edgeRows[i].first, edgeRows[i].second.first.c_str(), edgeRows[i].second.second.c_str());
  }
  return 0;
}
