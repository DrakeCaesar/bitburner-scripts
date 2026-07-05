#pragma once

#include <cstdint>
#include <cmath>
#include <algorithm>
#include <string>

namespace koth {

inline constexpr int KING_MAIN_PEAK_ALTITUDE = 7500;
inline constexpr int KOTH_PEAK_HEIGHT = 10000;
inline constexpr double KOTH_NEAR_ZONE_FRACTION = 0.03;
inline constexpr int KOTH_HILL_DIFFICULTY_DIVISOR = 8;
inline constexpr int KOTH_HILL_DIFFICULTY_CAP = 4;
inline constexpr int KOTH_HILL_SPACING_WIDTHS = 3;
inline constexpr double KOTH_LOCATION_JITTER_SCALE = 0.2;
inline constexpr double KOTH_LOCATION_JITTER_BASE = 0.9;
inline constexpr int KOTH_HEIGHT_OFFSET_BASE = 2600;
inline constexpr double KOTH_HEIGHT_JITTER_SCALE = 0.1;
inline constexpr double KOTH_HEIGHT_JITTER_BASE = 0.95;
inline constexpr int KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2;
inline constexpr int KOTH_GAUSS_WIDTH_PLUS = 1;

inline constexpr int ASSIGNMENT_PASSWORD_LENGTH_DIVISOR = 6;
inline constexpr int ASSIGNMENT_PASSWORD_LENGTH_CAP = 10;
inline constexpr int ASSIGNMENT_SEED_STRIDE = 9973;
inline constexpr int ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS = 15;

inline constexpr int LEGACY_FINALS_TINY_SPAN = 12;
inline constexpr int LEGACY_FINAL_MAIN_RADIUS = 9;
inline constexpr int LEGACY_FINAL_SIDE_MIN_RADIUS = 25;
inline constexpr int LEGACY_FINAL_SIDE_MAX_RADIUS = 99;
inline constexpr int LEGACY_FINAL_SIDE_SPAN_DIVISOR = 40;

inline constexpr uint32_t DEFAULT_SEED = 0x4b6f7468u;
inline constexpr int DEFAULT_DIFFICULTY = 60;
inline constexpr int DEFAULT_COUNT = 100;

// Hard cap so random GA configs cannot probe billions of times on one assignment.
inline constexpr int SOLVER_MAX_PROBES = 5000;
inline constexpr int TERNARY_MAX_LINEAR_SCAN = 64;

inline int64_t clampInt64(int64_t v, int64_t lo, int64_t hi) {
  return std::max(lo, std::min(hi, v));
}

inline int64_t ipow10(int exp) {
  int64_t r = 1;
  for (int i = 0; i < exp; ++i) r *= 10;
  return r;
}

inline int64_t ceilDiv(int64_t a, int64_t b) {
  return (a + b - 1) / b;
}

inline double positiveMod1(double x) {
  double r = std::fmod(x, 1.0);
  if (r < 0.0) r += 1.0;
  return r;
}

}  // namespace koth
