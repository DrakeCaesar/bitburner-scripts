#include "koth_game.hpp"

#include <cmath>
#include <stdexcept>

namespace koth {

namespace {

class WHRNG {
 public:
  explicit WHRNG(int64_t totalPlaytime) {
    const double v = std::fmod(static_cast<double>(totalPlaytime) / 1000.0, 30000.0);
    s1_ = s2_ = s3_ = v;
  }

  double random() {
    step();
    return positiveMod1(s1_ / 30269.0 + s2_ / 30307.0 + s3_ / 30323.0);
  }

 private:
  void step() {
    s1_ = std::fmod(171.0 * s1_, 30269.0);
    s2_ = std::fmod(172.0 * s2_, 30307.0);
    s3_ = std::fmod(170.0 * s3_, 30323.0);
  }

  double s1_ = 0;
  double s2_ = 0;
  double s3_ = 0;
};

double getAltitudeGivenHillSpecs(int64_t x, double location, double height, double width) {
  const double dx = static_cast<double>(x) - location;
  const double w2 = width * width;
  return height * std::exp((dx * dx / w2) * -1.0);
}

}  // namespace

int64_t parsePasswordInt(const std::string& password) {
  try {
    return std::stoll(password);
  } catch (...) {
    return 0;
  }
}

NumericRange assignmentNumericRange(const Assignment& a) {
  return {ipow10(a.passwordLength - 1), ipow10(a.passwordLength) - 1};
}

Server toServer(const Assignment& a) {
  return {a.password, a.difficulty};
}

int kingOfTheHillHillCount(int difficulty) {
  return std::min(difficulty / KOTH_HILL_DIFFICULTY_DIVISOR, KOTH_HILL_DIFFICULTY_CAP) * 2 + 1;
}

int64_t kingOfTheHillGaussianWidth(int passwordLength) {
  const int exp = std::max(passwordLength - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0);
  return ipow10(exp) + KOTH_GAUSS_WIDTH_PLUS;
}

double getKingOfTheHillAltitude(const Server& server, int64_t attempted) {
  const int64_t password = parsePasswordInt(server.password);
  const int64_t x = attempted;
  WHRNG rng(password);
  const int hillCount = kingOfTheHillHillCount(server.difficulty);
  const int passwordHillIndex = static_cast<int>(std::floor(rng.random() * (hillCount - 2))) + 1;
  const double width = static_cast<double>(kingOfTheHillGaussianWidth(static_cast<int>(server.password.size())));

  if (password != 0 && std::abs(static_cast<double>(x - password) / static_cast<double>(password)) < KOTH_NEAR_ZONE_FRACTION) {
    return getAltitudeGivenHillSpecs(x, static_cast<double>(password), KOTH_PEAK_HEIGHT, width);
  }

  double altitude = 0.0;
  for (int i = 0; i < hillCount; ++i) {
    const double locationOffset =
        (i - passwordHillIndex) * width * KOTH_HILL_SPACING_WIDTHS *
        (rng.random() * KOTH_LOCATION_JITTER_SCALE + KOTH_LOCATION_JITTER_BASE);
    const double heightOffset = std::abs((i - passwordHillIndex) * KOTH_HEIGHT_OFFSET_BASE) *
                                (rng.random() * KOTH_HEIGHT_JITTER_SCALE + KOTH_HEIGHT_JITTER_BASE);
    altitude += getAltitudeGivenHillSpecs(x, static_cast<double>(password) + locationOffset,
                                          KOTH_PEAK_HEIGHT - heightOffset, width);
  }
  return altitude;
}

bool authKingOfTheHill(const Server& server, int64_t attempted, double* altitudeOut) {
  if (server.password == std::to_string(attempted)) {
    return true;
  }
  const double altitude = getKingOfTheHillAltitude(server, attempted);
  if (altitudeOut) *altitudeOut = altitude;
  return false;
}

std::string getPasswordSeeded(int length, const RngFn& rng) {
  static const char digits[] = "0123456789";
  const int capped = static_cast<int>(clampInt64(length, 1, 50));
  std::string password;
  password.reserve(static_cast<size_t>(capped));
  for (int i = 0; i < capped; ++i) {
    password.push_back(digits[static_cast<size_t>(std::floor(rng() * 10.0)) % 10]);
  }
  if (password.size() > static_cast<size_t>(ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS)) {
    password.resize(static_cast<size_t>(ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS));
  }
  // Match JS Number(password).toString() stripping leading zeros behavior via stoll/stoull
  try {
    return std::to_string(std::stoll(password));
  } catch (...) {
    return "0";
  }
}

Assignment buildAssignment(int difficulty, const RngFn& rng) {
  const double rawLen = 1.0 + static_cast<double>(difficulty) / ASSIGNMENT_PASSWORD_LENGTH_DIVISOR;
  const int passwordLength = static_cast<int>(std::min(rawLen, static_cast<double>(ASSIGNMENT_PASSWORD_LENGTH_CAP)));
  Assignment a;
  a.difficulty = difficulty;
  a.password = getPasswordSeeded(passwordLength, rng);
  a.passwordLength = static_cast<int>(a.password.size());
  return a;
}

RngFn mulberry32(uint32_t seed) {
  return [state = seed]() mutable -> double {
    state = state + 0x6d2b79f5u;
    uint32_t t = state;
    t = (t ^ (t >> 15u)) * (t | 1u);
    t ^= t + (t ^ (t >> 7u)) * (t | 61u);
    t ^= t >> 14u;
    return static_cast<double>(t) / 4294967296.0;
  };
}

Assignment generateAssignmentAt(uint32_t seed, int index, int difficulty) {
  const int i = index - 1;
  const uint32_t rngSeed = seed + static_cast<uint32_t>(i * ASSIGNMENT_SEED_STRIDE);
  return buildAssignment(difficulty, mulberry32(rngSeed));
}

std::vector<Assignment> generateAssignments(uint32_t seed, int count, int difficulty) {
  std::vector<Assignment> rows;
  rows.reserve(static_cast<size_t>(count));
  for (int i = 0; i < count; ++i) {
    const uint32_t rngSeed = seed + static_cast<uint32_t>(i * ASSIGNMENT_SEED_STRIDE);
    rows.push_back(buildAssignment(difficulty, mulberry32(rngSeed)));
  }
  return rows;
}

}  // namespace koth
