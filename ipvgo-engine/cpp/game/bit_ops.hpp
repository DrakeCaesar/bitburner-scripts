// The two word operations the packed bit planes need, behind one portable name.
//
// MSVC only exposes these as <intrin.h> intrinsics, and its header does not
// exist on Clang/GCC, so every call site goes through here instead.
#pragma once

#include <cstdint>

#if defined(_MSC_VER)
#include <intrin.h>
#endif

namespace ipvgo::game {

namespace bits {

// Index of the lowest set bit. v must be non-zero.
inline int lowestBit(uint64_t v) {
#if defined(_MSC_VER)
  unsigned long index = 0;
  _BitScanForward64(&index, v);
  return static_cast<int>(index);
#elif defined(__GNUC__) || defined(__clang__)
  return __builtin_ctzll(v);
#else
  int index = 0;
  while ((v & 1ULL) == 0) {
    v >>= 1;
    ++index;
  }
  return index;
#endif
}

// Number of set bits in v.
inline int popcount(uint64_t v) {
#if defined(_MSC_VER)
  return static_cast<int>(__popcnt64(v));
#elif defined(__GNUC__) || defined(__clang__)
  return __builtin_popcountll(v);
#else
  int count = 0;
  while (v != 0) {
    v &= v - 1;
    ++count;
  }
  return count;
#endif
}

}  // namespace bits

}  // namespace ipvgo::game
