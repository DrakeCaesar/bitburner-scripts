#pragma once

// Small-object pool behind the global operator new/delete of ipvgo_game. The
// search allocates and frees millions of short-lived vectors, and the default
// heap lock-and-search path dominated the profile. Blocks up to kMaxSmall bytes
// come from per-thread free lists carved out of big chunks that are never
// returned to the OS; larger blocks go to malloc. Every block carries a 16-byte
// header holding its size class, so unsized deletes work and a block freed on
// another thread simply joins that thread's list.

#include <cstddef>
#include <cstdint>
#include <cstdlib>
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

struct ThreadPool {
  FreeNode* heads[kClasses] = {};
  char* bump = nullptr;
  char* end = nullptr;
};

inline ThreadPool& pool() {
  static thread_local ThreadPool p;
  return p;
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
    return node;
  }
  const size_t total = kHeader + cls * kGranule;
  if (static_cast<size_t>(p.end - p.bump) < total) {
    char* chunk = static_cast<char*>(std::malloc(kChunkBytes));
    if (chunk == nullptr) throw std::bad_alloc();
    p.bump = chunk;
    p.end = chunk + kChunkBytes;
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
}

}  // namespace ipvgo::fastalloc
