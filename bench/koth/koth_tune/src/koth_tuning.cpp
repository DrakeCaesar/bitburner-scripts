#include "koth_tuning.hpp"

namespace koth {
namespace {

const LadderSnipeTuning kDefaults{};

thread_local const LadderSnipeTuning* gActiveTuning = nullptr;

}  // namespace

const LadderSnipeTuning& defaultLadderSnipeTuning() { return kDefaults; }

const LadderSnipeTuning& activeLadderSnipeTuning() {
  if (gActiveTuning) return *gActiveTuning;
  return kDefaults;
}

void setActiveLadderSnipeTuning(const LadderSnipeTuning* tuning) { gActiveTuning = tuning; }

}  // namespace koth
