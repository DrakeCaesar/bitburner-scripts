#include "json_api.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>

using namespace emscripten;
using namespace ipvgo;

EMSCRIPTEN_BINDINGS(ipvgo_module) {
  function("findBestMoveJson", &processMoveRequestJson);
}
#endif
