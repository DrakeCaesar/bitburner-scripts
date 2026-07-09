#pragma once

#include <cmath>
#include <cstdint>
#include <random>

namespace ipvgo::game {

// Faithful port of Bitburner's Wichmann-Hill PRNG (src/Casino/RNG.ts).
// In-game it is seeded by Player.totalPlaytime (milliseconds); the same seeding
// convention is preserved here so obstacle/AI/cheat sequences can be reproduced.
class WHRNG {
 public:
  explicit WHRNG(double totalPlaytimeMs) {
    const double v = std::fmod(totalPlaytimeMs / 1000.0, 30000.0);
    s1 = v;
    s2 = v;
    s3 = v;
  }

  void step() {
    s1 = std::fmod(171.0 * s1, 30269.0);
    s2 = std::fmod(172.0 * s2, 30307.0);
    s3 = std::fmod(170.0 * s3, 30323.0);
  }

  double random() {
    step();
    return std::fmod(s1 / 30269.0 + s2 / 30307.0 + s3 / 30323.0, 1.0);
  }

 private:
  double s1 = 0;
  double s2 = 0;
  double s3 = 0;
};

// A generic uniform [0,1) source used to stand in for the game's Math.random()
// calls (handicap placement, getDefendMove). Backed by a seedable Mersenne
// Twister so self-play games are reproducible when desired.
class MathRandom {
 public:
  explicit MathRandom(uint64_t seed) : engine(seed), dist(0.0, 1.0) {}

  double random() { return dist(engine); }

 private:
  std::mt19937_64 engine;
  std::uniform_real_distribution<double> dist;
};

}  // namespace ipvgo::game
