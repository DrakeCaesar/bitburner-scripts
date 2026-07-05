#pragma once

#include "koth_common.hpp"

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace koth {

struct Assignment {
  int difficulty = DEFAULT_DIFFICULTY;
  std::string password;
  int passwordLength = 0;
};

struct NumericRange {
  int64_t min = 0;
  int64_t max = 0;
};

struct Server {
  std::string password;
  int difficulty = DEFAULT_DIFFICULTY;
};

NumericRange assignmentNumericRange(const Assignment& a);
Server toServer(const Assignment& a);
int64_t parsePasswordInt(const std::string& password);

double getKingOfTheHillAltitude(const Server& server, int64_t attempted);
bool authKingOfTheHill(const Server& server, int64_t attempted, double* altitudeOut);

using RngFn = std::function<double()>;
std::string getPasswordSeeded(int length, const RngFn& rng);
Assignment buildAssignment(int difficulty, const RngFn& rng);
RngFn mulberry32(uint32_t seed);
std::vector<Assignment> generateAssignments(uint32_t seed, int count, int difficulty);

int kingOfTheHillHillCount(int difficulty);
int64_t kingOfTheHillGaussianWidth(int passwordLength);

}  // namespace koth
