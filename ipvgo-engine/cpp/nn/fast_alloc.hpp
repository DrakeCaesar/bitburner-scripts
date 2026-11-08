#pragma once

// Small-object pool behind the global operator new/delete of ipvgo_game. The
// search allocates and frees millions of short-lived vectors, and the default
// heap lock-and-search path dominated the profile. Blocks up to kMaxSmall bytes
// come from per-thread free lists carved out of big chunks that are never
// returned to the OS; larger blocks go to malloc. Every block carries a 16-byte
// header holding its size class, so unsized deletes work and a block freed on
// another thread simply joins that thread's list.
//
// A search spawns a fresh set of worker threads for every move and joins them at
// the end of it, so a purely per-thread pool loses whatever those workers still
// held when they exit: their free lists and the unused tail of their chunk. That
// is invisible within one search and ruinous across a long bench - measured at
// 7.4 MB per move with 12 threads, 9.6 GB over 40 games of the 5x5 bench and 24 GB
// over the 100-games-per-faction run. A thread therefore hands its lists and its
// spare tail to a process-wide pool on exit, and a thread that needs a block or a
// chunk takes it from there before asking the C runtime.

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <mutex>
#include <new>

namespace ipvgo::fastalloc {

constexpr size_t kHeader = 16;
constexpr size_t kGranule = 16;
constexpr size_t kMaxSmall = 512;
constexpr size_t kClasses = kMaxSmall / kGranule + 1;
constexpr size_t kChunkBytes = 256 * 1024;

struct FreeNode {
  FreeNode* next;
};

// Unused tail of a chunk whose thread exited. The descriptor lives in the tail
// itself, so donating one costs no allocation.
struct SpareRegion {
  SpareRegion* next;
  size_t bytes;
};

// Process-wide handover pool. Deliberately never destroyed: thread_local
// destructors can run during process exit, after a function-local static would
// already be gone.
struct Globals {
  std::mutex mutex;
  FreeNode* heads[kClasses] = {};
  // Mirrors the chain lengths so a thread can tell, without the lock, whether
  // there is anything to drain. Written under the mutex, read outside it.
  std::atomic<uint32_t> counts[kClasses] = {};
  SpareRegion* spare = nullptr;
};

inline Globals& globals() {
  // Placement-new into static storage: `new Globals()` would go through the
  // operator new this file replaces, re-enter allocate(), and deadlock on the
  // initialisation guard of this very variable.
  alignas(Globals) static unsigned char storage[sizeof(Globals)];
  static Globals* instance = ::new (static_cast<void*>(storage)) Globals();
  return *instance;
}

struct ThreadPool {
  FreeNode* heads[kClasses] = {};
  uint32_t counts[kClasses] = {};
  char* bump = nullptr;
  char* end = nullptr;
  ~ThreadPool();
};

// A thread keeps at most this many blocks per size class. Anything beyond goes
// back to the shared pool: without a ceiling a single thread can hold every block
// of a class in its own list while its neighbours carve fresh chunks, which is
// how the pool kept growing instead of reaching a steady state.
constexpr uint32_t kLocalKeep = 256;
// Blocks taken from the shared pool in one go, to amortise the lock without
// taking the class away from the other threads.
constexpr uint32_t kBurst = 128;

inline ThreadPool& pool() {
  static thread_local ThreadPool p;
  return p;
}

// Takes up to kBurst blocks of one size class from the shared pool.
inline bool takeShared(size_t cls, ThreadPool& p) {
  Globals& g = globals();
  if (g.counts[cls].load(std::memory_order_relaxed) == 0) return false;
  std::lock_guard<std::mutex> lock(g.mutex);
  FreeNode* head = g.heads[cls];
  if (head == nullptr) {
    g.counts[cls].store(0, std::memory_order_relaxed);
    return false;
  }
  FreeNode* last = head;
  uint32_t taken = 1;
  while (taken < kBurst && last->next != nullptr) {
    last = last->next;
    ++taken;
  }
  g.heads[cls] = last->next;
  g.counts[cls].fetch_sub(taken, std::memory_order_relaxed);
  last->next = nullptr;
  p.heads[cls] = head;
  p.counts[cls] = taken;
  return true;
}

// Hands a thread's local list back to the shared pool.
inline void giveShared(size_t cls, ThreadPool& p) {
  if (p.heads[cls] == nullptr) return;
  Globals& g = globals();
  std::lock_guard<std::mutex> lock(g.mutex);
  FreeNode* last = p.heads[cls];
  uint32_t count = 1;
  while (last->next != nullptr) {
    last = last->next;
    ++count;
  }
  last->next = g.heads[cls];
  g.heads[cls] = p.heads[cls];
  g.counts[cls].fetch_add(count, std::memory_order_relaxed);
  p.heads[cls] = nullptr;
  p.counts[cls] = 0;
}

inline SpareRegion* popSpare() {
  Globals& g = globals();
  std::lock_guard<std::mutex> lock(g.mutex);
  SpareRegion* region = g.spare;
  if (region != nullptr) g.spare = region->next;
  return region;
}

inline void* allocate(size_t size) {
  if (size == 0) size = 1;
  if (size > kMaxSmall) {
    char* raw = static_cast<char*>(std::malloc(size + kHeader));
    if (raw == nullptr) throw std::bad_alloc();
    *reinterpret_cast<uint64_t*>(raw) = 0;
    return raw + kHeader;
  }
  const size_t cls = (size + kGranule - 1) / kGranule;
  ThreadPool& p = pool();
  if (FreeNode* node = p.heads[cls]) {
    p.heads[cls] = node->next;
    --p.counts[cls];
    return node;
  }
  if (takeShared(cls, p)) {
    FreeNode* node = p.heads[cls];
    p.heads[cls] = node->next;
    --p.counts[cls];
    return node;
  }

  const size_t total = kHeader + cls * kGranule;
  if (static_cast<size_t>(p.end - p.bump) < total) {
    char* chunk = nullptr;
    size_t bytes = 0;
    if (SpareRegion* region = popSpare()) {
      chunk = reinterpret_cast<char*>(region) + sizeof(SpareRegion);
      bytes = region->bytes - sizeof(SpareRegion);
    }
    if (chunk == nullptr || bytes < total) {
      chunk = static_cast<char*>(std::malloc(kChunkBytes));
      if (chunk == nullptr) throw std::bad_alloc();
      bytes = kChunkBytes;
    }
    p.bump = chunk;
    p.end = chunk + bytes;
  }
  char* raw = p.bump;
  p.bump += total;
  *reinterpret_cast<uint64_t*>(raw) = cls;
  return raw + kHeader;
}

inline void release(void* ptr) noexcept {
  if (ptr == nullptr) return;
  char* raw = static_cast<char*>(ptr) - kHeader;
  const uint64_t cls = *reinterpret_cast<uint64_t*>(raw);
  if (cls == 0) {
    std::free(raw);
    return;
  }
  ThreadPool& p = pool();
  FreeNode* node = static_cast<FreeNode*>(ptr);
  node->next = p.heads[cls];
  p.heads[cls] = node;
  if (++p.counts[cls] > kLocalKeep) giveShared(static_cast<size_t>(cls), p);
}

// Hands back everything this thread still owns, so the next set of worker threads
// reuses it instead of carving new chunks.
inline ThreadPool::~ThreadPool() {
  Globals& g = globals();
  std::lock_guard<std::mutex> lock(g.mutex);
  for (size_t c = 0; c < kClasses; ++c) {
    FreeNode* node = heads[c];
    heads[c] = nullptr;
    counts[c] = 0;
    while (node != nullptr) {
      FreeNode* next = node->next;
      node->next = g.heads[c];
      g.heads[c] = node;
      g.counts[c].fetch_add(1, std::memory_order_relaxed);
      node = next;
    }
  }
  const size_t spare = static_cast<size_t>(end - bump);
  if (bump != nullptr && spare > sizeof(SpareRegion) + kGranule) {
    SpareRegion* region = reinterpret_cast<SpareRegion*>(bump);
    region->bytes = spare;
    region->next = g.spare;
    g.spare = region;
  }
  bump = nullptr;
  end = nullptr;
}

}  // namespace ipvgo::fastalloc
